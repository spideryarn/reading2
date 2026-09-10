## Built

- Added typed kill/broadcast preview envelopes and distinct request arms in [wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/wire.ts).
- Added the bounded 32-entry, five-minute preview table, atomic claiming, replay tombstones, instance checks, exact material validation, and refusal codes in [routes-actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/routes-actions.ts).
- Kill previews now bracket their authoritative process scan with start-token reads, so displayed process details and the stored identity describe one stable observation. Confirmation re-probes before building the signal plan. Each candidate still has the documented exit-and-pid-reuse gap after its final identity read; early candidates also wait for the remaining reads and earlier signal steps.
- Broadcast previews bind speaker, raw status, recipient order, identity, and stagger.
- Legacy `pids` requests are explicitly refused.
- Updated existing server tests from direct execution to preview→confirmation. The old broken-client test now expects `preview-required`.

## Red-first tests

I watched all 16 requested server cases fail before implementation: both happy paths, wrong action, expiry, replay, concurrency, restart, all four material mutations, PID reuse, unreadable boot, excluded candidate, eviction, and legacy `pids`. They now pass.

GPT Sol’s review found and fixed one P1: previews containing over 64 confirmable processes were impossible to confirm. That case is now refused before minting.

The next code review added six focused cases and watched them fail before the fixes: a process replacement between the preview scan and identity read, JSON `-0` normalisation, deeply nested JSON, claimed-tombstone eviction, a table full of live tombstones, and a forged server-instance field. It also strengthened the existing preview-open process-replacement case for the new bracketed read sequence.

## Verification

- Requested suite: **257 passed; only the three named Stage 3 tests remain red**.
- Preview-receipt block: **24/24 passed**.
- Actual wire AST guard: **13 passed, 1 skipped**.
- Source and web TypeScript projects: clean.
- Test typecheck has only the seven errors belonging to the three intentional Stage 3 tests.
- Full `npm test` could not collect because local Postgres/Docker is unavailable in this sandbox.
- No commit made.

## Plan notes / Stage 3

The brief names `fleet-compile-guards` as the wire no-values guard, but the actual AST enforcement is in `fleet-imports.test.ts`; I ran both. The review corrected the cap/tombstone conflict: claimed receipts now remain until expiry, unclaimed previews are evicted first, and a table containing 32 live tombstones refuses another preview until the first expires.

Deliberately left for Stage 3: `boxPreview`/`boxConfirm`, client parsing/rendering, and updating the client test’s old `material.candidates` spelling to canonical `confirmable`.
