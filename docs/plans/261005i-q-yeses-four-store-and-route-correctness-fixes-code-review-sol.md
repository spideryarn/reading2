No remaining established P0/P1 within this stage. I made no commits.

- **CF6 — P1, established and reproduced — fixed.** Comment answering acquired its live hold before SSE setup, outside the cleanup boundary. Header or begin-frame failure left the dead answer’s id in every subsequent sweep’s keep set. In [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-store-route-correctness/src/routes.ts:1755), an outer `try/finally` now covers setup and releases the hold and deep-search allowance. Both new [regression cases](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-store-route-correctness/tests/comment-answer-marker.test.ts) failed for the retained id before the fix and passed afterwards. This completes C’s four-handler lifetime contract.

- **CF7 — P3, established — fixed.** [block-ids.md](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-store-route-correctness/docs/project/block-ids.md:145) still described `blockIdentityFree` and comparisons excluding ids. It now describes the actual replay and exact comparisons, including ids and link targets.

- **CF8 — P3, reasoned — fixed.** [pg-visibility.ts](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-store-route-correctness/src/store/pg-visibility.ts:22) incorrectly claimed that removing the billing lock would permit duplicate publish events. The retained article lock also serializes those toggles. The comment now distinguishes sufficiency from necessity.

- **CF9 — P3, established — fixed.** Added the requested `liveKeys` signpost to [architecture.md](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-store-route-correctness/docs/project/architecture.md:407).

- **CF10 — P1, reasoned, wider and pre-existing — left unchanged.** Search GET still omits the current article fingerprint, so opening saved searches cannot reliably announce stale answers. This is already documented in `search.md`; changing the client panels is expressly outside this stage.

A’s raw block mapping matches the artefact reader, and sanitization preserves the raw copy. B’s new test isolates contention with the processing writer. C’s delayed-return wrappers restore their spies. D’s callers, fake signatures, retries and revisions appear correctly migrated. These database-backed conclusions were assessed from code, not re-run here.

Validation: **104 database-free tests passed**, all four TypeScript projects passed, and touched-file lint reported only advisory complexity findings. The prose corrections also passed checks first observed failing. No Postgres tests ran.

**land after the fixes above**