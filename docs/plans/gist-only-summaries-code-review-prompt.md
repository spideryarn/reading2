# Code review: the summary length ladder is gone

Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`. **Built and committed as `cc2b67d`.**

You reviewed the plan (`docs/plans/gist-only-summaries.md`) and returned NO-SHIP with findings that
were all correct. Your review is at `docs/plans/gist-only-summaries-review-sol.md` and the plan has
been updated to record what changed because of it. **This is the second review, of the code**, and it
matters more than the first: a plan-stage review cannot see a `PATCH` that writes one field and then
rejects the request.

**The scoped diff (source, tests and scripts only):**
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/0ab3c628-ed65-40fb-a99a-5099773b6997/scratchpad/gist-only.diff`

**Scope warning, and it is large.** Two other sessions are working in this tree and their hunks are
unavoidably in that commit. **Ignore everything to do with:** the `timeline` stage (a new step, a new
column, `docs/project/timeline.md`), live conversation in chat (`src/live.ts`, `src/web/live/*`,
`MicPlacement`, `.chat-live-btn`, `tests/live-*`), and the files→Postgres stage conversion (stages
taking `article: Article` instead of `dir: string`, `src/article-input.ts`, `blocksPath`/`htmlFile`
call sites, `LEGACY_UNCONVERTED_STEPS`). The tree is currently red for those reasons and none of them
is under review.

## What was done, so you can check it rather than rediscover it

**Stage 5e deleted.** `src/summarise.ts`, the `summary` step in `src/pipeline.ts`, the `summary`
artefact kind everywhere in `src/store/`, `GET /api/summary/:slug`, `loadSummaries`,
`src/web/useSummaries.ts`, `Summaries`/`SummaryEntry`/`SummariesResponse`/`SummariesFound`,
`PublicSummaries`, the `summarise` task in `src/models.ts` and `src/ai-call.ts`, and
`data/writes/summary.json` from `GATE_FIXTURES` (your finding — the deploy gate would have failed).

**Summary mode kept**, drawing the stage-4 gists at a Depth cut-off. `buildSummaryTree` lost its
`summaries` argument, `rungText` is gone, `SummaryPanel` lost `access`, the Length fieldset, the run
button, the profile tick, the stale strip and the `missing` line.

**A visitor now gets the mode free.** It was an `ARTEFACT` mode in `visitorGap`; it now returns
`null` beside `hierarchy` and `outline`. `/api/summary/` is out of the cache allowlist in
`src/web/lib/api.ts`.

**The root's `+N parts` badge became a control** (Greg's other ask), flipping to `−N parts`. Its
collapse calls `clearOverride`, which clears `opened` and deliberately does **not** write the root
into `closed` — a shut root would outlive the Depth buttons.

**`article_revisions.summary` is retained**, typed `unknown`, `REVISION_READ_POLICY.summary = {}`,
`REVISION_CARRY_POLICY.summary = "carry"`. **The file stops travelling**: `summary` is not an
artefact kind, so `copyArtefacts` cannot carry it, and I therefore removed it from both
`src/store/export.ts` and `src/store/import.ts` rather than leaving a one-way path. The
`revision_step_runs_step` CHECK still permits `'summary'`, with a `RETIRED` list in
`tests/db-step-constraint.test.ts`.

## What I want from you

1. **Is anything left half-removed?** A read that still projects the column, a type that still
   describes it, a code path that would now write `null` over it, a message or a route that still
   promises it.
2. **The retained column.** Is `$type<unknown>()` on the drizzle column safe here, and does the
   `carry` policy plus the empty read policy actually hold the bytes across `beginDraftIn` and
   `publishRevision`? `tests/store-carry-forward.test.ts` asserts `toEqual(RETIRED_SUMMARY)` on the
   draft — is that assertion reachable, and does it prove what it claims?
3. **Was dropping import/export of `summary.json` right**, given the column is kept? Say so if you
   think the one-way export was the better call.
4. **The visitor change.** `visitorGap("summary", …)` now returns `null` unconditionally. Is there
   any payload shape where summary mode renders nothing and says nothing?
5. **The root badge.** Can a reader reach a state where the outline is empty and no control brings it
   back? Walk `showsChildren`, `closed`, `opened` and `clearOverride` together.
6. **Tests that no longer test anything.** I rewrote or deleted a lot. Name any that now pass
   vacuously — particularly `tests/supplement.test.ts` (the stored-summary join was deleted and two
   characterisation tests replaced it) and `tests/public-network-trace.test.tsx` (the summary
   assertion was inverted from "draws the artefact" to "draws the gists with no artefact").

Be concrete, cite file:line, and say NO-SHIP if anything is broken or half-done.
