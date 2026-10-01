# Code review (round 1): 261001m — Remember is its own single thread

You are reviewing AND fixing, in this worktree. The change under review is commit `46e9f57a1`
(`git show 46e9f57a1`; its first parent is the base). A later merge of `origin/dev` followed; ignore
files that only the merge brought in.

Read first: the plan `docs/plans/261001m-remember-is-its-own-single-thread.md` (including §
Changed by GPT Sol's plan review — your round-1 plan findings F1–F9 and what was taken), and
`docs/project/remember-mode.md` as edited.

What changed:
- `drizzle/20261001143901_remember_one_thread.sql` — hand-completed fold + partial unique index.
- `src/db/schema.ts` — the index. `src/chat.ts` — `targetOf`, used by `withTurn` / `withSpokenTurn`.
- Client: `src/web/modes/conversation/ConversationModes.tsx` (own-kind lists, `oneRemember`,
  derived Remember thread, `?thread=` sync, Start over waiting on `deleting`), `src/web/ChatPanel.tsx`
  (Remember header/controls, `boxSize` compact composer), `src/web/useChat.ts` (`deleting`,
  `remove(id, { restoreOnFailure })`), `src/web/chat/model.ts` (`withServerIds` coalescing),
  `src/web/chat/reduce.ts` (`refusedDelete`), `src/web/media.ts` (`useMedia`), `Reader.tsx`.
- Tests: `tests/remember-one-thread.test.ts`, `tests/remember-one-thread-migration.test.ts`
  (Postgres), `tests/remember-own-thread.test.tsx`, `tests/chat-server-id-coalesces.test.ts`, and
  edits to existing tests that encoded the old shared list.

Evidence I ran (you have no network or Postgres; do not try the Postgres test):
`npm run typecheck` clean; `npx vitest run` on 19 files — the new ones plus remember-panel,
remember-url-rules, migration-journal, migration-snapshots, store-migration-registry, doc-links,
chat-reduce, conversation-band-{handoff,live,send-new}, every-mode-draws-its-surface,
mode-surface-changes-no-markup, store-chat-pg, remember-store, remember-route — 376/376 passed,
including the 3 migration tests (fold byte-identity, abort on pending attempt, PK collision fails).
You may run any non-Postgres test file yourself (e.g. `npx vitest run tests/remember-own-thread.test.tsx`).

Look hardest at:
1. Data safety of the migration SQL (statement order, the max+row_number ordinals under the
   per-row unique `(article, thread, ordinal)` check, temp table `ON COMMIT DROP` under drizzle's
   migrator — is it inside one transaction?, the lock).
2. The F1 fix: can any path in Remember still send a POST while a delete is in flight, or wedge on
   the loading placeholder forever (the agent noted: a delete held behind a first answer that fails
   before the server names the thread never finishes)?
3. `withServerIds` coalescing: stream frames after `begin` that address the provisional id; the
   tombstone/ops maps keyed by thread id; recovery.
4. The derived Remember thread vs live sessions (hang-up on thread change), the handoff, StrictMode.
5. The compact composer: does `useMedia` SSR/test-safe; does the autosize still grow.
6. Docs vs code: remember-mode.md's new sections must say only what the code does.

Fix what is inside this change, narrowly, red-first where it is a behaviour bug (write the failing
test, see it fail, fix). Do not commit. Report, do not fix, anything wider. Severity P0 (data loss /
prod break), P1 (reader-visible wrong behaviour), P2, P3; give each finding an ID (C1, C2…),
file:line evidence, and say whether you fixed it and which test proves it.

My own suspicions, last: the `deleting` flag being true for ANY delete op (a chat delete in another
mode can't be in flight in Remember's band, but check), and `oneRemember` choosing a thread with
messages over the URL's.
