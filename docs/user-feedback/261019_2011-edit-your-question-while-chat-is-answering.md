---
reports: spya-yur0eq
ending: shipped
---
# Edit your question while Chat is still answering

An admin report from Greg (`feedback-reporter.ts` exit 0, no addenda), Overseer queue item
`qi-85psa4wh`:

> Allow the user to edit user inputs in Chat while it's thinking, rather than having to stop it first
> and then click the Edit button.
>
> — Greg, 2026-10-19 20:11 UTC (`spya-yur0eq`, #630, SPIDERYARN-READING2-KV)

**Shipped** on `dev`. The pencil stays on every question while an answer is arriving. Pressing Ask
again (or Enter) then stops that answer with the ordinary Stop and asks the rewrite as soon as it
has settled. While it waits, the editor stays open and says *"Stopping the answer, then asking
again…"*. Behind it: an unchanged rewrite stops nothing; Cancel while it waits asks nothing; the
rewrite survives the server renaming a just-asked question; and it is not sent against an answer
that failed. This applies to every conversation that shares the transcript (Chat, Recall, the guide
and the rest), and the Chat help page says so.

Plan, both GPT Sol reviews and the reasoning:
[261020i-edit-your-question-while-chat-is-answering.md](../plans/261020i-edit-your-question-while-chat-is-answering.md).
