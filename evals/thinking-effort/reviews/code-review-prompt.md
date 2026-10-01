# Review + fix: the shipped change from the thinking-effort eval (plan 261001p, stage 4)

You may edit files in this worktree. **Fix what is inside this change, narrowly, red-first where a
test can show it; report, do not fix, anything wider.** Do not commit, and run no git command that
discards work. No network: run `npx vitest run <file>` on tests that need nothing outside the tree,
and `npm run typecheck`. One typecheck error in `tests/chat-empty-reads-from-the-top.test.tsx` is
pre-existing and unrelated.

**Candidate (committed):** `ed849a543` on branch `worktree-thinking-effort-eval`. Use
`git show --stat ed849a543` for the paths and `git show ed849a543 -- <path>` for each diff. Start with
the code; the eval results and docs are evidence for it:

- **`src/models.ts` § `STAGE_EFFORT`**: Sketch goes `high` → `low`. Also the comments on the
  timeline, quiz and faq rows, and `ARTICLE_RENDERER`.
- **The other cache-group comments that named Sketch**: `src/faq.ts`, `src/quiz.ts`,
  `src/timeline.ts`, `src/types.ts`, `src/step-order.ts`.
- **`tests/article-cache-group.test.ts`**, plus the comment and test edits in `tests/faq.test.ts`,
  `tests/quiz-step-registration.test.ts` and `tests/trajectory.test.ts`.
- **The reader-facing wait**: `src/web/sketch-cost.ts` (`SKETCH_WAIT` is now "about a minute").
  `src/web/DiagramPanel.tsx` and `src/web/ResetArticle.tsx` now use it. Its tests:
  `tests/illustrated-view.test.tsx` and `tests/metadata-rerun-section.test.tsx`.
- **The parser**: `src/hierarchy.ts` exports `parseStructureAnswer`, and these evals now call it or
  `parseJsonAnswer`:
  - `evals/hierarchy-structure/model-arms.ts`;
  - `evals/plain-words/run.ts`;
  - `evals/illustrated/run.ts`.

  Its test: `tests/hierarchy-structure-eval.test.ts`. Its postmortem:
  `docs/postmortems/261001b-a-harness-shared-the-request-and-copied-the-parser.md`.
- **`evals/thinking-effort/tally.ts`**: it now reads the candidate arms off the lineup keys, and
  takes `--judging <subdir>`.
- **Docs**: `docs/project/{sketch,illustrated,ideas,hierarchy,prompt-caching}.md`, and the research
  doc `docs/research/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md`.
  Your decision review is `evals/thinking-effort/reviews/decision-review-sol-r1.md`; check that D1–D7
  are addressed.

**Attack:**

1. **Does anything else depend on Sketch being `high`?** For example:
   - `sharesArticleCache` callers;
   - `STEP_ORDER` contiguity (src/step-order.ts and its tests);
   - a stored artefact's freshness keyed on effort, i.e. does changing effort mark existing
     Sketches stale, and should it?;
   - the checkpoint or prompt-version stamps;
   - the eval harness's own `productionEffort` in a manifest;
   - `effortFor` overrides.

   Grep widely.
2. **Is every claim the comments and docs now make about the cache groups true** of the code? Read
   `sharesArticleCache` and both tables.
3. **Does `parseStructureAnswer` keep production's behaviour byte-for-byte**, and does every eval
   that parses a structure answer now go through it? Grep `evals/` and `scripts/` for
   `parseJsonFrom(` applied to a model answer.
4. **Reader copy**: is there anywhere else the old two-minute wait or a Sketch price still reaches a
   reader (`src/web/`)?
5. **Tests**: would each changed test fail if the change were reverted?

**Severity:** P0 = ships a bug or a false claim to readers; P1 = fix before pushing; P2 = worth
changing; P3 = nit. Give every finding an ID (C1, C2, …), with evidence (file:line), and say whether
you fixed it (list the files). End with a verdict: push / push after fixes / do not push.
