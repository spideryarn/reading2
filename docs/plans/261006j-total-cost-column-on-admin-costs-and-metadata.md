# A total-cost column on `/admin/costs` and in Metadata

Queue item `qi-7jxr7pxn`. Report `spya-h2dzab` (Sentry SPIDERYARN-READING2-DS), a suggestion from
Greg, proved an administrator's against its production row (`feedback-reporter.ts`, exit 0). Filed
2026-10-06 14:06 UTC from
`/admin/costs?period=7d&by=task&article=article:b853a5c5-…`, build `f85c6477`. No screenshot.

> When displaying costs to an admin, you show per-call and number-of-calls - please add a total-cost
> column, both in /admin/costs and in Metadata, because that's what I care about most! That's what
> we should sort by, for example.
>
> — Greg, 2026-10-06

The pages are described in [admin-costs.md](../project/admin-costs.md) and
[cost-tracking.md](../project/cost-tracking.md).

## What is there already

Both tables already hold the figure he is asking for, and both already sort by it. The build he
filed from has the same columns as `dev` today (checked with `git show f85c6477:…`).

| Where | Columns, left to right | Resting order |
|---|---|---|
| `/admin/costs`, the ranking | *(label)* · **Recorded amount** · Share · *(bar)* · Calls · Per priced call · Unpriced · Failed | Recorded amount, largest first (`DEFAULT_SORT`) |
| Metadata § What it cost | Work · Kind · Calls · **Cost** | Cost, largest first (`totals()` in `ArticleCost.tsx`) |

So nothing is missing from the data. **What is missing is a heading that says "total".**

- On `/admin/costs` the total is called *Recorded amount*. That is our own term, chosen in
  [261005a](261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md) to say "not
  cash". It does not say "this is the row's whole cost", and it sits in a row with *Calls* and *Per
  priced call*, which are the two headings Greg names.
- In Metadata the heading is *Cost*, straight after *Calls*. Read left to right, "Calls, Cost" reads
  as "this many calls, at this cost each".

The browser look before the change is recorded under § Evidence.

## The change

1. **`/admin/costs`, the ranking**: the column headed *Recorded amount* is headed **Total cost**,
   in the header, in the header's sort button (its accessible name is built from the same label),
   and in the table's caption, which also names the box while it scrolls sideways. Its hover hint
   keeps the definition and says which headline figure the rows add up to: *"The row's recorded
   amounts added up: credits, BYOK and computed amounts; a floor when any call is unpriced (marked
   +). The rows add up to the recorded ledger amount above, not to the estimated cash"*. The column id
   stays `amount`, so every saved `?sort=amount` link still works.
2. **Metadata § What it cost**: the *Cost* heading becomes **Total cost**.
3. **The resting order is already total cost, largest first, in both places**, and a test already
   holds each: *ranks users by total cost, largest first* in `tests/admin-costs-page.test.tsx`
   (renamed here from *by recorded amount*) and *lists the lines largest first* in
   `tests/article-cost-section.test.tsx`. Nothing to change.
4. [admin-costs.md](../project/admin-costs.md) says the ranking's column is headed *Total cost* and
   is the recorded amount.

No new column, no query, no schema, no prompt.

### What stays called "recorded amount"

