# Review: tap to talk's refusal policy moved to a pure function, with a fix for a late refusal stranding a sent turn

Repo: this worktree, branch `worktree-sweep5-c22-live-tap-policy` (TypeScript, ESM, React client).

## The candidate

Committed: `e7873ccba`
`git diff 0a98b28ab..e7873ccba`
changed paths: `git diff --name-only 0a98b28ab..e7873ccba`

Start with: `src/web/live/tap.ts`, the `error` handler's tap branch and `stop` in
`src/web/live/useLiveConversation.ts`, `tests/live-talk-mode.test.ts`, and the three new tests in
`tests/live-session-flow.test.tsx` (search "late refusal" and "Done's tail cancels").

The plan, with your own plan review's findings and what was done about each, is
`docs/plans/261004e-sweep-cluster-22-live-tap-policy-as-a-pure-function.md` § After the plan review.
Your plan review is `docs/plans/261004e-sweep-cluster-22-plan-review-sol.md`.

## What it is meant to do

- `tapRefusal(kind, { mode, submitted }, message)` reproduces the old inline branch for every
  cell, except the two deliberate changes below.
- F1: a refusal of Talk's clear that arrives after Done's commit has gone changes nothing; a late
  refusal of the entry update restores hands-free but leaves the awaited commit awaited, so the
  acknowledgement still sends `response.create`.
- F2: any refusal that returns to Ready cancels Done's tail timer.
- `stop` clears Done's tail timer.
- Nothing else about a live call changes. GPT-Live (`src/web/live/gpt-live/`) is untouched.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage, each finding red-first with the test
that reproduces it, and leave everything wider as a finding for me to decide. Do not commit. List
every file you changed at the end.

You can run one test file: `npx vitest run tests/live-talk-mode.test.ts` and
`npx vitest run tests/live-session-flow.test.tsx` need nothing outside the tree. You cannot run
`npm test` or `npm run typecheck`; I have: typecheck is clean, and those two files plus
`chat-live-handoff`, `live-tail-handoff` and `live-stall` pass (199 tests).

## Attack it

Independently, before you read my suspicions below. The invariant to break: after any sequence of
Talk, Done, provider acknowledgements and provider refusals in any order a real data channel could
deliver them, a turn whose commit the service accepted is answered or visibly owed, a turn it did
not accept is not owed, the microphone is on only in hands-free or between Talk and Done, and the
Talk button being enabled means `talk()` will act.

Severity: P0 data loss, security, wrong charging, service unusable · P1 user-visible wrong
behaviour or an authoritative contract violated · P2 design or maintainability risk · P3 prose.
For each finding: an ID (F1, F2, …), severity, established or reasoned, (a) the input I can run
that shows it, (b) the smallest change that closes it. Refuse only on an established P0 or P1.

## My own suspicions — read last

These are already mine, so confirming them is worth less than what you find yourself.

1. `submitted` is derived as `mode === "tap-sending" && doneTimer.current === null`. Is there a
   state where that is true and no commit was sent (the tail callback returned early)?
2. After a late entry refusal the call is hands-free with the detector on and a manual commit in
   flight. The acknowledgement now sends `response.create`. Could the detector also create a
   response, and is the resulting refusal (a `response` kind in `hands-free`, which is `keep`)
   really harmless? Is the mode `hands-free` with `tapCommitPending` true safe everywhere else?
3. The plan's "Known and left": a clear refusal arriving after the reply began, or during the next
   Talk. Is leaving it right?
4. Is the table test's five-state framing honest, or does it restate the implementation?
