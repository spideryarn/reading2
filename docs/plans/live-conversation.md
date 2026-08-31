# Live conversation: talking to the article

**Status: a spike, 2026-08-31.** The wire works end to end. Nothing is wired into chat mode, nothing
is metered, nothing is stored, and nothing caps a session — see [What is missing](#what-is-missing).

Dictation ([dictation.md](../project/dictation.md)) is a microphone that fills a text box: press,
talk, press, and your words are typed for you. It is one-shot and one-way. This is the other thing —
a conversation, where you talk and it talks back, and either of you can cut the other off.

> There's a new interactive live conversation mode from OpenAI that's pretty good. Try and get it
> working in Chat mode as an alternative to the single-step voice-dictation mode.
>
> — Greg, 2026-08-31

## The answer to the question Greg actually asked

> If possible, I'd love to just have a single `OPENROUTER_API_KEY`. But if you need an actual
> `OPENAI_API_KEY`, I've added that to `.env.local` so you're not blocked.
>
> — Greg, 2026-08-31

**It is not possible, and the reason is not a routing detail.** OpenRouter has no realtime API at
all. Checked on 2026-08-31: it has exactly two audio endpoints, `POST /api/v1/audio/speech` and
`POST /api/v1/audio/transcriptions`, and both are batch — send a whole file, get a whole answer.
There is no WebRTC, no WebSocket, no duplex speech-to-speech, and no changelog entry promising one.

What *could* be built on OpenRouter is transcribe → chat → speak, chained. That is a different and
worse thing: a second or more of added latency on every turn, and no native barge-in, which is the
one feature that makes a spoken conversation feel like a conversation rather than a walkie-talkie.

So this needs `OPENAI_API_KEY`, and it is **the first exception to
[ai-gateway.md](../project/ai-gateway.md)** — "every paid model call goes through OpenRouter, and
since 2026-08-27 there are no exceptions" — since that rule was written. The exception is three
files, named in `ALLOWED` in [`tests/no-undeclared-spend.test.ts`](../../tests/no-undeclared-spend.test.ts),
each with its reason. **It is not yet metered**, which is the biggest single thing standing between
this and a feature.

## The shape, and why it is the only one available

```
  browser                          our server                      OpenAI
     │                                  │                             │
     │ ── POST /session {slug} ───────▶  │                             │
     │                                  │ ─ mint a client secret ────▶ │   the article, 8 tools,
     │                                  │ ◀──────────── ek_… ───────── │   the vocabulary, all
     │ ◀──────────── ek_… ────────────  │                             │   decided here
     │                                                                │
     │ ══ SDP offer, Bearer ek_… ════════════════════════════════════▶ │
     │ ◀══════════════════════ SDP answer ═══════════════════════════ │
     │                                                                │
     │ ●══════ audio both ways, events on a data channel ════════════● │
     │                                  │                             │
     │ ── POST /tool {name, args} ────▶ │  (the seven chat tools)      │
     │ ◀───────── result ────────────── │                             │
     │ ══ function_call_output ══════════════════════════════════════▶ │
```

**The audio never touches our server, and it cannot.** Relaying it would need a long-lived socket,
and a Vercel function does not have one ([deployment.md](../project/deployment.md)). So the browser
talks to OpenAI directly, and our server's whole job is to mint a short-lived token and to run tools.

That is also what makes metering hard, and it is worth being plain about: **every token this feature
bills is spent on a wire this server never sees.** `npm run cost` cannot see a live session at all.

### The key is never in the browser

`POST /v1/realtime/client_secrets` returns an `ek_…` client secret, and that is the only thing the
browser gets. Not the instructions, not the tool list, not the article — the session already holds
all of it. It is the same reason `/api/transcribe` builds the vocabulary server-side and refuses a
term list from the caller: a client that is handed the prompt is a client that can be talked into
sending a different one.

## The three decisions worth arguing with

### 1. It gets the whole article, like text chat

Greg's call, put to him as a trade against a lighter brief plus lookups. At ~14,750 tokens for the
test article that is about $0.06 of uncached text input to open a session, and a tenth of that per
turn afterwards while the session's cache holds. The cache belongs to the session, so hanging up and
starting again pays the opening price a second time.

### 2. Its own system prompt, not chat's

The temptation is to reuse `SYSTEM` from [`src/converse.ts`](../../src/converse.ts), because
everything it says about what a reading companion is *for* is exactly as true out loud. Three of its
rules are actively wrong here, and they are the three that shape every answer:

- **`CITING THE ARTICLE — THE ONE RULE THAT MATTERS`** asks for a block id in square brackets on
  every claim. Spoken, `spya-k3m9qt` is six seconds of gibberish — and the dictation benchmark
  already showed a model reading that id aloud as *"Spire k three m nine q t"*.
- **`FORMAT`** asks for prose paragraphs and markdown links. Neither survives being spoken.
- **`LENGTH` — "two or three paragraphs"** is a good written answer and a monologue out loud. A
  reader cannot skim what they are being told.

What is carried over deliberately, because it is the product rather than the format: the reader is
here to read better, not to be read to. A voice that summarises the article for you has replaced the
reading, which is the one thing [vision.md](../project/vision.md) says this app is not for.

`tests/live.test.ts` asserts the live prompt is **not** the chat one, so reaching for it later fails
rather than quietly producing a companion that reads ids aloud.

### 3. An eighth tool, `show_passage`, because speech has nowhere to put a block id

This is the interesting one, and it is the answer to a real tension. Written chat puts ids in the
answer text and [`Cited.tsx`](../../src/web/Cited.tsx) turns them into something to press. Take the
ids out of a spoken answer and you have also taken away the thing that sends the reader back into
the article — which is the whole point of the app.

So the pointing leaves the words and becomes **its own channel**. The model talks and points at the
same time, the way a person with the book open would: it says *"the bit where he does the rainstorm
thought experiment"* and calls `show_passage(["spya-…"], why)` in parallel.

It is deliberately the cheapest tool it has — no model call, no store read, no network — so the
client honours it in the frame it arrives in. Everything else in the list makes a talking companion
go quiet for a second or two, and silence costs much more out loud than it does on a page.

## Two things exist only so this could be tested at all

A browser agent cannot grant a microphone permission — it is browser chrome, not page content, and
the two-pass dictation work stopped at exactly that line
([browser-testing.md](../project/browser-testing.md)). So:

- **`microphone: false` sends a silent synthetic track** built from an `AudioContext` oscillator at
  zero gain, which needs no permission. A muted `getUserMedia` track would not do — it is still a
  `getUserMedia` track and still prompts.
- **`say(text)` injects a typed turn** the way a spoken one arrives, via `conversation.item.create`
  + `response.create`.

Neither is a stub of the thing under test. They are two ways in to the same live session: same
token, same SDP exchange, same data channel, same events, same tools. Only the microphone itself is
left for a human.

### `seen` — every event type, handled or not

The hook counts every event `type` that arrives and the page prints the tally. That is the
instrument, not decoration. The event names were the part of this API most likely to be wrong in
anything we read: the pre-GA beta called the assistant's transcript `response.audio_transcript.*`
and the current API calls it `response.output_audio_transcript.*`. A handler written against the
wrong one produces a session that talks and shows nothing, with no error anywhere — so both
spellings are handled and the tally is how we found out which is real.

## What was verified, and how

**The session is honoured, not merely accepted.** Read back off the created session on 2026-08-31:
59,000 characters of instructions byte-identical to what was sent, all 8 tools, the 912-character
vocabulary as the transcriber's `prompt`, and `semantic_vad`. The echo is worth trusting here
because the same endpoint answers `400 Unknown parameter` to `wibble_not_a_real_field` — unlike
OpenRouter's transcription endpoint, which accepts a bogus field with a `200`
([dictation.md](../project/dictation.md)).

**The model list, not a doc page.** `gpt-realtime-2.1` was chosen after reading this account's own
`GET /v1/models`. Every tutorial written before mid-2026 names `gpt-realtime` or
`gpt-4o-realtime-preview`; the first was deprecated on 2026-07-20 and the second is already gone.

**The tests fail when they should.** Both load-bearing assertions in `tests/live.test.ts` were
mutation-checked: unflattening the tools reddens *"flattens every function"*, and dropping the
article from the instructions reddens *"contains the whole article"*.

**It ran, in Chrome, on 2026-08-31.** Connected silently, phase `live` in about five seconds, and
answered two typed turns about the article. The first turn called `show_passage(["spya-v2q8qk",
"spya-wepmnr"], "main claim and the assumption it challenges")` in 1ms while it was talking — so the
pointing channel works, and it is genuinely parallel to the speech. The second called
`search_article_words("qualia")` on our server in 97ms and answered *"He doesn't use the word
'qualia' in the article"* — correctly, from the tool result rather than from memory.

### What the run settled, and what it broke

**The event names are now measured rather than read.** `response.output_audio_transcript.delta`
fired 99 times in one turn; the beta spelling `response.audio_transcript.*` never appeared. The
fallback branch has been deleted — a branch no traffic can reach is not a safety net, it is a second
thing to keep in step. The run also confirmed `output_audio_buffer.started` / `.stopped`, which the
research could only find on a forum and which the documentation does not describe.

**And it found a real bug, which is what the spike was for.** The second turn produced a red error —
*"Conversation already has an active response in progress"* — a doubled `search_article_words` row,
and fifty React duplicate-key warnings.

The cause was mine and it is worth writing down, because the shape of it recurs: `answerTool` was
being called **from inside a `setTools` state updater**, as a way of checking "have we answered this
call id already?" against the list. A state updater must be pure, React invokes it twice in
development, and so the tool ran twice — two `function_call_output`s and two `response.create`s down
one channel.

The list could never have answered that question anyway, which is the deeper half: a tool still in
flight has not been appended to `tools` yet, so the guard was reading a collection that could not
contain the thing it was looking for. It is now a `useRef<Set<string>>` claimed synchronously before
any work starts.

Re-run in Chrome after the fix, two tool-provoking turns: no error box, three distinct tool rows for
three calls, and zero duplicate-key warnings. The **spike server's own log is the independent
witness** and it is the one worth keeping — before the fix it recorded `search_article_words` for
`"qualia"` twice inside one turn, and after it, one call per turn. A browser reporting that its
screen looks right is agreeing with the code; the server counting the requests it actually received
is not.

## What is missing

Each of these is a hole rather than a to-do, and none of them may be skipped before readers see this.

- **Nothing is metered.** No row is written, so `npm run cost` cannot see this spend. The two ways
  out are OpenAI's usage API after the fact, or forwarding the `response.done` events the browser
  already receives, which carry token counts.

  **Do not assume this is a fourth `Observer` method.** `Observer` in
  [`evals/declared-spend.ts`](../../evals/declared-spend.ts) has one method per *(account, wire)*
  pair — which is the right shape, and spideryarn2-df's split of it on 2026-08-31 is what shows
  that account and wire are separate questions rather than one. But every existing method is handed
  a response body **this process received**. Here the usage is seen only by the browser, so the
  missing piece is not a method signature, it is a way for a tab to report spend that our server
  must then believe. That is a different and larger question than the ones the register answers
  today, and pretending otherwise is how it gets built wrong.

  Doing it properly also means widening
  `ProviderAccount` (`"openrouter" | "anthropic"`) and `Wire`
  (`"messages" | "chat" | "embeddings"`) in [`src/models.ts`](../../src/models.ts), which is why
  these three files are in
  `ALLOWED` rather than in `DECLARATIONS` — **a `Declaration` for this call cannot currently be
  typed.**
- **Nothing caps a session.** A forgotten tab with a live connection open bills audio for as long as
  it stays open. A wall clock, an idle timeout and a per-reader ceiling all belong here.
- **Nothing is stored.** The transcripts exist only in the tab. Writing them into the thread through
  `beginTurn`/`finishTurn` ([`src/chat.ts`](../../src/chat.ts)) is the agreed shape and is the next
  substantial piece of work.
- **It is not in chat mode.** It lives on a throwaway page. The real control is a second button
  beside `DictationButton` in the composer, and it has to negotiate `mic-lock.ts` — one microphone
  per page, however many boxes have a button.
- **`show_passage` points at nothing.** The spike prints the ids; it does not scroll or highlight.
- **Nothing has been heard by a human.** Everything below the microphone is verified; the microphone
  itself, barge-in, and whether the voice is actually pleasant to talk to are not.

## Where the pieces are

| | |
|---|---|
| [`src/live.ts`](../../src/live.ts) | the session: the spoken prompt, the eight tools, the vocabulary, minting |
| [`src/web/live/useLiveConversation.ts`](../../src/web/live/useLiveConversation.ts) | the browser: WebRTC, the data channel, the tool loop |
| [`scripts/live-spike.ts`](../../scripts/live-spike.ts) | the spike's local-only server — `npm run live:spike` |
| [`src/web/preview-live.tsx`](../../src/web/preview-live.tsx) | the throwaway page |
| [`tests/live.test.ts`](../../tests/live.test.ts) | what crosses the seam, and the four silent failures |

## See also

[dictation.md](../project/dictation.md) · [ai-gateway.md](../project/ai-gateway.md) ·
[chat-tools.md](../project/chat-tools.md) · [vision.md](../project/vision.md) ·
[browser-testing.md](../project/browser-testing.md)
