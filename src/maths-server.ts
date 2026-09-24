/**
 * **"Would the reading view draw this TeX?", asked on the server, synchronously.**
 *
 * Delimited TeX in block text is the canonical form importers write
 * (docs/project/maths.md), and two importers write it: the PDF transcriber,
 * whose check must not accept a span the reading view would leave raw
 * (src/pdf-tex.ts), and the HTML extractor, which converts a page's formula
 * only when it would draw at least as well as what the page had
 * (src/maths-import.ts). Both ask stage 1's own bounded renderer and acceptance
 * rule (src/maths-tex.ts), so the answer is the reader's answer.
 *
 * **temml is loaded lazily, and only by `loadMathsRenderer()`** — a literal
 * `await import("temml")`, which @vercel/nft follows into the API function
 * (the seam `loadTemmlOnServer` in src/quote-in-block.ts already uses).
 * Everything that asks is synchronous — a scorer, a DOM pass — so **every
 * caller loads it first**: the two stages at their top (`runPdfExtract`,
 * `runExtract`), and every test, eval and script that reaches the check
 * without a stage, in a `beforeAll` or at the top of the module.
 *
 * **Until it is loaded, every answer is `false`**, on purpose. There used to be
 * a synchronous `createRequire` fallback. It was never traced into the built
 * function (measured 2026-09-24), so it only ever worked where it did not
 * matter, and the env sweep refuses a non-literal `require`
 * (tests/env-reads-are-literal.test.ts). Without it, a stage that forgot the
 * load refuses every formula in tests exactly as it would in production — which
 * is what tests/pdf-tex-stage-loads-temml.test.ts and
 * tests/maths-import-stage-loads-temml.test.ts catch.
 *
 * Never statically imported: the API's cold start stays free of temml
 * (tests/cold-start-lazy-imports.test.ts).
 */

import { acceptsMarkup, type RenderTex, temmlRenderer } from "./maths-tex.js";

let renderTex: RenderTex | undefined;

/** Load temml the way the built function can trace. Call at the top of a stage. */
export async function loadMathsRenderer(): Promise<void> {
  if (renderTex !== undefined) return;
  try {
    const { default: temml } = await import("temml");
    renderTex = temmlRenderer(temml);
  } catch {
    /* Left unset: `texWouldDraw` then refuses every formula. */
  }
}

/**
 * **True only if the reading view would draw `tex` as one visible formula** —
 * temml parses it within the bounds, and the markup passes `acceptsMarkup`.
 *
 * Before `loadMathsRenderer()` has succeeded, every answer is `false`: the PDF
 * check then calls the span markup (a retry and a quality note), and the HTML
 * extractor leaves the page's own formula in place. Loud in effect, never an
 * outage.
 */
export function texWouldDraw(tex: string, display: boolean): boolean {
  if (renderTex === undefined) return false;
  const markup = renderTex(tex, display);
  return markup !== null && acceptsMarkup(markup);
}
