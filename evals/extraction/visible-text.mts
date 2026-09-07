/**
 * **The visible text of an HTML page, without parsing it into a tree.**
 *
 * The one caller that matters is the manifest integrity check in
 * `tests/extraction-manifests.test.ts`: every needle a manifest asserts has to
 * be *findable in the fixture's own bytes*, because a `mustNotContain` needle
 * that occurs nowhere on the page is satisfied by every arm, including one that
 * returns an empty string. That check asks one question — "is this string on the
 * page at all" — and it asks it of twelve fixtures totalling several megabytes,
 * on a box that is never idle.
 *
 * ## Why this is not JSDOM, and not a regex chain either
 *
 * It parsed with JSDOM until it didn't: on an idle box that costs seven seconds
 * over twelve fixtures, and under a load average of 103 it took **44 seconds and
 * timed out**. A red that is really a stopwatch is worse than no check at all.
 *
 * What replaced it was a chain of five regexes — strip `<script>`, strip
 * comments, delete inline tags, turn every other tag into a space, decode
 * fifteen named entities — and it agreed with JSDOM on all 66 needles of the
 * corpus as it stood on 2026-09-05. GPT Sol's review said the right thing about
 * that evidence: *"corpus-compatible, not parser-correct"*. A regex has no
 * concept of an attribute, so `<p title="x > Privacy policy">` ends at the `>`
 * **inside the quotes** and leaks `Privacy policy">` into what the check calls
 * visible text; `if a < b then` loses everything after the `<`; `&trade;` and
 * `&frac12;` never decode; `</script >` does not close a script.
 * It also **throws** on `&#1114112;`. `tests/extraction-visible-text.test.ts`
 * pins all twenty-seven of the cases it got wrong, against a JSDOM reference,
 * so the argument is evidence rather than assertion.
 *
 * So this is a hand-written scanner: one pass, `indexOf` to the next `<`, a small
 * state machine inside the tag. It is a **tokenizer, not a tree builder** —
 * see "Where this deliberately differs from a browser" below for the four places
 * that costs something, all of them asserted explicitly in the test.
 *
 * ## The semantics, which are not `textContent`
 *
 * - `script`, `style`, `noscript`, `template` and their contents vanish.
 * - Comments and doctypes vanish. A CDATA section vanishes whole — markers
 *   included.
 * - **Inline tags vanish with no separator.** The Python docs wrap every token of
 *   a code sample in its own `<span class="k">`, so a tag that became a space
 *   would turn `accumulate,` into `accumulate ,` and a needle that is plainly on
 *   the page would stop matching. Two needles disagreed with JSDOM for exactly
 *   this reason, which is why `INLINE` exists. Same list as
 *   `evals/extraction/inventory.mts` § `INLINE`, which arrived at it the same
 *   way; copied rather than imported so this file stays free of `jsdom`.
 * - **Every other tag becomes a single space**, so two adjacent blocks do not run
 *   their last and first words together.
 * - Attribute values never appear in the output, whatever they contain.
 * - `textarea` and `title` hold text, not markup, and it is kept.
 * - An unmatched `<` that no tag can start (`a < b`) stays as text, as a parser
 *   would leave it.
 *
 * ## Where this deliberately differs from a browser
 *
 * Each of these is asserted as a divergence in the test rather than left to be
 * discovered, and each is a place where matching the parser would mean building
 * a tree:
 *
 * 1. **A CDATA section is dropped entirely.** In HTML content a real parser
 *    treats `<![CDATA[x > y]]>` as a bogus comment ending at the *first* `>`,
 *    and leaks ` y]]>` as text; in foreign content (inside `<svg>`) it keeps the
 *    contents. Dropping it is the conservative reading of "no markers in the
 *    visible text", and a hand-written needle is never inside one.
 * 2. **A stray end tag becomes a space**, where a parser ignores it. Turning
 *    `a</div>b` into `a b` errs towards keeping words apart, which is the safe
 *    direction for a substring search.
 * 3. **The entity table is the HTML 4 set (259 names) plus the numeric
 *    escapes**, not HTML 5's 2,231. A needle is written by hand from what a
 *    reader sees, and `&bigstar;` is not what they see. Anything outside the
 *    table is left as written, exactly as an unknown entity is.
 * 4. **A `<noscript>` before the document's body** is hoisted out of the head by
 *    a real parser, so its contents survive; here it is content of a dropped
 *    element and vanishes. In body position — the only place it occurs on a real
 *    page — the two agree.
 */

