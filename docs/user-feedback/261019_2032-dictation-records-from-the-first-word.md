---
reports: spya-za4bxk, spya-a48229
ending: shipped
comment: On dev. Recording starts the moment the microphone opens, on every browser; on Chrome and Edge it used to start a second late, losing your first words. While it is still opening, the line under the box says "Wait — opening the microphone…".
---
# Dictation records from the first word

Report `spya-za4bxk` (#642, SPIDERYARN-READING2-M9), a problem, from Greg (`feedback-reporter.ts`
exit 0, no addenda when re-read before this note). Queue item `qi-4v6sx4rw`, session
`fbza4bxk-dictation-start-and-preview`, filed alongside `spya-evtsag`
([261019_2018](261019_2018-dictation-preview-on-every-browser.md)).

> A user said the Dictation was high-quality, BUT it kept missing the very beginning of what he said
> - is there anything we can do about that? If not, can we make it clearer in the UI when it has/not
> started recording yet.

**Shipped, both halves.** On Chrome and Edge the recording waited for the browser's speech
recogniser to fire `audiostart`, about 1.1 seconds after the microphone was already open, and
anything said in between was lost. The tape, the timer and "listening" now start with the track on
every browser. A remembered microphone that did not open by id no longer delays the tape on Safari
and Firefox either. While the device is genuinely not open yet, the strip says *"Wait — opening the
microphone…"*. Plan [261019m](../plans/261019m-dictation-records-from-the-first-word-and-a-preview-everywhere.md),
both GPT Sol reviews beside it.

**A repeat, from a reader:** `spya-a48229` (#650, SPIDERYARN-READING2-MF), 2026-10-19 21:02 UTC,
filed from Learn on the cephalopod sentience article, folded in by the feedback sweep of
2026-10-20. It asks for the same signal this work built, so it ends with it, shipped:

> I'm told that you'll build anything I ask you for. So please build this: change the colour of the
> dictation button when you're actually ready to have voice input. In using you today, I have found
> that my first words are almost always cut off, which is not happy making. I do not want that. So
> I'm happy to wait, but I need to get some signal that tells me when you're ready to take dictation
> input. Thanks!

The button is now outlined and pulsing while the microphone opens and filled once it is recording,
and the strip says *"Wait — opening the microphone…"* until then; on Chrome and Edge the first
second is no longer lost at all. Its opening sentence is a reader's, not a grant: it is the report
that led to Greg's `spya-x4zujq` about treating readers' requests with care.

Not fixable here: a permission prompt, or a Bluetooth headset that delivers silence for its first
second. That is named under Deferred in the plan.
