# Quiz questions in the text as you read, and so at Trajectory's stops

[SPIDERYARN-READING2-6V](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6V), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from Trajectory on
`pmc13013618-spya-uekgh6`. The time in the file name is when this session picked the report up. It
ran on a pool account with no Sentry sign-in, so the report text came in the brief.

> Actually, let's just go one step further and say if you've generated quiz questions, it should
> always show them in situ in the text, whether you're in quiz mode or not.
>
> And then we could reuse that in trajectory mode somehow. […] Perhaps spin off a couple of Opus
> and/or GPT-Sol agents with different personas or as product managers to generate and/or review
> screenshots of prototypes […] Don't add too much complexity at this stage, so I guess prioritise
> ideas by a combination of ease and value.

(His whole report is quoted at the top of the plan.)

**Ending: Shipped.** On `dev`, not deployed. Resolve 6V; the next feedback sweep does the Sentry
write from this note.

## What we did

- **The design pass you asked for.** Two product managers, working separately. A GPT Sol "pragmatic"
  PM costed six options against the code. An Opus "learning-science" PM built them into the real
  app and screenshotted them at laptop and phone width. They ranked the same option first. The
  screenshots and both rankings are in the plan.
- **Every quiz question now appears in the text**, in every mode, as a quiet italic line right after
  the paragraph it is about (the last one, if it draws on several). Only the question is shown, never
  its "premise" line, which would give away an earlier answer. Pressing it opens Quiz on that
  question. One Back takes you back to where you were.
- **In Trajectory, that same line sits between the stop's passage and *Next stop ›***, whenever the
  stop has a question. So the stop's cue asks what to look for before you read, and the quiz question
  asks what you took from it after. That is the whole of the Trajectory change.

## What we did not do, and why

- **Questions in the left-hand column's stop card.** In the mockup, the card's question repeated the
  stop's cue almost word for word, and the card is read *before* the passage.
- **Questions as their own stops.** That would make the route two kinds of thing, each needing its own
  place, address and door, which is the most work for the least value.
- **Answering in the text itself.** You still answer in the Quiz band. Doing it inline would mean a
  second copy of the answer box and its marking rules inside the article. This is the next thing to
  try if the trip to the band feels like friction.
- **Your quiz questions at the end of each Trajectory pass**, above *More detail ›*. Opus's own idea,
  and the best fit for learning. Deferred until the lines in the text have proved themselves.

The plan, the design pass, both GPT Sol reviews and the browser checks are in
[260930i](../plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md).