/** Tags that live *inside* a run of text rather than being one. */
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "data", "del", "dfn", "em",
  "font", "i", "img", "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strike",
  "strong", "sub", "sup", "time", "tt", "u", "var", "wbr", "ruby", "rt", "rp",
]);

/** Elements whose contents are not prose. They and their children vanish. */
const DROPPED = new Set(["script", "style", "noscript", "template"]);

/** Of those, the two the tokenizer reads as raw text rather than as markup. */
const RAW_TEXT = new Set(["script", "style"]);

/** Elements whose contents are text with entities in it — kept, never parsed. */
const ESCAPABLE_RAW_TEXT = new Set(["textarea", "title"]);

const isSpace = (c: string | undefined): boolean =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

const isAsciiAlpha = (c: string | undefined): boolean =>
  c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));

const isAsciiAlnum = (c: string | undefined): boolean =>
  isAsciiAlpha(c) || (c !== undefined && c >= "0" && c <= "9");

/**
 * The HTML 4 named character references, verified one by one against JSDOM
 * rather than typed from memory — `evals/extraction/visible-text.mts` is not
 * the place to discover that `&sigmaf;` was a guess. `&notin;` is in here
 * alongside `&not` because the match is longest-first: `&notin;` is `∉`
 * while `&notit;` is `¬it;`.
 */
const ENTITIES: Record<string, string | undefined> = {
  nbsp: " ", iexcl: "¡", cent: "¢", pound: "£", curren: "¤",
  yen: "¥", brvbar: "¦", sect: "§", uml: "¨", copy: "©",
  ordf: "ª", laquo: "«", not: "¬", shy: "­", reg: "®", macr: "¯",
  deg: "°", plusmn: "±", sup2: "²", sup3: "³", acute: "´",
  micro: "µ", para: "¶", middot: "·", cedil: "¸", sup1: "¹",
  ordm: "º", raquo: "»", frac14: "¼", frac12: "½", frac34: "¾",
  iquest: "¿", Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã",
  Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç", Egrave: "È",
  Eacute: "É", Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í",
  Icirc: "Î", Iuml: "Ï", ETH: "Ð", Ntilde: "Ñ", Ograve: "Ò",
  Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", times: "×",
  Oslash: "Ø", Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü",
  Yacute: "Ý", THORN: "Þ", szlig: "ß", agrave: "à", aacute: "á",
  acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ",
  ccedil: "ç", egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï", eth: "ð",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ",
  ouml: "ö", divide: "÷", oslash: "ø", ugrave: "ù", uacute: "ú",
  ucirc: "û", uuml: "ü", yacute: "ý", thorn: "þ", yuml: "ÿ",
  fnof: "ƒ", Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ",
  Epsilon: "Ε", Zeta: "Ζ", Eta: "Η", Theta: "Θ", Iota: "Ι",
  Kappa: "Κ", Lambda: "Λ", Mu: "Μ", Nu: "Ν", Xi: "Ξ",
  Omicron: "Ο", Pi: "Π", Rho: "Ρ", Sigma: "Σ", Tau: "Τ",
  Upsilon: "Υ", Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π",
  rho: "ρ", sigma: "σ", sigmaf: "ς", tau: "τ", upsilon: "υ",
  phi: "φ", chi: "χ", psi: "ψ", omega: "ω", thetasym: "ϑ",
  upsih: "ϒ", piv: "ϖ", bull: "•", hellip: "…", prime: "′",
  Prime: "″", oline: "‾", frasl: "⁄", weierp: "℘", image: "ℑ",
  real: "ℜ", trade: "™", alefsym: "ℵ", larr: "←", uarr: "↑",
  rarr: "→", darr: "↓", harr: "↔", crarr: "↵", lArr: "⇐",
  uArr: "⇑", rArr: "⇒", dArr: "⇓", hArr: "⇔", forall: "∀",
  part: "∂", exist: "∃", empty: "∅", nabla: "∇", isin: "∈",
  notin: "∉", ni: "∋", prod: "∏", sum: "∑", minus: "−",
  lowast: "∗", radic: "√", prop: "∝", infin: "∞", ang: "∠",
  and: "∧", or: "∨", cap: "∩", cup: "∪", int: "∫", there4: "∴",
  sim: "∼", cong: "≅", asymp: "≈", ne: "≠", equiv: "≡", le: "≤",
  ge: "≥", sub: "⊂", sup: "⊃", nsub: "⊄", sube: "⊆", supe: "⊇",
  oplus: "⊕", otimes: "⊗", perp: "⊥", sdot: "⋅", lceil: "⌈",
  rceil: "⌉", lfloor: "⌊", rfloor: "⌋", lang: "⟨", rang: "⟩",
  loz: "◊", spades: "♠", clubs: "♣", hearts: "♥", diams: "♦",
  quot: '"', amp: "&", apos: "'", lt: "<", gt: ">", OElig: "Œ", oelig: "œ",
  Scaron: "Š", scaron: "š", Yuml: "Ÿ", circ: "ˆ", tilde: "˜",
  ensp: " ", emsp: " ", thinsp: " ", zwnj: "‌", zwj: "‍",
  lrm: "‎", rlm: "‏", ndash: "–", mdash: "—", lsquo: "‘",
  rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  dagger: "†", Dagger: "‡", permil: "‰", lsaquo: "‹", rsaquo: "›",
  euro: "€", AMP: "&", COPY: "©", GT: ">", LT: "<", QUOT: '"', REG: "®",
};

