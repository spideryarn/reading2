# Review: Stage 2c — Safari's "Load failed" at four sites, and handleApi's 5xx JSON catch

Repo: /home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924 (TypeScript, ESM; server in
src/, React client in src/web; vitest). House rules: CLAUDE.md.

## The candidate

Live pre-commit on top of HEAD (2b committed as 39d4d643). **Review only 2c.** Other agents edit OTHER
files in this tree — touch only the files below. Do not commit.

Modified: src/routes.ts (handleApi catch + imports only), src/reader-sentence.ts, src/messages.ts,
src/store/pg-shelf.ts, src/citation-find.ts, src/monitoring-scrub.ts (comment), src/web/useComments.ts,
src/web/useShelf.ts, src/web/jobEngine.ts, src/web/useAdminUsers.ts, src/web/useAdminFeedback.ts,
src/web/useSourceScan.ts, src/web/useClaims.ts, src/web/useSearch.ts, src/web/useCriteria.ts,
src/web/useMirror.ts, src/web/chat/effects.ts, src/web/chat/controller.ts, src/web/lib/reader-facing.ts
(comment), tests/shelf-cached-paint.test.tsx, tests/job-engine-auth-pause.test.ts,
tests/authenticated-api-route-contract.test.ts, tests/owner-isolation.test.ts,
tests/eager-client-graph.test.ts, tests/comments.test.ts, tests/describe-fetch-failure.test.ts,
docs/project/copy.md, docs/project/comments.md, docs/project/web-client.md,
docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md (§ Stage 2c).
Untracked: src/web/lib/describe-failure.ts (describeFetchFailure moved here from useComments.ts).

Start with the plan's § Stage 2c (it has the audit table), then src/web/lib/describe-failure.ts, the four
sites, and the catch at the end of `handleApi` in src/routes.ts.

## What it is meant to do

1. `useShelf`, `jobEngine`, `useAdminUsers`, `useAdminFeedback` no longer match "Failed to fetch" or pass
   any message through: they call `describeFetchFailure`, which recognises a lost connection by
   `apiFetch`'s brand (so Safari's "Load failed" and Firefox's wording work), passes `ReaderFacingError`
   (incl. HttpError) and gives anything else PAGE_FAULT.
2. `handleApi`: from 500 up, only `authoredSentence(err)` (declared or coded) reaches the reader, else
   `UNEXPECTED_FAILURE`; below 500 unchanged. The two deliberate uncoded 5xx sentences were coded.

## What you may change

Only the files above. Fix what is inside the stage red-first; report anything wider. No commits. List
every file you changed.

## Attack it

- Is the audit complete enough? Find a 5xx sentence written for a reader, uncoded, that my grep missed
  (other helper names, classes with `status` getters, `statusCode`, errors re-thrown with a status by
  `guardDbStore`/db-errors.ts, public routes, billing, uploads, embeddings). Each one you find now reads
  as UNEXPECTED_FAILURE.
- Does any of the four sites receive errors that are NOT from apiFetch/readJson (so a real transport
  failure arrives unbranded and becomes PAGE_FAULT)? E.g. jobEngine's injected deps in useJobs, or the
  shelf's cache paths.
- A 401 at the job engine / shelf: still the reader's "session expired" sentence?
- Anything in the client that reads a 5xx body's text and now gets UNEXPECTED_FAILURE (e.g. a
  `kindOfMessage`/`worthRetrying` decision that changes).
- Tests that would stay green with a site reverted.

Findings: IDs from F10, severity P0–P3 (P0 data loss/security/charging/broadly unusable; P1 user-visible
wrong behaviour or authoritative contract violated; P2 design risk; P3 prose), established or reasoned,
(a) reproduction, (b) fix. Refuse only on an established P0/P1.

## My own suspicions — read last

1. The audit grep may miss 5xx statuses set by variables (`httpError(status, …)` with computed status).
2. `useAdminFeedback`/`useAdminUsers` have no test of the new behaviour of their own.
