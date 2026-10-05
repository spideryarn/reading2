Found five issues and fixed all of them. No unresolved P0 or P1 remains.

## Findings

- **CR-1 — P1, established, fixed.** `EXPLORE_SYSTEM` contradicted its citation/provenance rules: it could attach a block ID to the model’s objection, and it searched for the author’s answer only after objecting. I made the order explicit—inspect the strongest answer first—and separated the cited article claim from the model’s uncited reasoning. Fixed in [converse.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/converse.ts:1403), with red-first coverage in [explore-kind.test.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/tests/explore-kind.test.ts:167) and matching documentation.

- **CR-2 — P1, reasoned, fixed.** “Their doubt first” could make Explore return to an old doubt on every later turn, turning the whole conversation into fault-finding. The prompt now follows the reader’s latest message and uses an earlier note only when relevant. Requested comparisons are explicitly prose without bullets or numbering, resolving the FORMAT tension. Fixed in [converse.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/converse.ts:1397).

- **CR-3 — P2, established, fixed.** `--rescore` did not actually apply `parseLabels` to saved answers, so pre-`critique` labels silently counted as zero rather than `unlabelled`. It also rewrote historical judge items/key files and added an empty critic row to old runs. A red reproduction showed all three failures. Rescoring now reparses saved raw answers, preserves historical inputs, verifies the saved key, and derives readers from the run. Fixed in [remember-explore.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/evals/remember-explore.ts:903) and covered by [remember-explore-eval.test.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/tests/remember-explore-eval.test.ts:1). The reproduced old result now reports `1 unlabelled`, has no critic row, and leaves item/key hashes unchanged.

- **CR-4 — P2, established, fixed.** Several new tests could pass without protecting the intended behavior: the prompt test mostly checked headings, the panel test clicked a different starter, and command matching did not assert first-ranked results. The tests now cover provenance/order, the actual critique starter, and ranking for `learn`, `remember`, `recall`, `quiz`, and compound names. Fixed in [explore-kind.test.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/tests/explore-kind.test.ts:167), [remember-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/tests/remember-panel.test.tsx:306), and [command-bar-sub-modes.test.tsx](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/tests/command-bar-sub-modes.test.tsx:278).

- **CR-5 — P3, established, fixed.** Evergreen docs and source comments conflated the visible Learn umbrella with Recall’s stored `remember` thread, rewrote historical Remember references into the present name, named a nonexistent `learn` identifier, and described Chat’s Learn-thread list as unbuilt. I corrected those distinctions. No existing quotation of Greg was altered; the candidate only added the new dated quotation.

## Checks with no finding

- Reader-facing naming consistently uses Learn. The remaining “Remembering” composer text is a verb, not the mode name.
- Identifiers, URL state, stored values and test IDs remain `remember`.
- `FORMER_PARENT_NAMES` is minimal and correct. The generated command-picker catalogue matches it.
- `learn`, `remember`, `recall`, `quiz`, `learn quiz`, and `remember quiz` route and rank correctly.
- `CHAT_FROM_LABEL`, visitor copy, page title, Help, Features and Landing copy follow the visible Learn label.
- The catalogue description is longer, but still a single useful sentence and not a defect.
- The eval can measure C1–C6 through its critic turns, judge labels, score table, flags and required manual transcript screens.

## Verification

- Requested focused suite plus the new eval compatibility test: **148 passed, 2 skipped**.
- Typechecking: **all 3,220 source files passed** using `node --import tsx scripts/typecheck.ts`.
- `npm run typecheck` itself was blocked by the sandbox denying `tsx`’s IPC socket; the equivalent underlying command passed.
- `git diff --check`: passed.
- Touched-file lint: no errors; only existing complexity notices.
- `npm test` could not run because the repository’s database gate found no Postgres.
- No paid/model eval or browser screenshot run was possible without network/database access.
- An optional repository-wide unit run was stopped after widespread unrelated sandbox failures in remote-shell, worktree, subprocess and localhost-dependent tests.

## Files changed

- `src/converse.ts`
- `src/mode-catalog.ts`
- `src/modes.ts`
- `src/web/CommandBar.tsx`
- `src/web/Dock.tsx`
- `src/web/command-match.ts`
- `evals/remember-explore.ts`
- `tests/command-bar-sub-modes.test.tsx`
- `tests/explore-kind.test.ts`
- `tests/remember-explore-eval.test.ts`
- `tests/remember-panel.test.tsx`
- `docs/project/chat-tools.md`
- `docs/project/comments.md`
- `docs/project/debate.md`
- `docs/project/dictation.md`
- `docs/project/live-conversation.md`
- `docs/project/reader-profile.md`
- `docs/project/reading-view-overview.md`
- `docs/project/remember-mode.md`
- `docs/project/touch.md`

VERDICT: ship with the fixes above