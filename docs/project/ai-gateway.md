# The AI gateway: one vendor, two wires

Every paid model call this app makes goes through **OpenRouter**, and every one of them is
*recorded*. Since 2026-08-27 that holds for the pipeline, chat, embeddings, dictation and the PDF
reader alike.

**There is one exception, and it arrived on 2026-08-31.** Live conversation mode talks to OpenAI
directly, because OpenRouter has no realtime API to route to — its audio endpoints are batch speech
and batch transcription, and there is no duplex speech-to-speech. It is not a routing preference; it
was OpenAI or no live mode, and Greg's own question ("*I'd love to just have a single
`OPENROUTER_API_KEY`*") is answered at length in
[live-conversation.md](live-conversation.md).

Two things about it belong here rather than there, because they are properties of *this* claim.
**The audio never touches our server** — [`src/live.ts`](../../src/live.ts) mints a short-lived token
and the browser opens the WebRTC connection itself, so there is no seam the spend passes through.
And therefore the usage exists only in the reader's tab: **`npm run cost` sees a live session
because the browser tells it**, posting what each turn cost to `/api/live/:sessionId/usage`, where
the server prices it and writes an ordinary `ai_calls` row. That landed on 2026-09-02 (Stage 2B) and
`src/live.ts` came out of `UNMETERED_SPEND` the same day — the register's second table means *money
leaves and no row appears*, so leaving it there would have made the report overclaim in the one
direction it exists to prevent. The two live-mode evals under `evals/live/` are still in it.

**It is still not a declared bypass, and the reason changed on 2026-09-02.** It used to be that a
`Declaration` for it could not be *typed*: `ProviderAccount` had no `"openai"` and `Wire` had no
`"realtime"`. Both unions are wider now and the ledger holds realtime rows — and this is still not a
`Declaration`, because the shape of the call is wrong for one rather than the shape of the types.
Every method on the declared-bypass `Observer` takes a response body *this process received*, and
nobody here receives one: the usage exists only in the reader's browser tab.

