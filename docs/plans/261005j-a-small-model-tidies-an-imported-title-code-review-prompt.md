# Code review: a small model tidies an imported title

You are reviewing code that is built and uncommitted in this worktree. **Fix what you find inside
this change's scope**, and report anything wider for me to decide. Do not commit.

The box is short of memory. Run only targeted test files, never the full suite, and wrap every
vitest or typecheck run so they take turns:
`flock /var/tmp/spideryarn-heavy.lock npx vitest run <files>`.

Read, in this order:

- `docs/plans/261005j-a-small-model-tidies-an-imported-title.md` — the plan, including what your
  plan review changed.
- `docs/investigations/261005b-title-tidying-rule-against-a-small-model.md` — the measurement.
- `git status` and `git diff HEAD` — the whole change. New files: `src/title-tidy-model.ts`,
  `tests/title-tidy-model.test.ts`, `evals/title-tidy/`.
- The seams: `src/extract.ts` § `runExtract`, `src/pdf-read.ts` § `runPdfExtract`,
  `src/paper-metadata.ts` § `paperMeta` / `paperTitle`, and in `src/pipeline.ts`: `titleTidiers`,
  `stepTitleTidier`, the `extract` step and the `metadata` step.

Please check, by running code where you can:

1. `isLightEdit` in `src/title-tidy-model.ts`. Attack it: find an answer it accepts that changes a
   word, a digit, a symbol, a word break, or the case of a mixed-case title, or that cuts anything
   but the declared site's name, a bracketed identifier, `Microsoft Word - `, a file extension or a
   footnote mark after a word. Find a plainly good answer it refuses. Look hard at the index
   arithmetic (lower-casing that changes length, NFC, astral characters), at `ENDS_AT_SEPARATOR`
   and `STARTS_AT_SEPARATOR`, and at `isSite` (a site's name that is one letter, or a common word
   inside a subtitle).
2. The fallback in `modelTitleTidier`: is there any way a failed call fails an import? Is rethrowing
   on the caller's abort right, and is the timeout distinguished from it correctly?
3. `stepTitleTidier` in `src/pipeline.ts`: is holding the previous revision's pair correct at all
   three seams, including the minimal-to-full transition (*Read this*) and a first import where
   there is no previous `meta`? `metaColumns` passes both strings through `plainTitle`; can the
   stored original fail to equal the next raw title when it should?
4. The request: one JSON object for the three page-controlled fields. Anything a hostile title,
   site name or language can still do?
5. The registries: `title-tidy` in `src/models.ts`, `src/ai-call.ts` (`AI_JOB_ROUTE`,
   `CHAT_REASONING`), `src/cost-categories.ts`, `src/plain-words.ts`. Is any exhaustive record or
   coverage test missed (`tests/no-undeclared-spend.test.ts`, the privacy page's model list test,
   `npm run check`'s knip)?
6. Tests: does each new test fail when the behaviour it names is removed? Mutate and see. Which
   existing test files run the real `extract` or `metadata` step and would now reach the provider
   guard (`tests/setup/provider-guard.ts`)? I found `tests/article-registry-pipeline.test.ts` and
   `tests/minimal-paper.test.ts` and gave each a spy; find any others.
7. The conclusion: read the investigation's numbers against
   `evals/title-tidy/run.ts`. Does the write-up claim anything the method cannot support?
8. Anything else that is a bug, a silent failure or needless complexity.

Do not edit any doc to attribute words to Greg. His only words on this are the two quotations at
the top of the plan.

Write your answer as a numbered list: severity (P0 to P3), what it was, **Fixed** or **Unfixed and
why**. End with what you ran and a one-line verdict.
