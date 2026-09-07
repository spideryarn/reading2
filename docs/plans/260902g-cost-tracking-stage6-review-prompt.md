# Review: Stage 6 of the cost-tracking second pass — the two P1s

You reviewed the plan for this pass and found these two defects (F1, F2). This reviews **the code
that fixes them**. Attack the fixes; do not re-derive the findings.

## The candidate

Repository `spideryarn2`, branch `worktree-cost-tracking-price`.

- **Commit `a0d60581`** is the whole of Stage 6.
- `git show a0d60581` and `git diff 416c95b4 a0d60581` are the same six files.

Changed paths — a starting point, not a limit on scope:

```
src/ai-spend.ts                    F1: paidLooksFree, warnPaidLooksFree, moneyFields
src/cost-report.ts                 F2: partitionByScope (appended at the end)
scripts/ai-cost.ts                 F2: the ordinary report's pockets
tests/ai-call-images.test.ts       F1: two flipped assertions + one message regex + one title
tests/cost-report.test.ts          F2: four new tests
docs/plans/260902g-cost-tracking-that-can-set-a-price.md   § Stage 6
```

Nothing untracked. The plan's § Second pass and § Stage 6 record the reasoning.

## What was done

**F1.** `normaliseByokUpstream` keeps its `is_byok === true` narrowing untouched. A new predicate
`paidLooksFree` recognises the gap shape (`provider_account = openrouter`, `cost_source = provider`,
`cost = 0`, a non-zero upstream figure, `is_byok` not true) and a new `moneyFields` returns all five
money fields together — for that shape, `cost_source: "none"` with every money column null; otherwise
exactly what the five ternaries produced before. The warning still fires, once, with new wording.

**F2.** `partitionByScope` in `src/cost-report.ts` splits rows into `product` (`request | job_step`),
`devCli`, `evals` and `other`. `scripts/ai-cost.ts` prints four pockets instead of two.

Measured on the shared dev Postgres, before and after, same window:

| | before | after |
|---|---|---|
| Product spend | $21.1886 / 837 calls | $18.5050 / 489 calls |
| Dev CLI spend | (inside Product) | $2.8501 / 349 calls |
| Eval spend | $28.8609 / 387 calls | unchanged |
| All recorded | $50.0495 / 1224 | $50.2160 / 1225 (one new row arrived between runs) |

## Evidence

Both fixes were watched red first. F1 failed on `expected +0 to be null`; F2 failed 3 of its 4 new
tests.

Green after: `tests/ai-spend`, `ai-cost-cli`, `cost-report`, `cost-categories`, `ai-call-images`,
`cost-ledger-shortfall`, `annotation-cost`, `cost-eval`, `request-spend`, `job-spend-fields` — **296
tests, 10 files**. `npm run typecheck` clean across 1514 files.

**You have no network and no Postgres.** `tests/cost-report.test.ts`, `tests/cost-categories.test.ts`
and `tests/ai-call-images.test.ts` need nothing outside the tree — run them. Anything needing
Postgres is mine; ask and I will paste raw output.

## Independent pass — do this first

- **F1's blast radius.** `moneyFields` replaced five inline ternaries at the projection. Is the
  non-`paidLooksFree` branch byte-for-byte the old behaviour for every arm of `SpendProvenance`? Is
  there any row shape that now takes the `none` branch and should not — in particular an ordinary
  BYOK plate (`is_byok: true`), or a `computed` row, or a `provider` row with a genuine zero and no
  upstream figure at all?
- Does recording `cost_source: "none"` break anything downstream that assumed `provider` implied a
  non-null `credits_used_nanos` — reconciliation, `totalRows`, the SQL sum, the admin column, the
  realtime path?
- **F2's blast radius.** Does anything else in the tree still define product as "not eval"? Does the
  `--owners` report, the admin spend column, or `jobSpend()` need the same correction?
- Is `other` the right call, or does an unrecognised scope belong somewhere else?
- Is `All recorded` still correct now that it folds four pockets rather than two? I changed it from
  summing two pockets to summing `rows`.
- Anything in the new prose that is now false, over-claimed, or will read as a lie in a month.

## Severity

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Every finding gets an **ID**, a severity, file and line, and the smallest fix you would accept. End
with a one-line verdict: *approve as written* / *approve after these revisions* / *do not land this*.

## My own suspicions — read last, spend most of the run elsewhere

1. `moneyFields` returns a `Pick<AiCallRow, …>` spread into an object literal. If a money field is
   ever added to `AiCallRow` and not to the `Pick`, the compiler will demand it at the call site
   rather than here — which is the right error in the wrong place, and I am not sure it is caught.
2. The `other` bucket is unreachable today: `ScopeKind` has exactly four members and all four are
   handled. It may be ceremony rather than the guard I argued for.
3. I changed `All recorded` to fold `rows` directly. That is now the only line that includes `other`,
   and if `other` is ever non-empty the pockets above will not visibly add up to it.
