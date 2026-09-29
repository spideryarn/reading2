# Plan review prompt: shelf topics round three (260929a)

Read-only. Do not change any file. Be decisive and brief.

**Candidate (live, untracked)**: docs/plans/260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md. Base: `git log -1`. Context: src/shelf-terms/extract.ts (`nounishShape`, `nounish`, `tokenOk`, the generic list), src/shelf-terms/choose.ts (`greedy`, `admit`, redundancy rules), src/web/ShelfTerms.tsx, src/web/ShelfTermsDetail.tsx, src/web/ShelfTermChip.tsx, src/web/Library.tsx (`Archived` near the end, the `rows` memo, the count line), src/web/ShelfControls.tsx, src/web/shelf-narrow.ts, src/web/useShelf.ts (`loadArchived`), src/web/ShelfEntry.tsx (how an archived card and restore render), docs/project/shelf-terms.md, docs/project/library.md § Archive, and Undo is the confirmation.

## Please
1. Stage 1: is the concreteness rule right (threshold, "absent from the list passes", phrases)? Will the adjacency rule and the 0.5 shared-stem penalty cost coverage badly? How could "entered" have survived the -ed test — find the route in the code if you can.
2. Stage 2: merging archived articles into the one list — what breaks? (the archive's Undo/restore flow, the cached-shelf paint of the active list, `loadArchived` timing, the fixture sink, the row cap, counts, the public shelf, the offline shelf). Is hiding zero pills right in both views, and what about a URL that names a topic now hidden?
3. Anything simpler that meets Greg's three reports.

## Output
Findings R1… with severity (P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design risk; P3 prose), established or reasoned, evidence, recommendation. One-line verdict.
