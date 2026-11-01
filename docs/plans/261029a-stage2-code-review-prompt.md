# Code review: Structure stage 2 — measured, not shipped (what lands on `dev`)

You are reviewing code before it is pushed to `dev`. **You may fix what you find inside this
stage** (the files below); report anything wider for me to decide. Run the gates you touch
(`npx vitest run tests/structure tests/structure-fourth-level-eval.test.ts tests/doc-links.test.ts tests/feedback-endings.test.ts`,
`npm run typecheck`). Do not run anything that spends model money: `evals/structure-fourth-level/run.ts`
is paid. `report.ts` is free and needs the gitignored `data/` the runs wrote, which is present here.

Background: plan `docs/plans/261029a-structure-one-level-deeper.md` § Stage 2 and § Stage 2 as built;
your plan review `docs/plans/261029a-stage2-plan-review-sol.md`; the write-up
`docs/investigations/261101b-structure-fourth-level-two-wordings-measured.md`. Two toc/14 prompt
wordings were built (df05311ea, e2482c1fc), measured, and failed a quality gate, so c9e2e8e41
restored `src/structure.ts` and `src/structure-prompt.ts` to toc/13's bytes (087a9b260) apart from
the run counts.

**The net diff to review is `git diff 38c35ef26..HEAD`**:

- `src/structure-depth.ts` (new) — `depthCounts`: sub-sections, deepened sections, swallowed
  headings; wired into `StructureRun` and `finishStructureRun` (`src/structure.ts`) and the step's log
  (`src/pipeline.ts`).
- `evals/structure-fourth-level/{run,score,report,corpus,wordings}.ts`,
  `tests/structure-fourth-level-eval.test.ts`, `evals/results/structure-fourth-level/*.json`.
- Docs and feedback bookkeeping: the plan, the investigation, `docs/user-feedback/261029_0300-…md`,
  `questions/q-vrnbyj.md`, `questions/q-k25zfg.md` (a new question to Greg; plain text, no markdown).

Questions, most important first:

1. **Is the live prompt really toc/13 byte for byte?** Confirm `SYSTEM`, `STRUCTURE_OUTPUT_SCHEMA`,
   `PROMPT_VERSION` and the four pinned tests equal 087a9b260's, so nothing a reader sees moves.
2. **`depthCounts` on the production path**: can it throw or be slow inside `finishStructureRun` on
   any tree the step can build — supplement nodes, a headings-fallback tree, a 2,000-block book
   (it is O(headings × internal nodes))? A throw there would fail an article's structure step for a
   log line. Are the swallowed-heading false positives and negatives acceptable for a diagnostic?
3. **`report.ts`'s verdict**: does it do what its header says, including the section-loss gate
   added after the first report missed it? Is anything gated that should only be printed, or the
   reverse? Does `wordings.ts` hold the two measured wordings exactly (compare with df05311ea and
   e2482c1fc)?
4. **The write-up and the question**: does anything in them claim more than the results files
   show? Check the numbers against `report.ts` output.

Write findings to the answer file as a numbered list with severity, file:line, and what you changed
or recommend.