The headline figure at the top of `/admin/costs`, the pivot's and the chart's captions, and
`npm run cost:analyse`. There the name sits beside *Estimated cash*, and the difference between the
two is the point of it ([admin-costs.md § The rules the figures keep](../project/admin-costs.md#the-rules-the-figures-keep)).
A column in a table of rows has no such neighbour, so there "total" is the word that helps.

## Options passed over

- **Add a second column called "Total cost" and leave "Recorded amount".** That is the literal
  request, but the two columns would hold the same number in every row. Passed over: it widens a
  table that already scrolls sideways on a phone, and it leaves the reader to work out that two
  headings mean one thing.
- **Rename "recorded amount" to "total cost" everywhere** (headline, pivot, chart, the script and
  its HTML report). Passed over for now: the headline needs a name that is set against *Estimated
  cash*, and the script's wording is in tests and a report format that other work reads. It is a
  wider wording decision than this report asks for. Not queued: nothing is unbuilt, and Greg can
  ask for it if the mixed naming grates.
- **Add a "Per call" column to Metadata** so the total stands beside it as it does on
  `/admin/costs`. Not asked for, and it adds a column to a narrow card.
- **Make the Metadata table sortable by clicking a heading.** It has four columns and at most a few
  dozen rows, already largest first. Simplest version first.

## Assumptions

- **A1. Greg did see the "Recorded amount" column and did not take it for the total.** The other
  reading is that the column was off screen or blank for him. Checked, and it was not: § Evidence.
- **A2. "That's what we should sort by" is met by the resting order**, which is the total, largest
  first, on both tables. No new sort control.

## Stages

One stage. It is two headings, a hint, a caption, two tests and a doc line.

- [x] GPT Sol reviews this plan (`--sandbox review`)
- [x] Tests first, seen red: the ranking's heading and caption say *Total cost*; Metadata's heading
      says *Total cost*
- [x] The change, tests green, `npm run typecheck`, lint on the touched files
- [x] Browser check at 1440, 820 and 390, both pages
- [x] GPT Sol reviews the code (`--sandbox workspace-write`)
- [x] Full suite once (1747 files, 39080 tests passed), push to `dev`, the note in `docs/user-feedback/`, queue item done

## GPT Sol's review of the plan

[The review](261006j-total-cost-column-plan-review-sol.md), *approve with changes*. It checked the
claim above against the code and agreed: no view shows calls and a per-call figure without the
row's total, no filter or grouping hides the amount, and this table has no column-hiding control.

| Finding | What I did |
|---|---|
| 2 (P2). "Total cost" weakens recorded-versus-cash; call it *Total recorded amount* on `/admin/costs` | **Not taken, and answered another way.** "Total cost" is the administrator's own word for the thing he could not find, and *recorded amount* was the heading on the page he asked from. The distinction is kept where it is drawn: the headline still sets *Recorded ledger amount* beside *Estimated cash*, and the column's hint now says the rows add up to the first and not the second. If Greg would rather have Sol's wording it is one string |
| 3 (P2). "Every call added up" is false when a call is unpriced | Taken: the hint is Sol's wording |
| 4 (P2). The existing order test does not prove the default sort, because `groupRows` already hands the rows over largest first | Taken: the test now asks the header for `aria-sort="descending"` on *Total cost* and on no other. Seen red by setting `DEFAULT_SORT` to `calls`: § Evidence |
| 5 (P3). `/admin/costs` draws no sort chips and no Columns menu; the names are the header, its sort button and the caption | Taken: § The change says so |

## Evidence

**Before, in the browser** (local admin, `/admin/costs?period=all&by=task&evals=1`, then filtered
to one article as in Greg's address, at 1440, 1024, 820 and 390 wide): the same eight headings at
every width, *Recorded amount* second and in view without scrolling sideways (2px clipped at 390),
and filtering to an article changes nothing about the columns. So the column was on the page he
filed from. That it did not read to him as a total is still an inference (A1), not something the
report says. In Metadata the table was Work · Kind · Calls · Cost,
largest first, with nothing by the column saying "total".

**Red, then green.** Before the change, `tests/admin-costs-page.test.tsx` and
`tests/article-cost-section.test.tsx`: 2 failed, 62 passed, the two failures being the new heading
assertions. After: 64 passed.

**After, in the browser**, same pages and widths, no console errors:

| Page | Width | What was measured |
|---|---|---|
| `/admin/costs` | 1440 | *Total cost* at 384 to 478px, the sorted column (`aria-sort="descending"`), nothing scrolls sideways. [shot](261006j-shot-costs-1440.png) |
| `/admin/costs` | 820 | 247 to 341px, in view; the table scrolls in its own box as before. [shot](261006j-shot-costs-820.png) |
| `/admin/costs` | 390 | 213 to 307px inside a box ending at 351, so the 2px clip is gone (the heading is shorter). [shot](261006j-shot-costs-390.png) |
| Metadata § What it cost | 1440 | Work · Kind · Calls · Total cost, one line, largest first. [shot](261006j-shot-metadata-1440.png) |
| Metadata § What it cost | 390 | *Total cost* first broke over two lines; with `whitespace-nowrap` it is one line (267 to 338px), the table's scroll width equals its width, nothing overflows the card. [shot](261006j-shot-metadata-390.png) |

The hint on the header is the browser's own `title`, as for every column of this table.

## GPT Sol's review of the code

[The review](261006j-total-cost-column-code-review-sol.md), *approve with changes made*. I read its
diff and kept all of it.

| Finding | What happened |
|---|---|
| 1 (P2). My `aria-sort` assertion proved which column was sorted, not that the column's value is the total: in the fixture, calls, credits and total all ran the same way | Sol replaced it with a test whose calls and credits run against the total, plus a reversal from the header. It reports seeing it red with the accessor changed to `g.calls` |
| 2 (P3). The hint said "the recorded amount above"; the headline is *Recorded ledger amount* | Sol's wording. It also confirmed the rows add up to that headline in every grouping, and that the answer to plan finding 2 holds |
| 3 (P3). Old-heading sweep | Nothing else names this column by its old heading |
| 4 (P3). `whitespace-nowrap` in Metadata | No overflow path found. Its note that the 390 shot still showed two lines was about the earlier shot; the one committed is after the fix |
| 5 (P3). Comments said Greg looked for the heading and did not find it, which the report does not establish | Sol narrowed the code and test comments; I narrowed the line in `admin-costs.md` and one comment of mine in `ArticleCost.tsx` the same way |

## Deferred

Nothing. The wider rename of "recorded amount" (§ Options passed over) is a choice not made, not a
half left unbuilt, so it has no queue entry.
