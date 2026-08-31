1. **BLOCKER — Write and evaluate the mark prompt before building the route or UI.**

   The plan calls the prompt the feature, then postpones its evaluation until Stage 4 ([plan](/home/greg/code/spideryarn2/docs/plans/260831al-review-quiz-sub-mode.md:233)). That repeats the ordering Review mode explicitly avoided.

   I would put these instructions in the prompt:

   ```text
   SOURCE OF AUTHORITY

   The article is the authority for what the article says. The reference answer
   is a fallible draft written by another model. It is not a rubric or answer key.

   Work out what the article supports before comparing the reader's answer with
   the reference answer. If the reference answer conflicts with the article, is
   narrower than the article, or claims more than the article establishes, say so.
   Never reject an answer merely because it differs from the reference answer.

   WHAT YOU MAY SAY

   Confirm a specific proposition by naming it:
   "Yes: the passage treats X as Y [id]."

   Correct a proposition only when an exact quotation contradicts it by itself:
   "The passage says the reverse: '…' [id]."

   Name an omission only when the question asks for that point and the article
   states it explicitly:
   "The other part the question asks for is X: '…' [id]."

   If the question or reference answer requires an inference the article does not
   settle, say:
   "This question asks for more than the article establishes."

   If the reader is right and the reference answer is wrong or partial, defend the
   reader against the reference:
   "The reference answer is too narrow here. The passage also supports X: '…' [id]."

   CONFIRMING IS NOT GRADING

   Say whether a claim is supported, contradicted, or left open. Do not give a
   verdict on the reader or their answer as a whole. Do not inventory right and
   wrong components.

   No score, grade, praise, encouragement, performance label, or school language.
   Never say "correct answer", "mostly correct", "partly right", "good answer",
   "strong answer", "full credit", "close", "well done", or "you missed".

   CITATIONS

   Every statement about what the article says carries the block id that supports
   it. Every quotation carries the id of the block it came from. Never cite your
   own inference. Never invent an id.

   RESPONSE

   One or two short prose paragraphs, no headings or checklist. Give the most
   important confirmation or correction, then the missing point if there is one,
   and a quoted place to reread. If nothing is missing, stop.
   ```

   The line is: **“The article supports X” confirms a claim; “your answer was correct” grades the reader.** For a wrong answer, say what the passage says and quote it. Do not soften a grade into “close” or “mostly there.”

   Predicted unwanted outputs include:

   - “Great job—you got the main idea.”
   - “You’re mostly correct, but you missed one important detail.”
   - “That’s a strong answer overall.”
   - “Close—the key distinction is…”
   - “The expected answer was X.”
   - “You correctly identified A and B but failed to mention C.”
   - “Full credit would require…”
   - “No, that is incorrect.” without a self-sufficient contradictory quotation.
   - “Although your interpretation is reasonable, the reference answer says…”—the reference is being treated as authority.
   - “The article clearly proves X” where X is the marker’s inference.

2. **BLOCKER — The proposed artefact cannot validate its reference answers. Add exact evidence, and treat the reference as fallible.**

   The plan promises to check “every quoted span” ([plan](/home/greg/code/spideryarn2/docs/plans/260831al-review-quiz-sub-mode.md:81)), but `QuizQuestion` contains no quote field—only a free-text answer and `blockIds` ([plan](/home/greg/code/spideryarn2/docs/plans/260831al-review-quiz-sub-mode.md:85)). Checking that an ID exists proves only that a paragraph exists; it does not prove the reference answer lives there.

   Change the shape to something like:

   ```ts
   interface QuizEvidence {
     blockId: BlockId;
     quote: string;
   }

   interface QuizQuestion {
     id: string; // a question id, not semantically a BlockId
     question: string;
     referenceAnswer: string;
     evidence: QuizEvidence[]; // non-empty; IDs and quotes validated
     difficultyBand: 1 | 2 | 3;
     valueRank: number;
   }
   ```

   Remove the redundant flat `blockIds`; derive them from evidence. Drop a question if no evidence survives. Count malformed scores, invented IDs, unfound quotes, duplicate questions, and unanchored questions. Fail the stage rather than store an empty quiz.

   Exact-quote validation still cannot prove that the answer follows from the quote, so the generation prompt and live human eval must test that semantic link. In the UI, use “Show a reference answer,” not “Show the answer.” The latter presents model prose as canonical.

