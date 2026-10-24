1. **Blocker — the unsent handoff can still create two chats for one mark.**

   Evidence: the plan uses `handToChat(..., "wait", origin)` and expects `reopenItemChat` to find it ([plan:219](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:219)). But a waiting handoff only stores its draft and origin; it does not call `onHandoffThread` ([ConversationModes.tsx:1014](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/modes/conversation/ConversationModes.tsx:1014)). Consequently, it never enters `handedItemChats` ([Reader.tsx:1207](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/reader/Reader.tsx:1207)), and `reopenItemChat` can see only server summaries or that registry ([Reader.tsx:2833](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/reader/Reader.tsx:2833)). Returning to Quiz before sending therefore still shows Discuss—D6 uses only summaries ([plan:227](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:227))—and another press starts another local draft. Merely registering the initial ID is insufficient because recovery can remint it without notifying Reader ([ConversationModes.tsx:1189](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/modes/conversation/ConversationModes.tsx:1189)).

   Concrete change: add an explicit optimistic origin-to-draft lifecycle for waiting handoffs. Register it as soon as the handoff is taken, update it whenever `drafts.moveThread` or server ID correction changes the ID, and expose it to Quiz so the pending chat replaces Discuss and reopens the existing composer. Test a second press:

   - before the first send;
   - after sending but before summaries refresh;
   - after server ID correction;
   - after a new attempt, which must start a different chat.

   The current test sentence says “a second press makes a second chat” ([plan:259](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:259)); it must say the opposite for the same attempt.

2. **Blocker — the composite FK cannot survive the rollback export/seeder path as planned.**

   Evidence: `quiz_attempts.id` is the proposed durable target and is already a UUID primary key ([schema.ts:6130](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/db/schema.ts:6130)), but the rollback `quiz-attempts.json` omits it ([export.ts:1047](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/store/export.ts:1047)). The test seeder inserts chats with their mapped origins ([seed-reader-state.ts:256](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/tests/helpers/seed-reader-state.ts:256)) but does not restore quiz attempts at all ([seed-reader-state.ts:433](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/tests/helpers/seed-reader-state.ts:433)). A restored Quiz-origin thread would therefore reference a missing attempt, and even adding an attempt seeder without exporting its original UUID would produce the wrong target. D8’s claim that export “inherits `originFromColumns`” only covers the thread half ([plan:246](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:246)).

   Concrete change: export each attempt’s `id`; add attempt restoration preserving that UUID; and make reseeding explicitly:

   1. delete chat messages and threads;
   2. delete old attempts;
   3. insert attempts;
   4. insert threads and messages.

   Add a fresh-database round-trip containing a Quiz-origin chat, rather than relying on attempts already present in the source database.

3. **Should-fix — the route does not make `origin.quote` authoritative.**

   Evidence: D4 checks that the attempt belongs to the article, batch and question, but not that its question text matches the supplied `quote` ([plan:210](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:210)). The composite FK likewise covers IDs only. Yet the immutable question snapshot already lives on the attempt precisely because batches can disappear ([schema.ts:6115](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/db/schema.ts:6115)), and the supplied quote will drive titles, list text and the way back.

   Concrete change: have the attempt lookup return `question` and construct the stored `quote` server-side as `originName(attempt.question)`, or reject a supplied quote that differs from that value. Add a forged-quote route test. The former is preferable because the database row is already the authority.

4. **Should-fix — the FK design is sound, but the plan needs tests of the actual deletion behaviours, not only the transfer ordering constant.**

   Evidence: both `chat_threads.article_id` and `quiz_attempts.article_id` cascade on article deletion ([schema.ts:4511](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/db/schema.ts:4511), [schema.ts:6133](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/db/schema.ts:6133)). For a single article-delete statement, PostgreSQL’s immediate `NO ACTION` check is compatible with those cascades: both referencing and referenced rows are removed by that statement. Transfer is also ordered correctly—threads precede attempts ([admin-articles.ts:85](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/admin-articles.ts:85)), and deletion follows that order ([pg-article-transfer.ts:543](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/store/pg-article-transfer.ts:543)). I found no production path that directly deletes individual attempts. `db:reset` drops/rebuilds the database and is not an ordered row deletion. There is, however, direct test cleanup that deletes attempts first ([quiz-attempts-route.test.ts:174](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/tests/quiz-attempts-route.test.ts:174)); it will fail if that fixture ever contains a linked chat.

   Concrete change: add database-backed tests proving:

   - deleting an article containing a linked Quiz chat cascades successfully;
   - transferring such an article deletes threads before attempts and succeeds;
   - direct deletion of a referenced attempt is refused;
   - test cleanup deletes linked threads first.

   With the export/seeder repair in finding 2, the composite FK is worth keeping: unlike a simple FK on `attempt_id`, it enforces that the denormalized article, batch and question genuinely belong to that attempt.

5. **Should-fix — the Stage 2 test list misses the recipe’s silent routing and way-back cases, and contradicts D1.**

   Evidence: D1 correctly says Quiz needs bespoke test arms because its identity is not the generic item shape ([plan:163](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:163)); the test section instead says to add it to the existing `describe.each` lists ([plan:259](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:259)). The house recipe specifically requires `thread-source` plus a rendered press, mark, line back and landing test ([chat-from-a-mode.md:228](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/project/chat-from-a-mode.md:228)).

   Concrete change: replace the generic-list instruction with bespoke Quiz cases covering:

   - mapper round-trip and two batches sharing one question ID;
   - route, CHECKs, composite FK and export/restore;
   - transaction collision/resend and handoff fencing;
   - `threadSource` exactly producing `from: "learn"` and `place: "Quiz"` with no `learn`;
   - a Chat-list row opening in Chat, remaining renameable/deletable, and appearing under the Learn filter;
   - the back line landing on the exact current-batch question, and safely opening Quiz normally for a stale batch;
   - the pending mark/reopen lifecycle and the 390px placement.

Verdict: **revise before build**. Exact attempt identity and `sameOrigin` by `attemptId` are sound. The composite FK is also sound and preferable to a simple FK once export/restoration and deletion tests are added. A chat-kind Quiz thread whose source says `from: "learn"` does not otherwise break routing: origin handling produces no `source.learn`; `ChatPanel` therefore opens it in Chat, while listing/openability and Learn’s pinned conversations continue to depend on thread kind, not the source label ([thread-source.ts:165](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/thread-source.ts:165), [ChatPanel.tsx:1205](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/ChatPanel.tsx:1205), [ConversationModes.tsx:564](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/modes/conversation/ConversationModes.tsx:564)). The blockers are the unsent-draft lifecycle and the attempt-ID export/seeder seam. No files were edited.