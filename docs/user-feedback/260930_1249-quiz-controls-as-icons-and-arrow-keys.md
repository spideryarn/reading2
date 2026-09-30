---
reports: spya-qdgnks
ending: shipped
---
# Quiz's controls as icons, and ← / → to move through the questions

[SPIDERYARN-READING2-71](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-71), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from Remember → Quiz on
`pmc13013618-spya-uekgh6`. The time in the file name is when this session picked the report up. It
had no Sentry access and the report text came in the brief. The
header above was added by the feedback sweep on 2026-09-30, from the issue's `report_id` tag.

> Make minimal UI tweaks to the quiz mode and maybe remember mode as well. For example, let's use
> icons instead of text labels, you know, perhaps with tooltips. And maybe add keyboard shortcuts,
> left and right, to move through the quiz questions.

**Ending: Shipped.** On `dev`, not deployed. Resolve 71; the next feedback sweep does the Sentry
write from this note.

## What we did

- **Previous, Next and "Show all N" are now icons** (‹, ›, and a list), each with a tooltip:
  *Previous question (←)*, *Next question (→)*, *Show all N questions*.
- **← / → move through the questions** while Quiz is showing. Not while you are typing in the answer
  box, not inside a dialog, and not when Recall or any other mode is showing. They also refuse to
  move away from words you have typed but not had marked, or while the microphone is still
  listening. The buttons still move in both cases; the keys are only guarded against a stray press.
- **Kept as words:** *Answer*, *Show a reference answer*, and the **Recall | Quiz** switch. The
  switch was icons in the first draft and went back to words after GPT Sol's review: on the iPad the
  tooltip never opens, and nothing in either icon says "say what you took from it" versus "the
  article asks". Easy to turn back into icons if you would rather have them.

The plan, both GPT Sol reviews and the browser check are in
[260930h](../plans/260930h-quiz-and-remember-controls-as-icons-arrow-keys-step-the-quiz.md).
