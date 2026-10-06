# Review: the add page stops when the signed-in reader changes, and requests name the reader they were made for

Repo: this worktree (branch `worktree-add-page-reader-change`). TypeScript + ESM, React client
under `src/web/`, vitest + jsdom tests under `tests/`.

## The candidate

Committed: commit 4fc001a6d (parent 7ad98b97f).
`git diff 7ad98b97f..4fc001a6d`; changed paths: `git diff --name-only 7ad98b97f..4fc001a6d`.

Start with: `src/web/lib/api.ts` (`NotThisReader`, `madeFor`, `tokenOwner`, the 401 retry),
`src/web/add-visit.ts` and its use in `src/web/App.tsx`, `src/web/AddStopped.tsx`,
`src/web/AddPage.tsx`. Then the engines (`jobEngine.ts`, `uploadEngine.ts`, `batchUpload.ts`,
`upload.ts`, `auto-modes-setting.ts`, `useJobs.ts`) and `purpose.ts`. That is where to begin, not
the limit of scope.

## What it is meant to do

The plan is `docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md`; your own
plan review is `docs/plans/261006e-plan-review-sol.md`. Read the plan's *What landed* and *What is
not promised* sections as a reviewer of the conclusions, not only of the code. Every design
decision in the plan is mine (the implementing agent's), not the user's. The user's only words are
the queue item: "on a reader change, reset that page to a fresh, empty state for B and do NOT
start or continue the import as B (no spend without B's own gesture)."

The statement to test, from the plan's *Done looks like*:

> After a change of account on an open add page, direct or through signing out, B sees none of
> A's words or choices; no request the add page, the job engine or the upload engines made for A
> is sent with B's token; and no import starts for B from that page.

And its converse, which matters as much because this is production: **`NotThisReader` never fires
for a request made and sent under the same reader**, on any page, online or offline, across a
token refresh, at boot, signed out, and through the `fromCache` fallback.

Deliberately out of scope: fencing every plain `apiFetch` call in the app by the reader at call
time (the plan says why, under *What is not promised*).

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage, each finding red-first with the test
that reproduces it, and leave everything wider as a finding for me to decide. Do not commit. List
every file you changed at the end. If you edit a doc, do not write anything attributed to the
user (Greg); he has said nothing about this work beyond the queue item above.

You can run one test file (`npx vitest run tests/<one>.test.ts`) and a script
(`node --import tsx <script>`). You have no network, not even loopback, so anything needing
Postgres skips. I ran: `npm run typecheck` (clean) and
`npx vitest run tests/add-page-reader-change.test.tsx tests/add-visit.test.ts tests/engines-send-as-their-reader.test.ts tests/api-fetch.test.ts`
(4 files, 66 passed). The full suite is running separately.

## Attack it

Independently, before you read my questions. Find a concrete sequence in which either statement
above is false. Hand-check the call sites, not only the functions: who passes `madeFor`, where the
reader is read, and what each caller does with a `NotThisReader` rejection (does anything loop,
show an error to the wrong reader, or leave a transfer stuck?).

For each finding give:
  - an ID continuing your plan review's numbering (F7, F8, …), a severity (P0 data loss /
    exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour
    or a contract violated; P2 design risk, no wrong behaviour today; P3 prose), and whether it is
    established or reasoned
  - (a) the input or mutation I can run
  - (b) the smallest change that closes it (which you may have made)
A finding with no (a) goes last. Refuse only on an established P0 or P1, and name what
established it.

## Previous findings

| ID | Finding | Disposition | What changed |
|----|---------|-------------|--------------|
| F1 | an already-started add POST can import as B | fixed | engines name their reader at call time; 401 retry not sent as another reader |
| F2 | sharing requests not scoped for sending; uploads, advances, auto-modes | fixed | all pass `madeFor` |
| F3 | A→null→B excluded | fixed | visit kept in `App` above the signed-out branch |
| F4 | B's purpose session waits behind A's save | fixed | barrier keyed by reader and slug |
| F5 | A→B→A can revive A's High-powered intent | disagreed | plan § What is not promised |
| F6 | upload filename left in the title | fixed (did not reproduce before; stopped page owns the title) | `AddStopped.tsx` |
| —  | simpler design: no button, stopped page | taken | |

Treat all of it as unreviewed code written by someone else.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The visit ref is written during render in `App`. Is there a render (loading, a discarded
  concurrent render, the auth callback route) that advances it wrongly, or stops a visit for the
  same reader?
- `tokenOwnerOf` and `cachedTokenOwner`: can they disagree with the token actually sent?
- The engines' `reader()` accessor between `stop()` and `start()`: `null` is unfenced.
- The stopped page's sentence after A→B→A, and whether a legitimate reader can get stuck on it
  (same reader signs out and in again; a reader with two accounts adds the same URL on each).
- `key={user.id}` on `AddPage` is caught by no test.
