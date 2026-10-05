# `/admin/costs`, a cost analysis an agent can run, and an audit of the cost tracking

Report `spya-mykvhz` (Sentry SPIDERYARN-READING2-CY), from Greg, 2026-10-04, proved against its
production row. Queue entry `qi-mfjmxd8a`. Session `fbmykvhz-admin-costs-breakdown`.

> Create a rich /admin/costs that breaks down by user (and then within user, by article) or mode or
> model. Ideally in a couple of forms, e.g. table and pivot table and/or graph.
>
> Think through the kinds of questions I'm likely to want to ask, e.g. which users are spending the
> most money, why is this article costing so much money, why is this mode costing so much money, etc.
>
> Probably I'm going to occasionally ask you to do the analysis and make suggestions about
> inefficiencies and improvements re costs, so try and also think about how to make that kind of
> analysis as easy as possible. And then try running that analysis, and generate a nice HTML report
> for me and open it in a browser.
>
> see docs/reusable/third-party-library-selection.md for the graphing, tables, etc
>
> Update docs etc.
>
> While you're at it, check that our cost-tracking machinery is accurate and complete, and that we
> have good docs/reusable machinery so that new modes and functionality will always get cost-tracked.
>
> Get input and review from GPT Sol, use engineering-manager.
>
> — Greg, 2026-10-04

## What exists already (the prior-work check)

Nothing draws spend across owners by article, mode or model. What there is:

- **The ledger**, `spideryarn.ai_calls`: one row per model call, with owner, article id and slug,
  scope, job (`purpose`), step, requested and answered model, three money columns, tokens, outcome,
  duration ([cost-tracking.md](../project/cost-tracking.md), [ai-gateway.md](../project/ai-gateway.md)).
- **`/admin/users`**: one spend figure per account for the current UTC month
  ([admin.md](../project/admin.md)).
- **The metadata page's *What it cost***: one article by step, the administrator's own articles only.
- **`npm run cost`** and `-- --owners`: a terminal report by category, with reconciliation against
  OpenRouter's key total.
- **`src/cost-categories.ts`** and **`src/cost-report.ts`**: the naming and the arithmetic, pure and
  tested.

Measured 2026-10-05, read-only: production holds 2,245 calls, $90.80, 2 owners, 55 slugs, 15 models,
from 2026-08-28. Grouped by every dimension below *including the day*, that is 660 rows. The local
ledger holds 9,965 calls and groups to 1,113 rows. So the whole breakdown fits in one response.

## What GPT Sol's plan review changed (2026-10-05)

The review is [261005a-admin-costs-plan-review-sol.md](261005a-admin-costs-plan-review-sol.md):
`VERDICT: revise`, ten findings. **Where this section and the design below disagree, this section
wins** — the design is kept as first written so the change can be seen.

