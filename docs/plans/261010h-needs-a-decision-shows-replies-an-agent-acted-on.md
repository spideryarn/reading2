# *Needs a decision* shows the replies an agent has already acted on

Report `spya-j4sg9g` (#534, SPIDERYARN-READING2-GE), Greg, 2026-10-09 23:46 UTC, from build
`5f6d3d5f`:

> I could swear I have posted a reply to q-rstqvz multiple times in the Feedback needs a decision UI.
>
> — Greg, 2026-10-09

## What happened

All three of his replies are in production (`spya-qnak8d`, `spya-b3qx08`, `spya-ybbudu`); nothing
was lost. The feedback sweep of 2026-10-10 (`aca0acae3`) closed q-rstqvz and moved the real
blocker to q-xh4y0s. What was left was why, from where he sat, the replies looked absent.

At build `5f6d3d5f`, `q-rstqvz.md` was `status: open` with `acted: spya-qnak8d, spya-b3qx08`. The
server (`src/routes.ts` § `questionsForAdmin`) then:

1. **dropped both replies from the thread**, because `answers` lists only replies no agent has acted
   on (plan 261008i, decision 2: "acted replies are already quoted in the question's body");
2. **put the thread back in *Needs a decision***, because `questionState` says `waiting` when every
   reply is acted on (261008i, decision 1) — the same state, the same words and the same pager stop
   as a question nobody has ever answered.

The quotations decision 2 relied on were real, but they were the last two sections of a
6,000-character body, under the shut *Details*. So the thread he opened looked exactly like a
question he had never answered. He answered it again (23:45), saw only that reply, and filed the
report a minute later.

Two causes, one in the dialog and one in how agents close questions:

- **The dialog** cannot tell "never answered" from "answered, acted on, and asked again", and hides
  the reply in both. That is the bug fixed here.
- **The agent** that acted on his first reply kept the question open until option A was built,
  though nothing was left for him to choose. That is the rule in
  [feedback-reports.md § To act on one](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)
  step 3 ("leave it `open` when his reply asks for more"), read too loosely. Its wording is a rule,
  so a sharper version goes to Greg as a proposal (below) rather than being edited here.

## The change

1. **The server sends acted replies too**, in their own field: `actedAnswers`, the newest five acted
   replies oldest first, and `olderActedAnswers`, how many older acted ones it did not send — the
   same bound and the same shape as `answers` / `olderAnswers` (261008i F12). `answers` and `state`
   are unchanged: an acted reply still does not make a thread *being considered*.
2. **The thread draws them**, before the unacted ones, each as *You replied · 9 Oct, 19:38 · acted
   on*, with one line under the block. Bodies without a `Details` line are valid, so the line does
   not assume one (GPT Sol P2-4): *An agent acted on what you said. What happened next is written
   in the question*, plus *, under Details* only when the body has that section.
3. **A waiting thread with acted replies says so.** Its state word is *Needs a decision again*
   instead of *Needs a decision*, and the line above starts *An agent acted on what you said and
   kept this open, so it is asking something more.* In the contents, its row's meta line adds
   *· you've replied N×* (every reply, acted and not, sent and older), shown only when at least one
   was acted on.
4. **Wire compatibility, both ways (as 261008i F3):** the browser asks for `questions=3`; the server
   answers shape 3 with the two new keys, `questions=2` (a tab loaded before this deploy) exactly as
   today, and anything else the six-key shape 1. A new tab against an old server (a rollback) sends
   `questions=3`, which an old server treats as "not 2" and answers in **shape 1** (GPT Sol P1-1);
   `withLegacyQuestions` maps shape 1 and shape 2 each straight to shape 3, with empty acted lists.
5. **`withLocal` knows about acted replies** (GPT Sol P1-2). A reply receipt is laid over the
   server's thread until a later read has it; an idempotent retry can return a reply that the
   server already lists as acted on. Such a receipt is ignored, so it is neither drawn twice nor
   moves a waiting thread to *being considered*. The strict check refuses a reply id in both lists.

*Passed over:*

- **Just open *Details* by default when a thread has acted replies.** Smaller, but *Details* is the
  long background; his own words would still be at the bottom of it and the thread would still say
  *Needs a decision* as if new.
- **Change `questionState` so an all-acted open question is not `waiting`.** Wrong when the agent
  genuinely asked something more, which is what an open question with acted replies is supposed to
  mean. The state is right; the look was the problem.
- **Add the keys to shape 2 and accept that a tab from before the deploy shows the failure sentence
  until reloaded** (261008i's choice for its own change). For this report above all, a dialog that
  says it failed is the wrong thing to show Greg; a third shape is one ternary and one strip.
- **An `acted` flag on each answer.** Changes the answer's keys, which the reply POST's receipt
  check shares (`isQuestionAnswer`), so it touches the send path for no gain.

## The rule proposal (for Greg, not made here)

feedback-reports.md § To act on one, step 3 today:

> 3. set `status: answered` when the question is settled, and leave it `open` when his reply asks
>    for more;

Proposed:

> 3. set `status: answered` once he owes no further reply, even if building what he chose is still
>    to come: unfinished work belongs in the queue, not in an open question. If a follow-up does
>    remain, rewrite the short part above `Details` so it holds the current question, its options
>    and your recommendation (the dialog then shows the thread as *Needs a decision again*); if the
>    follow-up is materially a different question, set this one `answered` and ask that in a new
>    file;

The first draft said to put the follow-up "at the end of the body", which is under the shut
`Details` — the very place his replies had been lost. GPT Sol's plan review (P2-3) caught it.

It is recorded in the report's note and put to Greg with
[edit-important-docs.md](../reusable/edit-important-docs.md).

## Stages

One stage: types + route (shape 3), client (legacy map, strict keys, `withLocal`, thread and
contents), tests in `tests/feedback-route.test.ts`, `tests/feedback-dialog.test.tsx` and
`tests/feedback-thread-with-local.test.ts`, each seen red (written first for the route; for the
client, by breaking the line under test and watching it fail), the comments that said acted ids
never reach the browser, `feedback.md`'s Needs a decision section, and a postmortem.

## Log

- 2026-10-10: plan written. GPT Sol plan review
  ([261010h-plan-review-sol.md](261010h-plan-review-sol.md)): BUILD AFTER FIXES, five findings,
  all taken — rollback gets shape 1 not 2, `withLocal` and the strict check across both lists,
  the rule wording, copy that does not assume `Details`, and the docs and postmortem in scope.
