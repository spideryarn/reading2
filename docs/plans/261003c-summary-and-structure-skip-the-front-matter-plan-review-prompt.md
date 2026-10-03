# Plan review: 261003c, Summary and Structure skip the front matter

You are reviewing a plan, read-only. Do not edit files.

Read `docs/plans/261003c-summary-and-structure-skip-the-front-matter.md` first, then what it cites:

- `src/paperwork.ts`, the shared rule this extends
- `src/simple-summary.ts` (`simpleSystem`, `SIMPLE_PROMPT_VERSION`), `src/tweets.ts`,
  `src/structure-prompt.ts` (`PROMPT_VERSION`, SYSTEM), `src/structure-expand.ts`
  (`EXPAND_PROMPT_VERSION`, EXPAND_SYSTEM)
- `docs/project/prompting-guide.md` § Measuring a prompt change
- `docs/plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md` and
  `evals/paperwork/run.ts`, the earlier change and its harness
- `evals/results/paperwork/after-2/*.json`, the evidence the plan quotes for what Structure does now

Questions:

1. Is the reading of Greg's request right, given that Summary stopped being the per-section outline
   on 2026-10-01? Is anything in his ask left unmet, or is something being built that he did not ask
   for?
2. Treating the front abstract as a label with no question in Structure: what breaks? Consider
   articles with no abstract heading, an abstract merged into the first part, a "Summary" or
   "Key points" box, a closing Summary section, a book chapter, a blog post, and the tree
   invariants (`src/tree-invariants.ts`). Does it conflict with any other gist rule in the
   structure prompts, such as word floors, the depth-1 rules, or the question rules?
3. The Summary rule, "rest the ids on the body passage, not the abstract": is it sound? Could it
   make paragraphs drop (a paragraph whose only checking id is dropped), or push the model to cite
   a weaker passage?
4. Are the version bumps right and complete? Is the claim that a bump makes stored trees and
   summaries `outdated` for their owner true? Check `src/pipeline.ts` and `src/store/pg.ts`.
5. Is the measurement adequate, and is the ship rule falsifiable? What would you add or cut?
6. Anything simpler that gets Greg the same result?

Give findings as P0/P1/P2 with file:line references, and a one-line verdict at the end.
