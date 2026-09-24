/**
 * **How the PDF path reads maths the transcriber wrote as TeX.**
 *
 * Since 2026-09-24 the transcription prompt asks for maths between `\(…\)` and
 * `\[…\]` (src/pdf-read.ts § `SYSTEM`, rule 8), which stage 1 draws as MathML
 * in the reading view (src/maths-tex.ts). Every check in the PDF path compares
 * the transcription with the PDF's own text layer, which holds a formula's
 * printed operands — not `\frac`. So those checks read a recognised span as the
 * words it prints (`mathsAsText`), and anything that is not a recognised span
 * stays text, where the markup check still catches it.
 *
 * Its own module, and pure, because three files need the same answer:
 * src/pdf-score.ts (the scorer), src/pdf-integrity.ts (the page-presence floor)
 * and src/pdf-read.ts (dedup, the bibliography rule, the title) — and the
 * scorer already imports the integrity module, so neither could hold it.
 * docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md.
 */

import { createRequire } from "node:module";
import {
  acceptsMarkup,
  MAX_TEX_CHARS,
  type RenderTex,
  type TemmlLike,
  temmlRenderer,
} from "./maths-tex.js";

const requireFromHere = createRequire(import.meta.url);
let renderTex: RenderTex | undefined;

/**
 * **Load temml for the check, the way the bundle can see** — a literal
 * `await import("temml")`, which @vercel/nft follows into the API function
 * (the same seam as `loadTemmlOnServer` in src/quote-in-block.ts). Called once
 * at the top of `runPdfExtract`, before anything is scored.
 *
 * `recognised` is synchronous, because every check it sits under is. Without
 * this it falls back to `createRequire(import.meta.url)("temml")`, which works
 * wherever `node_modules` does — a test, an eval, the CLI — **and is not traced
 * into the built function**: measured 2026-09-24, `temml.cjs` was absent from
 * the trace. In production that fallback would find nothing, every span would
 * read as markup, and every maths chunk would be asked twice. So the stage
 * loads it here, and the fallback is for callers that are not the stage.
 */
export async function loadPdfMathsRenderer(): Promise<void> {
  if (renderTex !== undefined) return;
  try {
    const { default: temml } = await import("temml");
    renderTex = temmlRenderer(temml);
  } catch {
    /* Left unset: `recognised` tries its own fallback, and then refuses. */
  }
}

/**
 * A balanced `\(…\)` or `\[…\]` — the two delimiters the prompt asks for.
 *
 * **Not `$…$` or `$$…$$`**: the prompt says never to use them, so a dollar span
 * stays text, its control words stay markup, and the chunk is asked again. Nor
 * an opener with no closer, nor TeX with no delimiters at all, which stage 1
 * would leave on the page as source.
 */
const MATHS_SPAN = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/gu;

/**
 * **Every recognised maths span replaced by the words a reader would read off
 * the printed page** — the comparison form, and the reason a formula written as
 * TeX can pass a check written for plain text.
 *
 * The text layer holds a formula's *operands*: `P(x, y) log2` / `P(x|y)` /
 * `P(x) (1)` for equation (1) of the paper behind the report, with a subscript
 * glued to its base (`Yt+1`, `Xp`). The TeX for it is
 * `\log_2 \frac{P(x|y)}{P(x)}`. So, inside a span:
 *
 * - **control words go**, since none is printed — except Greek letters, which
 *   become the letter the text layer holds, and operator names, printed as words;
 * - **a sub- or superscript is glued to its base**, as pdf.js glues it, so
 *   `x_{1}` is `x1` and `\log_2` is `log2`;
 * - **structure is a separator** — braces, `&`, `\\`, `<`, `>`;
 * - **operands, digits and `\text{…}` prose stay as written.**
 *
 * **A span is recognised only if stage 1 does draw it as visible maths** — the
 * allow-list and then stage 1's exact renderer and acceptance rule in
 * `recognised` below. `\phantom{the omitted sentence}` would otherwise count
 * as the sentence while the reader sees nothing, `\hspace{999em}` would hide a
 * number, and `\label` makes stage 1 refuse the whole formula and leave its
 * source on the page (G2 of the plan review). Those spans stay text, and
 * `MARKUP` in src/pdf-score.ts catches their control words as it always has.
 *
 * Text outside a span is returned untouched. What this cannot see is whether a
 * formula is *right* — an inverted fraction, or `\ne` where the page prints
 * `=` (relations print no word, and `fold` drops symbols; H7 of the code review).
 * Neither could the plain-text check it extends; a word-level check never could.
 */
