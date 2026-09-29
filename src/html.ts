/**
 * **Turning somebody else's text into markup, in one place.**
 *
 * A handful of functions and no imports. Everything here is about the moment a string we
 * did not write becomes part of a document we did: the extracted `<title>` of a
 * page, a caption a model produced, the gist that will be a `<meta>` tag on a
 * shared link. [security-map.md](../docs/project/security-map.md) counts the
 * article's own content and the model's output as two of the four untrusted
 * parties, and both of them arrive here.
 *
 * Dependency-free on purpose. This is imported by the pipeline, by the client
 * and — from stage 2 — by a serverless function whose whole job is to compose a
 * `<head>` before the bundle loads. A module that escapes HTML should not be
 * able to pull anything in behind it.
 * docs/plans/260827ai-public-read-only-access.md § Stage 2.
 */

/**
 * The five characters, and the reason it is five rather than three.
 *
 * `&`, `<` and `>` are the ones that look like markup. `"` and `'` are the ones
 * that hold an attribute together, and an attribute is where most of this text
 * is going — `content="…"` on every `<meta>` tag in a document head. Escaping
 * three of five gives a string that is safe in text and an injection point in
 * an attribute, which is the worse of the two failures because it reads as done.
 *
 * `&` must be handled by the same pass as the rest and not by a chain of
 * `.replace()` calls: replacing `&` first and `<` afterwards is correct, and
 * replacing them the other way around double-escapes every entity it produces.
 * One regex with one lookup table cannot be got into that order at all.
 *
 * **This was two private copies that had already drifted.** `src/extract.ts`
 * escaped all five; `src/pdf-read.ts` escaped four, missing `'`. Nobody chose
 * that — it is what happens to a four-line helper written twice.
 */
const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for either an element body or a double- or single-quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/**
 * Characters that change what a string *means* without being visible in it.
 *
 * The bidirectional overrides and isolates: LRE, RLE, PDF, LRO, **RLO**, and
 * the newer isolate family LRI/RLI/FSI/PDI, plus the invisible ALM. `RLO` is
 * the interesting one — it reverses display order, so `A‮gnp.exe` shows as
 * `A exe.png`, which is the oldest filename trick there is and works just as
 * well on a link preview as on a download.
 *
 * **Not a strip of right-to-left text.** Arabic and Hebrew letters carry their
 * own direction and are not in this set; an article titled in Arabic keeps
 * every character it had. What goes is the set of invisible instructions about
 * how to render other characters, which no legitimate title needs and which
 * survive HTML escaping untouched — they are not markup, so escaping has
 * nothing to say about them.
 */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * Everything that is a line break, a tab, or a control code, as one class.
 *
 * C0 (`\u0000`–`\u001f`) and C1 (`\u007f`–`\u009f`). CR, LF and tab are in
 * there by construction, which is deliberate: a `<meta content="…">` is a
 * single line, and a title containing a newline is not dangerous so much as
 * simply wrong — it renders as a space in some readers, as nothing in others,
 * and is a different string from the one anybody compared it against.
 */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * **Steps 1-3 on their own: one line, single spaces, no bidi overrides.**
 *
 * Split out of `headText` so that the clamp is a separate decision from the
 * cleaning, because the two sinks want the same cleaning and different clamps.
 * `headText` clamps hard and adds nothing, which is right for an `og:title`; the
 * page title clamps at a word boundary and adds an ellipsis, which is right for
 * a tab. Before this was one function, the browser tab was normalised by the
 * server and then *un*-normalised the moment React mounted and set
 * `document.title` from its own, looser copy of the rule — a title with a double
 * space or an RLO in it visibly changed. src/title-text.ts is where both callers
 * now get the composition from; this is the piece of it that belongs next to the
 * escaper.
 *
 * **Not "nothing invisible", which an earlier draft of this line claimed.** It
 * removes the bidi controls and the C0/C1 range, and collapses what JavaScript's
 * `\s` considers whitespace — which covers NBSP and the ideographic space but
 * **not** U+200B ZERO WIDTH SPACE or U+2060 WORD JOINER, which survive intact.
 * They are harmless in a title and a strip of them is a separate decision from
 * this one; the claim was simply wider than the code. GPT Sol, 2026-08-30.
 */
export function normaliseText(value: string): string {
  return value.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
}

