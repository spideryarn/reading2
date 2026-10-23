# Plan review: 261023b, endnotes typed as references are kept as notes

You are reviewing a plan before it is built. Read-only: do not edit files. Write your findings as
your answer.

Read:

- the plan: docs/plans/261023b-endnotes-typed-as-references-are-kept-as-notes.md
- the code it changes: src/pdf-read.ts, `renderHtml` (search `export function renderHtml`),
  `endnotesTypedAsProse`, `numericLabel`, `NOTE_LABEL`, `CITING`, `collectNotes`, and whatever
  reads notes afterwards (`findMarkers` and the note-linking code after `collectNotes`);
  src/pdf.ts § `RecordType` and `RENDERED`.
- the existing tests for the sister repair: tests/pdf-footnotes.test.ts, describe "a page of endnotes
  the model typed as paragraphs".
- evidence, gitignored, in data/261023b/: notes-chunks.json (the four real stored chunk readings from
  production: 126|127–128, 128|129–134, 134|135–137, and 54|55–60 with the bare "53" records);
  gaps.txt (published article vs text layer, gaps.mts made it); audit.txt (today's gate over every
  stored reading, audit.mts); census.mjs (the census over all 457 production readings, whose only
  hit was Rovelli); keys.mts (the claim that a Refresh re-reads all chunks).

Questions, answer each:

1. Is the retype rule (label = last note's label + 1, last note on same or previous page, headings and
   publisher furniture pass through, unlabelled `continues` joins) right on the real records? Walk
   notes-chunks.json through it. Does anything in 128|129–134 fail to chain, and would that matter?
2. False positives: what real document shape would this retype wrongly? Consider numbered reference
   lists, papers whose footnotes and reference list share a page, author-year lists starting with a
   year, `[n]` labels, and `NOTE_LABEL`'s symbol labels. Is "anchored on a footnote record" enough?
3. Order with `endnotesTypedAsProse`, `continuationTargets` (indexes must not move), the gate
   (`check`/`CHECKED` uses record types?) and `bibliographyPages` (it reads `reference` share): does
   retyping at render time disturb any of them? Is renderHtml the right seam, or does the gate see
   these records with their original types elsewhere in a way that matters?
4. The bare-label skip in `collectNotes`: is a label-only `footnote` ever legitimate (e.g. a label
   whose body is in the next `continues` record)? Would skipping it break a continuation join?
5. The claim that a Refresh re-reads every chunk because reader id and prompt are in `chunkKey`: is
   that right, including any path where a Refresh does not run extract at all, or reuses the old
   revision's records?
6. Anything simpler that gets the same result, or anything missing.

Number your findings F1, F2, …, each with severity (blocker / should-fix / nit), the evidence, and
the change you recommend. End with one line: BUILD AS PLANNED, BUILD WITH CHANGES, or RETHINK.
