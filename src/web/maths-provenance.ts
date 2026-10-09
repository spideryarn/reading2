/**
 * **Which blocks had maths drawn into them in this browser** — the provenance
 * `src/web/maths.ts` writes and the anchor resolvers read.
 *
 * Its own module, importing nothing, because its readers are not the renderer's
 * readers. `search-hits.ts` and `TableView.tsx` need only to ask whether a
 * block's offsets can still be trusted (F2, F13); importing `maths.ts` for that
 * pulled in the sanitiser, whose module scope calls `DOMPurify(window)`, so
 * `search-hits.ts` could no longer be loaded anywhere without a window —
 * `tests/quotes-marked-in-every-mode.test.ts` found it. The renderer writes the
 * mark; everyone else only reads it, and reading should cost nothing.
 *
 * A symbol rather than a class in the html (F14): a class can be forged by the
 * article's own markup, and a symbol cannot arrive in article JSON or authored
 * html. It is enumerable, so the object spreads `rehostImages` uses carry it
 * into both later draws; it never serialises or changes the stored `Block`.
 *
 * **Its value is the block as it was before, and the renderer that drew it**
 * (since 2026-10-09). An excerpt of the block — a quote in Skim, a passage in
 * Ideas — is found in the words the model saw, TeX and all, and then drawn
 * with the same renderer (src/web/excerpt-html.ts, plan 261009k). Only a type is
 * imported, so reading the mark still loads nothing.
 */

import type { RenderTex } from "../maths-tex.js";

/** What `RENDERED_MATHS` holds: the block's html before its maths was drawn, and what drew it. */
export interface MathsSource {
  /** Already through the article policy — `sanitizeArticle` ran first. */
  html: string;
  render: RenderTex;
}

/** The mark itself. Written only by `renderArticleMaths` in src/web/maths.ts. */
export const RENDERED_MATHS: unique symbol = Symbol("spideryarn-rendered-maths");

/**
 * **Did this block have maths drawn into it here?** — which is to say, is an
 * offset recorded against its source still to be believed (F2).
 */
export function rendersMaths(block: object): boolean {
  return RENDERED_MATHS in block;
}

/** The block before its maths was drawn, or `null` for one that had none drawn here. */
export function mathsSource(block: object): MathsSource | null {
  return (block as { [RENDERED_MATHS]?: MathsSource })[RENDERED_MATHS] ?? null;
}