/**
 * The 106 names HTML 5 still decodes **without** their semicolon, because
 * twenty years of pages were written that way — `&copy 2026` really is
 * `© 2026`. Derived by asking JSDOM which of the names above it decodes
 * from `&name@`, not transcribed from the spec.
 */
const LEGACY_NO_SEMICOLON = new Set(
  ("nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg " +
    "plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 " +
    "iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml " +
    "Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash " +
    "Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring " +
    "aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve " +
    "oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml " +
    "quot amp lt gt AMP COPY GT LT QUOT REG").split(" "),
);

/**
 * The numeric escapes in the 0x80–0x9F range mean windows-1252, not C1 controls
 * — `&#147;` is a left double quote on half the web, and a needle written from
 * the rendered page contains the quote.
 */
const WINDOWS_1252 = new Map<number, string>([
  [0x80, "\u20ac"], [0x82, "\u201a"], [0x83, "\u0192"], [0x84, "\u201e"], [0x85, "\u2026"],
  [0x86, "\u2020"], [0x87, "\u2021"], [0x88, "\u02c6"], [0x89, "\u2030"], [0x8a, "\u0160"],
  [0x8b, "\u2039"], [0x8c, "\u0152"], [0x8e, "\u017d"], [0x91, "\u2018"], [0x92, "\u2019"],
  [0x93, "\u201c"], [0x94, "\u201d"], [0x95, "\u2022"], [0x96, "\u2013"], [0x97, "\u2014"],
  [0x98, "\u02dc"], [0x99, "\u2122"], [0x9a, "\u0161"], [0x9b, "\u203a"], [0x9c, "\u0153"],
  [0x9e, "\u017e"], [0x9f, "\u0178"],
]);

const REPLACEMENT = "�";

function characterFor(codePoint: number): string {
  const swapped = WINDOWS_1252.get(codePoint);
  if (swapped !== undefined) return swapped;
  if (codePoint === 0 || codePoint > 0x10ffff) return REPLACEMENT;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return REPLACEMENT;
  return String.fromCodePoint(codePoint);
}

