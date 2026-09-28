No P0 findings. I fixed three P1 issues and left the changes uncommitted.

### Findings

- **S1-1 — P1 — established:** Unicode-equivalent accents and word-joining hyphens produced different keys; uppercase possessives leaked into labels. This could split membership between visually identical topics. Fixed with NFC/hyphen normalization and case-insensitive possessive stripping; bumped `EXTRACTOR_VERSION` to 2. Evidence: [extract.ts:38](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/extract.ts:38), [extract.ts:128](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/extract.ts:128), [extract.ts:307](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/extract.ts:307), [test:51](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-terms-extract.test.ts:51).

- **S1-2 — P1 — established:** The 12% English-marker threshold rejected grammatical English dense with proper nouns: the regression paragraph scored 11.6%. Lowered it narrowly to 10%; the existing French rejection remains green. Evidence: [extract.ts:99](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/extract.ts:99), [test:214](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-terms-extract.test.ts:214).

- **S1-3 — P1 — established:** “Numbered” back-matter matching accepted `7. References` but missed common forms such as `7.1 References` and `A. Bibliography`, allowing bibliography text into candidates. Expanded only the numbering prefix. Evidence: [extract.ts:368](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/extract.ts:368), [test:301](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-terms-extract.test.ts:301).

- **S1-4 — P2 — established, report only:** Shelf-wide label aggregation assigns an article’s entire count to that article’s winning form. For example, per-article distributions `Title 3/lowercase 2` and `lowercase 4` are aggregated as `Title 5/lowercase 4`, although lowercase actually wins 6–3. Exact aggregation requires storing per-form counts, widening the planned persisted candidate shape. Evidence: [extract.ts:58](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/extract.ts:58), [choose.ts:198](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/choose.ts:198).

- **S1-5 — P2 — reasoned, report only:** Counting every stored top-200 occurrence for IDF is conceptually defensible—IDF normally counts occurrence, not facet membership—but it is cutoff-dependent and includes title-only/shallow mentions. A valid member facet can receive zero quality if its key happens to survive the top-200 in every work. This needs corpus measurement before choosing member-DF instead. Evidence: [choose.ts:151](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/choose.ts:151), [choose.ts:193](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/choose.ts:193).

- **S1-6 — P2 — reasoned, report only:** A long work can still elevate quality through raw `bodyCount`; logarithmic TF and averaging constrain but do not eliminate that influence. The implementation matches the plan’s formula, so changing it without the Stage 2 shelf report would be speculative. Evidence: [choose.ts:184](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/choose.ts:184), [choose.ts:191](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/choose.ts:191).

- **S1-7 — P2 — reasoned, report only:** `stemForOverlap` handles the motivating cases but can conflate `formal`/`form` or `authority`/`author`, while missing `activity`/`active`. Because it only suppresses terms above 0.3 Jaccard, I left the deliberately crude v1 rule unchanged pending corpus evidence. Evidence: [choose.ts:85](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/shelf-terms/choose.ts:85).

- **S1-8 — P3 — established, report only:** The plan’s landed note now says 50 tests and a 12% threshold; the corrected code has 53 tests and 10%. I did not edit the plan because the prompt restricted fixes to the four source/test files. Evidence: [plan:319](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:319).

### Requested test command

```text
 Test Files  2 passed (2)
      Tests  53 passed (53)
   Start at  02:34:08
   Duration  1.11s
```

Typechecking passed across all four TypeScript projects; targeted Biome lint passed. Full `npm test` could not start its database-backed lanes because local Postgres was unavailable under the sandbox.

**Verdict: Stage 1 is ready to proceed with the uncommitted fixes; the remaining issues are measured-design or future data-shape decisions, not blockers.**