---
reports: spya-rp8676
ending: shipped
---

# A double press on Stop also sends

A suggestion from Greg (admin; the report's row in production checked with
`feedback-reporter.ts --report-id`, exit 0), 2026-10-04 12:22 UTC, on `bitterlesson-spya-pbag4p`,
`?mode=remember`. Sentry SPIDERYARN-READING2-CP. Queue item `qi-j2cqq6dn`.

`spya-rp8676`:

> If I'm dictating with my voice and I double click the stop button, then it should automatically also trigger whatever the kind of done action is for that whole section. So, for example, if I'm in a feedback report and I double click the stop button, then it should also click send afterwards for me. And if I'm in chat or whatever and I double click the stop button, then it should automatically send that message after it's finished transcribing, obviously.

**Shipped**, as
[261005a](../plans/261005a-dictation-double-press-on-stop-also-sends.md). Press Stop twice within
600 ms and the box sends itself once the real transcript is in it, in five boxes: Feedback, chat,
the comment follow-up, the quiz answer and the annotate box (Save). The strip says "Turning that
into text, then sending…" once the second press is taken. Nothing is sent if the transcription
fails or comes back empty. How it works is in
[dictation.md § A double press on Stop also sends](../project/dictation.md#a-double-press-on-stop-also-sends).

**Not built, each with its own queue entry:**

- `qi-wd4mg6p6` — the note under an Illustrated picture and the command bar, which wait on a yes
  from Greg because a misfire there costs more (a paid repaint; a command run unread).
- `qi-5hken4wr` — the fleet dashboard's message boxes.
- `qi-eqtvksg5` — a hint on screen that the double press exists; today only `/help` says so.
- `qi-cfrv4spd` — a bug the plan review found on the way, older than this work: a transcript can
  land in the next comment's or quiz question's box.
