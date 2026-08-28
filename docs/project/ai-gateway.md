# The AI gateway: one vendor, two wires

Every paid model call this app makes goes through **OpenRouter**, and every one of them is
*recorded*. Since 2026-08-27 there are no exceptions — not the pipeline, not chat, not embeddings,
not dictation, not the PDF reader.

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

Until that day there were two vendors. The seven pipeline stages — [`toc`](../../src/toc.ts),
[`labels`](../../src/labels.ts), [`arc`](../../src/arc.ts), [`tweets`](../../src/tweets.ts),
[`glossary`](../../src/glossary.ts), [`summarise`](../../src/summarise.ts),
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
| **Messages** | Anthropic's Messages protocol, via OpenRouter's Anthropic-compatible endpoint (`/api/v1/messages`, which OpenRouter calls the "Anthropic Skin") | the seven pipeline stages | [`src/messages-stream.ts`](../../src/messages-stream.ts) |
| **chat** | OpenAI's chat/completions shape | explain, chat, search, dictation, PDF reading | [`src/ai-call.ts`](../../src/ai-call.ts) |
| **embeddings** | `/api/v1/embeddings` — OpenAI-shaped, different endpoint | turning a paragraph into a vector | [`src/ai-call.ts`](../../src/ai-call.ts) |

Two files, thirteen call sites, and **no third way to spend money**. Each gateway's tests scan `src/`
and fail if any other file constructs an Anthropic client, opens a message stream, or names an
OpenRouter endpoint.

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
[embedding-endpoints-refused.md](../plans/embedding-endpoints-refused.md) for the eval's numbers and
the billing catch.

This is not hypothetical. **Drift, Trail and Force were dead in production from the day they shipped
until 2026-08-28**, because `OPENROUTER_API_KEY` on Vercel is a different account from the one in
`.env.local`, and that account may not use `voyageai/voyage-4`. Every check passed throughout:
the variable was set, spelt right, and `GET /api/health` said so. Nothing in the deploy pipeline
ever asks the deployed key to *make a call*, which is the only question that would have caught it —
and it has to be asked from inside the deployment, because a probe run on a laptop reads
`.env.local` and tests the key that works.

The full account, the fix, and the probe that would have caught it:
[embedding-endpoints-refused.md](../plans/embedding-endpoints-refused.md) and
[the-deployed-key-was-never-asked-to-do-anything.md](../postmortems/the-deployed-key-was-never-asked-to-do-anything.md).

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

[The cost-tracking plan](../plans/ai-cost-tracking.md) opens by arguing that the two transports
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
check. [The plan](../plans/ai-cost-tracking.md) says so at length; it is repeated here because the
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
in Greg's absence are in [ai-cost-tracking.md](../plans/ai-cost-tracking.md).

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
([`src/cli-ledger.ts`](../../src/cli-ledger.ts)) — so `npm run toc` is money that appears in
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

### Aborted is a cause, not a coincidence

Both wires used to record *any* failure raised while a signal happened to be aborted as `"aborted"`.
A provider dying at the moment a reader presses Stop is not far-fetched — a stall on their side is
exactly what makes somebody press it — and `"aborted"` is the outcome nobody investigates, so the one
event that could explain the failure went into the bin marked *the reader did that*.

Both now ask whether the error **is** the abort: the signal's own `reason` by identity, or an
`AbortError` where no reason was given. [`openrouter-stream.ts`](../../src/openrouter-stream.ts)'s
`stoppedByReader` had been making the same distinction for the reader-facing message since before
this; the bill was still using the weaker question.

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

- [`src/spend-declarations.ts`](../../src/spend-declarations.ts) — the register. One entry per
  bypass: which account it bills, which file may use it, why the seam is wrong for it, and whether it
  actually writes a row yet. `npm run cost` prints every `metered: false` entry **by name, every
  run**, which is what makes the list finishable — the sentence it replaced ("*not counted here:
  anything evals/ spends*") named nothing and so never could be.
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

A declared bypass cannot be priced by OpenRouter, so its row carries `cost_source: "computed"` and a
`price_version`, and `credits_used_nanos` stays null. That column means one thing — what OpenRouter
deducted — and it is what `--reconcile` compares against their own running total, so an estimate must
never land in it. The report keeps the two apart and says which half it has never checked.

Written up in [ai-spend-outside-the-gateway.md](../plans/ai-spend-outside-the-gateway.md).

## The one thing still open

OpenRouter's own Messages reference contradicts itself about refusals: its example shows
`stop_details.type: "refusal"` beside `stop_reason: "end_turn"`. All seven stages branch on
`message.stop_reason === "refusal"`, and if that branch stops firing each one tries to parse a
refusal sentence as JSON — [`summarise.ts`](../../src/summarise.ts) worst of all, treating it as a
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
- [ai-cost-tracking.md](../plans/ai-cost-tracking.md) — the plan this came out of, including the
  three probes that changed its mind
- [ai-spend-outside-the-gateway.md](../plans/ai-spend-outside-the-gateway.md) — the eight sites that
  were spending into no total, and the scan that stops a ninth
- [openrouter-as-sole-gateway.md](../research/openrouter-as-sole-gateway.md) — the research, with the
  catalogue of ways caching breaks silently in other people's projects
- [prompt-caching.md](prompt-caching.md) — the three caches and how to tell whether they are working
- [setup-dev.md](setup-dev.md) — which model each job uses
- [logging.md](logging.md) — where the per-step cost fields go and why they are logged from the seam
