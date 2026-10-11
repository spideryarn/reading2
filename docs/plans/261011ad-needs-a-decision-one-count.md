# Needs a decision: one number, and it is the threads waiting on you

Report `spya-h2d3my` (#575, SPIDERYARN-READING2-HS), Greg, 2026-10-11, from an admin:

> In feedback reports, the needs a decision in the top right next to Write and Earlier gives a
> different count than the needs a decision next to open, shipped, etc. And one of them says it needs
> my decision for something that I think I deferred, so that doesn't seem like it does actually need
> my decision.
>
> — Greg, 2026-10-11

## What is wrong

Two controls carry the words *Needs a decision* and a number, and the numbers count different
things:

```
 [Write] [Earlier] [Needs a decision 4]          ← the shortcut: threads whose state is `waiting`
 Show: All 9 · Open 2 · Needs a decision 1 · 4 to decide · Set aside 3 · Shipped 3
                         └ reports ┘ └ threads ┘
```

- **The shortcut** (`FeedbackDialog.tsx`) shows `waitingThreads(questions)`: open questions whose
  state is `waiting`. That state already honours a reply (→ *being considered*) and a deferral
  (→ *Deferred*) — `questionState` in `src/feedback-question-values.ts`.
- **The pill** (`EarlierFilter`, `FeedbackEarlier.tsx`) shows the server's report count for status
  `waiting`, which is *any of the admin's reports whose notes say `awaiting`* (`statusOf`,
  `src/store/pg-feedback.ts`). It knows nothing of questions, replies or deferrals; it changes only
  when an agent writes the note that ends the report. Beside it, `· N to decide` repeats the
  shortcut's number.

Measured, read-only, against production (`scripts/feedback-reporter.ts § productionClient`,
`begin read only`) with the deployed build's (`5ee936b`) compiled questions and endings: the pill
said **1** (`spya-x6qjbn`, whose question `q-a0qp3x` Greg had already answered — the agent's
declining note had not yet deployed), the shortcut **4**. On `dev` today: pill 1 (`spya-skpxw2`),
shortcut 5. So the second half of the report is the same bug from the other side: the pill counts a
report Greg has already dealt with, because a reply or a Defer never touches a report's status. The
one deferral in the table (`q-xd9es7`) is correctly *Deferred*, and its report `spya-thpsnd` is
shipped, so it is in neither count — the sweep's lead was a good guess but not the cause.

## The fix

**One meaning for *Needs a decision N*, everywhere: the threads waiting on you.** For an admin the
pill's number becomes `waitingThreads(questions)`, the same function the shortcut calls, and the
`· N to decide` suffix goes. That is the number that respects *Defer* ("not now, do not chase") and
a reply, which is what Greg asked for, and it matches what pressing the pill shows: the threads'
contents, with *Needs a decision* as its first group.

What it gives up: the admin's pills no longer sum to *All*, because one of the five counts threads
and the others count reports. That invariant (261007d) is about the server's `counts`, which do not
change and are still validated; only what the pill draws changes. The reports waiting on a question
nobody has written yet are still listed under that pill, below the contents, under *Waiting, but no
question written yet* — and they are rightly not counted, since that heading says there is nothing
for you to answer.

No number is a guess: until the questions have arrived the pill draws none, as today. A reader's
(not admin's) three pills are untouched.

### The simpler option passed over

**Rename rather than recount** — keep the report count and call the pill *Awaiting* or *Reports
waiting*. One word changed, no test reshaped. Passed over because the pill is still the way into a
view whose heading and contents are the threads, and because it would keep counting reports Greg
has replied to or deferred, which is the second half of his complaint.

**Make the report status itself know about deferrals and replies** (a fifth status, or `waiting`
computed from questions in SQL). Passed over: questions are compiled from files into the server, not
in the database, so `statusOf` would need them passed in as it does endings, and a report with two
questions in different states has no single honest status. More parts for a number the threads
already give.

### After GPT Sol's plan review (RETHINK) and Opus's arbitration

Sol ([review](261011ad-needs-a-decision-plan-review-sol.md)) agreed with the diagnosis and argued
for the simpler option instead: keep report counts, rename the report status, and keep *Needs a
decision* for threads. Its strongest point was that rows under *All* would still say *Needs a
decision* for a report Greg had answered or deferred. Opus arbitrated and settled it on this: the
shortcut calls `setShow("waiting")`, so it opens exactly what the pill opens, and the two are one
control in two places. Renaming the pill would either leave the threads under a pill called
something else, or need an inbox of their own. **So the plan stands, plus the row**:

- the pill's number is `waitingQuestionCount`, the **live** threads the shortcut already counts
  (not `waitingThreads(questions)`, which would count a retained draft's thread — Sol F3); null
  draws no number and `[]` draws 0, with no fallback to the report count (F4);
- a waiting report's **row** says *Waiting*, with the title "An agent has asked you about this, or
  will; its question is under Needs a decision." *Needs a decision* then means one thing: a thread
  waiting on you;
- `.fb-show-questions` goes with the suffix, and feedback.md § What became of each report says the
  pills no longer sum to All (F5).

## Stages

1. A failing test in `tests/feedback-dialog.test.tsx`: the pill and the shortcut draw the same number
   when the report count and the waiting-thread count differ, including a deferred thread and a
   replied one. Then the change in `EarlierFilter`, the existing pill expectations updated to the
   new meaning, and `docs/project/feedback.md § Questions for an admin` and the comments that
   describe the pill (`FeedbackEarlier.tsx`, `types.ts` § `AdminEarlierFeedbackPage`) brought true.
2. GPT Sol code review, gates, the feedback note, push to `dev`.
