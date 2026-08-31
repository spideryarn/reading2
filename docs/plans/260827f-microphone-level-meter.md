# The microphone that looked broken

Greg, 2026-08-27:

> Review the microphone button in http://localhost:5274/profile - I just tried it, and nothing
> seemed to happen. And show the sound-input levels as a dynamic-animation so that the user has a
> sense of whether it's working.

Two halves. The first is a diagnosis: **the button was not broken**, and this doc says what it was
doing instead and why that was indistinguishable from broken. The second is the fix Greg named — a
live level meter — plus three silent failure paths that the meter alone would not have covered.

Built and landed on 2026-08-27. Reviewed by GPT Sol at plan stage
([review](260827f-microphone-level-meter-review-sol.md)) and again as built
([code review](260827f-microphone-level-meter-code-review-sol.md)); the plan review found two blockers that
changed the design substantially, and the record of that is below rather than quietly rewritten out.

Background on the feature: [reader-profile.md § The microphone](260826t-reader-profile.md#the-microphone) is
where it was decided (Web Speech API, not OpenRouter, and why). The code is
[`useDictation.ts`](../../src/web/useDictation.ts), [`useAudioLevel.ts`](../../src/web/useAudioLevel.ts),
[`audio-level.ts`](../../src/web/audio-level.ts), [`dictation-errors.ts`](../../src/web/dictation-errors.ts),
[`MicLevel.tsx`](../../src/web/MicLevel.tsx) and [`ProfileBox.tsx`](../../src/web/ProfileBox.tsx).

---

## What actually happened when you pressed it

Measured in Chrome 151 on macOS, on `http://localhost:5274/profile`, with the
`webkitSpeechRecognition` constructor wrapped so every event and every method call was timestamped.

```
t=0ms      button click reaches React
t=0ms      new webkitSpeechRecognition()
t=0ms      .start()
t=0ms      the button turns orange          ← synchronously, on the next line of code
t=+1ms     'start'
t=+1123ms  'audiostart'    ← the microphone actually opens here
t=+2799ms  'soundstart'    ← Chrome first hears anything
t=+2799ms  'speechstart'
   …       'result'        ← only once the transcript comes back
```

Everything worked. Permission was `granted`, `isSecureContext` was true, the recogniser started, the
device opened, sound arrived. There was no error at any point.

**So why did it look dead?** Three things, and they compounded:

1. **The microphone was not on for the first second.** `start` and `audiostart` are 1.1 seconds
   apart, consistently — and the button went orange *before even that*, on the line after
   `r.start()`. So its one piece of feedback was a claim to be listening, made a second before it
   could hear anything, and everything said into that second was gone.

2. **The only feedback was 26 pixels wide and in the wrong place.** `.prof-mic` is a 1.65rem button
   in the box *head*, top-right. The reader is looking at the textarea, several centimetres below,
   because that is where the words are supposed to appear.

3. **Until the first transcript, the strip did not exist.** `{dictation.interim && <p …>}` — the
   element was not rendered when there was no interim text, so there was not even an empty space
   saying *something is meant to appear here*. The layout was byte-for-byte what it had been before
   the press.

Add those up and the honest description of the first four seconds of dictation was: *a small icon in
the corner changed colour, and nothing else in the world was different.*

### A dev-environment red herring, worth writing down

Mid-diagnosis the page reloaded on its own about ten seconds into a dictation, killing the recogniser
and turning the button off. It was Vite's full-reload — several agents edit this tree at once
(`CLAUDE.md`), so somebody else's save reloads whatever Greg has open. If he was testing while
another agent was writing files, the dictation died under him, and that alone would produce "nothing
seemed to happen". Not a product bug; nothing to fix; worth knowing before anybody chases it.

---

## The real bugs the diagnosis found

`useDictation`'s `onerror` surfaced exactly two error codes:

```ts
if (e.error === "no-speech" || e.error === "aborted") return;
if (e.error === "not-allowed" || e.error === "service-not-allowed") { setError(…) }
armed.current = false;
setListening(false);
```

Everything else fell past both branches, **disarmed, and turned the button off with `error` still
`null`.** The two that matter:

- **`network`.** Chrome's Web Speech API is not necessarily on-device — it can ship the audio to a
  server. No connection, a captive portal, a VPN, an offline laptop: `network`, button off, not one
  word to the reader.
- **`audio-capture`.** No working input device. Same silence.

This is the [silent-success](../reusable/silent-success.md) pattern with the polarity reversed: a
*silent failure*, where the natural check — "did the button light up?" — returns the answer you were
hoping for either way.

Two more, both found by GPT Sol reading the code:

- **`service-not-allowed` was given `not-allowed`'s sentence.** Per the spec it means the recognition
  *service* was refused, not that the microphone permission was blocked — a different problem with a
  different fix, and sending somebody to change a permission that was never at fault is the
  wrong-blame mistake [copy.md](../project/copy.md) exists to stop.
- **Every `aborted` was swallowed**, including one nobody asked for. `aborted` is what our own
  `stop()` provokes, so silence is right *there* — but an `aborted` arriving while the reader still
  has the button armed is a real, unexplained termination wearing the same name.

And one that only bites when something else goes wrong:

- **Dictated text was committed only by the stop button.** Clicking the microphone takes focus out of
  the box, so the blur has already saved the *pre-dictation* text; if dictation then ended any other
  way — a `network` error, a failed Safari restart — the confirmed words sat in the box unsaved while
  the reader believed they had been taken.

---

## What we built

### 1. Three phases, not two

`phase` is `idle | opening | listening`. `opening` means armed-but-deaf and says so in words; the
button only wears the orange at `audiostart`, and drops back to `opening` on Safari's automatic
restart, because it genuinely is deaf again. The button is a stop button throughout — it is lit in
both armed phases, just differently.

### 2. A live level meter, off the same track the recogniser is using

Greg's words: *"show the sound-input levels as a dynamic-animation so that the user has a sense of
whether it's working."*

It is the right instrument, because it is the only thing that separates the three states the reader
could not otherwise tell apart:

| The meter says | Which means |
|---|---|
| nothing yet, "Opening the microphone…" | we are inside that 1.1s gap |
| bars moving with your voice | **the microphone is working** — the recogniser is just thinking |
| bars flat while you talk | the audio device is wrong, or muted |

**And the last row is not hypothetical.** Halfway through building this, every reading went to
exactly zero. The cause was that macOS had silently switched the default input from a Continuity
iPhone mic to **"Microsoft Teams Audio Device (Virtual)"**, which delivers digital silence — and
Chrome, `getUserMedia`, the track's `readyState`, `muted` and `enabled` all reported perfect health
throughout. This feature caught its own motivating bug, live, by accident.

#### One capture, not two

The first draft opened a second `getUserMedia` for the meter, since `SpeechRecognition` does not hand
out its `MediaStream`. **Sol's review killed that as a blocker and was right**: WebKit supports one
microphone source at a time, and a second capture can kill the first or silently switch the routing,
so on an iPad the meter could have been drawn from one microphone while a different one was being
transcribed — or recognition could simply have stopped.

The way out was in the same review: recent Chromium implements the spec's
`recognition.start(audioTrack)`. **Verified here rather than taken on trust**, because `start.length`
is 0 and a browser merely ignoring an extra argument looks identical from the outside:

```js
new SpeechRecognition().start("not a track")
// → TypeError: parameter 1 is not of type 'MediaStreamTrack'
new SpeechRecognition().start(endedTrack)
// → InvalidStateError
```

Both prove the overload is real. So one track feeds the recogniser and the analyser, and the meter is
showing the *exact* audio being transcribed rather than a second opinion about the room. Measured
working in both orderings — analyser attached before `start(track)` and after.

Where the overload is missing — Safari today — we open **no** stream at all, and the bars are driven
by the recogniser's own `soundstart`/`soundend`. That is a real observation of the real audio; it is
simply binary rather than continuous, and a CSS transition is what stops it snapping. Feature
detection is `"processLocally" in Ctor.prototype`, deliberately a *negative* filter: there is no
side-effect-free way to ask, since the only reliable probe is to call `start()`, which on a browser
without the overload starts the recogniser and prompts for the microphone. If the check is
wrong-positive, `beginCapture`'s `TypeError` branch stops our track **before** calling `start()`, so
the two captures are strictly sequential and never concurrent.

#### The number

`getFloatTimeDomainData`, not the byte form: the byte form quantises to about 1/128 of full scale,
and the bottom of the range is the entire question. RMS, then decibels — speech sits near −30 dBFS,
which a linear map would put at 3% of the bar.

**The floor is −70 dBFS, and that number was measured rather than reasoned.** The first version used
−60 on the argument that it is "quieter than any room with a person in it". Then the meter was
watched in a real one: room tone came in at RMS 0.0003–0.0027, i.e. −70 to −51 dBFS. A −60 floor put
the ordinary state of a working room *at or below zero*, and the bars sat perfectly flat while
everything worked — the exact failure the feature exists to prevent, reproduced by the feature. The
question that matters is not how quiet silence is; it is how quiet a working microphone in an empty
room is, and that is far quieter than it sounds like it should be.

#### It does not re-render

The level lives in a ref. One `requestAnimationFrame` writes one CSS custom property, `--level`, on
the meter's own root — never higher, since a custom property invalidates everything below the element
carrying it. `transform: scaleY()`, never `height`. Capped at 30Hz, and identical values are not
rewritten.

### 3. Say the state in words

The strip renders **whenever the microphone is armed**, not only when there is interim text. Three
states: *Opening the microphone…*, *Listening*, and — after ten seconds with nothing above the
activity threshold — *Listening — no sound detected yet*.

That third line is **neutral, and never an accusation**. An earlier draft said *"No sound reaching the
microphone. Check your input device."* after four seconds. Sol killed it (item 6) and was right:
somebody presses the button, thinks, then speaks; heavy noise gating can also deliver exact silence
until the first syllable. A reader told their hardware is broken goes and changes settings that were
fine. Only `audio-capture`, a dead track or a refused `getUserMedia` earns that sentence, because all
three are facts rather than inferences.

`role="status"` on the strip; the bars are `aria-hidden`, being a picture of what the line already
says in words.

### 4. Errors that cannot vanish

[`dictation-errors.ts`](../../src/web/dictation-errors.ts) is a **total** function: every string in,
a verdict out. Only codes needing a *different action from the reader* are named — permission,
service, connection, input device, language — and everything else lands on one general sentence.
Deliberately not an exhaustive enumeration of the spec, because a list that must be kept complete to
be correct goes stale back into silence.

### 5. Committing on every way of stopping

`useDictation` takes an `onEnd`, called once on every transition out of armed. `ProfileBox` commits
from it, so a `network` error or a failed restart saves the words that were already confirmed.

---

## The second review, and what it changed

The code went back to GPT Sol when it was built
([code review](260827f-microphone-level-meter-code-review-sol.md)), which is the review that matters more —
a plan-stage read cannot find a lifecycle bug in an effect. It returned four blockers, and three of
them were real bugs that testing had not reached:

1. **Stop committed before the last word arrived.** `stop()` saved and *then* called `r.stop()`,
   which delivers one final result — so the closing phrase of every dictation landed after the only
   save. Stopping now marks the session and finalises from `onend`, with a fallback if `stop()`
   throws and a two-second guard if `onend` never comes. The button still reverts the instant it is
   pressed; the session simply stays alive underneath to catch its last word.

2. **A dead session's error could kill the one that replaced it.** Everything was inferred from one
   question — *is this the current recogniser?* — which was being asked to decide two different
   things: whether to restart, and whether an `aborted` was ours. There is now a `Session` object per
   press, carrying `stopRequested` and `finished`, and a queued error from a replaced recogniser
   ends its own session silently.

3. **The shared `AudioContext` was suspended on stop, which is a race.** `suspend()` is asynchronous,
   so stop-then-quickly-start could have the suspend land *after* the new session read the state and
   found it running — leaving the meter dead for the rest of the page's life, silently. It is no
   longer suspended at all: stopping the track is what releases the hardware, and a context with
   nothing connected to it is not worth reclaiming.

4. **The feature detect was unsound, and this is the interesting one.** Detection was
   `"processLocally" in Ctor.prototype`, with a `TypeError` to catch a wrong guess. Sol took that
   apart correctly: a browser without the overload does not *throw*, it **ignores** the argument and
   starts its own capture — and Chromium shipped `processLocally` well before it shipped this
   overload, so that population is real. The failure would have been the exact one all this exists to
   avoid: two concurrent captures, and a meter drawn from a different microphone than the words.

   The replacement asks the only question that cannot lie, and asks it **before opening anything**:

   ```js
   r.start(NOT_A_TRACK)
   ```

   WebIDL converts arguments before the method body runs. A browser with the overload throws
   `TypeError` and has started nothing; one without it ignores the argument and starts on its own
   capture, which is the start we wanted anyway. Either way there is exactly one capture, on every
   browser, with no guess and no window in which there are two.

   **Verified in Chrome 151**, because the whole design now rests on a recogniser surviving a
   `TypeError` intact: the probe threw, **no events fired at all**, and `r.start(track)` on the same
   object then produced `start` and `audiostart` normally.

Plus the should-fixes worth naming:

- **`InvalidStateError` no longer means "nothing to do".** A recogniser constructed moments ago
  cannot legitimately be already running, and treating it as benign left the button saying "Opening
  the microphone…" for ever.
- **An externally ended track now ends the session.** A headset unplugged mid-sentence otherwise left
  a meter measuring nothing beside a button claiming to listen.
- **The smoothing is per millisecond, not per frame.** A fixed fraction per frame decays twice as
  fast on a 120Hz iPad — a different personality on the device this app frets most about, and
  invisible in review because nothing in the code says a frame is a unit of time.
- **The binary fallback stopped drawing a waveform.** The centre-weighted bar shape says *this is an
  amplitude*; driving it from a yes/no signal is a lie told by the picture rather than by any
  sentence. On that path the bars now rise as one and the line reads "Listening for sound".

### The one finding not implemented

Sol's blocker 3 also asked for a **page-wide exclusive dictation owner**, on the grounds that two
`ProfileBox`es would each open their own capture. Exactly one is mounted per page today — `/profile`
and the metadata page render one each and are different routes — and the mechanism by which they
would actually have interfered (that shared-context suspend) is gone. Two boxes on Chromium would be
two independent captures, which Chromium tolerates; on Safari neither opens one at all. So this is
recorded as a **constraint rather than built**: *if a second `ProfileBox` is ever mounted alongside
the first, add the exclusive owner before shipping it.*

---

## What we deliberately did not do

- **Not moving to OpenRouter transcription.** The trade-off in
  [reader-profile.md § The microphone](260826t-reader-profile.md#the-microphone) has not changed, and nothing
  Greg hit was a transcription-quality problem.
- **Not a waveform or a spectrum.** A scrolling waveform is prettier and answers a question nobody
  asked. The question is "is anything getting in", and that is one number.
- **Not keeping the meter alive when not listening.** An always-open microphone to draw a resting
  meter is exactly what "armed per press rather than a mode you can leave running" exists to prevent
  ([security.md](../project/security.md)).
- **Not turning the meter off under `prefers-reduced-motion`.** It is informative motion — it *is* the
  answer — so it is calmed with a transition rather than removed.

---

## What only a real device can tell us

Per [touch.md](../project/touch.md) and Sol's plan review, none of this can be checked from here:

- **Safari and iPadOS, the whole binary-fallback path.** Built-in mic, wired headset, AirPods,
  repeated starts, pauses, and Safari's automatic restart. The `processLocally` check should send
  Safari down the no-second-stream path, and that is the assumption to test first.
- **Whether `getUserMedia` prompts separately from the recogniser** on a first use. Permission reuse
  is a browser choice, not a guarantee.
- **A `network` error in the wild** — easiest to force by pulling the wifi mid-dictation.

### And a trap for whoever tests this next

**`requestAnimationFrame` does not run in a hidden tab, so the meter is frozen at zero in one.** Half
an hour went into chasing a meter that read a flat zero while every part of the audio graph checked
out — the analyser existed, the context was `running`, the track was `live` and unmuted, and
`getFloatTimeDomainData` was simply never called. Driving the page from a browser-automation tab
that is not frontmost reproduces this perfectly. It is already the warning in
[browser-testing.md](../project/browser-testing.md), in a different costume.

That is also why the lifecycle is pinned in `tests/audio-level-hook.test.ts` with a fake audio graph
and hand-delivered frames, rather than left to a browser pass that needs a live microphone, a live
extension connection and somebody willing to talk.
