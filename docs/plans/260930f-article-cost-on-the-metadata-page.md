# 260930f — What an article cost, on its metadata page, for the administrator

Feedback report SPIDERYARN-READING2-68, from Greg's own account (trusted input). His words:

> In the metadata mode for admin users, can you include a section that shows cost estimates as best
> as we can calculate them, total for the article and also broken down by modes or whatever. If that
> means that we also need to upgrade our cost tracking machinery somehow, let's try and do that as
> well. Hopefully using kind of reusable machinery and updating our docs so that going forwards all
> new AI processing automatically has its costs tracked, just as hopefully all new modes
> automatically get, you know, tracked in the metadata and added to the commands. So there should be
> a new mode document and also an AI cost tracking document or something like that, so that going
> forwards we're just doing a good job of cost tracking. And maybe that needs tests. I'd be fine to
> have a bunch of tests that don't usually run because they actually do incur costs (using our API
> keys somehow) that then get tracked & checked.
>
> — Greg, 2026-09-30

## What is already there, which decides most of this

The machinery Greg is asking for mostly exists. Every paid call goes through one of two gateway
files and writes one row to `spideryarn.ai_calls` ([ai-gateway.md](../project/ai-gateway.md)), and
every row already carries `article_slug`, `step_name` and `purpose` (the `AiJob`). So "what did this
article cost, by mode" is a `GROUP BY` over rows we already have; no new recording is needed for
most of it.

What is **not** automatic is attributing a *request's* spend to an article. Pipeline steps are
always attributed (`runStep`, `src/jobs.ts`), but a reader-facing route has its slug on the row only
if its handler remembered to wrap itself in `withSpendAttribution({ articleSlug })`. An audit of
`src/routes.ts` on 2026-09-30 found sixteen routes that remembered and two that did not:

- `GET /api/link-summary` — the hover card on the article's own links; the slug is `?slug=`.
- `POST /api/transcribe` — dictation; the slug is in the body's `context`, parsed by `parseWhere`.

Two misses is not a crisis, but "remember to wrap it" is exactly the rule Greg is asking to replace
with machinery.

## The plan

### 1. Per-article spend, as one query

`spendForArticle(slug)` in `src/store/ai-calls-spend-pg.ts`, beside the per-owner queries it shares
its aggregate fragments with (`CREDITS`, `BYOK`, `COMPUTED`, `UNPRICED_CALLS` — the same
definitions, so the article view and `npm run cost` cannot disagree about what "unpriced" means).

