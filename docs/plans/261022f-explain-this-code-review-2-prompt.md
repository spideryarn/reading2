# Code review, round 2 (narrow): the fixes to your C1, C2, C4 (261022f)

You reviewed commit `7fd0c6b7a` and rejected it
(`docs/plans/261022f-explain-this-code-review-sol.md`). Your own fixes for C2 and C5 rode in the
next commit, and so did mine: `git show 5db8c6b02`. Read that diff only, plus what it touches in
`src/glossary.ts` and `tests/glossary.test.ts`, and the updated § Results in
`docs/plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md`.

This is NOT general discovery. Check exactly these, each answered "closed", "still open (why)" or
"closed with a new defect (what)":

1. **C1.** `MAX_ENTRIES = 80` and the test "keeps a call that uses every token it was allowed
   inside the job's own deadline". Is the arithmetic right (`budgetFor`, `STREAM_TOKENS_PER_SECOND`,
   `LEASE_MS - DEADLINE_MARGIN_MS`), and is the job self-abort really the only clock on this call?
2. **C2.** `aliasCitesByYear`: is the regex right on the shapes in the test, does it drop anything
   it should not (an alias that is only a year, "1984 (1949)", "Apollo 11 (1969)")? And is the
   residual the plan § Results accepts stated honestly, given the eval files under
   `evals/results/glossary-citations/names-final-*` and `names-final2-*`?
3. **C4.** `longPiece` on `renderPrompt`, computed in `generateGlossary` from the length: right,
   and every caller updated?
4. Anything in `5db8c6b02` that is wrong behaviour you can establish.

Run `npx vitest run tests/glossary.test.ts` yourself. You may fix a defect inside these four,
narrowly; report anything wider. No commit, no push, no production.

Severity: P0/P1/P2/P3 as before. End with one line: APPROVE, APPROVE WITH CHANGES, or REJECT.
