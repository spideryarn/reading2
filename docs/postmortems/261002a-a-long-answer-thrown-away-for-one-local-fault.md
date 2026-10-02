# A long answer thrown away for one local fault

**2026-10-01.** Greg uploaded *The Order of Time*, a 4.2 MB book PDF of 1,041 blocks. It stopped at
"Building the hierarchy" with the generic try-again message, and stopped again when he pressed Retry
(report spya-sutes9; the fix is
[261001s](../plans/261001s-fb93-long-pdf-hierarchy-asks-again.md)).

## What happened

Each attempt made one structure call: the whole book in, the whole nested tree out, as one JSON
answer of about 25,000 characters. Both calls ended normally, so neither was cut off. Both answers
were thrown away after they arrived, each for a **different, local** fault:

- `spya-ns8vsr`: one node four levels down had no `range` field. `buildTree` threw *"The node at root
  > child 3 > child 4 > child 1 has no [start, end] block range"*, after mending nine other
  boundaries in the same answer without complaint.
- `spya-ppuxcv`: the JSON broke at character 24,682 of 24,685. The parser's diagnosis rules out
  truncation and trailing material, which leaves a closer in the wrong order in the final run of
  brackets: the model lost count of its own nesting. The answer itself is gone, because nothing keeps
  a refused answer.

In production since 2026-09-06, every hierarchy step on a document of 700+ blocks failed (2 of 2,
both these), and 240 of 243 steps overall finished.

## The root cause

**One model answer carries the whole tree, and the stage gave a fault anywhere the same disposition
as a fault everywhere.** The chance of at least one local slip grows with the answer's length, so the
stage gets less reliable as documents get longer — just as it was being asked to take books. And a
refused answer was the step's failure, so the reader pressing Retry became the retry loop, drawing a
new answer at the same odds.

## The class: *an all-or-nothing gate on a long generated artefact*

The gate is right to refuse an answer it cannot use, and wrong to make one refusal final. The stage
had already learned this for one fault family: since 2026-08-31 a boundary the model got wrong is
derived away rather than refused ([hierarchy.md § The partition is derived, not
checked](../project/hierarchy.md)). The rangeless node and the broken bracket were two faults
that rule did not reach. The same class applies anywhere one generated artefact is long and is
accepted or refused whole.

## Which commit introduced it

Not one commit. The single whole-document call is the stage's original design, and the "has no
[start, end] block range" throw dates from `051bc0a01` (2026-08-26). It was right for the articles
of the time. The exposure came from success elsewhere: the budget re-rating under
[260904b](../plans/260904b-a-long-pdf-finishes-without-a-retry-click.md) let book-length documents
reach the call at all, and answer length grew with them.

## The fix, and the one that is right for the long term

**Shipped:** a child with no range is derived like a child whose start says nothing, and is counted;
and a fresh answer that cannot become a tree is asked for **once** more inside the step, if the
deadline leaves room. Two calls is the ceiling.

**Right for the long term:** answers whose size does not grow with the document. The scoped cascade
(src/hierarchy-cascade.ts, built and switched off) asks for the tree a section at a time, so one
fault costs one section's call rather than the book's. Turning it on is its own decision, with its
own cost, and is not taken here. A re-ask that tells the model which part was wrong is the other half
of Greg's 2026-08-30 note quoted in
[260831ai](../plans/260831ai-hierarchy-tiling-normalisation.md).

## What would have caught it, ranked by ease against value

1. **Log `structureCalls` at every value** — done. A re-ask rate creeping up is the early warning
   this lacked: the first sign was a reader's failed import. `rangelessChildren` was logged too, then
   retired from production telemetry when `toc/11` made a missing child start impossible on the live
   wire; its `BuildReport` field remains for legacy and direct ranged-builder inputs.
2. **Run the long end of the corpus through the structure eval whenever the budget lets in bigger
   documents.** The 260904b re-rating was measured on one Kuhn call that happened to come back clean,
   and one sample cannot show a per-answer fault rate. Cheap as a habit, and not done here.
3. **Keep refused answers** (a checkpoint namespace for them), so the next fault is diagnosed rather
   than inferred, as the JSON break had to be here. Deferred to Greg: keeping model text about a
   reader's article is a privacy decision, and `raw_response` was removed from `ai_calls` on purpose.
4. **Mend broken JSON** by closing brackets left open at the end. Rejected for now: it guesses at a
   structure the model did not state, it would sit in the parser every model answer passes through,
   and the re-ask already covers it.