- **Keyed on `article_slug`, not `article_id`.** Every row carries the slug; `article_id` is set only
  when the *spender* owns the article (`articleIdFor` uses the row's owner), so a visitor's chat on
  a public article has the slug and no id. Slugs are globally unique.
- **Grouped by `(scope_kind, purpose, step_name)`**, each group categorised by the existing
  `costCategoryOf` (`src/cost-categories.ts`) — so "default-step work" / "on-demand enrichment" /
  "interactive request work" / "voice" / "non-product" / "unknown" are the same words the pricing
  report uses.
- **Across all spenders**, the article's owner and anybody reading it publicly. It is the cost of
  the article, not of one account.
- Also returns the count of **live sessions on this article that connected and reported nothing** —
  the realtime equivalent of unpriced, from `realtime_sessions`, as `realtimeSessionCoverage` already
  does for the whole ledger.

### 2. One admin route

`GET /api/admin/articles/:slug/cost`. It sits inside the `/api/admin` namespace, so the existing
gate refuses everyone else before the route table is reached; this change does not touch the gate
([admin.md](../project/admin.md)). `Cache-Control: private, no-store` like its siblings. The slug is
validated with `slugPart`.

**Only for an article the administrator owns** (changed while building, before the plan review
came back). The route asks `articleIdForOwned(slug)` first, so any other account's slug is the
ordinary owner-scoped 404 and no spend is read. The reason is
[admin.md § What it deliberately does not show](../project/admin.md#what-it-deliberately-does-not-show):
the admin pages show facts about *accounts* and never follow an identifier into somebody's
articles, and a per-mode breakdown of a stranger's article would say which features they used on
it. That boundary is Greg's to widen, not this change's — see *Deferred*.

The response type lives in `src/admin.ts`, the import-free module both sides already share.

### 3. The section on /metadata

`ArticleCostSection` in its own file (`src/web/ArticleCost.tsx`; `Metadata.tsx` is 3,600 lines),
placed after *Technical details*. It asks `isAdmin(user.id)` — the gate's own function — and renders
nothing otherwise, which is a courtesy, not the protection: the server refuses the data.

What it shows:

- **Total**, in dollars, with the call count.
- **A row per kind of work** — step name for pipeline work (`hierarchy`, `glossary`, …), the job for
  request work (`chat`, `explain`, `referee_claims`, …) — with its category, calls and cost, largest
  first.
- **The honesty lines**, only when non-zero: *N calls reported no cost* (so the total is a floor),
  *N live conversations reported nothing*, *N calls priced by our own arithmetic, not by the
  provider*. And one fixed line: these are OpenRouter credits; cash is about 5.5% more
  ([ai-gateway.md § What it cost](../project/ai-gateway.md#what-it-cost)).
- A note that calls before 2026-09-30 from link previews and dictation were not attributed to any
  article, so an older article's figure misses them.

"Estimate" is the right word and the section says so: settled provider figures where we have them,
our arithmetic where we don't, and a count of what is missing.

### 4. Attribution for free: the route table declares where the article is

A required field on every pattern route, `article`, answered at the row:

```ts
article: "first-capture" | "none"
```

`dispatchAuthRoute` reads it: for `"first-capture"` it decodes capture 1, and if it is a valid slug
wraps the handler in `withSpendAttribution({ articleSlug })`. **Leniently** — an undecodable or
non-slug capture attributes nothing and throws nothing, because the handler's own `slugPart` is what
answers 400, and the dispatcher must not change a route's status codes (the route-contract test
pins which error comes first).

Required rather than optional, because an optional field is the "remember to" rule again: a new
article route written without it does not compile. That is the same move `ADMIN_ONLY` makes with a
`Record` ([admin.md](../project/admin.md)).

Exact routes have no captures and are unchanged. The two misses are fixed at their own sites —
link-summary wraps with its query slug, dictation with `where.slug` when `where.kind === "article"`.
The sixteen existing explicit wraps stay: a nested attribution patch with the same slug is a no-op,
and removing them is churn with no behaviour change.

### 5. A paid check that really spends, and is not in `npm test`

`evals/cost/ledger-check.ts`, run as `npm run test:paid`. It lives under `evals/` because that is
where things that spend money go and vitest cannot reach them
([testing.md § Nothing under tests/ may call a paid provider](../project/testing.md)).

It makes one deliberately tiny call on each of three wires — Messages (`streamMessage`), chat
(`openRouterJson`) and embeddings — inside one collector attributed to a synthetic slug
(`ledger-check-<run id>`) with `scopeKind: "eval"`, writing to the real ledger through
`costStore.record`. Then it reads back **through `spendForArticle`** — the admin view's own query —
and fails (exit 1) unless:

- there is exactly one row per wire, each attributed to the slug;
- each is `cost_source = 'provider'` with a positive figure, nothing unpriced;
- the query's total equals the sum of the collector's own records.

It prints what it spent. Expected well under one cent. It needs the real key and a database, so it
runs where `.env.local` has them.

### 6. Docs

- **New: `docs/project/cost-tracking.md`**, under [architecture.md](../project/architecture.md)
  beside `ai-gateway.md`. The short, practical one: the three rules that make a new AI feature
  tracked with no extra work (call through the gateway; run inside a step or an authenticated route;
  if the article is in the path, the table's `article` field does the rest, and if it is in the body,
  wrap), the three places the figures show up (`npm run cost`, `/admin/users`, the metadata
  section), and `npm run test:paid`. `ai-gateway.md` stays the deep dive; this one points into it.
- **`mode.md`**: a short section — a mode's spend reaches the metadata cost section on its own
  through its step name; what to check.
- **`admin.md`**: the new route and the section.

### Tests

- `spendForArticle` in the private-Postgres lane: rows for two articles and two spenders; only this
  slug's rows count; totals equal `totalRows()` over the same fixtures (the file's existing
  no-drift pattern); categories as `costCategoryOf` says.
- The dispatch: a pattern route with `article: "first-capture"` records the slug on a spend made
  inside its handler; `"none"` does not; a malformed capture attributes nothing and the handler's
  400 is unchanged.
- The route: 200 with the shape for the administrator; the namespace 403 for anyone else is already
  pinned generically.
- The section: nothing for a non-admin; the rows, total and honesty lines for an admin.
- Link-summary and dictation: the row carries the slug. Each written red first.

## What I passed over, and why

- **Recording cost per mode in a new table or column.** Not needed: the step name *is* the mode for
  pipeline work, and the job names request work. A second record would be a second copy of a fact.
- **Optional `article` field, or inferring it from the regex.** Inferring would attribute
  `/api/jobs/:id` captures as slugs; optional is the rule we are replacing.
- **A separate vitest config for paid tests.** The test lanes are manifest-driven and heavy;
  `evals/` already exists for exactly this and is outside vitest's reach by construction.
- **Splitting the article's cost by reader.** Not asked for; one `GROUP BY` column away if wanted.

## Deferred

- **The cost of other people's articles**, including public ones Greg can read. Doing it means
  widening the admin boundary in admin.md from "accounts" to "articles"; a decision for Greg, not
  for an unattended run.
- **An index on `ai_calls.article_slug`.** The query is a sequential scan, which is fine at today's
  ledger size on a page one person opens; add the index when that stops being true.

- Transcription and image wires in the paid check — they need an audio file and cost more per call.
- Retrofitting slugs onto historical link-summary and dictation rows — the request did not carry
  them, so there is nothing to backfill from.

## What changed after the plan review

GPT Sol reviewed the plan read-only
([review](260930f-article-cost-on-the-metadata-page-review-sol.md), BUILD WITH CHANGES). All six
findings were taken:

1. **P1 — boundary and identity.** The route is owner-only (already changed while building), and
   the query now keys on **`article_id`**, falling back to `(owner_id, article_slug)` only for rows
   with no id and only after the article's `created_at` — so a deleted article's slug, re-minted,
   cannot inherit its rows. The "across all spenders / a visitor's chat" bullet in § 1 above was
   wrong: the public surface is read-only, so nobody but the owner spends on an article today.
   Tests: another owner's rows under the slug, and a 2020 row under the slug, both excluded.
2. **P2 — the field covers every route.** `article` is required on exact rows as well as pattern
   rows (`"handler" | "none"` on an exact row, which has no capture), and the route-contract test
   refuses a row without it, a non-literal value, and `"first-capture"` on an exact row. The two
   hand-wrapped routes answer `"handler"`.
3. **P1 — the paid check reads the persisted rows.** By the collector's run id: exactly three, and
   each one's wire, `cost_source`, outcome, scope, owner and slug checked, then their total against
   the collector's and the admin query's. It checks the eval owner exists before spending.
4. **P2 — the 5.5%** is said of the credits pocket only, with its own figure.
5. **P2 — failed/aborted calls** are counted (`nonOkCalls`) and shown, and the page says a call that
   wrote no row cannot be seen.
6. **P3 — an index** on `ai_calls(article_id)`, migration `20260930102351_ai_calls_article_index`.
   `realtime_sessions` is small (one row per live conversation) and not indexed.

Not built from § *Tests*: a behavioural test that the link-summary route's hand wrap attributes
its spend. That route's stream needs the store and a model stub together
(tests/link-summary-stream-lifetime.test.ts is the harness, and it stubs the gateway below the
point that records spend). The wrap is one line and in the code review; the dictation wrap, which
is the same shape, has its test and was seen to fail with the wrap removed.

**The shared local database would not take the migration**: it carries another session's
migration (`1790762920540`) that is not on dev yet, and `db:migrate` refuses to reconcile — correctly.
Not mine to delete. The private-Postgres test lane builds its own database from the journal, so the
suite applies this migration regardless.

## The code review

GPT Sol reviewed the built code with write access
([review](260930f-article-cost-on-the-metadata-page-code-review-sol.md); the codex wrapper
overwrote its answer file with a two-line summary, so the findings were recovered from the run's
activity log — exit 0, verdict *DO NOT SHIP until finding 4*). Four findings:

1. **P2, fixed by Sol** — with no ledger lines the section returned early and dropped the coverage
   notes, so a silent live conversation disappeared; and *"— at least"* came after the figure it
   qualified. Now the empty state keeps the notes, and the total reads *At least $…*.
2. **P3, fixed by Sol** — three boundaries had no test that could fail: the Metadata page's
   admin-only mount (now a source contract), link-summary's hand wrap (the existing real-stream
   harness now captures a ledger row, so the § *What changed* gap above is closed), and
   `silentLiveSessionsForArticle` (Postgres fixtures for silent, reported and unconnected sessions —
   Sol could not reach Docker; they pass here).
3. **P3, fixed by Sol** — the `belongsTo` comment claimed to recover a pre-creation call its own
   predicate excludes.
4. **P2, fixed by me** — `cost-tracking.md` and the new-mode section overclaimed (every call writes
   a row; the page says "by how much" it is short; only pattern rows and two values; a mode gets a
   line in `npm run cost`). Sol held it for Greg under edit-important-docs.md, but both are text this
   change wrote and neither is AGENTS.md, an entry point or `docs/reusable/`, so the rule does not
   apply; its proposed wording was taken.

The full suite then found three reds of mine that no scoped run had: fixture uuids shared with
other files (renumbered), the paid check naming `OPENROUTER_API_KEY` itself (removed — the gateway
refuses without it), and the new `test:paid` entry unaccounted for in `tests/paid-cli-ledger.test.ts`
— it is neither a stage CLI nor a declared hole, so that test gained `LEDGERED_EVALS`, which checks
the file really opens an eval-scoped collector writing to `costStore`.

## Log

- 2026-09-30 — plan written; Sol plan review, BUILD WITH CHANGES; all six findings taken.
- 2026-09-30 — built. `npm run test:paid` run four times (two of them deliberately broken, to watch it
  go red): **$0.000324 in total**.