/** The longest run of characters that could be an entity name. */
const MAX_ENTITY_NAME = 32;

/** One character reference at `at` (where `s[at]` is `&`): its text, and where it ends. */
function referenceAt(s: string, at: number): { text: string; next: number } {
  const literal = { text: "&", next: at + 1 };
  if (s[at + 1] === "#") {
    const hex = s[at + 2] === "x" || s[at + 2] === "X";
    const first = at + (hex ? 3 : 2);
    const digit = hex ? /[0-9a-fA-F]/ : /[0-9]/;
    let end = first;
    while (end < s.length && digit.test(s[end] ?? "")) end++;
    if (end === first) return literal;
    /* A run long enough to overflow is a code point nobody meant; the parser's
       out-of-range rule catches it, so there is no length cap here. */
    return {
      text: characterFor(Number.parseInt(s.slice(first, end), hex ? 16 : 10)),
      next: s[end] === ";" ? end + 1 : end,
    };
  }
  let end = at + 1;
  while (end < s.length && end - at <= MAX_ENTITY_NAME && isAsciiAlnum(s[end])) end++;
  /* Longest match first, so `&notin;` is not `&not` followed by `in;`. */
  for (let stop = end; stop > at + 1; stop--) {
    const name = s.slice(at + 1, stop);
    const value = ENTITIES[name];
    if (value === undefined) continue;
    if (s[stop] === ";") return { text: value, next: stop + 1 };
    if (LEGACY_NO_SEMICOLON.has(name)) return { text: value, next: stop };
  }
  return literal;
}

/** Character references decoded, everything else left alone. */
function decodeEntities(s: string): string {
  let at = s.indexOf("&");
  if (at < 0) return s;
  let out = "";
  let from = 0;
  while (at >= 0) {
    out += s.slice(from, at);
    const { text, next } = referenceAt(s, at);
    out += text;
    from = next;
    at = s.indexOf("&", from);
  }
  return out + s.slice(from);
}

/**
 * The index just past a tag's `>`, starting from the end of its name.
 *
 * The whole point of the function: a quote is only a quote where an attribute
 * value can start, so `<p title="x > y">` ends at the second `>` and
 * `<a href=/x?a=b'c>` — an unquoted value with an apostrophe in it — ends at
 * the only one it has.
 */
function endOfTag(html: string, from: number): number {
  let at = from;
  while (at < html.length) {
    const c = html[at];
    if (c === ">") return at + 1;
    if (c === "=") {
      let value = at + 1;
      while (value < html.length && isSpace(html[value])) value++;
      const quote = html[value];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, value + 1);
        at = close < 0 ? html.length : close + 1;
      } else {
        at = value;
      }
      continue;
    }
    at++;
  }
  return html.length;
}

/** A tag name is everything up to whitespace, `/` or `>` — hyphens included. */
function nameEnd(html: string, from: number): number {
  let at = from;
  while (at < html.length) {
    const c = html[at];
    if (c === ">" || c === "/" || isSpace(c)) break;
    at++;
  }
  return at;
}

/** Where `</name` closes, per the tokenizer's rule: name, then space, `/` or `>`. */
function findCloser(html: string, from: number, name: string): { content: number; next: number } {
  let at = from;
  while (at < html.length) {
    const found = html.indexOf("</", at);
    if (found < 0) break;
    const after = found + 2 + name.length;
    const boundary = html[after];
    if (
      html.slice(found + 2, after).toLowerCase() === name &&
      (boundary === ">" || boundary === "/" || isSpace(boundary))
    ) {
      return { content: found, next: endOfTag(html, after) };
    }
    at = found + 2;
  }
  return { content: html.length, next: html.length };
}

