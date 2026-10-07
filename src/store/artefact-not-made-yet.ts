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
 * Thrown by sixteen loaders in src/store/pg.ts. **"Not made" is each loader's
 * own test**, and for several it is wider than an empty column: `loadFaq`,
 * `loadSimpleSummary`, `loadDebate`, `loadRelations` and `loadSkim` throw this
 * for a stored document they cannot use, and `loadSketch` and
 * `loadIllustrated` for one with nothing in it.
 *
 * ## Which reads answer `200 null`, and which do not yet
 *
 * **This is the one list; the other places that used to carry a copy point
 * here.** (There were three copies, each naming five reads when there were
 * six: Illustrated was missing from all of them.)
 *
 * - **Ten routes answer the header**: `loadQuiz`, `loadCrossrefs` and
 *   `loadCitations`, and since plan 261006h `loadSimpleSummary`, `loadIdeas`,
 *   `loadFaq`, `loadTimeline`, `loadDebate`, `loadGlossary` and `loadQuotes`.
 * - **Six do not, and answer a 404 whatever the client sends**: `loadTweets`,
 *   `loadRelations`, `loadSkim`, `loadSketch`, `loadIllustrated` and `loadArc`.
 *   Their loaders have thrown this class since 2026-10-07; their routes do not
 *   call `orNullWhenNotMadeYet`. Nothing written anywhere says they should
 *   stay 404s. What is left for each is two edits **that must land together**:
 *   the helper at its route, and its name in `NONE_YET_AS_NULL`
 *   (src/web/lib/api.ts), so the offline cache does not keep the `null`.
 *   tests/api-fetch-offline.test.ts fails when one is done without the other,
 *   and tests/none-yet-is-not-a-404-route.test.ts § `STILL_404` pins the six
 *   as they are.
 *
 * docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md,
 * docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md,
 * docs/plans/261007c-seventh-sweep-small-server-request-path-defects-and-dead-branches.md.
 */
export class ArtefactNotMadeYet extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "ArtefactNotMadeYet";
  }
}
