1. **Blocker — the plan’s rejection of F1 was wrong.** A waiting handoff never entered `handedItemChats`; after sending, its origin bridge was cleared before the asynchronous summary refresh necessarily completed. Returning to Quiz during that gap could create a second stored chat for the same mark. Evidence: [plan:261](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:261), [ConversationModes.tsx:1021](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/modes/conversation/ConversationModes.tsx:1021), [Reader.tsx:2844](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/reader/Reader.tsx:2844).  
   **fixed:** retained draft origins through sending and server ID correction, added origin-to-draft lookup, made Reader use it until summaries contain the thread, then clear it. Added lifecycle regression coverage.

2. **Blocker — pressing an existing Quiz chat mark appeared to do nothing.** `QuizPanel` called `openClaimChat` directly, but Learn suppresses the floating chat card; only the URL changed while Quiz remained visible. Evidence: [QuizPanel.tsx:1489](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/QuizPanel.tsx:1489), [Reader.tsx:2901](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/web/reader/Reader.tsx:2901).  
   **fixed:** the Quiz mark callback now switches Learn’s band to Chat before opening the thread. Added wiring coverage for this and the way back to the exact batch/question.

3. **Blocker — the export/reseed test was a false positive.** The plan said the seeder could remain unchanged, but the test left the referenced `quiz_attempts` row in place; therefore the composite FK did not prove that an empty restore worked. Evidence: [plan:262](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:262), [chat-origin-route.test.ts:1036](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/tests/chat-origin-route.test.ts:1036).  
   **fixed:** the seeder now restores exported Quiz attempts before chat threads, preserving attempt IDs; the test deletes both rows before reseeding and asserts both return. See [seed-reader-state.ts:246](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/tests/helpers/seed-reader-state.ts:246).

4. **Nit — several comments still described four or five origin columns and the rejected draft lifecycle.** Evidence: [schema.ts:4671](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/db/schema.ts:4671), [pg-chat.ts:381](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/store/pg-chat.ts:381), [types.ts:4584](/var/tmp/spideryarn-worktrees/fbtwsm7t-quiz-chat-origin/src/types.ts:4584).  
   **fixed:** updated the schema/store/type/component and migration-registry descriptions.

Verification:

- 11 targeted test files: **340 passed**
- Migration-registry test: **9 passed**
- Typecheck: **all 3,969 source files passed** via the direct runner; `npm run typecheck` itself could not create its IPC socket under the sandbox
- Targeted lint and `git diff --check`: passed, with existing advisory complexity warnings
- The database-backed `chat-origin-route` test could not connect to local Postgres because sandbox networking returned `EPERM`; no database or migration was changed
- No commit or push

**Verdict:** approve with the fixes made, subject to rerunning the database-backed route test outside this sandbox. I found no further defect in route validation/409 behavior, retry/edit handling, origin serialization, CHECK/FK design, Chat-list opening, or the Quiz way back.