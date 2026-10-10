/**
 * **The article is there, and this artefact has not been made for it.**
 *
 * A type, not merely `status: 404`, because a loader has two 404s and they are
 * different facts: `notFound(slug)` is "no such article" (or not yours), and
 * this is "nobody has run that step yet" — the ordinary state of any step off
 * `DEFAULT_INGEST_STEPS`. Only this one may be answered as "none yet":
 * `orNullWhenNotMadeYet` in src/routes.ts turns it into `200 null` for a client
 * that asks, and chat reads its citations subclass as "no list"
 * (src/store/bibliography-list-not-found.ts).
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
 * ## Which reads answer `200 null`
 *
 * **This is the one list; the other places that used to carry a copy point
 * here.**
 *
 * **All sixteen routes answer the header**: `loadQuiz`, `loadCrossrefs` and
 * `loadBibliography` first (plan 261006g); `loadSimpleSummary`, `loadIdeas`,
 * `loadFaq`, `loadTimeline`, `loadDebate`, `loadGlossary` and `loadQuotes`
 * (plan 261006h); and `loadTweets`, `loadRelations`, `loadSkim`, `loadSketch`,
 * `loadIllustrated` and `loadArc` (plan 261007n). Without the header each is
 * still a 404, for a tab opened before the deploy.
 *
 * A new artefact read is two edits **that must land together**: the helper at
 * its route, and its name in `NONE_YET_AS_NULL` (src/web/lib/api.ts), so the
 * offline cache does not keep the `null`. tests/api-fetch-offline.test.ts
 * fails when one is done without the other. Illustrated's plate route
 * (`/api/illustrated/:slug/:hash.:ext`) is not a read of this kind: it serves
 * bytes, and a missing artefact there is a missing plate.
 *
 * docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md,
 * docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md,
 * docs/plans/261007d-seventh-sweep-small-server-request-path-defects-and-dead-branches.md,
 * docs/plans/261007n-the-last-six-artefact-reads-answer-none-yet-as-200-null.md.
 */
export class ArtefactNotMadeYet extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "ArtefactNotMadeYet";
  }
}
