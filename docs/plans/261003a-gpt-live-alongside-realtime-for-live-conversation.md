# GPT-Live alongside Realtime for live conversation

**Status: Stages 0 and 1 landed; plan reviewed by GPT Sol ([review](261003a-gpt-live-alongside-realtime-plan-review-sol.md)) and revised; Stage 2 next.**

## What this is for

> I was experimenting with the new OpenAI Live API for realtime conversations with tool use in the
> background, and I think it's working better than what we have here. Borrow the best bits to update
> and improve our realtime conversations.
>
> — Greg, 2026-10-02

The other project is WhatNext (`/Users/greg/Dropbox/dev/experim/whatnext`). It is not on the API
Spideryarn uses. Spideryarn's Live is **OpenAI Realtime** (`gpt-realtime-2.1`): one model listens,
thinks, calls tools and speaks. WhatNext is on **GPT-Live** (`gpt-live-1`, generally available
2026-09-10): a full-duplex voice model that hands anything needing facts to a separate text model
(the *backend*), which is the one that calls tools.

Asked which he wanted, Greg, 2026-10-02:

> My intention when I wrote this was to say move to GPT-Live, but I don't have a clear sense of what
> the tradeoffs are. I'm inclined to say we should just move over. Alternatively, we could sort of
> implement it alongside and then we'd have both and then get rid of one eventually. […] all I know
> is that WhatNext seems to be working better than Spideryarn is. So I'm open to trying to have
> both. Trying to fix the GPT real-time implementation and implement GPT Live alongside it and
> compare them. But eventually I think we only want one. […] use your judgment

## The decision: build GPT-Live alongside, compare, delete the loser

Three inputs, all pointing the same way:

- **Web research (2026-10-03).** OpenAI positions the two as different architectures, not old and
  new: Realtime is "speech, reasoning, and tool use in one session", GPT-Live is "full-duplex
  conversations with a separate backend". Nothing on the deprecations page sunsets Realtime; on
  2026-10-01 OpenAI was still pointing retired models *at* `gpt-realtime-2.1`. GPT-Live is reported
  (secondhand) to be what ChatGPT's own voice mode runs on. So it is a real direction, not an
  experiment, and not yet a replacement.
- **GPT Sol** (design consult, 2026-10-03): build alongside as a bounded experiment, with passage
  grounding and faithful saved history as the gates before it becomes the default.
- **The spike** (below): GPT-Live works from a browser with no long-lived server socket, which is
  the only shape Vercel allows.

**The simpler option passed over** is replacing Realtime outright. It is less code to carry, but
GPT-Live is three weeks old, its voice layer cannot hold a long article (16,384-token cap), and
forum reports say it sometimes says "let me check" and never asks the backend. For a reading app,
an answer that was never checked against the article is the worst failure. Paying readers keep the
engine that works until the new one has earned it.

**The comparison ends.** Greg uses both on real articles; then one is deleted. The deletion is a
follow-up plan, not open-ended coexistence.

## Stage 0 — the spike (done, 2026-10-03)

Scripts in [`evals/live/gpt-live-spike/`](../../evals/live/gpt-live-spike/). Twelve short real
sessions, headless Chrome through `playwright-core`. What it established:

| | |
| --- | --- |
| Session start | The server makes one request: `POST /v1/live/sessions` with `{session, transport:{type:"webrtc", sdp}}`, API key auth, returns 201 `{session:{id}, transport:{sdp}}`. There is no ephemeral client secret for Live. |
| Tool loop in the browser | With `delegation.type: "responses"`, the backend's function calls arrive on the `oai-events` data channel as nested `response.event` → `response.output_item.done`. The browser replies `response.item.create {function_call_output}` then `response.create`. Accepted; the voice spoke the tool's fact in 10 of 11 runs. **No sideband needed.** |
| Correlation | A continuation is a new response id under the same `delegation_id`. |
| The 11th run | Both backend rounds completed with the right text and **no output transcript arrived**. So "tool done, then silence" is real and needs a stall rule. |
| Does the voice keep talking? | One filler line ("I'm checking the article"), then silent for the whole 12 s wait. Background tools in the sense that it *can* talk and listen, not that it fills the gap. |
| Transcripts | `session.input_transcript.delta` / `session.output_transcript.delta` carry only `start_ms`, `end_ms`, `delta`, `event_id` — 200 ms windows on the session timeline. **No item ids, no turn boundaries, no done event.** The reader's speech *is* transcribed. A typed message produces no input transcript. |
| Usage | `session.usage.updated {usage:{seconds}}`, cumulative, about every 15 s, and on `session.closed`. Backend tokens on nested `response.completed`. No audio tokens anywhere. |
| Limits | Session `instructions` over 16,384 tokens: HTTP 400. Backend instructions of ~30k tokens: accepted, and cached between rounds. Session lasts 2 hours. |
| Silence | A zero-valued audio track is enough to keep the session alive over WebRTC. |
| Allowlist | `client.data_channel.allowed_*_events` works; a disallowed client event gets `error … event_not_allowed`. |

