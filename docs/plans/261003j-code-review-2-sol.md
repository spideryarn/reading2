The statement is **not accurate for the committed candidate**: repeated shelf settings invent a new change time. I applied a fix, but its Postgres verification remains outstanding.

**F10 — P1, established: repeated settings advance `articles.updated_at`.**

Input: PATCH an unarchived article with `{ archived: false }`, or resubmit its current normalized title/purpose. `pg-shelf.patch` stamps every non-empty patch, even when no value changes.

Applied: compare supplied normalized values against the stored row inside the UPDATE; advance the clock only if one differs. This preserves existing times and legacy null without a read/write race. Added regressions for null, normalized repeats, both archive states and mixed patches. **Unverified on Postgres**; tests were written before the fix, but I could not observe them red or green.

**F11 — P2, reasoned: settings clocks can predate the change they record.**

Input: an application clock behind Postgres makes High-powered AI write an older `updated_at`. A date captured before a blocked query, or shelf’s transaction-start `now()`, also risks incorrect ordering.

Applied: use database `clock_timestamp()` for the new settings clock in shelf and High-powered AI writes. Existing `high_power_since` behavior is preserved. Billing already obtains its charge time from Postgres after its locks.

Added a slow-application-clock regression covering both switch directions. **Unverified on Postgres**; the lock race itself remains reasoned.

**F12 — P2, established, wider: a stale chat finish still changes thread ordering.**

Input: call `pgChatStore.finish` with a losing attempt token. The message and its `finished_at` remain untouched, but the preceding unconditional UPDATE moves `chat_threads.updated_at`.

This predates the stage and explicitly preserves the existing store contract, so I left it unchanged. If “changes nothing” must cover the thread too, move that UPDATE after the fenced message write and guard it on returned rows:

```ts
if (written.length > 0) {
  await tx.update(chatThreads)
    .set({ updatedAt: at })
    .where(and(
      eq(chatThreads.articleId, articleId),
      eq(chatThreads.id, threadId),
    ));
}
```

No missed production completion/reset writer was found in the alternate-path audit. The twelve schema columns and migration agree: nullable, no defaults, no backfill. User-message edits preserve completion time; a second accepted Stop correctly advances the latest-request clock.

Validation: F8/F9 offline regressions **32 passed**; doc-link tests **16 passed**; typecheck, touched-file lint and diff checks passed. No Postgres tests ran. Nothing committed; migrations untouched.

**REFUSE** — F10 blocks the committed candidate; the applied fix needs Postgres verification.

Files changed:

- [src/store/pg-shelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/pg-shelf.ts)
- [src/store/pg-high-power.ts](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/store/pg-high-power.ts)
- [tests/event-times.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/tests/event-times.test.ts)
- [Root-cause write-up](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/docs/postmortems/261003c-payload-presence-is-not-a-state-transition.md)