3. **BLOCKER — The artefact stamp fields are incompatible with the existing store and will make successful quizzes permanently non-current.**

   The plan proposes `model`, `promptVersion`, and `inputHash` ([plan](/home/greg/code/spideryarn2/docs/plans/260831al-review-quiz-sub-mode.md:95)). The shared stamp reader recognizes `generator`, `version`, and `sourceHash` ([artifacts.ts](/home/greg/code/spideryarn2/src/store/artifacts.ts:663)). As written, `stampOf(quiz)` would return an empty stamp. A quiz could be written correctly, then every freshness check would say it needs running again.

   Use the established fields:

   ```ts
   version: string;
   generator: string;
   sourceHash: string;
   profileHash: string | null; // required on new artefacts, if profiling remains
   generatedAt: string;
   elapsedMs: number;
   ```

   Add `quiz` to `STAMP_SOURCE`. Also, the Postgres migration is not conditional: each late artefact has its own `article_revisions` column and storage-map entry ([artifacts-pg.ts](/home/greg/code/spideryarn2/src/store/artifacts-pg.ts:193)). Stage 1 must explicitly include the schema column and migration, not “if the artefacts table constrains kinds.”

4. **BLOCKER — `ease + value` implements the opposite of “easy first.” Replace it with difficulty bands, then value within each band.**

   With the proposed scale, hard-central `(1,5)` ties easy-peripheral `(5,1)`, then wins the value tie-break. The plan even proposes a test asserting that wrong product behavior ([plan](/home/greg/code/spideryarn2/docs/plans/260831al-review-quiz-sub-mode.md:206)).

   Use lexicographic ordering:

   1. Easy, then medium, then hard.
   2. Within a difficulty band, most central first.
   3. Stable model order only as the final tie-break.

   Better still, make difficulty part of question construction rather than an unconstrained after-the-fact score:

   - Easy: explicitly answered in one local passage.
   - Medium: requires a distinction or connection between two statements.
   - Hard: reconstructs a multi-step move across passages.

   Ask for a small quota in each band. Require a relative `valueRank` within each band, rather than independent 1–5 scores that can all be 4. This forces usable spread and directly implements the requested progression. Also instruct generation to omit trivia altogether; “peripheral but easy” should usually not enter the batch.

5. **BLOCKER — Bind every mark to the exact quiz batch the reader saw, and refuse stale source artefacts.**

   Looking up only `questionId` in the current artefact is unsafe. Between rendering and submission, a forced regeneration can replace the reference answer or evidence while preserving the question ID. The server then marks an answer to one batch against another, with no visible error.

   Add a newly minted `batchId` to every quiz and send:

   ```ts
   { attemptId, batchId, questionId, answer }
   ```

   The server must:

   - Reject a source-stale quiz with 409.
   - Reject a mismatched/replaced `batchId` with 409.
   - Load the question, reference, evidence, and article from the same revision/batch.
   - Never silently fall forward to the current quiz.

   This also keeps the attempt-storage door open. A future attempt must bind to an immutable batch or snapshot the question/reference/evidence. It must not point only at a mutable “current question” ID. Adding attempts later otherwise requires either preserving historical batches or copying that context into every attempt row.

6. **SHOULD FIX — The stages are wrong; the prompt eval is late and Stages 1 and 2 leave dead halves.**

   Stage 1 produces an artefact no product reads. Stage 2 produces routes no product calls. Neither is an abandonable product increment. More seriously, the first wrong-reference evaluation happens after the UI has been built.

   Recut the work:

   1. Generation and marking prompts plus a live CLI/eval. Generate a real batch and mark hand-written answers, including poisoned references.
   2. A thin vertical product: durable artefact, job, GET, POST, Review toggle, one question, one answer, one streamed reply.
   3. Show-all, reference reveal, dictation, citations, and URL polish.
   4. Hardening and browser/evaluation sweep.

   The eval must include cases missing from the plan: reader right/reference wrong; reader more complete than the reference; ambiguous or ill-posed question; reference unsupported by its evidence; explicit article contradiction; and a correct answer sourced outside the question’s listed evidence.

7. **SHOULD FIX — Statelessness does not lose spend accounting, but it loses idempotency, diagnosis, and quality evidence. Add content-free telemetry now.**

   If wired through the existing request spend collector, model spend is already stored per owner, article, task, model, outcome, and token/cost totals. An attempt row is not needed for cost attribution.

   Statelessness does cost:

   - No recovery from a disconnected or partially delivered mark.
   - No database idempotency; a retry or double-click can buy the same mark twice.
   - No durable evidence for investigating “this mark was bad.”
   - No way to evaluate real marks later, measure completion, or distinguish abandoned from answered questions.
   - No multi-tab progress or eventual spaced-repetition input.
   - No attempt-based abuse control.

   A stored attempt would not itself solve abuse. The app still lacks a spend limit; authentication and the AI-call ledger are accounting, not a quota.

   Add one content-free structured completion log now: `attemptId`, `batchId`, `questionId`, question ordinal, article slug, answer character count, response character count, duration, terminal outcome, finish reason, known/unknown citation counts, and cache read/write tokens. Never log the answer, reference answer, question text, or generated reply. This supports cost reconciliation and operational debugging, but be honest that semantic quality cannot be reconstructed without opt-in content.

