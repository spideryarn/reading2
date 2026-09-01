# Can Vercel hold a long-lived connection to the OpenAI Realtime API?

Research done 2026-08-31. Companion to
[realtime-voice-cost-tracking-web.md](realtime-voice-cost-tracking-web.md), which covers *how* to
turn `response.done` usage into a ledger row once you have a server-side event stream. This doc asks
the prior question: can a Vercel-hosted app get that server-side stream at all, given Vercel's
execution model, and is there a shortcut (poll after the call) that avoids needing one.

## 1. Vercel Functions' current duration limits

Per Vercel's own docs (`/docs/functions/configuring-functions/duration`, page dated 2026-08-24):
with **Fluid Compute** (the execution model, default for it in the table below):

| Plan | Default | Maximum (GA) | Extended maximum (beta) |
|---|---|---|---|
| Hobby | 300s | 300s | — |
| Pro | 300s | 800s | 1800s (30 min) |
| Enterprise | 300s | 800s | 1800s (30 min) |

800s is GA for Pro/Enterprise. The 30-minute figure is a beta, per-function opt-in (not a project
default yet), restricted to `nodejs20.x`/`22.x`/`24.x`, Bun `1.x`/`1.4.x`, `python3.12`–`3.14`, and
explicitly **not** supported together with Secure Compute or Static IPs during the beta. Vercel
announced the 30-minute ceiling in a changelog post dated **2026-06-15**
([Vercel Functions can now run up to 30 minutes](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)).

**Fluid Compute is the default for new projects created on or after 2026-04-23** (stated on the
WebSockets doc, below); under it, billing is "Active CPU" — charged while your code is executing,
paused while it's waiting on I/O (e.g. blocked on a socket read) — which matters a lot for a
mostly-idle relay connection. I could not verify the precise mechanics of `waitUntil()` interacting
with the duration cap beyond what the docs state about HTTP/2 idle keep-alives (Vercel sends PING
frames to hold a streaming HTTP/2 response open; HTTP/1.1 has no such frame, so idle HTTP/1.1
connections may still be dropped by intermediaries) — I'm flagging this as unverified rather than
guessing further.

