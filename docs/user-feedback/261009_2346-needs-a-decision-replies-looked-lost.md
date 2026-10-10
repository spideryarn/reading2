---
reports: spya-j4sg9g
ending: shipped
comment: None of your three replies was lost. Once an agent acted on a reply, the dialog hid it and drew the question as never answered. Now it lists them, marked acted on. Whether to sharpen the rule for closing questions is asked in q-jpy4xv.
---
# Needs a decision: your replies looked lost

One admin suggestion from Greg (`scripts/feedback-reporter.ts` exit 0), 2026-10-09 23:46 UTC,
#534, SPIDERYARN-READING2-GE, build `5f6d3d5f`, filed from
`/read/arxiv-1706-03762-spya-wyt7j0?…&mode=skim`. Queue item `qi-yf62kckg`. This session had no
Sentry sign-in and did not write the Sentry status; the next feedback sweep does that.

> I could swear I have posted a reply to q-rstqvz multiple times in the Feedback needs a decision UI.
>
> — Greg, 2026-10-09 (`spya-j4sg9g`)

**Ending: shipped.** On `dev`, not deployed. The rule half is a question to Greg, `q-jpy4xv`.

## What we found

All three replies are stored (`spya-qnak8d`, `spya-b3qx08`, `spya-ybbudu`); the feedback sweep of
2026-10-10 closed q-rstqvz and asked the real blocker in q-xh4y0s. Why they looked absent: once an
agent marked a reply acted on, the dialog stopped listing it, and an open question whose replies
were all acted on went back to *Needs a decision*, drawn exactly like one never answered. His words
survived only as quotations at the end of a long body, under the shut *Details*. The agent had held
the question open until option A was built, which is what put it back in front of him.

## What we did

[Plan 261010h](../plans/261010h-needs-a-decision-shows-replies-an-agent-acted-on.md), with GPT
Sol's plan and code reviews; postmortem
[261010a](../postmortems/261010a-needs-a-decision-hid-replies-an-agent-had-acted-on.md).

- A thread lists the replies an agent has acted on, marked *acted on*, with a line saying what
  happened next is written in the question.
- A waiting thread with acted replies says *Needs a decision again*, and its row in the contents
  says *you've replied N×*.
- Tabs opened before the deploy keep working (they ask for the older shape).
- The rule in feedback-reports.md § To act on one, step 3, that let a settled question stay open
  until a build landed, is a rule doc: the sharper wording is put to Greg in `q-jpy4xv`, not made.
