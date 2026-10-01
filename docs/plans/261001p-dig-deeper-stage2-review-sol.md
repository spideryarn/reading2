Verdict: LAND AFTER FIXES — the P1 defect is fixed; one non-blocking pricing inconsistency remains reported.

### Findings

**F15 — P1 — FIXED — Dig deeper lookups disappeared under a standalone Find model override.**  
[src/store/pg.ts:3821](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/store/pg.ts:3821), [src/citations.ts:931](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citations.ts:931)

Dig deeper stored the lookup fingerprint using `DIG_DEEPER_MODEL`, but the shared read side recomputed only standalone Find’s configured model. With `SPIDERYARN_CITATIONS_FIND_MODEL` set, the saved verdict disappeared on reload and a subsequent press repeated the lookup.

The read side now accepts both current policies. Standalone Find’s call model and behaviour remain unchanged.

Red-first: `attaches a Dig deeper lookup even when standalone Find has a model override` initially expected `assessed` but received `undefined`. The unit test now passes, and the Postgres route test exercises reload plus a second press under an override.

**F16 — P2 — FIXED — the answer retained the old 3,000-token ceiling after moving to reasoning Opus.**  
[src/citation-investigate.ts:176](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:176)

Reasoning uses the same output allowance, and Stage 1’s measured Dig deeper allowance is 4,000 tokens. Citations now reuses `DIG_ANSWER_TOKENS`.

Red-first: [tests/citation-investigate.test.ts:363](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/tests/citation-investigate.test.ts:363) failed with received `3000`, expected `4000`; it now passes.

**F17 — P3 — FIXED — stale rename and provenance wording remained.**  
[src/store/export-bundle.ts:593](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/store/export-bundle.ts:593), [src/citation-investigate.ts:34](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:34), [src/types.ts:3985](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/types.ts:3985)

Reader exports still said “What Investigate wrote,” while comments described only the answer call’s “own” extracts despite the forced-search evidence being merged in. The export now says “Dig deeper,” and the provenance contract consistently describes all extracts shown to the answer.

Red-first evidence: the source scan found both old export strings. Regression assertions were added to the existing export suite; that suite requires Postgres and could not run here.

**F18 — P3 — REPORTING — the measured-cost comment uses the wrong Opus price.**  
[src/citation-investigate.ts:205](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:205), [src/models.ts:256](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/models.ts:256), [src/pricing.ts:191](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/pricing.ts:191)

The comment prices Opus 5.5 at $5/$25 and estimates roughly $0.42, while the model decision records $4/$20. At $4/$20, the recorded press is approximately $0.34–$0.35. `src/pricing.ts`’s $5/$25 row is for the older `claude-opus-5`, exposing a wider pricing-source inconsistency.

The actual `$0.80` budget, 25 global fills, `$20` fuse, and summed lease remain conservative and sound, so I did not change this wider source-of-truth issue.

All other attacked properties held: forced search runs once and fails closed before later paid work or saves; the lease is released; reader-visible calls use `DIG_DEEPER_MODEL`; version 7 reattaches while version 6 does not; forced-search evidence is merged and truthfully counted; the cached prefix is unchanged; and older clients ignore the new unknown stage safely.

Verification:

- Focused suite: 343/343 passed.
- Final changed-test rerun: 151/151 passed.
- Typecheck: all four projects passed; 2,589 files covered.
- Focused lint: passed, with existing complexity/optional-chain advisories.
- `git diff --check`: passed.
- Full `npm test`: blocked because this sandbox cannot connect to Postgres.

Because `src/store/pg.ts` and the investigate route test changed, the previously run Postgres results do not cover the final diff. Please rerun `citation-investigate-route.test.ts`, `citation-find-route.test.ts`, and `store-export-bundle.test.ts`.

No commit was made.

### Files changed

- `src/citation-investigate.ts`
- `src/citations.ts`
- `src/store/export-bundle.ts`
- `src/store/pg.ts`
- `src/types.ts`
- `src/web/CitationInvestigation.tsx`
- `tests/citation-investigate-route.test.ts`
- `tests/citation-investigate.test.ts`
- `tests/citation-lookup.test.ts`
- `tests/store-export-bundle.test.ts`