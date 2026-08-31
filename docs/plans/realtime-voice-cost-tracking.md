# Cost-tracking for Live Conversations

**Status: decided, not built.** There is no voice-dialogue feature yet — this is the accounting
decision made before it lands, so that the first version does not ship with a hole in the ledger and
a plan to fix it later.

> One option would be to set up an OpenAI admin key, but I'm hoping there's a simpler way.
>
> — Greg, 2026-08-31

There is. The Realtime API tells you what each response cost; the difficulty is not getting the
number, it is being somewhere that can hear it.

## What this breaks

[ai-gateway.md](../project/ai-gateway.md) opens with a claim that has been true since 2026-08-27:
**every paid model call goes through OpenRouter, and every one is recorded.** OpenRouter does not
proxy the Realtime API. So Live Conversations is the first paid call in the *product* — not in
`evals/` — that has to go somewhere else, and the sentence stops being true the day it ships.

That is the real cost of this feature, and it is worth saying out loud rather than discovering it in
a diff: a third provider account, a fourth wire, and an architectural rule that has to be restated
rather than quietly broken.

## The decision

**The browser reports its own usage, and the ledger says so.**

> we'll just use the browser to report itself for now (documenting this as untrustworthy, but good
> enough for an Alpha version)
>
> — Greg, 2026-08-31

**No admin key for Alpha.** Not in Vercel, not on the laptop. The ledger is labelled unreconciled
and nobody pretends otherwise.

GPT Sol arrived at the same architecture independently, and *not* as a fallback — it recommended
browser reporting even on the assumption that a persistent host was available, on the grounds that
cost tracking alone does not justify another deployment, another availability boundary and audio
transport work on a reading experiment. Both halves of that agreement are in
[realtime-voice-cost-tracking-sol.md](realtime-voice-cost-tracking-sol.md).

## Why "untrustworthy" is the wrong word for the risk

Nobody is going to lie. [security-map.md](../project/security-map.md) counts four untrusted parties
and then says plainly that *"whoever signs in is a fifth party and is not untrusted"*; a reader has
no incentive to under-report their own token count, and there is no per-reader spend cap to duck
under.

**What will actually happen is that the tab closes.** A reader ends a conversation by shutting the
laptop, and a report that fires once at the end never fires at all. That is not an attack, it is the
ordinary case, and it is the [silent success](../reusable/silent-success.md) shape this repo keeps
getting bitten by — the ledger looks healthy and is short by an unknown amount.

So the design is not "trust the client". It is **make the untrustworthy thing as small as
possible**:

- **Post every `response.done` immediately**, not one total at the end. A lost session then costs
  one turn instead of all of them.
- **An IndexedDB outbox** holding unacknowledged events until the server acks, so a reload or a
  dropped network recovers instead of losing the turn.
- **`response.id` as the idempotency key**, so replaying the outbox cannot double-count.
- **`sendBeacon` on `pagehide` is a hint, not the mechanism.**
- **The endpoint accepts a narrow projection only** — provider response id, status, token counts,
  sequence number. Owner, article, model and price come from the server's own session row. It must
  never accept a client-supplied dollar amount.
- **A session row exists before the call does**, so a conversation that opened and reported nothing
  is *visible as a gap* rather than absent — the move `unscopedCalls()` already makes.

## What the numbers actually are

`response.done` carries `usage`: `input_tokens` / `output_tokens`, plus `input_token_details`
splitting text / audio / image and a nested `cached_tokens_details`, plus `output_token_details`.
Per *response*, not per session — you sum it yourself. Azure's mirror of the docs calls it
"estimation only, not for billing reconciliation", which maps exactly onto our existing
`CostSource: "computed"`.

Two things that are easy to miss:

- **Input transcription is a second billable operation**, on a different model with its own rate
  card, reported on `conversation.item.input_audio_transcription.completed` — **not** on
  `response.done`. Track only the latter and a whole cost line is silently missing.
- **An idle connection is not billed for being open.** But an idle *timeout* can itself trigger a
  response, so an idle session can still spend.

Text and audio tokens are priced roughly 80x apart (audio in/out $32/$64 per 1M against text
$4/$16-24; cached audio $0.40). A single cached total therefore cannot be priced, which is the same
argument that produced `cacheWrite5mTokens` / `cacheWrite1hTokens`.

## The shape in the ledger

Sol's, and the reasoning is in its review. In outline:

- `Wire` gains `"realtime"`; `ProviderAccount` gains `"openai"`; `AiJob` gains `"live_conversation"`.
- **Not a `spend-declarations.ts` entry.** *"A permanent product feature is not an admitted
  bypass."* Make it a third first-class seam (`src/realtime-spend.ts`) and restate the rule: every
  paid operation goes through one of three owned seams — OpenRouter owns messages/chat/embeddings,
  OpenAI owns realtime. Declarations stay for evals.
