# Review: Stage 1 of the recovery inventory — the journal and the fold

Repo: /home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory (a linked worktree of
spideryarn/reading2), branch `worktree-recovery-inventory`. TypeScript, ESM, `tsx`; tests are
vitest. The daemon in `tools/overseer/` folds fleet snapshots into an append-only JSONL event log
plus atomic checkpoints.

## The candidate

Committed: the single commit whose message begins "Recovery inventory stage 1" (`git log -1
--grep='Recovery inventory stage 1' --format=%H`). Diff it against its first parent:
`git diff <sha>^1 <sha>`. Changed paths: `tools/overseer/recovery.ts` (new),
`tools/overseer/store.ts`, `tools/overseer/daemon.ts`, `tools/overseer/diff.ts`,
`tools/overseer/jobs.ts`, `tools/overseer/status-cli.ts`, `tests/overseer-recovery.test.ts` (new),
`tests/overseer-daemon-recovery.test.ts` (new), and the plan doc.

Start with: `recovery.ts`; the recovery parts of `store.ts` (`openStore`'s second replay, and the
`recovery.json` write in `checkpoint()`); the `take()` hunk in `daemon.ts`. These are where to
begin, not the limit of scope.

## What it is meant to do

Read `docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md` §1–§3,
Findings, and Stage 1 (including the implementer's decisions under its Status). In brief:

- A `recovery-candidate` carrying the final complete `RegisterEntry` goes into the log **before**
  the `tmux-session-gone` that removes the entry, in the same append.
- Every disappearance gets one, except a watched, same-world close.
- The id is idempotent under crash replay, and distinct across distinct disappearances.
- A third fold is persisted in `~/.overseer/recovery.json`, with its own cursor and its own replay.
- A changed host boot id closes out the whole old world.
- Old logs are derived once, with missing evidence as `entry: null` stubs.
- The caps never drop evidence silently.

Out of scope for this stage: classification against the live inventory, dispositions derived from
evidence, the CLI, and the page.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage under review, each finding red-first with
the test that reproduces it, and leave everything wider as a finding for me to decide. Do not
commit. List every file you changed at the end. You can run a test file
(`npx vitest run tests/<one>.test.ts`) and `npm run typecheck`; you have no network. My raw run of
the two new suites and the typecheck: `Test Files 2 passed (2) / Tests 44 passed (44)`, typecheck
exit 0. The implementer also ran 26 focused files (748 tests), all green.

## Attack it

Independently, before you read my suspicions. The invariant to break: **after any sequence of
accepted and refused snapshots, restarts, reboots (a boot-id change), and crashes between the
durable writes (the events append, `last-snapshot.json`, `current.json`, `recovery.json`), a
session that was in the register before a world change is represented in the recovery index —
by a record, or by an `entry: null` stub — exactly once.** Also: that the new parser cannot refuse
a line the daemon legitimately writes. `replay()` is all-or-nothing, so one refused line starts the
store cold, and that would be a P0.

For each finding: an ID (F11 upwards; F1–F10 were the plan review), a severity (P0 data loss /
security / broadly unusable; P1 wrong behaviour or an authoritative contract violated; P2 design risk;
P3 prose), established or reasoned, (a) the input or mutation that shows it, (b) the smallest fix.
Refuse only on an established P0 or P1. One-line verdict at the top.

## My own suspicions — read last

1. Decision 1 (unstamped counts as the same run). Is there a real reboot path that an unstamped
   dashboard now hides? My belief: it isn't hidden, because generation `unverifiable` or `changed`,
   or a boot-id change, still produces a candidate. Check that belief rather than the decision.
2. `recordBootId` after the append, plus the candidate carrying `hostBootId`. Is there an
   interleaving where the recorded boot id moves on without the old world being closed out?
3. The pending-merge rule: can a legitimate second disappearance of the same key, with no
   intervening session event for that key, be swallowed?
4. `store.ts`'s two replays: does the recovery replay reuse `truncateToLastLine`'s single repair, or
   can it read a range the torn-tail repair has not yet made safe?
