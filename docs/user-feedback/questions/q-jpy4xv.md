---
id: q-jpy4xv
report: spya-j4sg9g
status: open
asked: 2026-10-10
title: May I sharpen the rule for when an agent closes your question?
refs: docs/plans/261010g-needs-a-decision-shows-replies-an-agent-acted-on.md (§ The rule proposal) · docs/plans/261010g-plan-review-sol.md (P2-3) · docs/project/feedback-reports.md § To act on one, step 3 · docs/postmortems/261010a-needs-a-decision-hid-replies-an-agent-had-acted-on.md · SPIDERYARN-READING2-GE · qi-yf62kckg
---
You answered A to q-rstqvz three times. Every reply was stored, but agents kept the question open while A was still to be built, even though you had nothing more to decide. The rule agents follow says to leave a question open "when his reply asks for more", and that was read loosely. May I change it?

A (recommended): change it to the wording under Details. An agent closes a question as soon as you owe no further reply; work still to be built is tracked in the Overseer's queue. If it does need more from you, it rewrites the short part of the question you see first, so the new question is not hidden under Details.

B: leave the rule as it is. The dialog fix (below) already shows your earlier replies and says "Needs a decision again", so a question left open no longer looks unanswered; but agents may still hold settled questions open.

Details

What happened. All three of your replies were stored. But once an agent had acted on a reply, the dialog stopped showing it, and a question still open went back to looking exactly like one you had never answered. Your earlier replies were quoted only at the very end of the question, under the closed Details. That is fixed on dev, not yet deployed: a thread now lists your replies an agent acted on, marked "acted on", says "Needs a decision again" when it is asking something more, and the list shows "you've replied 3×".

The rule today, in feedback-reports.md (the steps an agent follows when it acts on your reply), step 3:

"set status: answered when the question is settled, and leave it open when his reply asks for more;"

The wording I would put in its place:

"set status: answered once he owes no further reply, even if building what he chose is still to come: unfinished work belongs in the queue, not in an open question. If a follow-up does remain, rewrite the short part above Details so it holds the current question, its options and your recommendation (the dialog then shows the thread as Needs a decision again); if the follow-up is materially a different question, set this one answered and ask that in a new file;"

Why it is your call: that doc's wording is a rule other agents follow, and those are changed only with your approval. What would decide it: A stops settled questions sitting in Needs a decision; B costs nothing now and relies on the dialog fix alone.
