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
 * **temml is loaded lazily, and the load the bundle can see is the async one.**
 * Everything that asks is synchronous — a scorer, a DOM pass — so the stages
 * call `loadMathsRenderer()` first, a literal `await import("temml")` that
 * @vercel/nft follows into the API function (the seam `loadTemmlOnServer` in
 * src/quote-in-block.ts already uses). The synchronous fallback,
 * `createRequire(import.meta.url)("temml")`, serves callers that are not a
 * stage — tests, evals, a CLI — and is **not** traced into the built function
 * (measured 2026-09-24). A stage that forgot the load would pass every test and,
 * in production, refuse every formula. tests/pdf-tex-stage-loads-temml.test.ts
 * and tests/maths-import-stage-loads-temml.test.ts are what say both stages load it.
 *
 * Never statically imported: the API's cold start stays free of temml
 * (tests/cold-start-lazy-imports.test.ts).
 */

import { createRequire } from "node:module";
import { acceptsMarkup, type RenderTex, type TemmlLike, temmlRenderer } from "./maths-tex.js";

const requireFromHere = createRequire(import.meta.url);
let renderTex: RenderTex | undefined;

/** Load temml the way the built function can trace. Call at the top of a stage. */
export async function loadMathsRenderer(): Promise<void> {
  if (renderTex !== undefined) return;
  try {
    const { default: temml } = await import("temml");
    renderTex = temmlRenderer(temml);
  } catch {
    /* Left unset: `texWouldDraw` tries its own fallback, and then refuses. */
  }
}

/**
 * **True only if the reading view would draw `tex` as one visible formula** —
 * temml parses it within the bounds, and the markup passes `acceptsMarkup`.
 *
 * With no temml at all, every answer is `false`: the PDF check then calls the
 * span markup (a retry and a quality note), and the HTML extractor leaves the
 * page's own formula in place. Loud in effect, never an outage.
 */
export function texWouldDraw(tex: string, display: boolean): boolean {
  if (renderTex === undefined) {
    try {
      renderTex = temmlRenderer(requireFromHere("temml") as TemmlLike);
    } catch {
      renderTex = () => null;
    }
  }
  const markup = renderTex(tex, display);
  return markup !== null && acceptsMarkup(markup);
}
