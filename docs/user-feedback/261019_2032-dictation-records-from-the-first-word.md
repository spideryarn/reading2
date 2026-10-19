---
reports: spya-za4bxk
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

Not fixable here: a permission prompt, or a Bluetooth headset that delivers silence for its first
second. That is named under Deferred in the plan.