export function mathsAsText(text: string): string {
  return text.replace(MATHS_SPAN, (whole, inline: string | undefined, display: string | undefined) => {
    const tex = inline ?? display ?? "";
    return recognised(tex, display !== undefined) ? ` ${texAsWords(tex)} ` : whole;
  });
}

/**
 * **A string for somewhere that shows text, not maths** — a title, a byline —
 * with each recognised span replaced by what it prints and nothing around it:
 * `The \(p\)-adic numbers` → `The p-adic numbers`, `\(\alpha\) decay` → `α decay`.
 *
 * The reading view draws the heading's TeX as maths; the masthead, the shelf and
 * the browser tab print `meta.title` as a plain string (G6).
 */
export function plainMaths(text: string): string {
  return text.replace(MATHS_SPAN, (whole, inline: string | undefined, display: string | undefined) => {
    const tex = inline ?? display ?? "";
    return recognised(tex, display !== undefined)
      ? texAsWords(tex).replace(/\s+/gu, " ").trim()
      : whole;
  });
}

/** TeX's names for letters the text layer holds as letters. `fold` applies NFKC, so `ϵ` and `ε` agree. */
const GREEK: Readonly<Record<string, string>> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ",
  upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ",
  Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ",
  Omega: "Ω", ell: "ℓ", hbar: "ℏ", imath: "ı", jmath: "ȷ", aleph: "ℵ",
};

/** Control words a page prints as the word itself. */
const OPERATORS = new Set(
  (
    "log ln lg exp sin cos tan sec csc cot sinh cosh tanh coth arcsin arccos arctan max min " +
    "sup inf lim liminf limsup det dim ker arg deg gcd hom Pr mod bmod pmod"
  ).split(" "),
);

/**
 * **Every other control word a recognised span may use**, each of which draws
 * something visible and nothing else: symbols, relations, arrows, delimiters,
 * accents, fractions and roots, fonts, and spacing too small to hide anything.
 *
 * An allow-list rather than a deny-list, because the failure it guards is a span
 * that compares as words while the reader sees something else — invisible
 * (`\phantom`), displaced (`\hspace`, `\raisebox`), refused by stage 1
 * (`\label`, `\href`, a command temml does not know). A deny-list would have to
 * name every one of those, and miss the next. A word missing from here costs
 * one retried chunk and a line in the log, which is the right way round.
 */
const DRAWS_VISIBLY = new Set(
  (
    // fractions, roots, big operators, and what goes around them
    "frac dfrac tfrac cfrac binom dbinom tbinom sqrt sum prod coprod int iint iiint oint " +
    "bigcup bigcap bigoplus bigotimes bigvee bigwedge limits nolimits displaystyle textstyle " +
    "left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr " +
    // fonts and accents
    "text textrm textit textbf textsf texttt mathrm mathit mathbf mathsf mathtt mathcal " +
    "mathbb mathfrak mathscr boldsymbol bm operatorname mathop hat widehat bar overline " +
    "underline tilde widetilde vec dot ddot check breve acute grave overbrace underbrace " +
    "overset underset stackrel " +
    // binary operators and relations
    "cdot times div pm mp ast star circ bullet oplus ominus otimes oslash odot wedge vee " +
    "land lor neg lnot cap cup setminus sqcup sqcap uplus le leq ge geq leqslant geqslant " +
    "ll gg neq ne approx sim simeq cong equiv propto doteq prec preceq succ succeq " +
    "subset subseteq supset supseteq subsetneq supsetneq in notin ni not mid nmid " +
    "parallel perp models vdash dashv colon coloneqq eqqcolon triangleq " +
    // arrows
    "to gets rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow " +
    "longrightarrow longleftarrow Longrightarrow Longleftarrow longleftrightarrow " +
    "Longleftrightarrow mapsto longmapsto implies impliedby iff uparrow downarrow " +
    "Uparrow Downarrow updownarrow nearrow searrow swarrow nwarrow hookrightarrow " +
    "hookleftarrow rightharpoonup leftharpoonup rightleftharpoons " +
    // delimiters
    "langle rangle lfloor rfloor lceil rceil vert Vert lvert rvert lVert rVert backslash " +
    "lbrace rbrace lbrack rbrack " +
    // symbols
    "infty partial nabla forall exists nexists emptyset varnothing prime dagger ddagger " +
    "ldots cdots vdots ddots dots dotsc dotsb dotsm angle triangle Box square top bot " +
    "Re Im wp S P copyright checkmark natural sharp flat therefore because " +
    // spacing no wider than a couple of letters
    "quad qquad " +
    // environments — checked by name in `recognised`
    "begin end"
  ).split(" "),
);

