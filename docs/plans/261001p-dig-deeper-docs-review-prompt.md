# Docs review, 261001p — *Dig deeper*

Read-only: do not change any file. Check that the project docs describe the code as built. The docs
changes are commit `0ca133924` (`git show 0ca133924`) plus two lines in `docs/project/glossary.md`
in commit `dfb16a2a4`. The code is the rest of this branch (`worktree-go-deeper`), chiefly
`src/dig-deeper.ts`, `src/explain.ts`, `src/term-lookup.ts`, `src/routes.ts` (`answer()`),
`src/citation-investigate.ts`, `src/citation-find.ts`, `src/store/pg.ts`,
`src/web/GlossaryPanel.tsx`, `src/web/CommentDialog.tsx`, `src/web/CitationInvestigation.tsx`,
`src/messages.ts`, `src/models.ts`, `src/ai-call.ts`. The plan is
`docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md`.

For each changed doc passage: is every factual claim true of the code (names, order of steps,
which model, which allowance, what is stored, what the reader sees, what is unchanged)? Is a number
restated that should be cited by constant name? Is any old name ("Check the web", "Search the web"
for a comment, "Investigate") left where it now misleads? Are Greg's words quoted exactly as in the
plan's top section? Also: is any doc you read along the way now contradicted by this branch even if
the commit did not touch it?

Format: verdict line; findings F19 onward, P0–P3 (P1 = a doc claim that would lead a reader or agent
to wrong behaviour), each with doc file:line, the code file:line that contradicts it, and the
corrected wording.
