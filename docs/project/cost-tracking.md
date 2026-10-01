# Cost tracking: what every AI call costs, and what you have to do about it

Up: [architecture.md](architecture.md). The deep dive on the gateway, the ledger's columns and the
four things that fail silently is [ai-gateway.md](ai-gateway.md); this page is the short, practical
one — **how a new piece of AI work gets its cost tracked, and where the figures show up.**

> Hopefully using kind of reusable machinery and updating our docs so that going forwards all new AI
> processing automatically has its costs tracked, just as hopefully all new modes automatically get,
> you know, tracked in the metadata and added to the commands.
>
> — Greg, 2026-09-30

## The short version: you should not have to do anything

Every gateway call made inside a collector writes one row to `spideryarn.ai_calls`, priced when the
provider said what it cost and counted as *unpriced* when it did not. (A call outside every
collector, or whose row fails to write, leaves only a process counter —
[below](#the-articles-figure-and-what-it-cant-see).) A new feature gets that for nothing **if it keeps to
three rules**, and each rule has something that enforces it:

1. **Call a model through the gateway**, never with your own client or `fetch`: `streamMessage`
   ([`src/messages-stream.ts`](../../src/messages-stream.ts)) for the pipeline stages,
   `openRouterStream` / `openRouterJson` / the embeddings, images and transcription seams in
   [`src/ai-call.ts`](../../src/ai-call.ts) for everything else. The gateway is what writes the row;
   `tests/no-undeclared-spend.test.ts` fails on any other way to reach a provider.
2. **Make the call inside a scope.** A pipeline step runs inside `runStep`
   ([`src/jobs.ts`](../../src/jobs.ts)) and an HTTP request inside `handleApi`
   ([`src/routes.ts`](../../src/routes.ts)); both open a collector. A call made outside one records
   nothing and is counted by `unscopedCalls()` — so a script or eval opens its own with
   `collectSpend` (see [`evals/cost/ledger-check.ts`](../../evals/cost/ledger-check.ts) for the
   shortest example).
3. **Say which article it was for.** This is the one that used to need remembering:
   - A **pipeline step** is attributed by `runStep` — job, step and article. Nothing to do.
   - A **route with the article's slug in its path** declares where the slug is, in the route
     table, and the dispatcher attributes the spend. The field is required, so a new route that does
     not answer does not compile — see [§ The route table](#the-route-table-says-where-the-article-is).
   - A **route whose slug arrives any other way** — a query parameter, the request body — wraps its
     call in `withSpendAttribution({ articleSlug }, …)` itself. There are two today: link previews
     (`?slug=`) and dictation (`context.slug`).

A **new mode** needs nothing beyond this: its step name *is* its line on the article's cost
breakdown. [new-mode.md § Its cost](new-mode.md#its-cost) says what to check.

## Where the figures show up

| Question | Where |
|---|---|
| What has this article cost, in total and by mode? | the **What it cost** section of the article's metadata page — the administrator, on their own articles |
| What has each account cost this month? | `/admin/users`, the spend column — [admin.md](admin.md#the-spend-column-and-the-two-things-that-keep-it-honest) |
| Where did the money go, and how much of it can we see? | `npm run cost`, `npm run cost -- --owners` — [ai-gateway.md](ai-gateway.md), § *The pricing report* |
| What does a fresh ingest or a mode cost, cold? | `npm run eval:cost` — [evals/cost/run.ts](../../evals/cost/run.ts) |
| Does the recording itself still work, end to end? | `npm run test:paid` — [below](#the-paid-check-npm-run-testpaid) |

### Only the administrator ever sees a figure

> the most important thing is that that cost information should only be available to me (i.e. admin
> users). i don't want any regular users to know how much AI processing of their articles costs
>
> — Greg, 2026-09-30

A reader may be told what something costs **them**: in articles against their allowance, or in their
subscription's price. They are never told what an AI call costs **us**. That covers the ledger, and
it covers hand-written estimates too. Five of those were in reader copy until 2026-09-30:
"about $0.20" beside the Sketch, "$0.40–$0.65" beside Illustrated, a debate re-run note, the reset
dialog, and a `/changelog` entry.

Every surface in the table above is behind the `/api/admin` namespace gate, a CLI, or an eval. So
the rule is easy to keep, as long as a new feature does not add a figure somewhere else.
**`tests/no-ai-cost-for-readers.test.ts` is the guard**, in two halves:

- **A scan of reader copy.** It reads the string and JSX text of `src/web/**` and `src/messages.ts`,
  plus the raw text assets the client imports (the changelog's `.ndjson`). It flags any sum of money:
  - a currency symbol;
  - a currency code;
  - cents or pence;
  - a currency word next to a number.

  The only allowed file is `PlanCards.tsx`, which shows subscription prices.
- **A targeted payload audit.** Non-admin payload shapes are checked for a cost-like key or a
  money-bearing value: metadata, the article DTO, the public DTO, jobs, and the billing summary. Each
  half has its own positive control. The admin cost route is the control that must be flagged.

The audit behind it is in
[260930k § 3](../plans/260930k-high-power-for-readers-and-cost-only-for-admins.md#3-ai-cost-reaches-the-admin-only).

### The article's figure, and what it can't see

`GET /api/admin/articles/:slug/cost` (behind the `/api/admin` gate like every admin route, and
answering only for an article the administrator owns — [admin.md](admin.md#one-articles-cost-and-only-your-own)
says why) returns the article's rows grouped by scope, job and step, each with the category
[`src/cost-categories.ts`](../../src/cost-categories.ts) gives it — the same words `npm run cost`
uses. [`src/web/ArticleCost.tsx`](../../src/web/ArticleCost.tsx) draws it.

- **It is keyed on the article's id**, with one fallback: a row written without an id because the
  lookup failed while this article existed is matched on the owner's slug, but only if it happened
  after this article was created. A call made *before* the article row existed is deliberately left
  out: it cannot be told apart from a deleted predecessor that had the same slug, and a slug is
  unique only among *current* articles.
  `belongsTo` in [`src/store/ai-calls-spend-pg.ts`](../../src/store/ai-calls-spend-pg.ts).
- **It is a floor, and the page names the gaps it can observe** — not their size, which is unknown.
  Calls that reported no cost are counted and not priced, and live conversations that connected and never posted usage are counted separately.
  Calls that failed or were stopped are included — they usually still cost — and counted too.
- **A call that wrote no row is invisible to it**: a failed ledger write, or a call made outside
  every collector. Those exist only as process counters (`unscopedCalls()`, the collector's
  `writeFailures`), and no per-article query can count them.
- **Calls nobody attributed are invisible to it.** Before 2026-09-30 that was link previews and
  dictation, so an older article's figure is short by those.
- **The OpenRouter-credits part of it is not cash** — about 5.5% more leaves the bank for that part
  only, since the fee is on buying credits; BYOK and our own arithmetic are not uplifted. The page
  shows the credits figure separately for that reason
  ([ai-gateway.md § What it cost](ai-gateway.md#what-it-cost)).

## Spend that keeps going

The ledger tells you what was spent; it does not stop a call that should never have been made. Three
times, money (or its serverless cousin, invocations) kept leaving after the reason for it had gone,
and each looked healthy row by row:

- **One step bought eleven times, every row `ok`.** Saving a server file restarted the dev server
  mid-step, the fresh module copy had forgotten the job was claimed, and the same eight-minute call
  started again: $5.43 on one step. It looked like a truncation retry loop and was neither.
  [260902c](../postmortems/260902c-the-truncation-retry-cost-storm.md).
- **An eval that noticed its evidence was lost, and kept buying.** A $40.90 harness recorded each
  failure and printed it, but the noticing and the stopping were at different levels of the
  machine, so six fixes each left the level below open. What would have caught all six at once was
  a one-table inventory of where money leaves the run and what can stop it there.
  [260905d](../postmortems/260905d-the-run-kept-buying-after-it-knew-the-answer-was-incomplete.md).
- **A poll that every reader paid for at rest.** Reading job state meant subscribing to the job
  engine, and subscribing meant polling every eight seconds, so an owner's reading view made about
  450 requests an hour with nothing running. The "costs nothing at rest" budget had been kept by
  comments at the call sites that remembered it.
  [260912a](../postmortems/260912a-a-budget-a-comment-keeps-is-spent-by-the-next-call-site.md).

The first and third were invisible in the per-call figures, because every call in them was
individually correct.

## The route table says where the article is

Every row of `AUTH_ROUTES` ([`src/routes.ts`](../../src/routes.ts)), exact and pattern alike,
carries an `article` field:

- `"first-capture"` (pattern rows only) — capture 1 is the article's slug. `dispatchAuthRoute`
  wraps the handler in `withSpendAttribution`, so any model call the route makes — now, or after
  somebody adds one next month — lands on the article's figure. This is the only value the
  dispatcher acts on.
- `"handler"` — the slug arrives some other way (a query parameter, the body) and the handler wraps
  its own call. Link summaries and dictation.
- `"none"` — no article in the path, or the route never calls a model.

`tests/authenticated-api-route-contract.test.ts` refuses a row with no `article`, a value that is
not a literal, and `"first-capture"` on an exact row, which has no capture.

It is required rather than optional on purpose. An optional field is the "remember to" rule again,
which is what missed link previews and dictation. It is lenient at run time: a capture that is not a
valid slug attributes nothing and throws nothing, because the handler's own `slugPart` is what
answers 400, and the dispatcher must not change a route's status codes.

## The paid check: `npm run test:paid`

Greg, 2026-09-30: *"I'd be fine to have a bunch of tests that don't usually run because they
actually do incur costs (using our API keys somehow) that then get tracked & checked."*

[`evals/cost/ledger-check.ts`](../../evals/cost/ledger-check.ts) makes one tiny real call on each
of the Messages, chat and embeddings wires, attributed to a fresh synthetic slug, then takes three
readings of the one spend: what the collector recorded, **the rows it persisted** (read back by run
id, each one's wire, price source, outcome, scope, owner and slug checked), and the article query
the metadata page uses. It fails unless all three agree to the nano-dollar and every row was
settled by the provider. It is not in `npm test`: it lives under `evals/`, where spending is allowed and vitest
cannot reach ([testing.md § Nothing under tests/ may call a paid provider](testing.md#nothing-under-tests-may-call-a-paid-provider)).

**What it costs**: $0.000081 on 2026-09-30. It needs `OPENROUTER_API_KEY` and a database with the
eval owner seeded, and its rows are `scope_kind = 'eval'`, so they are non-product spend everywhere
they appear. Run it after a change to the gateway, the ledger or the attribution. Seen to fail with
the article attribution removed (exit 1).

Not covered yet: the transcription and images wires, which need an audio file and cost more per
call.
