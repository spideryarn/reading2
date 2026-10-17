You are reviewing CODE in the Spideryarn repo (this worktree) before it is pushed. Since 2026-09-09
the house rule is: **fix what you find inside this change's scope** (edit the files), and report
anything wider for the author to decide. Do not commit; do not touch git state; do not run anything
that writes to a remote database or calls a paid API.

The change: docs/plans/261017a-an-arxiv-paper-with-no-title-takes-its-title-from-its-own-opening.md
(read it, including § After the plan review and § Measured). Your own plan review is
docs/plans/261017a-an-arxiv-paper-with-no-title-takes-its-title-from-its-own-opening-plan-review-sol.md.

The scoped diff (commits 5b79471a7 and 5698da91a, fixture excluded):
/tmp/claude-1000/-home-greg-code-spideryarn2/3447fe13-83bf-4e54-a03c-addcb4cb42be/scratchpad/code.diff
(or `git diff 5b79471a7~1 HEAD -- src scripts tests`).

Files: src/latexml.ts (`latexmlUntitled`), src/extract.ts (`readArticle`/`readingArm` plumbing of
`untitled`, `untitledPlaceholder`, the title choice in `runExtract`), src/opening-title.ts (new),
src/pipeline.ts (wiring), src/models.ts, src/ai-call.ts, src/cost-categories.ts (registration),
tests/latexml-untitled.test.ts, tests/opening-title.test.ts, scripts/eval/opening-title.ts.

Evidence: the eval printed "model 8/8, first record 1/8" ($0.0009, ledgered). Gates run by the author:
npm run typecheck clean; 24 suites (ai-call, cost-categories, models, front-matter-authors, latexml*,
opening-title, title-tidy-model, extract-*, doc-links) green.

Look especially for:
1. Correctness of `titlePrintedIn` (whole-word boundaries, Unicode, repeated occurrences, record caps
   matching what the model was shown), and anything a hostile page could exploit.
2. Whether `armThatKeptTheProse`'s control arm and every other `readingArm` caller carry `untitled`
   correctly, and whether any other consumer of `article.title` (e.g. `debugPage`, evals, scripts,
   link previews, `extractHtmlMetadata`/`htmlDocumentText` in src/paper-metadata.ts for an uploaded
   LaTeXML file) still uses LaTeXML's guess.
3. Registration completeness for the new job and its tests (route, wire, reasoning, disposition).
4. Tests that would have passed without the fix, or tests missing.
5. Comment accuracy against the code.

You may run `npx vitest run <files>` and `npm run typecheck`. Write your findings, numbered, with
severity P1/P2/P3, what you fixed (file and line) and what you left for the author, and end with one
line: VERDICT: ship | ship after the fixes made | do not ship.
