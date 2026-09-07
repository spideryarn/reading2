# Round-two check: the fixes for the two P1s, narrowly scoped

**This is not general discovery.** You reviewed this work twice — the plan, then Stages 6, 7 and 8 —
and both rounds are settled. This round exists for one reason: two of your P1s (**R1** and **F6**)
were fixed *after* the snapshot you reviewed, so nothing has checked those fixes. Please check **only
those two fixes**, plus the two P2s fixed alongside them (**F7**, **F8**) if you have budget left.

Do not reopen findings you have already made and I have already accepted. Do not raise new P2/P3s in
areas you have already passed.

## The candidate

Repository `spideryarn2`, branch `worktree-cost-tracking-price`, HEAD `25b57953` (a clean merge of
`origin/dev`, 23 commits, no conflicts, none of them in these files).

- **`65d28d68`** carries the R1 fix (and R2–R6).
- **`1282f926`** carries the F6, F7, F8 and F9 fixes.
- `git show 65d28d68` and `git show 1282f926`.

## What the two P1s were, and what I did

**R1 — `--owners` let `unknown` into the pricing basis.** It chose product with
`COST_CATEGORIES.filter((c) => c !== "non-product")`; `unknown` is not `non-product`, so an
unrecognised scope entered `ALL PRODUCT` and the per-account spread. You reproduced it with
`scopeKind: "retired-in-2025"` contributing 123 nanos to owner spend.

*The fix:* `ownersReport` now folds `partitionByScope(groups).product` for `printSpread`,
`printOwners` and the margin, and keeps the full fold for the coverage header and the category
table. `printSpread` and `printOwners` now take all of `COST_CATEGORIES` because the fold handed to
them is already scope-narrowed. Two tests in `tests/cost-report.test.ts` —
`"keeps an unrecognised scope out of the pricing basis…"` and `"keeps an unrecognised JOB in the
pricing basis…"`.

**F6 — Stage 8 fixed only `--owners`.** *The fix:* `billReport`/`outsideCapNanos` extracted into
`src/cost-report.ts` (pure, no I/O), `printBills` renders them for `--owners`, and a new
`printBillsPlain` renders the same builder's output in the ordinary report, placed immediately before
the unmetered list so the caveat's "every entry under 'no seam can see' below" still points at
something. One wording of the caveat, as you asked.

**F7** — `costCategoryOf` now consults `dispositionOf(job)`: voice from the table, a mismatched scope
→ `unknown`, `no product path` in step scope not classified by its step. Historical jobs return
`null` and keep the old step-name path. **F8** — eight tests over the extracted builder, including on
the caveat's wording.

## The questions I actually want answered

1. **Is the R1 fix complete?** Is there any remaining path by which a non-product or unrecognised row
   reaches the spread, the owner table or the margin? Does `printCategories` / the coverage header
   still correctly show *everything* — I intended those two to keep the unnarrowed fold.
2. **Did narrowing the fold break the denominator or the percentiles?** `printSpread` takes
   `population` separately; I did not change that, but the fold it reads from is now smaller.
3. **Is the F6 placement right** — `printBillsPlain` before `unmetered()`? And is
   `accountsInWindow` being called a second time there acceptable, or should the ordinary report
   derive its tallies from the rows it has already loaded?
4. **F7: does the mismatched-scope rule change the classification of any row that exists today?** I
   believe not — I checked every `(scope, job, step)` triple in the dev ledger by hand — but that is
   an argument I would like attacked.

## Evidence

`npm run cost` now prints the bill block; `npm run cost -- --owners` prints it in the coverage header.
319 tests green across `cost-report`, `cost-categories`, `ai-cost-cli`, `ai-spend`, `ai-call-images`,
`cost-eval`, `ai-calls-spend-pg`, `admin-spend-column`, `store-ai-calls`. `npm run typecheck` and
`npm run cycles` clean. F8's tests proved by mutation (dropping the BYOK term: `expected +0 to be
5000000`).

`tests/cost-report.test.ts` and `tests/cost-categories.test.ts` need nothing outside the tree — run
them. Postgres is mine.

## Severity and verdict

Same scale as before (P0 data loss / exploitable security / incorrect charging; P1 user-visible wrong
behaviour or an authoritative contract violated; P2 design risk; P3 prose). IDs continuing from F9.

End with: *the two P1 fixes are sound* / *the two P1 fixes are not sound, because …*.