/** Past the matching close of a dropped element whose contents are markup. */
function skipNested(html: string, from: number, name: string): number {
  let at = from;
  let depth = 1;
  while (at < html.length) {
    const found = html.indexOf("<", at);
    if (found < 0) break;
    if (html.startsWith("<!--", found)) {
      at = endOfComment(html, found);
      continue;
    }
    const closing = html[found + 1] === "/";
    const start = found + (closing ? 2 : 1);
    if (!isAsciiAlpha(html[start])) {
      at = found + 1;
      continue;
    }
    const stop = nameEnd(html, start);
    const past = endOfTag(html, stop);
    if (html.slice(start, stop).toLowerCase() === name) {
      depth += closing ? -1 : 1;
      if (depth === 0) return past;
    }
    at = past;
  }
  return html.length;
}

/** Past a comment's `-->`, including the two degenerate forms `<!-->` and `<!--->`. */
function endOfComment(html: string, at: number): number {
  const body = at + 4;
  if (html[body] === ">") return body + 1;
  if (html.startsWith("->", body)) return body + 2;
  const plain = html.indexOf("-->", body);
  const bang = html.indexOf("--!>", body);
  if (plain < 0 && bang < 0) return html.length;
  if (plain >= 0 && (bang < 0 || plain <= bang)) return plain + 3;
  return bang + 4;
}

/** A start tag: what it contributes, and where the scanner resumes. */
function startTag(html: string, at: number, out: string[]): number {
  const stop = nameEnd(html, at + 1);
  const name = html.slice(at + 1, stop).toLowerCase();
  const past = endOfTag(html, stop);
  if (RAW_TEXT.has(name)) return findCloser(html, past, name).next;
  if (DROPPED.has(name)) return skipNested(html, past, name);
  if (ESCAPABLE_RAW_TEXT.has(name)) {
    const { content, next } = findCloser(html, past, name);
    out.push(` ${decodeEntities(html.slice(past, content))} `);
    return next;
  }
  out.push(INLINE.has(name) ? "" : " ");
  return past;
}

/** Everything that starts with `<`, dispatched. Returns where to resume. */
function markup(html: string, at: number, out: string[]): number {
  const next = html[at + 1];
  if (isAsciiAlpha(next)) return startTag(html, at, out);
  if (next === "/") {
    if (!isAsciiAlpha(html[at + 2])) return endOfTag(html, at + 2);
    const stop = nameEnd(html, at + 2);
    const name = html.slice(at + 2, stop).toLowerCase();
    const past = endOfTag(html, stop);
    /* A close the scanner did not consume as part of its element — the
       `</script>` left over by a script whose source contained one. It closed
       nothing, so it separates nothing. */
    const silent = INLINE.has(name) || DROPPED.has(name) || ESCAPABLE_RAW_TEXT.has(name);
    out.push(silent ? "" : " ");
    return past;
  }
  if (next === "!") {
    if (html.startsWith("<!--", at)) return endOfComment(html, at);
    if (html.startsWith("<![CDATA[", at)) {
      const close = html.indexOf("]]>", at + 9);
      return close < 0 ? html.length : close + 3;
    }
    return endOfTag(html, at + 2);
  }
  if (next === "?") return endOfTag(html, at + 2);
  /* `a < b`: nothing a tag can start with, so it is what it looks like. */
  out.push("<");
  return at + 1;
}

/**
 * The page's visible text, whitespace collapsed and trimmed.
 *
 * Deliberately looser than the scorer's matching: `scorecard.mts` matches a
 * needle carrying its own indentation literally against the code blocks, so it
 * can tell a preserved `<pre>` from a collapsed one. This asks only whether a
 * string is on the page at all.
 */
export function visibleText(html: string): string {
  const out: string[] = [];
  let at = 0;
  while (at < html.length) {
    const found = html.indexOf("<", at);
    if (found < 0) {
      out.push(decodeEntities(html.slice(at)));
      break;
    }
    if (found > at) out.push(decodeEntities(html.slice(at, found)));
    at = markup(html, found, out);
  }
  return out.join("").replace(/\s+/g, " ").trim();
}
