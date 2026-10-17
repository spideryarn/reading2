# 261012c — GPT Sol code review: the narrow form, as built

You reviewed this plan three times (docs/plans/261012c-plan-review-sol.md, -2-sol.md, -3-sol.md; the
third said BUILD WITH CHANGES). This is the code built from it. Greg permitted an unattended agent to
make this one defence edit (docs/user-feedback/questions/q-pm2j66.md, reply spya-v33gfs).

Plan: docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md
(§ The narrow form, § Shared by both forms, and § Plan review's "Decided while building" paragraph,
which lists four choices the builder made where the plan was silent or loose — check each).
Scoped diff: docs/plans/261012c-code-review.diff (src, tests, the eval runner's print, and the docs).
Eval: evals/guide/results/offers-v6-reworded.json (18/18 fields; 11 of 14 offers saved themselves:
10 exact, 1 reworded).

The defence: src/save-closeness.ts (`savesAtOnce` now returns `{route:"exact"}`,
`{route:"reworded",source}` or `null`), called from src/chat-tools.ts `offerToSave`; the card
src/web/GuideSaveOffer.tsx (`offerOf` reads `route`/`source` from stored JSON; a reworded offer in a
hidden tab does not save itself). Tests: tests/save-closeness-reworded.test.ts,
tests/save-closeness.test.ts, tests/guide-offer-to-save.test.ts, tests/guide-in-chat-panel.test.tsx.

You may edit files (workspace-write) to FIX what you find inside this scope: the defence, its tests,
the card, and the docs in the diff. Add a failing test first for any rule bug. Do not commit, do not
run git commands that change the index or the tree's history, and do not touch anything outside the
scope. Run `npx vitest run tests/save-closeness-reworded.test.ts tests/save-closeness.test.ts
tests/guide-offer-to-save.test.ts tests/guide-in-chat-panel.test.tsx` and `npm run typecheck` after
any change.

Look hardest for:
1. Any string the reworded route saves that the exact route would not, and that is a materially
   different claim or an instruction (concrete reader message + offer + basis).
2. Any way the shared refusals can be bypassed on either route (Unicode, NFKC, apostrophe forms,
   sentence boundaries, the About you basis/join, case folding in `quoted`'s fallback against the
   sentence spans).
3. Whether `containsQuotedRun`'s question check is right when the message is lower-cased in the
   fallback (span positions vs the searched string).
4. The card: a stored offer shape that makes it save itself when it should not, or show a source
   that is not the reader's.

Write your findings, each with severity (P1/P2/P3), what you changed for it if anything, and a final
verdict line: SHIP, SHIP AFTER MY FIXES, or DO NOT SHIP. Keep the answer under 900 words.
