# Review: Stages 7 and 8 of the cost-tracking second pass

You reviewed the plan for this pass and found F3 and F4. This reviews **the code that implements
them**, in two commits. A separate review of Stage 6 (F1, F2) is running against `a0d60581`; do not
spend time there.

## The candidate

Repository `spideryarn2`, branch `worktree-cost-tracking-price`.

- **`c005bd5a`** — Stage 7, your F4: the job disposition table.
- **`d8dcc291`** — Stage 8, your F3: which bill, and what the cap cannot see.
- `git diff a0d60581 d8dcc291` is exactly these two stages.

Changed paths — a starting point, not a limit on scope:

```
src/cost-categories.ts             F4: JOB_DISPOSITION, the derived set, corrected CATEGORY_MEANING
tests/cost-categories.test.ts      F4: five new tests
src/store/ai-calls-spend-pg.ts     F3: accountsInWindow + AccountTally (appended at the end)
scripts/ai-cost.ts                 F3: printBills, wired into printCoverage
tests/ai-calls-spend-pg.test.ts    F3: two new Postgres tests
docs/plans/260902g-cost-tracking-that-can-set-a-price.md   §§ Stage 7, Stage 8
```

Nothing untracked.

## What was done

**Stage 7 (F4).** `JOB_DISPOSITION: Record<AiJob, JobDisposition>` with your four values —
`interactive request work` / `step-driven` / `voice` / `no product path`. `INTERACTIVE_REQUEST_JOBS`
is now derived from it. `link-summary` is placed as interactive; `pdf`, `pdf-frontmatter` and
`illustrate` as step-driven; `env-proposal` and `eval` as no-product; `live_conversation` as voice.
`CATEGORY_MEANING`'s claim of "PDF transcription" as interactive work was removed — no `request /
pdf` row has ever existed.

**Stage 8 (F3).** `accountsInWindow` groups by `provider_account` and returns credits / BYOK /
computed **separately**, so the outside-the-cap figure can include OpenRouter's BYOK pocket. The
credential tally is kept. `printBills` prints a line per account plus a fixed note that says the
report cannot see the cap amount or headroom, that unpriced and unmetered spend are missing, and that
the cap is global rather than a throttle.

## Evidence

Stage 7's tests were watched red first (3 of 5 failed). **Stage 8's were not** — the implementation
came first, so instead the two assertions were proved to bite by mutation: regrouping
`accountsInWindow` on `cost_source` instead of `provider_account` produced `expected undefined to be
5` and `expected 30523500 to be 8000000`; restoring it produced 12/12 green. Raw output of the live
report on the dev Postgres:

```
  Paid with           66c3cdfc178e — 1225 call(s), $45.8884 in credits
  Billed to           openrouter  1225 call(s)  $45.8884 credits · $4.3276 BYOK upstream · $0.0000 computed  (14 unpriced)
                      $4.3276 of the above is RECORDED KNOWN-DOLLAR SPEND OUTSIDE THE CAP — …
```

`npm run cost -- --owners --all` now prints **no `UNCLASSIFIED` block**; it had
`request / link-summary / — 9 call(s) $0.0030` before. `interactive request work` went 52 → 61 calls.

Green: `cost-report`, `cost-categories`, `ai-cost-cli`, `ai-spend`, `ai-call-images`, `store-ai-calls`,
`admin-spend-column` — 154 tests; plus `ai-calls-spend-pg` 12. `npm run typecheck` and `npm run cycles`
clean.

**You have no network and no Postgres.** `tests/cost-categories.test.ts` needs nothing outside the
tree — run it. `tests/ai-calls-spend-pg.test.ts` needs Postgres and is mine; ask and I will paste raw
output.

## Independent pass — do this first

- **Is `JOB_DISPOSITION` actually load-bearing, or is it decoration?** The only consumer is the
  derived `INTERACTIVE_REQUEST_JOBS`, so `step-driven`, `voice` and `no product path` are all
  behaviourally identical today — three names for "not in the set". Does that make the distinction a
  comment pretending to be a type? If so, what is the smallest thing that would make it real?
- Is any placement in the table **wrong**? I placed `debate` step-driven, `embeddings` and `dictation`
  interactive, `illustrate` step-driven. Check each against where the collector is actually opened,
  not against the job's name.
- **Stage 8's outside-cap arithmetic.** `byokNanos + (account !== "openrouter" ? credits + computed
  : 0)`. Is that the right set? Should an `anthropic` row's BYOK pocket be double-counted by this
  expression — can such a row exist?
- Is the note under the bills honest, or does any sentence in it still imply a safety it cannot
  claim? It is long; is it long enough to be ignored?
- Does anything else in the tree need the same account split — `--reconcile`, the admin spend column,
  `jobSpend()`?
- Anything the two commits' prose now over-claims.

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

1. The first bullet above is my real worry: a four-valued table whose three non-interactive values
   have no behavioural difference may be worse than a boolean, because it looks like it is enforcing
   something.
2. Moving `pdf` out of the interactive set means a `request / pdf` row would now reach `unknown`. I
   believe that is correct and by design, but it is a behaviour change justified entirely by "the
   ledger has never held such a row", which is an argument from absence.
3. `printBills` prints for the ordinary report too, not only `--owners`. I did not add a second
   copy — `printCoverage` is only called by the owners report — so the ordinary `npm run cost` still
   says nothing about accounts. That may be the wrong call.