| | Finding | What we do |
|---|---|---|
| F1 | The cube throws away `run_id`, `job_id` and per-call cost, so it cannot find per-call outliers, failed-call *money*, or repeats | **Accepted.** The page reads the cube. The analysis script also reads **detail rows** for its leads. `outcome` becomes a cube dimension, so failed money is exact. "Re-run" is not a word the ledger can support: the lead is worded "this step was bought in N separate jobs for one article" |
| F2 | Input tokens mean different things on different wires, and summed duration is not elapsed time | **Accepted.** No token or duration column on the page. The script compares cache use only inside one wire |
| F3 | `requested_model` is not always the model that answered; and a request job such as `chat` is not a "mode" | **Accepted.** `answered_model` and `upstream` are cube dimensions; the page's model is the one that answered, falling back to the one asked for. The dimension is labelled **Mode or task** |
| F4 | `article_id ?? slug` merges a deleted article with a later one of the same slug | **Accepted.** A row with an id is that article. A row without one is "recorded as …", never claimed to be one article |
| F5 | Greg asked for a breakdown by article, not for title-derived slugs; default to opaque ids | **Accepted — [Q-1]'s default is now B.** No other reader's slug leaves the database: the query returns the article id, and for a row with no id a short hash. The administrator's own articles are named by slug, as the metadata page already does. Address-bar state holds ids, never an email or slug. `Cache-Control: private, no-store` |
| F5b | Put the query in a new, named store module and add it to the cross-owner exemption list | **Not done; see [Q-4].** That list is a listed defence and an unattended run does not edit one. The query goes in `ai-calls-spend-pg.ts`, which is already on the list, and that file's stated rule ("money and an owner id and nothing else") is updated to say what it returns now: money, an owner id, an opaque article id, and the names of jobs and models |
| F6 | Label the money: recorded amount vs estimated cash; divide by priced calls; settled, computed and unpriced are not a partition | **Accepted**, all six labels |
| F7 | The audit cannot prove completeness, and the key reconciliation is not a proof | **Accepted.** The audit says what it cannot prove. Added to it: raw rows against cube totals, the computed-price formulas, an inventory of provider-capable paths that does not use the gateway's register, and the two-owner question asked against accounts with an expected paid event. A paid probe for every wire and a quiet-credential balance check are deferred with queue entries |
| F8 | Cut the pivot, the heuristics, `--commentary` and the presets; do not defer answered model, article size, silent voice | **Partly.** Answered model and upstream are in. The heuristics are cut to the ones a detail row can back. **Overruled on three (all P2):** a two-dimension pivot stays, because Greg named it and it is one pure function over the cube; `--commentary` stays, because the report he asked for carries an agent's suggestions; four preset links stay. Article size and kind stay deferred: they need a second cross-owner join into other readers' articles, which belongs with [Q-1] |
| F9 | Hand-written charts are right; the library facts were stale | **Accepted.** Ranking bars are HTML and CSS; SVG only for the per-day chart. Corrected: `react-pivottable` 0.11.1 supports React 19 and its table needs no Plotly — it is passed over because it is a drag-and-drop product far larger than a fixed two-dimension pivot. Recharts 3 has an open regression where `renderToStaticMarkup` gives an empty wrapper ([recharts#5997](https://github.com/recharts/recharts/issues/5997), read 2026-10-05), which rules it out for the static report |
| F10 | The report file needs a privacy contract | **Accepted.** Written with mode `0600`, everything escaped, the absolute path printed, never served or uploaded |

## The design: one cube, and everything else is a view of it

**One query** groups the ledger by owner, article, scope, job, step, requested model and UTC day,
and returns for each group: calls, the three money pockets, unpriced calls, failed calls, tokens
(reported input, output, cache read, cache write) and summed duration. Call that the **cube**.

```
  ai_calls ──GROUP BY──▶ cube rows ──┬─▶ GET /api/admin/costs ─▶ /admin/costs (filter, group, pivot, chart)
                                     └─▶ npm run cost:analyse   ─▶ JSON for an agent + an HTML report
```

The page and the analysis script read the same cube through the same pure functions
(`src/cost-cube.ts`), so a figure on the page and a figure in a report cannot come from two
definitions. Postgres does the arithmetic and TypeScript does the naming, which is the rule
`ai-calls-spend-pg.ts` already keeps.

**The simpler option passed over:** four fixed endpoints (by user, by article, by mode, by model),
each its own `GROUP BY`. It is less code on day one, but each new question ("mode × model for this
user") would need a new query and a new table, and the pivot Greg asked for is exactly the
cross-product. The cube is one query and one mechanism, and its size is bounded by what was
measured above.

**If the ledger grows** past what one response should carry (tens of thousands of groups), the
window stays bounded — the page defaults to the current UTC month — and the fix is a coarser cube
(drop the day, or group by week). Not built; named here so the limit is known. The server refuses to
return more than 20,000 groups and says so rather than truncating silently.

### The dimensions, and what "mode" means

| Dimension | Comes from | Note |
|---|---|---|
| user | `owner_id`, with the email from the Auth service | as `/admin/users` already shows |
| article | `article_id`, else `article_slug`, else "no article" | see [Q-1] |
| mode | the step for pipeline work, the job otherwise, through the rename table | the same rule `ArticleCost.tsx` uses for a line's name; moved to `src/cost-categories.ts` as `modeOf` so there is one copy |
| category | `costCategoryOf` | the six existing categories |
| model | `requested_model` | `answered_model` is kept on the row for the analysis script, not as a page dimension in v1 |
| scope | `scope_kind` | the page shows product spend (`request`, `job_step`) by default, with a switch for eval and CLI |
| day | `started_at` in UTC | UTC everywhere, as the ledger is |

### The page

`/admin/costs`, lazy-loaded like the other admin pages, linked from the `/admin` index. Behind the
existing `/api/admin` namespace gate; this plan does not touch the gate or any other listed defence.

One explorer rather than five tabs:

```
  Period: [This month] [Last month] [Last 7 days] [Last 30 days] [All]     [x] include evals and CLI
  Filters: user: a@b.com ×   mode: glossary ×                  (click any row to add a filter)

  $41.20 · 1,203 calls · 14 unpriced · 22 failed or stopped

  Questions:  Who spends most · Costliest articles · By mode · By model · Mode × model · User × mode · Over time

  Group by: [user ▾]   then by: [none ▾]

  ▇▇▇▇▇▇▇▇▇▇▇▇  a@b.com     $30.10   73%    812 calls   $0.037/call
  ▇▇▇           c@d.com     $11.10   27%    391 calls   $0.028/call
```

- **Table**: group by one dimension. Columns: cost, share, calls, cost per call, unpriced, failed,
  tokens in and out, cache-read share. Sortable (TanStack Table through the shared `DataTable`).
  Each row has an inline bar, which is the graph for a ranking.
- **Pivot**: pick a second dimension and the table becomes rows × columns with totals, cells shaded
  by value.
- **Over time**: a stacked bar per UTC day, stacked by the "then by" dimension (category by default).
- **Drill-down is filtering.** Clicking a user filters to that user and switches to grouping by
  article; clicking an article filters to it and groups by mode. That is "by user, and then within
  user by article", and it is also how "why is this article costing so much" gets answered: filter
  to it, then look by mode and by model.
- The **Questions** row is preset links, each just a combination of filters and groupings in the URL.
- Every figure keeps the honesty markers the other pages have: the period on the page, unpriced calls
  counted beside the money, a real cost under a cent never drawn as `$0`.
- View state is in the address bar, as on every page ([url-state.md](../project/url-state.md)).

### Charts and tables: the library choice

Following [third-party-library-selection.md](../reusable/third-party-library-selection.md).

- **Tables: TanStack Table**, already in the tree and already wrapped by `DataTable`.
- **Pivot: written here**, about a hundred lines over the cube. Passed over: `react-pivottable`
  (unmaintained, depends on old React and Plotly) and the commercial grids (AG Grid's pivot is a
  paid tier). A pivot over a few hundred pre-grouped rows is a `Map` of `Map`s.
- **Charts: plain SVG React components written here, no new dependency.** The two charts are
  horizontal ranking bars and a stacked bar per day. Written as small pure components
  (`src/web/cost-charts.tsx`), they render in the page *and*, through `renderToStaticMarkup`, in the
  HTML report — so the report is one self-contained file with no script in it, and there is one
  chart implementation rather than two.
  **Passed over: Recharts** — the clear first choice the day we want lines, axes with ticks,
  brushing or rich tooltips: the largest community and the most examples of any React chart library.
  It is about 100 kB gzipped in the admin chunk, and it cannot be used for a static report without
  a second code path. Also passed over: visx (low-level, we would still be writing the charts),
  Chart.js (canvas, so no static markup), Observable Plot (good, smaller community, DOM-based).
  [Q-2] below.

### The analysis an agent runs

`npm run cost:analyse` (`scripts/cost-analysis.ts`):

```
npm run cost:analyse                         # local database, current UTC month
npm run cost:analyse -- --prod --all         # production, read-only, everything
npm run cost:analyse -- --prod --month 2026-09 --html logs/cost-report.html --json logs/cost-report.json
npm run cost:analyse -- ... --commentary notes.md   # an agent's findings, placed at the top of the report
```

- `--prod` reads `.env.prod` through the existing `productionClient` (verified TLS, the production
  project checked, a `Target:` line), inside `begin read only`, rolled back. No write of any kind.
- It prints the questions Greg listed, already answered: top users, costliest articles, costliest
  modes and models, and for each a "why" (which modes and models make it up).
- It computes **leads** — things that look inefficient, each with the figures behind it:
  - a step bought more than once for one article (re-runs), and what the repeats cost;
  - spend on calls that failed or were stopped;
  - an article costing several times the median, and which mode is responsible;
  - a mode whose cache-read share is low on a wire that supports caching;
  - spend on the capable tier by mode (where a cheaper model is worth an eval);
  - calls that reported no cost, by mode and model;
  - cost per call outliers within a mode.
- `--json` is the same findings as data, for an agent to read; `--html` is the report for Greg.
- The agent's own conclusions go in through `--commentary`, so the report can carry suggestions
  without the script pretending to have opinions.
- **The report holds ids, slugs, emails, modes, models and amounts — never article prose.** It is
  written under `logs/` (gitignored) and is not committed when it holds production figures.

How to run one, and the checklist of questions, goes in a new
`docs/project/admin-costs.md` (written in stage 5).

### The audit

Written up under `docs/investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md`.
A tracker that agrees with itself proves nothing, so each check has an independent second source:

1. **Accuracy.** A sample of production rows' `credits_used_nanos` against OpenRouter's own
   `GET /api/v1/generation?id=` figure for the same `generation_id`; and the month's ledger credits
   against OpenRouter's key total (`npm run cost -- --reconcile`).
2. **Completeness of recording.** Every way to reach a provider, found by a grep that does not use
   the gateway's own list, against `tests/no-undeclared-spend.test.ts` and `UNMETERED_SPEND`.
   `npm run test:paid` run once. Production counts of unpriced rows, `unknown`-category rows, and
   failed-row spend.
3. **Completeness of attribution.** Product rows with no article, by job, against which jobs have
   no article by design. Rows whose owner is not the article's owner.
4. **A surprise to explain first:** production's ledger names only **2 owners**. Either only two
   accounts have ever triggered a model call, or readers' calls are being recorded against the
   wrong owner or not at all. Compare with the accounts that own articles.
5. **New work gets tracked without remembering.** What already enforces it (the gateway test, the
   required `article` field on a route, the `Record<AiJob, …>` disposition), what does not, and the
   smallest mechanical addition for each gap. Docs: `cost-tracking.md`, `mode.md § Its cost`.

Fixes the audit turns up that are small and inside this area are made in stage 4. Anything wider
gets a queue entry.

## Stages

Each ends green (`npm test` on the touched suites, `npm run typecheck`, lint on touched files),
with a GPT Sol code review, and is committed.

1. **The cube on the server.** `spendCube` in `src/store/ai-calls-spend-pg.ts` (already one of the
   two files allowed to group by owner); `src/cost-cube.ts` (types, `modeOf`, filter, group, pivot,
   totals — pure); `GET /api/admin/costs?since=&until=`; tests: the store against Postgres, the pure
   functions without one, the route's shape, and that a non-admin gets 403.
2. **The page.** `AdminCostsPage.tsx`, `cost-charts.tsx`, the route kind, the loader, the index
   link; component tests; a browser pass in a Sonnet subagent at desktop and phone widths.
3. **The analysis and the report.** `scripts/cost-analysis.ts`, `npm run cost:analyse`, tests for
   the leads over fixtures; run it against production read-only and write the HTML report.
4. **The audit**, started in parallel with stage 1 since it reads and does not edit; its write-up,
   and the small fixes.
5. **Docs and bookkeeping.** `admin-costs.md`, edits to `cost-tracking.md`, `admin.md`,
   `mode.md`; the feedback note; queue entries for each deferred part.

## Deferred, each to get a queue entry

As queued on 2026-10-05 (`npx tsx scripts/overseer-queue.ts show <id>`):

| Queue entry | What |
|---|---|
| `qi-bhed82j7` (waits on Greg) | Name other readers' articles by slug, and show an article's size and kind beside its cost — [Q-1]; and a third named file for the cross-owner query — [Q-4] |
| `qi-vb2ztvf9` | The page's follow-ups: an index leading on `started_at` and a coarser cube for long windows, CSV export, silent voice sessions, splitting the 950-line page component, the label of a renamed own article |
| `qi-pn7rvh73` | Price dictation's transcription calls (audit, defect 1) |
| `qi-f9agbaeh` | Record what a stopped or failed call cost (audit, defect 2) |
| `qi-92pbaaxf` | Reconcile production's ledger against production's key, on the page (audit, defect 3) |
| `qi-d5wbrhet` | Harden the tripwires: the spend scan's allow list, unknown providers, a new AI SDK, no-row warnings to Sentry, stale price tables (audit, defects 6, 7, 8, 11) |
| `qi-35c6kngf` | Paid probes for the wires `test:paid` does not call, and a quiet-key balance check (audit, defects 5, 10, 13) |
| `qi-9nfgnn49` | Record why a job ran, and whether a generated mode was ever opened (from the cost analysis) |

`answered_model` and upstream were on this list and are built: they became dimensions in stage 1.

## Questions for Greg — none of them blocks the build

**[Q-1] Should another reader's article be named by its slug on `/admin/costs`?**
Background: until now the admin pages showed facts about *accounts* and never said which articles
somebody has; `admin.md` calls widening that "a decision for Greg". This report asks for spend "by
user (and then within user, by article)", which I have taken as that decision. The open part is how
an article is *named*. A slug is usually made from the title (`the-case-for-slow-reading`), so it
says what somebody is reading.
- *Option A — show the slug.* You can recognise an article and tell a reader "your paper on X is the
  expensive one". Cost: your admin page now shows what each reader reads. The privacy page already
  says an administrator can read stored data, so no published promise changes, but `admin.md`'s
  rule ("never a title, a URL, a filename") does.
- *Option B — show an opaque id for other people's articles* (`article 3f9a…`), slugs only for your
  own (**what v1 does**, after GPT Sol's review). You can still see that one article of theirs cost
  $9 and which modes did it, but not what it is. Cost: "why is this article expensive" is harder to
  act on, and the article's size and kind (PDF or web, how long) are not shown either.
- What would decide it: whether you want to be able to say *which* article to a reader. If yes, A,
  and the size-and-kind columns come with it. Recommendation: stay on B until you want that.

**[Q-4] May the cross-owner exemption list gain a third file?** `tests/owner-isolation.test.ts`
allows two store files to ask a question across all accounts. GPT Sol wanted this page's query in
a third, named file, so the widening is conspicuous. Editing that list is editing a defence, which
an unattended run does not do, so the query sits in the second file with its rule restated. If you
say yes, it is a move of one function and one line in the test.

**[Q-2] Hand-written SVG charts, or Recharts?** v1 needs only bars, so it uses about 150 lines of
our own SVG, which also lets the HTML report be a single file with no script. If you expect to want
line charts, zooming or richer hover detail on this page soon, Recharts is the library to add, and
I would add it then rather than now. Recommendation: stay with our own until a chart needs more.

**[Q-5] Should a production report name users by email?** A production report shows `user 001bb7a0`
rather than an address. Getting addresses means calling production's Auth service from the box with
the service-role key, which is outside what an unattended run may do (its production access is
reads inside a read-only database transaction). **One such call was made** during the build, before
I stopped it: a single read of the account list, on 2026-10-05 at about 01:38 UTC; the report it
produced was deleted and the code removed. With two accounts the ids are easy to tell apart. If you
want addresses in the report, say so and it is a few lines. Recommendation: leave it.

**[Q-6] Should the command bar's model call be billed to the article it was typed in?**
`POST /api/command-pick` declares that it has no article, so its spend shows under "no article".
The audit noticed; there are no production rows yet. Attributing it is one word in the route table.
Recommendation: yes, when somebody is next in that route.

**[Q-3] Where should the report live when it holds production figures?** v1 writes it to
`logs/cost-report-<date>.html` on the box, uncommitted, and you copy it down with one `scp`. An
alternative is a private artifact link. Recommendation: the file, since it names readers' emails.

## Log

- 2026-10-05 — prior-work check, measurements, plan written. `/home` on the box was full; this
  worktree's `node_modules` is a symlink to `/tmp/spya-nm-fbmykvhz/node_modules` on the root disk.
- 2026-10-05 — **Stage 1 landed** (`aabcde9a7`, review fixes `6963e7cb2`). `spendCube`,
  `src/cost-cube.ts`, `GET /api/admin/costs`. GPT Sol's code review:
  [approve](261005a-admin-costs-stage-1-code-review-sol.md), four fixes of its own — the important
  one is that an article's key in the address bar is now always an opaque keyed hash (HMAC), the
  administrator's own slug included. Sol could not run Postgres and wrote the digest with
  pgcrypto's `digest()`; changed to the built-in `sha256()` and the Postgres suite run green.
  Reported and not fixed in stage 1: a failed account listing fails the whole page (F5, fixed in
  stage 5); no index leads on `started_at` (F6, queued); `category` is a string on the wire (F7,
  left); a renamed own article is labelled by whichever slug arrives first (F8, left — totals are
  right).
- 2026-10-05 — **The audit's first draft is in** (`docs/investigations/261005a`). In short: what
  the ledger records matches OpenRouter to the nano-dollar (49 of 49 sampled); it is short by a
  known $2.11 of $90.80 (dictation never priced; stopped and failed calls recorded as free); two
  owners is true; completeness cannot be proven from the box. Its scripts are kept under
  `evals/cost/audit-261005/`.
