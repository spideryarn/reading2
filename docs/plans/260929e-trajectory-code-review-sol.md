1. **F1 — P1 — stale `depth` after stepping from a conflicting link.** [TrajectoryMode.tsx:472](/home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/web/modes/trajectory/TrajectoryMode.tsx:472)

   `locate` correctly let `stop` win, but subsequent steps replaced only `stop`, leaving the URL’s `depth` on the wrong pass. I changed stop traversal and row selection to replace both coordinates, retaining absent depth for Gist. Added regression coverage at [trajectory-panel.test.tsx:1265](/home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/tests/trajectory-panel.test.tsx:1265).

2. **F2 — P2 — stale blocks could publish a nonexistent prose destination.** [TrajectoryMode.tsx:570](/home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/web/modes/trajectory/TrajectoryMode.tsx:570)

   `stopBlock` previously trusted the Quote’s stored `blockId`, while movement and rows used `blockOf`, which also verifies that the block remains in the article. I made the published control use `blockOf` too.

3. **F3 — P2 — implicit `any` in the new measurement script.** [trajectory-diversity.ts:124](/home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/scripts/eval/trajectory-diversity.ts:124)

   Added the precise awaited return type for `loadTrajectory`.

The edge cases now resolve consistently:

- Back/Forward restores matching depth, stop, selected passage and control state; covered at [trajectory-panel.test.tsx:1096](/home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/tests/trajectory-panel.test.tsx:1096).
- The arrival mailbox uses `locate`’s resolved stop and does not re-arm on traversal.
- `deeper` uses the next offered pass’s exact first stop.
- Empty passes are omitted and skipped.
- A missing current stop does not prevent moving to a valid new pass.
- If the new pass’s required stop 1 has no passage, the depth change refuses entirely. That is the consistent choice: moving only the band/URL would abandon the prose, while choosing stop 2 would break the stop-1 contract. Both missing-stop cases are pinned at [trajectory-panel.test.tsx:1470](/home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/tests/trajectory-panel.test.tsx:1470).

The grep found only intentional cumulative-depth assumptions in route generation/storage, not remaining client nesting. The changed route and integration tests would fail against the old cumulative implementation.

Checks:

- Targeted tests: **109 passed**
- Typecheck: passed all 2,322 source files through the equivalent non-IPC loader invocation. The exact npm wrapper was blocked by sandbox `tsx` IPC permissions.
- Lint: no errors; two advisory complexity/style notices.
- Full `npm test`: could not start because the local database was unavailable; I did not start or touch it as instructed.

**Verdict: approve with fixes applied.**