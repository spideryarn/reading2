# The microphone that was working, into a device that was not

**Status:** built, 2026-08-27, after two rounds of GPT Sol review — the plan review is in
[microphone-device-and-recording-review-sol.md](microphone-device-and-recording-review-sol.md) and
what changed because of it is in [§5](#5-what-gpt-sol-changed). Follows
[microphone-level-meter.md](microphone-level-meter.md), which built the meter this
document is about to say was telling the truth all along.

Greg pressed the button again:

> I just tried and it still doesn't seem to be working, and doesn't show any indication of input
> volume. And when it's recording, can we use a different icon to denote that it's recording and
> pressing again will stop recording? And/or a timer to show how long it's been recording for? And
> if there's an error, store the audio as a file and show a button to reveal it in the OS file
> explorer so the user can decide what to do with it (if that's not too complex)?
>
> — Greg, 2026-08-27

Four things, and the first one is not a bug in this code.

---

## 1. The finding: Chrome hands the page a microphone that emits digital silence

Measured in Chrome 151 on `http://localhost:5273/profile`, 2026-08-27, with the permission already
granted.

The app asks for `getUserMedia({ audio: true })` — no device named, take the default. What comes
back:

```
track = "Microsoft Teams Audio Device (Virtual)"   state=live   muted=false
```

`live`, `muted: false`, and every event the recogniser is supposed to fire fires: `start`,
`audiostart`, and after ten seconds a restart. Nothing anywhere reports a fault. And the samples are
these:

| device | max RMS over 1.2s | dBFS |
|---|---|---|
| Microsoft Teams Audio Device (Virtual) | `0.000000` | −∞ |
| ZoomAudioDevice (Virtual) | `0.000000` | −∞ |
| MacBook Pro Microphone (Built-in) | `0.044316` | −27.1 |
| Default - MacBook Pro Microphone (Built-in) | `0.055187` | −25.2 |

Not "quiet". **Zero.** Every sample exactly `0.0`, which no real microphone in a real room has ever
produced — the floor measured when this meter was built was −70 to −51 dBFS in a quiet room, and
that is what a *silent* microphone looks like. These two devices are conferencing loopbacks. They
are inputs in the sense that a disconnected cable is an input.

So the recogniser transcribed nothing, because there was nothing; and the meter drew a flat line,
because the line was flat. Both were correct. Confirmed against the app itself: 13 analyser reads,
`maxRms 0.000000`, `--level: "0"`, bars at their resting `scaleY(0.14)`.

Then the control, which is the part that makes this a finding rather than a theory — the same app,
the same code, the same press, with `getUserMedia` forced to the built-in microphone:

```
EV start   EV audiostart   EV soundstart   EV speechstart
--level: 0.55    bars: 0.35 / 0.49 / 0.61 / 0.49 / 0.35
```

The meter works. It has worked the whole time. **The instrument was fine and the room was wired to
the wrong microphone.**

### What was missing, and it is ours

Nowhere on that page did it say *which* microphone. A meter that reads zero and a meter that is
pointed at a dead device are the same picture, and the reader has no way to tell them apart —
which is the exact failure the meter was built to end, one layer further down. Reporting an
observation without saying what was observed is only half an instrument.

Note also that Greg's failure produced **no error at all**. Silence yields `no-speech`, which is
deliberately suppressed because it fires on every ordinary pause, and Chrome then restarts happily.
Any feature keyed on "if there's an error" would have done nothing for him. That governs §4 below.

### What we are going to do about it

1. **Say the device's name**, from `track.label`, at the moment it is diagnostic — which is when
   nothing is being heard, not all the time. Turn the existing neutral line

   > Listening — no sound detected yet

   into

   > No sound detected yet · Microsoft Teams Audio Device (Virtual) · Change

   **Two facts side by side rather than one sentence joining them**, and the difference matters. The
   first draft read *"No sound from 'Microsoft Teams Audio Device (Virtual)'"*, which Sol correctly
   called a return of the diagnosis the previous round had refused to make: `quiet` means nothing
   crossed −55 dBFS for ten seconds, and a reader thinking in a quiet room produces exactly that.
   *From* turns a threshold into a verdict about a device. So the line reports the threshold, names
   what we opened beside it, and lets the reader draw the conclusion — which takes about a second
   when the name says "Virtual". The name is *not* shown while sound is arriving; there it is noise,
   and the bars have already answered the question.

2. **Let the reader choose the device.** A `<select>` of `audioinput` devices, revealed by a
   *Change* control on the quiet line, remembered in `localStorage`, sent as
   `{ deviceId: { exact } }` on the next start.

   Deliberately *not* done: silently preferring `'default'`, or skipping devices whose label matches
   `/virtual|loopback|teams|zoom/i`. Both override a choice the reader made in their browser's own
   settings, on the strength of a guess about what they meant, and both would be wrong for anybody
   who genuinely wants to dictate through a conferencing device. Name it and offer the list; the
   decision stays theirs.

3. `OverconstrainedError` — the remembered device has been unplugged — falls back to
   `{ audio: true }` rather than failing. A remembered preference must never be a way for dictation
   to stop working.

---

## 2. A different icon while it is recording

Today the armed button shows `MicOff`. That is wrong twice over: `MicOff` is the icon for *muted*,
so the one moment the microphone is live it wears the glyph for dead, and it says nothing about what
pressing it would do.

**`Square`, filled, in both armed phases.** A filled square is the universal stop, and the rule is
that *the icon says what the press does* — which is "stop" from the moment the button is armed,
including through the `opening` second. The phase is already carried by the colour and the pulse and
now by the strip's own words; it does not need the glyph as well, and `aria-label` has said "Stop
dictating" for both phases since the last round.

| phase | glyph | button |
|---|---|---|
| idle | `Mic` | outline, faint |
| opening | `Square` filled | outline, highlight, pulsing |
| listening | `Square` filled | solid highlight |

---

## 3. A timer

`m:ss` in the strip, counting **from the first `audiostart`** rather than from the press.

The press is the wrong zero. There is a measured 1.1 seconds between `start()` and `audiostart`
during which nothing is being captured, and a timer that counted it would be claiming to have
recorded a second of audio that does not exist. This is the same principle that made the button stop
going orange on the press. Across a Safari mid-session restart the clock keeps running, because it
is one dictation.

**A timer inside a live region announces itself once a second**, which for as long as somebody
dictates means "zero one, zero two, zero three". The first fix was `aria-hidden`, as the bars
already are. Sol's is better: **`role="timer"`**, which is exposed to a screen reader but is
implicitly `aria-live="off"` — so the elapsed time is there if you go looking for it and never
announced at you.

The rest of the restructure, and it fixes something that was already wrong. There is now **one
`role="status" aria-atomic` region, mounted for the life of the box** and empty when there is
nothing to say, carrying the phase sentence and the error. Every visible copy of those words is
`aria-hidden`. Two reasons: a live region that appears *already containing* its message is a new
element rather than a change, and several screen readers announce nothing at all; and `interim` was
previously inside the region, so every revision the recogniser made — several a second — was read
out. The confirmed text lands in the textarea, which is where a screen-reader user reads it.

---

## 4. Keep the audio, and hand it over when nothing came back

### The part that cannot be built, said plainly

**A web page cannot reveal a file in the OS file explorer.** There is no API for it and there is not
going to be one; it is a sandbox boundary rather than a gap. Nothing we write can open Finder.

The nearest true thing, and it is close: hand the reader the audio as a **download**. Chrome's own
downloads UI then carries a *Show in Folder* item, so the OS-file-explorer step still happens — taken
by the browser, at the reader's request, rather than by us. So the button says *Save the recording*,
and the reveal is one click further on in a place the reader already knows.

### The trigger is "nothing was transcribed", not "there was an error"

Greg asked for it on an error. His own failure raised no error — see §1 — so an error-only trigger
would have been silent through the whole thing.

So: **offer the recording whenever a dictation ends having produced no confirmed text.** One
predicate, evaluated once, at the end, on the session's final count. That covers the silent-device
case, the `network` case and the failed Safari restart, and it stays quiet on every dictation that
worked. A recording of Greg's session would have been fourteen seconds of digital silence, which is
itself the proof.

The first draft said *both* this **and** "on any error ending regardless", which Sol showed cannot
be one rule (item 2): words arrive, then `network` fires — has it succeeded or failed? Deciding at
the first confirmed result throws the audio away before the error; deciding at the end and keeping
it on error means holding audio through every successful dictation too. So there is one question and
it is asked once: *did anything come back?* If it did, the reader has what they said and does not
need the tape.

### What it costs and what bounds it

- Only where **we own the track** — the Chromium path. Safari's binary fallback never opens a stream
  (see [useDictation.ts](../../src/web/useDictation.ts)), so there is nothing to record and no
  recording is offered. This is the honest limit and it is worth stating: the browser most likely to
  need the evidence is the one that cannot produce it.
- **Dropped** when the dictation produced text, on unmount, when the reader starts another
  dictation, and by hand — there is a discard button, because "wait until you dictate successfully
  or leave the page" is not a deletion the reader controls (Sol, item 6). It lives in memory as
  `Blob` chunks and in no other place, and it is never uploaded anywhere.
- **Never offered unless it is really evidence.** A recorder that failed part way through, an empty
  blob, or anything under **two seconds** returns nothing at all. That last one is the accidental
  double-press: no text came back, so the retention rule would keep it, and a quarter-second of room
  tone dressed up as "the recording" tells the reader something false.
- **Two caps, not one.** Five minutes *and* eight megabytes. `audioBitsPerSecond` is a hint an
  encoder may exceed, so a size bound derived from it is arithmetic rather than a guarantee (Sol,
  item 10) — the byte cap is checked where the bytes actually are. Hitting either stops the
  recording and **not the dictation**, and the button then says *Save the first 5:00* rather than
  *Save*, because "the recording" would be a claim about the whole of it.
- **The recorder is drained before the track is released.** Killing the track under a live recorder
  loses the final `dataavailable`, which is the tail of the file and the part somebody listening
  back is most likely to want (Sol, item 1). The wait is bounded, so a recorder that never finishes
  cannot leave the microphone open.
- **Its zero is the first `audiostart`, the same instant as the timer's.** `getUserMedia` hands back
  a live track a measured 1.1 seconds before the recogniser reports the microphone open, so a
  recorder started when the track arrives produces a file longer than the timer beside it claims
  (Sol, item 4). A small lie, but exactly the kind this round exists to stop telling.

### The container matters more than it looks

Measured support in Chrome 151, and one of these is a trap:

| requested | supported | what you actually get |
|---|---|---|
| `audio/mp4;codecs=mp4a.40.2` | yes | **AAC-LC in MP4** — `ftypisom`, opens on a double-click |
| `audio/mp4` | yes | **Opus in MP4**, which macOS cannot play |
| `audio/webm;codecs=opus` | yes | fine, but nothing on a Mac opens it by default |
| `audio/ogg;codecs=opus`, `audio/wav`, `audio/aac` | no | — |

So the preference order is **AAC-in-MP4 first** (`.m4a`), then webm, then whatever `MediaRecorder`
picks for itself — and **bare `audio/mp4` must not appear in the list**, because it reports success
and produces a file that looks openable and is not. The whole point of the feature is that the
reader can do something with the file; a container their machine will not open fails the feature
while passing every check.

### Three consumers, one track — verified

The recogniser, the `AnalyserNode` and the `MediaRecorder` all read the same `MediaStreamTrack` at
once. Measured, 2026-08-27: `start audiostart soundstart speechstart` from the recogniser,
`rms 0.027` from the analyser, and 7 chunks / 13,971 bytes from the recorder, in one 2.5-second run.
Adding the recorder costs recognition nothing, and the one-capture invariant from the last round
survives intact.

---

## 5. What GPT Sol changed

The plan went to `gpt-5.6-sol` before anything was built and came back *"not ready to build"* with
three blockers. The full text is in
[microphone-device-and-recording-review-sol.md](microphone-device-and-recording-review-sol.md); this
is what happened to each.

| # | finding | was | now |
|---|---|---|---|
| 1 | Recorder finalization racing session teardown | `finish` stopped the track synchronously while the recorder was still live | recorder drained first, bounded wait, then the track — with a test that asserts the track was still `live` when the recorder was told to stop |
| 2 | Two contradictory retention rules | "dropped when it succeeds" *and* "kept on any error" | one predicate, `confirmed === 0`, asked once at the end |
| 3 | Device preference unenforceable, and a silent fallback | any `getUserMedia` failure fell through to a default-device start | fallback only for `OverconstrainedError`/`NotFoundError`; a refused permission produces a real error instead; picker hidden where we do not own the track |
| 4 | Recorder's zero ≠ timer's zero | recorder started when the track arrived, ~1.1s early | both start at the first `audiostart` |
| 5 | Cut the recording feature | — | **kept** — Greg asked for it. Mitigated with a two-second minimum, the item-6 conditions, and a discard button |
| 6 | Evidence and retention contract incomplete | any non-empty blob was offered | errored / empty / too-short all offer nothing; explicit discard; "Save the first 5:00" when capped; object URL made on click and revoked after a minute |
| 7 | Stored device id needs explicit recovery | — | `devicechange` refreshes an open picker; choosing mid-dictation restarts rather than deferring. **Not adopted:** clearing a stale preference after a fallback — see below |
| 8 | "No sound from X" is the diagnosis the last round refused | — | adopted Sol's wording: the threshold and the device name as two adjacent facts |
| 9 | Accessibility shape | live region mounted with the strip; timer `aria-hidden` | one persistent `role="status" aria-atomic` region; `role="timer"`, which is exposed but not announced |
| 10 | Caps are measurements, not guarantees | five-minute cap only | byte cap as well; extension read from the recorder's actual `mimeType` |

**The one finding not adopted**, item 7's first bullet: Sol wanted a preference cleared once it has
had to fall back, "rather than retry it forever". It is kept. A headset unplugged for an afternoon
should still be the choice when it comes back, and the cost of keeping it is one rejected
`getUserMedia` per press — while the cost of clearing it is silently losing a decision the reader
made. The fallback is not invisible either: the strip names whatever was actually opened.

### Then the code went back, and four of these were not actually fixed

The built code went to Sol a second time. Two of its findings were **things claimed above and not
done** — which is the argument for reviewing code rather than plans, in one line. The full text is
in
[microphone-device-and-recording-code-review-sol.md](microphone-device-and-recording-code-review-sol.md).

| # | finding | what was actually wrong | now |
|---|---|---|---|
| 1 | Teardown is not a barrier | `session.current` answers *is one running*, not *is this the latest press*. Press → stop with nothing said → press → stop, and the first tape resolves last into a `session.current` that is null again, publishing audio from two dictations ago | a `newest` ref, never cleared, and the publisher checks against it. Also: `chooseDevice` now cancels its tape explicitly, so the old track is released *before* the new capture opens rather than after a drain nobody wanted |
| 2 | A refusal still starts recognition on some other device | true, and the claim that only `OverconstrainedError` caused a fallback was about the *second `getUserMedia`* — the recogniser's own `start()` runs regardless, on a microphone we cannot name | it still starts (a meter that cannot get samples must never be what stops dictation) but the strip now says **"The microphone you chose isn't available. Using another one."** |
| 3 | The bounded flush hands over an unfinished recording | `Promise.race` could not tell `done` from the timeout, so a recorder that never fired `stop` had its partial chunks offered as evidence | the race reports its winner; a timed-out flush yields nothing |
| 4 | The byte cap was not a cap | the chunk was stored and *then* measured, which bounds nothing — and the test blessed a 9 MiB blob against an 8 MiB limit | the chunk that would overflow is refused, so the blob is never larger than the cap, and the test asserts that instead |
| 5 | The timer diverges from the recording after a cap | true and left alone: the timer describes the **dictation** and the save button prints the **recording's** own length, so the two numbers are labelled as the different things they are | — |
| 6 | `role="timer"` was inside an `aria-hidden` strip | so the timer was hidden from assistive technology entirely — the exact opposite of the point of giving it that role | `aria-hidden` moved onto the repeated parts; the strip itself is not hidden |
| 7 | The `<select>` showed a preference that was not the active device | a remembered device no longer in the list left a `<select>` whose value matched no option, which renders blank or as whatever is first | an explicit "Your usual microphone (not available now)" option |

### Two bugs the tests found that neither review did

Both were written by me, reviewed by Sol, and still wrong — and both are the
[silent-success](../reusable/silent-success.md) shape, in that the broken version does something
plausible rather than throwing.

1. **`err instanceof Error` never matched.** The fallback for a missing device was guarded on
   `instanceof Error`, and `OverconstrainedError` is **not** reliably an `Error` subclass — it is
   its own interface carrying a `constraint` property. So the fallback would have been dead code in
   the browser, and the reader would have got no microphone at all instead of the default one. The
   guard now reads `.name` off the object.
2. **`MediaRecorder.isTypeSupported` was assumed to exist.** It arrived separately from
   `MediaRecorder` itself, and calling a missing one throws — out of `recordTrack`, which is
   documented as never throwing. Found by a fake recorder that happened not to have it.

### And one the tests were hiding, which Sol saw and I had not

The fakes fired `MediaRecorder.onstop` **synchronously**. A real one flushes and then fires, so
every ordering assertion in the file was closing its own window inside a single microtask drain and
passing whether the code was right or wrong. Sol named it in items 1 and 3.

Deferring the fake's `onstop` by one task turned three assertions honest at once — and the check
that the old microphone is released before the new one opens, which had passed against deliberately
broken code, then failed against it as it should. **A test that has never been red proves nothing**,
and the way to find out is to break the source on purpose and watch. Every guard added in this round
was checked that way.

---

## Files

| file | change |
|---|---|
| [src/web/useDictation.ts](../../src/web/useDictation.ts) | device preference, `startedAt`, recording handover, confirmed-text count |
| [src/web/mic-devices.ts](../../src/web/mic-devices.ts) | **new** — enumerate inputs, remember a choice, build the constraint |
| [src/web/mic-recording.ts](../../src/web/mic-recording.ts) | **new** — record the track to memory, hand back a blob |
| [src/web/ProfileBox.tsx](../../src/web/ProfileBox.tsx) | `Square`, the timer, the device line, the picker, the save button |
| [src/web/MicLevel.tsx](../../src/web/MicLevel.tsx) | unchanged |
| [src/web/styles.css](../../src/web/styles.css) | the picker, the timer, the save row |

## What is deliberately not being built

- Any attempt to open Finder, or to explain to the reader why we cannot. The button downloads a
  file; that is the whole promise it makes.
- Uploading the failed recording anywhere, including to us, including to transcribe it. That would
  make the reader's voice cross a wire on the one path where they have least reason to expect it.
- Guessing which device the reader "really" meant.

## What the browser pass could and could not reach

A Sonnet subagent drove Chrome 151 against `/profile`. Three things confirmed, and then a wall
worth writing down, because the next person will otherwise spend the same hour on it.

**Confirmed in a real browser:** the idle button is Lucide's `mic` glyph; on arming it becomes
`lucide-square` with a filled `<rect>`; and `.prof-listening` appears the instant the button arms,
carrying `Listening 0:00`, rather than waiting for text.

**Unreachable from automation, and structurally so.** `document.visibilityState` read `hidden` for
the entire session — screenshots did not stick it visible, and it was `hidden` again on the very
next call every time. That is already known to freeze the meter bars
([browser-testing.md](../project/browser-testing.md)), but it is worse than that:

- **`quiet` is computed inside the same `requestAnimationFrame` tick as the bars**
  ([useAudioLevel.ts](../../src/web/useAudioLevel.ts)), so in a hidden tab it can never become
  true. The quiet line, the device name, the *Change* control and the picker all hang off `quiet`,
  so **items 5, 6 and 7 cannot happen in an automated tab at all** — they are not slow or flaky,
  they are unreachable.
- **The timer never advanced**, because [useNow.ts](../../src/web/useNow.ts) explicitly stops its
  interval while hidden and catches up on return. The element, its format and its `role="timer"`
  are all right; it is frozen for a documented reason rather than a new bug. That it *ticks* is
  still unproven by anything but a test.

**And one genuinely open question.** Several clean arm→stop cycles of 3s and 4.2s produced no
`.prof-recording` and no error. A 3s arm is only ~1.9s of recording once the 1.1-second opening gap
is subtracted, so that one is `MIN_MS` working as designed — but the 4.2s one should have offered a
file. One earlier stop did produce *"The microphone was disconnected. Press it again to start
over."*, which means the silent virtual device sometimes **ends its own track**. The suspicion, not
yet tested: a recorder whose track ends underneath it may go inactive without firing `stop`, in
which case `halt()` times out, `timedOut` is set, and `MicTape.stop` correctly returns null — so the
guard that stops us handing over a half-finished file also suppresses the recording in one of the
cases a reader would most want it. Worth a browser session with `MediaRecorder` instrumented before
anything is changed; the fix is not obvious and guessing at it would make the evidence contract
worse.

The extension then disconnected mid-run, so the tab was left without its cleanup: **the mic may
still be armed on that page, and the profile textarea has not been re-read since**. Its last
confirmed value was correct, and nothing in the run had a mechanism to change it — the device
transcribes nothing — but that is an argument, not a reading.

## What is still unverified

- **Safari and iPadOS**, entirely. There is no `start(audioTrack)` there, so no track, so no meter
  beyond the binary one, no device name, no picker and no recording. That whole branch is exercised
  by tests and by nobody's hands.
- **A `network` error in the wild**, and therefore the recording being offered after a real failure
  rather than after a silent device.
- **The saved file opening.** The container work was measured — AAC-in-MP4, `ftypisom`, 17 KB for
  1.2s — but no `.m4a` produced by this code has yet been double-clicked on a Mac.

## Questions for Greg

1. **Your default microphone in Chrome is "Microsoft Teams Audio Device (Virtual)"**, which emits
   digital silence. That is almost certainly what you hit, twice. It is a browser setting rather
   than a macOS one — `chrome://settings/content/microphone` — and the new picker will now let you
   change it from inside the app instead. Worth changing in Chrome too, since everything else that
   uses the microphone has the same problem.
2. **Should the recording be offered on every empty dictation, or only when there was also an
   error?** Recommendation, and what is built: every empty one — your own failure had no error, so
   the narrow version would have helped you not at all.
3. **Is a device picker in the strip too much furniture?** Sol wanted the whole recording feature
   cut and thought the timer expendable too. Recommendation, and what is built: keep all three, but
   the picker only appears behind *Change* on the quiet line, so a working microphone never shows
   it.
4. **Five minutes, eight megabytes, 32 kbps** — caps nobody has hit. Recommendation: leave them.
