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
 * **This is the DOM half.** Which text is a formula, the limits, the options
 * temml is called with and the string form of the acceptance rule are in
 * src/maths-tex.ts, shared with the server — which has to agree with what this
 * file draws, because a comment on a selection across a formula quotes its
 * symbols (src/quote-in-block.ts).
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
 *  - **grow without bound** (F5) — src/maths-tex.ts § `MAX_SIZE_EM`.
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

import { findMathSpans, MATHS_SKIP_TAGS, temmlRenderer, type RenderTex } from "../maths-tex.js";
import type { Article, Block } from "../types.js";
import { openExternalLinksInNewTab } from "./external-links.js";
import { sanitizeBlockHtml } from "./sanitize.js";

/* The provenance mark this module writes onto a block it drew maths into, and
   the one question anybody else asks of it — in a module of their own, so a
   reader of the mark does not load the sanitiser (maths-provenance.ts says
   why). Re-exported so the renderer's tests keep one import. */
import { RENDERED_MATHS } from "./maths-provenance.js";
export { rendersMaths } from "./maths-provenance.js";

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
const SKIP = MATHS_SKIP_TAGS.join(", ");

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
 * the reading view will get rather than the string temml wrote. The server
 * reads the same rule off the string (src/maths-tex.ts § `acceptsMarkup`), and
 * tests/maths-parity.test.ts is what says the two agree.
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
    return {
      ...b,
      html: openExternalLinksInNewTab(sanitizeBlockHtml(rendered)),
      [RENDERED_MATHS]: true,
    };
  });
  return changed ? { ...article, blocks } : article;
}
