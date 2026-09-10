# Dictation asks for the microphone twice on an iPhone

Feedback report **SPIDERYARN-READING2-2R** (report `spya-y8va9d`, 2026-09-08 17:45 UTC, build
`cec18ed8`), from Greg, filed from the Feedback dialog on
`/read/temporal-context-reinstatement-spya-dhqkf9?mode=outline`:

> When I use the microphone for voice dictation in the feedback dialog box, it seems to ask me for
> permission, sometimes twice in a row, even though I've given permission a bunch of times in the
> past. This is using an iPhone. I had shared the app to my home screen.

The machinery is [dictation.md](../project/dictation.md); the note that closes the report is
[260908_1745-microphone-permission-asked-twice-on-iphone.md](../user-feedback/260908_1745-microphone-permission-asked-twice-on-iphone.md).

## What is happening

Two separate complaints, and only one is ours.

**"Twice in a row" is ours.** On the first press after every page load, `beginCapture` in
[`useDictation.ts`](../../src/web/useDictation.ts) runs a capability probe before it opens the
microphone. The probe asks whether this browser's `SpeechRecognition.start()` takes a
`MediaStreamTrack` (Chromium 135+ does) by calling `r.start(NOT_A_TRACK)` on a real recogniser:
Chromium throws `TypeError` and starts nothing, while WebKit ignores the argument and **starts**. The
code then calls `abort()` in the same turn, waits up to 200 ms for `end`, and calls `getUserMedia`.

The comment justifying this argued that an abort in the same turn beats the task that opens the
capture. That is true of the capture. It is **false of the permission prompt**. Traced in WebKit
`main` by a research subagent, 2026-09-10:

- `SpeechRecognition::start` sends Start to the UI process, and `abort()` sends Abort behind it
  ([SpeechRecognition.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechRecognition.cpp)).
- Start goes straight to `SpeechRecognitionPermissionManager`
  ([SpeechRecognitionPermissionManager.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/SpeechRecognitionPermissionManager.cpp)),
  whose last step is the same per-site "use your microphone?" prompt `getUserMedia` uses
  (`checkUserMediaPermissionForSpeechRecognition`). Before that come the system-level Speech
  Recognition and microphone prompts, each asked once per app.
- Abort removes the request from the server's list and fires `end`. **It does not dismiss the
  prompt**, and when the reader answers it, the answer is quietly dropped.
- The grant is shared in principle, but the speech request never becomes the "current" request. So
  the `getUserMedia` that arrives about 200 ms later, while the first prompt is still on screen,
  finds no grant and puts up its own prompt. That makes two prompts.
- The speech permission state is cleared on every new main document
  ([WebPageProxy.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/WebPageProxy.cpp),
  `didChangeMainDocument`), so this repeats on every page load.

A code-trace subagent confirmed the order in this repo: `start()`, `abort()`, `getUserMedia`,
`AudioContext`, `MediaRecorder`. It checked that none of the other calls can prompt. It also checked
that the probe's cache is keyed on the global constructor, so the probe really does run once per
page load: once on the first press, never on later ones. That fits "sometimes". It also found a
second way the probe could make a reader press twice. The session's `onerror` is attached before
the probe runs. If the aborted recogniser fires an `error` before our track exists, the dictation
ends with `[mic-stopped]` and the reader has to press again. No test covered that. Whether real
WebKit fires that error is not known.

The existing test said all this out loud and called it harmless:
`expect(latest().started).toEqual([null])` — *"One entry, and it is **the probe**"*.

**"Even though I've given permission a bunch of times" is mostly WebKit's.** Also from the source,
and from [WebKit bug 215884](https://bugs.webkit.org/show_bug.cgi?id=215884):

- A `getUserMedia` grant lives for the **current page only**. It is dropped on reload, on navigation,
  and when the page's web process dies.
- On iOS a call without a user gesture is prompted again if capture ended more than **1 minute**
  ago (desktop: 10). After 10 minutes with no capture, every grant is cleared.
- A home-screen web app has no reachable per-site "Allow" setting. Forum reports in that bug say
  every cold start loses the grant. iOS reloads a backgrounded web app whenever it likes.

So a reader who opens the home-screen app, reads, and dictates feedback is on a fresh page far more
often than a desktop reader. That makes the first-press double prompt the common case there, not an
edge.

## What we are doing

**Only ask the probe's question on Chromium.** `probeIsSafe()` in `useDictation.ts` returns
`"userAgentData" in navigator`. `navigator.userAgentData` is Chromium's own (Chrome, Edge, Opera,
Brave, Samsung Internet), and no WebKit or Gecko build ships it. Everywhere else the probe answers
"no" without starting anything. That lands Safari, iOS (including Chrome on iOS, which is WebKit)
and anything else in the row it already ended up in: our track, a meter, the recording, the
transcript, no live words.

What each browser gets afterwards:

| | before | after |
|---|---|---|
| Chrome / Edge 135+ | probe throws `TypeError`, nothing starts; live words | **unchanged** |
| Chromium < 135 | probe starts + aborts (shared persisted grant); no live words | unchanged |
| Safari macOS / iOS / home-screen app | probe starts + aborts, **a prompt nobody asked for**; no live words | no probe, no extra prompt; no live words |
| Firefox | no recogniser, no probe | unchanged |

The desktop path is unchanged by construction. On Chromium the gate is true, and everything after
it is the same code. `tests/dictation-recording.test.ts` proves the gate is what unlocks live words:
its timer tests went red until its fixture declared a Chromium engine.