8. **BLOCKER — Specify the stream’s terminal contract. A stateless partial stream is otherwise indistinguishable from success.**

   “Streamed, stateless” is not enough. Existing streaming code has extensive guards because a provider or socket can stop cleanly without actually finishing ([explain.ts](/home/greg/code/spideryarn2/src/explain.ts:630)). If the Quiz client ticks a question when the stream merely closes, a half-sentence will be filed in session state as a successful mark.

   Require:

   - Zero or more `delta` frames, then exactly one explicit `done`.
   - An explicit failure state for timeout, stall, provider error, truncation, empty output, and connection loss.
   - The client marks a question answered only after `done`.
   - A partial reply remains visibly incomplete and retryable.
   - One active request per attempt; disable duplicate submission and abort on replacement/navigation.

   Test a stream that emits two deltas and closes without a finish frame. That is the important test, not a mocked complete SSE transcript.

9. **SHOULD FIX — Add two distinct AI jobs: quiz generation and quiz marking.**

   The plan mentions model renderer/effort only for `quiz`. Generation speaks the Messages wire; interactive marking speaks the chat-completions wire. One `AiJob` cannot correctly describe both.

   Add:

   - `quiz`: pipeline task, Messages wire, article-with-IDs renderer, its measured effort.
   - `quiz-mark`: request-path task, chat wire, its own model/routing row and cost identity.

   Then add both to the exhaustive tier, wire, environment-variable, provider-route, and inventory records. Call `openRouterStream("quiz-mark", …)`, not `"explain"` for convenience; otherwise the cost report will plausibly attribute every mark to Explain.

10. **SHOULD FIX — `?review=quiz` is the right sub-mode parameter, but define its collision with `?thread=` atomically.**

   Quiz belongs conceptually under Review and visibly replaces the whole band, so this does not argue for a thirteenth dock mode. The parameter is justified.

   The collision is currently unresolved. With `?mode=review&review=quiz&thread=<review-id>`, the thread remains selected but invisible. Define:

   - Switching to Quiz atomically sets `review=quiz` and clears `thread`.
   - Opening a review thread atomically sets `review=recall` and `thread=<id>`.
   - On a pasted URL containing both, Quiz wins and `thread` is removed with a replace navigation.
   - Any live Recall stream/session is stopped or handed off before its panel unmounts.

   The plan also leaves selected-question and show-all state outside the URL. Either add one parameter such as `?quiz=all|<question-id>`—while keeping typed answers and answered ticks ephemeral—or explicitly document this as a deliberate exception caused by “reload starts fresh.” At present the plan claims URL-state compliance without deciding it.

11. **SHOULD FIX — Add effect-level checks; the proposed tests mostly restate the implementation.**

   The most likely silent success is the stamp-name mismatch in finding 3. The next is a regeneration button that starts and finishes an unforced job without changing anything; `useIdeas` has an explicit `force: true` precisely because that happened before ([useIdeas.ts](/home/greg/code/spideryarn2/src/web/useIdeas.ts:132)).

   Add checks that observe outcomes:

   - Generate once; assert `stampFor("quiz")` equals the expected non-empty stamp.
   - Run the same named step unforced; assert it skips and records zero model spend.
   - Press “Write them again”; assert a new `batchId` and a real `quiz` model-spend row.
   - Deliberately corrupt every returned block ID; assert the stage fails and writes no empty artefact.
   - Poison a reference answer while leaving its IDs valid; assert the marker sides with the quoted article.
   - Make two live mark calls and require the provider’s second usage to report cache-read tokens. A byte-for-byte prompt test cannot prove the provider used its cache.
   - In a browser, answer a real question, click a citation, and measure that the cited paragraph actually moves into view. A chip existing in the DOM is not that check.

12. **CONSIDER — Cut three copied complexities from v1.**

   - Cut profile-dependent quiz generation unless it is a requirement. It adds `profileHash`, `profileChanged`, regeneration behavior, and another source of question churn. Define ease for a well-read non-specialist first.
   - Replace `suggestedQuestions(words)` with “up to twelve, fewer when the article does not support twelve.” A minimum of six invites padding on short pieces.
   - Do not build ID inheritance unless question IDs have a real consumer such as the proposed `?quiz=<question-id>` link. With no stored attempts and no question URL, inheritance has no v1 benefit. If kept, exact-text inheritance is enough; do not add fuzzy matching.

Overall: no-ship as written. The main design is coherent, but the reference-answer authority, ordering rule, stamp schema, stream completion, and batch binding all need changing before implementation.