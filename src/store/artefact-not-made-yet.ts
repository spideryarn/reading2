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
 * Thrown by ten loaders in src/store/pg.ts: `loadQuiz`, `loadCrossrefs` and
 * `loadCitations`, and since plan 261006h `loadSimpleSummary`, `loadIdeas`,
 * `loadFaq`, `loadTimeline`, `loadDebate`, `loadGlossary` and `loadQuotes`.
 * **"Not made" is each loader's own test**, and for three it is wider than an
 * empty column: `loadFaq`, `loadSimpleSummary` and `loadDebate` throw this for
 * a stored document they cannot use as well.
 *
 * The loaders for tweets, relations, Skim, Sketch and Arc still throw a plain
 * error for the same fact; moving one over is this class at its throw, the
 * helper at its route and its name in `NONE_YET_AS_NULL` (src/web/lib/api.ts).
 * docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md,
 * docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md.
 */
export class ArtefactNotMadeYet extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "ArtefactNotMadeYet";
  }
}
