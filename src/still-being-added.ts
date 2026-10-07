/**
 * **`StillBeingAdded`: a shared address was opened before its article was
 * published, and an import for it is queued or running.** Plan
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md § 2c.
 *
 * Thrown from one place, `pgPublicReader.loadArticle`
 * (src/store/public-reader.ts), for an article the request may read (public, or
 * opened with its private link's key) that has no published revision yet and
 * has a pending job. Every other public read, and every request that may not
 * read the article, keeps the absent article's 404.
 *
 * **A 409, with a code and nothing else.** `status` makes it an answer rather
 * than a fault in every layer that asks (`scrubbed` in the public reader,
 * src/routes.ts's catch). The route's catch reads this one declared class onto
 * the wire as exactly `{ error, code: "still-being-added" }` (`declaredFields`);
 * a `code` on the class alone would not cross.
 *
 * **It takes no arguments on purpose.** The sentence is fixed
 * (`STILL_BEING_ADDED_REFUSAL`, src/messages.ts) and there is no field to put a title,
 * a slug, an owner or a job's progress in, so nothing about the article can
 * ride out on it by accident.
 *
 * A leaf module: it imports the sentence and nothing else, so the public
 * reader can throw it and the route can recognise it without either reaching
 * the owner, a store or a writer (tests/public-imports.test.ts).
 */
import { STILL_BEING_ADDED_REFUSAL } from "./messages.js";

export class StillBeingAdded extends Error {
  readonly status = 409;
  readonly code = "still-being-added";

  constructor() {
    super(STILL_BEING_ADDED_REFUSAL.message);
    this.name = "StillBeingAdded";
  }
}
