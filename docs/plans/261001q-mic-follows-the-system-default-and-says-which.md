# 261001q — the microphone follows the system default, and the strip always says which one

Greg's report `spya-g8byyd` (SPIDERYARN-READING2-8Q), 2026-10-01, Feedback dialog on production:

> I got this error when I tried to use the voice dictation in Feedback:
>
> "We didn't catch any words in that. The audio is below if you want it. [mic-silent]"
>
> It seems to be working fine when I use another voice microphone app and the sound input on my Mac
> is set to use my webcam's microphone. So I almost wonder whether we're not using the default
> microphone for the system somehow.

The brief: find out what we ask the browser for, make dictation follow the system default, and
ideally show which device we're listening on.

GPT Sol reviewed the first draft of this plan
([review](261001q-mic-default-plan-review-sol.md)). It found that the draft's diagnosis was wrong
and its fix was cosmetic. This is the rewrite.

## What we asked for

[`mic-devices.ts` § `audioConstraint`](../../src/web/mic-devices.ts) asked for one of two things:

- **Nothing remembered** → `{ audio: true }`: whatever the *browser* picks.
- **A microphone picked in our own picker**, remembered in `localStorage` →
  `{ audio: { deviceId: { exact: id } } }`, on every later press.

Dictation (`useDictation.ts` § `beginCapture`) and live conversation (`useLiveConversation.ts`)
both go through it. The strip named the opened device **only after ten seconds of silence**.

## Why `{ audio: true }` is not the system default on Chrome

Chrome has its own default microphone: the setting at `chrome://settings/content/microphone`, and,
since Chrome 123, a device chooser in the permission prompt. `{ audio: true }` opens *that*, not
the macOS input. This has already happened to Greg once: on 2026-08-27, with nothing remembered,
`{ audio: true }` opened a silent Teams loopback, while `Default - MacBook Pro Microphone` was
listed alongside it ([260827k](260827k-microphone-device-and-recording.md)). My first draft treated
that path as merely unreproduced; Sol pointed at the evidence already in the repo.

Reproduced on the box (Chrome, `--use-fake-device-for-media-stream`, with Chrome's default
microphone set through the profile preference `media.default_audio_capture_device`):

| request | Chrome's setting: none | Chrome's setting: Fake Audio Input 1 |
|---|---|---|
| `{ audio: true }` | `Fake Default Audio Input` | **`Fake Audio Input 1`** |
| `{ deviceId: { ideal: "default" } }` | `Fake Default Audio Input` | **`Fake Audio Input 1`** |
| `{ deviceId: { exact: "default" } }` | `Fake Default Audio Input` | `Fake Default Audio Input` |

The scripts are `g8-spike*.mjs` in this session's scratchpad (`g8-spike3.mjs` is the one with the
right raw ids, `fake_audio_input_1`/`_2`). **Only `exact: "default"` follows the operating system
past Chrome's own choice.** `ideal` loses to it, as Chromium documents.

So there are two ways Greg's press could have opened something other than the webcam: Chrome's own
choice, or a stale pick in our picker. I cannot see his Chrome settings or his `localStorage` from
here, so **which one it was is not established.** The change covers both, and the device line
below says which one it was the next time he presses.

## What changes

1. **The system default, by name, on Chromium.** With no pick, `beginCapture` (and the live
   conversation's capture) first checks `enumerateDevices` for an input whose id is `"default"`. If
   there is one, it asks for `{ deviceId: { exact: "default" } }`. Safari and Firefox list no such
   id, and there `{ audio: true }` already is the system microphone (WebKit bug 198577, Firefox
   bug 1850082, per Sol), so they are unchanged. Before the page has ever been granted the
   microphone, Chromium hides every id, so **the very first press on a new browser still opens
   Chrome's choice**; every press after it opens the default.
2. **A missing `"default"` falls back quietly.** If it is listed and then fails to open
   (`OverconstrainedError`/`NotFoundError`), we retry with `{ audio: true }` and no warning,
   because nobody chose anything. The missing-device check is now one shared helper,
   `deviceMissing`. Live conversation had its own copy using `instanceof DOMException`, which an
   `OverconstrainedError` need not be — the very bug dictation's copy had already been fixed for.
3. **The device is named for as long as dictation is on**, on a line of its own:
   `Microphone: Default - Logitech BRIO  Change`. It used to appear only after ten seconds of
   silence, in the listening row, where it was the one item allowed to shrink. Moving bars prove
   that *a* microphone hears sound, not that it is the one you meant. **`(your choice)`** is
   appended when a pick from our picker is in force; that comes from the remembered id, not from
   the label (Sol: a bare label does not reliably mean a pick). The Change button's accessible
   name says what it changes and what is current.
4. **"System default"** is the first option in both pickers: dictation's (was "The browser's
   default") and live conversation's (was "Browser default"). That is now true.
5. Docs: [dictation.md](../project/dictation.md) failure 9, and the header of `mic-devices.ts`,
   which used to list "no preferring `'default'`" as something it deliberately did not do.

### After GPT Sol's code review

[Review](261001q-mic-default-code-review-sol.md); Sol fixed these itself and I read the diff:

- **A missing pick now falls to the system default too**, not to `{ audio: true }`, in both
  dictation and Live: chosen → `exact: "default"` → unconstrained only if that has gone as well.
  Live says "Using another microphone" in that last case rather than claiming the system default.
- **Ownership is re-checked after each new await** (the recogniser probe and both enumerations), so
  a stop in that gap cannot open a microphone after the page-wide claim was released. There are
  red-then-green lock tests for both paths.
- `(your choice)` and both pickers re-read the shared preference on each press or connection, so
  a pick made in Live shows correctly in dictation and the other way round.
- `honoured` starts false and is set only when the first request actually returns a track.

## What this passes over, and why

- **`ideal: "default"`.** The obvious one-liner, and measured not to work: Chrome's own choice
  beats it.
- **Forgetting everybody's remembered pick once** by renaming the storage key. That would clear a
  stale pick without Greg touching anything, but it would also throw away deliberate ones (the
  iPhone AirPods of spya-k3q9mc), and it would not help if Chrome's choice was the cause. With
  `(your choice)` now on screen, a stale pick shows itself and takes one click to clear. Sol agreed.
- **Ignoring remembered picks.** That would take away the escape route built for the day the system
  default was itself the wrong device (the Teams loopback).
- **Announcing the device to screen readers when capture opens.** It is navigable text beside the
  button, and the button's name carries it. A second live-region announcement on every press is
  noise.

## Tests

- `tests/dictation-phases.test.ts` § "the system default": `exact: "default"` is requested when
  listed, and opens the default even though the browser's own choice is another device; a
  `"default"` that vanishes before it opens falls back to `{ audio: true }` with no warning; no
  `"default"` listed means `{ audio: true }`. The first two go red with the detection broken
  (checked).
- `tests/mic-devices.test.ts`: the constraint for each case.
- `tests/dictation-quiet-warning.test.tsx`: the line is there while sound is getting in, `(your
  choice)` only with a remembered pick, and the picker leads with "System default". Red against the
  old strip (checked).

## Not testable on the box

The real failure needs Greg's Mac: a webcam as the macOS input, Chrome's own setting or prompt
choice, and whatever is in his `localStorage`. The fake devices show which device each request
opens, including past Chrome's own setting. They cannot show the macOS default changing under a
running Chrome, and they cannot show Safari or Firefox at all. Whether Chrome on macOS lists
`"default"` for a webcam microphone is from the 260827k measurements (it listed
`Default - MacBook Pro Microphone`), not from a run today.