## Design

### One conversation, two engines

The engine is chosen per call. Everything the reader sees — the Live button, the status strip, the
microphone picker, the transcript, passage links, hang-up, Reconnect — is shared. `useLiveConversation`
keeps its `LiveApi` shape; a second hook, `useGptLive`, returns the same shape. The protocol-specific
parts stay separate and are not abstracted into a provider framework: the Realtime ledger
(`exchanges.ts`), `tool-responses.ts` and `meter.ts` are Realtime's, and GPT-Live gets its own
pure reducers beside them.

**Choosing the engine.** With Experimental features on, the Live control's menu (where microphone
placement already is) gains a choice: *Realtime* or *GPT-Live (new)*, remembered in `localStorage`.
With the switch off there is no choice and the engine is Realtime, as today. The default with the
switch on stays Realtime until Stage 4's real-browser check has passed, and becomes GPT-Live in
that stage (Sol F9), so the comparison happens without hunting for a setting.

### The article split

The voice model's instructions cap at 16,384 tokens and most articles are longer. So:

- **The voice** gets: how to speak, when to delegate, the title and author, the outline (the
  Structure tree's headings with their one-line summaries, cut to fit a budget), the reader's
  profile, and the seeded recent conversation. It may chat, clarify, and talk about what the reader
  thinks. **Any claim about what the article says, any quotation, any "where does it say that" is
  delegated.**
- **The backend** (`gpt-6-luna`, `reasoning.effort: low`) gets the whole article with block ids,
  the evidence rules, and the tools: the same server tools as today plus `show_passage`. It answers
  in a sentence or three meant to be spoken, and never includes a block id in its text.

The same split for every article, short or long. A short article *could* go to the voice whole;
passed over, because two behaviours need two sets of tests and the voice layer is the weaker model.

`show_passage` is a backend tool. Its call reaches the browser like any other; the browser handles
it locally (validates ids, records the pointer) and returns the result. Pointing therefore waits
for a delegation, which is the cost.

### Tools

The browser relays. `response.output_item.done` with a `function_call` → `POST
/api/chat/:slug/live-tool` (the existing route, unchanged) → `response.item.create` → once the
nested response has completed and every call in it is answered, one `response.create`. Keyed by
`delegation_id` + response id, as WhatNext does after its "tool done, then silence" bug. Each
`call_id` runs once; a tool failure is still an output; rounds are capped at 4 per delegation, after
which the output is "answer now from what you have".

**Not ported from Realtime:** "the reader spoke, so drop the pending continuation". In GPT-Live,
speech does not cancel backend work, and dropping the continuation would leave the backend waiting
for ever.

**Passed over:** server-side execution receipts keyed by `(session, call_id)` (Sol R2). Every tool
today is a read — search, fetch, look up — so a repeated call costs a little and changes nothing.
Add receipts the day a live tool writes.

### Turning fragments into chat rows

The stored shape does not change: a spoken exchange is a user row and an assistant row, written by
the existing `speak` → `/spoken` path with `expectedTailId`. What changes is how an exchange is
found, since GPT-Live gives no turn ids and both sides can talk at once.

**What the stored pairs promise is chronology, not ownership.** GPT-Live does not say which
question a stretch of speech answers, so nothing here claims to know. The rows read back in the
order things were said, and no words are dropped. Sol's plan review (F1, F2) showed that the first
draft — a backchannel rule that discarded short interjections, and a "quiet for a few seconds"
settle — could lose "Don't continue" and could freeze an answer at its preamble.

- **Segments are the record.** Fragments are de-duplicated by `event_id`, ordered by `start_ms`,
  and grouped into speaker segments. The reducer keeps every segment for the life of the call.
- **Pairs are a projection.** An exchange is one or more reader segments followed by the companion
  segments up to the next reader segment. *Every* reader segment that follows companion speech
  begins a new exchange, however short — so "mm-hm" becomes a short question whose answer is the
  rest of what the companion was saying. Lossless and in order, at the price of an odd-looking row.
- **`interrupted`** is set on an exchange whose answer the reader cut into with more than four
  words (the companion's last fragment and the reader's first are closer than 0.7 s or overlap).
  A shorter interjection splits the rows but does not set the flag, so `recentHistory` keeps the
  pair. This is WhatNext's backchannel rule, deciding a flag rather than deleting words.
- **An exchange is written when it can no longer change:** a later exchange has begun, or the call
  is ending. Not on silence. A backend answer can be spoken seconds after the backend finishes
  (3.5 s in the spike's `allow` trace), and silence cannot tell "finished" from "not started".
  The cost: the last exchange of a call is written at hang-up, so a tab that dies loses it — the
  same size of loss the meter already accepts.
- **Written means frozen.** Each exchange has a sequence number and is handed to `speak` exactly
  once, with its payload and tail fixed across retries. A fragment that arrives for a frozen
  exchange starts a new one (a companion-first exchange has an empty question, which `SpokenTurn`
  already permits).
- **Tool runs and passages** are held per `delegation_id` and attached to the exchange that is
  open when that delegation's final backend response completes — where its answer is being, or is
  about to be, spoken. Anything still held at hang-up goes on the last exchange. A reader who
  speaks in the gap between the backend finishing and the voice answering moves the receipts one
  exchange early; accepted, and named here.
- The answer stored is **what was spoken** (the output transcript), never the backend's text.
- `model` on the row is set server-side; the `/spoken` body gains an `engine` so the server can say
  `gpt-live-1` rather than `LIVE_MODEL`.

**Passed over:** storing speaker segments as rows (Sol R5, and again F1). It is the faithful shape
for full-duplex speech, but `recentHistory`, the renderer, retry and edit all assume adjacent
pairs, and this engine may be deleted. If GPT-Live wins, segment rows are the first follow-up. Sol
still prefers segments as the stored record; overruled for the length of the experiment because
the projection above loses no words and no order, which were the two harms it named.

### Seeding and the microphone barrier

History goes in `session.input` at creation (text only, 128 messages / 8,192 tokens), built from
`liveSeedItems` and trimmed oldest-first to a character budget well inside the cap. So the Realtime
"wait for every seed acknowledgement" barrier has no counterpart; the microphone opens on
`session.started` **and** the tail check (`tailNow` still equals the ticket's `tailId`).

### The server

One new route, `POST /api/chat/:slug/:threadId/live-session`, body `{sdp, placement?, useProfile?}`.
It builds the config, journals the session row **before** calling OpenAI's create (the create bills
15 s, so the row must exist first — the reverse of the token route's order, where the mint is
free), does the SDP exchange, records how the create went (the provider's session id and the
15 s it billed on success; a failure closes the row with a reason), and returns `{sdp, sessionId, liveSessionId, tailId, expiresAt}`. No
instructions, tools or article reach the browser in that response. (They can reach it in the
`session.started` snapshot; prompts are not secrets here, and the allowlist keeps lifecycle
snapshots to the ones the hook needs.)

Data-channel allowlist, set at creation:

- client: `response.item.create`, `response.create`, `session.close`
- server: `session.started`, `session.closed`, both transcript deltas, `session.delegation.created`,
  `session.usage.updated`, `error`, and nested `response.created`, `response.output_item.done`,
  `response.completed`, `response.failed`, `response.incomplete`, `error`

`src/live.ts` stays the only file that touches `OPENAI_API_KEY`; the GPT-Live server half goes in
it or in a sibling it re-exports from, and the spend scan's `ALLOWED` map and
`tests/no-undeclared-spend.test.ts` learn the second endpoint and the backend model.
[ai-gateway.md](../project/ai-gateway.md)'s "one declared exception" becomes one exception with two
models in it: the backend runs inside OpenAI's session and cannot go through OpenRouter.

### The meter

Two bills, both browser-reported, both priced on the server:

- **Voice seconds.** `session.usage.updated` and `session.closed` carry a cumulative figure. A new
  report kind `voice` sends it; the server advances a high-water mark on the session row inside one
  transaction and writes an `ai_calls` row for the positive difference only. A repeat or an older
  report adds nothing. $0.05 a minute.
- **Backend tokens.** One report per nested `response.completed`, kind `backend`, idempotent on the
  response id the way Realtime's `response` reports are on their event id. Priced on the backend
  model's rate card, cached input separately.

**The 15 seconds billed at create are recorded by the server**, not left to the browser: on a
successful create the route advances the high-water mark to 15 and writes that priced row, so a
call abandoned before it connects is not free in the ledger, and the browser's first report of 15
adds nothing (Sol F4). `connected_at` stays unset until the browser says the channel opened.

Schema, additive only: `realtime_sessions` gains `backend_model` (nullable),
`provider_session_id` (nullable) and `voice_seconds_reported` (integer, default 0); `ai_calls`'
`event_kind` check and `RealtimeEventKind` gain `voice` and `backend` (Sol F5), and voice seconds
are stored as their own quantity, not as transcription seconds. The mark's read, advance and row
insert happen under one row lock in one transaction, tested against real Postgres with repeated,
reordered and concurrent reports. `model` is `gpt-live-1`; `transcription_model` is null. `acceptsUntil` is the browser cap plus tolerance, as now. The same accepted loss as today: a
closed laptop's last seconds are never reported.

### Lifecycle and stalls

Reused as they are: the session epoch, the startup deadline, Send/thread-switch/pagehide endings,
the 409 repair, the twenty-minute session cap, the microphone-paused and connection stalls,
Reconnect.

**Not reusable, because GPT-Live sends no voice-detector or playback events** (Sol F6). Realtime's
hook reads `input_audio_buffer.speech_started/stopped` and `output_audio_buffer.*`; here the only
evidence is transcript fragments, which trail the audio. So in `useGptLive`:

- `hearing` and `speaking` are estimates: a fragment from that side in the last second or so.
- The five-minute idle cap resets on reader fragments.
- Hang-up: disable and release the microphone at once; keep the channel and the meter alive while
  fragments are still arriving (bounded, about 2.5 s); send `session.close` and wait up to 3 s for
  `session.closed`, which carries the final seconds; write the last exchange; tear down.
- There is no "open turn" stall, since nothing says a turn is open.

**The reply stall is per delegation** (after WhatNext's `stall.ts`, corrected by Sol F7). A
delegation owes speech from the moment its final backend response completes — the one with no
function calls — until a companion fragment begins after that moment. A filler line spoken before
then pays nothing. A reply is also owed from the reader's last words while no delegation exists.
Owed for 20 s shows the existing notice with Reconnect. This catches the spike's eleventh run,
and the "one moment… then nothing" order that a single global debt would miss.

`session.closed` reasons `expired`, `content`, `connection_lost` and `remote_hangup` each get a
sentence in the panel.

**The engine is pinned to the call** (Sol F8). Three things, kept apart: the remembered preference
(`localStorage`), the engine the next start would use (the preference, if Experimental is on *now*;
else Realtime), and the engine that owns the current call, which does not change until its Stop
has finished. Turning Experimental off mid-call ends a GPT-Live call first. Reconnect asks again.

### The prompt

The voice prompt follows OpenAI's Live prompting guide and WhatNext's sections — Personality,
Backchannel policy, Interruption policy, Delegation policy — in the plain-words style of
[prompting-guide.md](../project/prompting-guide.md). Two lines carry the weight: *delegate before
giving any answer that depends on the article, and never guess the result while you wait*; and
*while the backend works you may say what you are checking, but do not fill silence for the sake of
it*.

## Stages

Each ends green (`npm test`, `npm run typecheck`, `npm run check`), committed, with a GPT Sol
review-and-fix.

1. **Realtime quick wins.** The fixes that carry over without changing engine, from OpenAI's
   current Realtime prompting guide: a one-sentence preamble before a slow tool (so the gap is not
   dead air), an unclear-audio rule (ask for a repeat, never guess, never call a tool on noise),
   language pinned unless the reader clearly switches. Stale comments in `src/live.ts` fixed (the
   header's "browser half is not built yet"; "the eighth tool"). Nothing else: no VAD change, since
   the stall data Greg decided to wait for on 2026-09-24 has not been looked at here.
2. **GPT-Live, server half.** Session config, the two prompts, outline budget, seed trimming, the
   SDP-exchange route, the migration, the two usage report kinds and their pricing, `/spoken`'s
   `engine`. Tests without HTTP for the pure parts, route tests with `fetch` stubbed, the spend scan.
3. **GPT-Live, browser half.** Pure reducers with tests watched red — the fragment segmenter, the
   delegation tool loop, the stall rule — then `useGptLive`, the engine choice in the Live menu, and
   the wiring. A fake-wire flow test like `tests/live-session-flow.test.tsx`.
4. **Real browser, docs, land.** Claude in Chrome on a real article: a spoken-style question
   through the typed path and a silent track, a tool call, a passage shown, hang-up, the rows in
   Chat, the usage rows in Postgres; then the same for Realtime to check nothing regressed.
   `live-conversation.md` gains the GPT-Live section; `ai-gateway.md`, `experimental-features.md`,
   `cost-tracking.md` updated. Push to `dev`; tell the Overseer.

## Not in this job

- **Deleting the losing engine**, and the comparison itself — Greg's, on real articles with a real
  microphone.
- **Recording from the click** (WhatNext's catch-up buffer). Worth having for either engine;
  separate, because it touches the microphone path both engines share.
- **Typing into a live call.** Today's stop-then-type stays.
- **A server sideband.** Needed only if tool work must finish with the tab closed.
- **Physical acoustics.** An automation tab has no microphone; real speech, echo and street noise
  are Greg's to try. Said plainly at the end rather than implied by green tests.

## What done looks like

With Experimental on, pressing Live and choosing GPT-Live gives a spoken conversation whose answers
about the article come from the backend with passages shown, whose exchanges appear in Chat and
survive a reload, whose seconds and backend tokens are priced rows, and which ends cleanly. With
Experimental off, nothing a reader sees has changed except the Realtime prompt.

## Log

- 2026-10-03 — research, Sol consult, spike. Decision: alongside.
- 2026-10-03 — Stage 1 landed (`66b001ae4`): the Realtime prompt gains a preamble before slow
  tools, an unclear-audio rule and language pinning. Not measured with real audio.
- 2026-10-03 — Sol plan review: build with the P0–P1 changes. F1–F9 all taken, except that pairs
  stay the stored shape (see "Passed over" under fragments). R2 receipts and R8 acoustics: Sol
  agrees neither costs a stage.
- 2026-10-03 — merged `origin/dev`, which had landed
  [261002j](261002j-live-voice-chat-cleanup.md) (low reasoning effort, a terser `LIVE_SYSTEM`, live
  words in the thread, one status line, fewer controls) and
  [261003d](261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md) (tap to talk). What was
  decided at each conflict:
  - **`LIVE_SYSTEM` is dev's.** It is newer and was measured. Stage 1's preamble paragraph and
    unclear-audio section are dropped: dev's WHEN TO THINK already says both, in fewer words. The
    one Stage 1 rule kept is the language bullet, reworded to dev's length. Sol's C7 qualification
    ("first sentence after any tool preamble") went with the paragraph it qualified.
  - **`useLiveConversation.ts` is dev's behaviour**, with the lift into `session-shared.ts` kept;
    dev had changed none of the lifted constants or helpers. Tap to talk's constants stay in the
    Realtime hook.
  - **`LiveApi` grew six fields on dev**, and `useGptLive` answers each: `step` (microphone, then
    transport, then seeding — this engine has no ticket step), `reconnecting`, and tap to talk as
    not offered (`talkMode` is always `hands-free`; it is Realtime's push-to-talk, and the
    `open-turn` stall that offers it is one this hook never reports). `LiveLine` grew `exchange`,
    `session` and `seq`; the `Segmenter` now says which exchange a line is in, and the hook hands
    lines over in one commit with the chat rows, as the Realtime hook does.
  - **`LiveButton` is dev's one button.** The microphone-setup select moved to LiveStatus's
    Advanced on dev. The engine choice stays beside the button, because Advanced exists only
    during and after a call and the engine is chosen before one.
  - **Migrations**: dev's five, then ours as `idx` 127. Disjoint tables, so our snapshot was
    hand-merged onto dev's last one (database.md § When both are applied and disjoint), keeping its
    `id`; `db:generate -- --allow-empty` reports no schema changes. The `.sql` is untouched.
