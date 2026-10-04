# Code review: two fixes from the footnote-digits census (261004j, stage 2)

You are reviewing **and fixing**, in this worktree (`--sandbox workspace-write`). Fix what is inside
this stage, narrowly and red-first; **report, do not fix**, anything wider. Do not commit. Do not
write any sentence into a doc as a quotation of Greg, or attribute a decision to him: only he says
what he decided.

## The candidate

Branch `worktree-footnote-digits-census`, the single commit whose subject begins
`261004j stage 2:` (find it with `git log --oneline -3`; diff it with `git show <sha>`). Changed
paths:

- `src/pdf-read.ts` — `endnotesTypedAsProse`, called at the top of `renderHtml`; a comment on
  `withMarkers`
- `tests/pdf-footnotes.test.ts`
- `src/citations.ts` — `verifyEntry` (new parameters), `markerNumbers(quotes, glued)`,
  `gluedNumbers`, `markerAfter`, `hasNotes`, and the thread through `toDrafts` / `readDraft`
- `tests/citations.test.ts`
- `docs/project/citations.md`, `docs/project/content-extraction.md` (a few lines each)
- `docs/investigations/261004d-glued-footnote-and-citation-digits-census-across-production-articles.md`
  (the evidence), `docs/plans/261004j-…-measurement.md` (the plan and its review ledger)
- `evals/footnote-digits/` (measurement scripts; read-only against production)

Start with the two `src/` files and their tests. That does not limit scope.

## What each fix is for

1. **`endnotesTypedAsProse`**: on a fresh import of a real paper, the transcription model typed one
   whole page of endnotes (15 records, labels 18–32) as `paragraph`, between `footnote` records 17
   and 33. They rendered as body paragraphs and their markers stayed bare digits. The function
   retypes such a page. It must never move ordinary prose into the notes.
2. **Citations and superscript citation numbers**: `markerNumbers` read only `[n]`, so on a paper
   that cites as `mortality.¹` or `pattern5,51` every reference-list entry the model named was
   dropped as a mismatch (27 of 27, 69 of 70). Now, **only in an article with no notes at all**, a
   glued or superscript number inside the mention's quote, or immediately after it in the block's
   text, counts. Measured after the change on one real paper: 61 of 69 entries kept, 7 dropped by
   the title check, 1 mismatch.

## What I want

An independent attack first. Run the two test files yourself
(`npx vitest run tests/pdf-footnotes.test.ts tests/citations.test.ts`); they need nothing outside
the tree. Then, in particular:

- Inputs that make `endnotesTypedAsProse` retype real body prose, or that make it miss the measured
  case. Is the function as simple as it can be? It reads as hard to follow; if you can make it
  plainly correct in fewer moving parts without changing behaviour, do.
- Inputs that make `gluedNumbers` / `markerAfter` read a number that is not a citation as one, in an
  article with no notes; and whether `hasNotes` can be false for an article that does have
  footnotes (a PDF whose only notes were left out by `renderNotes`, a web page whose notes the
  canonicaliser did not recognise). What does a wrong "no notes" cost, given the title check that
  follows?
- Every caller of `verifyEntry`, `markerNumbers` and `renderHtml`: is any left on the old
  signature or behaviour?
- Mutate each fix (delete a condition) and say whether a test goes red. Add the missing test.
- The doc lines: do they say what the code does?

Severity: **P0** data loss, security, wrong charging; **P1** user-visible wrong behaviour or an
authoritative contract violated; **P2** design or maintainability risk; **P3** prose. An id on every
finding (`C1`, `C2`, …), *established* or *reasoned* for each, and for each fix you made: the red
test, then the change. End with a one-line verdict.

## Known and accepted (do not re-report)

- `npm run typecheck` shows 12 errors in `src/backfill-registry-facts.ts`. They are on the trunk,
  not in this change.
- The stray space after a linked marker (`stories9 . This`) is kept on purpose; the comment on
  `withMarkers` says why.

## My own suspicions (already mine; spend most of the run elsewhere)

- `endnotesTypedAsProse` decides per page; a note continued from the previous page as the first
  record of the next (a `continues` paragraph) may defeat rule 1.
- `GLUED`'s "lower-case word of three letters" also admits `sox2`, `interleukin6`.
