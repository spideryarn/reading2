# Stage 2 code review prompt: shelf topics round three (260929a)

Reviewer-fixer. **Candidate (committed)**: 7623f1b1 — `git show 7623f1b1 --stat`. Start with src/web/Library.tsx (the `scope` memo, `loadArchived` effect, `ArchiveStatus`, the count line, empty states), src/web/useShelf.ts (archive/undo/restore/rename across both arrays, `archivedFailed`), src/web/ShelfControls.tsx (the Archived chip, `bare`), src/web/ShelfEntry.tsx (ArchivedMark, Put back, TIPS), src/web/library-columns.tsx, src/web/shelf-narrow.ts (`availableTopics`, `isArchived`), src/web/ShelfTerms.tsx, tests/shelf-archived-in-the-list.test.tsx. The spec is the plan's § Stage 2 and § Reviews R2–R5 (docs/plans/260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md).

**Stage 1's files (src/shelf-terms/*, scripts/*, tests/shelf-terms-*) are under a separate review right now — do not edit them.**

## Please
1. Reader-visible wrong behaviour and data-state bugs: the one merged list (sort order, fixture sink, row cap, search/Unread/topics, counts, "(n active + m archived)"); archive with Archived on and off, Undo, Put back, rename — does any sequence duplicate a row, lose one, or leave the two arrays disagreeing with the server? The cached-shelf paint (lib/cached-shelf.ts) with `?archived=1`; a direct `?archived=1` load; archive-load failure; the all-archived reader; zero pills removed before the first 12, a chosen zero pill kept, "All N"; the detail view; tooltips' wording in both states; `aria-pressed` and names.
2. Run `npx vitest run tests/shelf-archived-in-the-list.test.tsx tests/shelf-topics.test.tsx tests/shelf-topics-detail.test.tsx tests/shelf-narrow.test.ts tests/shelf-view-switch.test.tsx`.
3. Fix narrowly, red first, inside Stage 2's files; report anything wider. Do not commit.

## Output
Findings S2-1… with severity (P0/P1/P2/P3), established or reasoned, evidence, what you changed. Test tail. One-line verdict.
