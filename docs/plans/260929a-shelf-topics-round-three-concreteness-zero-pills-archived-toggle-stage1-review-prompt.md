# Stage 1 code review prompt: shelf topics round three (260929a)

Reviewer-fixer. **Candidate (committed)**: 2250b352 — `git show 2250b352 --stat`. Start with src/shelf-terms/choose.ts (`isVague`, `passesVagueTest`, the density rule in `collect`, `notBesidePrevious`, `adjacentSharedPairs`), scripts/build-word-lists.ts, src/shelf-terms/data/ (generated lists + ATTRIBUTION.md), tests/shelf-terms-choose.test.ts. The plan § Reviews and § Measurements (Stage 1) say what was decided and why; your plan review is the -plan-review-sol.md beside it.

**Other uncommitted files in the tree (src/web/*, docs/project/*, several tests) are Stage 2's work in progress — do not review or edit them.**

## Please
1. Wrong results a reader would see: does the density rule do what the plan says (a common, non-concrete single word counts only at ≥ max(4, 2 per 1,000 prose words); phrases untouched; concrete or rare words unchanged)? Lemma lookups that misfire (e.g. `-ing`→`e` producing a different word; plurals); words missing from Glasgow but common; does the adjacency rule keep determinism and the total order, and interact correctly with `admit` replacement? Could the generated data files break the Vercel server bundle (size, import shape, anything read at runtime from disk)?
2. The licence and attribution: is ATTRIBUTION.md accurate and sufficient for CC BY 4.0 (Glasgow) and for SUBTLEX-US as described? Is the generator reproducible from the documented sources?
3. Run `npx vitest run tests/shelf-terms-choose.test.ts tests/shelf-terms-extract.test.ts tests/shelf-terms-warm-path.test.ts`.
4. Fix narrowly, red first, inside these files; report anything wider. Do not commit.

## Output
Findings S1-1… with severity (P0/P1/P2/P3), established or reasoned, evidence, what you changed. Test tail. One-line verdict.