/**
 * **Make a piece of somebody's text fit to be metadata**, before it is escaped.
 *
 * Escaping is not enough and the two jobs are genuinely separate. Escaping
 * makes `</title>` harmless; it does nothing about a title with a newline in
 * it, an invisible direction change, or fifty thousand characters. Those are
 * not injection — they are a string that is unsuitable, and a `<head>` composed
 * from them is broken rather than exploited.
 *
 * The order matters and is not arbitrary:
 *
 * 1. **Bidi controls go first**, before whitespace collapsing, so that a run of
 *    them separated by spaces cannot be reassembled by the collapse.
 * 2. **Controls become spaces** rather than being deleted, because `A\nB` is
 *    two words and `AB` is one. Deleting the break silently joins them.
 * 3. **Collapse and trim**, so the result is one line with single spaces.
 * 4. **Clamp last**, and by **code point**, not by `.length`. `"𝕏".length` is
 *    2 — a UTF-16 artefact — and slicing a string at a `.length` offset can cut
 *    an astral character in half and produce a lone surrogate, which is not
 *    valid text and which `JSON.stringify` and the network will each mangle
 *    differently. `[...value]` iterates code points. The same reasoning as
 *    `charCount` in src/tweets.ts.
 *
 * Escaping happens **after** this and exactly once, at the point the string
 * becomes markup — not here, so that a caller who needs the clean text for
 * something other than HTML gets the clean text.
 *
 * @param limit maximum length in code points; the caller's, because the three
 *   sinks disagree — a page title is clamped at 64, an `og:title` at 120, a
 *   description at 240.
 */
export function headText(value: string, limit: number): string {
  const cleaned = normaliseText(value);
  const points = [...cleaned];
  if (points.length <= limit) return cleaned;
  /* Trimmed again after slicing: the cut can land immediately after a space,
     and a metadata string ending in one is a string that will not compare equal
     to the obvious expectation of it. No ellipsis — this is metadata, and a
     `…` in an `og:title` is a claim that the title contained one. */
  return points.slice(0, limit).join("").trimEnd();
}

/**
 * **A title that came from outside us, as plain text.** The rule: an outside
 * title is stored as text, never as markup —
 * docs/plans/260929e-outside-titles-become-plain-text-at-ingest.md.
 *
 * Search results, `og:title`, PDF metadata and Crossref-style records carry
 * inline markup (`<i>Drosophila</i>`, `H<sub>2</sub>O`, `<jats:italic>`,
 * MathML) and entities. Every surface in this app draws a title as text, which
 * is safe and shows the tags literally. So the decision is made once, where
 * the title is written, and every sink downstream — the tab, `og:title`, a
 * hover card, export, a prompt — gets text without having to know.
 *
 * Three steps, in an order that matters:
 *
 * 1. **Decode entities once**, so a title encoded once (`&lt;i&gt;`) and one
 *    already decoded (`<i>`) end up the same. Numeric references are all
 *    decoded; the named ones are a **short table** of what turns up in titles
 *    (punctuation, a few symbols, Greek), not the HTML standard's two
 *    thousand, and a name not in it — `&eacute;`, say — is left as written
 *    rather than guessed at. Our sources mostly hand titles over already
 *    decoded, so this is for the leftovers. One pass, so a doubly-encoded
 *    `&amp;lt;` becomes `&lt;` — which makes that the one input a second call
 *    would still change. The function is not idempotent on it, and nothing
 *    here claims otherwise.
 * 2. **Remove tags whose name is on a list**, not everything tag-shaped:
 *    `Why x<y and y>z` is a title, not markup. A namespace prefix (`mml:`,
 *    `jats:`) is ignored. Removed rather than replaced by a space, so
 *    `H<sub>2</sub>O` reads `H2O`; `<br>` is the exception. The TeX copies
 *    MathML and JATS carry beside the maths (`annotation`, `tex-math`) go
 *    *with their content*, or the formula would be printed twice. Repeated
 *    until nothing changes (at most eight times), so `<i<i>>` cannot leave
 *    an `<i>` behind.
 * 3. **`normaliseText` last**, so a bidi override that step 1 produced from
 *    `&#x202E;` is dropped like any other.
 *
 * **This is not a sanitiser and must never be used as one.** Its output is
 * text: `<scr<i>ipt>` comes out as the literal string `<script>`, which is
 * harmless in a text node and would be an injection anywhere else. Anything
 * that puts it into markup escapes it first, exactly as it would any other
 * string.
 */
export function plainTitle(value: string): string {
  let out = value.replace(ENTITY, decodeEntity);
  /* Bounded, so a title built to nest a thousand deep costs eight passes and
     no more. Real titles settle in one. */
  for (let pass = 0, previous = ""; pass < 8 && previous !== out; pass++) {
    previous = out;
    out = removeMarkupWithContent(out).replace(LINE_BREAK, " ").replace(INLINE_TAG, "");
  }
  return normaliseText(out);
}

