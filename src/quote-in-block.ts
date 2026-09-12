/**
 * **Is this quote really in that block?** — the one answer both anchor checks in
 * src/routes.ts give: a comment being created, and a chat being anchored.
 *
 * The quote comes from a DOM selection, so it is in the reader's offset space:
 * the text the browser renders. `block.text` is the extractor's. The two have
 * always differed by whitespace, which is why both sides are folded. Since the
 * reading view started drawing delimited TeX as MathML (src/web/maths.ts), they
 * also differ wherever there is a formula: the reader selects its **symbols**,
 * and `block.text` still holds its **TeX**. A selection across an equation — the
 * thing a reader most wants to ask about in a maths paper — was refused with a
 * 400 until 2026-09-12 (fb30, stage 1b).
 *
 * ## Two forms, either accepted
 *
 * The source form first, and it is the whole of the check for every block
 * without a delimited span, so every other article behaves exactly as it did.
 * Only when that fails **and** the block has a span is the rendered form
 * computed. The block's html is walked one text node at a time, with the same
 * excluded elements as the browser; each node goes through `renderedMathsText`
 * in src/maths-tex.ts, with the same bounded temml and acceptance rule. That
 * per-node boundary matters: one formula can render while another whose
 * delimiters straddle `<em>` stays source. Either whole-block form is accepted
 * deliberately, including that mixed form.
 *
 * ## temml, only when needed
 *
 * The rendered form needs temml, and temml is kept off the API's cold start: it
 * is a dynamic `import()` here, taken only in the slow path, so a request that
 * never meets a formula never loads it.
 * tests/cold-start-lazy-imports.test.ts pins that, and
 * tests/pdf-bundle-trace.test.ts pins that the function still ships it.
 *
 * ## The offset, beside it
 *
 * `start` is bounded by the block's length, and a rendered offset can in
 * principle run past the *source* length — a formula's symbols are nearly
 * always fewer than its TeX, but a user macro (`\def\a{xxxxxxxxxx}\a\a\a`)
 * expands to more characters than it costs. So in the slow path the bound is
 * the longer of the two. On the fast path nothing changes.
 */

import { log } from "./log.js";
import {
  findMathSpans,
  MATHS_SKIP_TAGS,
  renderedMathsText,
  temmlRenderer,
  type RenderTex,
} from "./maths-tex.js";
import { jsdom } from "./jsdom-lazy.js";
import type { Block } from "./types.js";

/**
 * Collapse runs of whitespace, for comparing a selection against a block.
 *
 * **One of these, used by both anchor checks** — moved here from src/routes.ts
 * with them. A quote comes from a DOM selection and `block.text` comes from the
 * extractor, and the two disagree about runs of whitespace — see the note in
 * src/blocks.ts. `checkAnchor` once had its own copy of this line; two copies
 * of a normaliser is how a chat anchor and a comment anchor end up disagreeing
 * about the same passage.
 */
export const foldSpace = (t: string): string => t.replace(/\s+/g, " ").trim();

/** What the checks need to know: fine, an offset past the end, or not there at all. */
export type QuotePlacement = "ok" | "past-end" | "not-found";

/**
 * Where `anchor` stands against `block`'s source or rendered text.
 *
 * `"past-end"` is answered before `"not-found"`, which is the order both route
 * checks already reported in. `load` is injectable so a test can count whether
 * the slow path was taken.
 */
export async function placeQuoteInBlock(
  block: Pick<Block, "text" | "html">,
  anchor: { quote: string; start: number },
  load: () => Promise<RenderTex> = loadTemmlOnServer,
): Promise<QuotePlacement> {
  const blockText = block.text;
  const source = foldSpace(blockText);
  const quote = foldSpace(anchor.quote);
  const fitsSource = anchor.start <= blockText.length;
  if (fitsSource && source.includes(quote)) return "ok";

  /* No span, no second form: the verdict is the one this check always gave. */
  if (findMathSpans(blockText).length === 0) return fitsSource ? "not-found" : "past-end";

  let render: RenderTex;
  try {
    render = await load();
  } catch (err) {
    /* A temml that will not load leaves the source form as the only one we
       can check, which is the check as it was before the rendered form existed
       — a refusal the reader can retry, not a 500. Said in the log, because it
       is the one way this path can be wrong without anybody seeing it. */
    log("http").warn(
      { err: err instanceof Error ? err.message : String(err) },
      "temml did not load; a quote was checked against the block's source only",
    );
    return fitsSource ? "not-found" : "past-end";
  }

  const rendered = renderedBlockMathsText(block.html, render);
  if (anchor.start > Math.max(blockText.length, rendered.length)) return "past-end";
  return source.includes(quote) || foldSpace(rendered).includes(quote) ? "ok" : "not-found";
}

/** Elements whose text the browser renderer deliberately leaves as source. */
const SKIP_MATHS_IN = new Set<string>(MATHS_SKIP_TAGS);

/**
 * `block.html` as the browser sees it after drawing eligible formulae.
 *
 * Parsing is confined to the already-slow path, after temml has loaded. Walking
 * text nodes is load-bearing: the browser scans each text node separately, so
 * a delimiter split by `<em>` stays source while another complete formula in
 * the same block may render. Reconstructing from `block.text` cannot represent
 * that mixed form and was both accepting unseen symbols and refusing real
 * selections across the two formulae.
 */
function renderedBlockMathsText(html: string, render: RenderTex): string {
  const root = jsdom().JSDOM.fragment(html);
  const texts: Text[] = [];
  const visit = (node: Node, skipped: boolean): void => {
    const element = node.nodeType === node.ELEMENT_NODE ? (node as Element) : null;
    /* `localName`, not `tagName`: HTML elements report uppercase tag names in
       jsdom, while SVG and MathML report lowercase. The browser's `closest`
       selector is namespace-agnostic here, so normalising the local name is
       how this walk gives the same answer for all three namespaces. */
    const nextSkipped =
      skipped || (element !== null && SKIP_MATHS_IN.has(element.localName.toLowerCase()));
    if (node.nodeType === node.TEXT_NODE) {
      if (!nextSkipped) texts.push(node as Text);
      return;
    }
    for (const child of node.childNodes) visit(child, nextSkipped);
  };
  visit(root, false);
  for (const text of texts) text.data = renderedMathsText(text.data, render);
  return root.textContent ?? "";
}

/** temml for the server, loaded on first use. See the header's second section. */
async function loadTemmlOnServer(): Promise<RenderTex> {
  const { default: temml } = await import("temml");
  return temmlRenderer(temml);
}
