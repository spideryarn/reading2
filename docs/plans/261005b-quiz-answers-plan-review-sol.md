The server-side save is a sensible minimal design. A latest-answer upsert would be a simpler product scope than keeping invisible attempt history; if history stays, the question snapshot earns its place. Keeping attempts on the existing GET is reasonable, provided the ordering and cache issues below are handled.

Reviewed candidate `bed0d44c8`. References to “plan” mean [261005b-quiz-answers-are-kept-and-restored.md](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/docs/plans/261005b-quiz-answers-are-kept-and-restored.md).

1. **F1 — P1, established: the offline cache will restore old answers.**  
   Plan lines 76–87 add answers to quiz GETs, but [api.ts:975](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/web/lib/api.ts:975) explicitly exempts marking from cache invalidation. Cache an unanswered quiz, finish an answer, then reload offline: the cached GET still says unanswered. It can also overwrite the newer in-memory map.

   **Change:** name offline caching in the plan. On successful terminal save, update the cached quiz response or refresh it through the existing cache machinery. Preserve the questions when marking fails. Add a test that caches the quiz, finishes an answer, then restores that answer offline. Simply removing the exemption at response-header time would also evict questions for marks that subsequently fail.

2. **F2 — P1, reasoned: a GET started before a save can erase the newly saved client entry.**  
   Plan lines 84–86 seed the map from every GET and separately update it on marking completion. A band-mount revalidation can read before the insert, finish after `done`, and replace the map with the older result. [useQuiz.ts:354](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/web/useQuiz.ts:354) starts that revalidation; ordered reads coordinate GETs, not these local writes. The existing remedy is [useGlossary.ts:495](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/web/useGlossary.ts:495).

   **Change:** specify reconciliation between GETs and completed marks, scoped to slug and batch. Reuse `armRefresh()` for an overlapping GET, and prevent an older response from discarding a newer completion. Have `record()` return the database timestamp and include it in `done`; otherwise the proposed map’s `answeredAt` has no authoritative source. Test a delayed pre-save GET landing after `done`.

3. **F3 — P1, reasoned: restoring inside the existing navigation effects can bind the box to the wrong question.**  
   Plan lines 88–91 assume arrival and filtering always go through `move`. They do not: [QuizPanel.tsx:558](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/web/QuizPanel.tsx:558) handles an arrival at the current index with `setAt` alone.

   Concrete case: mount at Q1 with Q1 filtered out and a prose arrival requesting Q1. The filter moves to Q3; the later arrival writes Q1 back and disables filtering. Restoring Q3 inside `move` leaves Q3’s answer in Q1’s box unless restoration runs again after navigation settles.

   **Change:** specify one restoration point after the final question identity has settled, keyed by slug, batch and question. It must handle delayed saved data without overwriting a draft or live mark. Add combined batch/filter/arrival tests, including same-index arrival and StrictMode.

4. **F4 — P1, established: restoration deletes verdicts earned during the current visit.**  
   Plan lines 90–95 restore an ordinary `done` attempt without a verdict. [QuizPanel.tsx:794](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/web/QuizPanel.tsx:794) treats every such attempt as a new completed mark and deletes the previous verdict at line 801.

   Answer Q1, press Next, then Previous: restoring Q1 removes its current-session verdict. “Where to look again” can lose a section, and subsequent Next can show a premise that was previously suppressed. This is additional loss within a visit, beyond the explicitly accepted loss after returning.

   **Change:** distinguish restoration from a newly completed mark. Restoration must not modify the session verdict map; a genuinely new mark without a verdict should still clear the earlier judgement. Test both cases.

5. **F5 — P1, established: a failed attempts read masquerades as “you have answered nothing.”**  
   Plan lines 79–80 return `attempts: []` on failure, while lines 84–86 seed the saved map from that response. A transient failure therefore removes previously loaded answers from client navigation while the quiz still reports ready—the reported symptom again.

   **Change:** distinguish unavailable attempts from an authoritative empty result, for example `attempts: null`. Preserve previously loaded answers for the same batch and expose a retryable load failure. On initial failure, keep the questions usable but say saved answers could not be loaded. Never preserve another batch’s answers.

6. **F6 — P1, established: only one of the two exports is specified.**  
   Plan line 99 names the reader’s bundle. The rollback export is separate: [export.ts:339](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/store/export.ts:339). Existing reader tables have destinations in both projections at [article-rows.ts:198](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/store/article-rows.ts:198). Implementing only the bundle violates the export contract and leaves the coverage gate failing.

   **Change:** name `ArticleRows`, `readArticleRows`, both `ARTICLE_TABLE_COVERAGE` destinations, and serialization in both export implementations. Exercise both with a sentinel attempt, including a replaced batch if those rows remain retained.

7. **F7 — P1, established: failed saves lose finished answers even within the visit, and tick absence does not explain the failure.**  
   Plan lines 68–70 and 84–87 exclude failed saves from the sole map. [QuizPanel.tsx:755](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/web/QuizPanel.tsx:755) clears the active attempt when moving. After a completed mark whose save failed, Next → Previous therefore restores nothing—or an older successfully saved answer. If an older entry exists, its tick can remain, so tick absence cannot reliably signal failure.

   **Change:** retain the latest finished attempt locally even when persistence fails, with a separate persistence flag. Show a brief save-failure message while keeping the successful mark usable. Test both a first failed save and a failed replacement of an older saved answer.

8. **F8 — P2, established: the disconnect assumption is false.**  
   Plan line 71 says a reader who leaves produces no `done` and no stored row. However, [quiz-verdict.ts:182](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/quiz-verdict.ts:182) swallows cancellation during classification, after which [quiz-mark.ts:849](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/quiz-mark.ts:849) still yields `done`. The proposed route would insert despite having no live recipient.

   **Change:** define the save boundary explicitly. I would keep a completed mark even if its terminal frame cannot be delivered, and amend the claim accordingly. Test leaving during classification and disconnecting after insertion; frame delivery cannot be the guarantee of whether a row exists.

The remaining lifecycle paths look sound: the proposed article FK handles permanent deletion and article-based account erasure; successor revisions retain article identity; reset retains rows under the stated history policy. Public payloads and admin views use explicit projections, so neither automatically exposes the new table. Record those decisions and add focused ownership/public-exclusion checks.

No repository files changed. The two existing offline marking tests passed; they confirm the cache exemption described in F1, rather than validating the proposed implementation.

**Verdict: build with the changes above.**