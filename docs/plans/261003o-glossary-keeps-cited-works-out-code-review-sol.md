1. **P1 — investigation counts and conclusion were wrong/overstated. Fixed.** [investigation](/home/greg/code/spideryarn2/.claude/worktrees/fbzn97q5-glossary-without-citations/docs/investigations/261003g-glossary-citation-entries-before-and-after-the-rule.md:11)

   The corrected old-arm counts are:

   - Named citation entries by run: `0, 2, 2, 1, 1` — six entries across four runs.
   - Citation aliases: `1, 2, 1, 1, 1` — six across all five runs. The report’s regex missed the first run’s yearless `Rakov and Uman` alias; the raw JSON contains it.
   - Shipped `v3-*`: no confirmed named citation entries; confirmed citation aliases occur in `v3-3` and `v3-7`. The `v3-8` Frankenstein alias is correctly not classified as a citation.
   - Entry/person sequences, means, and Arago’s `5/5 → 1/5 → 6/10` rates otherwise recount exactly.

   I also replaced “essays were unchanged” with the supportable conclusion: the two/three-run essay samples show no clear regression but cannot establish no change. The five unchecked author-shaped candidates are now explicitly a limitation, making two confirmed residual aliases a lower bound rather than the total failure rate. The plan, glossary documentation, and feedback note were corrected too.

2. **P1 — the prompt contradicted its new exception. Fixed.** [src/glossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbzn97q5-glossary-without-citations/src/glossary.ts:1091)

   The later unconditional “people and works … still earn entries” and “each term, and each person” lines now apply only to eligible entries and explicitly exclude citation-only names. WHAT DOES NOT, the worked example, and the alias rule now say one consistent thing. The shipped prompt does not quote the eval paper’s citations; its worked example remains from another field. The investigation discloses that these two consistency edits were not rerun.

3. **P1 — the guard missed `et. al.`. Fixed.** [src/glossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbzn97q5-glossary-without-citations/src/glossary.ts:297), [test](/home/greg/code/spideryarn2/.claude/worktrees/fbzn97q5-glossary-without-citations/tests/glossary.test.ts:382)

   It now catches `et al.`, `et al.,`, `et. al.`, uppercase forms, missing final punctuation, and non-breaking-space forms. The eval screen uses the same spelling rule. The test independently asserts the name list and surviving aliases, so it fails if either guard use is removed alone.

4. **P2 — the deterministic guard can still remove a real multiword phrase containing `et al.`. Not fixed.** [src/glossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbzn97q5-glossary-without-citations/src/glossary.ts:284)

   For example, `Guide to et al.` matches because any non-space token before `et al` qualifies. A standalone `et al.` or `et. al.` survives. This is the accepted trade-off for making the reported `Saha et al.` case impossible; I corrected the code and docs so they no longer claim the guard is false-positive-free.

No issues found with `dedupe`, id inheritance, the empty-result rule, or `added`: filtering occurs before dedupe/inheritance; an all-filtered first/rewrite correctly throws, while an append can add zero. The `glossary/9` bump reaches the pipeline stamp through the imported constant; remaining `glossary/8` literals are historical evidence or deliberately old fixtures.

Checks: 189 relevant tests passed; typecheck passed across all TypeScript projects; the generated eval report matches its saved report; lint had no errors, only the existing `toEntries` complexity advisory. Full `npm test` could not run because this sandbox blocks Postgres/Docker discovery; a broader unit attempt also hit unrelated sandbox-sensitive process tests.

Files changed:

- `src/glossary.ts`
- `tests/glossary.test.ts`
- `evals/glossary-citations.ts`
- `docs/investigations/261003g-glossary-citation-entries-before-and-after-the-rule.md`
- `docs/plans/261003o-glossary-keeps-cited-works-out-citations-are-not-terms.md`
- `docs/project/glossary.md`
- `docs/user-feedback/261003_1913-glossary-lists-a-cited-paper.md`

VERDICT: push after the P1 fixes I made