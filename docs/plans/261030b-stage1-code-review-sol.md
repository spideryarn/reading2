# Sources Digest stage 1 — code review

## Findings

### SD1-01 — P1 — Untrusted bibliography and article text could be the last instruction at their privilege — fixed

Evidence: the reviewed planner ended its user message with the fenced Bibliography, and the reviewed writer's system prompt contained only the fenced article. A hostile cited-work title could therefore be the last user-level instruction before the planner wrote paid search queries, while hostile article text sat at system privilege with no later trusted system text. The corrected boundaries are at `src/sources-digest.ts:464-473`, `src/sources-digest.ts:857-906`, and `src/sources-digest.ts:1335-1346`.

Fixed by:

- appending a trusted task reminder after the planner's fenced Bibliography;
- putting a trusted system block after the writer's fenced article, and moving `PROFILE_RULES` there so the later profile cannot edit its own constraint;
- bumping `PROMPT_VERSION` to `sources-digest/2` (`src/sources-digest.ts:143-152`), so an artefact made with the weaker prompt cannot be called current; and
- adding hostile fence-closing regression cases for both boundaries (`tests/sources-digest.test.ts:376-466`). Both tests were observed failing before the fixes and passing after them.

### SD1-02 — P1 — Publication year was used by the prompts but omitted from freshness — fixed

Evidence: generation derives and sends the code-owned publication year (`src/sources-digest.ts:1128-1132`), but the reviewed `sourceHash` covered only `articleWithIds`. Changing `publishedAt` or `publishedYear` could therefore leave an old digest current even though a new run would give the planner and writer a different year. The same omission existed in the Metadata decider and the owner read.

Fixed by hashing the derived year (not the unused month/day), including the year becoming valid when the calendar reaches a formerly future year (`src/sources-digest.ts:240-277`); widening only Sources Digest's Postgres fingerprint projections and read grants (`src/store/pg.ts:1349-1359`, `src/store/pg.ts:2369-2385`); and using that one reconstruction in both freshness deciders (`src/store/pg.ts:3940-3954`, `src/store/pg.ts:4547-4555`). Unit regressions are at `tests/sources-digest.test.ts:297-317`; the database-backed decider cases are at `tests/freshness-deciders-agree.test.ts:930-950`.

`profileHash` remains aligned between the step stamp and stored artefact. `nothing-found` remains a completed outcome with `read: null`, `write: null`, and is accepted by `phasesOutdated`.

### SD1-03 — P2 — The two main model-output validators exceeded the repository's complexity limit — fixed

Evidence: Biome reported cognitive complexity 32 for `readPlan` and 33 for `checkDigest`, both above the limit of 25. These are security-relevant validation paths, so keeping each check auditable matters.

Fixed by extracting one-lead validation (`src/sources-digest.ts:485-550`) and splitting section and overview validation from the writer's top-level shape check (`src/sources-digest.ts:966-1028`). The same caps, counters, ordering and drop rules remain covered by the existing tests. Biome no longer reports either function.

### SD1-04 — P1 — The OpenAlex citer timeout does not abort the work — not fixed, for you

Evidence: `citersWithin` uses `Promise.race` with a 40-second timer (`src/sources-digest.ts:625-638`), but the citer dependency accepts no `AbortSignal` (`src/sources-digest.ts:1083-1089`). On timeout the digest moves on while `situateCiters` continues in the background; on a reader cancellation, the `Promise.all` at `src/sources-digest.ts:1177-1182` can wait for that timer before noticing the job signal. The shared citation stack also exposes signal-less `fetchJson` and `sleep` seams (`src/citation-index.ts:264-271`, `src/citation-index.ts:793-803`). Individual registry HTTP requests have their own eight-second fetch deadline, but the multi-request workflow and limiter wait do not share the digest's deadline.

Concrete change: add an optional signal through `SourcesDigestDeps.citers`, `situateCiters`, `CitersDeps`, registry lookup/fetch, and limiter sleep; combine the job signal with `CITERS_TIMEOUT_MS`; abort on either; and test that a cancellable stub observes the abort both at 40 seconds and immediately on job cancellation. This crosses the shared citation-index and bibliographic limiter rather than being safely fixable only inside this stage.

## Other review conclusions

- The enforced maxima are 16 leads, two queries per lead, 32 planned queries plus one code-written piece query, 16 readers, eight sources per reader, 6,000 characters per source, six concurrent readers, and four checked quotes per report. The computed ceiling is 695 seconds; the step budget is 700 seconds and the rate lease 780 seconds. The allowance is taken before `generateSourcesDigest` and therefore before the first paid call (`src/pipeline.ts:6685-6712`). Model and web-search calls combine their own deadline with the job signal (`src/sources-digest.ts:352-373` and `src/situate.ts`'s `searchOne`). SD1-04 is the one exception.
- A stored source can be cited only after `quotedIn` finds the reader's words inside that source's own fetched passage (`src/sources-digest.ts:805-820`). Writer source ids are restricted to sources with such a quote; block and sentence ids go through Summary's `toParagraphs` rules (`src/sources-digest.ts:1030-1078`).
- The owner route is authenticated and owner-scoped, there is no public-reader projection, Sources Digest is in `NeverShared`, the export is the owner's export, view-as uses the established read-only admin gate, and feedback carries only the step name. I found no public or cross-owner read path.
- The planner and readers do not receive the profile; the writer alone does. Readers and writer have no tools, and no page-informed follow-up query exists.
- The `situate.ts` refactor preserves Situate's default `situate-search` job/request and the previous quote-matching behaviour; focused Situate tests pass.
- Stage logging contains the slug, code-owned outcomes, counts, timings, models, token counts and profile length only. It does not log article text, queries, URLs, titles, quotes, profile text or model prose.

## Verification

- `npx vitest run --project unit tests/sources-digest.test.ts`: 22 passed after the final fixes.
- Focused unit command covering Sources Digest, Situate, route ownership, sharing, export, job/pipeline registration, feedback, model selection and revision projections: 11 files, 1,058 tests passed.
- `node --experimental-strip-types scripts/typecheck.ts`: all five TypeScript projects passed; all 4,117 source files are covered.
- `npm run typecheck` itself could not start because this sandbox forbids tsx's local IPC socket (`listen EPERM .../tsx-1000/...pipe`); the command above runs the same script without that IPC wrapper.
- `npx biome lint --max-diagnostics=none` on the four touched code/test files exited 0. Its only remaining advisory is the existing large `src/store/pg.ts` `isCurrent` switch (complexity 103).
- `git diff --check`: passed.
- `tests/freshness-deciders-agree.test.ts` could not start its private Postgres lane: the sandbox denied `127.0.0.1:54362` and Docker discovery. No database was touched.

revise
