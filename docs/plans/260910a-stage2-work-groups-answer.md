Implemented Stage 2 without committing.

Changed files:

- `tools/fleet/overseer-status.ts`
- `tools/fleet/wire.ts`
- `tools/fleet/work-groups.ts`
- `tests/fleet-work-groups.test.ts`
- `tests/fleet-overseer-status.test.ts`
- `tests/fleet-web.test.tsx`
- `tests/fleet-questions.test.ts` — omitted from the brief’s caller list, but its hand-written `CheckpointFeeds` fixture required updating.

The tests cover grouping, ranking/capping, pane uncertainty counts, nullable timings, unavailable reasons, accepted scans, probe failures, old checkpoints, inventory mismatches, and exact agreement between the register and work feeds. Each new behavior was observed red before its implementation or restoration.

Final command:

```bash
npx vitest run tests/fleet-work-groups.test.ts tests/fleet-overseer-status.test.ts tests/fleet-usage-card.test.tsx tests/fleet-overseer-panel.test.tsx tests/fleet-web.test.tsx tests/fleet-work-evidence-e2e.test.tsx tests/fleet-questions.test.ts
```

Final summary:

```text
Test Files  7 passed (7)
Tests       569 passed (569)
Duration    30.45s
```

`resolveWork` has exactly one call site, and its result is shared by `projectRegister` and `projectStoredWork`. `git diff --check` also passes.

I did not touch `tools/overseer/`, restart anything, run the full gates, or commit. The unrelated modified plan file already in the worktree was not touched.