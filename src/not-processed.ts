/**
 * **`NotProcessed` — a minimal paper asked for something that needs the whole
 * article.** Plan docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md
 * § The thin article: *everything else fails closed*.
 *
 * `loadArticle` (src/store/pg.ts) throws it, with the `paper`, for an article
 * whose `processing = 'minimal'`, where it used to throw a 404 for the same row
 * (there is no tree) — so chat, live, comments, citations, term lookup,
 * similar, projection, link previews and every other caller refuses before it
 * spends. `enqueue`, `enqueueReset` (src/jobs.ts) and the High-powered AI route
 * throw it, without one, for work that would read the article.
 *
 * **A 409, with a body.** `status` makes it an answer rather than a fault in
 * every layer that asks (src/store/db-errors.ts § `mayPassThrough`,
 * src/routes.ts's catch), and the message is a coded sentence
 * (`[np-…]`, src/messages.ts) so a stream's `sayToReader` passes it through
 * too. The route's catch reads this one declared class and its declared fields
 * onto the wire as `{ error, code: "not-processed", paper? }` — never the
 * error's own enumerable properties. The reading view draws the not-yet-read
 * page from `paper` without a second request.
 *
 * A leaf module, so the store can throw it without importing the routes.
 */
import type { UnreadPaper } from "./types.js";

export class NotProcessed extends Error {
  readonly status = 409;
  readonly code = "not-processed";

  constructor(
    message: string,
    readonly paper?: UnreadPaper,
  ) {
    super(message);
    this.name = "NotProcessed";
  }
}
