# Review: a plan to preserve and show interrupted work after a reboot, without resuming it

Repo: /home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory (a linked worktree of
spideryarn/reading2), branch `worktree-recovery-inventory`. TypeScript, ESM, run with `tsx`; tests
are vitest. The area is `tools/overseer/` (a daemon that folds fleet-dashboard snapshots into an
append-only JSONL event log plus atomic checkpoints) and `tools/fleet/` (the dashboard).

## The candidate

Committed: the plan is
`docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md` at the commit
that adds this prompt (`git log -1 -- docs/plans/260910e-recovery-inventory-plan-review-prompt.md`).
It is a plan only: no code has changed.

Start with: the plan; then the spec it implements,
`docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Recovery inventory — show
interrupted work without resuming it" (six checkboxes plus an acceptance paragraph); then the code
the plan leans on: `tools/overseer/store.ts` (`RegisterEntry`, `foldEvents`, `Store.append`,
`Store.checkpoint`, `openStore`, `replay`), `tools/overseer/diff.ts` (`diff`, the generation
relation, `gone`, the `OverseerEvent` union), `tools/overseer/daemon.ts` (`take()`, `goneWhileAway`,
the write-order comment), `tools/overseer/admissible.ts` and `observation.ts` (the producer stamp,
`SourceOrdering`), `tools/fleet/transcript.ts` (`findTranscript`). The plan
`docs/plans/260910d-source-ordering-distinguish-a-new-observation-from-a-new-timestamp.md` is the
producer stamp this plan uses. These are where to begin, not the limit of scope.

## What it is meant to do

After a reboot, show Greg which sessions were interrupted and what evidence survives, while
starting nothing. The invariant: recovery evidence must reach the durable log *before* the register
removal that would otherwise destroy it, in the same append, idempotently. And an absent inventory
from a failed collection must never be read as proof of interruption. Out of scope: resuming,
action routes, UI buttons.

## What you can and cannot run

The tree is read-only for you. /tmp and the node_modules caches are writable. You can run one test
file (`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). You have no
network, not even loopback.

## Attack it

Independently, before you read my questions below. The attack I care about most: find a sequence of
daemon events — snapshot shapes, refusals, restarts, crashes between writes — after which either
(a) a session that was running before a reboot has no recovery record and no `unknown` stub, or
(b) a record is classified `interrupted` or `resumed` on evidence that does not support it. Also:
is the plan buildable against the code as it stands (does the data it names exist where it says, at
the moment it says)? And is anything in it a larger design than the spec needs, where a smaller one
gets the same guarantees?

For each finding give:
  - an ID (F1, F2, …), a severity, and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it, as exact replacement wording for the plan

Severity: **P0** data loss, exploitable security, or the service broadly unusable; **P1**
user-visible wrong behaviour, or an authoritative contract violated; **P2** design or
maintainability risk with no wrong behaviour today; **P3** a prose defect. Refuse only on an
*established* P0 or P1 (direct evidence, with no unresolved inference), and name what established
it. Give a one-line verdict at the top: ready / ready with changes / not ready.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. The candidate rule's `producerRun: "changed"` arm: is a dashboard restart during which a session
   ends really indistinguishable from a reboot, or does it flood the list with `unknown` records
   after every ordinary dashboard restart (the dashboard is restarted several times a day)?
2. The separate `recovery.json` with its own cursor: is the crash-order argument right, given that
   `openStore` truncates a torn tail and replays only from `current.json`'s cursor today?
3. The legacy replay's "reboot signature" (a same-`at` run of `absent-from-snapshot` gones that
   empties the register, followed by a new generation): is it sound, or will it fabricate
   candidates from an ordinary `goneWhileAway` batch?
4. Is `already-live` matching on the conversation reading (`verified` id equals the candidate's
   claim) strong enough, given `claimedConversationId` is a claim that outlives its conversation?

Do not change any file.
