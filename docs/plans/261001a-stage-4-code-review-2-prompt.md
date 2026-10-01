# Code review, round 2: plan 261001a, stage 4

You are GPT Sol. Your round-1 review is `docs/plans/261001a-stage-4-code-review-sol.md`. You fixed
C-2 and C-3 and left **C-1** (a DOI's own hyphen at a line end is erased by `dehyphenate` before
`entryIdentifiers` sees it) because it needed a file outside your boundary.

You may now also edit `src/citation-reference-list.ts` and `tests/citation-reference-list.test.ts`, as
well as `src/citations.ts`, `tests/citations.test.ts` and `docs/project/citations.md`. Fix C-1 in the
simplest conservative way: identifiers are read from the entry text **before** dehyphenation (or with
line-break provenance kept), and a DOI or arXiv id that spans a line-end hyphen is treated as
unreadable, so the row keeps its Scholar search. The entry text shown to the reader stays
dehyphenated as today. Add tests that go red without the fix — say that you saw them go red.

Then re-check your C-2 and C-3 fixes once more with fresh eyes, especially C-3's id inheritance against
`docs/project/block-ids.md`: an id must never move to a different work.

Other files in the tree are being edited by another agent (stage 3: `src/citation-investigate*.ts`,
`src/web/*`, `src/types.ts`, the schema, the stores); do not touch them, and ignore typecheck errors in
those files. Run the citations and citation-reference-list test files by path. Do not commit. Findings
as id, severity, evidence, and what you did. End with a verdict.
