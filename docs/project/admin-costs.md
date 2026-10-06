# `/admin/costs`, and the cost analysis an agent runs

Up: [architecture.md](architecture.md). How a call gets recorded at all is
[cost-tracking.md](cost-tracking.md); who may see the page is [admin.md](admin.md). This doc is
what the page and the analysis are **for**, the rules their figures keep, and how to run an
analysis when Greg asks for one.

> Create a rich /admin/costs that breaks down by user (and then within user, by article) or mode or
> model. Ideally in a couple of forms, e.g. table and pivot table and/or graph.
>
> Think through the kinds of questions I'm likely to want to ask, e.g. which users are spending the
> most money, why is this article costing so much money, why is this mode costing so much money, etc.
>
> Probably I'm going to occasionally ask you to do the analysis and make suggestions about
> inefficiencies and improvements re costs, so try and also think about how to make that kind of
> analysis as easy as possible.
>
> — Greg, 2026-10-04 (report `spya-mykvhz`)

The plan, the options passed over and GPT Sol's reviews are in
[261005a](../plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md).

## One cube, two readers

```
  ai_calls ──GROUP BY──▶ the cube ──┬─▶ GET /api/admin/costs ─▶ /admin/costs
                                    └─▶ npm run cost:analyse   ─▶ terminal, JSON, HTML report
```

`spendCube` ([`src/store/ai-calls-spend-pg.ts`](../../src/store/ai-calls-spend-pg.ts)) groups the
ledger once by day, owner, article, scope, job, step, wire, models, upstream, account, cost source
and outcome, and on a failed attempt by where it failed, its cause and its HTTP status. Every
table, pivot and chart is a fold of those rows, done by the pure functions in
[`src/cost-cube.ts`](../../src/cost-cube.ts), which the browser and the script share. **A figure on
the page and the same figure in a report cannot come from two definitions.** A new breakdown is a
new `Dimension` there, not a new query.

The analysis also reads **detail rows** (`spendDetail`, one per call), because a grouped sum cannot
find one expensive call or count the jobs behind a step. It checks the two reads agree to the
nano-dollar, and on the three attempt counts below, and refuses to report if they do not.

## The rules the figures keep

Each of these was a way the first design was wrong
([plan review](../plans/261005a-admin-costs-plan-review-sol.md)):