For anything with no fixed ceiling at all, Vercel points to **Vercel Workflows** ("pause, resume,
and maintain state for minutes to months"), a different product from Functions.

## 2. Can a Vercel Function hold a WebSocket — inbound or outbound?

Yes, as of a **public beta announced 2026-06-22**
([WebSocket support is now in Public Beta](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)),
Vercel Functions can serve *inbound* WebSocket connections (`/docs/functions/websockets`, dated
2026-08-10): standard `ws`/Socket.IO/Bun-native/Nitro code, no special API needed. But the
connection is a function invocation — it **inherits the function's `maxDuration`** and is force-closed
when that expires ("WebSocket connections close when a Vercel Function reaches its maximum
duration"), so the client must reconnect. A connection is also pinned to one function instance;
reconnects aren't guaranteed to land on the same instance, so any state has to live in an external
store (Vercel suggests Redis).

The docs don't separately discuss *outbound* connections (your function calling out to `wss://` on
another host), but there's nothing in the runtime model that would forbid it — a Vercel Function on
Fluid Compute is a real Node.js process for the life of the invocation, and an outbound `ws` client
is just normal Node.js code, bound by the same `maxDuration`. I did **not** find an explicit Vercel
statement confirming this scenario works for a sideband connection specifically — treat it as a
reasonable inference from the general runtime docs, not a verified claim.

Two more relevant Vercel products surfaced:

- **Vercel Sandbox** — a separate, longer-lived compute environment. Vercel's own Knowledge Base
  guide, "[How to build an on-demand voice agent with Vercel
  Sandbox](https://vercel.com/kb/guide/how-to-build-an-on-demand-voice-agent-with-vercel-sandbox),"
  states plainly: "Unlike Functions, which are designed for request-response patterns and have
  strict execution time limits, sandboxes can maintain websocket connections and run processes for
  extended periods." The example config uses a 10-minute timeout (`SANDBOX_TIMEOUT=600000`), but I
  could not find a documented hard ceiling from Vercel's own pages. Pricing (per secondary sources,
  not independently confirmed against Vercel's own pricing page): Active-CPU billed, ~$0.128/hour on
  Pro, same model as Functions, plus provisioned memory for the sandbox's whole lifetime.
- **Vercel AI Gateway's realtime proxy** — announced in beta on **2026-06-29**
  ([blog](https://vercel.com/blog/realtime-voice-agents-on-ai-gateway),
  [docs](https://vercel.com/docs/ai-gateway/modalities/realtime), docs dated 2026-08-24). Here the
  browser opens a WebSocket to *Vercel's* gateway, not to OpenAI — your server only mints a
  short-lived token. Vercel enforces a **25-minute max session, 5-minute idle timeout, 30s to send
  the first client message**, and states usage/cost show up in AI Gateway's own observability and
  spend controls "like every other model call." This effectively makes Vercel the always-on relay,
  so *you* don't run or pay for a separate process — but it ties the voice feature to Vercel's
  gateway as a paid intermediary (this project currently routes all other paid calls through
  OpenRouter, not Vercel AI Gateway, so adopting it adds a second gateway convention), and it's beta.

## 3. Does the sideband pattern need a persistent connection, or can you poll afterward?

**No poll-after-the-fact endpoint exists. This is the key finding.** Confirmed three independent
ways, all fetched today (2026-08-31):

1. **The doc's own mechanics are a live listener, not a query.** OpenAI's "Webhooks and server-side
   controls" guide (`developers.openai.com/api/docs/guides/realtime-server-controls`) has the server
   open `wss://api.openai.com/v1/realtime?call_id=rtc_xxxxx` and attach a `ws.on('message', …)`
   handler — a live event stream. For the SIP variant it says outright: **"The WebSocket connection
   will live for the life of the SIP call."** Nothing in the doc suggests the connection can detach
   and later re-query what it missed.
2. **The official API reference has no `Retrieve`/`List` operation for Realtime Calls.** I pulled the
   live API reference navigation directly: under Realtime → Calls, the only operations are *Create a
   call, Accept, Hangup, Refer, Reject*. Compare this to almost every other resource in the same
   reference (Responses, Conversations, Batches, Evals, …), which all have a `Retrieve` and usually a
   `List`. The absence is conspicuous and consistent with there being no way to ask "what happened on
   this call" after it ends.
3. **The Admin Usage API has no dedicated Realtime category** in that same reference sidebar — the
   listed categories are Audio Speeches, Audio Transcriptions, Code Interpreter Sessions,
   Completions, Costs, Embeddings, File Search Calls, Images, Moderations, Vector Stores, Web Search
   Calls. I could not determine which bucket (if any) Realtime token usage rolls into for org-wide
   Usage/Costs reporting — flagging this as unverified and worth testing directly against a real
   organization's data, since it affects the reconciliation option in §5.
4. Corroborating community evidence: an OpenAI Developer Community thread, "[Realtime API cost
   tracking per session](https://community.openai.com/t/realtime-api-cost-tracking-per-session/1012802)"
   (Nov 2024), gives the only offered method as summing `response.done.usage` live during the
   session — dated, but consistent with what today's live docs still show.

So: a server must hold its connection open for the **entire** call to see every `response.done`; a
short "attach, snapshot, detach" pattern is not supported by anything documented.

## 4. Workaround patterns people actually use

- **Vercel (frontend) + a small always-on host elsewhere** for anything needing a persistent
  connection — Fly.io, Railway, or Render are the names that come up repeatedly in general
  Vercel-limitations comparisons (secondary/aggregator sources, not Vercel's own docs, so weight
  accordingly). This is the generic "Vercel can't hold sockets, so put that part elsewhere" pattern.
- **LiveKit** — OpenAI and LiveKit have a documented partnership
  ([blog.livekit.io](https://blog.livekit.io/openai-livekit-partnership-advanced-voice-realtime-api/))
  for running the Realtime API behind LiveKit's own media server, with an "agent" process holding the
  actual OpenAI connection server-side while the browser talks WebRTC to LiveKit. This is the
  heaviest but most production-proven pattern found.
- **Cloudflare** — Cloudflare's AI Gateway now proxies realtime WebSocket sessions for OpenAI (and
  Gemini Live, ElevenLabs, others) at `wss://gateway.ai.cloudflare.com/...`
  ([docs](https://developers.cloudflare.com/ai-gateway/usage/websockets-api/realtime-api/), dated
  2026-04-20) — but that page says nothing about per-session usage/cost visibility, so I could not
  confirm it solves the trust problem, only the transport problem. Separately, Cloudflare has blogged
  about Durable Objects as the natural home for this kind of long-lived, stateful connection
  (`@cloudflare/voice` running on a Durable Object), which architecturally fits, though I did not
  fetch that blog post directly and cannot cite specifics.
- **Vercel's own answers** — Vercel Sandbox (per-call ephemeral compute) and the AI Gateway realtime
  proxy (§2) are Vercel's two first-party ways to avoid the Functions duration cap, both new in 2026.
- I found **no documented pattern** of a short-lived serverless function reconnecting to the sideband
  every few minutes to stay under the duration cap while not missing events — and given §3's finding
  that the connection must be continuous, such a scheme would risk silently dropping `response.done`
  events during the reconnect gap, undermining the whole point.

## 5. Can client-reported usage be made less untrustworthy?

I found **no evidence** that `response.done`'s `usage` object is signed or otherwise
client-unforgeable — nothing in OpenAI's docs, the API reference, or community discussion mentions a
signature, HMAC, or verifiable token tied to that event. (SIP webhooks *are* signed —
`webhook-signature` — but that's a different, OpenAI-initiated mechanism unrelated to a client's
self-report.) The only mitigations found in official material:

- **Org-wide aggregate reconciliation**, days later, at daily × project × API-key granularity via
  `/v1/organization/costs` — coarse, and (per §3) it's unconfirmed whether Realtime usage is even
  broken out distinctly there.
- **Wall-clock session duration** is knowable server-side for free (start/end of even a brief
  connection), giving a sanity check against a client's claimed token count — but gpt-realtime is
  priced per token, not per minute, so this only catches wildly implausible claims, not a precisely
  under-reported bill.

Honest answer: without a persistent server-side connection (sideband or WebSocket), it's just trust,
with a slow, coarse, unconfirmed reconciliation path as the only backstop.

## Ranked options, with what new thing you'd have to run and pay for

1. **Own a small always-on process holding the sideband** (Fly.io/Railway/Render, ~$5–25/mo) —
   most control, fully trustworthy, but a new service to operate and keep reconnect-safe.
2. **LiveKit** (Cloud or self-hosted) — heaviest but most proven; pay LiveKit Cloud usage or host
   LiveKit server yourself; buys you WebRTC media handling and reconnection logic you'd otherwise
   build by hand.
3. **Cloudflare Workers/Durable Objects** as the relay/sideband host — no separate box to run
   (pay Cloudflare Workers/DO usage instead); architecturally a good fit for long-lived stateful
   connections, but I could not confirm a documented usage-tracking story specific to this pattern.
4. **Vercel AI Gateway realtime proxy (beta)** — no new infrastructure at all beyond Vercel itself;
   trades that for a 25-minute session cap, beta status, and a second AI-gateway convention alongside
   this project's existing OpenRouter routing.
5. **Vercel Sandbox per call** — stays inside the Vercel product family; pay per-sandbox Active CPU
   and provisioned memory; less battle-tested for voice specifically than LiveKit or a plain always-on
   box, and I couldn't verify its hard duration ceiling.
6. **Trust the browser's self-report, no persistent connection** — zero new infrastructure or cost,
   but zero verifiability beyond the slow, coarse reconciliation in §5; reasonable only as an interim
   step or for low-risk (trusted-user) deployments.