/** Environments that draw rows and columns of visible maths. */
const ENVIRONMENTS = new Set([
  "aligned", "alignedat", "gathered", "split", "array", "matrix", "pmatrix", "bmatrix",
  "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "cases", "dcases", "rcases",
]);

/** The characters after a backslash that are printed as themselves. */
const PRINTED_ESCAPES = new Set(["{", "}", "%", "#", "&", "_", "$"]);

/** Control symbols that are only spacing or a line break, all small or harmless. */
const SPACING_ESCAPES = new Set([",", ";", ":", "!", " ", "\\", "|"]);

/**
 * **Would stage 1 draw this span as visible maths?** Only then is it read as
 * words. Deliberately stricter than temml: every control word on the allow-list
 * (and every environment named), braces balanced, no longer than stage 1 will
 * render, no TeX comment, and no `\text{…}` holding a paragraph. The exact
 * renderer then proves the allowed sequence is valid, not merely made of valid
 * words.
 */
function recognised(tex: string, display: boolean): boolean {
  if (tex.length > MAX_TEX_CHARS) return false;
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "\\") {
      const word = /^\\([A-Za-z]+)/u.exec(tex.slice(i));
      if (word) {
        const name = word[1]!;
        if (!GREEK[name] && !OPERATORS.has(name) && !DRAWS_VISIBLY.has(name)) return false;
        if (name === "begin" || name === "end") {
          const env = /^\{([A-Za-z]+\*?)\}/u.exec(tex.slice(i + word[0].length));
          if (!env || !ENVIRONMENTS.has(env[1]!)) return false;
        }
        i += word[0].length - 1;
        continue;
      }
      const escaped = tex[i + 1] ?? "";
      if (!PRINTED_ESCAPES.has(escaped) && !SPACING_ESCAPES.has(escaped)) return false;
      i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return false;
    /* An unescaped `%` starts a TeX comment. Counting what follows would let a
       model put omitted source after it: the comparison would see the words,
       while the reader would not. `\%` took the escaped branch above. */
    else if (c === "%") return false;
  }
  if (depth !== 0) return false;
  if (hasTextParagraph(tex)) return false;

  /* The allow-list excludes valid-but-invisible commands. It cannot prove that
     the remaining command sequence is valid TeX: a missing `\right`, a one-
     argument `\frac`, or mismatched environments use only allowed words but
     temml refuses the whole span. Ask the exact bounded renderer stage 1 uses.

     Loaded lazily either way — `pdf-tex` is statically reachable from every
     API route through the pipeline, and a static temml import would put the
     renderer on every request's cold start. The stage loads it with
     `loadPdfMathsRenderer`; this synchronous fallback serves every other
     caller, and is not in the built function (see that function). */
  if (renderTex === undefined) {
    try {
      renderTex = temmlRenderer(requireFromHere("temml") as TemmlLike);
    } catch {
      /* A temml that did not ship must not take every PDF import down with it.
         Every span is then unrecognised: its TeX is markup, the chunk is asked
         again and published with a quality note — loud in the log, not an
         outage. tests/pdf-bundle-trace.test.ts is what says it ships. */
      renderTex = () => null;
    }
  }
  const markup = renderTex(tex, display);
  return markup !== null && acceptsMarkup(markup);
}

