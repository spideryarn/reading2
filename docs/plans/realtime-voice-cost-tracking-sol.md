# Where I disagree with the framing

Two points have changed in the current OpenAI documentation.

First, the choice is not only “browser WebRTC or relay all audio through a server.” OpenAI now supports a server-side **sideband WebSocket** attached to the same browser WebRTC call. The browser keeps the low-latency media path, while the server receives the session events, including `response.done`. It is a much better trusted-observer design than an audio relay. It still needs a process that lives for the conversation, so it does not solve Vercel’s serverless constraint. [OpenAI’s server-controls guide](https://developers.openai.com/api/docs/guides/realtime-server-controls).

Second, an idle connection is not presently billed merely for being open. OpenAI says Realtime conversation cost accrues when a Response is created; bandwidth and connections currently have no charge. An idle timeout can itself trigger a Response, though, so an “idle” session can spend money depending on its configuration. [OpenAI’s Realtime cost guide](https://developers.openai.com/api/docs/guides/realtime-costs).

There is also a separate cost you have not mentioned: if input transcription is enabled, it uses another model, has another rate card, and reports usage on `conversation.item.input_audio_transcription.completed`, not `response.done`. That must be tracked as a second billable operation.

# Recommendation

I would ship:

1. Browser-to-OpenAI WebRTC for audio.
2. Session creation through the server-side unified `/v1/realtime/calls` interface.
3. A durable server session row created before that call.
4. Immediate, per-event client reporting of every `response.created`, `response.done`, and paid transcription-completion event.
5. OpenAI Admin API reconciliation at the project/API-key aggregate level.

I would not introduce a persistent host or relay merely to improve accounting. It adds another deployment, another availability boundary, more latency, and audio transport work to a reading experiment. OpenAI itself recommends WebRTC for browser voice clients. [WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc).

Use the unified session-creation interface rather than minting a client secret if practical. The browser sends its SDP offer to a short Vercel request; the server adds the fixed session configuration and authenticates to OpenAI; OpenAI returns the SDP answer and a `Location` header containing the call ID. That lets the server bind the OpenAI call ID to the authenticated reader before the media connection starts, without exposing even an ephemeral bearer token.

The client report remains untrusted. Signing a report token can prove “this report belongs to the session we issued to Greg”; it cannot prove “these are the tokens OpenAI billed.” Therefore:

- It is good enough for per-reader product analytics and estimated spend.
- It is not good enough to invoice readers or enforce a hard monetary limit against a hostile client.
- Aggregate reconciliation is what tells you whether the ledger as a whole is complete.
- It cannot normally tell you which of several concurrent readers caused a reconciliation gap.

If hard, adversarial per-reader enforcement is required at launch, use WebRTC plus OpenAI’s sideband connection on a small persistent host. Do not proxy the audio: attach only the server event/control channel. That gives you server-observed per-response usage while preserving the direct media path.

# Weighing the options

## Browser WebRTC plus client-reported usage

This is the best first product architecture and the weakest accounting authority.

Do not have the client post one total when the conversation ends. Post every `response.done` immediately and retain it in a small IndexedDB outbox until the server acknowledges it. Use `response.id` as an idempotency key. A final `sendBeacon` can be an extra hint, but not the mechanism.

The reporting endpoint should accept only a narrow event projection: provider response/event ID, provider status, token fields, and sequence number. It should derive the owner, article, requested model, price, and permitted transcription model from the server’s session row. Never accept a client-supplied dollar amount.

This survives ordinary reloads and transient network failures reasonably well. It does not survive a malicious client deliberately omitting or altering events.

## WebRTC plus Admin API reconciliation

This is what I would ship.

The Usage API provides one-minute buckets and can group by project, API key, model and other dimensions. Its completion result now exposes uncached and cached text/audio/image token splits plus `num_model_requests`. The Costs endpoint is coarser: daily buckets, grouped by project, API key, or invoice line item. [Usage endpoint](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions), [Costs endpoint](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs).

Create a dedicated OpenAI project and API key for Live Conversations. Otherwise a reconciliation gap includes unrelated OpenAI traffic and immediately becomes a check people ignore.

One uncertainty needs a live probe: the current Usage schema is clearly capable of representing Realtime audio usage, but the official page does not plainly promise that every `gpt-realtime` call appears in `/organization/usage/completions`. Before depending on it, run one isolated session, note its API key, model and minute, then poll Usage and Costs until it appears.

## Server-side WebSocket relay

This gives trusted event observation, but it is the wrong default architecture for a browser voice feature on Vercel.

It moves audio transport, backpressure, reconnection, bandwidth and latency into your infrastructure. It also requires a persistent host. I would choose it only if the server already needed to own the audio stream for another product reason.

## WebRTC plus sideband

This is the strongest later architecture.

The server attaches to the browser’s existing OpenAI call by call ID and receives the same server event stream without relaying audio. It also provides a natural home for private tools and server-controlled cancellation. [OpenAI’s sideband design](https://developers.openai.com/api/docs/guides/realtime-server-controls).

Its remaining cost is operational: every active conversation still pins a WebSocket on a long-running service. If Live Conversations later needs server-side article tools, strict budgets, moderation or authoritative attribution, that combined need would justify the host. Cost tracking alone does not.

# Is the admin key avoidable?

Yes for the feature and for estimated per-reader attribution. No for automated, provider-side confirmation that direct-WebRTC reports are complete.

A normal project API key is sufficient to create Realtime calls. The elevated Admin key is needed only to query organization Usage and Costs. I found no documented project-key alternative for those endpoints.

The Admin API does not solve per-conversation attribution:

- Usage is bucketed, with one minute as its finest documented interval.
- Costs is daily.
- Neither endpoint groups by Realtime session ID or response ID.
- Concurrent sessions sharing a key cannot be separated reliably by timestamps.
- Although Usage supports a `user_id` grouping, the official docs do not establish that Realtime’s `OpenAI-Safety-Identifier` becomes that field. I would assume it does not until a live probe proves otherwise; the safety identifier is documented as an abuse signal, not billing metadata.

Issuing one OpenAI key or project per reader would make Admin attribution possible, but it is absurd operationally and would itself require administrative provisioning.

So the Admin key is a **reconciliation necessity**, not an attribution mechanism. A practical staging is:

- Early private beta: client reports plus a manual comparison with the OpenAI dashboard, visibly labelled unreconciled.
- Before using the figures for pricing or limits: automated aggregate reconciliation.
- If Greg dislikes placing an Admin key in Vercel, keep it local and make reconciliation an explicit CLI operation. That is still much simpler than operating a WebSocket host.
- Workload-identity tokens may eventually remove the long-lived admin secret, but current official documentation does not establish a simple Vercel-specific route or its authorization for Usage/Costs. I would not call that the simpler option without checking the account’s current capabilities.

# How it should fit the existing ledger

## Types and first-class seam

Add:

```ts
Wire = "messages" | "chat" | "embeddings" | "realtime"
ProviderAccount = "openrouter" | "anthropic" | "openai"
AiJob += "live_conversation"
```

`"realtime"` is a genuinely different event and usage contract, so it deserves a wire.

This should not be a declaration in [spend-declarations.ts](/home/greg/code/spideryarn2/src/spend-declarations.ts:1). A permanent product feature is not an admitted bypass. Make it a third first-class spending seam, perhaps `src/realtime-spend.ts`, and change the architectural rule to:

> Every paid operation passes through one of the three owned seams. OpenRouter owns messages/chat/embeddings; OpenAI owns Realtime.

Keep declarations for exceptional evals. Strengthen the static check so only the new seam may use the standard OpenAI credential or create Realtime calls.

## One row per billable event, plus one session parent

Do not write one aggregate `SpendRecord` per session. `response.done.usage` is per Response, and OpenAI bills each Response using the conversation context presented on that turn. Later turns legitimately include repeated, often cached, earlier context. A session aggregate hides missing turns, duplicate delivery, out-of-band calls, changing status and different models.

Use:

- One durable `realtime_sessions` row per conversation.
- One `ai_calls` row per Realtime Response.
- One additional `ai_calls` row per paid input-transcription completion, if transcription is enabled.

The parent session should carry the internal session ID, owner, article/thread, OpenAI call/session ID, requested model, created/connected/last-seen/closed timestamps, close reason, report source, and counts of responses started and completed. Do not store audio, transcripts, or raw provider events in the financial ledger.

Add a nullable `realtime_session_id` and a unique `provider_response_id` or `provider_event_id` to `ai_calls`. Do not overload `generationId`, whose present meaning is specifically OpenRouter’s generation handle.

## `beginSpend` and `recordSpend`

Do not try to hold the current AsyncLocalStorage collector open for five minutes. The session initializer, each client report, and eventual stale-session sweep are separate serverless invocations.

Give Realtime an explicit durable lifecycle:

```ts
beginRealtimeSession(...)
recordRealtimeResponse(sessionId, event)
recordRealtimeTranscription(sessionId, event)
closeRealtimeSession(sessionId, reason)
```

`beginRealtimeSession` must commit its row before OpenAI creates the call. The later record functions should be idempotent transactions keyed by provider event/response ID.

This is also a place where the current “row ID minted before the request” guarantee is weaker than it sounds: [beginSpend](/home/greg/code/spideryarn2/src/ai-spend.ts:495) currently keeps the pending call in process memory and writes only on completion. That cannot protect a WebRTC session across Vercel invocations. The session parent must actually be durable.

## Cost and token columns

OpenAI returns usage, not a dollar figure. Therefore these rows should have:

- `costNanos = null`
- `computedCostNanos = calculated value`
- `priceVersion = checked-date/effective-date`
- `costSource = "computed"`
- `providerAccount = "openai"`

Do not distribute a daily Admin cost back over individual rows and call it provider-reported cost. The Admin figure is aggregate evidence and belongs in a reconciliation result, not in a per-response field.

Yes, add modality columns. At minimum:

- input text, audio and image tokens
- cached input text, audio and image tokens
- output text, audio and image tokens
- reported input/output totals

The current `cacheReadTokens` can retain the provider’s total cached count, but it is insufficient for pricing. OpenAI’s event explicitly nests `cached_tokens_details` by modality. Current `gpt-realtime` prices, for example, distinguish text, cached input, and audio materially. [Model pricing](https://developers.openai.com/api/docs/models/gpt-realtime).

Preserve the provider’s raw totals and compute uncached tokens as:

```text
uncached modality = modality input total − cached modality input
```

If the detailed split is missing, write a row with the top-level usage but leave computed cost null and count it as unpriced. Do not guess a text/audio ratio.

Also add a field such as:

```ts
usageSource: "client_report" | "sideband"
```

`CostSource` says who performed the arithmetic. It does not say whether the underlying usage numbers were directly observed or supplied by an untrusted browser.

## Duration and outcome

`ms` should describe one Response, from `response.created` to `response.done`, when both were observed. It must not suddenly mean whole-session duration on this wire. Make it nullable if the start was not observed.

Preserve the provider status separately. The present three outcomes are too small:

- `completed` → `ok`
- `failed` → `error`
- `cancelled` → `aborted`
- `incomplete` deserves `incomplete`, not an invented error or abort
- a response known to have started but never finished deserves `unknown`

A reader closing a tab is a **session close condition**, not a Response outcome. Mark the session stale/peer-disconnected after its heartbeat expires. Do not label an in-flight model response “aborted” unless a cancellation or terminal event was actually observed.

# Silent under-reporting and checks that catch it

## Abrupt disconnect before `response.done`

Record `response.created` immediately, then finalize it on `response.done`. A stale session with more started than completed responses becomes visibly incomplete.

That still misses a client which reported neither event. The independent check is aggregate Admin Usage: provider `num_model_requests` and modal token totals versus ledger rows for the dedicated project/key.

## Interrupted or truncated speech

Record usage from every `response.done`, regardless of whether status is completed, cancelled or incomplete. Never estimate billed output from how much audio the browser played. With WebRTC, OpenAI automatically truncates unplayed conversation audio after interruption, but the documentation does not clearly state the exact billing boundary for already-generated audio.

The meaningful check is a live canary: trigger a long response, interrupt it deliberately, confirm that a non-completed row with nonzero usage appears, then confirm the project’s Admin Usage delta. That exercises provider billing, not merely your parser.

## Idle sessions

An open connection alone currently costs nothing. The failure is an idle-timeout configuration that creates automatic Responses.

Set a server-owned session expiry and maximum wall-clock duration. Either disable model idle prompts or allow them intentionally. Operationally flag any response generated without a preceding reader speech event or explicit application `response.create`; reconcile its model-request count against Admin Usage.

## Cached audio tokens

Store `cached_tokens_details.audio_tokens`; do not fold it into text or ordinary audio input. Check the invariant that cached modality components sum to the reported cached total, while allowing unknown future fields to make the equality temporarily incomplete rather than false.

The independent check is Admin Usage’s `input_cached_audio_tokens` for the dedicated Realtime key versus the ledger’s cached-audio sum.

## Out-of-band and automatic responses

Record every `response.done`, including `conversation: "none"` and responses with unfamiliar metadata. Metadata classifies the purpose; it must never decide whether an event counts.

Compare `num_model_requests` in Admin Usage with the number of main-model response rows. This catches forgotten out-of-band classifiers, automatic VAD responses and new code paths.

## Input transcription

If enabled, require one transcription usage record for each `conversation.item.input_audio_transcription.completed` carrying usage. Price it under the transcription model, not the Realtime model.

Reconcile Admin Usage grouped by model. A transcriber model with provider usage and zero local rows is an unambiguous missing path.

## Client never reports

Every server-issued call has a durable session row. Track issued, connected, first-report, last-report and close times separately. A connected session with no reports is not counted as free; it is “usage unknown.”

Use an acknowledged client outbox for honest failures. Only aggregate Admin reconciliation catches deliberate omission. Without sideband, there is no reliable way to assign that aggregate gap back to one of several concurrent readers.

## Detailed token fields disappear

Accept the event, store the provider response ID, top-level totals and status, but leave cost null. Alert on unpriced Realtime rows and on any newly observed schema shape. This is better than silently pricing every unknown token as text.

## Duplicate reports

Put a unique constraint on provider response/event ID and make reporting idempotent. Otherwise an outbox retry fixes under-reporting by creating over-reporting.

## Ledger writes vanish on Vercel

A report is acknowledged only after the database transaction commits. Never fire-and-forget the insert. Track rejected report writes and compare client sequence numbers so a missing event creates a gap rather than a short, plausible total.

# Third-party tools

The honest answer for the proposed browser-WebRTC topology is: **none; write the narrow integration yourself**.

The existing research found:

- LiteLLM has explicit Realtime cost tracking and budgets, but for a WebSocket proxy. It is a persistent Python service, not a type-safe TypeScript library living inside Vercel.
- Helicone’s older Realtime integration is a WebSocket proxy and is now maintained rather than actively developed.
- Portkey documents Realtime WebSocket token/cost parsing, again as a proxy.
- Langfuse does not automatically instrument Realtime; manual tracing puts you back where you started.
- Generic metering systems can be sinks after you calculate usage, but do not observe direct WebRTC provider events.

The evidence and vendor links are collected in [realtime-voice-cost-tracking-web.md](/home/greg/code/spideryarn2/docs/research/realtime-voice-cost-tracking-web.md:180).

All credible gateways change the topology to WebSocket and require a long-lived intermediary. None removes the trust boundary while preserving browser-to-OpenAI WebRTC on Vercel. If you later decide to operate such a proxy anyway, LiteLLM is the first one I would spike. For this feature today, it fails too many of your stated criteria.

“About 200 lines” is plausible for parsing and pricing the provider events. The durable session journal, client outbox, idempotency, reconciliation and anomaly checks are additional work—but a third-party proxy does not eliminate those under direct WebRTC.