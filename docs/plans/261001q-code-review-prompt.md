# Code review: 261001q — a PDF's tables show their cells

You reviewed the plan (`docs/plans/261001q-plan-review-sol.md`). Stage 1 was built with
your findings 2, 3 and 11 taken in, and stage 2 was deferred on your P0 and P1s. The plan,
`docs/plans/261001q-pdf-tables-and-composite-figures.md`, says what was decided and why.

The diff to review: `git diff 80cda81e7..HEAD` (two commits, `d77e138ee` and `c4d75d727`).
The code:

- `src/pdf-read.ts` — `renderHtml`, plus the new `tableOwners`, `tableRows` and `tableHtml`.
- `src/pdf.ts` — the new `CHECKED` set; `src/pdf-score.ts` — `scorePage` uses it.
- Tests: `tests/pdf-tables.test.ts`, `tests/pdf-record-types-shown.test.ts`, the new block at
  the end of `tests/pdf-score.test.ts`.
- Docs: the postmortem `docs/postmortems/261001b-…`, the bullets in
  `docs/project/content-extraction.md` and `docs/project/article-images.md`.

Please look hardest at:

1. **Correctness of `renderHtml` with cells**: the interaction with `continuationTargets`
   and the `blockOf` map (a continued table caption; a paragraph continuing across a table
   and its cells; a `tabledata` record the seam repair emptied; cells before any table;
   cells right after a figure). Can a cell ever land in the wrong table, be dropped, or
   duplicated? Does a block keep the place of its first piece?
2. **Escaping and markup**: every cell goes through `escapeHtml`; nothing from the model
   can become a tag or attribute. Stage 3 (`src/blocks.ts`) and the sanitiser keep the
   `<table>` inside the `<figure>` as one `media` block.
3. **`CHECKED`**: is anything else that reads `RENDERED` now wrong, or should also move?
   Does gating cells risk failing chunks on real tables in a way the plan does not admit?
   (`src/pdf-score.ts`, `src/pdf-read.ts`, `src/pdf-frontmatter.ts`, `src/pdf-integrity.ts`.)
4. **The tests**: would each have gone red without the change it pins? Is any of them
   checking a weaker thing than its name says?
5. **The docs**: anything the postmortem or the doc bullets claim that the code or the
   measurements do not support.

You are in `--sandbox workspace-write`. **Fix what you find inside this stage** (the files
above) and run `npx vitest run <the test files you touch>` and `npm run typecheck`. Do not
commit. Report anything wider for me to decide. Answer as a numbered list: severity
(P0/P1/P2), evidence (file:line), and what you changed or recommend. End with a one-line
verdict.