- **One `ai_calls` row per response**, not one per session, plus one per paid transcription, under a
  durable `realtime_sessions` parent. A session aggregate hides missing turns and duplicate delivery.
- `costNanos = null`, `computedCostNanos` set, `costSource = "computed"`, `providerAccount =
  "openai"`.
- **A new `usageSource: "client_report" | "sideband"`.** `CostSource` says who did the arithmetic; it
  does not say whether the numbers were observed or supplied by a browser. This is also the field
  that lets a sideband be swapped in later without a schema change.
- `ms` means one response, `response.created` → `response.done`, and stays nullable when the start
  was not observed. A reader closing a tab is a **session** close condition, not a response outcome —
  do not label an in-flight response "aborted" without a terminal event.

`beginSpend` and `recordSpend` do not stretch to cover this: they hold the pending call in an
in-memory Map inside the AsyncLocalStorage scope (`src/ai-spend.ts:495`), which cannot survive a
conversation spanning many Vercel invocations. That limitation is already written down honestly in
`src/ai-spend.ts` — *"if the process dies, this dies with it"* — and realtime is the case that makes
it bite. Realtime needs its own durable lifecycle: `beginRealtimeSession` committing before OpenAI
creates the call, then idempotent `recordRealtimeResponse` / `recordRealtimeTranscription` /
`closeRealtimeSession`.

## What we are giving up, precisely

There is **no poll-after-the-fact shortcut** — confirmed three ways in
[realtime-voice-vercel-transport.md](../research/realtime-voice-vercel-transport.md): the Realtime
Calls resource has only Create/Accept/Hangup/Refer/Reject and no Retrieve or List; the sideband docs
describe a live listener; the Admin Usage category list has no Realtime bucket. A server hears the
usage events or it does not; it cannot ask afterwards.

And `response.done` is **not signed** — no HMAC, no forgery-resistant token. Server-side wall-clock
session duration is free and catches wildly implausible claims, but gpt-realtime is priced per token,
so it will not catch a precisely wrong one.

The Admin API would not have fixed attribution anyway: Usage is minute-bucketed, Costs is daily, and
neither groups by session or response id. It is a reconciliation instrument, not an attribution one.
**If it is ever added**, give Live Conversations its own OpenAI project and API key first, or the
gap includes unrelated traffic and becomes a check nobody runs. One thing to probe before depending
on it: the docs do not actually promise that `gpt-realtime` calls appear in
`/organization/usage/completions` at all.

## The options we did not take, for when Alpha ends

Kept because the answer changed once already during this research, and will again.
[realtime-voice-vercel-transport.md](../research/realtime-voice-vercel-transport.md) has the sources
and dates.

| Option | What it buys | What it costs |
| --- | --- | --- |
| **Sideband in a Vercel Function** | Server-observed usage, no new host. Functions hold WebSockets (beta, 2026-06-22); Fluid Compute bills Active CPU, so a mostly-idle listener is cheap; 800s GA on Pro would fit a conversation capped at ~12 min | Two betas, and the *outbound* WebSocket case is an inference from the runtime model, not a documented one. Prove it with a throwaway spike before believing it |
| **Vercel AI Gateway realtime** | Vercel becomes the always-on relay; simplest thing to build | A second gateway beside OpenRouter, against the one-vendor rule. Beta, 25-min cap. Numbers land in Vercel's observability, **not** our ledger, so `npm run cost` still cannot see them |
| **Always-on host** (Fly/Railway/Render) holding the sideband | Fully trustworthy, most control | A new service to operate, ~$5-25/mo, and reconnect logic |
| **Cloudflare Durable Objects** | Built for long-lived stateful connections | No documented usage-tracking story for this pattern |
| **Server-side WebSocket relay** | Trusted observation | Puts audio transport, backpressure and latency in our infrastructure. Wrong default for a browser voice feature |

Third-party tooling was surveyed and is mostly a dead end: **LangFuse says it does not support
Realtime**, Helicone's realtime integration is marked no-longer-actively-developed, and only
**LiteLLM** has a shipped, named Realtime cost-tracking release. All are WebSocket-proxy-shaped and
none handle browser WebRTC, so none of them solve the problem we actually have.

## See also

- [realtime-voice-cost-tracking-sol.md](realtime-voice-cost-tracking-sol.md) — the GPT Sol design
  review, and the prompt it answered
- [realtime-voice-cost-tracking-web.md](../research/realtime-voice-cost-tracking-web.md) — what the
  API emits, pricing, the third-party survey, the traps
- [realtime-voice-vercel-transport.md](../research/realtime-voice-vercel-transport.md) — why there is
  no poll-afterwards, and what Vercel can and cannot hold open
- [ai-gateway.md](../project/ai-gateway.md) — the rule this feature has to restate
- [ai-cost-tracking.md](ai-cost-tracking.md) — the ledger this has to fit
- [ai-spend-outside-the-gateway.md](ai-spend-outside-the-gateway.md) — the declared-bypass register,
  and why this is deliberately not one
