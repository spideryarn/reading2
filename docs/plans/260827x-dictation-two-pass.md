# Dictation, twice: the browser for speed, a model for the words

**Status:** built 2026-08-27. Reviewed by GPT Sol twice — once on the plan (verdict *"not ready to
build"*, eight must-fixes and one should-fix) and once on the built code (verdict *"not ready to
land"*, seven more). What each review changed is at the bottom. The second one found the worse
bugs, which is exactly what [AGENTS.md](../../AGENTS.md) says to expect.

The microphone works. It is marked *unreliable* because for a day it did not, and the sticker
outlived the bug. This change takes the sticker off and replaces what is underneath it, because
the thing that was actually wrong with dictation was never the microphone — it was the
transcript.

Greg, 2026-08-27:

> It looks like right now it transcribes in realtime, which is neat, but often lower-quality.
> Perhaps we could do it twice, once showing in realtime so the user can see it's working, and
> then send it to a higher-quality transcription algorithm for the best-quality version? Or
> maybe that's overkill.
>
> As always, we're looking for the best balance of quality, then latency, then cost.
>
> We'll probably want to add microphone input in lots of places, and for it to work well on
> mobile etc, so design to be reusable.

Not overkill. The measurements below say the second pass is worth roughly a tenth of a cent and
two seconds, and it buys back the words that matter most — the ones this app is full of.

## What the measurements actually found

Everything in this section was run against OpenRouter's live API on 2026-08-27. The scripts and
the sample are checked in at [`evals/dictation/`](../../evals/dictation/README.md), because a
number nobody can re-run is a number nobody can argue with.

**The audio was `say -v Daniel` output, not a person, and one clip of it.** GPT Sol's review was
right that an earlier draft of this sentence claimed more than that supports. What it supports:

- **that a vocabulary prompt recovers proper nouns** — stable across every run, and the one
  thing this sample is genuinely good at, because the words it tests are words no transcriber
  has seen;
- **latency to an order of magnitude, and no better.** The table below has
  `gemini-3.1-flash-lite` at a 2.4s median; a re-run two hours later on the same machine gave
  8.8s with a 3.5–16.9s spread. Same code, same clip.

What it does not support: anything about accents, mumbling, a fan in the room, short
utterances — which is what most dictation actually is — or these models in general. The eval
README says so at more length and lists what would settle it.

The sample was 22.0 seconds of speech, encoded the way `MediaRecorder` encodes it — Opus in WebM
at 32 kbps, 95 KB.

### One: OpenRouter really does transcribe, two different ways

`POST /api/v1/audio/transcriptions` exists, with **19 transcription models** behind it
(`GET /api/v1/models?output_modalities=transcription`). Audio also goes through ordinary chat
completions as an `input_audio` content part, on **41 models**.

**Both take our recordings as they come off `MediaRecorder`.** `webm`, `m4a` and `mp3` all
returned a clean transcript. This is the finding that removes a whole workstream: there is no
transcoding step, no WAV re-encode, no `decodeAudioData` round trip. `webm` works on the chat
route too, *despite not being in the documented format list for it* — verified rather than
assumed, because the doc says `wav, mp3, aiff, aac, ogg, flac, m4a, pcm16, pcm24`.

### Two: the quality difference is context, not the acoustic model

| Route | Latency (median of 3) | Word error rate | Cost / 22s |
|---|---|---|---|
| `google/gemini-3.1-flash-lite` chat, **with a vocabulary list** | **2.4s** | **0.0%** (3 of 3 runs) | $0.00040 |
| `google/gemini-3.1-flash-lite` chat, bare prompt | 3.3s | 3.6–7.3% | $0.00038 |
| `google/gemini-3.5-flash-lite` chat, +vocabulary | 3.3s | 0.0–3.6% | $0.00037 |
| `google/gemini-3.7-flash` chat, +vocabulary | 5.1s | 0.0% | $0.00079 |
| `google/gemini-2.5-flash-lite` chat, +vocabulary | 2.8s | 1.8–3.6% | $0.00020 |
| `openai/gpt-transcribe` (dedicated STT) | 1.6s | 3.6% | — |
| `openai/gpt-4o-mini-transcribe` | 1.6s | 5.5% | ~$0 |
| `mistralai/voxtral-mini-transcribe` | 1.1s | 3.6% | $0.00105 |
| `openai/whisper-large-v3` | 13.5s, **5.5s to 35.8s** | 3.6% | $0.00016 |
| `nvidia/parakeet-tdt-0.6b-v3` | 0.6s | 9.1% | $0.00055 |
| `deepgram/nova-3` | 1.0s | 18.2% | $0.00157 |

Every dedicated speech-to-text model in that list mangled the two words the sample existed to
test. `Spideryarn` came back as *Spiderion*, *Spaderion*, *Spadarian*. The block id `spya-k3m9qt`
came back as *Spire K3M9QT*, *SPIRK3M9QT*, and from Deepgram as *"Spire k three m nine q t"*.

Gemini, handed a short list of this app's vocabulary, got both exactly right, on every run.
(The list sits in the *user* message, fenced — see finding 6 below, which is why.) The same model **without** that list made the same mistakes as everybody
else. So the second pass is not buying a better ear; it is buying the ability to be told what the
words are likely to be — which is a thing a dedicated ASR endpoint on OpenRouter cannot be told
at all, for the reason in the next section.

That matters more here than it would in most apps. This is a reading tool whose vocabulary is
*the article in front of the reader*, and the boxes we are putting a microphone in — chat, a
comment follow-up — have that article's glossary already loaded three feet away.

**`google/gemini-3.1-flash-lite` is the choice.** Fastest of the ones that scored zero, about a
**tenth of a cent a minute** ($0.00040 for 22 seconds is $0.0011/min — the first draft said a
twentieth and GPT Sol did the arithmetic), and on a gateway we already use.

### Three: the transcription endpoint silently ignores what it does not understand

`prompt` is OpenAI's parameter for exactly the biasing described above. Sent to OpenRouter's
`/audio/transcriptions`, it returns `200` and changes nothing — the transcripts with and without
were byte-identical. Confirmed by sending a field called `wibble_not_a_real_field`, which also
returned `200`.

So the dedicated endpoint cannot be told the vocabulary, and there is no error to tell you so.
This is [silent-success](../reusable/silent-success.md) with a `200` on it, and it is the reason
this feature goes down the chat route rather than the purpose-built one — which is otherwise
the obvious choice and would have been the wrong one.

## The shape of it

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

**One capture, everywhere, and it is ours.** That is the change that makes the rest possible.
Today the shared-track path is Chromium-only and Safari lets the recogniser open its own
microphone — which means on Safari there is no track for us to record, and therefore nothing to
send. Since WebKit permits one microphone source at a time, this is a choice rather than an
oversight: on Safari we can have live words *or* a recording, not both.

We take the recording. Which means:

| | live words while talking | good transcript on stop | level meter |
|---|---|---|---|
| Chrome / Edge 135+ | yes | yes | measured |
| Safari, iPad | no | yes | measured |
| Firefox | no | yes | measured |

Safari loses the live text it has today and gains a transcript that gets the words right.
Firefox gains dictation, which it has never had here — `supported` stops meaning "has Web Speech"
and starts meaning "has `getUserMedia`", so the button renders in one more browser than before.

The browser recogniser is now **decoration**: reassurance that the microphone is on and
something is being heard. The server pass is the truth, on every platform, and it overwrites
whatever the recogniser produced.

### Which vocabulary, and who assembles it

The client says **where** it is dictating. The server assembles the words.

```ts
POST /api/transcribe
{ audio: "<base64>", format: "webm",
  context: { kind: "profile" } | { kind: "article", slug: "..." } }
```

Not a list of terms from the client. Two reasons, and the second is the load-bearing one:

1. Adding a microphone to a new box should not require that box to know how to build a
   vocabulary. `{ kind: "article", slug }` is the whole of what a caller has to know.
2. A vocabulary is text that goes into a system prompt. Assembled on the server from the
   article's own glossary and title, it is *our* text about *the reader's own* article. Accepted
   from the client it is a string a caller chooses, sitting in a system prompt — which is a
   prompt-injection surface built on purpose, for no gain, since the server has the glossary
   already.

- `{ kind: "article", slug }` → the article's title plus its glossary entries' names and aliases,
  capped. This is the case that scores 0.0%.
- `{ kind: "profile" }` → the reader's own profile text. Their field's jargon, in their own
  spelling, which is exactly what they are about to dictate more of.

### What the reader sees while it happens

Greg, on the two-second gap between stopping and the good words arriving:

> Perhaps replace/disable the text box with a loading spinner? And/or just add the audio input at
> the cursor?

Both, and together they delete a problem rather than managing it. The plan before his note had a
rule for what to do if the reader edited the live text during the gap; with the box closed for
those two seconds there is no such thing as an edit during the gap, and the rule goes away.

- The box goes **`readOnly`, not `disabled`.** `disabled` moves the focus somewhere else and
  loses the caret, and the caret is the thing we are about to insert at. `readOnly` keeps focus,
  keeps the caret, and refuses typing.
- The strip says `Transcribing…` with a spinner.
- One span, always. The live words (where there were any) occupy `[from, to)`; on Safari and
  Firefox that span is empty and sits at the caret. The transcript **replaces the span**, which
  makes insertion and replacement the same operation with no branch between them.
- The caret lands after the inserted text, so the next thing typed follows it.

If the request fails: the box reopens, the live words stay where they are on Chromium, and
elsewhere the reader is told plainly and offered the audio — which is what
[`mic-recording.ts`](../../src/web/mic-recording.ts) already builds and which becomes genuinely
useful now, since "nothing came back" has a second way of happening.

### Reusable, which is a component and not an intention

Today the microphone is 350 lines inside `ProfileBox.tsx`. Three pieces come out of it:

| | what it is | what it owns |
|---|---|---|
| `useDictation` | the hook that exists today, plus the second pass | track, recogniser, tape, upload |
| `<DictationStrip>` | button, meter, timer, device name, picker, errors, spinner | nothing |
| `useDictationField` | glue for a text box | caret, the span, `readOnly` |

A box adopts dictation in about three lines:

```tsx
const dictate = useDictationField({ value, onChange, ref: box, context: { kind: "article", slug } })
<textarea {...dictate.boxProps} />
<DictationStrip {...dictate.stripProps} />
```

Wired up in this change: the two profile boxes (which have it now), **the chat composer** and
**the comment follow-up box**. The last two are where the win is largest, because those are the
boxes with an article — and therefore a glossary — in scope.

### The audio leaves the machine now, and we say so

The current design's stated selling point was that no audio of the reader's voice crossed
anything of ours. That is over, and it is a real reversal rather than an oversight, so
[reader-profile.md](../project/reader-profile.md) records it in those terms and one line by the
microphone tells the reader before they press it rather than after.

What is true of the audio: held in memory for the length of one request, base64'd into one
OpenRouter call, never written to disk by us, never logged, and gone when the request ends.
The same rule the rest of the app runs on — no article prose and no reader's words in a log
line — covers a transcript exactly as it covers a question.

## The things that will go wrong

1. **The model answers the question instead of transcribing it.** A reader dictating *"what
   does this paragraph mean?"* into a chat box is handing an instruction to a model. The system
   prompt forbids it in as many words, and a transcript is short and can be sanity-checked
   against the live text where there is one, but this is an LLM and the failure exists.
2. **Hallucination on silence.** Whisper is notorious for it and Gemini is not immune. A
   recording under the existing floor is not sent at all.
3. **The 60-second upstream processing timeout** on OpenRouter's audio path, and Vercel's 4.5 MB
   request body. At 32 kbps the recorder's existing five-minute cap encodes to ~1.2 MB, ~1.6 MB
   base64 — inside both, with room. The route caps anyway, because a cap you derive from a
   bitrate hint is arithmetic and not a guarantee — the lesson `mic-recording.ts` already
   learned the hard way.
4. **The provider pin.** All three existing OpenRouter calls send
   `provider: { order: ["anthropic"] }`. Sent with a Gemini model that is silently wrong —
   OpenRouter finds no Anthropic upstream, falls through, and answers. This call does not send
   it. Named here because it is exactly the failure `models.ts` warns about and the next person
   copying an existing call site will bring it along.
5. **`enumerateDevices` before permission.** Unchanged, and still the reason the picker opens
   only once a track is live.
6. **Chrome and `http://localhost`.** Greg wondered whether the earlier trouble was a
   permissions quirk. `localhost` *is* a secure context by exception, so `getUserMedia` and
   `SpeechRecognition` both work there — but the grant is keyed to the full origin **including
   the port**, and Vite's port moves. That is a plausible share of "it seemed to work better on
   spideryarn.com" and costs nothing to write down.

## Checking it, given that a broken transcript looks like a working one

- The two-pass replacement is the part that can be silently wrong, so the test is that the text
  in the box after a dictation is the *server's* text and not the recogniser's — pinned by
  making the two differ in a test double.
- `readOnly` during the gap, and the focus still in the box afterwards.
- The empty-span case (Safari, Firefox) inserting at the caret rather than at the end.
- A failed request leaving the live words alone rather than clearing the box.
- Vocabulary reaching the prompt: asserted on the request body, because a vocabulary that
  quietly stops being assembled returns a slightly worse transcript and nothing else.

## What GPT Sol's review changed

Run before any of this was built, on the plan above. Verdict: **not ready to build**, eight
must-fixes and one should-fix — *"the central design is plausible, but several gaps can
silently lose or replace reader text."* The full text is in
[260827x-dictation-two-pass-review-sol.md](260827x-dictation-two-pass-review-sol.md). Eight of the nine were
right and are built; here is what each one moved, because most of them are not visible in the
result.

1. **The probe had to keep its old place, and say so.** The plan's diagram opened
   `getUserMedia` first. That is exactly backwards: the `NOT_A_TRACK` probe *starts* the
   recogniser on a browser without the overload, so running it while we hold a track is the
   forbidden double capture. It stays first, and `abort()` runs **in the same synchronous turn**
   as the `start()` that provoked it — `start()` queues a task to ask for the audio, and the
   abort beats that task. Sol also made us soften the claim: "every capture is ours" is not
   quite true, because the probe briefly owns one.

2. **One microphone per *page*, not per hook.** *"Separate hook instances in chat and the
   comment dialog can otherwise open two tracks."* That stopped being hypothetical the moment
   the microphone went into more than one box — `/profile` alone has two, each perfectly correct
   on its own. [`mic-lock.ts`](../../src/web/mic-lock.ts) is the fix: a second claim asks the
   first to stop *properly*, keeping its words, and waits for its track to actually go.

   Writing it also surfaced a real bug the plan had no way to predict: a claim reaching `stop`
   through a ref stops *whatever session is running*, not the one it belongs to — so a device
   change stopped the session that was replacing it. Caught by
   `tests/dictation-recording.test.ts`; nothing on screen would have said a word.

3. **The recorder cap now ends the dictation.** It used to stop recording and let dictation
   carry on, and the saved file said it was only the beginning. Right for a souvenir, wrong for
   a source: the words after the cap would be transcribed from audio that does not contain them,
   and the result would replace the whole of what was said.

4. **The size cap was wrong by more than a factor of two, in the dangerous direction.** The plan
   sized it from the 32 kbps the recorder *asks* for. The recorder prefers AAC and on that
   container deliberately sends **no bitrate hint at all** — the hint is what made the encoder
   throw. At its measured 14 KB/s, five minutes is ~5.6 MB base64, and **Vercel refuses a body
   over 4.5 MB before any of our code runs**: no auth, no copy, no log line, no sentence for the
   reader. The caps now live in [`dictation-limits.ts`](../../src/dictation-limits.ts), shared by
   both ends, and the recorder stops below the request limit rather than at a wall.

5. **`readOnly` does not make the replacement race-free**, which the plan implied and Sol
   itemised: it stops typing and nothing else. It does not stop a pending profile save landing
   its older response into the same controlled value, and **it does not stop Enter submitting a
   form** — which in the chat composer would have posted the recogniser's rough guess a moment
   before the good words arrived. So: submit is guarded in both boxes, and the span carries the
   text we put there so a replacement can prove it is replacing its own words. Sol was also
   right that "`readOnly` keeps focus" was false — clicking a separate button has already
   blurred the box — so the focus and caret are now put back explicitly.

6. **A system prompt is an instruction, not a validation.** *"A dictated question ending in `?`
   is a valid transcript"*, so no check on the shape of the words can tell a transcript from an
   answer. The call now asks for `{ transcript }` as a strict JSON schema with
   `require_parameters: true`, so a model that decides to answer has to put its answer in a
   field labelled `transcript` — a much narrower failure than prose arriving where prose was
   asked for. And the vocabulary moved into a fenced `<vocabulary>` block in the *user* message:
   glossary terms come out of articles this app did not write.

7. **`res.on("close")`, not `req.on("close")`.** The same trap `sse` documents two hundred lines
   further up the same file, walked straight into. `readBody` consumes the request stream, so
   the request's "close" has already fired before the model is called — every transcription
   would have aborted itself immediately.

8. **The privacy promise was stronger than the implementation.** *"That sentence can only
   describe Spideryarn: provider retention varies unless routing enforces it."* The call now
   sends `provider: { zdr: true }`, which restricts routing to zero-data-retention providers, so
   "your voice is not stored" is a claim about the whole path rather than about our half of it.

9. **The measurements claimed more than one synthetic clip can support**, and the cost
   arithmetic was out by a factor of two. Both corrected above; the scripts and the sample are
   checked in.

The one thing not taken: Sol suggested using an independent ASR result as a guard against a
model that answers instead of transcribing, on Safari and Firefox where there is no rough text
to compare against. That is a second model call on every dictation to defend against a failure
we have not seen once, and the schema already narrows it. **Accepted as residual risk**, which
is what Sol's own alternative wording allowed for.

## And what the second review changed

The code review, run on the built diff, and it is the one that earned its keep: it found five
things the plan-stage review could not have, because they are about what the code does rather
than what it intends. Full text in
[260827x-dictation-two-pass-code-review-sol.md](260827x-dictation-two-pass-code-review-sol.md).

**The one that would have cost the whole feature.** `vocabularyFor` imported `loadGlossary` from
`src/api.ts` — the filesystem-era seam — while every request-path read in this app goes through
`src/store/index.ts`, which is owner-filtered and picks Postgres or the filesystem. On the
deployed app that lookup fails for every article, is swallowed by the `try` that makes the
vocabulary deliberately best-effort, and **silently removes the entire quality improvement this
change exists for**. The transcripts would have come back a bit worse and nothing anywhere would
have said why. `tests/transcribe.test.ts` mocked the same wrong module, so it blessed the mistake
instead of catching it — which is the sharpest example this repo has of a test agreeing with the
code because it shares its assumption.

**Firefox had a button that did nothing.** `supported` was widened to mean "can open a
microphone", and three documents said so — and `start()` still opened with `if (!Ctor) return`.
The one browser this change was advertised as adding got a control that was present and dead.

**The provider's error body was being logged**, 300 characters of it, with a comment explaining
why that was safe. It is not: a provider may echo the request back, and the request here carries
a reader's voice and possibly a transcript of what they just said.
[logging.md](../project/logging.md) states the rule and names the two places that had already
made this mistake; this would have been the third.

**The microphone lock lost a three-way race.** A claims, B claims (stops A, waits for it), C
claims — and C stopped B, which had no track yet and so released instantly, letting C open a
device while A was still live. The comment claiming C "queues behind us" was false. It is a queue
now rather than a single holder, so each claim waits on the whole chain behind it.

**The probe's synchronous abort was not the guarantee the comment claimed.** The spec promises
`abort()` disconnects and fires a later `end`; it does not promise the device is released before
the next line runs. The probe now waits for that terminal event, bounded, once per page.

Six smaller things were fixed with it: the context is captured when a dictation starts rather
than read when it finishes; a stale session no longer fires the live `onEnd`; an unmount aborts
an upload in flight; `finish_reason: "length"` and a refusal are rejected rather than pasted into
somebody's box; `audio/aac` stopped being labelled `m4a`; and the promise about the reader's
voice moved onto the button, because it had been written into the profile box alone while chat
and the comment dialog grew microphones with no notice at all — and this document had claimed
otherwise.
