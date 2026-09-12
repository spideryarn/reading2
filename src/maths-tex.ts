/**
 * **The DOM-free half of TeX → maths**, shared by the browser and the server.
 *
 * The browser (src/web/maths.ts) draws delimited TeX in an article as MathML at
 * ingress. The server (src/quote-in-block.ts) has to agree with what the reader
 * then sees: a comment or a chat anchored on a selection across a formula
 * arrives quoting the formula's *symbols*, while `block.text` holds its *TeX*,
 * and the route checks refused it until 2026-09-12 (fb30, stage 1b). Both sides
 * find spans with the same `findMathSpans`, render with the same
 * `temmlRenderer`, and accept a render by the same rule — so there is one copy
 * of each decision, and `tests/maths-parity.test.ts` proves the server's string
 * reading of that rule agrees with the browser's DOM reading of it.
 *
 * **Nothing here may touch `window` or `document`** — the server imports it, on
 * the route every comment goes through. And **temml is never imported here**:
 * each side loads it lazily for itself (the browser with its stylesheet; the
 * server only in the slow path), so neither side's first paint or cold start
 * pays for it. The `import type` below is erased at build time.
 *
 * docs/project/maths.md is the what; this file's comments are the why.
 */

import type { Options as TemmlOptions } from "temml";

/** One delimited formula in a string, delimiters included in `start`–`end`. */
export interface MathSpan {
  start: number;
  /** Exclusive. */
  end: number;
  /** The TeX between the delimiters. */
  tex: string;
  display: boolean;
}

/**
 * TeX → one `<math>` element's markup, or `null` for *leave the source*.
 *
 * A function passed in rather than temml called directly, so everything that
 * uses it is pure and synchronous and a test can pin it without the library.
 */
export type RenderTex = (tex: string, display: boolean) => string | null;

/** The one thing used from temml, so a test can hand in the real module. */
export interface TemmlLike {
  renderToString(tex: string, options: TemmlOptions): string;
}

/**
 * **The longest span we will hand temml**, in characters of source.
 *
 * The longest displayed equation in the Newman et al. paper behind the report
 * is well under this; `tests/maths.test.ts` renders a 761-character six-row
 * `aligned` derivation of the same kind. 4,000 is five times that, and a span
 * longer than it is far likelier to be two formulas with a delimiter missing
 * between them than one formula. It also caps what the size limits below can
 * multiply: at about sixteen characters per `\rule{10em}{10em}`, a span can
 * draw a few hundred bounded boxes, which is what plain HTML can do with a few
 * hundred `<br>`s.
 */
export const MAX_TEX_CHARS = 4000;

/**
 * **The largest dimension a formula may write**, in em and in pt.
 *
 * temml's default is infinity, and `\rule{1000000em}{1000000em}` then becomes a
 * million-em box the policy lets through (F5). Real papers space with `\quad`
 * (1em), `\qquad` (2em), `\hspace{1cm}` (28pt) and `\vspace{2ex}`; 10em and
 * 100pt are five times the largest of those, and a 10em box is well under half
 * a phone-width column.
 *
 * **temml clamps to these rather than refusing**, so a huge `\rule` draws a
 * box of the ceiling's size, not the source. That is the bound F5 asked for;
 * refusing instead would mean second-guessing temml's arithmetic after the
 * fact, for input no real paper contains.
 */
export const MAX_SIZE_EM = 10;
export const MAX_SIZE_PT = 100;

/**
 * **How many macro expansions one span may take.** temml's default is 1,000.
 *
 * Measured with temml 0.13.5: the 761-character `aligned` derivation above
 * needs 7, and a 291-character `pmatrix` with `\cdots` and `\vdots` needs 21 —
 * about 0.07 per character, so 400 covers a span of `MAX_TEX_CHARS` that dense
 * with room over. Below the default on purpose: nine `\def` doublings (512
 * copies) need 511 and are refused here, where the default would draw them.
 */
export const MAX_EXPAND = 400;

/**
 * Every option temml is called with, on both sides.
 *
 * `throwOnError`, so a span temml cannot parse throws and stays source rather
 * than being drawn in red. `trust: false`, so `\href`, `\url`, `\style`,
 * `\class`, `\id` and `\data` throw too. `strict: false`, so nothing is written
 * to the console. `annotate` stays off: it would put the TeX source into the
 * formula's text, and so into the offset space a comment is anchored in.
 */
const TEMML_OPTIONS = {
  throwOnError: true,
  trust: false,
  strict: false,
  maxSize: [MAX_SIZE_EM, MAX_SIZE_PT],
  maxExpand: MAX_EXPAND,
} satisfies TemmlOptions;

/** A `$…$` body that is unmistakably TeX: a control word, a brace or a script. */
const TEX_SIGNAL = /\\[A-Za-z]|[{}^_]/;

/**
 * Every delimited formula in `text`, left to right, never overlapping.
 *
 * `\[…\]` and `$$…$$` are display; `\(…\)` is inline. **`$…$` is inline only
 * under pandoc's rules** — the opening `$` followed by a non-space, the first
 * unescaped `$` after it closing, preceded by a non-space and not followed by
 * a digit — **and only with a TeX signal inside** (F8). Pandoc's rules alone
 * read *"Set $x=$y"* and *"$PATH/$HOME"* as maths and temml parses both; the
 * signal is what keeps a shell variable and a price as prose, at the cost of a
 * bare `$x$` being missed on purpose.
 *
 * `\$` is never a delimiter, and a backslash escapes whatever follows it. An
 * unclosed or empty span is prose.
 */
