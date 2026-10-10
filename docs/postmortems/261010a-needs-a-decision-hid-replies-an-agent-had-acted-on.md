# Needs a decision hid replies an agent had acted on

Greg's replies to a question in the Feedback dialog were stored, and an agent acted on them, but the
dialog stopped showing them and drew the question exactly as if he had never answered. He answered
again, then reported that his replies seemed lost. Nothing was lost and nothing reached a reader; the
only person affected was the admin, who stopped trusting that the reply box kept what he sent.

> I could swear I have posted a reply to q-rstqvz multiple times in the Feedback needs a decision UI.
>
> — Greg, report `spya-j4sg9g`, 2026-10-09 23:46 UTC, build `5f6d3d5f`

## What happened

All three replies (`spya-qnak8d`, `spya-b3qx08`, `spya-ybbudu`) are in the database. At build
`5f6d3d5f`, `q-rstqvz` was `status: open` with two replies marked `acted`. The server
(`src/routes.ts` § `questionsForAdmin`) then did two things, each defensible alone:

1. It sent only replies **not yet acted on** in `answers`, on the argument that acted replies are
   already quoted in the question's body.
2. `questionState` (`src/feedback-question-values.ts`) returned `waiting` when every reply was acted
   on, so the thread went back into *Needs a decision*.

Together: the same words, the same look and the same pager stop as a question nobody has answered,
with his own replies gone. The quotations did exist, but as the last two sections of a 6,000-character
body under a shut *Details*. He replied a third time and filed the report a minute later.

## The class, named

**His own input disappears from view once the system has processed it, so "answered, acted on, asked
again" is drawn the same as "never answered".** A done state rendered as a never-started state.
Acknowledgement is erased on processing.

The shape: a transition (here, *acted on*) removes the user's input from the screen as bookkeeping
tidy-up, and nobody asks what the user sees afterwards. The data model kept the distinction; the
render dropped it.

## Why nothing went red

- **The state function was right.** `waiting` for an all-acted open question is correct: the agent
  left it open because it is asking something more. The tests covered that and passed.
- **Each decision had a stated reason, and the reviews looked at this very state, but only as
  logic.** GPT Sol's 261008i plan review did walk an all-acted open question (F2, defer → reply →
  acted: the old deferral must not come back; F4, a reply receipt after an acted deploy must not
  force *being considered*). Both are about which group the thread lands in. Neither asked what
  Greg sees inside it, because the plan's premise ("acted replies are already quoted in the body")
  was taken as settled.
- **No fixture had an all-acted open question in the dialog tests.** Every thread fixture either had
  unacted replies or none, so the one state where the thread is empty of replies yet not new was
  never drawn.
- **Quoting was real, so a spot-check found it.** Looking in *Details* shows the replies. The check
  agreed with the code because it looked where the code had put them, not where the reader looks.

## Which commit introduced it

`6d5f0b934` ("261008f: Needs a decision becomes threads you can reply to or defer", 2026-10-08),
built from plan
[261008i](../plans/261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md), decisions 1
and 2. It was found by `git log -S olderAnswers -- src/routes.ts`; that commit is the first to mention
the field, and the author was fixing the opposite problem (waiting rows with no reply control), which
is why the hidden-acted-replies side effect was not in view.

## Contributing cause

The agent that acted on his first reply left the question `open` "until A is built", though nothing
was left for him to choose. [feedback-reports.md § To act on one](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)
step 3 says to leave it open "when his reply asks for more", read loosely. Its wording is a rule, so a
sharper version goes to Greg as a proposal rather than being edited
([plan 261010h](../plans/261010h-needs-a-decision-shows-replies-an-agent-acted-on.md)).
Had the question been closed, it would have left the dialog, and the display gap would have waited
for the next question an agent left open after acting.

## What would have caught it, ranked by ease against value

1. **A fixture of an open question whose replies are all acted on, in the dialog tests.** One
   fixture, and the test asks what the thread shows. Done: `tests/feedback-dialog.test.tsx` ("replies
   an agent has acted on"), `tests/feedback-route.test.ts`, `tests/feedback-thread-with-local.test.ts`.
2. **A review question for any state change that hides something: "for every transition that removes
   the user's own input from the screen, what does the user see afterwards, and can they tell it from
   never having typed it?"** Costs a line in a plan review prompt. It would have caught decision 2 at
   the plan stage.
3. **Make the bookkeeping state a visible label, not a filter.** Acted replies stay in the list marked
   *acted on*; the filter is for what needs action, not for what is shown. Done in this fix.
4. Open *Details* by default when a thread has acted replies. Rejected: his own words would still be
   at the bottom of the long background, and the thread would still say *Needs a decision* as if new.
5. Change `questionState` so an all-acted open question is not `waiting`. Rejected: the state is
   right (the agent genuinely asked something more); the look was the problem.

## The fix that is right for the long term

The fix (on `dev`, not yet deployed) is the long-term shape: shape 3 of `GET /api/admin/feedback/earlier` (`questions=3`)
adds `actedAnswers` / `olderActedAnswers`; the thread lists them marked *acted on*, says *Needs a
decision again*, and the contents row says *you've replied N×*. `withLocal` ignores receipts already
acted on. Shapes 1 and 2 stay for tabs loaded before the deploy. The part left open is the agent
side: the rule wording in step 3 is with Greg.

## The thing I would tell myself

When a plan says "X is already shown somewhere else, so drop it here", go and open the somewhere
else as the reader would. I knew the replies were quoted at the end of the body; I did not check that
anyone would look there, or that a question coming back into *Needs a decision* would make them try.