/**
 * `\text{…}` holding a dozen words or more — a sentence moved into a formula,
 * which the reader would see drawn as a maths object. The prompt keeps prose
 * outside the delimiters; this keeps the check from agreeing when it is not.
 */
const TEXT_COMMANDS = new Set(["text", "textrm", "textit", "textbf", "textsf", "texttt"]);

/** Whether any text command contains twelve whitespace-separated runs, including through nested groups. */
function hasTextParagraph(tex: string): boolean {
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] !== "\\") continue;
    const word = /^\\([A-Za-z]+)/u.exec(tex.slice(i));
    if (!word) {
      i++;
      continue;
    }
    i += word[0].length - 1;
    if (!TEXT_COMMANDS.has(word[1]!)) continue;

    let open = i + 1;
    while (tex[open] === " ") open++;
    if (tex[open] !== "{") continue;
    let depth = 1;
    let close = open + 1;
    for (; close < tex.length && depth > 0; close++) {
      if (tex[close] === "\\") close++;
      else if (tex[close] === "{") depth++;
      else if (tex[close] === "}") depth--;
    }
    const contents = tex.slice(open + 1, close - 1);
    if ((texAsWords(contents).match(/\S+/gu)?.length ?? 0) >= 12) return true;
  }
  return false;
}

/** One recognised TeX formula as the words it prints. See `mathsAsText`. */
function texAsWords(tex: string): string {
  let i = 0;
  let out = "";

  /** At a `{`: its contents, converted, with `i` moved past the matching `}`. */
  const group = (): string => {
    const start = i + 1;
    let depth = 0;
    for (; i < tex.length; i++) {
      if (tex[i] === "\\") i++;
      else if (tex[i] === "{") depth++;
      else if (tex[i] === "}" && --depth === 0) {
        i++;
        return texAsWords(tex.slice(start, i - 1));
      }
    }
    return texAsWords(tex.slice(start));
  };

  /** At a backslash: what the control word or symbol prints, with `i` moved past it. */
  const control = (): string => {
    const word = /^\\([A-Za-z]+)\*?/u.exec(tex.slice(i));
    if (!word) {
      const escaped = tex[i + 1] ?? "";
      i += 2;
      return PRINTED_ESCAPES.has(escaped) ? escaped : " ";
    }
    i += word[0].length;
    const name = word[1]!;
    if (name === "begin" || name === "end") {
      /* The environment's name, its optional vertical position, an array's
         column spec, and alignedat's column-pair count are not printed. */
      while (tex[i] === " ") i++;
      const environment = tex[i] === "{" ? group().trim() : "";
      if (name === "begin") {
        while (tex[i] === " ") i++;
        if (
          tex[i] === "[" &&
          (environment === "aligned" ||
            environment === "alignedat" ||
            environment === "gathered" ||
            environment === "array")
        ) {
          do i++;
          while (i < tex.length && tex[i] !== "]");
          if (tex[i] === "]") i++;
          while (tex[i] === " ") i++;
        }
        if ((environment === "array" || environment === "alignedat") && tex[i] === "{") group();
      }
      return " ";
    }
    /* The dot after `\left`, `\right` or `\middle` is an invisible delimiter,
       not punctuation printed on the page. */
    if ((name === "left" || name === "right" || name === "middle") && tex[i] === ".") i++;
    return ` ${GREEK[name] ?? (OPERATORS.has(name) ? name : "")}`;
  };

  /** One argument of `_` or `^`: a group, a control word, or a single character. */
  const argument = (): string => {
    while (tex[i] === " ") i++;
    if (tex[i] === "{") return group();
    if (tex[i] === "\\") return control();
    return tex[i++] ?? "";
  };

  while (i < tex.length) {
    const c = tex[i]!;
    if (c === "\\") out += control();
    else if (c === "{") out += ` ${group()} `;
    else if (c === "_" || c === "^") {
      i++;
      /* Glued to the base on its left, and ended on its right. */
      out += `${argument().trim()} `;
    } else if (c === "}" || c === "&" || c === "~" || c === "<" || c === ">") {
      i++;
      out += " ";
    } else {
      i++;
      out += c;
    }
  }
  return out;
}