export function findMathSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const span = spanAt(text, i);
    if (span) {
      spans.push(span);
      i = span.end;
    } else {
      /* A backslash escapes the character after it — so `\$` is prose and the
         `$` is not looked at again — and an unmatched `$$` is passed over whole
         rather than re-read as a single `$`. */
      i += text[i] === "\\" || text.startsWith("$$", i) ? 2 : 1;
    }
  }
  return spans;
}

/** The span that opens at `i`, if one does. */
function spanAt(text: string, i: number): MathSpan | null {
  if (text[i] === "\\") {
    const next = text[i + 1];
    if (next !== "(" && next !== "[") return null;
    return enclosed(text, i, next === "(" ? "\\)" : "\\]", next === "[");
  }
  if (text.startsWith("$$", i)) return enclosed(text, i, "$$", true);
  if (text[i] !== "$") return null;
  const end = closingDollar(text, i);
  const tex = end === -1 ? "" : text.slice(i + 1, end);
  return TEX_SIGNAL.test(tex) ? { start: i, end: end + 1, tex, display: false } : null;
}

/** A two-character opener at `i`, closed by `close`, with something in between. */
function enclosed(text: string, i: number, close: string, display: boolean): MathSpan | null {
  const end = text.indexOf(close, i + 2);
  if (end === -1) return null;
  const tex = text.slice(i + 2, end);
  return tex.trim() === "" ? null : { start: i, end: end + close.length, tex, display };
}

/**
 * Where the `$` opened at `open` closes, by pandoc's rule, or -1.
 *
 * **The first unescaped `$` is the only candidate.** If it fails — a space
 * before it, a digit after it — there is no span, rather than a search on for
 * a later one: *"$5 and $10"* must not become a formula that swallows the
 * sentence up to some third dollar.
 */
function closingDollar(text: string, open: number): number {
  const first = text[open + 1];
  if (first === undefined || /\s/.test(first)) return -1;
  for (let j = open + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] !== "$") continue;
    const before = text[j - 1] ?? "";
    const after = text[j + 1] ?? "";
    return /\s/.test(before) || /[0-9]/.test(after) ? -1 : j;
  }
  return -1;
}

/**
 * temml, bounded. A span over `MAX_TEX_CHARS`, or one temml refuses, is `null`.
 *
 * Each side hands in the temml it loaded for itself; see the header.
 */
export function temmlRenderer(temml: TemmlLike): RenderTex {
  return (tex, display) => {
    if (tex.length > MAX_TEX_CHARS) return null;
    try {
      return temml.renderToString(tex, { ...TEMML_OPTIONS, displayMode: display });
    } catch {
      return null;
    }
  };
}

/** Any start tag that carries an attribute naming or pointing at something. */
const ADDRESSING = /<[A-Za-z][^>]*?\s(?:id|name|href|xlink:href)\s*=/i;

/**
 * **Would the browser draw this markup?** — the string reading of the rule
 * `mathElement` in src/web/maths.ts reads off the DOM: exactly one root
 * `<math>`, and no element anywhere carrying `id`, `name`, `href` or
 * `xlink:href` (F6 — `\label` with `\tag` writes an `id` that could forge a
 * block id, and `\ref`/`\eqref` write a link, which is also not a `<math>`).
 *
 * A string rule rather than a parser, because the server has no DOM on this
 * path and must not load jsdom for a comment. It can be that simple because it
 * only ever reads **temml's** output, which escapes `<`, `>` and quotes inside
 * text and attribute values alike — so a tag cannot hide in text, and an
 * attribute cannot hide in a value. tests/maths-parity.test.ts is what says the
 * two readings agree, case for case, including every hostile one.
 */
export function acceptsMarkup(markup: string): boolean {
  if (!markup.startsWith("<math") || !/^<math[\s>]/.test(markup)) return false;
  if (!markup.endsWith("</math>")) return false;
  if (markup.split("<math").length !== 2 || markup.split("</math>").length !== 2) return false;
  return !ADDRESSING.test(markup);
}

/** The five escapes temml writes, plus the numeric forms. */
const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/gi;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * The text a browser gives temml's markup — its `textContent`: every tag
 * dropped and every escape decoded, and nothing else. MathML draws spacing from
 * attributes rather than from characters, so there is no whitespace to invent.
 */
function markupText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, "")
    .replace(ENTITY, (_m, hex?: string, dec?: string, named?: string) =>
      hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : NAMED[named!.toLowerCase()]!,
    );
}

/**
 * **`text` as the reader sees it once its maths is drawn**: every span the
 * browser would render replaced by that formula's text, and every other span
 * left as its source.
 *
 * The same `findMathSpans`, the same bounded renderer (the caller hands it in)
 * and the same acceptance rule as the reading view, so a quote a reader
 * selects across a formula is found here. Pure and synchronous; the server's
 * caller is src/quote-in-block.ts, and tests/maths-parity.test.ts compares this
 * with `renderedText` of the html the client drew, character for character.
 */
export function renderedMathsText(text: string, render: RenderTex): string {
  let out = "";
  let at = 0;
  for (const span of findMathSpans(text)) {
    const markup = render(span.tex, span.display);
    if (markup === null || !acceptsMarkup(markup)) continue;
    out += text.slice(at, span.start) + markupText(markup);
    at = span.end;
  }
  return out + text.slice(at);
}
