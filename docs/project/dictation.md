# Talking into a text box

Up: [reading-view-overview.md](reading-view-overview.md)

A microphone button beside a text box. Press it, talk, press it again, and your words are in the
box. It is on nine boxes today — both profile boxes, the chat composer, the comment follow-up, the
annotate box, the quiz answer box ([quiz.md](quiz.md)), the Feedback dialog
([feedback.md](feedback.md)), the note under an Illustrated picture
([illustrated.md](illustrated.md#steering)) and the command bar's box
([reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar)) — and adding
it to a tenth is three lines.

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
          ├──▶ AnalyserNode ────────▶ the level meter          │  openai/gpt-transcribe
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
is the article in front of the reader. The chat box, the comment follow-up and the quiz answer box
have that article's glossary loaded three feet away — and the quiz box most of all, since a question
set from the piece is asking the reader to say the piece's own words back.

It cost the choice of route, **for eleven days**. OpenRouter has a purpose-built
`POST /api/v1/audio/transcriptions`, which is cheaper and faster and would have been the obvious
pick — and on 2026-08-27 it ignored the field OpenAI provides for exactly this. It accepted
`prompt`, answered `200`, and changed nothing. Confirmed by sending it a field called
`wibble_not_a_real_field`, which also answered `200`. That is
[silent-success](../reusable/silent-success.md) with a status code on it, and it is still true of
`prompt`.

**That is narrower than "it cannot be told", which is what this doc said until 2026-09-03.** Some
providers have their own biasing parameter under `provider.options` — Deepgram's `keyterm`, up to a
hundred terms, and Groq's own `prompt` — and nothing here had ever tried one. So the dedicated route
was unmeasured rather than ruled out.

**It got measured on 2026-09-07, and that sentence is why dictation is on the transcription
endpoint today.** `openai/gpt-transcribe` takes a `keywords` array, sent through
`provider.options.openai`, and OpenRouter forwards it: the clip that says *Spideryarn* comes back
"Spiderrion" without it and right with it, identically through OpenRouter and through OpenAI
directly. The evidence had to be the transcript changing rather than the `200`, for exactly the
reason the `wibble_not_a_real_field` paragraph gives.
[260907c](../plans/260907c-dictation-onto-an-openai-transcriber.md); the probe is
[`evals/dictation/probe-stt-routes.ts`](../../evals/dictation/probe-stt-routes.ts). **The rest of
this section is about the chat route and is kept as the record of why that was the right call for
eleven days.**

## Why not OpenAI

Asked properly on 2026-09-03 — [260903i](../plans/260903i-which-model-transcribes-dictation.md) —
because the first bake-off never had. It gave the Gemini models a vocabulary and everybody else
none, so it settled the *route* and left the *model* confounded.

The answer is that `openai/gpt-audio` and `openai/gpt-audio-mini` are not reachable from here, for
two reasons that are both about our request rather than their ears. **Neither has a
zero-data-retention endpoint on OpenRouter**, and `zdr: true` is the flag that lets the sentence on
the button say a reader's voice is not stored — so reaching them means dropping a published promise
([privacy.md](privacy.md)), which is Greg's call and not a benchmark's. And **OpenAI's
`input_audio` rejects webm**, which is what `MediaRecorder` produces; a wav in the same request gets
a `200`. Adopting them would need a transcode on the request path, in front of the one call a person
is sitting and waiting for.

Both facts are measured, not read, and re-measuring them is a minute: `npm run
eval:dictation-gate`. Run it before believing any leaderboard about this feature, and run it again
if either fact changes.

> **Both facts still hold, and dictation went to OpenAI anyway — through a different door.**
> On 2026-09-07 it moved to `openai/gpt-transcribe` on **`/v1/audio/transcriptions`**, which takes
> webm and takes a `keywords` array, so neither the transcode nor the chat endpoint's refusals apply.
> Greg made the call the paragraph above reserves for him, and the published promise was dropped:
> OpenRouter does not apply routing preferences or `zdr` on that endpoint, so a `zdr: true` there is
> accepted rather than refused and backs nothing. (It does forward `provider.options`, which is how
> the vocabulary gets through — the block is not discarded, the *routing* half of it is not applied.)
> [260907c](../plans/260907c-dictation-onto-an-openai-transcriber.md) and
> [privacy.md § Where a reader's voice goes](privacy.md#where-a-readers-voice-goes). **Everything in
> this section is about the chat endpoint and is kept because it is still true of it** — that is why
> the transcription endpoint was worth trying at all.

Among what is reachable, `gemini-3.1-flash-lite` stayed — and the finding worth carrying out of that
plan is not about models at all. **Given its vocabulary, every candidate got every hard term right,
and the incumbent made no word errors at all.** The differences that first looked like a better ear
turned out to live entirely in the three clips whose words nobody had, which measures how a model
guesses rather than how it hears. So model choice is not what limits this feature; the vocabulary
is, which is [260828l](../plans/260828l-dictation-vocabulary.md)'s subject and not this one's.

Two things did survive: **the newer sibling is worse** (`3.5-flash-lite` was the only arm to put
errors into the clip with no jargon in it), and **the flash tier cannot be had at this speed** — it
spends reasoning tokens before transcribing and that endpoint refuses to turn them off.
`DICTATION_MODEL` in [`src/models.ts`](../../src/models.ts) carries the short version beside the
line it would change; the plan owns the numbers.

## The ums come out, and nothing else does

Greg, 2026-09-05: *"The microphone input (eg for Feedback dialog box) sometimes includes superfluous
ums and ahs. Can we tweak the prompt or otherwise to ignore/remove these?"*

The answer turned out to be **or otherwise**.
[`src/dictation-fillers.ts`](../../src/dictation-fillers.ts) deletes a closed list of hesitation
sounds from the transcript after `tidy()`, and the whole of its design is that **it can only
delete** — never add a word, never reorder one, never choose a different one — which is a property a
test asserts rather than an intention a comment claims.

The prompt was the obvious lever and is not the one taken. The argument was written against the
`SYSTEM` prompt this file used to send — one long argument that the model is a transcriber and must
not be helpful, into which *"remove the filler words"* would have been an editing instruction in a
prompt whose one job is to refuse to edit. The failure it invites — a fluent paraphrase — is
indistinguishable from a good transcript by any check that can be written. **Since 2026-09-07 there
is no prompt to put it in at all**, so the lever is not merely unwise, it is absent: the
transcription request carries a model, the audio and a `keywords` array. Meanwhile the industry does
not use prompts for this either: Deepgram, AssemblyAI, Speechmatics and Gemini's own transcription
API all expose it as a *parameter*, and none of those was reachable through OpenRouter's chat
route.

**GPT Sol disagrees**, thinks the prompt is worth trying, and is probably right that it should be
measured — though on the current route there is no prompt to try it in, so the question has become
whether `gpt-transcribe` exposes a parameter for it, which nobody here has looked up. What that
needs either way is an audio corpus with real hesitation in it — plus controls for `err`,
`ER`, `uh-huh` and a deliberate *"Ah"* — and that corpus does not exist yet. It is the named next
step in [260905c](../plans/260905c-dictation-filler-words-and-mic-offline.md), which also carries
what is deferred: stutters, `like` and `you know`, and the fact that nothing here knows whether the
reader was speaking English at all.

## What is in the vocabulary

Five sources, in the order the 2,000-character cap spends on them — what it drops should be what
the reader is least likely to say. Three files, and the split is what makes it reusable:
[`src/vocabulary.ts`](../../src/vocabulary.ts) is pure text functions,
[`src/vocabulary-sources.ts`](../../src/vocabulary-sources.ts) turns a *place* into a term list, and
[`src/transcribe.ts`](../../src/transcribe.ts) takes a vocabulary as a **list of terms** and never
needs to know where it came from — a string until 2026-09-07, when the terms moved into `keywords`
and joining them stopped being anybody's job. The plan, the measurements and the alternatives are in
[260828l-dictation-vocabulary.md](../plans/260828l-dictation-vocabulary.md).

1. **The app's own words** — `Spideryarn`, `Greg Detre`, `granularity zoom`, a block id. Small,
   flat, always. Nothing in an article ever supplies them, and `Spideryarn` is the word a reader is
   most likely to say into this app. The name arrived on 2026-09-04, when Greg asked for it from
   inside the Feedback dialog: *"along with my name, the author of Spideryarn, Greg Detre"*.
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

**And the recogniser dying puts a browser into that row**, rather than ending the dictation. Added
2026-09-05 after Greg reported `[mic-offline]` from the Feedback dialog: Chrome's Web Speech API
ships its audio to a server, so a captive portal or a VPN blip makes it fail — and that used to stop
the recording **mid-sentence** and tell the reader to check their internet connection, about a path
that had usually worked perfectly. It now takes the live words with it and nothing else: `s.live`
goes false, `onend` does not restart it, late results are ignored, and if it died before
`audiostart` ever fired the hook takes over the timer and arms the tape itself — which is the
Firefox path verbatim, because it is now Firefox's situation. The gate is *"is our track still
live"* rather than a list of error codes to trust, since a track that has really gone fires its own
`ended` listener. [260905c](../plans/260905c-dictation-filler-words-and-mic-offline.md).

Two things guard the invariant, and they are in different places because they are different
problems:

- **Within one hook**, the `NOT_A_TRACK` probe in [`useDictation.ts`](../../src/web/useDictation.ts).
  A browser without the overload *ignores the extra argument and starts*, so the probe cannot be
  run while we hold a track — it goes first, it aborts, and it **waits for the recogniser's
  terminal `end`** before anything opens a device. The wait is the part that was missing for a
  round: `abort()` promises disconnection and a later `end`, not synchronous release. Bounded at
  200ms and paid once per page, since the answer is cached.

  **And it is asked only on Chromium, since 2026-09-10.** On WebKit the probe's `start()` can reach
  the per-site microphone-permission path before the abort lands, and the source contains no path
  for that abort to cancel permission UI already requested. This is the source-traced explanation
  for Greg's two-prompt report; the fix has not yet been run on an iPhone. `probeIsSafe()` requires
  the `Chromium` brand inside `navigator.userAgentData`. Presence alone is not enough: WebKit has
  implemented the property behind an internal setting and a site-specific quirk. This is an engine
  check on purpose, because the behaviour cannot be observed without paying the prompt. Greg's
  report, [260910g](../plans/260910g-dictation-asks-for-the-microphone-twice-on-iphone.md), and
  the class it belongs to,
  [a cancelled request still asks the reader](../postmortems/260910e-a-cancelled-request-still-asks-the-reader.md).
  Whoever writes the next probe: list what the attempt *shows a person* before trusting a cancel to
  undo it.
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

## A double press on Stop also sends

Greg, 2026-10-05 (`spya-rp8676`): *"if I'm in a feedback report and I double click the stop button,
then it should also click send afterwards for me. And if I'm in chat or whatever and I double click
the stop button, then it should automatically send that message after it's finished transcribing"*.

A box hands `useDictationField` its own done action as **`onDone`**, and passes the field's `again`
and `sendingAfter` on to `DictationButton` and `DictationStrip`. Five boxes do: Feedback (Send),
chat (Send), the comment follow-up (Ask in chat), the quiz answer (Answer) and the annotate box
(Save, never Ask AI). The plan, with what was deferred and why, is
[261005a](../plans/261005a-dictation-double-press-on-stop-also-sends.md).

- **The second press has to be able to land.** A `disabled` button is sent no click. So on a box
  with `onDone`, **for 600 ms after Stop** (`DOUBLE_PRESS_MS`), the button stays enabled and is
  named "Send when the words arrive"; its only press there is `again()`, and it never starts a
  dictation. After that, or once the press is taken, it is `disabled` as it always was. The field
  returns `again` only while a second press would count, which is the whole of how the button
  knows. Not `aria-disabled`: that says "cannot be used" at the one moment it can (GPT Sol).
- **Once taken, the strip says** *"Turning that into text, then sending…"*.
- **It sends only where it was said.** A box that is reused across things — one comment dialog for
  every comment, one quiz box for every question — passes **`doneKey`**, and a wish made on one is
  not honoured on another. Feedback's key is whether it is open.
- **It sends only a real transcript.** The done action runs only if that ending put the transcript
  in the box. A failed upload, `[mic-silent]`, a recording too short to send, a transcript refused
  because the box changed, and a later **Try again** send nothing, and the wish to send ends with
  the ending it was made for.
- **`onDone` runs from an effect, one render after the ending**, because every box's send closes
  over its render's value and refuses while `busy`. Called from `onEnd` it would see the box from
  before the transcript and refuse in silence.
- **The box's own rules still apply.** `onDone` is the same function the Send button calls, so a
  double press cannot send what a Send press would refuse. A box that stays mounted when shut must
  refuse there too; Feedback checks `open`.
- **Do not offer it while the done action would refuse.** The annotate box passes `onDone` only
  once its comments have loaded, so a press is never taken and then dropped.

Tests: `tests/dictation-double-stop-sends.test.tsx`.

## When it hears nothing, and after

**While the microphone is on and hears nothing**, the strip says *"No sound detected yet"* — ten seconds
under −55 dBFS (`audio-level.ts` says why it is an observation and never a diagnosis). Since
2026-10-01 it says it as a warning: warm rather than faint, with a glyph, and a soft two-note chime
**once per dictation** through the hook's own `AudioContext` — once, because the chime can be
heard by the microphone, which would end the quiet and start the next one
([`quiet-chime.ts`](../../src/web/quiet-chime.ts)). Greg asked for both after a `[mic-silent]`
he had no warning of. It only catches a microphone hearing *nothing*; one hearing a fan and no
words is the deferred half, in
[261001k](../plans/261001k-dictation-silent-mic-warning-and-a-message-that-goes.md).

**And afterwards, the message goes when its draft does.** A box mounted for the life of the page —
Feedback is the one — calls `dismiss(artifact)` when the draft is finished, with the
`artifact()` it read when Send was pressed, so a late answer cannot wipe a newer dictation's
message. The **×** on the audio row takes the error with it too.

## Adding it to a box

```tsx
const box = useRef<HTMLTextAreaElement>(null);
const dictate = useDictationField({
  value, onChange, box,
  context: { kind: "article", slug },
  transcribe: sendForTranscription,
  keep: keepDictation(`chat:${slug}`), // names this box; § A closed tab
});

<textarea ref={box} readOnly={dictate.readOnly} … />
<DictationButton dictation={dictate.dictation} toggle={dictate.toggle} />
<DictationStrip dictation={dictate.dictation} />
```

`transcribe` is always `sendForTranscription` from
[`dictation-upload.ts`](../../src/web/dictation-upload.ts) in this app, and it is a parameter rather
than something the hook imports — see [The hook does not know which server it is talking
to](#the-hook-does-not-know-which-server-it-is-talking-to) below.

`context` is the only thing a caller has to decide, and it says **where** rather than **what**:
`{ kind: "article", slug }` or `{ kind: "profile" }`. The server turns that into words — see
[What is in the vocabulary](#what-is-in-the-vocabulary). Never a term
list from the client: a box adopting a microphone should not have to know how to build a
vocabulary, and a vocabulary accepted from a caller is a string that caller chooses landing in a
model prompt, for no gain, since the server has the glossary already.

If the box is inside a form, guard the submit on **`dictate.busy`** — `readOnly || dictation.armed`,
a field on the hook's result so that nobody writes the pair out (the half everybody forgets is
`armed`).
`readOnly` is `transcribing` alone, the two seconds *after* the reader presses stop; `armed` is the
microphone actually being on. Guard only the first and ⌘+Enter mid-sentence sends the rough live
guesses, or on Safari and Firefox sends nothing that was said at all. GPT Sol found it in the
Feedback dialog, 2026-09-02; [`FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) is the worked
example.

**If the box sends, give it the double press**: `onDone: send` on the field (and `doneKey` if the
box is reused across things), and
`again={dictate.again} sendingAfter={dictate.sendingAfter}` on the button and the strip
([§ A double press on Stop also sends](#a-double-press-on-stop-also-sends)).

**And disable the button too, not only the guard.** A correct guard behind a lit button is a press
that does nothing and says nothing — the worse half of the pair, because the reader has no way to
tell it from a broken app. GPT Sol found four boxes in that state on 2026-09-04, when Enter started
promising Send in the chat composer: chat, the comment follow-up, the annotate box and the quiz
answer all guarded `readOnly` alone or lit a button the guard would refuse. Every box that *sends* now does both —
chat, the comment follow-up, annotate, quiz and Feedback — and
`tests/the-enter-key-really-sends.test.tsx` presses two of them while armed. The profile boxes are
the exception on purpose: ⌘+Enter there saves prose to a field the arriving transcript will overwrite
a second later, and the next blur saves it again, so there is nothing to lose.

**The guard is for a press, not for a box that is going away.** The annotate box stores a draft on
its way out (the ×, Escape, another selection, an unmount), and that store has neither guard: the
press is refused because better words are about to arrive, and at an exit nothing better will —
unmounting aborts the transcription — so the choice is the words the reader could see, or none. The
kept recording is still offered back in that passage's next box. Arbitrated by Opus, 2026-10-03;
[comments.md § The box a selection opens](comments.md#the-selection-box).

**And if the box lives in a component that stays mounted when it disappears** — a dialog whose
parent renders it open *or* shut, as `FeedbackButton` does — closing it unmounts nothing, so
`useDictation`'s cleanup never runs and the microphone keeps recording behind a shut dialog. One
effect on the open flag fixes it, calling `dictation.toggle` (not the field wrapper's `toggle`,
which puts the focus back into a box that is no longer on screen).

**The command bar's box is the one where the guard covers more than a submit**
([`CommandBar.tsx`](../../src/web/CommandBar.tsx) § `dictationBusy`). Its box is a filter, so Enter
*and a click on any row* are refused while the microphone is `armed` or the box is `readOnly` — a
half-heard phrase would otherwise run whichever row it happened to select — and the rows are dimmed
and `aria-disabled` so the refusal is visible (GPT Sol, 2026-10-03). It is also a stays-mounted box:
it stops the microphone on close as above, and hands the hook a `keep` only while open. Its strip
sits *after* the bar's own status line, because the strip is a live region and the bar's sentence
has to stay the first one. With no article around it the context is `{ kind: "profile" }`, which no
production mount reaches today. Tests: `tests/command-bar-arguments.test.tsx`.

A dictated sentence is in the box like a typed one, so when it matches no row it takes the typed
one's path: Enter asks what it meant
([reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar)). The same
guard refuses that Enter while the microphone is busy.

## The hook does not know which server it is talking to

**Since 2026-09-08, `useDictation` takes a `transcribe` function rather than importing one**, and is
generic in whatever `context` that function wants. It snapshots the context when a press starts,
travels it on a kept recording, and never looks inside — all the care described above is unchanged;
only the knowledge of *where the words go* has left.

That is not tidiness. Greg asked for the fleet dashboard's message boxes to get this feature, and to
**reuse** it rather than copy it — *"Borrow (or better still reuse) from Spideryarn"*. The fleet tool
([overseer-direction.md](overseer-direction.md)) must run with this product's server absent,
and one import stood in the way of all ~3,000 lines: `useDictation` called `sendForTranscription`,
which calls `apiFetch`, which reaches Supabase, Sentry, the offline store and the billing plan. That
one edge measured **21 files and 16,054 lines** behind a hook that needs six. Cutting it took
`useDictation.ts`'s whole closure to **8 files, 2,938 lines and `react`**.

So the contract is [`transcriber.ts`](../../src/web/transcriber.ts) — two types, no imports — and the
tool that borrows it is pinned by `tests/fleet-imports.test.ts`, which fails if the list of `src/`
files the fleet reaches changes at all. The plan and the numbers are
[260908f § Stage E](../plans/260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md).

**What the fleet did NOT take is the chrome.** `DictationStrip.tsx` and `MicLevel.tsx` render against
this app's hand-written class names, so importing them typechecks, builds, and draws an unstyled
button. Reuse the machinery, write the chrome — worth knowing before adding a class name to either.

## The audio leaves the machine now

The old design's selling point was that no audio of the reader's voice crossed anything of ours.
That is over, deliberately, and Greg made the call with the trade put to him in those words.

What is true: each recording part is held in memory for one request, base64'd into one OpenRouter
call, never written to disk by us and never logged — the same rule that keeps a reader's question
and the article's prose out of a log line covers a transcript exactly as well
([logging.md](logging.md)).

**What stopped being true on 2026-09-07 is the second half of that.** The call used to send
`provider: { zdr: true }`, which restricted routing to zero-data-retention providers, so *"your voice
is not stored"* was a claim about the whole path rather than only about our half of it. On
`/v1/audio/transcriptions` OpenRouter does not apply routing preferences or `zdr` — the request is
not refused, it succeeds, which is worse, because the promise quietly stops being backed by
anything. (`provider.options` on the same request *is* forwarded, and is how the vocabulary reaches
the model, so this is not a block being discarded — it is the routing half of it not being applied,
which is the harder thing to notice.) So the claim is now about our half only, and the sentence on
the button says so.
[privacy.md § Where a reader's voice goes](privacy.md#where-a-readers-voice-goes) has the probe and
the two published policies we pass on instead.

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
request refuses above 3 MB of base64, and no one recording may hold more than 2.1 MB of audio
(`MAX_BYTES` in [`mic-recording.ts`](../../src/web/mic-recording.ts)). Chrome's AAC runs at a
measured ~14 KB/s with no bitrate hint (the hint is what made its encoder throw), so one recording
fills that in about **two and a half minutes**.

**Until 2026-09-29 that was where a Chrome dictation ended**, with `[mic-full]` — Greg hit it
mid-sentence in the Feedback box (SPIDERYARN-READING2-5B). Now **the tape rotates**: at two minutes
or 80% of `MAX_BYTES`, whichever comes first, a new `MediaRecorder` is started on the same track and
then the old one stopped, so a long dictation is several **parts**, each its own complete file (MP4
and WebM cannot be joined byte-wise, which is why it is several recorders rather than one sliced
up). Each part is sent to `POST /api/transcribe` **the moment it closes, while the reader carries
on talking**, so the wait after Stop is only the last part's. At Stop the hook waits for every part,
joins their words in order with a space, and calls `onTranscript` **once** — so the one-span
replace in [`useDictationField`](../../src/web/useDictationField.ts) is unchanged. No request is
bigger than before and there is no server change; the provider meters transcription by seconds of
audio rather than by the number of parts.

The rules that make it safe, each a decision in
[260929f § Part B, revised after review](../plans/260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md#part-b-revised-after-review):

- **The cut is decided when the recorder hands over a chunk**, not by a timer (`chunkVerdict`), so
  it still happens in a throttled background tab. Hard lengths only; no hunting for a pause.
- **All or nothing.** If any part fails, no transcript is delivered — delivering the parts either
  side of a hole would, on Chromium, replace the live words that cover it. Every part is offered to
  save (one **Save part N** button each), and **Try again** re-sends only the parts that failed.
- **A part that loses audio breaks the tape** — a recorder that errors after recording, a flush that
  never finishes, or one chunk too big for any request (a tab suspended for minutes and handed its
  backlog at once). The dictation ends there with `[mic-broken]`, no final transcript is delivered,
  and the complete parts before it are offered to save. Not retryable: the broken part has no whole
  file.
- **The two-second minimum is for the dictation, not the part**, so a one-second tail after a
  rotation is kept. A tail with no bytes at all is simply absent.
- **Stop, the ceiling and another box taking the microphone keep the parts' uploads; a second press
  in the same box, a device change and an unmount abort them.** The session's `AbortController` now
  exists from the press, and the superseding abort runs on every browser, not only where there is a
  recogniser.

**The ceiling on a whole dictation stays at five minutes** (`MAX_MS`), and hitting it ends the
dictation and transcribes what was said, under `[mic-full]` with a sentence that is now true. Not
higher, although parts would allow it: five minutes of speech is about what the largest box —
Feedback's 4,000 characters — holds, and the other boxes take 600 to 4,000. A ceiling sized from
each box's own limit is the later refinement.

**What is not verified.** A spike on the box (plan § The spike) rotated five parts in Chrome 152
and Chromium 151: every part decoded on its own, and a seam loses **up to ~70 ms** — the old
recorder's last Opus packet, the same whichever recorder is stopped first. Headless Chrome on Linux
offers no AAC recorder, so **the AAC seam is unmeasured**; Playwright's WebKit has no
`MediaRecorder`, so **Safari and the iPad are unmeasured**, and nobody has yet dictated over two
minutes into a real browser. Whether seams garble words in real speech is the open question; a
voice-activity cut is the fix if they do.

**The size is also the wait, and an iPad was the heavy one.** Measured 2026-09-12 after Greg reported
dictation as slow on an iPad on weak Wi-Fi: 41 seconds of speech at an iPad's size took **10.8 s to
upload** on a modelled 1 Mbps link, against 1.6–2.7 s to transcribe in the same run — two calls per
file showed no size penalty, though too few to establish that there is none. So request size is the
strongest lever, not a proven cause of any one slow dictation. WebKit
records at **192 kbps** when a page gives no bitrate (`LargeAudioBitRate`, read from its source), and
the AAC attempt gave none because Chromium's encoder throws on one. So since that day the AAC attempt
carries **48 kbps on WebKit only**, recognised positively by `navigator.vendor` (`takesAacBitrate` in
[`mic-recording.ts`](../../src/web/mic-recording.ts)), and an iPad's recording now fills far more
slowly than Chrome's. Whether the hint is honoured is not visible from the
box, which cannot run Safari: the `dictation transcribed` log line carries `format`, `audioSeconds`
and `kbps`, from the provider's own `usage.seconds`, and ~48 on an `m4a` row is the answer.
[260912b](../plans/260912b-dictation-slow-on-weak-wifi.md), with the spike that measured it.

## A closed tab does not lose a dictation

> I would be really sad if at the end of a few minutes of really rich thought, the contents got lost
> because, I don't know, there was a bug or the internet connection dropped or something like that.
>
> — Greg, 2026-09-29 (SPIDERYARN-READING2-5M)

A failed upload already kept its audio and offered **Try again** (item 6 below). What could still
lose a dictation was **the tab going away** — closed, reloaded, crashed, or thrown away by the
browser — while the recording existed only in the page's memory. So since 2026-09-29 **every
recorder chunk is also written to IndexedDB as it arrives**, and the next time the same box is on
screen a recording that never reached it is offered back in the ordinary row, under
`[mic-recovered]`. Try again puts its words at the caret; Save and Discard work as before.
[260929h](../plans/260929h-dictation-that-survives-a-closed-tab.md) has the design, the options
passed over, and GPT Sol's review.

```
 chunk every second ──▶ IndexedDB, this device only
 words in the box, Discard, too short, device change ──▶ forgotten
 tab dies, upload fails, box unmounts, a new press ──▶ left, and offered back next time
```

- **It is a seam, like the transcriber.** `DictationKeeper` in
  [`transcriber.ts`](../../src/web/transcriber.ts) is types only; the product passes
  `keep: keepDictation("<box>")` from [`dictation-keep.ts`](../../src/web/dictation-keep.ts), and
  the fleet dashboard passes nothing and is unchanged. **A new box adds that one line**, naming
  itself: `feedback`, `chat:<slug>`, `comment:<id>`, `annotate:<block>:<start>`,
  `quiz:<slug>:<question>`, `profile:<field>`. A recording is offered back only in the box it was
  made in, to the reader who made it, and is transcribed against the `where` it was recorded with.
- **Web Locks decide which tab may offer it.** The page holding a tape holds a lock named for it,
  and a recovery takes the lock with `ifAvailable`, so a tape being recorded in one tab is never
  offered by another, and a dead tab's tape is offered by one page only. No Web Locks, no keeping.
- **Feedback keeps only while open**, because the dialog is mounted on every page whether or not it
  is showing — a keeper there while shut would let a background tab claim the recording invisibly.
- **The row says so only when it is true.** "The audio is kept on this device, even if you close the
  page" appears only when every write landed (`KeptTape.intact()`); a failed keeper is never
  described as holding anything, and never touches the dictation.
- **A tab that died mid-sentence is not "nothing was lost".** Its last part never received the
  recorder's closing chunk, and the specification does not promise such a file plays, so it is
  offered under `[mic-cut-off]`, which says the last seconds may be missing. Measured in Chrome
  151 on 2026-09-29: WebM and fragmented MP4 truncated at any chunk decoded, losing under a second.
  **Safari is unmeasured.**
- **How long it stays** — until delivered or discarded, or (in Feedback) the report it sat beside is
  filed, or Sign out, or the first visit after a week
  (`sweepDictations`, at startup). Not on a lapsed session. [privacy.md § On the reader's own
  device](privacy.md#on-the-readers-own-device-until-the-words-arrive).

**Usually not covered**: the words once they are in the box. The audio is forgotten when the
transcript lands, so a tab that dies between that and Send loses the text as it would lose typed
text. The annotate box is the one exception for an ordinary close or reload: its `pagehide` handler
makes a best-effort save of the visible field ([comments.md § The box a selection
opens](comments.md#the-selection-box)); a crash or killed browser still fires no event. Keeping the
Feedback draft itself is the next step, and is named in the plan.

## The ways it fails

1. **The model answers the question instead of transcribing it.** A reader dictating into the chat
   box is *always* asking a question, and no check on the shape of the words can help, because a
   dictated question ending in `?` is a valid transcript. **The defence changed on 2026-09-07 and
   the risk did not go away.** Until then the call carried a system prompt saying three times over
   never to answer, and asked for `{ transcript }` as a strict JSON schema with
   `require_parameters: true` so no upstream could drop it — a model that decided to answer had to
   put its answer in a field labelled `transcript`. The transcription endpoint offers none of those
   controls, and it is still a generative model returning free text. What is honestly better is that
   the exposure is *smaller*: there is no system prompt to override, and the vocabulary arrives as a
   list of strings in a request field rather than as text beside an instruction. What stands in for
   the schema is `MAX_TRANSCRIPT_CHARS` — a loose tripwire for an answer far longer than anything
   that could have been said — plus the tests for dictated questions and commands. Residual risk,
   accepted knowingly, and slightly differently shaped than it was.
2. **Hallucination on silence.** Nothing under two seconds is sent at all, and an empty transcript
   is a success rather than an error — the box is left as it was, and the audio is offered back.
3. **The vocabulary quietly stops being assembled.** Returns a slightly worse transcript and no
   other symptom. Pinned by [`tests/transcribe.test.ts`](../../tests/transcribe.test.ts) asserting
   on the request body — and, since 2026-09-04, by
   [`tests/feedback-dictation-vocabulary.test.tsx`](../../tests/feedback-dictation-vocabulary.test.tsx),
   which walks the **two joins in front of that**: the box hands `useDictation` a `context`, and
   [`dictation-upload.ts`](../../src/web/dictation-upload.ts) puts it in the body. Those are what a
   box owns, and a box that dropped its `context` would fail this way and no other. It exists because
   a report of `Spideryarn` coming back misspelt was read as this failure class and turned out not to
   be — the whole chain was intact, the word was in `SITE_TERMS`, and the residue is what a model does
   with real speech. [`transcribe.ts`](../../src/transcribe.ts) also warns when the assembled
   vocabulary is empty, which nothing can legitimately produce, since every recipe names `site`.
4. **The Anthropic provider pin.** The app's other OpenRouter calls send
   `provider: { order: ["anthropic"] }` so repeat calls land on the cache. Copied onto a Gemini
   model that is wrong *quietly* — OpenRouter finds no Anthropic upstream, falls through, and
   answers. This call does not send it, and a test says so.
5. **The reader is offline before they start.** The words that get saved come from a `POST`, so
   with no network a dictation is a minute of talking and then a failure. The button is disabled on
   a `navigator.onLine` of `false` and says why — [`useOnline.ts`](../../src/web/useOnline.ts), which
   exists mostly to write down that `false` is the only direction that value may be trusted.
   **Not while armed**, because the same button is Stop: disabling it mid-dictation would trap the
   recording, which GPT Sol caught as a P0 before it shipped.
6. **The transcription fails after the reader has stopped.** The audio is kept — on *every* failed
   upload since 2026-09-05, not only when the box is empty — and **Try again** sends the same bytes
   up again (for a dictation in parts, only the parts that failed). Offered only when the failure could plausibly go the other way: a container we cannot
   read, or a recording over the cap, will be refused identically for ever, and
   [copy.md](copy.md) is explicit that inviting a futile retry is the expensive mistake.
   `TranscriptionResult.retryable` in [`dictation-upload.ts`](../../src/web/dictation-upload.ts)
   carries it, read off the HTTP status rather than out of the sentence.
7. **`http://localhost` and Chrome's permission.** `localhost` is a secure context by exception, so
   `getUserMedia` and `SpeechRecognition` both work there — but the grant is keyed to the full
   origin *including the port*, and Vite's port moves. A plausible share of why the microphone
   seemed to behave better on `spideryarn.com` than on a laptop.
8. **A chosen microphone's id stops resolving while the microphone is still there.** Greg on an
   iPhone with AirPods, 2026-09-29: *"The microphone you chose isn't available. Using another one.
   … Weirdly, it did actually seem to work."* The `exact` request for the remembered id failed and
   the plain one opened — very possibly the same AirPods under another id (why the id went stale on
   iOS was not established; route changes and WebKit's own default-input choice are both
   candidates). So the browser's **name** for a chosen device is now remembered beside its id, and
   a fallback that is the one input carrying that name, and whose own id is the input's, is the
   same microphone: no warning, and its new id is adopted. Anything less still warns, now naming
   both. A choice stored before names were kept is warned about once and forgotten.
   [`mic-devices.ts` § `judgeFallback`](../../src/web/mic-devices.ts),
   [261001l](../plans/261001l-autosave-about-you-and-honest-mic-fallback.md). The same report
   wondered whether the clean-up step had run: it had — every one of those dictations reached
   `openai/gpt-transcribe` and came back `ok`, and on Safari, which has no live words, the text in
   the box *is* that transcript. There is no separate rewrite after it (§ The ums come out).
9. **`{ audio: true }` is the browser's microphone, not the system's.** Greg, 2026-10-01, with his
   webcam as the Mac's input: *"It seems to be working fine when I use another voice microphone app
   … So I almost wonder whether we're not using the default microphone for the system somehow."*
   Chrome keeps its own default microphone (its settings page, and the device chooser in its
   permission prompt), and `{ audio: true }` opens that, so it can sit on a different device for
   as long as nobody looks. So with no pick we ask Chromium for its `"default"` input by `exact`
   id — `ideal` loses to Chrome's own choice, measured — and **name the device for as long as
   dictation is on**, adding `(your choice)` when a pick of ours is in force. Whether Greg's
   press was Chrome's choice or an old pick of ours was not established.
   [`mic-devices.ts` § `audioConstraint`](../../src/web/mic-devices.ts),
   [261001q](../plans/261001q-mic-follows-the-system-default-and-says-which.md).

## The codes

Every reader-facing sentence here ends in a bracketed code, per
[copy.md § The bracketed code](copy.md#the-bracketed-code) — so somebody reporting a problem can
quote four characters, and so a test can match the code rather than pinning the prose.

They are **not** in [`src/messages.ts`](../../src/messages.ts), which is about failures a *model
call* can return. Most of these are not: a blocked permission, a headset unplugged mid-sentence,
a recorder that hit its cap. They live beside the code that raises them.

| | |
|---|---|
| `[mic-blocked]` `[mic-no-service]` `[mic-no-connection]` `[mic-none]` `[mic-language]` `[mic-stopped]` | the browser's recogniser, in [`dictation-errors.ts`](../../src/web/dictation-errors.ts) — and **the reader rarely sees any of them now**, because a recogniser that dies while the tape is running is a decoration failing, not a dictation failing |
| `[mic-unplugged]` `[mic-no-start]` `[mic-full]` `[mic-broken]` `[mic-empty]` `[mic-silent]` `[mic-unexpected]` | the capture and the ending, in [`useDictation.ts`](../../src/web/useDictation.ts) — `[mic-full]` is the five-minute ceiling and `[mic-broken]` a part that lost audio; [§ The sizes](#the-sizes-and-the-wall-behind-them) |
| `[mic-no-tape]` | no recording was made at all, so there was no authoritative pass |
| `[mic-recovered]` `[mic-cut-off]` | a recording an earlier page left behind, offered back — whole, or cut off mid-sentence; [§ A closed tab](#a-closed-tab-does-not-lose-a-dictation) |
| `[mic-format]` `[mic-too-long]` `[mic-slow]` `[mic-offline]` | the upload, in [`dictation-upload.ts`](../../src/web/dictation-upload.ts) |
| `[mic-not-set-up]` `[mic-upstream]` `[mic-no-upstream]` `[mic-unreadable]` `[mic-too-long]` | the server, in [`src/transcribe.ts`](../../src/transcribe.ts) — see below |
| `[ai-busy]` `[ai-no-credit]` `[ai-key]` `[ai-refused]` `[ai-no-model]` `[ai-bad-request]` `[ai-upstream]` `[ai-timeout]` | also the server, but the sentences come from [`messages.ts`](../../src/messages.ts) — every provider refusal has gone through `providerHttpFailure` since 2026-09-07, so a dictation can now show the same words as any other failed model call |
| `[ai-busy]` `[ai-no-credit]` | the exception: a 429 or a 402 from the provider borrows `providerHttpFailure` from `src/messages.ts`, because *"could not transcribe that"* reads as a verdict on the recording when the fix is to wait ten seconds |

**One code, one sentence — and for a year it was not.**
[`tests/dictation-codes.test.ts`](../../tests/dictation-codes.test.ts) reads every `[mic-…]`
sentence out of `src/` and fails if a code carries two. It was written on 2026-09-05 because a
feedback report said, in full, *"I got a [mic-offline] error"* — and `[mic-offline]` was both the
recogniser losing its connection **while the reader was still talking** and the upload failing
**after they had stopped**, which are different problems with different fixes. It found two more
the same way: `[mic-upstream]` (a service that refused, and a service that never answered) and
`[mic-too-long]` (the browser's sentence and the server's, for one branch).

**What each of the server's five means now**, because the split has moved twice:

| code | when |
|---|---|
| `[mic-not-set-up]` | no `OPENROUTER_API_KEY` on this server. 503, no Retry |
| `[mic-no-upstream]` | the service was never reached — DNS, a dropped socket, our own 90-second deadline. 502, Retry offered |
| `[mic-unreadable]` | it *was* reached, answered 200, and the body had no `text` in it. 502, Retry offered. Added 2026-09-07: these two used to be one, and a service that answered nonsense was reported as one that could not be reached, which sends somebody to check a network that is fine |
| `[mic-too-long]` | the recording is over the shared cap — checked in the browser, again on the server, and now a third time if the provider itself refuses the size. 413, no Retry |
| `[mic-upstream]` | what is left: a reply far longer than anything that could have been said (`MAX_TRANSCRIPT_CHARS`). 502 |

**A provider refusal no longer produces a `mic-` code at all.** It produces the `ai-` sentence for
its status, and the status decides the Retry: `canRetry` over copy.md's `FailureKind`, so a 400 the
service found malformed is a 503 with no button and a 429 is a 429 with one. Until 2026-09-07 only
401, 402 and 429 got their own words and everything else became a retryable 502 saying *"could not
transcribe that"* — which invited a reader to resend identical bytes for an identical refusal.
[260907c](../plans/260907c-dictation-onto-an-openai-transcriber.md).

`src/messages.ts` had this check from the start and this family did not, because the family was
defined by being *outside* that file. The rule was never file-specific;
[copy.md](copy.md#the-bracketed-code) says a code names a branch. Renaming a shipped code orphans
the conversations that quoted it, which is why `[mic-offline]` stayed on the upload — the path a
reader actually loses a dictation to — and the recogniser's became `[mic-no-connection]`.

## Where the pieces are

| | |
|---|---|
| [`useDictation.ts`](../../src/web/useDictation.ts) | the microphone: four phases, the one owned track, the recorder, the upload |
| [`useDictationField.ts`](../../src/web/useDictationField.ts) | wiring it to a text box: the caret, the span, the closed box |
| [`DictationStrip.tsx`](../../src/web/DictationStrip.tsx) | the button and the strip, so every box gets the same one |
| [`mic-lock.ts`](../../src/web/mic-lock.ts) | one microphone per page, however many boxes have a button |
| [`dictation-keep.ts`](../../src/web/dictation-keep.ts) | the copy on the device until the words are in the box |
| [`dictation-upload.ts`](../../src/web/dictation-upload.ts) | the client half of `POST /api/transcribe` |
| [`mic-recording.ts`](../../src/web/mic-recording.ts) | the tape, its container fallback, its caps, and where it is cut into parts |
| [`mic-devices.ts`](../../src/web/mic-devices.ts) | which microphone, and why the constraint is `exact` |
| [`useAudioLevel.ts`](../../src/web/useAudioLevel.ts) · [`audio-level.ts`](../../src/web/audio-level.ts) · [`MicLevel.tsx`](../../src/web/MicLevel.tsx) | the meter |
| [`dictation-errors.ts`](../../src/web/dictation-errors.ts) | every recogniser error code to a sentence, totally |
| [`src/transcribe.ts`](../../src/transcribe.ts) | the server half: the vocabulary, the model call, the guards that replaced the schema |
| [`src/dictation-limits.ts`](../../src/dictation-limits.ts) | the sizes and the containers, shared by both ends — and the one sentence for a recording that is too long |
| [`src/dictation-fillers.ts`](../../src/dictation-fillers.ts) | the ums, deleted — and why it is not a line in the prompt |
| [`useOnline.ts`](../../src/web/useOnline.ts) | whether the browser has a network, and which way round that may be believed |
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
and flips to **"Listening…"**, and Remember mode wears a `Speech` icon under *"Say what you took
from this…"* — but every one of those is this feature: audio in, text out. **The app has never played a
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