- **"Recorded amount" is credits + BYOK upstream + our own arithmetic**, the three pockets
  [ai-gateway.md § What it cost](ai-gateway.md#what-it-cost) keeps apart. It is not cash:
  "estimated cash" adds the credit-purchase fee to the credits pocket only.
- **An amount with an unpriced call behind it is a floor**, and is drawn with a `+`.
- **Amount per call divides by priced calls**, never all calls.
- **No token and no duration figure on the page.** The wires disagree about what an input token is,
  and summed duration is not elapsed time
  ([ai-gateway.md § `durationMs`](ai-gateway.md#durationms-is-per-call-and-three-different-ways-of-adding-it-up-are-wrong)).
  The script compares cache use inside one wire only.
- **"Mode or task", not "mode".** A pipeline step is usually a mode; `chat` or `dig-deeper-search`
  is a task with no mode to its name. `taskOf` is the one rule, shared with the metadata page.
- **The model is the one that answered**, falling back to the one asked for.
- **A row with an article id is that article. A row with only a recorded slug is not claimed to
  be one article**: a deleted article's slug can be minted again.
- **The ledger cannot say "re-run".** It records that a step was bought in several jobs for one
  article, not who asked or why ([`src/cost-categories.ts`](../../src/cost-categories.ts) says why).
  The lead is worded that way.
- **Failures and retries are counts, never rates, and "not measured" is never drawn as zero.**
  The reasons are in the next section.

## Failures and retries

The gateway retries some failures before acceptance, up to three goes, and none after acceptance.
The PDF reader and other caller-owned loops have their own policies
([ai-gateway.md § A transport blip is retried](ai-gateway.md#transport-retry)). This section makes
the recorded failures visible before changing that policy
([261006b](../plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md)).

The page has it under the explorer, and `npm run cost:analyse` prints the same figures in the
terminal, the JSON and the HTML report. Per UTC day and per mode or task:

| Figure | What it counts |
|---|---|
| Counted attempts | rows a retry loop of ours numbered. Context for the others, not a denominator |
| Retries | goes after the first |
| Gave up after the last go | calls whose third and final allowed attempt failed before acceptance; earlier refusals appear in the causes table |
| Died part-way | attempts that failed after the seam accepted the response, which can precede any answer content; see the shared definition below |
| Stalled | `aborted` rows classed `stall`: we stopped the call because the provider had sent nothing for too long. Shown with how many were part-way, as `3 (2 part-way)` |
| Timed out | `aborted` rows classed `deadline`: a recognised deadline expired while the attempt was active. It can cap one call, a turn, a processing step or a whole pipeline job, so it does not establish how long that attempt ran. Shown the same way |
| Stops not classified | `aborted` rows with no class: they do not say who stopped them, so any could be a stall or a timeout |

Stalled and timed out are never added to *died part-way*
([261006d](../plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md)). That one is
an **error** after acceptance; these are stops of ours, a row is never both, and the two are
different evidence about paying twice for a broken answer.

Under them, the causes: where the attempt failed, the cause, the HTTP status, the upstream, the
model, and the mode or task. A stall and a deadline are listed there as causes; a reader's Stop
(`abort`) is not one and is left out. All of it follows the period, the evals switch and every
filter.

Two rules, both from GPT Sol's review of the plan
([F4 and F5](../plans/261006b-count-ai-calls-plan-review-sol.md)):

- **Counts, not rates.** A ledger row is one attempt, not one call, and only some attempts were
  numbered, so no honest denominator exists. The counted attempts are shown beside the counts and
  no percentage is drawn.
- **Not measured is not zero.** With no numbered attempt, retries and give-ups are *not measured*.
  Part-way deaths use separate evidence: a numbered attempt or an error with a recorded phase.
  An unnumbered failure before acceptance therefore shows zero deaths, while older rows alone
  cannot supply a measured figure. These are observed counts, with incomplete coverage.
  Stalls and timeouts have evidence of their own again, a stop that says who stopped it: *not
  measured* when a group's only stops have no class, a number when every stop has one (zero
  included, and zero when nothing was stopped at all), and a number beside the *stops not
  classified* when it holds both. A stop with no class is an old row. Since
  [261006f](../plans/261006f-count-the-pipeline-job-deadline-as-a-deadline-and-class-live-conversation-stops.md)
  live conversation's stops carry the class `abort`, and the pipeline's deadline on a whole job is
  counted as a timeout.

What it does not count is said on the page itself, from `FAILURE_NOTES` in
[`src/cost-cube.ts`](../../src/cost-cube.ts): the stops that do not say who stopped them, a live
response with no terminal usage report, and the PDF reader's and the
embeddings' own retry loops. [ai-gateway.md](ai-gateway.md#transport-retry) says why each is
missing. The folds are `failureCountsOf`, `failureCountsBy` and `failureCauses` in the same file,
and `nothingMeasured` is the page and terminal's rule for folding a row away and showing the
breakdowns. A known count of unclassified stops keeps its day and task visible, even when no
attempt was numbered. The terminal only folds a counted day into its quiet-day total when it
has no recorded failure events and no unclassified stops. `FAILURE_DEFINITIONS` states each
seam's acceptance boundary and the distinction from answer content, and what a stall and a timeout
are.

**The existing "Failed or stopped calls" figure can rise after the recording fix**, because
malformed and error-envelope bodies previously recorded as `ok` now count as failures.
Moving an in-band error from `aborted` to `error` leaves that total unchanged, while adding it
to the part-way count ([ai-gateway.md](ai-gateway.md#transport-retry)).

## What the administrator sees of other people's articles

Until 2026-10-05 the admin pages showed money per account and never which articles somebody has.
Greg's request above widened that: spend is now shown per article, mode and model for each account
with a ledger row in the selected period. **What an article is called is still not shown.** Another
reader's article is an opaque id (`article 3f9a2c1e`), and a row whose article is gone is a keyed
hash; only the administrator's own articles carry a slug. No other owner's slug leaves the database:
SQL removes it and the shared helpers used by `spendCube` and `spendDetail` finish the one-way key.
The address bar holds ids and hashes, never an email or a slug.

Whether to show slugs, and with them an article's size and kind, is Greg's to decide: [Q-1] in the
plan.

## Running an analysis

```
npm run cost:analyse                              # local database, current UTC month
npm run cost:analyse -- --prod --all --lookup-unpriced --html --json
npm run cost:analyse -- --prod --month 2026-09 --commentary notes.md --html
```

[`scripts/cost-analysis.ts`](../../scripts/cost-analysis.ts) says what each flag does. What an
agent needs to know:

- **Read the `Target:` line.** `--prod` reads production through the verified client, inside one
  read-only transaction that is rolled back. Without it the local database is read, which is
  mostly evals.
- **It answers Greg's three questions already**: users ranked, the costliest articles with their
  breakdown by task and model, every task with its per-call spread and models.
- **Leads are where to look, not conclusions.** Each says what was measured and what that does not
  show. The cache lead flags only a task that makes several calls per job, the clearest case for reuse;
  a task it does not flag has not been cleared. Its amount is everything the flagged tasks spent,
  not a saving.
- **`--lookup-unpriced`** asks OpenRouter about a bounded set of the most recent unpriced calls that
  carry a generation id (free). What its usable records establish is the known shortfall —
  [the audit](../investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md) says why
  there is one.
- **Your own conclusions go in with `--commentary <file>`**, and appear at the top of the report
  under *Suggestions*. The script has no opinions; that section is where an agent's reading of the
  leads belongs. Check a lead against the code before recommending anything: a low cache share may
  be a prompt that cannot share a prefix
  ([prompt-caching.md](prompt-caching.md)), and a step bought twice may be a reader pressing
  *Find more*.
- **The report is one file with no script in it**, written with mode `0600`; its default path is
  under `logs/cost-reports/` (gitignored). It is not committed when it holds production figures. On
  the box, Greg copies it down: `scp <box>:<the printed path> . && open <file>`. A production report
  names users by id: production email addresses are not read from the box.

## Charts and tables: what was chosen

Following [third-party-library-selection.md](../reusable/third-party-library-selection.md); the
full comparison is in the plan.

- **Tables** are TanStack Table through the shared `DataTable`, as on `/admin/users`.
- **The pivot** is `pivotRows`, written here. `react-pivottable` is a drag-and-drop product far
  larger than a fixed two-dimension pivot.
- **Charts are our own** ([`src/web/cost-charts.tsx`](../../src/web/cost-charts.tsx)): ranking bars
  in HTML, one SVG chart of stacked bars per day. They use only attributes and CSS custom
  properties (`CHART_TOKENS`), so the script renders the same components into the static report.
  Recharts is the library to add the day a chart needs lines, zooming or rich hover; on 2026-10-05
  its static rendering was broken upstream, which ruled it out for the report.

## Not built

Each has a queue entry; the list and the reasons are in the plan's § Deferred.
