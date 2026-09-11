# Review: cluster N — PDF item-boundary evidence and decision (commit 03e1777e)

You are reviewing an EVIDENCE job in the Spideryarn repo (this worktree). Read these first:

- docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § "N — preserve PDF evidence
  before improving the heuristic" (the brief), and § "Common completion contract".
- docs/postmortems/260904c-a-document-refused-for-an-answer-it-never-had-to-give.md (the folio case,
  and the `12.3. → 2.3.` lesson: a widened rule must be tested against what it now lets through).
- src/pdf.ts § pass0, src/pdf-score.ts § folioOffset / defusedFolios / check.
- The diff: logs/n-review-diff.patch (also `git show 03e1777e`).
- The run's summary: logs/n-review-summary.txt; full numbers: evals/pdf/item-boundaries/results-2026-09-11.json.

## What was built

- evals/pdf/item-boundaries/boundaries.mts — restates pass0's item loop; classifies every "fused"
  join (no whitespace, no hasEOL) as touching / gap / shift (|Δy| > 0.15 font sizes) / line-break
  (|Δy| > 0.7); a second reading inserts "\n" only at line-break joins; a control reading inserts "\n"
  at every fused join.
- evals/pdf/item-boundaries/compare.mts — for each PDF: asserts the harness's text equals pass0's on
  every page; census; heading evidence old (folioOffset+defusedFolios) vs new (numbered heading at an
  unmarked line break); every existing transcription scored by the UNCHANGED `check` over old text and
  over split text (and the control); and a mutation arm corrupting each numbered heading
  (`truncatedHeading`) to see which arm still reports it as invented.
- tests/pdf-item-boundaries-eval.test.ts — pins the classifier on hand-built runs (the real Kuhn page-37
  item sequence, inline span `1`+`2.3.`, superscript, column join, sideways stamp), pins harness==pass0
  on the easy fixture, and pins that the control arm changes failure lists on the Kuhn cut while the
  real split changes only two (both withdrawn false "invented" URL faults). The test was watched red
  against a skeleton classifier before the classifier was written.
- src/pdf-score.ts: `defusedFolios` and `folioOf` exported (no behaviour change) + a comment pointer.
- Two plan docs: 260911b (evidence + decision), 260911c (separate implementation plan, NOT built).

The full run used `--db` (local Postgres `pdf-chunk` checkpoints, read-only) and two local PDFs that
cannot be committed (Kuhn full 142pp, Nagel). You can reproduce the committed-corpus part with
`npx tsx evals/pdf/item-boundaries/compare.mts` (no flags; free, ~1 minute). Do not call any model.

## The conclusion I am drawing — check THIS, not only the code

"The corpus demonstrates an improvement without weakening fidelity: 0 verdicts changed, 2 false
'invented' faults withdrawn and none added, same 425/435 corrupted headings caught, folioOffset adds
nothing under the split; therefore adopt in a scoring-only form (PageText.text unchanged, only
`check` reads a split view), per 260911c, and later delete folioOffset."

**The finding I would least like to be wrong about:** that the split cannot let through something the
old path caught — i.e. that the mutation arm is a real test of that and not one that shares an
assumption with the code (e.g. is `truncatedHeading` producing tokens that `protect` ever emits in the
same form as the `invented` list? is the `invented.includes(token)` comparison checking the right
string? could a corrupted heading be caught by both arms for a reason unrelated to headings, hiding a
real difference?). Second: whether the 0.7 threshold + "fused only" rule could insert a newline inside
a token in a way the corpus does not exhibit (two-column PDFs, RTL, rotated pages, math) and whether
260911c's scoring-only design really has no downstream effect (extraction versions, chunk cache keys,
block ids) — verify its claims against src/pdf-read.ts rather than trusting the prose.

## How to answer

Since 2026-09-09 the code reviewer fixes what it finds inside the stage: you may edit files under
evals/pdf/item-boundaries/, tests/pdf-item-boundaries-eval.test.ts and the two 260911b/260911c docs.
Do NOT change src/ behaviour, do not touch .env.local, infra/, systemd, or any database. Run
`npx vitest run tests/pdf-item-boundaries-eval.test.ts` after any edit. Report anything wider for me to
decide. Finish with: a verdict (SHIP / SHIP-WITH-FIXES / DO-NOT-SHIP), each finding with severity and
evidence (file:line, command output), what you changed, and whether the decision in 260911b follows
from the numbers.
