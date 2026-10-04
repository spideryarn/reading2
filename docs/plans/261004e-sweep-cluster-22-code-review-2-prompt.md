# Review, round two: the entry refusal stops awaiting a manual commit

Repo: this worktree, branch `worktree-sweep5-c22-live-tap-policy`.

## The candidate

Committed: `e7873ccba` (round one's candidate), then `677a2e1f6`.
`git diff e7873ccba..677a2e1f6` is what changed since your round-one review; it contains your own
uncommitted fixes for F1 and F2 and my rework on top of them.
Whole stage: `git diff 0a98b28ab..677a2e1f6`.

Start with: `src/web/live/tap.ts`, the `error` handler's tap branch in
`src/web/live/useLiveConversation.ts`, `tests/live-talk-mode.test.ts`, and the tap tests in
`tests/live-session-flow.test.tsx`.

## Previous findings

| ID | Finding | Disposition | What changed |
|----|---------|-------------|--------------|
| F1 | P1: commit refused after entry recovery leaves debt, and the next detector commit sends `response.create` | fixed (by you), then reshaped | Entry refusal now clears the awaited-commit flag, so nothing is pending in hands-free. A commit refused in hands-free returns the listening outcome with `dropDebt`, for any hands-free state. Your test passes unchanged. |
| F2 | P2: entry refusal inside Done's tail leaves the tail running | fixed (by you), generalised | Every non-`keep` outcome clears the flag and cancels the tail, in the hook. Your test passes unchanged. |
| F3 | P1 at the hook boundary: late entry recovery, re-enter, Talk, old commit acknowledged, new clear refused, reply refused: accepted turn unanswered with no debt | meant to be dissolved, not patched | The old acknowledgement no longer sends `response.create`, because nothing is awaited after entry recovery. |
| F4 | P2: restored detector and the manual acknowledgement handler can both request responses | meant to be dissolved | Same change: in hands-free only the detector asks. |

The cost of the rework, taken deliberately: a turn whose commit went out before a late entry
refusal is not answered by us. It stays owed, so the `no-reply` notice and Reconnect appear. That
is what the code did before this stage. Test: "a late refusal of the entry update leaves a sent
turn owed, and asks for no reply of its own".

Treat all of it as unreviewed code written by someone else.

## What you can run, and what you may change

You may edit this worktree; fix narrowly and red-first inside this stage; do not commit; list the
files you changed. You can run `npx vitest run tests/live-talk-mode.test.ts` and
`npx vitest run tests/live-session-flow.test.tsx`. Typecheck is clean and those plus three other
live test files pass (200 tests); I ran them.

## What I want

This is round two, so discovery is narrow: is each of F1 to F4 closed by `677a2e1f6`, and did the
rework break anything round one's candidate had right? Give the event sequence for anything still
open. Severity scale as before (P0 to P3), established or reasoned, an ID per finding continuing
from F5. Refuse only on an established P0 or P1.

## My own suspicions — read last

1. F3's residue: after a late entry refusal the sent turn is owed. If the reader then re-enters
   tap mode and a later clear is refused, `ready` drops that debt, though the old turn was accepted
   and unanswered. It needs two refusals of different kinds. I intend to leave it, written down
   under the plan's "Known and left" with the turn-ownership gap. Is that wrong?
2. `enterTapToTalk` does not look at `owedSince`. Should it?
