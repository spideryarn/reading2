# Review: three fixes made by an earlier reviewer, checked narrowly

Repo: this worktree. TypeScript + ESM, React client under `src/web/`, vitest tests under `tests/`.

## The candidate

Committed: a5345aa8c (parent 4fc001a6d). Only its source and test changes:
`git diff 4fc001a6d..a5345aa8c -- src tests`. Paths: `src/web/useJobs.ts`, `src/web/batchUpload.ts`,
`tests/add-page-reader-change.test.tsx`, `tests/api-fetch.test.ts`,
`tests/engines-send-as-their-reader.test.ts`.

Treat these fixes as unreviewed code written by someone else. The findings they close (F7, F8, F9)
are in `docs/plans/261006e-code-review-sol.md`; the plan is
`docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md`.

## What it is meant to do

- F7: `useJobSession`'s first effect became a `useLayoutEffect`, so the job engine, the upload
  engine and the batch are bound to the reader before any child's passive effect can post.
- F8: `cancelUpload(uploadId, madeFor)` is sent as the reader the operation captured.
- F9: the batch checks `live()` after `sendIt` before queueing.

## What you can and cannot run

The tree is read-only. /tmp is writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`). No network.

## The question, and only this

This is not a new discovery pass. For each of the three fixes: **is the fix correct, and does it
break anything that worked before?** In particular for F7: everything that `useJobSession`'s
first effect and its cleanup do (`jobEngine.start/stop`, `uploadEngine.start/stop`,
`batchUpload.start/stop`, `handOverAutoModesChoice`, `retireAddSharing`) now runs in the layout
phase. Name any caller, test or behaviour that depended on it being passive (ordering against the
second, still-passive `resume` effect; StrictMode's mount, unmount, mount; a network request
started synchronously before paint; server rendering, if any), with the file and line.

Give each finding an ID from F10, a severity (P0/P1/P2/P3, by consequence), established or
reasoned, (a) the input or scenario and (b) the smallest change. If there is nothing, say so in
one line per fix.

Do not change any file.
