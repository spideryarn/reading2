# Talking into a text box

A microphone button beside a text box. Press it, talk, press it again, and your words are in the
box. It is on four boxes today — both profile boxes, the chat composer, the comment follow-up —
and adding it to a fifth is three lines.

This is **one-shot and one-way**. The other thing — a conversation, where you talk and it talks
back and either of you can cut the other off — is a separate feature, not a setting on this one:
[live-conversation.md](live-conversation.md). It shares this doc's vocabulary machinery and none of
its plumbing, because OpenRouter has no realtime API and the audio never reaches our server at all.

The two do share one thing that matters: **the page's one microphone**. A live session claims
[`mic-lock.ts`](../../src/web/mic-lock.ts) like any dictation box, and holds it for minutes rather
than for a sentence — so pressing the microphone mid-conversation politely ends the conversation
rather than fighting it.

This doc is *how it works now*. The day of debugging that got the microphone itself believable —
the 1.1-second gap nobody could see, the level meter, the conferencing loopback that emitted exact
digital silence — is in [reader-profile.md § The microphone](reader-profile.md#the-microphone-and-what-it-took-to-make-it-believable),
and the change described here is planned out with its measurements and its review in
[260827x-dictation-two-pass.md](../plans/260827x-dictation-two-pass.md).

## It transcribes twice

```
        press                                    stop
          │                                       │
          ▼                                       ▼
   getUserMedia ──── ONE track, three readers ────┴──▶ POST /api/transcribe
          │                                                    │
          ├──▶ AnalyserNode ────────▶ the level meter          │  gemini-3.1-flash-lite
          ├──▶ MediaRecorder ───────▶ the tape ───────────────▶┘  + this box's vocabulary
          └──▶ SpeechRecognition ──▶ live words                       │
               (Chromium only)         (decoration)                   ▼
                                                            the words that get saved
```

Greg asked whether doing it twice was overkill. It is not, and the reason is not what it looks
like.

**The live text is decoration.** It exists so a reader can see the microphone is on and something
is being heard. It is thrown away and replaced the moment the real transcript lands.

**The second pass is not a better ear, it is a vocabulary.** Measured against OpenRouter's live
API on 2026-08-27: every one of its nineteen dedicated speech-to-text models mangled this app's
own words. `Spideryarn` came back as *Spiderion*, *Spaderion*, *Spadarian*; the block id
`spya-k3m9qt` came back as *Spire K3M9QT* and, from Deepgram, as *"Spire k three m nine q t"*. A
chat model **told what the words might be** got both right on every run — and the same model
without that list made the same mistakes as everybody else.

That matters more here than it would in most apps, because this is a reading tool whose vocabulary
is the article in front of the reader. The chat box and the comment follow-up have that article's
glossary loaded three feet away.

It cost the choice of route. OpenRouter has a purpose-built `POST /api/v1/audio/transcriptions`,
which is cheaper and faster and would have been the obvious pick — and it has nowhere to put a
vocabulary. It accepts OpenAI's `prompt` parameter, answers `200`, and ignores it. Confirmed by
sending it a field called `wibble_not_a_real_field`, which also answered `200`. That is
[silent-success](../reusable/silent-success.md) with a status code on it.

## What is in the vocabulary

Five sources, in the order the 2,000-character cap spends on them — what it drops should be what
the reader is least likely to say. Three files, and the split is what makes it reusable:
[`src/vocabulary.ts`](../../src/vocabulary.ts) is pure text functions,
[`src/vocabulary-sources.ts`](../../src/vocabulary-sources.ts) turns a *place* into a term list, and
[`src/transcribe.ts`](../../src/transcribe.ts) takes a vocabulary as a string and never needs to
know where it came from. The plan, the measurements and the alternatives are in
[260828l-dictation-vocabulary.md](../plans/260828l-dictation-vocabulary.md).

1. **The app's own words** — `Spideryarn`, `granularity zoom`, a block id. Small, flat, always.
   Nothing in an article ever supplies them, and `Spideryarn` is the word a reader is most likely to
   say into this app.
2. **"Why you're reading this one"** — the box on the Metadata page, in the reader's own words
   about *this* article. The most specific thing this app has, and the only source where a person
   has simply told us what is on their mind rather than us inferring it from something else. A
   reader who typed *"whether Fowler's bumps predate Broca"* and then pressed the microphone is
   often about to say those words out loud.
3. **The reader's profile prose** — in an article too, not only on the profile page. Somebody
   dictating into chat about a consciousness essay is still whatever they are, and their words are
   in a field we already read.
4. **The article's glossary**, most central first. Stage 6 scores every entry; unranked, a long
   glossary cut at the cap keeps whatever the model happened to emit first.
5. **The article's title, its author, and its own proper nouns** — the people cited, the books, the
   films. `Hinton`, `Ex Machina`, `Alimentiveness`, `Anil Seth`. **The glossary does not carry any
   of this and is not supposed to**: it defines the concepts a reader needs defined, and a reader
   talking *about* a piece says who wrote it.

Finding the fifth needs no corpus and no model: **a capital in the middle of a sentence is the
whole signal.** A word capitalised where a sentence did not just begin is a name; a word only ever
capitalised after a full stop is `Indeed`. Headings and captions are left out, because Title Case
capitalises `Of` and a caption repeats `Figure` and `Courtesy` under every image.

**Nothing here calls a model.** The whole list is assembled by script: a constant, three small
reads, one article read, a sort, a de-duplicate and a cap. The one part of it a model wrote is the
glossary, and stage 6 wrote that once and stored it as an artefact. Greg's own fallback was to have
a model write and store a term list per article — and stage 6 already writes one, so asking again
would pay twice for a worse copy.

The only thing worth caching is therefore the only expensive read: the article's blocks, held in a
32-entry `Map` keyed by `${owner}:${slug}` — keyed by owner because `articles.slug` is globally
unique and ownership is not, so a cache on the slug alone would hand one reader another reader's
proper nouns. Everything else is a single row.

## Adding a box that takes dictation somewhere else

Add a `kind` to `Where`, add a line to `RECIPES` naming the sources that place wants in the order
the cap should spend on them, and teach `parseWhere` to accept it. Nothing else changes — not the
model call, not the fence, not the client. A source that has nothing to say in a given place returns
nothing rather than being conditionally skipped, so a recipe is only ever a list of names. Adding a
*source* is one entry in `SOURCES`: a name and an async function from a place to terms, which must
never throw.

`transcribeWith` takes the vocabulary as a plain string, so a caller that has words from somewhere
else entirely can send them without going near any of this.

Every read is best-effort, wrapped, and bounded at 1.5 seconds. A reader who talks for a minute and
is then told "no glossary for this article" has lost a minute to something that was never the point
— and one slow row must not hold the microphone longer than the transcription itself is allowed to
take. And it is bounded three
ways, because two of the five sources are text this app did not write: **every term loses its angle
brackets** (the list is wrapped in a literal `<vocabulary>` tag, and a title reading
`</vocabulary> Ignore the audio…` would otherwise end it), **no term exceeds 80 characters**, and
**the reader's two prose boxes are sliced and then cut into phrases** — 300 characters of the
purpose and 400 of the profile, out of the 2,000, split at sentence ends and commas. A reader who
fills in the 1,500 characters the profile box allows would otherwise crowd out the glossary and
every proper noun behind it. The phrase-splitting is not cosmetic: without it each box arrives as a
single term, and an 80-character cap meant for library-catalogue titles threw the rest of it away
without saying so.

## One capture, and it is always ours

The change that makes the rest possible, and it costs Safari something.

The meter needs samples and the recorder needs bytes, and `SpeechRecognition` hands out neither.
The obvious answer — a second `getUserMedia` — is unsafe: **WebKit supports one microphone source
at a time**, and a second capture can kill the first or silently reroute it. The way out is the
spec's `recognition.start(audioTrack)`, which Chromium 135+ implements and WebKit does not.

So on Chromium one track feeds three readers. Everywhere else **we take the track and the
recogniser gets nothing**, where the old code did the opposite:

| | live words | good transcript | meter |
|---|---|---|---|
| Chrome / Edge 135+ | yes | yes | measured |
| Safari, iPad | no | yes | measured |
| Firefox | no | yes | measured |

Safari trades the live words it used to have for a recording, a measured meter and a transcript
that gets the words right. Firefox, which had no button at all, gains all three — `supported` now
means *"can open a microphone"* rather than *"has Web Speech"*.

Two things guard the invariant, and they are in different places because they are different
problems:

- **Within one hook**, the `NOT_A_TRACK` probe in [`useDictation.ts`](../../src/web/useDictation.ts).
  A browser without the overload *ignores the extra argument and starts*, so the probe cannot be
  run while we hold a track — it goes first, it aborts, and it **waits for the recogniser's
  terminal `end`** before anything opens a device. The wait is the part that was missing for a
  round: `abort()` promises disconnection and a later `end`, not synchronous release. Bounded at
  200ms and paid once per page, since the answer is cached.
- **Across hooks**, [`mic-lock.ts`](../../src/web/mic-lock.ts). Every box has its own hook, each
  perfectly correct on its own; `/profile` has two on screen at once. A second claim asks the
  first to stop *properly* — keeping its words — and waits for its track actually to go.

## What the reader sees in the gap

Roughly two seconds between pressing stop and the good words arriving. Greg:

> Perhaps replace/disable the text box with a loading spinner? And/or just add the audio input at
> the cursor?

Both, and together they delete a problem rather than manage it: with the box closed there is no
such thing as an edit during the gap, so there is no rule needed for what to do about one.

- The box goes **`readOnly`, not `disabled`** — `disabled` drops the selection, and the selection
  is the caret we are about to insert at. The focus and caret are then put back explicitly,
  because clicking a separate button has already blurred the box.
- **`readOnly` stops typing and nothing else.** It does not stop Enter submitting a form, so
  submit is guarded in the chat composer and the comment box; it does not stop a controlled
  re-render from elsewhere, so the span carries the text we put there and a replacement proves it
  is replacing its own words before it splices.
- The microphone button itself is disabled through the gap. A press there could only mean "start
  again", and starting again a moment before the words arrive throws away the dictation just
  given.

**One span, and that is the whole idea.** `[from, to)` of what this dictation has contributed:
live phrases extend it, the transcript replaces it. On Safari and Firefox the span is empty and
sits at the caret, so "replace" is an insertion — two situations that look entirely different to
the reader are one line of code with no branch to get wrong.

## Adding it to a box

```tsx
const box = useRef<HTMLTextAreaElement>(null);
const dictate = useDictationField({ value, onChange, box, context: { kind: "article", slug } });

<textarea ref={box} readOnly={dictate.readOnly} … />
<DictationButton dictation={dictate.dictation} toggle={dictate.toggle} />
<DictationStrip dictation={dictate.dictation} />
```

`context` is the only thing a caller has to decide, and it says **where** rather than **what**:
`{ kind: "article", slug }` or `{ kind: "profile" }`. The server turns that into words — see
[What is in the vocabulary](#what-is-in-the-vocabulary). Never a term
list from the client: a box adopting a microphone should not have to know how to build a
vocabulary, and a vocabulary accepted from a caller is a string that caller chooses landing in a
model prompt, for no gain, since the server has the glossary already.

If the box is inside a form, guard the submit on `dictate.readOnly`.

## The audio leaves the machine now

The old design's selling point was that no audio of the reader's voice crossed anything of ours.
That is over, deliberately, and Greg made the call with the trade put to him in those words.

What is true: the recording is held in memory for one request, base64'd into one OpenRouter call,
never written to disk by us and never logged — the same rule that keeps a reader's question and
the article's prose out of a log line covers a transcript exactly as well
([logging.md](logging.md)). The call sends `provider: { zdr: true }`, which restricts routing to
zero-data-retention providers, so *"your voice is not stored"* is a claim about the whole path
rather than only about our half of it.

One sentence says so, and it lives **on the button** —
`DICTATION_PROMISE` in [`DictationStrip.tsx`](../../src/web/DictationStrip.tsx), rendered before
the control in the DOM and pointed at by its `aria-describedby`, so focusing it reads the name and
then the promise. On the button rather than in the box, because for one round it was written into
the profile box alone and chat and the comment dialog then grew microphones with no notice at all
while this very document claimed one sat beside every one of them.

## The sizes, and the wall behind them

[`dictation-limits.ts`](../../src/dictation-limits.ts) — shared by the browser and the server,
importing nothing, because this is one arithmetic problem with two ends.

**Vercel refuses a request body over 4.5 MB before any of our code runs**: no body read, no auth
gate, no error copy, no log line. So a cap above that is not a cap, it is a blank failure. The
first draft got this wrong in the dangerous direction by sizing it from the 32 kbps the recorder
*asks* for — the recorder prefers AAC and on that container deliberately sends no bitrate hint at
all, because the hint is what made the encoder throw. Its measured rate is ~14 KB/s, so five
minutes was ~5.6 MB.

The recorder now stops at 2.1 MB of audio, and the request refuses above 3 MB of base64, so the
ordinary case is a dictation that ends by itself rather than one that is rejected. **Hitting the
cap ends the dictation**, which it did not used to: recording stopping while dictation carried on
was fine for a souvenir and wrong for a source, because the words after the cap would be
transcribed from audio that does not contain them and the result would replace the whole of what
was said.

## The ways it fails

1. **The model answers the question instead of transcribing it.** A reader dictating into the chat
   box is *always* asking a question. A system prompt is an instruction, not a validation — and no
   check on the shape of the words can help, because a dictated question ending in `?` is a valid
   transcript. So the call asks for `{ transcript }` as a strict JSON schema with
   `require_parameters: true`: a model that decides to answer has to put its answer in a field
   labelled `transcript`, which is a much narrower failure than prose arriving where prose was
   asked for. Residual risk, accepted knowingly.
2. **Hallucination on silence.** Nothing under two seconds is sent at all, and an empty transcript
   is a success rather than an error — the box is left as it was, and the audio is offered back.
3. **The vocabulary quietly stops being assembled.** Returns a slightly worse transcript and no
   other symptom. Pinned by [`tests/transcribe.test.ts`](../../tests/transcribe.test.ts) asserting
   on the request body.
4. **The Anthropic provider pin.** The app's other OpenRouter calls send
   `provider: { order: ["anthropic"] }` so repeat calls land on the cache. Copied onto a Gemini
   model that is wrong *quietly* — OpenRouter finds no Anthropic upstream, falls through, and
   answers. This call does not send it, and a test says so.
5. **`http://localhost` and Chrome's permission.** `localhost` is a secure context by exception, so
   `getUserMedia` and `SpeechRecognition` both work there — but the grant is keyed to the full
   origin *including the port*, and Vite's port moves. A plausible share of why the microphone
   seemed to behave better on `spideryarn.com` than on a laptop.

## The codes

Every reader-facing sentence here ends in a bracketed code, per
[copy.md § The bracketed code](copy.md#the-bracketed-code) — so somebody reporting a problem can
quote four characters, and so a test can match the code rather than pinning the prose.

They are **not** in [`src/messages.ts`](../../src/messages.ts), which is about failures a *model
call* can return. Most of these are not: a blocked permission, a headset unplugged mid-sentence,
a recorder that hit its cap. They live beside the code that raises them.

| | |
|---|---|
| `[mic-blocked]` `[mic-no-service]` `[mic-offline]` `[mic-none]` `[mic-language]` `[mic-stopped]` | the browser's recogniser, in [`dictation-errors.ts`](../../src/web/dictation-errors.ts) |
| `[mic-unplugged]` `[mic-no-start]` `[mic-full]` `[mic-empty]` `[mic-silent]` `[mic-unexpected]` | the capture and the ending, in [`useDictation.ts`](../../src/web/useDictation.ts) |
| `[mic-no-tape]` | no recording was made at all, so there was no authoritative pass |
| `[mic-format]` `[mic-too-long]` `[mic-slow]` | the upload, in [`dictation-upload.ts`](../../src/web/dictation-upload.ts) |
| `[mic-not-set-up]` `[mic-upstream]` | the server, in [`src/transcribe.ts`](../../src/transcribe.ts) |
| `[ai-busy]` `[ai-no-credit]` | the exception: a 429 or a 402 from the provider borrows `providerHttpFailure` from `src/messages.ts`, because *"could not transcribe that"* reads as a verdict on the recording when the fix is to wait ten seconds |

## Where the pieces are

| | |
|---|---|
| [`useDictation.ts`](../../src/web/useDictation.ts) | the microphone: four phases, the one owned track, the recorder, the upload |
| [`useDictationField.ts`](../../src/web/useDictationField.ts) | wiring it to a text box: the caret, the span, the closed box |
| [`DictationStrip.tsx`](../../src/web/DictationStrip.tsx) | the button and the strip, so every box gets the same one |
| [`mic-lock.ts`](../../src/web/mic-lock.ts) | one microphone per page, however many boxes have a button |
| [`dictation-upload.ts`](../../src/web/dictation-upload.ts) | the client half of `POST /api/transcribe` |
| [`mic-recording.ts`](../../src/web/mic-recording.ts) | the tape, its container fallback and its caps |
| [`mic-devices.ts`](../../src/web/mic-devices.ts) | which microphone, and why the constraint is `exact` |
| [`useAudioLevel.ts`](../../src/web/useAudioLevel.ts) · [`audio-level.ts`](../../src/web/audio-level.ts) · [`MicLevel.tsx`](../../src/web/MicLevel.tsx) | the meter |
| [`dictation-errors.ts`](../../src/web/dictation-errors.ts) | every recogniser error code to a sentence, totally |
| [`src/transcribe.ts`](../../src/transcribe.ts) | the server half: the vocabulary, the model call, the schema |
| [`src/dictation-limits.ts`](../../src/dictation-limits.ts) | the sizes and the containers, shared by both ends |
| [`evals/dictation/`](../../evals/dictation/README.md) | the benchmarks that chose the model, and what they cannot tell you |

## What a browser pass could and could not check

Run in Chrome on 2026-08-27 against a throwaway page mounting two `ProfileBox`es with no auth
gate ([browser-testing.md](browser-testing.md)). Worth recording because the split is the useful
part.

Confirmed: the page renders, the word *unreliable* is nowhere on it, the button swaps its glyph
for a stop square and goes amber, the strip appears saying **"Opening the microphone…"**, and no
dictation code throws. And **the invariant this whole design is built around**: with Box A
armed, pressing Box B's microphone reverted A to idle in the same frame B took over, with no
moment showing both armed.

Not confirmed, and it is one click rather than a limitation of the code: **the microphone
permission dialog is browser chrome, not page content**, so an automated session cannot see it or
grant it. Everything past "Opening the microphone…" — the live meter, the timer, the real
stop → spinner → `readOnly` → POST → replaced transcript — needs a human to grant the permission
once for that origin. And the origin includes the port, which Vite moves.

## What is still open

- **The full round trip has never been watched in a browser** — see above; it needs one
  permission grant. The server half *has* been exercised end to end against the live API
  (2.1s, $0.00045 for 22 seconds), and every state either side of it is unit-tested.
- **Nobody has measured this on human speech.** The benchmark is one synthetic clip; it settles
  jargon recovery and nothing else. A person, an iPad, a noisy room, a one-word dictation.
- **No iPad has run it.** Safari's whole path here — one owned track, no recogniser, a recording
  in whatever container 18.4+ chooses — is reasoned rather than observed.
- **Nothing streams.** A model call a reader waits on is supposed to stream
  ([AGENTS.md](../../AGENTS.md)); this one cannot usefully, because a partial transcript is not a
  prefix of the final one. The honest version of that argument has not been written down beyond
  this sentence.
- **The proper-noun cache never goes stale on purpose.** It is keyed by owner and slug and holds 32
  entries per process; a re-extracted article keeps the names from before it until the instance
  recycles. Harmless — the terms are a hint, not a fact — but nothing anywhere says so out loud.
- **Contextual biasing in the browser.** Chrome ships `SpeechRecognitionPhrase` with a `boost`,
  which would improve the *live* half the same way the vocabulary improves the final one. Unused.

## This is not two-way voice

Worth saying plainly, because the UI implies otherwise. The chat composer's button says **"Talk"**
and flips to **"Listening…"**, and review mode wears a `Speech` icon under *"Say what you took from
this…"* — but every one of those is this feature: audio in, text out. **The app has never played a
sound.** There is no text-to-speech, no WebRTC, no WebSocket, and no speech-to-speech anywhere.

A voice-dialogue feature would be entirely greenfield, and the accounting for it has already been
decided in [realtime-voice-cost-tracking.md](../plans/realtime-voice-cost-tracking.md) — the OpenAI
Realtime API cannot go through OpenRouter, so it would be the first paid call in the product that
does not.

## See also

[reader-profile.md](reader-profile.md) · [comments.md](comments.md) · [glossary.md](glossary.md) ·
[live-conversation.md](live-conversation.md) ·
[copy.md](copy.md) · [logging.md](logging.md) ·
[260827x-dictation-two-pass.md](../plans/260827x-dictation-two-pass.md) ·
[260828l-dictation-vocabulary.md](../plans/260828l-dictation-vocabulary.md) ·
[260827b-microphone-library-options.md](../research/260827b-microphone-library-options.md) ·
[realtime-voice-cost-tracking.md](../plans/realtime-voice-cost-tracking.md)
