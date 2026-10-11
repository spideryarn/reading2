---
reports: spya-az6puq, spya-j5h3cb
ending: shipped
comment: Both on dev. A dictation of a second or so is now transcribed (it used to need two). Stop now waits 300 ms for a second press with nothing on screen changing, so a double press lands and sends once the words arrive.
---
# Dictation hears a brief instruction, and Stop waits for a second press

Two admin reports from Greg (`scripts/feedback-reporter.ts` exit 0 on both production rows, no
addenda when re-read before this note), both filed from Chat on
`rhizome-1000-plateaus-introduction-lambert-says-spya-jc9azw`. Overseer queue item `qi-23mq9een`,
session `fbaz6puq-dictation-short-and-double-click`.

`spya-az6puq` (SPIDERYARN-READING2-HQ), 2026-10-11 09:27 UTC, a suggestion:

> When I try and use the voice dictation mode, it looks like there's some kind of cutoff for less
> than a few seconds that it treats as being basically empty. The problem is that's not much help in
> something like Command Bar, where I might want to give a really brief instruction by voice.

`spya-j5h3cb` (SPIDERYARN-READING2-HN), 2026-10-11 09:24 UTC, a suggestion:

> … as soon as I click the first of the two double-click clicks, it automatically kind of changes
> the UI, and so it's very hard to click the second time. So I think probably what we need is a
> very short delay, maybe 300 milliseconds at most, that after the first click, before, I guess, it
> gets sent, so that it waits for a second double-click. … It's not worth a huge amount of
> complexity. … I suppose we could replace it with a long click. That's simpler.

**Ending: shipped.** On `dev`, not deployed. The next feedback sweep should mark both Sentry issues
`resolved`; this session has no Sentry sign-in.

## What we did

Plan, measurements and both GPT Sol reviews:
[261011y](../plans/261011y-dictation-short-recordings-and-a-double-press-that-lands.md).

- **Short recordings.** The cutoff was real: anything under two seconds (`MIN_MS` in
  `mic-recording.ts`) was thrown away before upload and the reader told *"We didn't catch that"*.
  It is now 0.6 s, which still catches an accidental start-and-stop. The fleet dashboard had a
  second two-second floor on its server; that is now the product's too.
- **The double press.** A browser check found it worked only when the words were slow: a few
  seconds of speech came back inside the old 600 ms window after Stop, the layout sprang back (the
  button dropped 59 px in Chat) or the button turned back into Dictate, and the second click
  missed. As Greg suggested, a Stop press on a box that sends now **waits 300 ms** before stopping,
  with nothing on screen changing and the focus left on the button, and a second press inside it
  stops at once and sends when the words land. Re-measured: one send for gaps of 120–275 ms in
  Chat (desktop and phone) and the command bar, fast or slow transcript; a 400 ms gap is a plain
  Stop that sends nothing.
- **Not a long press**, which Greg offered as simpler: on iOS it raises the text callout, the click
  after it has to be swallowed, and it would be a second gesture to teach beside the double press
  already named on the button and in `/help`.

A single Stop on a box that sends is now 300 ms slower. Not tried with a real transcriber or on a
real iPhone. Nothing deferred.
