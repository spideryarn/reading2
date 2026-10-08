---
reports: spya-u6h6q8, spya-bzwzfw, spya-t6nmxt, spya-bbe74w, spya-n7hvm0, spya-krvuc9, spya-za2tse, spya-frpy22
ending: shipped
comment: Needs a decision is now threads: a contents, one thread at a time with a reply box, Defer for now, the ids, your report shut, a shortcut beside the tabs. Check the reply box on your iPhone.
---
# Needs a decision becomes threads you can reply to or defer, and a bigger dialog

Eight reports from Greg (an admin; `scripts/feedback-reporter.ts` exit 0 on each production row),
filed 2026-10-08 16:12–16:50 UTC, all about the Feedback dialog's Earlier tab and its *Needs a
decision* view. One bug and seven suggestions, built as one design. Plan, both GPT Sol plan
reviews and the code review:
[261008i](../plans/261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md).
Postmortem for the bug:
[261008c](../postmortems/261008c-needs-a-decision-lists-reports-nobody-can-answer.md).

> I'm using the feedback slash earlier slash needs a decision interface, and it's weird. There seems
> to be a few that are listed there, but there doesn't appear to be a reply button or input box for
> me to use to actually provide a reply.
>
> — Greg, 2026-10-08 (`spya-u6h6q8`, the bug)

The other seven, in his words, are quoted in the plan: Earlier opens on Needs a decision
(`spya-bzwzfw`); a quick link beside Write and Earlier, a table of contents, one thread at a time
with next and previous, and a defer button (`spya-t6nmxt`, and `spya-bbe74w` for the contents);
a separate group once he has replied (`spya-n7hvm0`); the question and session ids, to talk to the
Overseer about the same thing (`spya-krvuc9`); his original report, collapsed, a reply box that
works on an iPhone, and questions written TL;DR first (`spya-za2tse`); a taller, wider dialog on a
big screen (`spya-frpy22`).

**Ending: shipped**, on `dev`, for all eight.

- **The bug.** *Needs a decision* drew two lists from two sources: the question cards, with a
  Reply button, and under them the reports whose note said they waited on Greg, which never had
  one. Two of those rows repeated a question above them; the third (`spya-thpsnd`) had no question
  at all, because its part 2's note did not name it in its header and a split report with a part
  missing counted as waiting on Greg. Now the view is threads, a waiting report with a question
  is inside its thread and nowhere else, a waiting report with no question is under a heading
  saying so, and the script the sweep runs lists those. A split report with a part missing is no
  longer "waiting on Greg" (it shows as Open and is listed for an agent), and thpsnd's Debate note
  names it.
- **Threads.** A contents in three groups (Needs a decision; You've replied, being considered;
  Deferred, shut), one thread at a time with ‹ All threads, N of M, ‹ Previous and Next ›. A
  thread shows the `q-` id and the report's `#number (spya-…)`, the question with its *Details*
  shut, *Your report #N* shut, your replies an agent has not yet acted on, and the box.
- **Defer for now / Bring back**, beside Send reply: a stored, timestamped deferral, reversible,
  that the sweep reads as "do not chase". It is the one new state; its table is new
  (`feedback_question_deferrals`, an additive migration).
- **The shortcut.** *Needs a decision N* beside Write and Earlier, its tooltip saying how many wait,
  when the newest was asked, how many you have replied to and how many are deferred. Not "since
  your last visit": that would need a remembered list per device, and "newest asked" says nearly the
  same. Earlier now opens on Needs a decision when anything is waiting, otherwise on All.
- **The iPhone reply box.** It now grows with its words and never scrolls inside itself, so the
  dialog is the one scroller, and one thread is on screen rather than nine. No desktop browser can
  show an iPhone keyboard, so this was checked at 390px in WebKit with a short window standing in
  for it. **Whether it is right on your phone is the real check**: if it still fights you, a
  screenshot with the keyboard up would show where.
- **How agents write questions.** [feedback-reports.md § Asking Greg a
  question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer) now
  says: the question, the options and the recommendation first, readable alone; then a line that
  is exactly `Details`, and under it the background for someone who has forgotten the report and
  never read the code. The dialog shuts the details. `--new` starts a question in that shape. The
  existing questions keep their old shape until somebody rewrites them; `q-xd9es7` (the
  Marginalia filter, thpsnd's one live follow-up) is the first in the new one.
- **The dialog** is up to 46rem wide from 1024px, and at least `min(90%, 44rem)` tall on a window
  at least 760px tall. A phone is unchanged.

**Not done, and why.** GPT Sol's second plan review asked for a part number on every split note, so
that a note naming the wrong report cannot make a split look complete (F10). That weakness predates
this work, this work does not widen it, and fixing it means numbering 21 existing notes after the
fact; it is written up in the plan as declined for now rather than built.

**One cost, named.** thpsnd's row now shows the Debate note's comment, which is about Claims, because
the existing rule takes the newest shipped note's.

Sentry: this session has no Sentry sign-in; the next feedback sweep marks the eight resolved.
