# Live voice chat: a calmer screen, shorter answers, and what GPT-Live would take

Report `spya-f4eq7p` (suggestion, 2026-09-29, Greg — an admin, trusted input), Overseer queue item
`qi-tbfjt92y`. The feature is [live-conversation.md](../project/live-conversation.md).

> The live chat in a conversation, you know, the real-time dialogue, somehow it's a bit janky. First
> things first, can you make sure that you're using the latest OpenAI thing for it? … there was GPT
> Real-time 2.1, and now there's GPT Live … Secondly … probably we want to be in instant mode. I
> don't know if there is a way for it to do something clever with tool use in the background or for
> it to adaptively decide how much it needs to think … tell it to avoid too much, like, verbal
> niceties … I want it to be kind of a bit more quick back and forth. … I click the live button, and
> then nothing seemed to be happening for a minute, and I couldn't tell if it was connecting or if it
> was listening to me or recording. So maybe at the very least I want some kind of input volume level
> … if there's a problem, I want it to be clear that there's a problem. … it was sort of showing the
> words streaming in, but in one place, but then they'd show up in the chat in another place … could
> those not be the same place … there was a button to sort of switch from live to voice dictation. I
> don't think we need that. … stuff around headphones and others … hide that in an advanced section.
>
> — Greg, 2026-09-29 (the whole report is in the production feedback row and in
> `npx tsx scripts/overseer-queue.ts show qi-tbfjt92y`)

## Prior work

Nothing on `dev` answers this. Searched `git log origin/dev`, `docs/plans/`, `docs/user-feedback/`
and the queue on 2026-10-02: the earlier repair (`260906f`, `7eb8f2a00`) and the stall work
(`260915b`) predate the report; `qi-8k6vjbzz` (street noise still cuts it off) is queued *after*
this one and waits on it. The code is still on `gpt-realtime-2.1` with no reasoning setting.

## What we found about "GPT Live"

It exists, and our OpenAI key can reach it (`GET /v1/models` lists `gpt-live-1`, 2026-10-02). It is
**not a newer realtime model; it is a different architecture**, GA in the API on 2026-09-10
(OpenAI changelog; guides `live`, `live-migration`, `live-conversations`, `live-delegation`, read
2026-10-02):

| | `gpt-realtime-2.1` (today) | `gpt-live-1` |
| --- | --- | --- |
| Shape | One model hears, thinks, calls tools and speaks | A voice front end that **delegates** thinking and tools to a separate backend model, and keeps talking while it works |
| Endpoint | `/v1/realtime` client secrets + WebRTC | `/v1/live/sessions`; WebRTC still carries audio, but every data-channel event is renamed |
| Instructions | ours hold the **whole article** | capped at **16,384 tokens** — many articles do not fit, so the article has to live in the backend |
| History seed | `conversation.item.create`, acked per item | `session.input`, ≤128 messages / **8,192 tokens** |
| Turns | item ids, `response.done`, completed transcripts | **none**: transcript deltas with `start_ms`/`end_ms`, "no item ID or event that marks a completed conversational turn" — the app decides where a turn ends |
| Tools | function calls on the data channel | backend (Responses) function calls wrapped in `response.event`, results via `response.item.create`; or client delegation |
| Billing | tokens by modality (audio in $32/M, out $64/M) | **$0.05/minute**, per second, plus the backend model's tokens |

So moving to it is not a model-id change. It rewrites the three things
[live-conversation.md](../project/live-conversation.md) calls the most failure-prone and silent:
the ordering in `exchanges.ts` (built on item and response ids that no longer exist), the seed
barrier, and the meter (built on `response.done`, which no longer exists). It also changes the
product: every question about the article becomes a delegated round trip to a backend that holds
it, where today the voice model has the article in its head.

It is also, plainly, the shape Greg described — *"something clever with tool use in the background
… adaptively decide how much it needs to think"* — and probably cheaper per minute. So it is worth
doing; the question is whether it is worth doing **blind, now**.

## The decision, and the simpler option passed over

**Do the parts that are true whatever the model, measure GPT-Live properly, then decide the
migration with the numbers in hand.** Three stages:

1. **The screen and the voice (on `gpt-realtime-2.1`).** Everything in the report except the model
   switch. It survives a later migration almost unchanged: the transcript in one place, the meter
   from the first second, named connecting steps, clear errors, the advanced section, no dictation
   button, a terser prompt.
2. **A GPT-Live spike, measured, written up** under `docs/investigations/`. A script, not product
   code: open a real `gpt-live-1` session against a real article with the backend holding the
   article, speak a synthetic question, and record time-to-first-audio for an article question,
   what the transcript events look like, whether `show_passage` survives as a backend tool, and
   what a minute costs against our realtime meter. Plus the one product question it exposes.
