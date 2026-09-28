Implemented three in-stage fixes. No unresolved P0/P1 remains in the stage itself.

### F11 — P1 — fixed

**Evidence:** [src/trajectory.ts:213](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/trajectory.ts:213), [tests/trajectory.test.ts:373](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/trajectory.test.ts:373)

The model was offered multiple quotes from the same block, and the growth rule counted those duplicates.

Fixed by collapsing quotes before prompt construction and growth calculation:

- One quote per block.
- Highest `max(importance, striking)` wins.
- Ties preserve the earlier Quotes-list entry.
- `dropped.collapsed` records the removed count.
- `sameBlock` validation remains as a backstop.
- `PROMPT_VERSION` is now `trajectory/4`.

Red → green: new collapse, priority/tie, artefact-count, and eight-quote growth-boundary tests initially failed, then passed.

### F12 — P1 — fixed

**Evidence:** [src/trajectory.ts:477](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/trajectory.ts:477), [src/trajectory.ts:583](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/trajectory.ts:583), [tests/trajectory.test.ts:385](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/trajectory.test.ts:385)

Article quotes and section titles were interpolated as ordinary prompt text, allowing article content to masquerade as instructions.

Fixed by:

- Explicitly declaring quote records untrusted data in the system prompt.
- Fencing each complete quote record.
- Defusing embedded fence delimiters inside article text and section titles.

Red → green: a malicious quote containing a closing marker initially escaped the intended boundary; the regression test now passes.

### F13 — P1 — fixed

**Evidence:** [src/trajectory.ts:149](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/trajectory.ts:149), [tests/trajectory.test.ts:401](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/trajectory.test.ts:401), [plan:104](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:104)

`quotesHash` covered only quote ID and block ID. A Quotes rerun can retain both while changing the displayed text or priority—the latter can change the same-block winner—so the stage and GET route could incorrectly regard Trajectory as current.

The hash now covers, in stored order:

- Quote ID and block ID.
- The exact clipped text offered to the prompt.
- Effective priority.

All freshness consumers continue to use the same helper. The plan and fixture were updated accordingly.

Red → green: a rescoring test initially produced the same hash; rescoring and rewording now both invalidate it.

### F14 — P1 — reported

**Evidence:** [tests/command-bar.test.tsx:524](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/command-bar.test.tsx:524), [tests/every-mode-draws-its-surface.test.tsx:672](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/every-mode-draws-its-surface.test.tsx:672), [tests/public-network-trace.test.tsx:838](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/public-network-trace.test.tsx:838)

Concurrent stage-2 client changes leave five exhaustive test records without `trajectory` entries. This is outside commit `868ae017` and the server stage, so I did not modify it.

### Verification

- Selected unit suite: **11 files, 609 tests passed**.
- Biome lint on changed TypeScript files: passed.
- `git diff --check`: passed.
- Production, network, and Postgres were not touched.
- The root, web, and fleet TypeScript projects pass; the test project fails only on F14.
- No additional findings in validation, prerequisite ordering/refusal, force behavior, gateway/cost category, export, or the migration constraint.
- `sectionPathOf` is not an active performance defect: prompt rendering builds one block index and reuses it.

**Verdict:** accept stage 1 with these fixes. I do not refuse `868ae017`; the current shared worktree remains non-green only because of the wider F14 client work. No commit was made.

Files changed:

- `src/trajectory.ts`
- `src/types.ts`
- `src/pipeline.ts`
- `tests/trajectory.test.ts`
- `tests/pipeline-artifact-store.test.ts`
- `docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md`
- `docs/plans/260928a-trajectory-mode-stage1-real-runs.md`