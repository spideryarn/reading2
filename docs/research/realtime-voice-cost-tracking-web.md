# Tracking per-session / per-user cost for the OpenAI Realtime API

Research done 2026-08-31. Context: Spideryarn routes every other paid model call through
OpenRouter into a Postgres spend ledger (job, model, tokens, cost, owner id). OpenRouter does not
proxy the Realtime API (speech-to-speech, `gpt-realtime` family), so a voice-dialogue feature would
talk to OpenAI directly, and today nothing would write a ledger row for it. This doc asks: what's
the simplest reliable way to attribute Realtime API cost per conversation / per reader, ideally
without provisioning an OpenAI **Admin API key**.

## 1. What usage data the Realtime API itself emits

The `response.done` server event carries a `usage` object, scoped to that one response (not the
whole session). Per OpenAI's "Managing costs" guide, a real example looks like:

```json
"usage": {
  "total_tokens": 253,
  "input_tokens": 132,
  "output_tokens": 121,
  "input_token_details": {
    "text_tokens": 119,
    "audio_tokens": 13,
    "image_tokens": 0,
    "cached_tokens": 64,
    "cached_tokens_details": { "text_tokens": ..., "audio_tokens": ... }
  },
  "output_token_details": {
    "text_tokens": 30,
    "audio_tokens": 91
  }
}
```
— [Managing costs | OpenAI API](https://developers.openai.com/api/docs/guides/realtime-costs) (fetched 2026-08-31, no page date shown).

`cached_tokens_details` (the text/audio split of the cached count) is real but was missing from the
`openai-node` TypeScript types for a while — the SDK's `InputTokenDetails` type only listed
`text_tokens`, `audio_tokens`, `cached_tokens`, while "the server returns an additional fourth
property: `cached_tokens_details`" — filed as a bug 2025-07-30, closed as an upstream/Stainless
codegen fix. [openai/openai-node#1600](https://github.com/openai/openai-node/issues/1600). If you
hand-roll types instead of trusting the SDK, don't drop this field.

Is this enough to price a session accurately? In principle yes — sum `input_token_details` /
`output_token_details` across every `response.done` in the session, multiply by the per-token
prices below, and you get a session cost. In practice several people report the totals don't add up
cleanly (see §6): duplicated/reprocessed context inflating `cached_tokens`, and at least one report
of `response.done` events **not** carrying the full breakdown, only top-level `input_tokens`/
`output_tokens` — [openai/openai-agents-js#538, "Realtime API response.done events missing detailed
usage fields"](https://github.com/openai/openai-agents-js/issues/538). OpenAI's own guide also
frames this data as *estimation*, not a billing source of truth — the parallel Azure docs are
explicit that "the Realtime API usage object is intended for usage visibility and estimation only,
not for billing reconciliation," with actual billing metrics (`processed_prompt_tokens`,
`generated_completion_tokens`) surfaced separately in the Azure portal —
[Azure OpenAI Realtime API: Token usage from response.done event does not match Azure Cost
Management meter data](https://learn.microsoft.com/en-us/answers/questions/5845915/azure-openai-realtime-api-token-usage-from-respons)
(Microsoft Q&A). I could not find an equivalent explicit disclaimer on OpenAI's own (non-Azure)
docs, but the community reports of mismatches below point the same way.

## 2. WebRTC vs WebSocket: where the usage events land

OpenAI's guide is explicit about which transport to use for which side: "**WebRTC:** Use for
browser and mobile clients that capture or play audio directly." / "**WebSocket:** Use when your
server already receives raw audio from a media pipeline, call system, or worker." —
[Realtime and audio | OpenAI API](https://developers.openai.com/api/docs/guides/realtime) (fetched
2026-08-31). With WebRTC, the browser holds the data channel directly, so `response.done` (and its
`usage` object) is delivered to client JavaScript, not to your server — confirmed by the existence
of the **sideband connection** pattern OpenAI documents specifically to give a server visibility
into a WebRTC session.

Accepted patterns, in order of trust:

- **Server-side WebSocket, not WebRTC.** If the browser doesn't need to hold the media connection
  itself (e.g. you proxy audio through your own server, or accept the extra latency), connect over
  WebSocket from your Node server and you see every `response.done` first-hand. This is the only
  pattern where the usage numbers are trustworthy without extra machinery.
- **Sideband connection (WebRTC + a second server-side connection to the same session).** OpenAI
  documents this for "webhooks and server-side controls": "there are two active connections to the
  same Realtime session: one from the user's client and one from your application server," letting
  the server "monitor the session, update instructions, and respond to tool calls" while keeping
  business logic private — [Webhooks and server-side controls | OpenAI
  API](https://developers.openai.com/api/docs/guides/realtime-server-controls) (fetched 2026-08-31).
  This does give the server its own event stream, including `response.done`, without asking the
  browser to self-report — the closest thing to a server-side "hook" for a WebRTC session that
  isn't SIP.
- **Client report (untrusted).** Have the browser sum `usage` across `response.done` and POST it to
  your server at end of session. It's the simplest to build but a malicious or buggy client can
  under-report (or the tab can close before the POST fires — see §6).
- **Webhooks: SIP only, not general session completion.** OpenAI's only genuine webhook mechanism
  for Realtime is for **SIP-based phone connections**: "OpenAI sends a webhook to your application's
  server webhook URL, notifying your app of the state of the session" when a caller dials in over
  SIP, with `webhook-id` / `webhook-timestamp` / `webhook-signature` headers for verification —
  same [server-controls doc](https://developers.openai.com/api/docs/guides/realtime-server-controls).
  I found **no** general-purpose "session ended, here's total usage" webhook for a plain
  browser-WebRTC or WebSocket session — this reference page explicitly does not describe any
  session-completion or usage-reporting webhook outside the SIP flow.

## 3. Current pricing

From OpenAI's machine-readable pricing page — [Pricing | OpenAI
API](https://developers.openai.com/api/docs/pricing) (fetched 2026-08-31, no revision date shown on
the page itself; cross-checked against secondary sources dated July 2026):

| Model | Text in | Cached text in | Text out | Audio in | Cached audio in | Audio out |
|---|---|---|---|---|---|---|
| `gpt-realtime` | $4.00/1M | $0.40/1M | $16.00/1M | $32.00/1M | $0.40/1M | $64.00/1M |
| `gpt-realtime-mini` | $0.60/1M | $0.06/1M | $2.40/1M | $10.00/1M | $0.30/1M | $20.00/1M |
| `gpt-realtime-2.1` | $4.00/1M | $0.40/1M | $24.00/1M | $32.00/1M | $0.40/1M | $64.00/1M |
| `gpt-realtime-2.1-mini` | $0.60/1M | $0.06/1M | $2.40/1M | $10.00/1M | $0.30/1M | $20.00/1M |

Audio token conversion: roughly 1 token per 100ms of *user* audio, 1 token per 50ms of *assistant*
audio — i.e. ~600 tokens/minute of user speech, ~1,200 tokens/minute of generated speech — per
[OpenAI Realtime API Pricing 2026: Cost Per Minute
Math](https://www.layer3labs.io/guides/openai-realtime-api-pricing) and corroborated by
[GPT-Realtime-2 Pricing](https://vantaige.io/blog/openai-gpt-realtime-2-voice-agent-setup-2026)
(both third-party, so treat the ratio as approximate, not canonical — I could not find OpenAI's own
docs stating the ms-per-token conversion explicitly in what I fetched). At those rates, a
`gpt-realtime-2.1` minute of conversation costs roughly **$0.06–$0.11/min** with caching working, or
**$0.18–$0.46/min** without — [Forasoft, "OpenAI Realtime API Pricing: The Real Cost Per
Minute"](https://www.forasoft.com/blog/article/openai-realtime-api-pricing).

There is no separate "canonical machine-readable" price feed beyond the pricing page itself (no
public JSON/CSV endpoint found); teams that want a stable feed generally hardcode the table and
watch for changes, which is what the third-party trackers above do too.

## 4. The Admin API route (`/v1/organization/usage/*`, `/v1/organization/costs`)

**Granularity.** `/v1/organization/usage/completions` (and the parallel realtime/audio usage
endpoints) accept `bucket_width` of `1m`, `1h`, or `1d` (default `1d`), plus `start_time`/
`end_time` — [Completions | OpenAI API
Reference](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions)
and community write-up
[dev.to](https://dev.to/ssukhpinder/openai-usage-api-apikeyid-reconcile-tokens-and-costs-by-key-4jmo).
`group_by` supports `project_id`, `user_id`, `api_key_id`, `model`, `batch`, `service_tier`, or any
combination.

**A per-user dimension exists — but it's OpenAI's own concept of "user", not yours.** The
`user_id`/`user` grouping only works if *you* attach an OpenAI end-user identifier to each request.
The mechanism OpenAI documents for this on Realtime specifically is not a `session.update` metadata
field, but a **header**: "If your application identifies individual end users, include a safety
identifier with Realtime API requests," sent as the `OpenAI-Safety-Identifier` header (search
result summarizing [Realtime client events | OpenAI API
Reference](https://developers.openai.com/api/reference/resources/realtime/client-events); I was not
able to fetch that reference page directly to confirm the exact header name and schema, so treat
this as needing direct verification before relying on it). Separately, Realtime's `response.create`
supports a `metadata` field, but that's documented as being for **disambiguating simultaneous
responses within one session** (useful for out-of-band responses), not for cross-session user
attribution.

**Costs endpoint.** `/v1/organization/costs` gives a "detailed breakdown of API spend by invoice
line item, with daily granularity" and can group by API key ID and project ID —
[Costs | OpenAI API
Reference](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
(could not fetch directly — 404/403 on two attempts — so this is via search-result summary,
unverified first-hand). No per-request or per-conversation dimension is exposed here; the finest
grain is daily × project × API key.

**Latency.** One source states "the usage API can lag by tens of minutes" before data is queryable
— [dev.to cost-attribution
playbook](https://dev.to/hassann/how-to-track-openai-api-spend-per-feature-a-cost-attribution-playbook-2dm7)
— and OpenAI's own dashboard docs position the Costs endpoint as the thing that "will reconcile
back to a billing invoice," implying it's for after-the-fact reconciliation, not live dashboards. I
could not find an OpenAI-stated SLA number for this lag in what I fetched — treat "tens of minutes"
as a third-party estimate, not a documented guarantee.

**Is an admin key necessary?** No — for the *simplest reliable per-conversation attribution*, it is
not necessary and doesn't even solve the problem cleanly: it caps out at daily × project × API key,
which is too coarse for per-reader, per-conversation cost unless every reader gets their own API key
or project (impractical). Its value is strictly as a **reconciliation nicety**: a periodic
cross-check that your own `response.done`-derived ledger totals roughly match what OpenAI actually
billed, catching systematic undercounting (§6). It's the same shape of caveat a comparable Anthropic
write-up makes about Anthropic's own Admin API: "API-key grouping is not request-level attribution…
[you] need to add your own request metadata and internal ledger at call time" —
[finout.io, "Tracking AI Costs Per Customer and Per Feature in
2026"](https://www.finout.io/blog/tracking-ai-costs-per-customer-and-per-feature-in-2026).

## 5. Third-party options

Checked against: proven Realtime (not just Chat Completions) support, active community/docs, typed
TS API, self-hostable, Vercel-serverless-friendly.

- **Helicone — supports Realtime, proxy-based, but the specific integration is deprecated.**
  Helicone added Realtime API logging in April 2025 —
  [changelog](https://www.helicone.ai/changelog/20250407-realtime-launch) — by having you connect to
  `wss://api.helicone.ai/v1/gateway/oai/realtime?model=...` instead of OpenAI directly, i.e. it's a
  **WebSocket proxy**, so it only works for the server-WebSocket topology, not raw browser WebRTC.
  It supports `Helicone-Session-Id` and `Helicone-User-Id` headers for exactly the per-session /
  per-user segmentation this task needs —
  [docs.helicone.ai/integrations/openai/realtime](https://docs.helicone.ai/integrations/openai/realtime)
  (fetched 2026-08-31). However that same page carries a live warning: **"This integration method is
  maintained but no longer actively developed. For the best experience and latest features, use our
  new AI Gateway with unified API access to 100+ models."** — so verify the newer AI Gateway path
  still carries Realtime support before betting on it; I did not independently confirm that.
  Helicone is open-source and self-hostable in general, which fits the "no lock-in" and "Vercel
  serverless" criteria reasonably well for the proxy piece (your app still talks WebSocket to
  Helicone's edge, or your self-hosted instance).

- **Portkey — Realtime WebSocket gateway, tracks tokens/cost, WebSocket only.** Portkey's gateway
  proxies `wss://api.portkey.ai/v1/realtime` and "parses WebSocket events to track: Token usage
  (input/output), Cost calculation, Response latency, Error rates, Custom metadata" —
  [Realtime APIs (WebSocket) — Portkey AI
  Gateway](https://mintlify.wiki/portkey-AI/gateway/features/realtime) (fetched 2026-08-31). Like
  Helicone, this is WebSocket-only — no WebRTC mention found — so again it only fits the
  server-relay topology. The docs don't spell out per-user attribution mechanics beyond "custom
  metadata," so that would need verifying hands-on. Portkey's gateway is open source
  ([Portkey-AI/gateway](https://github.com/Portkey-ai/gateway)), which covers self-hosting.

- **LiteLLM — has explicit Realtime cost-tracking as of a named release.** "v1.66.0-stable"
  release notes are titled "Realtime API Cost Tracking" and state key/user/team **budgets now work
  for realtime models** — [LiteLLM release
  notes](https://docs.litellm.ai/release_notes/v1.66.0-stable/v1.66.0-stable). This is the strongest
  concrete evidence found of first-party Realtime cost tracking in an open-source, self-hostable
  proxy with a large community and long track record (LiteLLM is widely used and well documented,
  which the project's own instructions value for LLM-assisted coding). One caveat surfaced in
  discussion: a user note that WebRTC + cost tracking for `/v1/realtime` isn't there — i.e. this is
  again the WebSocket/proxy topology, not WebRTC —
  [BerriAI/litellm discussion #7423](https://github.com/BerriAI/litellm/discussions/7423). LiteLLM
  runs fine as a normal Node-adjacent (Python) proxy process, but "works on Vercel serverless" is a
  stretch for a proxy meant to hold a long-lived WebSocket — it wants a persistent process, not a
  serverless function, same constraint as Helicone/Portkey's realtime paths.

- **LangFuse — explicitly does *not* auto-support Realtime yet.** Their own GitHub discussion
  says: "Automated tracking via the wrapped OpenAI SDK... is currently not supported for the
  Realtime API," with the team noting they've explored designs but usage patterns "are still
  developing" — [langfuse/discussions
  #3765](https://github.com/orgs/langfuse/discussions/3765) and
  [#4757](https://github.com/orgs/langfuse/discussions/4757). Workaround mentioned: manual
  low-level SDK tracing, or going through LiteLLM's Langfuse integration. Not a direct fit today.

- **OpenLLMetry / Traceloop, Braintrust, Laminar — no evidence of Realtime support found.**
  Searches turned up general OpenAI Chat/Assistants instrumentation for these but nothing
  specifically naming Realtime/speech-to-speech. Treat as **unsupported until proven otherwise** —
  I could not verify support, and given the OpenTelemetry-span model these tools use (built around
  discrete request/response calls), a bidirectional WebSocket session doesn't map cleanly without
  bespoke instrumentation.

- **OpenMeter — general metering, no Realtime-specific integration found.** OpenMeter is a generic
  open-source usage-metering/billing engine; its OpenAI material is about metering
  `data.usage.total_tokens` from regular Chat Completions responses. No mention of Realtime API
  found. It could still work as a *sink* — you compute usage yourself (per §1) and push events to
  OpenMeter for billing/aggregation — but it does no Realtime-specific parsing for you.

Bottom line for §5: only **LiteLLM**, and to a lesser/deprecated extent **Helicone**, have concrete,
citable, shipped Realtime-cost-tracking features; **Portkey** ships a Realtime proxy with token/cost
parsing but with thinner documented per-user attribution; all three are WebSocket-relay-shaped, none
documented as handling browser WebRTC. Everything else either explicitly doesn't support Realtime
yet (LangFuse) or has no found evidence either way (OpenLLMetry/Traceloop, Braintrust, Laminar,
OpenMeter for Realtime specifically).

## 6. Known traps that cause silent under-reporting

- **Sessions that end without a final `response.done`.** Multiple community reports describe
  responses stopping mid-stream with no closing event, or the whole connection dropping: "Realtime
  API stopped to respond on session creation," and a `livekit/agents` issue titled "OpenAI Realtime
  incomplete response can silently truncate speech without status_details reason in logs" —
  [livekit/agents#5808](https://github.com/livekit/agents/issues/5808). If your accounting only
  fires on `response.done`, a session that dies mid-response contributes zero to your ledger for
  tokens OpenAI still billed.
- **`response.done` sometimes omits the detailed breakdown.** [openai/openai-agents-js#538](https://github.com/openai/openai-agents-js/issues/538) reports events carrying only top-level
  `input_tokens`/`output_tokens` with the nested `*_token_details` missing — don't assume the full
  shape is always present; code defensively.
- **`response.status = "incomplete"`** (hit `max_output_tokens`, content filter, etc.) still bills
  for what was generated, but the *reason* often isn't surfaced (`status_details.reason` reported
  missing in logs per the livekit issue above) — you can undercount without realizing truncation
  happened.
- **Cached-token accounting inflating totals in ways that don't map to "the user's turn."**
  A reported cost anomaly thread: a 15-minute session showed cached-audio-input costs "corresponding
  to approximately 533 minutes of audio," and text input costs implying ~226,000 tokens against an
  estimated max of ~6,500 — explained by another poster as the Realtime API keeping server-side
  conversation history that gets **reprocessed (and re-cached-billed) every turn**, so the
  cumulative context grows and gets rebilled each response, not just the marginal new input —
  [OpenAI community: "Realtime API cost anomaly: disproportionate charges on audio
  input"](https://community.openai.com/t/realtime-api-cost-anomaly-disproportionate-charges-on-audio-input/1285295)
  (June–July 2025, marked unresolved as of 2025-07-09). This is the single most concrete trap found:
  naive per-turn summation without understanding the cache/context replay mechanics can be wildly
  wrong in either direction.
- **Session-level vs response-level totals: there is no session-level total from the server at
  all.** Usage only exists per-`response.done`; per the same community thread, "just look at `usage`
  in `response.done`... sum them up during the whole session" is the only method offered, i.e.
  **you** own the summation, OpenAI doesn't hand you a session total —
  [community: "Realtime API cost tracking per
  session"](https://community.openai.com/t/realtime-api-cost-tracking-per-session/1012802). Any gap
  in your event handling (crash, reconnect, dropped WebSocket message) is a silent gap in the total.
- **Out-of-band responses (`response.conversation: "none"`) still cost tokens.** These don't touch
  the visible conversation but still trigger "a separate inference pass" — [OpenAI Cookbook:
  transcribing user audio with a separate realtime
  request](https://cookbook.openai.com/examples/realtime_out_of_band_transcription) — so a tracker
  that only watches "real" conversation turns will miss background/transcription-only responses
  that still bill.
- **Interruptions / truncated audio:** I could not find an explicit OpenAI statement on whether
  audio truncated by `conversation.item.truncate` after a user interruption is still billed for the
  full generated length or only the played portion — this is a real ambiguity, not something I'm
  confident stating either way; flag it as unverified rather than guessing.
- **Idle-but-connected time is not itself billed** — "Realtime API does not bill you per a time
  unit, but for i/o tokens" — but there is a **15-minute idle connection limit** that forces
  reconnection strategies (e.g. splitting a call around a long hold) which themselves introduce
  session boundaries your ledger needs to stitch back together —
  [community: "Reduce Realtime API costs: handle long
  waits"](https://community.openai.com/t/reduce-realtime-api-costs-handle-long-waits/1025081)
  (Nov 2025 dates on the posts fetched).
- **The Realtime usage object is framed as estimation, not billing truth**, per the Azure-side docs
  quoted in §1 — so any tracker built purely on `response.done` should be treated as an *estimate*
  with a reconciliation step against real invoiced spend, not as the ledger of record.

## Recommendation (simplest viable, ranked)

1. **Server-side WebSocket + your own summation, no proxy, no admin key.** Have the browser talk to
   your Node server (or a thin serverless-unfriendly persistent relay you run, since Vercel
   functions can't hold a long-lived WebSocket well — this likely wants a small always-on process,
   e.g. a Fly/Render/Railway box or a Vercel Edge/Node function only if session length stays short)
   over WebSocket rather than raw browser WebRTC. Sum `usage` off every `response.done` (defensively
   — some may lack the nested breakdown), price it with §3's table, write one row per session (or
   per response, mirroring the OpenRouter ledger shape) to the existing Postgres ledger keyed by
   owner id. This is the smallest change: no new vendor, same ledger schema, and it sidesteps the
   admin-key question entirely. Tradeoff: it inherits every trap in §6 — treat totals as an estimate
   and consider a periodic manual spot-check against the OpenAI dashboard.

2. **LiteLLM proxy in front of the Realtime WebSocket.** Self-hosted, open source, has a named
   release specifically adding Realtime cost tracking with key/user/team budgets. Gets you
   per-key/per-user attribution "for free" plus a lot of provider-agnostic plumbing you might reuse
   later. Tradeoff: another moving part to run and keep patched (a persistent process, not
   serverless-native), and its Realtime support is WebSocket-only like everything else here — still
   requires giving up raw browser WebRTC.

3. **Add the OpenAI Admin API as a reconciliation cross-check, not as the primary mechanism.**
   Whichever of the above you pick, optionally poll `/v1/organization/costs` (daily, by project/API
   key) on a schedule and diff it against your ledger's daily totals to catch systematic
   under-reporting from §6's traps. This is the "nicety" the owner hoped to avoid, and it's fine to
   skip initially — but it's cheap to add later and is the only way to know your estimate-based
   ledger isn't drifting from real spend.

Not recommended as a first move: keeping raw browser **WebRTC** and trusting a client-reported total
— it's the least trustworthy of the options surveyed (§2) and none of the third-party tools in §5
were found to support that topology either, so you'd be building custom trust-nothing plumbing with
no ecosystem support.
