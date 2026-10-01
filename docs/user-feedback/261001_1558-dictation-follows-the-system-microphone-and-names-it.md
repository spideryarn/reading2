---
reports: spya-g8byyd
ending: shipped
---
# Dictation follows the system microphone, and names it while it listens

SPIDERYARN-READING2-8Q, from Greg (admin, provenance checked with `feedback-reporter.ts`), a
problem, filed 2026-10-01 15:58 UTC on production.

> I got this error when I tried to use the voice dictation in Feedback:
>
> "We didn't catch any words in that. The audio is below if you want it. [mic-silent]"
>
> It seems to be working fine when I use another voice microphone app and the sound input on my Mac
> is set to use my webcam's microphone. So I almost wonder whether we're not using the default
> microphone for the system somehow.

**Ending: Shipped.** On `dev` in 051a9810 and 9655cdaf (GPT Sol's code-review fixes), plan
[261001q](../plans/261001q-mic-follows-the-system-default-and-says-which.md). Not deployed: the
Overseer deploys.

- **What we asked for.** With nothing picked, `{ audio: true }`. On Chrome that opens *Chrome's*
  default microphone (its settings page, or the device chooser in its permission prompt), not the
  Mac's input. Measured on the box: with Chrome's default set to another device, `{ audio: true }`
  and `ideal: "default"` both opened it, and only `exact: "default"` opened the system default.
  With a mic picked in our own picker, we asked for that one by exact id on every later press.
- **The fix.** With nothing picked, Chromium is now asked for its `"default"` input by exact id,
  which follows macOS. Safari and Firefox are unchanged, because there `{ audio: true }` already is
  the system microphone. A picked microphone that has gone also falls to the system default now.
  The same applies to live conversation.
- **Which device.** The strip says `Microphone: <name>  Change` for as long as dictation is on,
  rather than only after ten silent seconds, with `(your choice)` when a pick of ours is in force.
  Both pickers lead with "System default". Checked in Chrome at 1280 and 390 px with fake devices.
- **Not established:** which of the two paths it was on Greg's Mac, Chrome's own choice or an old
  pick of ours. The fix covers both, and the new line will say which on his next press. If it reads
  `(your choice)`, choosing "System default" once clears it.
- **Not tested:** a real Mac, a real webcam, Safari and Firefox. And the very first press in a
  browser that has never granted the microphone: Chrome hides device ids until then, so that one
  press still opens Chrome's own choice.
