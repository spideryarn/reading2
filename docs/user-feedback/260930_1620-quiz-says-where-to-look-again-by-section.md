---
reports: spya-k3bt8c
ending: shipped
---
# Quiz says where to look again, by section

[SPIDERYARN-READING2-6R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6R), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from
`https://www.spideryarn.com/` with no article open. The time in the file name is when this session
picked the report up. It ran on a pool account with no Sentry access, and the report text came in the
brief; there is no `reports:` header because the issue's `report_id` tag was not in the brief — the
next feedback sweep can add it.

> (A follow-up idea about how to improve the quiz. This might be overcomplicating it, but if there's
> a way to do a v1 of this simply, that would be great. Some version of it anyway.)
>
> Score each quiz answer against the article's blocks, giving a rough per-section picture of what the
> reader has got. That could steer your adaptive quiz (spya-jc2ub9) towards the sections they're
> weakest on, not just adjust its difficulty. And somehow indicate to the reader which sections to
> (re-)read next.

**Ending: Shipped.** On `dev`, not deployed. Resolve 6R; the next feedback sweep does the Sentry
write from this note.

## What we did

A simple v1, with no new model call and nothing stored:

- **Each answer is counted against the article's sections.** The quiz already judges each answer
  right or wrong in private (the thing that decides whether the next question carries its premise),
  and each question already names the passages it is about. Those passages sit in the same
  *Sections* the spine shows, so the answers can be counted per section.
- **"Where to look again".** Once an answer has been judged wrong, a short list under the question
  names up to three sections, weakest first. **The section's name jumps the article there** — the
  (re-)read. **An icon beside it goes back to that section's first missed question** — the steer.
  Answer it right and the section drops off the list.
- **No counts, no score, no "you got".** It names places, the way a mark says where to look.
- **The quiz's order is untouched.** The questions are a path where each leans on the last, so
  steering means offering the way back to a weak section's question, not moving Next.
- **Per visit.** Nothing is stored, logged or sent, so the privacy page is still true as written.

## Left for later

In the plan: a stored per-section picture across visits (a draft privacy sentence for it is in the
plan), new questions aimed at a weak section, a "read these next" line naming the unread sections
the *Only what I've read* filter is holding questions back in, and showing the picture on the spine.

The plan and both GPT Sol reviews are in
[260930i](../plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md).
