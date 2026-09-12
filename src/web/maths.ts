/**
 * **TeX in the prose, drawn as maths** — in the browser, once, as the article
 * arrives.
 *
 * > Importing this file worked ok, but all the equations and formulae are being
 * > displayed as raw latex. Can we somehow render them them to display them
 * > nicely within the text?
 * >
 * > — Greg, 2026-09-12 (SPIDERYARN-READING2-30)
 *
 * docs/project/maths.md says what renders and what does not;
 * docs/plans/260912d-render-latex-equations-in-the-reading-view.md has the
 * reasoning and GPT Sol's review, whose findings (F2–F6, F8, F10) are cited
 * below where each one decided a line.
 *
 * ## Where it runs, and why there
 *
 * In `resolveAccess` (article/access.ts), **after** `sanitizeArticle` and
 * before `rehostImages` — the doorway and the shape `rehostBlockHtml` already
 * has. At ingress rather than in an effect over the painted prose because the
 * offset space comments are anchored in is `renderedText(block.html)`
 * (annotate.ts § Why the offsets are DOM offsets): `renderedText`,
 * `annotateHtml` and the live DOM must all read the same html, and they do only
 * if the maths is already in it when they first look.
 *
 * ## Why the output goes through the sanitiser again
 *
 * temml's markup is written after the pass the reading view relies on, so it
 * goes back through **the same policy** before anything parses it, and then the
 * new-tab rule is put back on, because that pass strips the `target` the rule
 * wrote (F3; external-links.ts § What makes it safe). Nothing is allowed that
 * was not already allowed: MathML is kept on purpose (src/sanitize-policy.ts §
 * The default profile keeps SVG and MathML), and the pass strips temml's inline
 * `style`s — which is why its stylesheet is loaded with it (F4).
 *
 * ## What a formula may not do
 *
 *  - **mint an `id` or a link** (F6). `\label` is not trust-gated, and with
 *    `\tag` temml writes an HTML `id` — `x\label{spya-aaaaaa}\tag{1}` would
 *    forge a block id (docs/project/block-ids.md). `\ref`/`\eqref` write an
 *    `<a href>`. A fragment carrying `id`, `name`, `href` or `xlink:href`, or
 *    that is not exactly one `<math>`, is refused and its source stays.
 *    Cross-references between separately rendered spans could not work anyway;
 *  - **grow without bound** (F5) — see `MAX_SIZE_EM` and its neighbours.
 *
 * ## What it costs a comment
 *
 * A formula's symbols are shorter than its source, so an offset recorded
 * before the render no longer points at the same place. In a block that
 * rendered maths the offset may not choose between repeats of a quote (F2):
 * `rendersMaths` says which blocks, and `resolveMark`'s `offsetTrusted` is what
 * TableView.tsx passes. A mark disappears rather than moving to the wrong
 * words, which is annotate.ts's rule.
 *
 * ## Nothing is downloaded for an article without maths
 *
 * The scan is string work over text nodes. temml, its stylesheet and its one
 * font are a dynamic `import()` taken only when a block has a span, and a load
 * that fails leaves the TeX as it was — the state before this file existed, so
 * not an error and nothing in the console.
 */

import type { Options as TemmlOptions } from "temml";
import type { Article, Block } from "../types.js";
import { openExternalLinksInNewTab } from "./external-links.js";
import { sanitizeBlockHtml } from "./sanitize.js";

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
 * A function passed in rather than temml called directly, so the DOM half is
 * pure and synchronous and a test can pin it without the library.
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
 * Every option temml is called with.
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

/**
 * **The class every formula we drew carries**, and the one `rendersMaths`
 * looks for.
 *
 * A publisher could write it into their own MathML. The cost of that is their
 * block's comments losing the offset as a tie-breaker, which is the safe
 * direction, so it is not reserved in the sanitiser.
 */
export const MATHS_CLASS = "rendered-maths";

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
 * Exported so a test can build the real renderer from a statically imported
 * temml; the reading view reaches it only through `loadTemml`.
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

/**
 * temml's code, its stylesheet and — through the stylesheet — its font, in one
 * lazy load.
 *
 * **The stylesheet is required, not optional** (F4): it makes display maths
 * `display: block` in Safari and Firefox, which Chromium does from the inline
 * `style` the policy strips, and carries temml's WebKit corrections.
 */
async function loadTemml(): Promise<RenderTex> {
  const [{ default: temml }] = await Promise.all([
    import("temml"),
    import("temml/dist/Temml-Local.css"),
  ]);
  return temmlRenderer(temml);
}

/** Text inside these is never maths of ours: code, an existing formula, a script. */
const SKIP = "code, pre, kbd, samp, math, svg, script, style, textarea";

/**
 * The cheap gate before the parser, for the reason `mightNeedRehosting` gives:
 * most blocks of most articles have no backslash-paren, backslash-bracket or
 * dollar in them at all, and must not reach `innerHTML`.
 */
