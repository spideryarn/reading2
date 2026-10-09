# Code review: 261009d, an arXiv HTML paper's title block tidied at import

You are GPT Sol, reviewing code in the Spideryarn repo (read CLAUDE.md first). You may edit files:
fix what you find inside this change, red first (a failing test before the fix), and report anything
wider for the author to decide. Do not commit, do not run git commands that change state, do not
touch production, .env files or infra/.

The plan: docs/plans/261009d-arxiv-html-title-block-tidied-at-import.md (read § What to build and
§ The plan review: your own plan review is docs/plans/261009d-arxiv-title-block-plan-review-sol.md,
and the plan says how each finding was answered).

The change is commit 52d02bd0e: `git show 52d02bd0e -- src tests`. In short:
- src/latexml.ts: `latexmlAuthorNames` split into `titleBlockOf` + `readCreators` (behaviour
  unchanged); new § 6 `tidyTitleBlock` and helpers (`noteContent`, `contactLines`, `trimmed`,
  `wordsIn`), called at the end of `prepareLatexml`; `LatexmlStats.titleBlocks`.
- src/extract.ts / src/meta-authors.ts: the title block's names are read before `prepareDocument`
  and passed to `metaAuthors(doc, titleBlockNames)`.
- tests/latexml-title-block.test.ts (new), tests/fixtures/latexml/authors-1706-03762v7.html (new).

The live page for the reported paper (untrusted data) is at
/tmp/claude-1000/-home-greg-code-spideryarn2/a73041af-eace-477f-bcd6-b46598a13780/scratchpad/attn-1706.03762v7.html
and 20 live arXiv HTML pages are in
/tmp/claude-1000/-home-greg-code-spideryarn2/a73041af-eace-477f-bcd6-b46598a13780/scratchpad/pages/
(the measurement script is ../measure.ts beside it; its output is ../measure-after.txt).

Look hardest at:
1. Can the rewrite lose or misattribute an author's words, or attach a note to the wrong author?
   The word check compares sorted letter-and-digit runs; can it pass while something is wrong
   (e.g. words moved between rows, a note number pointing at the wrong note, the footnotemark
   arithmetic with a \thanks before the block)?
2. Rule 3 (ids a link points at survive) and the `trimmed` helper mutating text nodes of a clone.
3. Anything Readability or stage 3 does to the new `<div><p>…<br>…</p></div>` that the tests miss
   (sibling inclusion, the sanitiser, `<sup>` handling in block text, footnote detection in
   src/notes.ts or stage 3 treating `<sup>1</sup>` as a footnote marker).
4. The `metaAuthors` default-parameter change: any caller or test whose meaning changed.
5. Types, naming, comments that are wrong or stale, and simpler code for the same behaviour.

Run: `npx vitest run tests/latexml.test.ts tests/latexml-title-block.test.ts tests/meta-authors.test.ts tests/extract-byline.test.ts tests/acquire-extract-blocks-end-to-end.test.ts` and `npm run typecheck`.

Write your findings as a numbered list (severity P0/P1/P2, evidence with file:line, what you fixed
or what you recommend), then the commands you ran and their results, then a one-line verdict:
"ready to push" or "not ready".