This also removes the `[mic-stopped]` risk above on WebKit, because no recogniser is ever started
there.

### What we passed over

- **A behaviour-based detect that does not start anything.** There isn't one. `start.length` is 0.
  A brand-check call on a foreign receiver throws on both engines before argument conversion. A
  browser without the overload ignores the argument, so every question you can put to `start` is
  answered by starting. The gate has to be the engine, and the failure it permits is the cheap one:
  an engine that ships the overload without `userAgentData` loses live words, which are decoration
  ([dictation.md § It transcribes twice](../project/dictation.md#it-transcribes-twice)).
- **A sibling feature detect** (`SpeechRecognition.available`, `SpeechRecognitionPhrase`) that only
  newer Chromium has. That is the same kind of sniff, tied to version numbers we have not measured.
  It would also drop the probe for Chromium 135 to whatever shipped the sibling, for no gain.
- **Dropping the probe everywhere.** That costs Chrome its live words, which is the desktop
  degradation the brief rules out.
- **Keeping one `MediaStream` alive for the page's life** to dodge WebKit's 1- and 10-minute
  re-prompts. That keeps the orange microphone indicator on while nobody is dictating, holds the
  iOS audio session (which ducks other audio), and does nothing across the cold starts that are the
  home-screen app's usual case. It is the wrong trade for a privacy-sensitive affordance.
- **`navigator.permissions.query` to explain the prompt beforehand.** WebKit reports "granted" only
  for a page that already holds a grant, and reports "denied" as "prompt". So it cannot predict the
  prompt it would be explaining.

## What stays true afterwards, said plainly

A home-screen app on iOS will still ask **once** on the first press after a cold start, and again
after WebKit's idle timeouts. Nothing a page does changes that. The fix removes the *second* prompt
and the one we caused, not WebKit's own policy. The note to Greg says so.

## Verified, and not

Verified here:

- The probe's `start()` is called on the Safari-shaped fake before the fix: three new or changed
  tests in [`tests/dictation-phases.test.ts`](../../tests/dictation-phases.test.ts) went red
  (`expected [ null ] to deeply equal []`), then green after it.
- One of those, the two-press test, first passed against the **unfixed** code. The probe's cache is
  per constructor, and an earlier test in the file had already probed the same `SafariRecognition`
  class, so later Safari tests could never see a probe. `useSafari()` now installs a fresh subclass
  each time. That is the test fixture's own instance of the silent-success class.
- Chrome's path: every existing Chromium-shaped test still passes, and removing the engine from
  `dictation-recording.test.ts`'s fixture reds its three live-words timer tests. So the gate is
  load-bearing in both directions.
- The WebKit mechanism: read in WebKit `main` source by a subagent, with links above. Not run.

**Not verified, and cannot be from this box:**

- **No iPhone ran this.** The box has no audio input and no WebKit ([memory: no audio input device
  on this box]). That the extra prompt disappears on a real iPhone is inferred from the source
  trace, not observed. The check is Greg's: on the home-screen app, force-quit it, reopen, press the
  Feedback microphone once. It should ask once, not twice. Then press again within a minute: no
  prompt.
- Whether Safari's closed-source prompt UI merges or queues the two requests. It doesn't change
  the fix, which removes one of them.
- Whether the gesture survives the path from press to `getUserMedia`. See § The gesture below.

## The gesture

WebKit's 1-minute re-prompt applies only to a request **without** a user gesture, and
`computeUserGesturePriviledge` in `MediaDevices.cpp` counts only the first microphone request under a
gesture. Between the press and `getUserMedia` there is `await claimMicrophone(...)` from
[`mic-lock.ts`](../../src/web/mic-lock.ts). With nobody else holding the microphone, that resolves
in microtasks. Before this fix there was also the probe's `setTimeout`-bounded wait for `end`.

**It survives, so there is no second stage.** A third subagent read the source, 2026-09-10. WebKit
does not propagate the gesture token into promise microtasks in general (only for `fetch` and
`enumerateDevices`). It does not need to here, because the listener's microtask checkpoint runs in
`~JSExecState` while the click's `UserGestureIndicator`
([EventHandler.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/EventHandler.cpp))
is still in scope. So a `getUserMedia` reached through microtask-only awaits is gesture-privileged.
A `setTimeout` forwards the gesture if it fires within 1 s of the click
([DOMTimer.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/DOMTimer.cpp)), so
even the old 200 ms wait kept it.

The rule itself is confirmed at `UserMediaPermissionRequestManagerProxy.cpp`:
`!isUserGesturePriviledged && inactiveMediaCaptureStreamDuration().minutes() > …RepromptWithoutUserGestureIntervalInMinutes()`,
where iOS defaults to 1 minute. The 10-minute clear applies with or without a gesture, and nothing a
page does avoids it.

One caveat, inferred rather than read: that an iOS tap reaches the same mouse-release path. The one
case that does leave the microtask chain is `claimMicrophone` waiting for **another box** to let go.
That is a real wait on a track ending, and it could lose the gesture if it takes over a second. It is
rare (two dictation boxes, one already running), and it is not the report's case. It is noted here
rather than built.

## Stages

1. **The gate and its tests** — `probeIsSafe()`; the Safari test's assertion reversed; a two-press
   test; an engine-not-shape test; fresh Safari constructor per test; Chromium engine declared in
   both fixtures. Docs: [dictation.md](../project/dictation.md) § One capture. Postmortem.
   GPT Sol code review.
2. **The bookkeeping** — the note in `docs/user-feedback/`, closing the queue entry.

## Review

[Filled in after GPT Sol.]
