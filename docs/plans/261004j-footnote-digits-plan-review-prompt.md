# Plan review: footnote digits census, root cause, and re-import measurement

You are reviewing a **plan**, read-only. Nothing is built yet. Do not change any file.

## The candidate

- Plan: `docs/plans/261004j-footnote-digits-census-root-cause-and-re-import-measurement.md`, as
  committed on branch `worktree-footnote-digits-census` (the commit that adds this prompt).
- It builds on `docs/plans/260930k-pdf-footnotes-shown-and-linked.md` (the footnote linker and its
  measured rules) and touches the contract in `docs/project/block-ids.md`.

Code worth reading, without limiting scope: `src/pdf-read.ts` (`collectNotes`, `candidatesIn`,
`findMarkers`, `renderNotes`, `renderHtml`), `src/citations.ts` (`verifyEntry`, `markerNumbers`,
`noteMarkers`), `src/citation-reference-list.ts`, `src/blocks.ts` (the id carry-over),
`tests/pdf-footnotes.test.ts`, `docs/project/citations.md` § Which citation, and whose entry.

## What I want

An independent attack on the plan first. In particular:

1. Is the census method sound: will it measure what it claims (precision, recall, "did Citations
   link it")? What would make its numbers wrong while looking right?
2. Stage 2: is widening Citations' `markerNumbers` to glued and superscript numbers safe under the
   condition the plan states, and is there a simpler or safer condition? What shapes will today's
   footnote linker miss that the plan does not list? Read the linker and say.
3. Stage 3: is "import a local copy seeded with production's block ids" a faithful measurement of
   what a production re-import (a reset, `force: ["extract"]`) would do to ids? What does a real
   re-import change that this local measurement cannot see? Which reader-owned tables anchored to a
   block id has the plan missed (read `src/db/schema.ts`)?
4. Anything the plan should not do, or should do in a smaller way.

Severity scale: **P0** data loss, security, wrong charging; **P1** user-visible wrong behaviour or
an authoritative contract violated, or a measurement that would mislead the decision it feeds;
**P2** design or maintainability risk; **P3** prose. Give every finding an id `F1`, `F2`, … and say
for each whether it is *established* (you read the exact source path) or *reasoned*.

End with a one-line verdict: *build as written*, *revise before build*, or *do not build*.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- A paper with both numbered footnotes and superscript numeric citations: the linker and a widened
  `markerNumbers` would both claim the same digits.
- The local re-import of a `pdf-v2`/`v3` article is a fresh model transcription, so one run is one
  sample of a noisy process; the id-survival figure may need two runs to mean anything.
