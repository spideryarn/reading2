No P1 findings. Three narrowly scoped P2s remain:

- **F10 — P2:** F7’s mismatch rule misses voice. [`costCategoryOf`](</home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/src/cost-categories.ts:278>) returns `voice` before checking scope. Thus `job_step / live_conversation / hierarchy` and `retired-in-2025 / live_conversation / hierarchy` classify as voice, not `unknown`. Guard voice with `scopeKind === "request"` and test both mismatches. Current producers always write live conversation as request scope, so this does not reclassify today’s legitimate rows.

- **F11 — P2:** F8 now tests the builder thoroughly, but not its wiring. [`cost-report.test.ts`](</home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/tests/cost-report.test.ts:303>) never reaches either CLI renderer. Deleting `printBills(bills)` or the ordinary `printBillsPlain(args)` call would still leave the suite green—the exact deletion mutation F8 cited. A small command/output integration assertion would close that gap.

- **F12 — P2:** The second [`accountsInWindow`](</home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/scripts/ai-cost.ts:760>) call is operationally acceptable, but it reads a later snapshot than the ordinary report’s rows. A call arriving between the reads can make “Billed to” disagree with every preceding total. Since the ordinary path already has complete rows, deriving its tallies from those rows is preferable; performance alone is not concerning at present.

Answers:

1. **R1 is complete.** Only `request` and `job_step` groups reach spread, owner rows, and margin. CLI, eval, and unrecognised scopes cannot leak through. An unrecognised *job* in a recognised product scope remains included intentionally. Coverage and categories still receive the full fold.

2. **The denominator and percentiles remain correct.** `population` is unchanged and is still supplied independently. `spendPerAccount` maps that full population against the narrowed fold, preserving zero-spend accounts. The fallback population comes from the full fold, which is also correct.

3. **F6’s placement is right.** The bill block immediately precedes `unmetered()`, so “under ‘no seam can see’ below” has its intended referent.

4. **F7 does not appear to reclassify any currently produced row.** The changed cases are recognised interactive/no-product jobs appearing in `job_step` scope; current producers do not create those triples. Historical unknown jobs retain step-based classification. The voice mismatch described in F10 remains unchanged from the old classifier.

Focused verification: 48/48 tests passed across the two requested files.

*the two P1 fixes are sound*.