So the rule is restated rather than broken. **Live conversation is a sanctioned provider bypass
whose accounting arrives through a different seam** — an authenticated acceptance endpoint the
browser posts to, instead of a gateway that reads a response. GPT Sol was explicit that the
allowlist entry must be *reclassified* and not retired, and
[`tests/no-undeclared-spend.test.ts`](../../tests/no-undeclared-spend.test.ts) carries that wording.
Both halves are built now:
[live-conversation.md § The meter](live-conversation.md#the-meter).

**Greg decided to ship with the meter open**, 2026-08-31: *"make a comment in `npm run cost` and
cost-tracking docs re this gap, and let's accept it for now."* It was open for two days and is
closed; the decision is kept here because the next reader should be able to see that a shipped
feature with a known hole in its accounting was a choice rather than an oversight.

The part that costs money rather than visibility was closed first: a live session ends itself after
five minutes of quiet or twenty minutes in total
([`useLiveConversation.ts`](../../src/web/live/useLiveConversation.ts) § the caps), so a forgotten
tab bills minutes rather than the hour OpenAI would allow. **Measuring is still not limiting** —
nothing on our server can end somebody's session, and a browser clock is a clock a tab can be wrong
about.

**What the live figure is worth**, said once: it is our arithmetic over counts a browser reported,
priced from `REALTIME_PRICES`, and nothing reconciles it. That is `cost_source: "computed"`, which is
what that value has always meant here. A turn that was never posted because the tab died first is
simply missing, so the figure is biased low by a probably-small unknown.

Recorded, not necessarily *priced*: a call that dies before its usage arrives is written down as
having happened with a cost of `null`, and counted as unpriced rather than as free. That distinction
is the whole point and an earlier version of this sentence lost it by saying "every one of them
records what it cost" — which is the claim a spend report would then be built on.

Since 2026-08-28 "recorded" also means **kept** — a row per call, in Postgres or in a JSONL file, and
`npm run cost` reads them back. See [what every call is written down as](#what-every-call-is-written-down-as).

> Presumably we want to do this in a way that's reusable (i.e. whenever we make an AI call, we do it
> in the same way, which takes care of cost-tracking etc)?
>
> — Greg, 2026-08-27

> I'm fine with gating everything through OpenRouter. Their reliability is good, and this gives us
> simplicity/consistency/flexibility.
>
> — Greg, 2026-08-27

That is the decision. This doc is why it was made, what it cost, and the four things about it that
fail without saying so.

## What it replaced

Until that day there were two vendors. The seven pipeline stages — [`hierarchy`](../../src/hierarchy.ts),
[`labels`](../../src/labels.ts), [`arc`](../../src/arc.ts), [`tweets`](../../src/tweets.ts),
[`glossary`](../../src/glossary.ts), `summarise`,
[`ideas`](../../src/ideas.ts) — each built their own `new Anthropic({ logLevel: "off" })` and talked
to `api.anthropic.com`. Everything a reader waits on went to OpenRouter.

The question that ended it was Greg's, about cost tracking:

> This billing stuff is tricky to get right. Can we rely on the responses from the API, and/or a
> really reputable library?
>
> — Greg, 2026-08-27

The answer for OpenRouter was *yes* — it returns `usage.cost`, a real invoice line. The answer for
Anthropic was *no*: a live response's body and every one of its headers were dumped, and nothing
mentioned cost, price or billing. There is no figure to rely on, so the Anthropic half needed a
hand-maintained price table and cache arithmetic that the OpenRouter half did not.

Which raised the obvious question — *why are there two halves?*

## One gateway, two wires

The word "provider" used to mean two things at once: **who bills us**, and **what the request looks
like**. Only the first collapsed.

| | speaks | used by | code |
|---|---|---|---|
| **Messages** | Anthropic's Messages protocol, via OpenRouter's Anthropic-compatible endpoint (`/api/v1/messages`, which OpenRouter calls the "Anthropic Skin") | the pipeline stages — hierarchy, labels, arc, tweets, glossary, ideas, quotes, timeline, quiz, sketch | [`src/messages-stream.ts`](../../src/messages-stream.ts) |
| **chat** | OpenAI's chat/completions shape | explain, chat, search, quiz marking, the three referee runs, dictation, PDF reading, and `env-proposal` — the one job with no reader at all, `gjd-remote push-env` asking a cheap model to sort a repo's env key *names* ([hetzner-remote-server-box.md](hetzner-remote-server-box.md)) | [`src/ai-call.ts`](../../src/ai-call.ts) |
| **embeddings** | `/api/v1/embeddings` — OpenAI-shaped, different endpoint | turning a paragraph into a vector | [`src/ai-call.ts`](../../src/ai-call.ts) |

Two files, and **no third way to spend money**. Each gateway's tests scan `src/` and fail if any
other file constructs an Anthropic client, opens a message stream, or names an OpenRouter endpoint.

**There is deliberately no count of the call sites here.** This sentence said "thirteen" from
2026-08-27 until 2026-09-02, by which point it was twenty — referee mode, quiz marking and the tool
loop had arrived, and nothing goes red when a number in prose stops being true. Replacing it with
"twenty" was the first fix attempted and is the same bug with a fresher number, which GPT Sol
pointed out on the day. The count that cannot drift is the one you take yourself: grep for
`streamMessage(`, `openRouterStream(` and `openRouterJson(`. What is *enforced* is the boundary, not
the tally, and the tests above are where it lives.

[`src/models.ts`](../../src/models.ts) holds the wire assignment as `AI_JOB_WIRE: Record<AiJob,
Wire>` — a record rather than lists, so a job nobody assigned fails to compile rather than quietly
getting a default. `Provider` is still a type there, now with exactly one member. One member is not
an oversight; it is the decision, written where somebody will trip over it.

`AiJob` rather than `Task`, and rather than `Job`. A `Task` is a judgment about how much *reasoning*
a job needs, which is why transcribing a PDF, embedding a paragraph and transcribing a voice are
deliberately excluded from it — but **the bill does not care about tiers**, and a spend record keyed
on `Task` would have had nowhere to put those three. `Job` was already taken, by the ingest queue's
row in [`src/types.ts`](../../src/types.ts); two types with one name in one codebase is a bug
waiting for whoever imports the wrong one.

### One call, one frame — the shape a review changed

The chat gateway makes **the request and its accounting a single indivisible operation**:
`openRouterStream` is a *lazy async generator*, so nothing is sent until the first `next()`, and from
then the same `finally` owns the call.

Early `break`, a throw, an abort, a missing `[DONE]`, a 429, a body that will not read — all of them
cross it.

**The Messages gateway was not that until 2026-08-28.** It wraps the Anthropic SDK, so the call
belongs to the SDK's stream object — and `streamMessage` used to hand that object back, so a stage
that awaited `call.stream.finalMessage()` instead of `call.finalMessage()` worked and recorded
nothing. What guarded it was a test that scans `src/`, not the shape of the API. That was written
down here as "a weaker guarantee, honestly stated", and it stopped being good enough the day the
numbers became database rows: a documented bypass under a ledger is a ledger that looks complete.

So the seam is closed. `MeteredCall` is three things — `onText`, `finalMessage`, `aborted` — and the
stream, the meter and `meterStream` are all private now. `model` and `provider` are typed `never`, so
a stage cannot pass either; both are injected **after** the body spread, and the test that proved the
spread order was wrong went red on the old code. GPT Sol asked for all of this before the schema
hardened.

The first draft handed the caller three things instead: open the call, parse the chunks, finish the
meter. A GPT Sol review found the hole in about a page, and it is the hole every such design has:
*the call returns a non-200, the caller throws its own error before reaching the metering step, and
the request sits open having cost money nobody recorded.* Only one frame owning the whole lifecycle
closes that.

### `provider` is a table, not a default

The obvious next step after pinning Anthropic on the Messages wire is to do the same on this one. It
is **wrong, and wrong silently**: dictation talks to Gemini and needs `zdr`, the PDF reader talks to
OpenAI and must forbid fallback, embeddings talks to Voyage. On any of those three
`order: ["anthropic"]` finds no Anthropic upstream, falls through to the real one, and answers — the
pin does nothing at all while looking like it did something.

Leaving each of the six callers to pass its own was the second draft, and Sol rejected that too: a
field six callers set independently is a field that drifts. So it is `AI_JOB_ROUTE` in
[`src/ai-call.ts`](../../src/ai-call.ts) — one exhaustive row per job giving its endpoint *and* its
routing policy, injected **after** the caller's body so it cannot be overridden by accident, and
asserted on the outgoing request rather than trusted.

### A key is not access, and the difference is invisible until a reader finds it

**An OpenRouter key opens the door; the *account behind it* decides which models are on the other
side.** Its privacy and data-policy guardrails remove every upstream whose stated practices they do
not permit — and when that leaves none, the answer is

> `404 No endpoints available matching your guardrail restrictions and data policy`

which reads exactly like a mistyped model id and is neither. It is per account, and OpenRouter lets
the same policy be set on an organisation and on an individual key too, so two keys that both work
can still disagree about one model.

**The specific fact worth carrying, because it will bite again the day somebody enables ZDR:**
`voyageai/voyage-4` is **not** a Zero Data Retention endpoint. OpenRouter's own list
(`GET /api/v1/endpoints/zdr`) has 806 entries and no Voyage among them, and the model page says why
— *"Logs: this provider may retain prompts, but does not use them for training."* Retention without
training means it fails `zdr: true` and passes `data_collection: "deny"`. The model has exactly one
provider, so there is no fallback: **ZDR's "Non-frontier" scope switches embeddings off entirely,
and nothing else.** Chat, the pipeline and the PDF reader are unaffected, because Anthropic's and
OpenAI's endpoints *are* on that list — which is what makes the failure look like a bug in one
feature rather than a policy applying to everything.

Both OpenAI embedding models pass ZDR, so a project that must have ZDR everywhere has a way out
that costs nothing measurable — see
[260828z-embedding-endpoints-refused.md](../plans/260828z-embedding-endpoints-refused.md) for the eval's numbers and
the billing catch.

This is not hypothetical. **Drift, Trail and Force were dead in production from the day they shipped
until 2026-08-28**, because `OPENROUTER_API_KEY` on Vercel is a different account from the one in
`.env.local`, and that account may not use `voyageai/voyage-4`. Every check passed throughout:
the variable was set, spelt right, and `GET /api/health` said so. Nothing in the deploy pipeline
ever asks the deployed key to *make a call*, which is the only question that would have caught it —
and it has to be asked from inside the deployment, because a probe run on a laptop reads
`.env.local` and tests the key that works.

The full account, the fix, and the probe that would have caught it:
[260828z-embedding-endpoints-refused.md](../plans/260828z-embedding-endpoints-refused.md) and
[260828d-the-deployed-key-was-never-asked-to-do-anything.md](../postmortems/260828d-the-deployed-key-was-never-asked-to-do-anything.md).

`ProviderRefused.kind === "no-endpoints"` in [`src/ai-call.ts`](../../src/ai-call.ts) classifies it
at the boundary by matching that fixed string, so the classification survives without the provider's
body being carried anywhere. `EmbeddingFailure` in [`src/embeddings.ts`](../../src/embeddings.ts)
turns it into a `config` reason, which is how the reader ends up being told somebody has to fix
something rather than to try again.

### Why the stages were not translated

The obvious move — rewrite all seven into the chat/completions shape everything else already uses —
would have been wrong, and the reason is one parameter.

Every one of those stages sends `thinking: { type: "adaptive" }`, which lets the model decide how
much to think per request. **On OpenRouter's chat/completions path there is no adaptive.**
`reasoning.effort` takes `max｜xhigh｜high｜medium｜low｜minimal｜none` and answers `adaptive` with a
400. Translating would have meant picking one fixed effort for every article the app will ever read —
paying to over-think the easy ones and under-thinking the hard ones, permanently, with no way to
tell which was happening.

On the Messages wire it is a first-class option. That is checkable rather than assumed: an invalid
value is refused, and the refusal enumerates the permitted ones — `"enabled"`, `"disabled"`,
`"adaptive"`. And the control that makes it mean something: the *same prompt* sent to Anthropic
directly and to the Skin returned `thinking_tokens: 0` from both, so the zero is the model declining
to think rather than the Skin dropping the field.

So the migration is a `baseURL` and a model spelling. The stages kept `client.messages.stream(…)`,
`cache_control` breakpoints, `output_config.effort`, and native `stop_reason` values.

## What the Skin gives us that neither half had alone

Its `usage` object carries Anthropic's own counters **and** OpenRouter's cost, together:

```json
{"input_tokens":40, "output_tokens":600,
 "output_tokens_details":{"thinking_tokens":0},
 "cache_creation_input_tokens":0, "cache_read_input_tokens":0,
 "cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0},
 "service_tier":"standard", "inference_geo":null,
 "cost":0.00608, "is_byok":false, "cost_details":{…}}
```

[The cost-tracking plan](../plans/260827q-ai-cost-tracking.md) opens by arguing that the two transports
disagree about what an input token *is* — Anthropic's `input_tokens` **excludes** the cache fields,
OpenRouter's `prompt_tokens` **includes** them — and that we must therefore choose between a
provider-reported cost and a token breakdown. On this endpoint that choice does not arise. Both
arrive, in one shape, and the additive-versus-subtractive split becomes a difference between *wires*
rather than between *vendors*.

Caching works and the cost reflects it. A cold call wrote 13,863 tokens for `cost` 0.0347235; the
warm repeat read the same 13,863 for `cost` 0.0028386. Both match list price to seven decimal
places — the 1.25× write and 0.1× read multipliers, applied.

## The four things that fail silently

Every one of these looks exactly like working code. They are why there is a shared gateway module at
all, rather than seven stages each constructing a client.

**1. `finalMessage()` drops `cost`.** It is on the wire, in the `message_delta` event, beside the
full native usage — and the SDK's merge keeps only the fields its own types know about. A stage
reading `message.usage.cost` gets `undefined` for ever, produces a perfectly good article, and logs
a cost of nothing. `meterStream` subscribes to the raw `"streamEvent"`s instead, and
[`tests/messages-stream.test.ts`](../../tests/messages-stream.test.ts) goes red if that stops
arriving — verified by breaking it on purpose, because a test nobody has watched fail is not
evidence.

**2. The default upstream is not Anthropic.** Unpinned, live probes landed on "Claude Platform on
AWS" every time. A prompt cache lives on the upstream that wrote it, so an unpinned stage would work
perfectly and never read a cache again — the bill roughly triples and nothing complains. Hence
`MESSAGES_PROVIDER`, injected on every call rather than left to seven stages to remember.

**A caller cannot pass its own, since 2026-08-28.** It could until then — "that is what makes the
injection testable", said the paragraph that used to be here — and the test that proved it possible
was the argument for closing it. `provider` and `model` are typed `never` on `MessagesBody`, and both
are injected **after** the caller's body spread, so a body assembled at run time out of something the
type system never saw is overwritten rather than honoured. That ordering was wrong here until a test
went looking: `provider` was injected *before* the spread and a run-time body did win.

`AI_JOB_ROUTE` on the chat wire has always worked that way, and now both do.

**3. `require_parameters` defaults to `false`, while `allow_fallbacks` defaults to `true`.** So a
fallback upstream that cannot honour `cache_control` or `thinking` may still be handed the request
and answer it *without them*. That is not a degraded answer — it is a full-price answer that looks
identical to a cheap one. Availability quietly beating correctness.

**4. A call recorded with no collector open vanishes.** [`src/ai-spend.ts`](../../src/ai-spend.ts) is
an `AsyncLocalStorage`, on the same reasoning as [`src/owner.ts`](../../src/owner.ts): a step is not
a model call — `summarise` batches per parent, `labels` fans out — so no stage can report its own
total. Outside a collector `recordSpend` is deliberately a no-op, because a CLI run must not fail for
want of bookkeeping. But "silently does nothing" is how a cost table ends up plausible and short, so
`unscopedCalls()` counts what fell on the floor and anything reporting a total is expected to admit
it. Its sibling `lateCalls()` counts a call that finished *after* its collector had already
reported — which cannot be a field on the report, by definition, and a first draft that made it one
produced a counter nobody could ever read.

There are two scopes: a pipeline **step**, opened by `runStep` in [`src/jobs.ts`](../../src/jobs.ts),
and an HTTP **request**, opened by `handleApi` in [`src/routes.ts`](../../src/routes.ts). Until
2026-08-27 there was only the first, so every reader-facing call — chat, explain, search, dictation,
the embeddings a search runs — recorded into no collector at all. Those are the wrong ones to be
missing: a pipeline stage spends Greg's money on Greg's article, and a chat turn spends it on
somebody else's question, which is what a per-user spend limit is about.

**And the collector is not a spend limit.** It is accounting — it says what a request spent *after*
the request. A cap needs a reservation taken before each call and reconciled after, because final
usage arrives when the money has already gone and two simultaneous requests both pass a `SUM(cost)`
check. [The plan](../plans/260827q-ai-cost-tracking.md) says so at length; it is repeated here because the
per-request total looks like the harder half and is not.

And the rule that found the first three, worth holding before adding a fourth field to a request:
**OpenRouter accepting a request is never evidence that OpenRouter honoured a field.** A made-up
top-level key comes back `200` with no complaint. Only an observable difference in the response
proves anything — the provider pin is believed here because the *named upstream changed*, not
because the call succeeded.

## What it cost

**One vendor now sits in front of the whole app.** Before this, an OpenRouter outage cost the reader
chat, explain and search while the pipeline kept ingesting; an Anthropic outage cost the pipeline
while the reader's calls failed over. Now every outage is total. That was the last argument standing
against the change and it is a real one — it was put to Greg as the whole of what remained, and the
answer above is his.

Two smaller costs, both live:

- **`usage.cost` is credits, not cash.** OpenRouter takes no per-token markup — which is why probes
  found `cost` equal to Anthropic's list price to the digit — and earns instead on a ~5.5% fee when
  credits are bought. The money that left the bank is about 5.5% higher than any total this app
  reports.
- **One account is one rate-limit budget.** A `labels` fan-out and a reader's chat turn now compete.
  Two keys under one account would separate them, and would give two spend limits; not done yet.

## Two spellings of one model, and why both survive

[`src/models.ts`](../../src/models.ts) exports `CAPABLE_MODEL` (`claude-sonnet-5`) and
`CAPABLE_MODEL_OPENROUTER` (`anthropic/claude-sonnet-5`). Nothing sends the first any more, and it is
still load-bearing.

On the wire a model id is an **address**: it has to say which gateway, so it carries the prefix. In a
stored artefact's `generator` field it is a **name**: it says which model wrote this, and that is
what every staleness check compares against. Changing the address did not change the model — so had
the stamps been moved to the prefixed spelling in the same change, every article in the corpus would
have gone stale at once and regenerated at full price. A large bill, for a migration whose entire
purpose was to be able to see the bill.

Same rule as [setup-dev.md § the third spelling](setup-dev.md): a provider prefix is an address, not
a name.

## What every call is written down as

Since 2026-08-28 a finished call is not only reported, it is **kept**: one row in `ai_calls`
(Postgres) or one line of `data/_ai-calls.jsonl` (`files` mode), written by an injected sink and
awaited before the collector closes. [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts) picks the
adapter; `npm run cost` reads it back. The reasoning, the column list, and the four decisions taken
in Greg's absence are in [260827q-ai-cost-tracking.md](../plans/260827q-ai-cost-tracking.md).

### `byok_upstream_nanos` — the column whose name is a condition

**A row's money is now `credits + byok_upstream + computed`, with nothing conditional about it**, and
that is a change made on 2026-09-02 rather than how it always was.

OpenRouter reports `cost_details.upstream_inference_cost` on *every* chat-wire call, and on an
ordinary one it is the same money as `cost` — equal to seven decimal places on a live probe. The
column then called `upstream_inference_nanos` stored it on every row, so
`SUM(credits_used_nanos) + SUM(upstream_inference_nanos)` was **twice the truth**, and the rule that
made a total correct — add the upstream figure only when `is_byok` — lived nowhere but in
`totalRows()` in [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts). Migration 0023 had
anticipated exactly this class for the other pair of money columns and said so; this column sat
outside its CHECK.

So the column is renamed to carry its own condition, is written only on BYOK rows, and
[the migration](../../drizzle/20260902141103_byok_upstream_nanos.sql) nulls the historical duplicates
and adds `ai_calls_byok_upstream_only`:

```sql
CHECK (byok_upstream_nanos IS NULL
       OR (cost_source = 'provider' AND is_byok IS TRUE AND provider_account = 'openrouter'))
```

`is_byok IS TRUE` and not a bare `is_byok`: the column is nullable, a Postgres CHECK passes on
`UNKNOWN`, and "the provider did not say" is not "no". The same three conditions appear twice more —
`normaliseByokUpstream` in [`src/ai-spend.ts`](../../src/ai-spend.ts), which is the only place a
`SpendRecord`'s figure becomes this column, and the filesystem reader's validation. **They must not
drift apart**: a row the database refuses is a call that lands in no ledger at all, because the sink
warns rather than throws.

**The JSONL ledger cannot be migrated**, being append-only, so every line ever written still says
`upstreamInferenceNanos`. `translateByokUpstream` in
[`src/store/ai-calls-fs.ts`](../../src/store/ai-calls-fs.ts) converts it on read under the same
condition — carried over on a BYOK line, nulled on any other, because there it *was* the duplicate.
Without that the whole historical file would read as damage. **All three conditions, not just
`isByok`**: it tested one of them until 2026-09-03, and a BYOK line for which no `cost` figure ever
arrived backfills to `cost_source: 'none'`, kept its upstream value, failed the reader's own
validation and was counted *unreadable* — where the migration would have nulled the value and kept
the row. A two-thirds copy of a predicate loses data quietly, which is the whole reason the three
copies are named together above.

**And the file store now collapses duplicate ids on read.** It is append-only with no unique index,
so a lost-acknowledgement retry — the ordinary case for a browser posting a live turn — appends the
line twice, and `totalRows()` counted the money twice. Postgres absorbs the same retry on
`on conflict do nothing` against an id derived from the event. Collapsed on the way *out*, so both
writes stay on disk as evidence while what the ledger says matches what Postgres would say.

**Postgres is authoritative for pricing from this change's deploy, and the filesystem history is not
imported.** GPT Sol's call, taken rather than left to the implementer: that history is development
evidence and contains no complete ingest.

### A test may not write to the real ledger, in either store

`data/_ai-calls.test.jsonl` has always kept fixture calls out of the filesystem ledger, keyed on
`NODE_ENV`. The Postgres adapter never had the other half of that contract, and the bill for it was
**4,714 of 4,750 rows** in the dev ledger being `test-chat-route-fixture`,
`test-remember-route-fixture` and `test-candidates-route-fixture` — every `By owner` and `By article`
line meaningless, and a permanent "thousands of calls reported no cost" warning burying the one
signal that would show a real unpriced problem.

Since 2026-09-02 [`costStore`](../../src/store/ai-calls.ts) hands out the **filesystem** adapter to
anything running under the test harness, whatever `SPIDERYARN_STORE` says. Redirecting rather than
refusing, because a store that threw under test would stop the route suites exercising the metering
lifecycle at all — which is the half of the ledger those tests are the only cover for. The focused
`pgCostStore` tests still go to Postgres, by importing the adapter directly and cleaning up after
themselves. `tests/cost-store-under-test.test.ts` is what says the redirect is still there.

**And the report names its database**, not just its table: `npm run cost` prints
`postgres: spideryarn.ai_calls at <host>/<db>`, password stripped. Local and remote Postgres are
different ledgers with different money in them, and this repo has a whole section on a command
reaching a database other than the one on its command line —
[database.md](database.md#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like).

### The pricing report — per owner, by category, with the spread

`npm run cost` answers *"where did the money go"*. `npm run cost -- --owners` answers the different
question a subscription price is set from: **what did each account cost over this period, split by
what kind of work it bought, and how wide is the spread.** Add `--price 20` for the model-cost
contribution margin at a candidate price.

**`--price` is a MONTH's price, and it is only a monthly margin over a month that has finished.**
The default range is the current calendar month, so on the 3rd it holds two days of spend — and
until 2026-09-03 the report subtracted those two days from a month's price and headed the result
*contribution margin*. It now names the period in the heading and says *NOT a monthly margin* in
those words over anything that is not a whole finished month. Nothing is prorated, deliberately:
scaling a part-month up would invent a number nobody measured. For a real monthly figure ask for a
month that has ended — `--month 2026-08`.

Four things about it are decisions rather than details, and each has a reason that would be
re-litigated without one:

- **Postgres only, and it never reads whole rows.** The aggregate is a `GROUP BY` in
  [`src/store/ai-calls-spend-pg.ts`](../../src/store/ai-calls-spend-pg.ts) — `CostStore` was
  deliberately *not* widened, on GPT Sol's call: *"Do not widen `CostStore` merely to preserve
  filesystem parity for a pricing query whose source of truth is Postgres."* On the filesystem store
  the report refuses and says so.
- **The categories are named for the mechanism, not for a provenance the schema cannot prove.**
  `scope_kind` does **not** separate ingest from reading: a reader asking for Glossary posts to
  `POST /api/jobs` and is recorded `job_step`, exactly like base ingest. So the category is
  *default-step work*, never *base upload*. There is an exhaustive `unknown` bucket, the report names
  the scope/job/step triples inside it, and `assertCategoriesCoverRows` throws if the per-category
  counts stop adding up to the ledger's own — see
  [`src/cost-categories.ts`](../../src/cost-categories.ts).
- **Zero-spend accounts are in the denominator.** A `GROUP BY ai_calls.owner_id` cannot see somebody
  who made no calls, so a spread over its result is a spread over *spending* accounts and biases
  every figure upward. Until Stripe's subscriber set exists, the population is every account the Auth
  service knows about, and the report labels it as that rather than as "subscribers".
- **Cash is allocated in the report and never written to a row.** OpenRouter's ~5.5% is a fee on
  *buying credits*, not a per-token markup, so it applies to the credits pocket and to neither BYOK
  nor `computed`. The result is a **model-cost contribution margin** — Stripe's fees, hosting and
  every unmetered spend in [`src/spend-declarations.ts`](../../src/spend-declarations.ts) are still to
  come out of it.

The coverage header is printed first and is not a preamble: without it a total of $2.54 looks
identical whether it is the whole truth or the 8% of calls that happened to report a cost, and this
ledger has already spent a fortnight in the second state. It names the database, the credential, the
settled/computed/unpriced counts, the live sessions that reported nothing, and the denominator. The
reconciliation gap prints the three conditions it holds under — *current key, current UTC month, as
of now* — or says why it is omitted.

`/admin/users` carries the same per-owner figure for the current UTC month —
[admin.md § The spend column](admin.md#the-spend-column-and-the-two-things-that-keep-it-honest).

### `durationMs` is per **call**, and three different ways of adding it up are wrong

**This has produced a wrong number in three separate workstreams on one day — 2026-08-30 — and in
two of them the wrong number reached a committed document before anyone noticed.** It is written
here rather than in any of those documents because the trap is in the ledger, not in what anybody
was measuring.

The field times **one model call**. Nothing in the row says how long a *step* took, and the three
obvious ways to reconstruct that are each wrong in a different direction:

| What you do | What it overstates | How it bit |
|---|---|---|
| `sum(durationMs)` for a step | a step whose calls run **concurrently** | `summarise` reported as 240.3s; its wall time is 91.3s across ten overlapping calls. Nav labels reported as 65.2s; actually 23.1s |
| group by `runId` | a **batch** — a CLI or eval walking several articles in one process | a `sketch` "step" of 408.1s was three *different articles* run sequentially by `evals/sketch/run.ts`, each one call of 125–145s |
| group by `(slug, job)` | unrelated runs, when `slug` is **null** | three `hierarchy` runs *five hours apart* collapsed into one 324s step |

**What actually answers "did this step fit?"** — wall clock, over rows that belong to one step:

```
max(finishedAt) - min(startedAt)   over rows filtered to one step
```

and a row belongs to one step only if you have checked **`scopeKind`** as well as `runId`.
`scopeKind: "eval"` means a harness drawing a batch, where a `runId` spans many articles;
`withLedger` does not attribute a slug the way a job does, so `articleSlug` is null on those rows and
cannot separate them either.

**The one case where all four agree is a single-call step**, which is why the number that survived
every correction is `hierarchy` at **320.4s in one call** — sum, wall, and any grouping give the same
answer when there is nothing to aggregate. That is the measurement
[`tests/jobs-lease-budget.test.ts`](../../tests/jobs-lease-budget.test.ts) pins the step deadline
against, and it is deliberately the only one it cites.

**Why it keeps happening.** `durationMs` sits next to `startedAt` and `finishedAt` in a row that
looks like a unit of work, and summing it is what any reasonable person does first. The result is
always *plausible* — it is never wildly out, it is just inflated by however much the calls overlapped
— so nothing about the number invites a second look. Two of the three cases here were caught by a
reviewer, not by the person who computed it, and the third was caught by the person whose step had
been mis-measured.

Three properties of that write are load-bearing and none of them is obvious:

- **The write is awaited, not fired and forgotten.** On Vercel a function can be frozen the moment
  its response is sent, and an un-awaited promise then never runs — so the rows that would go missing
  are exactly the request-path ones, which is the half a per-user total is made of.
- **One insert per finished call, not one batch per scope.** A batch loses forty finished calls to
  one mid-step crash; a write each loses only what was genuinely still in flight.
- **A failing sink cannot fail the feature.** It logs and returns, and the count reaches the step or
  request's own line as `aiWriteFailures`. The old app rethrew, which meant a Postgres hiccup could
  take down a reader-facing feature — [logging.md](logging.md) quotes it as the thing not to copy.

**A CLI stage run is in the ledger too**, via one line at each stage's `isMain`
([`src/cli-ledger.ts`](../../src/cli-ledger.ts)) — so `npm run hierarchy` is money that appears in
`npm run cost`. `evals/` is not: it calls models outside both gateways, and the report says so on
every run rather than being quietly partial.

**That sentence was false for two of the eight until 2026-08-28.** `npm run labels` and
`npm run pdf` had never had the line: both called `main()` straight from the guard, so every batch
and every chunk they bought went nowhere near `npm run cost` and was counted by `unscopedCalls()` as
fallen on the floor. Nothing noticed, because the two checks that look at spend ask a different
question — `tests/no-undeclared-spend.test.ts` asks *can this file reach a provider, and is that
declared*, which both files passed, and there was nothing at all asking *does this entrypoint open
the ledger*. The concrete cost of six files copying a shared tail is that the two which did not copy
it are the two that leak.

[`tests/paid-cli-ledger.test.ts`](../../tests/paid-cli-ledger.test.ts) is what stops a third. It
keeps an explicit list of the paid CLIs and **parses** each one, asking whether the branch that runs
when the module is the entry file invokes `withLedger("cli", …)` — the one imported from
`cli-ledger.js` — and nothing else beside it. It is not a text search for `withLedger` near an
`isMain`, and the reason is [silent-success.md](../reusable/silent-success.md): a comment, a dead
branch, a locally-defined wrapper of the same name and a bare `main()` sitting next to a correct
wrapper all beat a text search while the money still disappears. Each of those is a case in the
test, red, alongside the real files with the wrapper taken back out.

**Since 2026-08-28 a stage CLI can end in either of two ways, and the gate checks both whole.** The
new tail is one line — `await stageCli(import.meta.url, main)` — which folds the guard,
`loadEnvLocal()` and `withLedger("cli", …)` together, so the leak above stops being a line somebody
has to remember to copy (`stageCli` in [`src/cli-ledger.ts`](../../src/cli-ledger.ts);
docs/plans/260828aj-simplification-wave-2.md §2.5). Three of the eight are on it; the other five still carry
the old pair, because they were dirty with other agents' work on the day.

The tempting way to accept two tails is to ask something weaker of each, which is the failure this
gate already had once. So the two are checked separately, and the new one is checked *harder*: the
CLI's tail has to **be** a top-level `await stageCli(import.meta.url, main);` statement — not a
`stageCli` call found somewhere, so not a `void`, a `.then()` chain or a call inside an `if` — on
the `stageCli` **resolved** to `src/cli-ledger.ts`, with `main` named nowhere else in the file,
function bodies included. A separate rule then asks of `src/cli-ledger.ts` itself that `stageCli`
is exactly `if (!isMain(entry)) return; loadEnvLocal(); await withLedger("cli", main);` and nothing
more. That last one is the point: a gate that only checked that the CLIs call `stageCli` would go
quiet the day somebody simplified `stageCli`.

**The first version of both rules asked for presence where it needed execution**, and GPT Sol found
it by *running* the exported detectors against adversarial sources rather than reading them — seven
ways in, every one ordinary code with the right syntax in the right order: a guard whose test was
the wrong way round, a guard that exits along one path, a `return` between the guard and the
`.env.local` read, a wrapper in `if (false)`, a wrapper that is not awaited, a tail that is not
awaited, and `async function leak() { await main(); }` beside `await leak();`. It also beat the
dispatch with `import { stageCli } from "./fake/cli-ledger.js"`, because `endsWith("/cli-ledger.js")`
matches a basename and a basename is not an identity — the same mistake the entrypoint guards this
item replaced were making at the same time, which is what [`src/is-main.ts`](../../src/is-main.ts)
is for. All seven are now red controls with the exact sentence each produces.

The guard those tails ask is one function now, [`isMain`](../../src/is-main.ts), rather than the
nine spellings that were in the tree — three of which were wrong, in both directions.
[`tests/is-main.test.ts`](../../tests/is-main.test.ts) runs the same table of inputs against the
real one and against all three broken ones, and says which rows each broken one gets wrong.

### Aborted is a cause, not a coincidence

Both wires used to record *any* failure raised while a signal happened to be aborted as `"aborted"`.
A provider dying at the moment a reader presses Stop is not far-fetched — a stall on their side is
exactly what makes somebody press it — and `"aborted"` is the outcome nobody investigates, so the one
event that could explain the failure went into the bin marked *the reader did that*.

Both now ask whether the error **is** the abort: the signal's own `reason` by identity, or an
`AbortError` where no reason was given. [`openrouter-stream.ts`](../../src/openrouter-stream.ts)'s
`stoppedByReader` had been making the same distinction for the reader-facing message since before
this; the bill was still using the weaker question.

### How a stream ends, and who decides what that means <a id="stream-end"></a>

**One classification, seven callers, and the callers still decide.**
[`classifyEnd`](../../src/ai-call.ts) turns a finished `openRouterStream` run into a
`StreamOutcome` — `finished`, `truncated`, `filtered`, `wants-tools`, `provider-failed`,
`abandoned`, `timed-out`, `went-quiet`, `unterminated`, or `unknown-finish-reason` with the reason
and the terminator beside it. Every streaming caller switches on it with a `never` default, so a
tenth way for a stream to end is a compile error at every site rather than a branch somebody forgot.

**Why it reports rather than decides.** The callers genuinely disagree, on evidence, about what
`finish_reason: "length"` means: fatal to a quiz mark, success-with-a-flag to chat, left to the
strict parse by the four JSON callers, and stored whole by explain. A shared classifier that threw
on it would break six callers to fix one. So the module answers *what happened* and each caller
answers *what to do*.

**One per stream, not one per feature request.** Chat makes up to four provider requests in a turn
for tool rounds and resets its `StreamEnd` between them, so a turn's verdict is a fold over its
rounds' — see `src/converse.ts`.

**Two edges worth knowing before you touch it:**

- **Our own clocks come before the reader, and the reader comes before the provider.** A deadline or
  a stall aborts the reader's signal too, so all three arrive as one aborted signal and only
  `readerAborted` tells them apart; asking the provider first would file our own twenty-second
  silence as whatever the model last happened to say. A consequence: a provider that said `error`
  and *then* lost its reader classifies as `abandoned`, so the caller applies its abandonment policy
  rather than its failure policy. Deliberate — the alternative tells off a reader who has gone, for
  the provider's fault.
- **An `error` arriving as `chunk.error` data never reaches here.** It is payload, not an ending, and
  every caller throws on it inside its own loop. `StreamEnd` carries the finish reason and the
  terminator, nothing else, so the union is exhaustive for streams that returned normally and not
  for every way a provider can report a failure.

> [!WARNING]
> **A stream can end by simply stopping, and that looks exactly like finishing.** `[DONE]` is the
> only clean end an SSE response has, so a connection cut two paragraphs in reads as a complete
> answer with no error anywhere — `unterminated` is the member of the union that names it. The
> guard this replaced was `!end.terminated && finishReason === null`, a conjunction that a non-null
> finish reason could only make *less* likely to fire, with a comment beside it calling
> `finish_reason` "a second witness" — a loosening described as a check. It was written once and
> copied verbatim into six more files over six days, and three of the six findings against quiz mode
> were that sentence.
> [260901c-the-success-signal-that-outlived-its-witness.md](../postmortems/260901c-the-success-signal-that-outlived-its-witness.md)
> is the postmortem;
> [260901g](../plans/260901g-one-stream-end-classification-shared-by-five-callers.md) is the
> migration that ended it.

## The three calls allowed round the outside, and the test that keeps them to three

"One seam per wire" is what lets `npm run cost` claim it has seen everything. `evals/` broke that
claim on the morning after it was made — eight sites, on **two** accounts, spending real money into
no total at all. Most were simply unscoped; a few were raw `fetch` calls somebody wrote in a hurry.
Two were raw **on purpose**, and that is the case worth understanding:

> the PDF bake-off exists to compare the Anthropic SDK against OpenRouter, and a bake-off forced onto
> one transport is measuring nothing.

So the rule is not *"everything uses the seam"*. It is **a bypass has to be declared, and a declared
bypass still writes a row** — silence reads as zero, and zero is the one answer that is definitely
wrong.

**And there are two that do neither** — the two live-mode evals and the Codex CLI. They are the case
`DECLARATIONS` cannot hold, and for two different reasons: an eval opens a realtime session and talks
over it, so there is no response body for an `Observer` to read; `run-codex.ts` makes no request at
all, it spawns a subprocess. They are in `UNMETERED_SPEND` — a reason written down, and no row ever
produced — which is weaker than every other entry here.

**Live conversation was the third until 2026-09-02**, and how it left matters more than that it did:
not by starting to use a seam — the browser still opens WebRTC straight to OpenAI, which is still a
sanctioned bypass — but because the browser now reports what each turn cost to an authenticated
endpoint that prices it and writes a row. Only the accounting moved.

*"A `Declaration` for them cannot be typed until `ProviderAccount` and `Wire` widen"* was the reason
given here until 2026-09-02. Both widened that day and none of them moved, which is the point: the
types were never what stood in the way.

- [`src/spend-declarations.ts`](../../src/spend-declarations.ts) — the register, and it is **two
  tables**. `DECLARATIONS` is one entry per bypass: which account it bills, which file may use it,
  why the seam is wrong for it, and whether it actually writes a row yet. `npm run cost` prints
  every `metered: false` entry **by name, every run**, which is what makes the list finishable — the
  sentence it replaced ("*not counted here: anything evals/ spends*") named nothing and so never
  could be.
- `UNMETERED_SPEND`, in the same file — **the spend a `Declaration` cannot describe**, printed on
  every run by `unmetered()` in [`scripts/ai-cost.ts`](../../scripts/ai-cost.ts). A declaration has a
  `ProviderAccount` and a `Wire`; these have both now and still cannot be declared, because a
  `Declaration` is spent through `declaredFetch`, which wraps a request this process made. Two
  entries: the two live-mode evals under `evals/live/`, and
  [`scripts/run-codex.ts`](../../scripts/run-codex.ts) — the GPT Sol reviews this repo asks for on
  every plan, which spawn another vendor's CLI on a third account and so are invisible to the
  capability scan as well as to the ledger.

  It has to be printed separately from `undeclared()`, which reads `DECLARATIONS`: on the day the
  last `metered: false` entry is wired up this report would otherwise have announced that everything
  writes a row — while a reader could be holding a live conversation billing audio by the minute
  into no total at all. Greg accepted that gap knowingly on 2026-08-31 and it closed on 2026-09-02,
  which is why that entry is gone: an entry here claims *no row appears*, and leaving one for a
  feature that now writes rows is the same overclaim in the other direction.
  [live-conversation.md § The meter](live-conversation.md#the-meter).
  The completeness line says "every **declared** way", which is the true claim.

  **The other two were named only in the scan's `ALLOWED` map until 2026-09-02, and that map prints
  nothing.** A green test is not a register: somebody asking what spends money here that they cannot
  see got a report naming three dictation benches and stopping, while the live evals and every
  review bought on `CODEX_API_KEY` were outside it. `OPENAI_API_KEY` is also a **separate billing
  account** from `OPENROUTER_API_KEY` and is not covered by the cap set on the OpenRouter account —
  it is in [`.env.example`](../../.env.example) and the health report's `EXPECTED` since the same
  day, having been in neither.
- [`evals/declared-spend.ts`](../../evals/declared-spend.ts) — the wrapper, kept under `evals/` so
  nothing in `src/` can reach a second way of calling a model. `declaredFetch` refuses to run outside
  a declaration, and counts attempts: a default Anthropic client retries twice, so one call can be
  three billable requests behind one row.
- [`tests/no-undeclared-spend.test.ts`](../../tests/no-undeclared-spend.test.ts) — fails on any file
  that can reach a paid provider and is neither a seam, nor allow-listed with a reason, nor declared.
  A **tripwire, not a boundary**, in the same sense as `OPENROUTER_BASE` being unexported: it caught
  two live offenders on its first run.
- [`tests/paid-cli-ledger.test.ts`](../../tests/paid-cli-ledger.test.ts) — the other question, which
  that one structurally cannot ask: does each paid CLI's entrypoint actually open the ledger. Also a
  tripwire — its list of paid CLIs is kept honest only for an entry module that imports a seam
  *directly*, and one reaching a paid call transitively would need real dataflow to see.

**A bypass is not the same thing as a second vendor**, and conflating the two is what
`account: "anthropic"` on a declaration used to mean by accident. A bypass exists because
`streamMessage` owns the model and the effort on purpose and an eval varies them per arm; that is a
reason to go round the *seam*, not a reason to go round *OpenRouter*. So the wrapper offers two
clients: `messagesSkinForDeclared()`, the SDK pointed at the Skin on `OPENROUTER_API_KEY`, which is
what a bypass wants almost every time — and `anthropicDirectForDeclared()`, which is
`api.anthropic.com` on `ANTHROPIC_API_KEY`.

**There is one caller of the second, and `tests/no-undeclared-spend.test.ts` fails if a second
appears.** It is the PDF bake-off's `transport: "anthropic"` arms, for the reason quoted above, and
that is the whole of why the key exists in this project. It is not in `.env.local`, not on Vercel and
not in `/api/health` — without it the bake-off skips those four arms and names them, and nothing else
in the repo notices. The judge in [`evals/embedding-retrieval.ts`](../../evals/embedding-retrieval.ts)
was the other caller until 2026-08-31; it had no such reason and moved onto the Skin, which also
turned its row from our arithmetic into OpenRouter's own settled figure.

**The same distinction had to be made a second time, in the observer**, and getting it wrong was
invisible because the money stayed right. `account` decides which cost figure is authoritative;
`wire` decides what shape the usage arrived in, and the two wires disagree about what an input token
*is*. There were two observers, named after the accounts, so a bypass speaking the *Messages* shape
to *OpenRouter* had only the chat-shaped one available — whose body has nowhere to put a cache split,
a thinking count, a service tier or an inference geography. Both Messages-wire bypasses were doing
that, and their rows carried the right cost and had quietly stopped explaining it. There is now a
third, `messagesViaOpenRouter`, and handing either of the other two the wrong wire throws. GPT Sol,
2026-08-31.

Which is the difference the row carries. A bypass on the **openrouter** account is priced by
OpenRouter like any other call — `usage.cost`, in band. Only an **anthropic**-account bypass has
nobody to ask, so its row carries `cost_source: "computed"` and a `price_version`, and
`credits_used_nanos` stays null. That column means one thing — what OpenRouter deducted — and it is
what `--reconcile` compares against their own running total, so an estimate must never land in it.
The report keeps the two apart and says which half it has never checked.

Written up in [260828g-ai-spend-outside-the-gateway.md](../plans/260828g-ai-spend-outside-the-gateway.md).

## The exception that arrived, and what it costs the rule

Everything above rests on one vendor. **Live conversation — interactive voice dialogue on OpenAI's
Realtime API — cannot rest on it**, because OpenRouter does not proxy that API. The decision was
made in advance rather than discovered in a diff
([realtime-voice-cost-tracking.md](../plans/realtime-voice-cost-tracking.md)), and both halves were
built on 2026-09-02 — the server's journal, endpoints and pricing first (Stage 2A), then the
browser's reporting (Stage 2B, [`src/web/live/meter.ts`](../../src/web/live/meter.ts)).

The rule is now: **every paid operation goes through one of two owned seams or through the realtime
acceptance endpoint.** OpenRouter owns messages, chat and embeddings; live conversation is metered
from the browser's own report, because there is no seam for it to pass through.

Three things about it are worth knowing before you touch this file's claims:

- **The usage numbers come from the reader's browser**, because with browser WebRTC the
  `response.done` events land there and there is no way to ask OpenAI afterwards. The rows are
  `cost_source: "computed"` — our arithmetic over a table we typed in — which is what that value has
  always meant here.
- **Two bills per conversation, not one.** The model that answers is billed per token split by
  modality on `response.done`; `gpt-live-transcribe`, which writes down what the reader said, is
  billed **per audio minute** and reports on its own event. A meter that watched only `response.done`
  would price half the feature at zero, which is why the report is a discriminated union — token
  detail *or* seconds.
- **A turn the tab never posted is simply missing.** There is no durable outbox and no ack-based
  retry: GPT Sol cut both for the alpha, as *"what an invoice needs"*. The queue is in memory and
  lives as long as the tab, so the live figure is biased low by a probably-small unknown.
- **There is no `usageSource` column, and that was a decision.** The design proposed one
  (`"client_report" | "sideband"`) so a server-side sideband could be swapped in later without a
  schema change. It was left out: today `wire = 'realtime'` **is** "a browser reported this", so the
  column would have exactly one value, and an additive migration on the day a sideband exists is
  cheaper than a column nothing distinguishes in the meantime.
- **`beginSpend`'s guarantee does not stretch this far.** It holds the pending call in memory
  ([`src/ai-spend.ts`](../../src/ai-spend.ts)), which is honest about itself — *"if the process dies,
  this dies with it"* — and a twenty-minute conversation across many Vercel invocations is the case
  that makes it bite. So realtime does not go through `collectSpend` at all: it has its own durable
  lifecycle in `spideryarn.realtime_sessions`, and `acceptRealtimeUsage` builds the row and hands it
  straight to `costStore`.

## The one thing still open

OpenRouter's own Messages reference contradicts itself about refusals: its example shows
`stop_details.type: "refusal"` beside `stop_reason: "end_turn"`. All seven stages branch on
`message.stop_reason === "refusal"`, and if that branch stops firing each one tries to parse a
refusal sentence as JSON — `summarise.ts` worst of all, treating it as a
repairable parse error, buying a second call, and then salvaging the batch as merely missing
summaries.

It could not be settled by probe: triggering a genuine refusal means composing a harmful request,
which is not a thing to do to check a field name. The answer is not a probe anyway — a check that
accepts *either* shape is correct whichever way OpenRouter's documentation gets fixed, and costs one
clause.

## See also

- [`src/messages-stream.ts`](../../src/messages-stream.ts) — the Messages gateway, and the longest
  version of the reasoning above
- [`src/ai-call.ts`](../../src/ai-call.ts) — the chat gateway, and `AI_JOB_ROUTE`
- [`src/ai-spend.ts`](../../src/ai-spend.ts) — the ambient spend collector, the row it builds, and
  `withSpendAttribution`
- [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts) — which ledger is live, and the one place
  the totals are computed
- [`scripts/ai-cost.ts`](../../scripts/ai-cost.ts) — `npm run cost`
- [`src/spend-declarations.ts`](../../src/spend-declarations.ts) — the calls allowed round the
  outside, and why each one is
- [260827q-ai-cost-tracking.md](../plans/260827q-ai-cost-tracking.md) — the plan this came out of, including the
  three probes that changed its mind
- [260828g-ai-spend-outside-the-gateway.md](../plans/260828g-ai-spend-outside-the-gateway.md) — the eight sites that
  were spending into no total, and the scan that stops a ninth
- [260827f-openrouter-as-sole-gateway.md](../research/260827f-openrouter-as-sole-gateway.md) — the research, with the
  catalogue of ways caching breaks silently in other people's projects
- [realtime-voice-cost-tracking.md](../plans/realtime-voice-cost-tracking.md) — the one paid call
  that will not fit through OpenRouter, and how it is accounted for instead
- [realtime-voice-cost-tracking-web.md](../research/realtime-voice-cost-tracking-web.md) — what the
  Realtime API emits as usage, current pricing, and the survey of tools that mostly cannot help
- [realtime-voice-vercel-transport.md](../research/realtime-voice-vercel-transport.md) — why a
  server cannot ask for a session's cost afterwards, and what Vercel can hold open now
- [prompt-caching.md](prompt-caching.md) — the three caches and how to tell whether they are working
- [setup-dev.md](setup-dev.md) — which model each job uses
- [logging.md](logging.md) — where the per-step cost fields go and why they are logged from the seam
