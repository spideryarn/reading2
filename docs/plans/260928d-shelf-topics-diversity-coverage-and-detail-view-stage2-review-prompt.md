# Stage 2 code review prompt: shelf topics round two (260928d)

Reviewer-fixer. **Time-boxed: finish within ~20 minutes; a production deploy takes dev at 15:50 BST.** Correctness and accessibility only.

**Candidate (committed)**: 9af75f80 — `git show 9af75f80 --stat`. Start with src/web/ShelfTerms.tsx, src/web/ShelfTermsDetail.tsx, src/web/ShelfTermChip.tsx, src/web/topic-colour.ts, src/web/params.ts (`libraryTopicsViewParam`), tests/shelf-topics-detail.test.tsx, tests/shelf-topics.test.tsx. The spec is the plan's § Stage 2 and § The detail view (docs/plans/260928d-shelf-topics-diversity-coverage-and-detail-view.md) and the state machine in its plan review's R7 as relayed there.

## Please
1. Reader-visible wrong behaviour: the pill row (first 12 in server order plus any chosen; "All N" only above 12, expanding in place); the detail view (every topic, rank order, bars = live count / max live count shown, "n of M on the shelf", distinct titles, links via `readHref`); the toggle (push history, focus kept); colour (decorative, aria-hidden, same slot on pill dot and row swatch; no colour value that is invisible in either theme — check colourscales.css `--cat-N` in light and dark); `aria-pressed`, names starting with the visible text; a disabled zero-count chip inside a row; the tooltip's distinct titles vs its physical counts.
2. Run `npx vitest run tests/shelf-topics-detail.test.tsx tests/shelf-topics.test.tsx tests/shelf-narrow.test.ts tests/last-view.test.ts`.
3. Fix narrowly, red first, inside these files; report anything wider. Do not commit.

## Output
Findings S2-1… with severity (P0/P1/P2/P3), established or reasoned, evidence, what you changed. Test tail. One-line verdict.
