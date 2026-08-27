# The AI gateway: one vendor, two wires

Every paid model call this app makes goes through **OpenRouter**. Since 2026-08-27 there are no
exceptions — not the pipeline, not chat, not embeddings, not the PDF reader.

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
| **chat** | OpenAI's chat/completions shape | explain, chat, search, embeddings, PDF reading | [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) |

[`src/models.ts`](../../src/models.ts) holds this as `TASK_WIRE: Record<Task, Wire>` — a record
rather than two lists, so a task nobody assigned fails to compile rather than quietly getting a
default. `Provider` is still a type there, now with exactly one member. One member is not an
oversight; it is the decision, written where somebody will trip over it.

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
`MESSAGES_PROVIDER`, sent on every call, mandatory rather than advisory.

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
it.

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

- [`src/messages-stream.ts`](../../src/messages-stream.ts) — the gateway, and the longest version of
  the reasoning above
- [`src/ai-spend.ts`](../../src/ai-spend.ts) — the ambient spend collector
- [ai-cost-tracking.md](../plans/ai-cost-tracking.md) — the plan this came out of, including the
  three probes that changed its mind
- [openrouter-as-sole-gateway.md](../research/openrouter-as-sole-gateway.md) — the research, with the
  catalogue of ways caching breaks silently in other people's projects
- [prompt-caching.md](prompt-caching.md) — the three caches and how to tell whether they are working
- [setup-dev.md](setup-dev.md) — which model each job uses
- [logging.md](logging.md) — where the per-step cost fields go and why they are logged from the seam
