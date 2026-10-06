/**
 * **The article is there, and this artefact has not been made for it.**
 *
 * A type, not merely `status: 404`, because a loader has two 404s and they are
 * different facts: `notFound(slug)` is "no such article" (or not yours), and
 * this is "nobody has run that step yet" — the ordinary state of any step off
 * `DEFAULT_INGEST_STEPS`. Only this one may be answered as "none yet":
 * `orNullWhenNotMadeYet` in src/routes.ts turns it into `200 null` for a client
 * that asks, and chat reads its citations subclass as "no list"
 * (src/store/citations-list-not-found.ts).
 *
 * It still carries `status: 404`, so a caller that does not look at the class
 * sees exactly what it saw before, and so that `guardDbStore` lets it through
 * untranslated (src/store/db-errors.ts § Six things pass, the first).
 *
 * Thrown by `loadQuiz`, `loadCrossrefs` and `loadCitations` in src/store/pg.ts.
 * The other loaders still throw a plain error for the same fact; moving one
 * over is this class at its throw and the helper at its route.
 * docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md.
 */
export class ArtefactNotMadeYet extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "ArtefactNotMadeYet";
  }
}