const MIGHT_HAVE_MATHS = /\\[([]|\$/;

/**
 * An inert document to parse into, made once and reused — rehost.ts §
 * `inertHolder`, for the same reasons. Nothing loads while html sits in it.
 */
let holder: HTMLElement | null = null;

function inertHolder(): HTMLElement {
  if (!holder) holder = document.implementation.createHTMLDocument("").createElement("div");
  return holder;
}

/** Every text node a formula may be found in: not under anything in `SKIP`. */
function candidateTextNodes(root: HTMLElement): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest(SKIP)) found.push(n as Text);
  }
  return found;
}

/** Does any text node of this block hold a span? The scan, without the render. */
function blockHasMaths(html: string): boolean {
  if (!MIGHT_HAVE_MATHS.test(html)) return false;
  const root = inertHolder();
  root.innerHTML = html;
  const found = candidateTextNodes(root).some((n) => findMathSpans(n.data).length > 0);
  root.textContent = "";
  return found;
}

const MATHML = "http://www.w3.org/1998/Math/MathML";

/** Attributes that address something: a formula carrying one is refused (F6). */
const ADDRESSES = new Set(["id", "name", "href"]);

/**
 * The one `<math>` element `markup` holds, marked as ours — or `null`, and the
 * span keeps its source.
 *
 * Parsed in a `<template>` of the inert document, so the check reads the tree
 * the reading view will get rather than the string temml wrote.
 */
function mathElement(markup: string | null, doc: Document): Element | null {
  if (markup === null) return null;
  const template = doc.createElement("template");
  template.innerHTML = markup;
  const content = template.content;
  const math = content.firstElementChild;
  if (content.childNodes.length !== 1 || !math) return null;
  if (math.localName !== "math" || math.namespaceURI !== MATHML) return null;
  for (const el of [math, ...math.querySelectorAll("*")]) {
    for (const attr of el.attributes) {
      if (ADDRESSES.has(attr.localName) || attr.name === "xlink:href") return null;
    }
  }
  math.classList.add(MATHS_CLASS);
  return math;
}

/**
 * One block's html with every span that renders replaced by its `<math>`, or
 * the **same string** when nothing did.
 *
 * Only text nodes are replaced: every element, attribute and `data-spya-*` id
 * outside them serialises exactly as it came in. Returning the input itself is
 * what lets `renderArticleMaths` hand React the very same block object.
 */
export function renderBlockMaths(html: string, render: RenderTex): string {
  if (!MIGHT_HAVE_MATHS.test(html)) return html;
  const root = inertHolder();
  root.innerHTML = html;
  const doc = root.ownerDocument;
  let changed = false;

  for (const node of candidateTextNodes(root)) {
    const value = node.data;
    const pieces = doc.createDocumentFragment();
    let at = 0;
    for (const span of findMathSpans(value)) {
      const math = mathElement(render(span.tex, span.display), doc);
      if (!math) continue;
      if (span.start > at) pieces.append(value.slice(at, span.start));
      pieces.append(math);
      at = span.end;
    }
    if (at === 0) continue;
    if (at < value.length) pieces.append(value.slice(at));
    node.replaceWith(pieces);
    changed = true;
  }

  const out = changed ? root.innerHTML : html;
  root.textContent = ""; // don't hold an article's DOM alive between loads
  return out;
}

/** A formula of ours: a `<math>` whose class list carries `MATHS_CLASS`. */
const OURS = new RegExp(`<math\\b[^>]*\\sclass="[^"]*\\b${MATHS_CLASS}\\b`);

/**
 * **Did this block's html have maths drawn into it here?** — which is to say,
 * is an offset recorded against its source still to be believed (F2).
 *
 * Read off the html rather than kept in a set of blocks, because a block object
 * does not survive the trip: `rehostImages` spreads a block into a new object
 * when it puts a picture in, and the html goes with it where a membership would
 * not.
 */
export function rendersMaths(html: string): boolean {
  return html.includes(MATHS_CLASS) && OURS.test(html);
}

/**
 * The article with its maths drawn, or the **same article** when there was none
 * or temml would not load.
 *
 * Every block is scanned before anything is fetched, so an article without a
 * span never downloads temml. Each changed block goes through the policy again
 * and then gets its new-tab links back (F3); every other block keeps its
 * identity.
 */
export async function renderArticleMaths(
  article: Article,
  opts: { load?: () => Promise<RenderTex>; signal?: AbortSignal } = {},
): Promise<Article> {
  const { load = loadTemml, signal } = opts;
  const withMaths = new Set<Block>(article.blocks.filter((b) => blockHasMaths(b.html)));
  if (withMaths.size === 0 || signal?.aborted) return article;

  let render: RenderTex;
  try {
    render = await load();
  } catch {
    return article;
  }
  if (signal?.aborted) return article;

  let changed = false;
  const blocks = article.blocks.map((b) => {
    if (!withMaths.has(b)) return b;
    const rendered = renderBlockMaths(b.html, render);
    if (rendered === b.html) return b;
    changed = true;
    return { ...b, html: openExternalLinksInNewTab(sanitizeBlockHtml(rendered)) };
  });
  return changed ? { ...article, blocks } : article;
}
