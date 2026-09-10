# Narrow check: four P1 fixes in Stage 2 of the recovery inventory

Repo: /home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory (a linked worktree of
spideryarn/reading2), branch `worktree-recovery-inventory`. TypeScript, ESM, `tsx`; tests are
vitest.

**The tree is read-only for you. Do not change any file.**

## This is not a review of the stage

Discovery is closed: the stage has had two review rounds. This check answers one question per
finding, and nothing wider:

**Does the fix close the finding exactly as the finding was stated, without reopening something
next to it?**

Do not report new findings in unrelated code. If you notice one, add one line at the very end
under "Outside scope".

## The candidate

The commit whose message begins "Recovery inventory stage 2, review fixes"
(`git log -1 --grep='Recovery inventory stage 2, review fixes' --format=%H`). Diff it against its
first parent. The findings, verbatim, are in
`docs/plans/260910e-recovery-inventory-stage2-review-r2-sol.md` (F21–F24, plus F22's reproduction)
and in the plan's Stage 2 status (O1, which is the same defect as F21).

## The four questions

1. **F21 / O1.** While `store.recovery.replay.kind === "not-run"`, can **any** path append a
   `recovery-disposition` event? Consider the accept path, the tick, start-up, and the view pass.
2. **F22.** Take the first 200 directory entries of the inbox and of `processing/`, where each is
   junk, or a stale `.tmp-*`, or a directory, or a symlink. Is a valid request reached within a
   bounded number of passes? And can the quarantine move ever touch a real request, the reserved
   directories, or a fresh `.tmp-*` a CLI is still writing?
3. **F23.** On every exit path from `runOverseer`, normal and exceptional, are all timers stopped
   before the settle loop, so that the loop provably terminates and the lock is released?
4. **F24.** Can `recovery.json` ever hold a `view.page` item whose record id is absent from
   `records`? Consider a restart, a pass that straddles a retention boundary, and a pass started
   before a checkpoint that prunes.

For each question: **closed / not closed**, and for "not closed", the concrete input and the
smallest fix. Run the new regression tests: `npx vitest run tests/overseer-daemon-recovery.test.ts
tests/overseer-recovery-view.test.ts tests/overseer-recovery.test.ts`. The typecheck, if you need it,
is `node --import tsx scripts/typecheck.ts`. There is no network.

Answer in under 800 words: four lines of verdict first, then detail only where a fix is not closed.

## The reproductions, as raw output

Handed over so that you check each fix rather than rediscover its bug. Each block is the named test,
run once with the fix removed (red) and once on the candidate (green), exactly as the terminal
printed it.

Every red below came from running the test **before its fix existed**: the test was written first.
They are not reverts.

**F21 (= Opus O1)**: `npx vitest run tests/overseer-daemon-recovery.test.ts -t "derives no disposition from the stale fold"`

```
=== RED — exit 1 ===
     × an accepted collection derives no disposition from the stale fold while the replay is not-run (O1, F21) 414ms
AssertionError: expected [ 'dismissed', 'resumed' ] to deeply equal [ 'dismissed' ]
 Test Files  1 failed (1)
      Tests  1 failed | 37 skipped (38)
=== GREEN — exit 0 ===
 Test Files  1 passed (1)
      Tests  1 passed | 37 skipped (38)
```

**F22**: `npx vitest run tests/overseer-daemon-recovery.test.ts -t "junk cannot starve the inbox"`

```
=== RED — exit 1 ===   (three drains in a row applied 0)
     × junk cannot starve the inbox: 200 junk entries in processing/ are quarantined, and a later bounded pass reaches the request (F22, O4) 348ms
AssertionError: expected +0 to be 1 // Object.is equality
=== GREEN — exit 0 ===
      Tests  1 passed | 37 skipped (38)
```

**F23**: `npx vitest run tests/overseer-daemon-recovery.test.ts -t "a daemon whose source throws stops and releases its lock"`

```
=== RED — exit 1 ===   (timers cleared only in `finally`, after settleInFlight())
     × a daemon whose source throws stops and releases its lock, although every tick asks for another view (F23) 3288ms
AssertionError: expected 'still running after 3 s' to be 'threw: ri2f the source broke'
=== GREEN — exit 0 ===
      Tests  1 passed | 37 skipped (38)
```

**F24**: `npx vitest run tests/overseer-daemon-recovery.test.ts -t "a resolved record past retention leaves the view"`

```
=== RED — exit 1 ===   (buildRecoveryView had no retention filter)
     × a resolved record past retention leaves the view in the same write that drops it from the index (F24) 298ms
AssertionError: expected [ 'rc-08b974e23f6f6191ae18', …(5) ] to not include 'rc-13f246049fc447a89fdd'
=== GREEN — exit 0 ===
      Tests  1 passed | 37 skipped (38)
```

**F24, the residual window**: the view is built on an earlier clock than the checkpoint's prune.
It is closed at the single write point in `store.ts` (`recoveryFileText`): the page is filtered to
ids still in `records`, and `olderCount` is recomputed.
`npx vitest run tests/overseer-recovery.test.ts -t "inside retention on the view"`

```
=== RED — exit 1 ===   (recoveryFileText serialised the view unfiltered)
     × a record inside retention on the view's clock and outside it on the checkpoint's is in neither page nor records 55ms
AssertionError: expected [ 'rc-65edee567d30cd930213', …(1) ] to not include 'rc-67f455deb2a0a4c7a3b6'
 Test Files  1 failed (1)
      Tests  1 failed | 36 skipped (37)
=== GREEN — exit 0 ===
 Test Files  1 passed (1)
      Tests  1 passed | 36 skipped (37)
```

My own run of the three recovery files on the fixed tree: `Tests 106 passed (106)`, exit 0;
`npm run typecheck` exit 0.
