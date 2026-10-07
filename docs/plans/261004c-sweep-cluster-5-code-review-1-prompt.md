# Review and fix: sweep cluster 5, stage 1 and stage 2b — failed reads get a retry and a reader's sentence; the source scan gets a deadline

Repo: this worktree, branch `worktree-sweep5-c5-failed-read`. TypeScript + ESM, React client under
`src/web/`, vitest. You are the **reviewer-fixer**: fix what is inside these two commits' scope,
narrowly and red-first (a failing test before each fix); **report, do not fix**, anything wider.
Do not commit. Do not touch stage 2a or 2c of the plan (the Regenerate hold; Quiz's `readMark`) —
they are not built yet.

## The candidate

Committed: `b56e98e12` (stage 2b) then `64e947f0e` (stage 1).
`git diff ab8289e2a..64e947f0e`; changed paths: `git diff --name-only ab8289e2a..64e947f0e`.

Start with: `tests/read-error-matrix.test.tsx`, `src/web/ReadError.tsx`, `src/web/useGlossary.ts`,
`src/web/useQuiz.ts`, `src/web/SketchView.tsx`, `src/web/IllustratedView.tsx`,
`src/web/useSourceScan.ts`, `src/web/lib/opening-read.ts`. Not a limit on scope.

## What it is meant to do

The plan: `docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md`
§ Stage 1, § 2b, § F1 and the two ledgers of your plan-review findings (F4 and F7 land here).
Invariants:

- `retryRead` itself sends only a GET; a press still in hand is honoured exactly as it would have
  been had the first read answered (plan § F1 — you agreed this in round two).
- A failed revalidation never takes a loaded artefact off screen.
- Only a sentence written for a reader reaches the reader (docs/project/copy.md § The same seam in
  the browser). A `ReaderFacingError` must never wrap somebody else's text.
- No generic artefact-read hook. `ReadError` is markup only.
- `openingRead`'s existing callers and defaults are unchanged.

## Evidence

The builder's account: 41 of 49 matrix rows red before the fix; three mutations (a hook's catch
reverted, a panel back to a bare `<p>`, a row removed) each turned the matrix red. I ran
`npm run typecheck` (clean) and `npx vitest run tests/read-error-matrix.test.tsx
tests/source-scan-read-has-a-deadline.test.tsx tests/describe-fetch-failure.test.ts` (81 passed).
The full suite has not been run on this commit; it needs Postgres, which your sandbox cannot reach,
so run the jsdom files yourself (the matrix takes about 35 s) and tell me which others you want run.

## What I want

An independent attack first. Then findings with IDs continuing from **F13**, each graded P0 data
loss / security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour or an
authoritative contract violated; P2 design or maintainability risk; P3 prose. For each: fixed (with
the red test) or reported. End with one line: LAND, LAND WITH THE FIXES ABOVE, or DO NOT LAND.

## My own suspicions (already mine; spend most of the run elsewhere)

1. Six existing tests were changed to follow (mocks that threw plain errors;
   `a-broken-mode-leaves-the-article-readable` now answers 404). Did any of them lose what it was
   holding?
2. Four `throw new Error("The server replied N.")` became `ReaderFacingError` unchanged, and
   `useGlossary.setHidden` now wraps `describeFetchFailure(err)` inside a `ReaderFacingError`. Is
   either a way for unauthored text to reach a reader?
3. A malformed 200 body now reaches Sentry and shows `PAGE_FAULT`. Right outcome?
4. The static half's exclusion list (Arc, Claims, Relations, Crossrefs, Metadata): is each reason true?
5. `ReadError` uses `.gloss-error`'s colour inside Sketch and Illustrated, which say failures in
   grey on purpose (`.sk-failed`).
