# Settle check (Fable): two findings Sol's narrow check left open in Stage 3

You are settling **two findings**. This is not a review. Work in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory`, and **change no file**.

Discovery is closed. GPT Sol's narrow check (`docs/plans/260910e-recovery-inventory-stage3-fixcheck-sol.md`)
closed five of the seven P1 fixes and left **F28** and **F30** open. The engineering-manager rule
says a finding still open after that check is settled or overruled through Fable or Greg, and
never waved through. Your answer decides whether this stage lands.

## F30: is the fix closed?

**The finding:** the browser parser (`tools/fleet/web/src/recovery-client.ts`) accepted a trusted
inventory claiming `rows: 0` beside an unresolved `already-live` row carrying a live session, and the
page drew both claims.

**The fix:** for a trusted inventory, the distinct `tmuxId`s named by `already-live` and
`present-but-unmatched` live rows may not exceed `inventory.rows`, and one `tmuxId` may not appear
twice with differing facts. Either violation gives `no-answer`. Its red and green output is in the
scratchpad as `ri3f-repro-F30b.txt`.

**Question:** after this fix, can the parser accept an answer that the page (`RecoveryPanel.tsx`)
then draws as two claims that contradict each other about the live inventory? Answer **closed** or
**not closed**. If not closed, give the concrete payload and the smallest fix.

## F28: is the overrule sound?

**The finding:** the drill (`scripts/overseer-recovery-drill.ts`) refuses targets inside a live
store, which is either the default `~/.overseer` or an absolute `OVERSEER_STORE_DIR`. Its final check
resolves the real path of the nearest existing ancestor. But a same-user process could swap an
ancestor for a symlink **between that check and the `mkdir`**, and so redirect creation into a
store. Sol's complete fix anchors every operation to an open directory descriptor
(`openat2`/`mkdirat`).

**The proposed overrule.** Do not build that. The reasons:

- **There is no privilege boundary.** Winning the race needs a process running as the same user,
  with write access to the target's ancestor, at that instant. Such a process can already write the
  store directly.
- **The guard's job is to refuse mistaken targets**: symlinked ancestors, missing leaves, relative and
  `..` paths, the default store, an absolute `OVERSEER_STORE_DIR`. Sol confirmed it now refuses every
  one of those.
- **A won race can do only one thing:** make the drill create its own new subdirectory inside a store
  directory.
  - The drill **deletes nothing**. The fixer checked this in the same pass; see its comment in the
    file.
  - It never writes a store's own files (`events.jsonl`, `current.json`, `recovery.json`). It writes
    only beneath its own new root.
- **Node has no API for the complete fix**, which would need a native addon or a platform-specific
  shell-out.
- **The guard's comment states exactly this strength.**

**A test backs the no-delete claim, as the Overseer required.** In
`tests/fleet-recovery-wiring.test.ts`, the drill is run with its guard beaten: the swap is simulated
through a test-only seam, or by redirecting the post-guard build. Part way through, a step fails. The
test asserts that every pre-existing file in a fake store is byte-for-byte unchanged, that nothing in
it was removed, and that only a new subtree beneath the drill's own root appeared. Its output is
`ri3f-repro-F28b.txt`.

**Questions:**

1. Read the drill and that test. Is each factual claim above true of the code as it is now: that it
   deletes nothing, that it writes only beneath its own new root, and that the comment is accurate?
   Does the test really beat the guard, and would it catch a cleanup `rm` added later? Try one in
   your head: which assertion fails?
2. Given those facts, is overruling the race sound for a hand-run developer tool? Or is there a
   concrete harm, to a live store's own files or to Greg's data, that the race can reach?

Answer **overrule sound** or **overrule not sound**, with the concrete harm if it is not.

## Rules

You may run `npx vitest run tests/fleet-recovery-panel.test.tsx` and
`npx vitest run tests/fleet-recovery-wiring.test.ts`. Run them in the foreground, and do not end your
turn while one is running. A full `npm test` may be running in this worktree; leave it alone.

**Answer in under 500 words. Give the two verdict lines first, then the detail.**
