# Stage 1 code review prompt: shelf topics round two (260928d)

Reviewer-fixer. **Time-boxed: a production deploy takes dev at 15:50 BST; finish within ~20 minutes.** Correctness only; skip style.

**Candidate (committed)**: 37cb66bd — `git show 37cb66bd --stat`. Start with src/shelf-terms/choose.ts (greedy, `admit`, the containment skip, the short-plural merge, `minCoverageWords`), src/web/ShelfTerms.tsx (rank order), tests/shelf-terms-choose.test.ts, tests/shelf-topics.test.tsx. The plan (§ Measurements, § Reviews) says what was decided and why; your plan review is docs/plans/260928d-...-plan-review-sol.md.

Other uncommitted files in the tree (src/web/params.ts, src/web/ShelfTermChip.tsx, src/web/ShelfTermsDetail.tsx, src/web/topic-colour.ts, tests/shelf-topics-detail.test.tsx) are Stage 2's work in progress: do not review or edit them.

## Please
1. Wrong results a reader would see: can the short-plural merge wrongly merge two real words (e.g. `bus`→`bu`, `gas`→`ga`, `its`, `yes`, `ups`) when both keys exist? Can `admit` replacing a topic in place break the total order / determinism, or leave a topic whose article list disagrees with membership? Does the chooser still return every topic's articles as physical members with literal counts? Does the UI still keep a selected topic beyond the first 12 visible, and never drop a chosen chip?
2. Run `npx vitest run tests/shelf-terms-choose.test.ts tests/shelf-terms-extract.test.ts tests/shelf-topics.test.tsx`.
3. Fix narrowly, red first, inside these files; report anything wider. Do not commit.

## Output
Findings S1-1… with severity (P0/P1/P2/P3 as before), established or reasoned, evidence, what you changed. Test tail. One-line verdict.
