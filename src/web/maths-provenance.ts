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
 */

/** The mark itself. Written only by `renderArticleMaths` in src/web/maths.ts. */
export const RENDERED_MATHS: unique symbol = Symbol("spideryarn-rendered-maths");

/**
 * **Did this block have maths drawn into it here?** — which is to say, is an
 * offset recorded against its source still to be believed (F2).
 */
export function rendersMaths(block: object): boolean {
  return RENDERED_MATHS in block;
}
