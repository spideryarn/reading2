# A cancelled request still asks the reader

For twelve days, on Safari and in the iPhone home-screen app, the first dictation press of every page
load asked for the microphone twice. The first prompt was for a speech recogniser that our own code
had already thrown away. It reached a reader, Greg, who reported it from an iPhone as
SPIDERYARN-READING2-2R: *"it seems to ask me for permission, sometimes twice in a row, even though
I've given permission a bunch of times in the past."* Nothing was lost but patience. The fix and the
evidence are in [260910g](../plans/260910g-dictation-asks-for-the-microphone-twice-on-iphone.md).

## What happened

`beginCapture` in [`useDictation.ts`](../../src/web/useDictation.ts) needs to know whether
`SpeechRecognition.start()` accepts a `MediaStreamTrack`, and the only honest way to ask is to call
it. Chromium type-checks the argument and throws before anything starts. WebKit ignores the argument
and starts. So the code called `r.start(NOT_A_TRACK)`, then `r.abort()` in the same synchronous
turn, and argued in a long comment that the abort beats the task that opens the device, *"so on
the browsers that fail this probe the microphone is never opened at all."*

That was true of the device. But in WebKit, `start()` hands the request to the UI process, and the
first thing there is the permission manager. It shows the same per-site "use your microphone?"
prompt `getUserMedia` shows. The abort removes the request and fires `end`. It does not dismiss the
prompt. The `getUserMedia` 200 ms later finds no grant yet, so it puts up the second prompt.

Introduced in `fcd049cb` (2026-08-27, *"Show the microphone is listening, since it could not say so
before"*), which moved every browser onto one owned track. That was a good change. The probe was
how it told Chrome from Safari.

## The class: a cancelled request still asks the reader

**An operation whose side effect is a question put to a person cannot be undone by cancelling the
operation.** Cancel, abort and close all undo *machine* state: a socket, a device handle, a queued
task. A permission prompt, a system dialog, a notification or an OS "allow?" sheet is *human*
state. Once it has been shown, it has been shown. Any code that does something speculatively and
then rolls it back ("try it and see", a feature probe, an optimistic start) is safe only if every
side effect of the attempt can be rolled back. A prompt can't be, and it is a side effect the
attempt's own API does not mention.

The same shape turns up wherever a probe touches a gated API. For example: calling
`Notification.requestPermission()` to see whether notifications work; `geolocation.getCurrentPosition`
with a zero timeout to test support; opening a popup and closing it at once to check that popups
are allowed.

## Why nothing went red

- **The test described the bug and passed.** `tests/dictation-phases.test.ts` asserted
  `expect(latest().started).toEqual([null])`, with the comment *"One entry, and it is **the probe**"*,
  and said the assertion that mattered was that nothing started the recogniser *again*. The fake
  can model `start()` and `abort()` but not a dialog. So the check shared the code's assumption that
  "started then aborted" costs nothing, and agreed with it. [silent-success.md](../reusable/silent-success.md),
  in its commonest form.
- **The review asked the right question about the wrong resource.** GPT Sol's code review (item 4)
  caught that `abort()` does not synchronously release the *device*, and the code gained a wait for
  `end`. Nobody asked what else `start()` does before the abort lands.
- **The test fixture hid a probe as well.** The probe's answer is cached per constructor, and every
  Safari test reused one class. So only the first Safari test in the file could ever see a probe.
  The new two-press test went green against the unfixed code until `useSafari()` began installing a
  fresh subclass.
- **No iPhone has run dictation.** [dictation.md § What is still open](../project/dictation.md#what-is-still-open)
  says so: *"Safari's whole path here … is reasoned rather than observed."* The one tester who
  could see the prompt was the reader.

## What would have caught it, ranked by ease against value

1. **Gate a side-effecting probe on the engine, not the behaviour, where the behaviour can only be
   observed by paying for it.** Done: `probeIsSafe()` asks the question only where `userAgentData`
   says Chromium, and the Safari tests now assert the recogniser is never started at all. This
   rules out this instance by construction.
2. **When you write "cancel it at once", list what the operation shows a person.** A habit, and it
   is aimed at the class. Put it next to any `start(); abort()`, `open(); close()` or
   request-then-ignore pair. It would have turned the comment's argument from "the device is never
   opened" into "the device is never opened, *and the prompt?*". It lives here and in
   [dictation.md](../project/dictation.md#one-capture-and-it-is-always-ours), where the next
   probe would be written. It does not belong in the rules doc: the shape is rare in this app, and
   one grep found no sibling.
3. **A fixture that caches per constructor gets a fresh constructor per test.** Done for this file.
   This is the second time a WeakMap cache has made test order decide an outcome here (the
   `overloads` comment already records the first). Worth knowing whenever a module-level cache is
   keyed on something a fixture reuses.
4. **A real iPhone pass before a platform is claimed to work.** Rejected as a standing gate: the
   box has neither a microphone nor WebKit, and a device lab is out of proportion for a beta. The
   cheap version is already available: ask Greg for one tap on his phone when a change is
   WebKit-specific, and write down that it has not happened until it has.

## The fix that is right for the long term

What shipped is the long-term fix, not a patch. The engine gate is the honest form of the probe,
because no behaviour test exists that doesn't cost a prompt. If WebKit ever ships `start(track)`,
the gate costs Safari its live words (decoration) until somebody adds a line. That is the cheap
direction to be wrong in. The deeper fix, one capture that every browser can share with its
recogniser, belongs to WebKit, not to us.

## The thing I would tell myself

The comment was a careful argument about the one resource I had been told to worry about, the
device, and it was right about that. I never asked what else `start()` does, because the review had
already framed the problem as "does abort release the device". When an API is a gate to a person, as
every permissioned web API is, the first question is not "can I undo this?" but "who sees it before
I do?".
