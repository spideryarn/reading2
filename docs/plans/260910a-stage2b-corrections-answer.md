Implemented all F2/F4/F7 corrections. No commit was made.

Changed files:

- [tools/fleet/wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/wire.ts) — four `StoredWork` arms and three-way timing union.
- [tools/fleet/work-groups.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/work-groups.ts) — UTF-8 byte budget, visible text bounds, timing aggregation/ranking, source-clock contract.
- [tools/fleet/overseer-status.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/overseer-status.ts) — widened resolved work, injected clock, single bounded reason shared by register/history.
- [tools/fleet/decisions-view.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/decisions-view.ts) — passes its existing injected clock.
- [tests/fleet-work-groups.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-work-groups.test.ts)
- [tests/fleet-overseer-status.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-overseer-status.test.ts)

Tests added or strengthened cover:

- `probe-failed` source timestamps.
- Missing legacy `work` with its checkpoint clock.
- Inventory mismatch using injected `checkedAt`, with unchanged register wording.
- Exact register/history reason agreement, including long bounded reasons.
- Invalid `not-yet-run` and injected clocks.
- Known, partial, and unknown timing.
- Unknown timing ranking below a measured hour.
- Actual encoded-byte dropping and `groupsDropped`.
- Visible reason/identifier truncation.
- The measured 288-work-record rotation budget with pessimistic health traffic.

Red-first evidence:

- F2: yes — 3 intended failures; 44 passed.
- F4: yes — encoded output measured 663,878 bytes against 4,096.
- F7: yes — 2 intended failures because `timing` was absent.

Final command:

```bash
npx vitest run tests/fleet-work-groups.test.ts tests/fleet-overseer-status.test.ts tests/fleet-overseer-panel.test.tsx tests/fleet-work-evidence-e2e.test.tsx tests/fleet-usage-card.test.tsx tests/fleet-web.test.tsx tests/fleet-decisions-view.test.ts
```

Summary:

```text
Test Files  7 passed (7)
Tests       559 passed (559)
Duration    28.62s
```

`git diff --check` passed, and focused Biome lint for the new projection passed. GPT Sol’s follow-up review confirmed all findings resolved. The long full-suite commands were not run, as requested.