3. **The migration, or a queue item for it** — decided on stage 2's numbers. If it is clearly
   better and the shape is clear, build it as its own plan; otherwise a queue item that carries the
   evidence. Either way the report's first ask is answered with a measurement, not a guess.

**Passed over: switch to `gpt-live-1` now, in one go.** It is what the report literally asks first,
and it is the bigger risk: three silent-failure mechanisms rewritten against an API three weeks old,
with a product change (article questions become delegations) nobody has heard yet. Stage 1 is
needed either way and is most of what made it feel janky.

**Also passed over: `gpt-realtime-2.1-mini`.** Faster, but Greg declined it on 2026-09-02 (*"it's
smarter"* — `src/pricing.ts`). Low reasoning effort on the full model is the instant mode he means.

## Stage 1 — the screen and the voice

### 1a. Instant, terse, adaptive (server: `src/live.ts`)

- **`reasoning: { effort: "low" }` on the session.** OpenAI's realtime prompting guide: *"Set
  reasoning effort to `low` instead of the default. Increase only for workflows that require deeper
  planning."* The default is higher than low, which is a likely share of the slow first answer.
  Verified by minting a real session and reading the echo — the parameter's exact place is
  confirmed, not assumed (a wrong field 400s, which is the test).
- **Adaptive thinking in the prompt**, from the same guide: answer simple questions at once without
  reasoning; reason only before a multi-step answer or a tool; a short preamble only when a tool
  will take noticeable time, never before a direct answer.
- **No verbal niceties.** No "Great question", no restating the question, no "Let me know if…", no
  sign-offs. One or two sentences unless the reader asks for more; more detail on request is fine.
  Edits `LIVE_SYSTEM`'s HOW TO TALK section, which already says SHORT — it gets sharper rather than
  longer. [prompting-guide.md](../project/prompting-guide.md) applies.
- `liveSession` test updated to pin `reasoning` and the new lines.

### 1b. One place for the words (client)

Today the live words stream in a box under the composer (`LiveStatus` transcript) and then reappear
as saved rows in the thread above. **The live words render in the thread itself**, after the saved
messages, styled as the provisional end of the conversation — the reader's line and the companion's
reply as ordinary chat bubbles with a "still arriving" mark. When an exchange is saved its live lines
leave the list in the same render its saved rows arrive, so nothing is shown twice and nothing
jumps. The transcript box and its "Transcript" checkbox go. Passage pointers from `show_passage`
show on the provisional reply, as they do on the saved one (`PassageLinks`). Lines whose save could
not be confirmed (`hasUnsavedLines`) stay, with the existing honest notice.

### 1c. Says what it is doing (client)

- **The level meter from the first moment the microphone is open**, not only once `live`. During
  `connecting` the meter moves but the status says the words are not being sent yet, because the
  track is held disabled until the history is seeded (ordering rule 2 stays exactly as it is).
- **Connecting names its step**: getting the microphone → connecting to the voice service → loading
  this conversation → "Listening — go ahead". A slow step is then visibly *that* step.
- **One status line with a clear state**, colour plus word: connecting / listening / thinking /
  speaking / stopped. A failure is an error state with the sentence and **Try again**, not a grey line
  among others.

### 1d. Fewer controls (client)

- **Remove "Use dictation"** from the live panel. Hang up then the microphone button is still there.
- **Remove "Continue typing"**: the composer is right there and Hang up ends the call; typing and
  pressing Send already ends a session and waits for the flush (lifecycle table).
- **An "Advanced" disclosure** (closed by default) holds: microphone device, Auto/Headphones/Laptop
  noise reduction (moved out of `LiveButton`), and Reconnect. Reconnect *also* shows beside a stall
  notice, where it is the answer.
- `LiveButton` becomes the one button: Live / Cancel / Hang up.

### Stage 1 done when

`npm test`, `npm run typecheck`, `npm run check` (via tmux-job) green; a browser subagent on the box
(Playwright, fake microphone) sees: meter moving during connecting, named steps, the words appearing
in the thread and not twice, no dictation or typing buttons, Advanced closed by default with the
three controls in it, an error state with Try again. A real-session check of the `reasoning` field.
GPT Sol code review, findings fixed. Docs: live-conversation.md updated. Committed and pushed.

## Stage 2 — the GPT-Live spike

`evals/live/gpt-live-spike.mts` (beside the other live evals), WebSocket transport from Node:

- Session with `delegation: responses`, backend `gpt-6-luna` at low effort, whole article in the
  backend instructions, `show_passage` as a backend function. Voice instructions: the spoken rules.
- Feed a TTS-rendered question about the article (`/v1/audio/speech`), and record: session start
  time, delegation start, first output audio, transcript event shape, the `show_passage` call, usage
  seconds and backend tokens.
- Try an article over 16k tokens and confirm where it has to go.
- Write it up in `docs/investigations/` with the numbers beside the same question on
  `gpt-realtime-2.1` at low effort (same script shape against `/v1/realtime`, or the existing evals).

**Not in the spike:** any change to `src/`. Spend: a few dollars.

## Stage 3 — decide

On stage 2's numbers. If GPT-Live is clearly faster or better and the transcript grouping is
tractable, write `261002j`'s sequel plan and either build it here or queue it with the evidence. If
not, a queue item recording why, so the question is not re-asked blind.

## What is deferred, named

- **The GPT-Live migration itself**, until stage 2 says it is worth it (above).
- **Street noise ending turns** (`qi-8k6vjbzz`) — its own item, and it waits on this one.
- **Live in the comment dialog** — unchanged, still not built.

## After the plan review (GPT Sol, 2026-10-02)

[Review](261002j-live-voice-chat-cleanup-plan-review-sol.md): no P0. What changed:

- **The spike runs first and wider** — Stage 0 rather than Stage 2: a conversational follow-up, an
  article question that needs a delegation and `show_passage`, an interruption during a delegation,
  a server tool, a short and an over-16k article, several turns; repeated; median and tail; **first
  substantive audio**, not first audio (GPT-Live backchannels at once); full cost including WebRTC
  setup; TTS cost excluded. WebSocket for the voice, and the browser handshake (SDP via our server)
  named as an unmeasured migration risk.
- **But it runs in parallel with the transport-independent part of Stage 1** (1b, 1d, the error
  state and named steps of 1c), not before it. Whatever the spike says, a GPT-Live migration is its
  own multi-day plan, and the report's UI complaints should not wait for it. The Realtime-only parts
  (1a's `reasoning` field, the meter's track handling) are small. Taken knowingly against Sol's
  ordering.
- **1c meter: a cloned track.** A disabled track is silence to every consumer (W3C), so the meter
  reads `micTrack.clone()` — enabled, the same capture, no second permission — from the moment it
  exists; the original stays disabled until the barrier lifts, exactly as now. Sol preferred an
  unattached transceiver plus `replaceTrack`; the clone was chosen because it leaves the seeding
  barrier, the silent-failure part, untouched. The clone is stopped on every teardown path. Needs a
  real-browser check.
- **1b grouped by exchange.** The tail renders provisional *exchange groups* in ledger order (not
  raw line order — a late R1 belongs with U1), each removed by exchange identity at the moment the
  chat controller installs its provisional rows (that is the handoff, not the server's reply).
  Follow-scroll watches the tail. DOM tests assert one visible copy through a normal save, a slow
  save, a 409 repair and an interruption. An interrupted line with no final transcript stops
  blinking once the session is not live. Passage pointers stay where they are (latest one, in the
  status strip) for v1 — attaching them to the right provisional reply is deferred.
- **1d keeps a way to cancel a reconnect.** During a reconnect's teardown a "Cancel reconnect"
  action remains, because Live is disabled while closing; a test covers reconnect → cancel.
- **1a gets a grounding check**: low vs the default effort on a few article questions — answer,
  `show_passage` rate, right block — not just an echo. The prompt says `show_passage` needs no
  spoken preamble. Field placement confirmed by minting: `session.reasoning.effort`, values
  `minimal`…`xhigh`, a bad value 400s (2026-10-02).

## Progress

- 2026-10-02: plan written; prior-work check clean; `gpt-live-1` access confirmed.
- 2026-10-02: GPT Sol plan review — no P0; outcome recorded above.
- 2026-10-03: **Stage 0 done — don't migrate now.** [261002r](../investigations/261002r-gpt-live-spike.md):
  `gpt-live-1` is ~¼ the cost per turn and answers follow-ups in ~1.3 s, but a real article answer
  arrives ~2 s *later* (5.2 s vs 3.0 s), behind filler in 32 of 36 turns, and the migration rewrites
  the ordering, seeding, meter and handshake. Spend $11.52. The migration goes to the Overseer queue
  with the four conditions that would make it worth revisiting.
- 2026-10-03: **1a done.** `reasoning.effort: "low"` — same grounding as the default (24/24 right
  passage both, 6/6 corrections) and **no faster** (model time 1.81 s vs 1.80 s); kept because Greg
  asked for it, OpenAI recommends it, and it costs nothing. The terser prompt is in. What the delay
  actually is: the model calls `show_passage` before its first word (~1.2 s, and a prompt telling it
  to speak first changed nothing — B′), and `semantic_vad` waits up to 4.6 s after a hesitant
  question. Making the detector more eager reverses a deliberate choice not to cut a thinking reader
  off — Greg's call, and it belongs with `qi-8k6vjbzz`.
