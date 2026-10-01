## Findings

- **P0:** None.
- **P1 within this change:** None.
- **P1 wider:** Repository typechecking is blocked by an unrelated missing `canStartOver` prop in [chat-empty-reads-from-the-top.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/tests/chat-empty-reads-from-the-top.test.tsx:126). I left this for you because the file is outside the change.
- **P2 fixed:** Documentation and comments still implied every capable-tier call followed the article switch. I documented Simple’s exception in [high-powered-ai.md](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/docs/project/high-powered-ai.md:8), [models.ts](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/models.ts:248), [HighPowerSwitch.tsx](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/web/HighPowerSwitch.tsx:1), [Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/web/Metadata.tsx:1380), and [simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/simple-summary.ts:607).
- **P2 fixed:** Corrected the historical guard comparison to 6/18 in [261001i](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/docs/plans/261001i-simple-fidelity-guard-built.md:4) and removed the feedback report’s false claim that commits were already named in the plan at [line 12](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/docs/user-feedback/261001_1710-simple-written-on-opus-with-the-check-kept.md:12).

No functional code changes were needed.

## Audit answers

1. No missed Simple model path found. The pipeline uses `powerFor` at [pipeline.ts:3902](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/pipeline.ts:3902), and `/api/models` uses it at [routes.ts:5730](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/routes.ts:5730). The owner GET does not derive a model. Staleness compares Sonnet and Opus as the same generation at [artifacts.ts:1011](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/store/artifacts.ts:1011), so Opus output is not wrongly marked stale. Metadata reruns and admin cost reporting do not independently select or estimate Simple’s model.

2. The 261001j stagger remains sound. Its only model dependency is the appropriate model-specific cache floor at [simple-summary.ts:646](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/simple-summary.ts:646). Fuller-first release still occurs through `onStart` at [line 719](/home/greg/code/spideryarn2/.claude/worktrees/simple-opus-vs-checker/src/simple-summary.ts:719).

3. `models.ts` is the right home. The `Set<Task>` is preferable here: this is a sparse opt-in exception, while an exhaustive table would duplicate the default article policy for every task. `TASK_TIER` appropriately remains exhaustive because every task must choose a tier.

4. Probe parsing is correct for valid invocations: flags and slugs can be interleaved, all three flags are validated, and omitted `--guard` remains `undefined`, preserving `SIMPLE_CHECK_ENABLED`. The recorded result resolves that effective default.

5. The saved-result counts, costs, timings, switch name, and one-line reversal through `ALWAYS_HIGH_POWER` are consistent after the documentation corrections.

## Gates

- Relevant suites: **passed — 4 files, 474 tests**.
- `git diff --check HEAD`: **passed**.
- Exact `npm run typecheck`: could not start because the sandbox denied `tsx`’s `/tmp` IPC socket.
- Equivalent `node --import tsx scripts/typecheck.ts`: source, web, fleet, and coverage checks passed; tests had the one unrelated P1 above.
- Advisory repo-wide lint remains baseline-red: 164 errors, 123 warnings.

No model calls were made, and no commit or git-state mutation was performed.