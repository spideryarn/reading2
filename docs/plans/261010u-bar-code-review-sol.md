VERDICT: rethink

1. [CommandBar.tsx:881](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/web/CommandBar.tsx:881) — **Medium, left for you.** F5 still does not hold: the fold control is a `role="option"` inside the listbox, without `aria-expanded` or `aria-controls`. I fixed collapse selection so it moves to Guide/the first ordinary row, but making this a real button outside the listbox while keeping Guide visually first requires choosing a different popup/composite structure.

2. [command-suggest-client.ts:71](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/web/command-suggest-client.ts:71) — **Medium, fixed.** Any successful JSON response previously confirmed persistence, including `{ok:false}`. It now requires exactly `{ok:true}`; malformed success rolls the optimistic dismissal back.

3. [CommandBar.tsx:1780](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/web/CommandBar.tsx:1780) — **Medium, fixed.** Local dismissals were scoped to one response object, allowing a same-fingerprint re-ask to race a pending write and restore the suggestion. They are now scoped to `(slug, readFrom)`, without leaking across fingerprints. Obsolete failures no longer announce against a replacement list.

4. [CommandBar.tsx:2119](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/web/CommandBar.tsx:2119) — **Medium, fixed.** Dismissal and rollback retained a numeric selection, which could silently move Enter onto an unrelated command. Selection is now reconciled by row identity, with backfill and empty-list fallbacks. Delete also now works for whitespace-only input at [CommandBar.tsx:2735](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/web/CommandBar.tsx:2735).

5. [routes.ts:8316](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/routes.ts:8316) — **Medium, fixed.** A delayed dismissal from an obsolete fingerprint could replace newer dismissals. The route now recomputes the current fingerprint from stored profile data and rejects stale writes with 409.

6. [pg-suggestion-dismissals.ts:44](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/store/pg-suggestion-dismissals.ts:44) — **Medium, fixed.** Fingerprint changes re-dated `created_at`, violating the immutable creation-time rule. Only `dismissed_at` now moves.

7. [routes.ts:10682](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/routes.ts:10682) — **Low, fixed.** The dismissal route used spend attribution despite never calling a model. It now uses `article: "none"`.

8. [command-bar-suggest.test.tsx:1060](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/tests/command-bar-suggest.test.tsx:1060) — **Low, fixed.** The Guide test proved order and uniqueness but not that the row came from the executor. It now activates Guide and observes the executor call.

F1–F4 and F6–F10 otherwise hold: same-fingerprint upserts are atomic, deduplicate and retain the newest 50; schema checks match the syntactic route bounds; ownership is 401/404-safe; no suggestion words are stored or logged; dismissals never enter the model prompt; interleave-then-cap and backfill are correct; Guide appears once.

Files edited:

- [src/command-suggest.ts](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/command-suggest.ts)
- [src/db/schema.ts](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/db/schema.ts)
- [src/routes.ts](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/routes.ts)
- [src/store/pg-suggestion-dismissals.ts](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/store/pg-suggestion-dismissals.ts)
- [src/web/CommandBar.tsx](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/web/CommandBar.tsx)
- [src/web/command-suggest-client.ts](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/src/web/command-suggest-client.ts)
- [tests/command-bar-suggest.test.tsx](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/tests/command-bar-suggest.test.tsx)
- [tests/command-suggest-route.test.ts](/var/tmp/spideryarn-worktrees/fbyf23zk-bar-suggestions/tests/command-suggest-route.test.ts)

Tests and checks:

- `npx vitest run --project unit tests/command-bar-suggest.test.tsx tests/command-suggest.test.ts tests/authenticated-api-route-contract.test.ts tests/store-guarded.test.ts tests/action-tables-have-created-at.test.ts` — **660 passed**.
- `npx vitest run --project unit tests/command-bar-guide.test.tsx tests/command-bar.test.tsx` — **89 passed**.
- `node --import tsx scripts/typecheck.ts` — **passed all projects**.
- `git diff --check` — **passed**.
- Focused private-Postgres route test — **could not start** because the sandbox cannot reach Docker/Postgres at `127.0.0.1:54362`; no database test executed.
- `npm run typecheck` itself could not open tsx’s IPC socket under the sandbox; the equivalent direct invocation above passed.
- Focused Biome lint — no errors; 12 advisory complexity findings in existing large functions.