You are the code reviewer-fixer for one stage of work in this worktree. Plan: docs/plans/261009f-latex-undefined-macros-leave-the-page.md (read it first; your own earlier plan review is docs/plans/261009f-latex-undefined-macros-plan-review-sol.md, and the plan says which of its points were taken and which declined, and why).

The change: `removeUndefinedMacro` and `sourceNameArgument` in src/latexml.ts (called from `prepareLatexml`), its tests in tests/latexml.test.ts § "fix 8", fixtures tests/fixtures/latexml/undefined-macro-*.html, and doc edits in docs/project/content-extraction.md and the module header of src/latexml.ts. See the diff with:

  git diff 043eeb32b~1 HEAD -- src/latexml.ts tests/latexml.test.ts tests/fixtures/latexml docs/project/content-extraction.md

(043eeb32b~1..HEAD also contains a merge of origin/dev that brought in `tidyTitleBlock` and `titleBlocks`, which are another agent's work and not under review; review only the undefined-macro rule and how it interacts with them, e.g. it runs before `tidyTitleBlock`.)

Evidence: tmp-survey/*.html are 80 live arXiv HTML pages fetched 2026-10-09 (ten hold `ltx_ERROR` markers: `grep -l ltx_ERROR tmp-survey/*.html`). tmp-survey/before/ and tmp-survey/after/ hold each of those ten pages' stage 3 block texts, one block per line, from origin/dev's latexml.ts and from this change.

What to do:
1. Look for correctness bugs: an author's words deleted, words joined, a link target lost, a crash, a rule that fires outside its stated shape, the space-insertion or `\sep` logic going wrong at a node boundary (text split across elements, the report first or last in its parent), the CITATION_KEY regex eating a sentence's own punctuation, ReDoS in any of the regexes.
2. Fix what you find that is inside this stage, narrowly, each one red-first with a test in tests/latexml.test.ts that reproduces it. Run `npx vitest run tests/latexml.test.ts` to check.
3. Report, but do not fix, anything wider you notice.
4. Check that the doc edits say what the code does.

The design trade-offs (identifier-shaped arguments rather than an allowlist; leaving `[1]`, `[VS]` and `\captionof`'s `table` glued) are my decisions as the implementing agent, not the user's: do not attribute them to Greg anywhere, and do not add quotations attributed to Greg.

End your answer with: a numbered list of findings (most severe first, each marked FIXED or REPORTED, with the test name for fixed ones), then a one-line verdict.
