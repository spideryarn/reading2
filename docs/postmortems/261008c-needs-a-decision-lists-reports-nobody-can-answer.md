# *Needs a decision* lists reports nobody can answer

Up: [postmortems.md](../project/postmortems.md). The fix and its evidence:
[261008i](../plans/261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md).

> I'm using the feedback slash earlier slash needs a decision interface, and it's weird. There seems
> to be a few that are listed there, but there doesn't appear to be a reply button or input box for
> me to use to actually provide a reply.
>
> — Greg, `spya-u6h6q8`, 2026-10-08

Only an admin sees this view, so nothing reached a reader. It cost Greg a confusing screen and some
time, and it showed one report as a decision he owed when it actually needed an agent to finish
the paperwork.

## What happened

An admin's Earlier tab has a *Needs a decision* filter. It draws two lists, one after the other
(`FeedbackDialog.tsx` renders `EarlierQuestions`, then `EarlierList`):

1. **Question cards**, one per open file in `docs/user-feedback/questions/`, compiled into
   `src/feedback-questions.generated.ts`. Each has a **Reply** button.
2. **Report rows whose status is `waiting`**. That status comes from the notes' `ending:` headers,
   compiled by `scripts/feedback-endings.ts` into `src/feedback-endings.generated.ts`. The rows
   (`AdminRow`) have no reply control. A report row was never meant to be answered.

Nothing joins the two lists. On production on 2026-10-08, the cards were followed by three rows:

- `spya-mdp0em` and `spya-nnr8ha` were each the subject of a card above (`q-deh67j`, `q-wux4k7`).
  They were drawn a second time without the button.
- `spya-thpsnd` had no question at all. It was split into three parts, and the notes named only
  two of them. `combineEndings` treats fewer notes than `parts:` as `awaiting`. Part 2 (steering
  Debate) *had* been written up, in the caue42 note
  (`261003_1016-debate-reception-and-claims-sub-modes.md`). But that note's `reports:` line named
  only `spya-caue42`.

## The class: one claim from two sources, drawn as one list

**A screen makes one claim to the user, "this needs a decision from you". Two sources compute
it, nothing requires them to agree, and the screen draws them as if they were a single list.** Each
source was right on its own terms: the question really was open, and the report really was
waiting. But only one of the two offered the action that the heading asks for.

thpsnd adds a second class: **a count standing in for a statement.** "Fewer notes than parts" is a
guess about what is missing. It cannot tell an unwritten part from a written part whose note left
out a report id. The guess was safe while its only job was "not shipped". It went wrong once it
was promoted to "Greg owes a decision", because then an agent's missing bookkeeping was shown as
Greg's job.

## Which commits introduced it

- **`65c8984bf`** (260930e, 2026-09-30) added the count rule: a split with fewer notes than
  `parts` is `awaiting`. At that time `awaiting` meant only "Not shipped", which is the safe
  direction. It was harmless.
- **`16963ad41`** (261007d stage 1, 2026-10-07), decision 3, mapped every `awaiting` onto
  `waiting`, shown as *Needs a decision*. It did not ask what the count rule was now claiming.
  From this commit on, rows sat under that heading with nothing to press. But nothing anywhere
  could be pressed yet, so the screen was not contradicting itself.
- **`ed62e3ab4`** (261007d stage 2, 2026-10-07), decision 7, put the question cards "at the top of
  *Needs a decision*", above the reports. It treated report status and question status as
  separate facts, which they are. But it never asked what a report row under that heading offers
  the reader. **This is the commit that made the bug Greg saw.** Once some items in the list had a
  Reply button, the ones without it looked broken. Its review fixes (`149665db6`) did not touch the
  layout.

## Why nothing went red

- The stage 2 tests checked that the cards render and that a reply posts. The stage 1 tests
  checked that each report gets the right status. **No test looked at the view as the user does,
  asking "can I act on every item under this heading?"**
- GPT Sol's plan review and both stage reviews for 261007d read decision 7, and none raised it.
  The decision is correct about the data; the defect is only in how the two lists are drawn
  together. The plan review *did* catch a sibling (its F5): an ignored report still showing
  *Needs a decision* while `feedback-unswept.ts` had dropped it, "two operational surfaces then
  give opposite instructions". It was fixed for that one pair of sources, not as a class.
- The browser pass on `149665db6` (all five checks passed) tested the reply flow on a card. A row
  with no button is not a failure that any of those checks looked for.

## What would have caught it, ranked by ease against value

1. **A test that every item under a heading asking the reader to act offers that action, or says
   why it cannot.** One render, one assertion per item. Done:
   `tests/feedback-dialog.test.tsx`, "draws no report under Needs a decision that cannot be
   answered", the failing test 261008i is built from. It was run against the old code first and
   failed there (`#214` drawn outside its thread beside `#210`), so it is known to be able to fail.
   The rule applies to any heading that asks
   the reader to act.
2. **The compiler states the difference instead of inferring it.** An explicit `awaiting` must
   have an open question, so `npx tsx scripts/feedback-questions.ts` lists any `awaiting` report
   with no question for the sweep. An incomplete split is listed separately, as work for an
   agent. Done in 261008i.
3. **When a status gets a new meaning, review every rule that produces it.** Stage 1 promoted
   `awaiting` from "not shipped" to "needs your decision" and kept every producer unchanged. It
   costs one question in review. It is a habit, so it is weaker than items 1 and 2.
4. **Part numbers on every split note**, so that completeness is checked by which parts exist,
   not by how many notes there are. Declined for now (F10 in 261008i's review). The weakness is
   older than this bug and this fix does not widen it, but fixing it means renumbering 21 existing
   split notes. **This part of the class is still open**: a note naming the wrong report can still
   make a split look complete.

## The fix that is right for the long term

This is what 261008i is building. **The view's unit becomes a thread, which is one open
question.** A waiting report that has a question is drawn inside that question's thread, and never
as a row of its own. A waiting report with no question goes under a heading that says, in plain
words, that no question has been written yet, and the sweep's script lists it so that an agent
writes one. An incomplete split gets no ending, so it reads as Open, not waiting, and it is listed
on its own. The caue42 note now names thpsnd, so thpsnd has its three notes.

The patch that was passed over: hiding report rows from *Needs a decision*. It would remove the
symptom, but it would also hide a real `awaiting` report that is missing its question.

## The thing I would tell myself

Decision 7 said "report status and question status are separate facts", and that is true. I
treated that as the end of the design question, when it was really the start of it. The heading
is one sentence addressed to Greg, and anything drawn under it has to make that sentence true,
whichever source it came from.
