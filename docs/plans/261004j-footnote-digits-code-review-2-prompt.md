# Code review, round 2: one fix only (261004j, C5)

Read-only. Do not change any file. This is a narrow check of **one fix made after your round-one
review**, not a new round of discovery.

## The candidate

Commit `82f42fac3` on branch `worktree-footnote-digits-census` (`git show 82f42fac3`). It contains
your own round-one fixes, which are not under review, and one change that is:

- `src/citations.ts`: `citesMostOfListGlued`, `entriesCitedGlued`, and the line in `toDrafts` that
  now reads `const glued = !hasNotes(blocks) && list !== null && citesMostOfListGlued(blocks, list);`
- `tests/citations.test.ts`: the two tests beginning "ignores glued numbers that cover little of
  the reference list"
- `evals/footnote-digits/source-notes-absence.ts`: your probe, changed to assert the refusal
  against a ten-entry list and the residue against a one-entry list
- the paragraphs describing it in `docs/project/citations.md`, the postmortem
  `docs/postmortems/261004m-…md` (§ What was done after the review), the investigation and the plan

## The question

Your C5: `hasNotes` cannot see a note the extraction dropped or did not recognise, so a footnote's
number could pair a work with the wrong reference entry. The fix does not try to recover the note.
It adds article-wide positive evidence: glued numbers are read as reference numbers only when the
body cites at least half of the numbered list by glued numbers. Measured: 69 of 69 and 26 of 27
entries on the two real superscript-citation papers; 53 of 292 on the paper whose glued numbers are
62 endnotes.

1. Does this close C5's demonstrated consequence? Run
   `node --import tsx evals/footnote-digits/source-notes-absence.ts` and
   `npx vitest run tests/citations.test.ts`.
2. Is the stated residue (a paper with as many unrecognised numbered footnotes as half its
   references; a very short list) the whole residue, or is there a realistic input that passes the
   half-the-list test while its glued numbers are not citations? `entriesCitedGlued` counts over
   `isBodyBlock` blocks with `gluedNumbers(block.text)`.
3. Can the threshold wrongly shut out a real superscript-citation paper (ranges, lists, superscripts
   the transcription dropped)? What does that cost: it falls back to today's behaviour.
4. Do the doc sentences say what the code does?

Same severity scale as round one, ids continuing from `C7`. Say *established* or *reasoned*. One-line
verdict: is C5 closed, narrowed with a stated residue, or still open.
