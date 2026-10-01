Found and fixed three issues. No unresolved findings within this change.

- **C1 — P1, fixed:** Start over could remain on its loading placeholder forever when an opening turn ended before its `begin` frame, or when deleting an empty local thread. The reducer now discards truly local empty threads and releases the held, idempotent DELETE when the naming turn cannot return. [reduce.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/chat/reduce.ts:278), [test](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/chat-reduce.test.ts:2061).

- **C2 — P1, fixed:** Start over could begin DELETE while Live was still flushing its final spoken POST, allowing the POST to recreate or write into the deleted conversation. Start over now awaits Live shutdown, blocks typed/spoken callbacks synchronously, then deletes and waits before creating the replacement. [ConversationModes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/modes/conversation/ConversationModes.tsx:374), [test](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/remember-own-thread.test.tsx:256).

- **C3 — P3, fixed:** The Remember component test could leave nuqs’s throttled URL update running after jsdom teardown, producing an unhandled `location is not defined` error in longer runs. Cleanup now drains that queue. [remember-own-thread.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/remember-own-thread.test.tsx:131).

The migration looks safe: Drizzle executes the migration statements in one transaction, the table lock spans fold through index creation, destination ordinals are unused and unique, and PK collisions abort the transaction. `withServerIds` also moves the thread, operations and tombstone coherently before later frames arrive. The URL’s Remember selection overriding `?thread=` is intentional, and unrelated Chat deletes cannot share the newly mounted Remember controller.

Documentation now matches the corrected sequencing in [remember-mode.md](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/project/remember-mode.md:292).

Validation:

- 17 files, 339 tests passed.
- Focused reducer/component run: 80 tests passed.
- Typecheck passed for all 2,563 covered source files.
- Biome passed with two existing informational complexity notices.
- `git diff --check` passed.
- PostgreSQL tests were not run, as requested.
- No commit made.

A concurrent plan addition and the pre-existing untracked review-prompt file remain untouched.