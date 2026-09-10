# Review: Stage 1b of plan 260910d — queued work writes receipts and survives a restart

Repo: /home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts, branch
worktree-durable-action-receipts. TypeScript + ESM, tsx, vitest.

## The candidate — two parts, both unreviewed

1. **Stage 1b**: the commit whose subject begins "Stage 1b of 260910d" — `git log -1 --format=%H
   --grep='^Stage 1b of 260910d'`. `git show --stat <sha>` lists its paths; `git show <sha> -- tools/
   tests/` is the code. It wires the receipt journal into `queue.ts`, `drain.ts` and
   `routes-actions.ts`, moves the composition into `action-stores.ts`, deletes the legacy
   `openSharedQuarantine()`, changes one call in `server.ts`, and adds `tests/fleet-receipt-restart.test.ts`.
2. **Stage 1a's review fixes, commit 007a6dc4** — written by a previous GPT Sol reviewer and **not
   yet reviewed by anyone**. This is their second round: treat them as someone else's code.
   `git show 007a6dc4 -- tools/ tests/`. The review that produced them is
   `docs/plans/260910d-durable-action-receipts-stage1a-review-sol.md` (F22–F31).

Merge commits from `origin/dev` sit between them; **their other files are not the candidate**. Start
with `tools/fleet/queue.ts`, `tools/fleet/drain.ts`, `tools/fleet/action-stores.ts` and
`tests/fleet-receipt-restart.test.ts`. That is where to begin, not the limit.

## What it is meant to do

The spec is `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md` — § The design
and § The crash points are authoritative — built from `docs/plans/260910d-durable-action-receipts-stage1b-task.md`.
The acceptance sentence: **restarting cannot silently drop acknowledged queued work or send an
ambiguous message again, and a receipt explains what is proven and unknown.** No automatic retry.
**A receipt never installs, extends or ends a hold.** Direct steer, answers, enacted plans and the
broadcast's direct sends are Stages 2–3 and deliberately untouched.

## What you may change

You may edit this worktree. Fix what is inside the stage (both parts above) — each finding red-first,
with the test that reproduces it — and leave everything wider as a finding for me to decide. Do not
commit or change the index or history. Do not edit `send-coordinator.ts`, `steer.ts`,
`routes-steer.ts`, `tools/overseer/` or `tools/fleet/web/`, and change no line of `server.ts` beyond
the one call and its comment block. List every file you changed at the end.

You can run single test files and `node --import tsx scripts/typecheck.ts`; none of the fleet tests
needs the network. My gate results are at `logs/dar-s1b-gates.txt`.

## Attack it

Independently, before my suspicions below. Find a sequence of enqueues, drain passes, cancels,
clears, abandons, write failures, frozen disks at any line, restarts, tmux restarts, stale pages and
duplicate requests after which:

1. the same queued keystrokes are delivered twice;
2. an item answered 200 as queued or as cancelled comes back different after a restart without a
   receipt saying so;
3. a restored item is delivered when its tmux generation is unproven or changed, or with words other
   than the ones pinned at acceptance;
4. a receipt claims something proven that was not, or a page is told `volatile: false` while nothing
   durable is being written;
5. a stale page acts on the wrong item because an original id was restored;
6. `server.ts` can reach a send route before both stores are open, or the source guard would stay
   green if the receipt journal were opened below the listener.

For the 1a fixes specifically: is each one correct, and did any of them weaken a guarantee that held
before (the memory-fallback rules in `append`, `forceMemory`, the split `withdrawn`, the
recovery-suppression set, `writePrivateAtomically`)?

Mutate what you suspect and see whether the suite notices. A guard that passes a mutation is a
finding.

For each finding: an ID continuing from F32, a severity (P0 data loss / exploitable security /
service broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2
design risk, no wrong behaviour today; P3 prose), established or reasoned, (a) the input or mutation,
(b) what you changed, or the smallest change if it is outside the stage. Refuse only on an established
P0 or P1. End with one line: "land", "land with the fixes above", or "rework".

## My own suspicions — read last

1. `unknownWithoutHold` is computed once at startup from recovery's conclusions and the rehydrated
   book. Is there a startup ordering in which the book has not rehydrated yet when it is computed?
2. The first `noteGeneration` after a restore concludes items. What if the very first drain pass's
   snapshot has `tmuxServerPid: null` (the drain refuses to deliver then)? Do restored items wait
   correctly for the first real generation?
3. `fromAnotherRun` now lets a foreign id through when an item with that exact id exists. For
   `clear`, which takes a list, is a list mixing a restored foreign id and a stale foreign id handled?

Report findings, fixes, checks run and their exact results. Ensure the answer file is non-empty.
