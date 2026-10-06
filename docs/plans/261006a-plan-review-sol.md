I found two P1 issues and six smaller gaps in the [plan](/var/tmp/spideryarn-worktrees/learn-rename/docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md). No files changed.

1. **PR-1 — P1, established: old-code coercion can persist the wrong answer.**  
   [pg-chat.ts::threadsFor](/var/tmp/spideryarn-worktrees/learn-rename/src/store/pg-chat.ts:245) converts migrated `learn` rows to `chat`. That value feeds `pgChatStore.retry/edit`, then [routes.ts::streamChat](/var/tmp/spideryarn-worktrees/learn-rename/src/routes.ts:3465) passes it to `converse`. Retries and edits send no kind, so the stale-kind rejection does not protect them. A retry can overwrite a Recall answer using Chat’s prompt; the database kind staying `learn` does not prevent this. `exportArticle` also exports the row as `chat`.

   **Change:** make the migration/deploy interval refuse these operations, through a preparatory fail-on-unknown-kind guard or an enforced maintenance window. Add regression coverage for retry/edit against a migrated row. This concerns lasting transcript changes, beyond the accepted temporary outage.

2. **PR-2 — P1, established: dropping `remember` can let browser memory override an explicit link.**  
   [last-view.ts::hasArticleState/restoredHref](/var/tmp/spideryarn-worktrees/learn-rename/src/web/last-view.ts:298) recognise state only through `ARTICLE_PARAMS`. Replacing `remember` with `learn` makes `/read/x?remember=quiz` look bare. With a saved `?mode=quotes&at=…`, that old link now restores Quotes and scrolls elsewhere; without browser history, it can trigger the first-open default. This exceeds the accepted fallback for old links.

   **Change:** move `remember` into `NEVER_REMEMBERED`, as already done for `deep` and `name`. It need not parse or restore anything; it only preserves “the link wins.” Test both restoration and first-open handling.

3. **PR-3 — P2, established: the frozen fold-migration test needs historical fixtures.**  
   [remember-one-thread-migration.test.ts::seed/inRolledBack](/var/tmp/spideryarn-worktrees/learn-rename/tests/remember-one-thread-migration.test.ts:232) only drops the old index before inserting `remember` rows. The new CHECK rejects those fixtures. Renaming them to `learn` instead makes the frozen SQL—which selects only `remember`—fold nothing.

   **Change:** preserve the historical fixture values and index assertions. Temporarily permit `remember` in the CHECK inside the rolled-back test transaction; the current Learn index can remain. Test the new rename migration separately, and explicitly exempt these historical test spellings from the sweep.

4. **PR-4 — P2, established: typed eval consumers must move in Stage 1, and the sweep must be recursive.**  
   [cost/interactions.ts::oneTurn](/var/tmp/spideryarn-worktrees/learn-rename/evals/cost/interactions.ts:254) and [plain-words/artefacts.ts::turn](/var/tmp/spideryarn-worktrees/learn-rename/evals/plain-words/artefacts.ts:465) pass typed `kind: "remember"` to `converse`. Top-level Recall/Explore evals do too. `tsconfig.json` includes all of `evals/`, so changing `ThreadKind` while deferring these consumers prevents Stage 1’s clean typecheck. The proposed `evals/*.ts` sweep also misses the nested callers.

   **Change:** move every typed kind consumer into Stage 1 and search `evals/` recursively, excluding historical artefacts explicitly.

5. **PR-5 — P2, established: Stage 2’s source links depend on Stage 3’s doc moves.**  
   [ConversationModes.tsx](/var/tmp/spideryarn-worktrees/learn-rename/src/web/modes/conversation/ConversationModes.tsx:19) and `converse.ts` cite the two evergreen docs. Stage 2’s sweep requires these references to adopt the new paths, but those files move in Stage 3. [doc-links.test.ts::SOURCE_FILES](/var/tmp/spideryarn-worktrees/learn-rename/tests/doc-links.test.ts:64) checks source comments, so that boundary cannot satisfy both the sweep and `npm test`.

   **Change:** combine Stages 2–3, or move the docs and their signposts alongside the source-reference changes.

6. **PR-6 — P2, established: one command-picker oracle bypasses the literal accept-list rename.**  
   [phrases.ts::BLIND](/var/tmp/spideryarn-worktrees/learn-rename/evals/command-pick/phrases.ts:505) builds expected IDs from `blind.raw.json`. Case **b16** accepts only `submode:remember:quiz` and `mode:remember`; changing literals in `phrases.ts` leaves that case scoring a correct Learn result as wrong.

   **Change:** add a b16 `BLIND_RELABEL` accepting the Learn IDs, preserving the raw dataset.

7. **PR-7 — P2, established: renaming eval prefixes also breaks historical result readers.**  
   [remember-explore.ts::judge](/var/tmp/spideryarn-worktrees/learn-rename/evals/remember-explore.ts:965) and [remember-explore-critic-pairs.ts::load](/var/tmp/spideryarn-worktrees/learn-rename/evals/remember-explore-critic-pairs.ts:40) hardcode `remember-explore.<run>.json` for input as well as output. Mechanically renaming those strings makes retained old runs unreadable through the judging/pairing commands. These prefixes are not derived from filenames, contrary to Stage 2.4.

   **Change:** rename output defaults explicitly, while allowing historical inputs through explicit filenames or a small shared resolver.

8. **PR-8 — P2, suspected: identifier changes may alter picker accuracy or confidence.**  
   [command-pick.ts::choiceAsk](/var/tmp/spideryarn-worktrees/learn-rename/src/command-pick.ts:219) puts IDs directly into the model’s criteria. Moving accept lists proves identifier consistency, not that the measured automatic-run threshold still behaves correctly.

   **Change:** add a bounded post-build eval covering Learn, its sub-modes, old-name requests and nearby Chat/Quiz/Tutorial choices, in a fresh results directory. I found no established accuracy regression.

The migration shape otherwise looks sound: Drizzle runs pending SQL transactionally; dropping the CHECK locks `chat_threads` through the rewrite and index replacement; existing uniqueness prevents duplicate renamed rows; thread identities and message pointers remain unchanged. Generate the snapshot from the final CHECK/index definitions, and omit the illustrative `ALTER INDEX … RENAME` when using DROP/CREATE.

I found no kind-versus-mode equality trap requiring those strings to move together. Canonicalising the explicit-press filter preserves `chat` and `diagram`, while Marginalia’s translation happens before that filter. One atomic implementation stage would nevertheless remove several unnecessary boundary problems.

**Verdict: approve with changes, addressed before building.**