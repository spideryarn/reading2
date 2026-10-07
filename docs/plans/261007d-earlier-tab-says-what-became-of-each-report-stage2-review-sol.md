I found four P1 issues and applied fixes for all four.

### Findings

- **C6 — P1 — established:** A well-formed 2xx receipt for different words was accepted as success, clearing Greg’s actual draft and displaying the wrong answer.

  - **(a)** Mutation: return `201 { answer: { id: <sent id>, body: "different words", createdAt: ... } }`. Reproduced by `tests/feedback-dialog.test.tsx` → “treats a well-formed receipt for different words as not sent”.
  - **(b)** Require the receipt’s `id` and `body` to equal the submitted values before clearing anything. **Applied.**

- **C7 — P1 — established for typed drafts; reasoned for in-flight transcription:** When a refreshed deployment removed a question, its local draft remained in memory but became unreachable. Closing the dialog during transcription also unmounted the reply box before its result could land. The retained card initially also inflated the “open questions” count.

  - **(a)** Reproduced by removing `q-aaaaaa` from the next `questions` response after typing its draft, and separately closing while `transcribing=true`. Tests: “keeps a draft reachable…” and “keeps the reply box mounted…”.
  - **(b)** Remember questions that still own an open or non-empty local draft, keep their reply box mounted while hidden, and count only the server’s current questions as open. **Applied.**

- **C8 — P1 — established:** The retired waiting list still contained two live instructions, contrary to the new sweep contract. Both had already been decided and built. Four operational notes also contradicted their headers or recorded decisions: reading time and sharing still said “Awaiting Greg”; command-bar batching and OpenAlex still claimed unanswered questions.

  - **(a)** On the candidate:
    ```sh
    git show ed62e3ab4:docs/user-feedback/awaiting-approval.md |
      rg "left behind|want checking|^- 2026-"
    ```
    The new tests also failed under “has no live work left…” and “does not call a shipped note ‘Awaiting Greg’…”.
  - **(b)** Remove the retired live entries and update the four owning notes to the decisions and shipped state recorded by their plans. **Applied.**

- **C9 — P1 — established:** `q-a7kffw` used `report: none`, although its source note names the single report `spya-a5gzb9`. Greg therefore would not see that report’s number and first line beside the question.

  - **(a)** `tests/feedback-endings.test.ts` → “links a question to the one report named by its source note” failed on the candidate.
  - **(b)** Set the question’s report to `spya-a5gzb9` and regenerate the compiled map. **Applied.**

### Other judgments

- The insert-on-conflict race is sound: concurrent identical requests produce one `created` and one `duplicate`, as the existing Postgres concurrency test establishes.
- Permission, pooler and malformed table-existence answers reach exit 2; only a definite `to_regclass(...)=null` reports “not deployed”.
- Owner scoping, admin-namespace authorization and late replies to answered questions are correct.
- Questions and answers render as escaped plain text, with model and reader voices respectively.
- The migration’s reliance on default privileges is explicit. The configured default ACL grants `select, insert, update, delete`; the deploy preflight detects the usual missing-default-grant case through its SELECT check.
- The remaining reported departures—joint Stage 1/2 deployment, `ON DELETE RESTRICT`, no admin rate limit, 12,000-character cap, and parse failures exiting 2—are acceptable.
- I checked all ten question bodies against their source bullets and linked plan sections. I found no unsupported product claims or missing option trade-offs beyond C9’s report metadata.

### Verification

- Feedback dialog: 195 passed.
- Ending/question compilation: 50 passed.
- Answer script: 27 passed.
- Doc links: 18 passed.
- Typecheck: all 3,371 files passed using `node --import tsx scripts/typecheck.ts`. The npm wrapper itself could not create tsx’s IPC socket in this sandbox.
- Generated maps: up to date.
- Lint: no errors; one existing informational complexity notice in `FeedbackDialog`’s report-send function.
- No Postgres-dependent test was added or run.

Changed files:

- [docs/project/feedback.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/project/feedback.md)
- [261001_1914-debate-leads-with-who-has-cited-this.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/261001_1914-debate-leads-with-who-has-cited-this.md)
- [261003_1010-fewer-modes-part-3-why-you-are-reading-feeds-the-bar.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/261003_1010-fewer-modes-part-3-why-you-are-reading-feeds-the-bar.md)
- [261004_2030-share-an-article-with-some-people.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/261004_2030-share-an-article-with-some-people.md)
- [261005_0729-reading-time-line-appears-a-minute-after-the-article-loads.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/261005_0729-reading-time-line-appears-a-minute-after-the-article-loads.md)
- [awaiting-approval.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/awaiting-approval.md)
- [q-a7kffw.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/questions/q-a7kffw.md)
- [feedback-endings.generated.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/feedback-endings.generated.ts)
- [feedback-questions.generated.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/feedback-questions.generated.ts)
- [FeedbackDialog.tsx](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/web/FeedbackDialog.tsx)
- [FeedbackEarlier.tsx](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/web/FeedbackEarlier.tsx)
- [feedback-dialog.test.tsx](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/tests/feedback-dialog.test.tsx)
- [feedback-endings.test.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/tests/feedback-endings.test.ts)

VERDICT: approve with fixes (applied)