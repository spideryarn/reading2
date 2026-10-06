# Review: a plan to make the add page forget everything when the signed-in reader changes

Repo: this worktree (branch `worktree-add-page-reader-change`, based on `origin/dev` at 7ad98b97f).
TypeScript + ESM, React client under `src/web/`, vitest + jsdom tests under `tests/`.

## The candidate

Live pre-commit: base 7ad98b97f; the plan is the one untracked file
`docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md`. No code has changed.

Start with: that plan, then `src/web/AddPage.tsx` (the `AddPage` component from line ~483, and
`purposeFor`, `purposeIo`, `putHighPower`, `retirePurpose` above it), `src/web/add-purpose.ts`,
`src/web/add-high-power.ts`, `src/web/lib/api.ts` (`apiFetchOwned`, `sendOwned`, `accessToken`,
`leavingFetch`, the `onAuthStateChange` handler at the bottom), `src/web/purpose.ts`,
`src/web/App.tsx` (where `AddPage` is mounted, and `useJobSession` in `src/web/useJobs.ts`).
That is where to begin, not the limit.

## What it is meant to do

The plan's own "Done looks like": after a direct change of account on an open add page, reader B
sees none of reader A's words or choices, no request about A's article leaves with B's token, and
no import starts for B until B presses a button. The design decisions in the plan are mine (the
implementing agent's), not the user's; the user's only instruction is the queue item, which says:
"on a reader change, reset that page to a fresh, empty state for B and do NOT start or continue
the import as B (no spend without B's own gesture). Red test first."

## What you can and cannot run

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). No network, not
even loopback, so anything needing Postgres skips.

## Attack it

Independently, before you read my questions. The statement to test is the plan's "Done looks like"
sentence: **is it accurate for the design as written?** Find a concrete sequence (A does X, the
session changes at moment T, timer or promise Y lands) in which B sees something of A's, a request
about A's article leaves with B's credential, or a paid import starts as B with no press. Check
the plan's claims about the code against the code (it names functions and behaviours; some may be
wrong). Say if a simpler design gets the same guarantee.

For each finding give:
  - an ID (F1, F2, …), a severity (P0 data loss / exploitable security / incorrect charging;
    P1 user-visible wrong behaviour or a contract violated; P2 design risk with no wrong behaviour
    today; P3 prose), and whether it is established or reasoned
  - (a) the concrete scenario it does not handle, or the code it contradicts (file and line)
  - (b) the smallest change to the plan that closes it, as replacement wording
A finding with no (a) goes last. Refuse only on an established P0 or P1.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether `accessToken()`'s `owner` and `lastKnownUser()` are trustworthy enough to fence on, in
  particular the `fromCache` fallback and the moment between the SDK changing session and its
  `onAuthStateChange` listener running.
- Whether the upload engine (`mine`) can still hold A's transfer for B's first render.
- Whether there are other writers on the add page I have not listed (the auto-modes setting, the
  sharing io, `markAskPurpose`, `openArticle`).
- Whether the gate's "reader changed" detection is safe under StrictMode and under a `null`
  reader in between (App unmounts the page while signed out, I believe).

Do not change any file.
