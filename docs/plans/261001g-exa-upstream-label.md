# Exa-searching calls record the wrong upstream

Overseer queue item `qi-7hdcbvn4`, raised by fb2y-citations-mode on 2026-09-12 (source:
[260911g-citations-mode.md](260911g-citations-mode.md)). XS.

## The report

Every chat-wire call that searches with Exa (`debate`, `referee-candidates`, `citations-find`, and
anything else that sends `openrouter:web_search` with `engine: "exa"`) is written to `ai_calls` with
`upstream = 'OpenAI'`, for `anthropic/claude-sonnet-5` with `order: ["anthropic"],
require_parameters: true`. Calls without Exa record `Anthropic`. Either the label is wrong or the
routing is.

## What was measured (2026-10-01, live, against OpenRouter)

A one-search request to `anthropic/claude-sonnet-5`, streamed, every chunk's `provider` counted,
then the same generation id looked up on `GET /api/v1/generation`:

| tools | provider block | every chunk's `provider` | generation record's `provider_name` |
|---|---|---|---|
| `web_search`, `engine: "exa"` | `order:[anthropic]`, `require_parameters` | `OpenAI` (8/8) | `Anthropic` |
| `web_search`, native engine | same | `Anthropic` (5/5) | `Anthropic` |
| none | same | `Anthropic` (32/32) | — |
| `web_search`, `engine: "exa"` | `only:[amazon-bedrock]`, no fallbacks | `OpenAI` (9/9) | `Amazon Bedrock` |
| `web_search`, `engine: "exa"` | `only:[anthropic]`, no fallbacks | `OpenAI` (8/8) | — (not yet written) |
| `web_search`, `engine: "exa"` | `only:[openai]` | 404, no endpoint | — |

And the money agrees with the record, not the chunks: the Exa call's
`upstream_inference_prompt_cost` is exactly 1,025 uncached tokens × $2/M plus 4,867 cache-write
tokens × $2.50/M — Anthropic's 1.25× write premium, which OpenAI does not charge.

**So the routing is right and the label is wrong.** On the Exa path OpenRouter's server-tool loop
stamps `provider: "OpenAI"` on every chunk whatever answered; the pin is honoured (Bedrock-only lands
on Bedrock, OpenAI-only 404s). Neither cost nor the privacy promise in ai-gateway.md is affected — only
the `upstream` column.

## After the plan review — the fix that was built

GPT Sol's plan review ([-plan-review-sol-2.md](261001g-exa-upstream-label-plan-review-sol-2.md);
the first attempt died on "model at capacity") asked for a non-streamed row, a reproducible probe,
and a look at OpenRouter's `X-OpenRouter-Metadata: enabled` header. All three were done with
[`scripts/probes/261001g-exa-upstream-probe.mjs`](../../scripts/probes/261001g-exa-upstream-probe.mjs),
and its raw output is [261001g-exa-upstream-probe-results.jsonl](261001g-exa-upstream-probe-results.jsonl):

| tools | mode | pin | frames' `provider` | metadata `selected` | generation `provider_name` |
|---|---|---|---|---|---|
| Exa | stream | `order:[anthropic]` | OpenAI ×8 | Anthropic | Anthropic |
| Exa | json | `order:[anthropic]` | OpenAI | Anthropic | Anthropic |
| Exa | stream | `only:[amazon-bedrock]` | OpenAI ×10 | Amazon Bedrock | Amazon Bedrock |
| Exa | json | `only:[amazon-bedrock]` | OpenAI | Amazon Bedrock | Amazon Bedrock |
| default engine | json | `order:[anthropic]` | Anthropic | Anthropic | Anthropic |
| none | json | `order:[anthropic]` | Anthropic | Anthropic | Anthropic |

Non-streamed calls mislabel in the same way. In both streamed probes the metadata arrived once, on
the usage chunk, and its `pipeline` names the path (`mode: "sdk"`, `executed_engines: exa`). That is
an observation, not an ordering contract: the collector reads every chunk, keeps metadata
authoritative if a provider frame follows it, and takes the last selected endpoint if several
metadata blocks arrive. **So the built fix records the truth rather than `null`.** Both chat seams
send the header.
`Meter.sawRoute` takes the `selected` endpoint and, once it has one, ignores the frame's `provider`.
The `null` rule below stays as the guard for an explicit-Exa reply that comes back without metadata.
The header goes on `wire: "chat"` rows only, because the embeddings path was never probed with it.

The probe is not a headed-versus-unheaded cache experiment: it has no otherwise-identical control
and no warm repeat. It shows that headed requests still obeyed both pins, were priced at the selected
endpoint's rates and still produced cache-write tokens. The stronger reason not to expect the header
to change routing, inference cost or the prompt cache is OpenRouter's API contract: it is a
[response-metadata opt-in](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request),
not a routing or prompt parameter. That distinction matters more than calling the absence of an
observed change a measurement of no change.

Sol's other findings: the coverage claim is narrowed to "explicit `engine: "exa"` on the chat wire".
A default-engine search that falls back to Exa, the older `plugins` spelling, or Exa on the Messages
wire would rely on the metadata alone, and the last would need its own probe. Two more callers,
`upload-source-guess` and `citation-investigate`, are named. And the historical rows get an exact
predicate in ai-gateway.md (`upstream = 'OpenAI' AND requested_model LIKE 'anthropic/%'`), not a
list of jobs, since `debate`'s synthesis call was always labelled correctly.

## The fix as first planned

The meter stops believing the frame's `provider` on a request whose tools include an Exa
`openrouter:web_search`, and records `upstream = null` — "not known" — for that call. One predicate
in `src/ai-call.ts`, read from the outgoing body when the `Meter` is built, so it covers both chat
seams (`openRouterStream`, `openRouterJson`) and every current and future Exa caller without each
remembering.

**Simpler option passed over: change nothing and document it.** Rejected because the column would
keep asserting a falsehood that the next reader of `npm run cost` has to know to discount — the same
reason the field exists at all ("a report that shows only the requested provider attributes the money
to somebody who never ran the call").

**Richer option passed over: look the generation up afterwards** (`GET /api/v1/generation`) and
record its `provider_name`. That is the true answer, but it is a second paid-key request per call,
it is not written immediately (one lookup a few seconds later came back empty), and it adds a
retry-and-wait to the finish path. Not worth it for a reporting column; name it in the doc as the way
to get the truth if a question ever needs it.

**Not "record the pin".** Writing `Anthropic` because we asked for Anthropic is the very thing the
field's docstring forbids.

Null for an OpenAI model under Exa too (no job does that today): the label is constant on that path,
so even when it happens to be right it is right by coincidence.

Historical rows are not rewritten — a write to production for a reporting column. ai-gateway.md says
which rows are affected so a query can discount them.

## Done when

- A test that feeds `openRouterStream` / `openRouterJson` an Exa request and a frame saying
  `provider: "OpenAI"` records `upstream: null`; a native-search request still records the frame's
  provider. Seen red first.
- ai-gateway.md says which: the recording, with the measurement.
