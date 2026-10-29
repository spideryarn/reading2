You are reviewing a plan in this repository (read-only). Read AGENTS.md / CLAUDE.md first for house rules.

The plan: docs/plans/261029b-citations-in-a-comma-separated-list-are-all-read.md

It answers two admin feedback reports about one arXiv HTML article. The code change it describes is
small and already drafted, test-first; the diff is at
/tmp/claude-1000/-home-greg-code-spideryarn2/26a154a6-3d57-4414-833b-32bcc170c3ae/scratchpad/stage1.diff
(src/citation-author-year.ts and tests/citation-author-year.test.ts). Context: src/bibliography.ts
(§ rowsFromText, bodyAuthorYearCites, the `covers` logic), docs/project/bibliography.md § Rows from
the text, docs/plans/261027b-citations-missed-in-the-text-filled-by-code.md, and for the figure
src/latexml.ts § liftBoxedPassage and docs/plans/261024w-*.md.

Please review the PLAN for:
1. Whether the diagnosis is right (three stacked causes for the missed citations; the figure being the
   already-fixed spya-weuekx bug rather than new work).
2. Whether the fix (continuing a parenthetical list after a comma, only from a cite already read) can
   produce false citations in prose that is not a citation list, or interact badly with `covers`,
   `authorYearAlias`, the narrative/lone rules, `ENTRY_LINE`, or citedAt/mentions downstream. Give
   concrete strings if you find a false positive.
3. Whether the cost estimate for the model-side option is sound and fairly stated, and whether the
   question to Greg is the right question (options, recommendation).
4. Anything simpler that was missed.

Do not edit files. Write your findings as a numbered list, each with severity (high/medium/low),
the evidence, and a concrete suggested change. End with a one-line verdict.