const INLINE_TAGS = [
  /* HTML inline */
  "i", "b", "em", "strong", "u", "s", "sub", "sup", "small", "big", "span", "font",
  "sc", "scp", "tt", "code", "cite", "q", "dfn", "var", "mark", "abbr", "a", "wbr",
  /* MathML */
  "math", "mi", "mo", "mn", "ms", "mtext", "mrow", "msub", "msup", "msubsup", "mfrac",
  "msqrt", "mroot", "mover", "munder", "munderover", "mstyle", "mspace", "semantics",
  "mfenced", "mpadded", "mphantom", "menclose",
  /* JATS, which is what Crossref's titles are written in */
  "italic", "bold", "underline", "monospace", "inline-formula", "alternatives",
];
/* An optional namespace prefix, then the name, then either the end of the tag
   or whitespace before attributes — so `<i>` matches and `<if>` does not. */
const NAME = (names: readonly string[]) => `(?:[a-z][\\w.-]*:)?(?:${names.join("|")})`;
const INLINE_TAG = new RegExp(`<\\/?${NAME(INLINE_TAGS)}(?:\\s[^<>]*)?\\/?>`, "gi");
const LINE_BREAK = new RegExp(`<${NAME(["br"])}(?:\\s[^<>]*)?\\/?>`, "gi");
const CONTENT_TAG = new RegExp(
  `<(\\/?)(${NAME(["annotation", "annotation-xml", "tex-math"])})(?:\\s[^<>]*)?>`,
  "gi",
);

/**
 * Remove paired TeX-copy elements, including everything between their tags.
 *
 * A lazy `.*?` from every opening tag to a back-referenced close looks compact,
 * but an input made only of unclosed `<annotation>` tags makes the engine scan
 * the rest of the string once per tag: quadratic work on an outside string.
 * This pass visits each recognised tag once, records paired ranges, then removes
 * their union. Unpaired tags stay literal, as they did before.
 */
function removeMarkupWithContent(value: string): string {
  const opens = new Map<string, number[]>();
  const ranges: [number, number][] = [];
  CONTENT_TAG.lastIndex = 0;
  for (let match = CONTENT_TAG.exec(value); match !== null; match = CONTENT_TAG.exec(value)) {
    const closing = match[1] === "/";
    const name = (match[2] as string).toLowerCase();
    if (!closing) {
      const starts = opens.get(name) ?? [];
      starts.push(match.index);
      opens.set(name, starts);
      continue;
    }
    const starts = opens.get(name);
    const start = starts?.pop();
    if (start !== undefined) ranges.push([start, CONTENT_TAG.lastIndex]);
  }
  if (ranges.length === 0) return value;

  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let keptThrough = 0;
  for (const [start, end] of ranges) {
    if (end <= keptThrough) continue;
    if (start > keptThrough) out += value.slice(keptThrough, start);
    keptThrough = end;
  }
  return out + value.slice(keptThrough);
}

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;
const NAMED: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", hellip: "…", middot: "·", bull: "•", times: "×", divide: "÷",
  minus: "−", plusmn: "±", deg: "°", prime: "′", Prime: "″", copy: "©", reg: "®", trade: "™",
  shy: "­", thinsp: " ", ensp: " ", emsp: " ",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", lambda: "λ", mu: "μ",
  pi: "π", sigma: "σ", tau: "τ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  le: "≤", ge: "≥", ne: "≠", asymp: "≈", infin: "∞", rarr: "→", larr: "←", harr: "↔",
};
/* HTML's numeric-reference compatibility table. Old pages still spell an em
   dash as `&#151;`; interpreting that as the C1 control U+0097 and then letting
   `normaliseText` remove it loses the character rather than decoding it. */
const NUMERIC_REPLACEMENTS = new Map<number, number>([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026],
  [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160],
  [0x8b, 0x2039], [0x8c, 0x0152], [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019],
  [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
  [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a], [0x9c, 0x0153],
  [0x9e, 0x017e], [0x9f, 0x0178],
]);

function decodeEntity(whole: string, dec?: string, hex?: string, name?: string): string {
  if (name !== undefined) return NAMED[name] ?? whole;
  const point = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? "", 16);
  const valid = point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff);
  return valid ? String.fromCodePoint(NUMERIC_REPLACEMENTS.get(point) ?? point) : whole;
}
