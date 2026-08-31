# Cost-tracking for Live Conversations (OpenAI Realtime API) — design review

You are reviewing a **design question**, not a diff. Be concrete and opinionated, and say
plainly where you are uncertain or where you'd need to check OpenAI's current docs.

## The app

Spideryarn: a TypeScript + ESM, Node + React reading app, deployed on Vercel (serverless
functions), Postgres (Supabase) for data, Drizzle for queries. It reads articles and lets the
reader chat with an AI about the passage they are on.

## The cost-tracking machinery that already exists

Since 2026-08-27 **every paid model call goes through OpenRouter**, over one of two seams:

- `src/messages-stream.ts` — Anthropic's `messages` wire
- `src/ai-call.ts` — OpenAI's `chat/completions` wire (plus `embeddings`)

`export type Wire = "messages" | "chat" | "embeddings"` (`src/models.ts:465`).

Both seams call into `src/ai-spend.ts`, which owns:

- `beginSpend(job, model)` → mints a `rowId` **before the request goes out**, returns a
  `PendingCall`. So a call that never comes back still has an identity.
- `recordSpend(record: SpendRecord)` → writes the row.
- An `AsyncLocalStorage` "collector" scope opened per request / job step / CLI run / eval
  (`ScopeKind = "request" | "job_step" | "cli" | "eval"`), so stages never thread totals upward.
- `unscopedCalls()` — counts rows that fell on the floor because nobody opened a collector, so
  a report can say it is incomplete rather than present a short total as correct.

`SpendRecord` fields that matter here: `job` (an `AiJob`), `wire`, `model`, `answeredBy`,
`costNanos` (OpenRouter's own figure, nano-dollars), `upstreamCostNanos`, `providerAccount`,
`computedCostNanos` (our own arithmetic — **never set at the same time as `costNanos`**),
`priceVersion`, `generationId`, `isByok`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
`cacheWriteTokens`, `cacheWrite5mTokens`, `cacheWrite1hTokens`, `reasoningTokens`, `webSearches`,
`serviceTier`, `inferenceGeo`, `ms`, `outcome: "ok" | "error" | "aborted"`.

Everything the provider did not say is `null`, never `0` — "a zero is indistinguishable from a
free call and would understate a bill for as long as nobody looked."

`CostSource = "provider" | "computed" | "none"`. `ProviderAccount = "openrouter" | "anthropic"`.
`Nanos = number` (nano-dollars). Prices for the computed path live in `src/pricing.ts` as
`ANTHROPIC_PRICES: Record<string, readonly PriceRow[]>` — dated rows with `effectiveFrom`,
plus `PRICE_CHECKED` and `PRICE_SOURCE` constants, so a stale table is visible rather than silent.

**Bypasses are declared, not forbidden.** `src/spend-declarations.ts` holds a data-only register:
each `Declaration` names an `id`, the one `file` allowed to use it, `kind: "bypass" | "unscoped"`,
`job`, `wire`, `account`, and `metered: boolean` — where `metered: false` is printed by name by
`npm run cost` on every run as spend it knows it cannot see. The wrapper that can actually spend
money (`evals/declared-spend.ts`) lives under `evals/` so nothing in `src/` can import a second
way of calling a model, and `tests/no-undeclared-spend.test.ts` fails on any new route to a
provider that is not in the table. `declaredFetch` throws outside a declaration and counts
attempts, because the Anthropic SDK's default `maxRetries: 2` turns one call into three billable
requests and a naive wrapper records a third of the money.

## The gap

We are about to add **Live Conversations** — interactive two-way voice dialogue, on the **OpenAI
Realtime API** (`gpt-realtime` family, speech-to-speech).

**No code for it exists yet.** Today the app has dictation only (microphone → text, one-way,
`src/transcribe.ts`), no audio output at all, and no WebSocket or WebRTC anywhere in the tree.
So this is a decision to make *before* the feature lands, which is how plans work here.

OpenRouter does not proxy the Realtime API, so this would talk to OpenAI directly: a **third
provider account**, a **fourth wire**, and the first paid call in the product (not evals) that
skips the gateway.

Greg's constraint:

> One option would be to set up an OpenAI admin key, but I'm hoping there's a simpler way.

(The "admin key" being OpenAI's org-level `/v1/organization/costs` and `/v1/organization/usage`
Admin API.)

## What we want from you

1. **The core question: where should the usage numbers come from?**
   The Realtime API emits a `usage` object on `response.done` (input/output tokens split into
   text and audio, with cached-token details). Under **WebRTC** those events land in the
   *browser*, not on our server — so a naive design has the client post its own usage to our
   API, which is an untrusted client reporting its own bill. Under a **server-side WebSocket
   relay** the server sees every event, but now every conversation pins a long-lived connection,
   which is exactly what Vercel serverless does not have.
   Weigh at least: (a) browser WebRTC + client-reported usage, (b) browser WebRTC + server
   reconciliation from the Admin API, (c) server-side WebSocket relay on a long-running host,
   (d) something we have not thought of. Say which you would ship and why.

2. **Is the admin key avoidable?** Be specific about what per-session/per-reader attribution is
   and is not possible without it, and whether it is a *necessity* or a *reconciliation nicety*
   (we already have `npm run cost --reconcile` against OpenRouter, so a periodic
   total-vs-total check is a shape we already have).

3. **How should this land in the existing machinery?** Concretely:
   - A new `Wire` value (`"realtime"`?) and a new `ProviderAccount` (`"openai"`)?
   - Does it fit `SpendRecord` at all, given a *session* is many `response.done` events? One row
     per response, or one row per session? What does `beginSpend`/`recordSpend` mean when the
     unit of work is a five-minute conversation rather than a request?
   - Should the audio-token split get its own columns, the way `cacheWrite5mTokens` /
     `cacheWrite1hTokens` did, because text and audio tokens are priced an order of magnitude
     apart and a single total cannot be priced correctly?
   - Does the `spend-declarations.ts` register extend to a **product** bypass, or does a paid
     call in `src/` that skips the gateway need a different, stronger mechanism? Note the
     register's design assumption today is "evals only".
   - `ms` and `outcome` for a session that the reader simply closed the tab on.

4. **The silent-failure modes.** This codebase's house rule is that most bugs are something
   reporting success while doing nothing. Name the specific ways realtime cost tracking
   under-reports without anything looking wrong — abrupt disconnects with no final
   `response.done`, interrupted/truncated audio that is still billed, an idle session held open,
   cached audio tokens, out-of-band responses, a client that simply doesn't send its report.
   For each, say what check would actually catch it (not "add a test").

5. **Third-party tools.** Is there an observability/metering library or gateway that genuinely
   handles the OpenAI **Realtime** API (not merely chat completions) and would be worth adopting
   over ~200 lines of our own? Selection criteria we use: long-lived community with lots of
   docs (so coding models know it), well-designed type-safe TypeScript API, self-hostable, works
   on Vercel. Be sceptical — say if the honest answer is "none of them, write it yourself".

Answer in prose with headings. Where you disagree with the framing above, say so first.
