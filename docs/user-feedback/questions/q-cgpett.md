---
id: q-cgpett
report: spya-zytb0g
status: open
asked: 2026-10-28
title: Things the Overseer says only in the terminal: change its rules so they reach you here?
refs: docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md § Stage 4's evidence · scripts/overseer-tools/tick.sh · docs/project/overseer.md lines 48-56 · scripts/overseer-tools/standing-jobs.md § 1
---
You asked that anything the Overseer needs to say to you can be said here. Last week it said 14 things that needed you; 8 reached Needs a decision and 6 stayed in the terminal. May I change its rules as below?

1A. Reword two of its rules (exact text in Details). Anything waiting on you becomes a question here, including the cases it currently tells you in the terminal: a prompt in a session's window that only you may answer ("press 1 in that window"), a command it was not allowed to run, and a decision mentioned in passing ("one for you later"). Anything it has told you twice in the terminal must already be a question. Costs nothing to build. The risk is a few more questions in this list.
1B. As 1A, and also a kind of item that needs no answer: a notice, such as "the deploy is held" or "the GPT limit has run out", with a "Got it" button instead of a reply box. Costs about half a day. It also gives you a second list to read. To see what it would look like, open mockups m-tn6vxn and m-mxyef8.
1C. As 1A, and also letting you approve a session's permission prompt from here: you reply "approve" and the Overseer presses the key for you. This is a new power for the Overseer, and its rules forbid it today ("no keystrokes at a pane with a dialog open"). It is also the case you meet most often.

Recommendation: 1A now. Live with 1A for a week, then decide on 1B and 1C. Until then, a notice can be a question that says "nothing to answer; Defer to dismiss".

Already done, needing no decision: the Overseer's regular check (its tick) now marks each session stuck at a prompt, and says whether any open question here mentions it.

Details

What happened. On 28 October you filed report 723 (spya-zytb0g). You said that things still get blocked, and that the Overseer does not always surface them as Feedback. I had an agent read the Overseer's messages from 21 to 28 October. It found 14 things that needed you. 8 were published as questions and 6 were not. The 6 fell into three kinds:
- A prompt in a session's window that only you may answer: a "Run a dynamic workflow?" dialog, approving five edits to AGENTS.md, and a command that writes to production, which its permission checker refused. These are the most common, and they were told to you as "attach to that session and press 1". One of them (tidy-renames-sweep) was repeated in about 14 hourly ticks.
- A decision tucked into a status message as "one decision for you later". Examples: the email templates, whether the cycle check should be part of typecheck, and the Butlin re-import.
- Its own queue pacer tells it to collect decisions "into one batched message", and a message in the terminal is all that produces.
Its rules already say anything blocking goes out as a question, and it knows how to do that: it published 79 files on 21 October. The gaps are the cases above, which the rules do not name.

Option 1A, the exact wording. Both files are rule docs, so I have not edited them.

(i) docs/project/overseer.md, near the top. Before:
"Anything blocked on Greg goes out as a published question, not only in the terminal — a migration that will not apply, a deploy held up, a decision a stage is waiting on."
After:
"Anything blocked on Greg goes out as a published question, not only in the terminal — a migration that will not apply, a deploy held up, a decision a stage is waiting on, a prompt in a session's window that only he may answer, a command you were refused that he must run, and a decision mentioned in passing ("one for you later"). Put the session's name in the question so the tick can see it is asked. A line in the terminal is extra, never instead: anything you have told him twice there is already a question."
(The sentence after it, with your quote of 21 October, stays as it is.)

(ii) scripts/overseer-tools/standing-jobs.md, the queue pacer's step 1. Before:
"Collect any decisions a debrief leaves for Greg into one batched message, each with a recommendation."
After:
"Publish any decision a debrief leaves for Greg as a question (overseer.md, near the top), each with a recommendation; a line in the terminal is extra, never instead."

What 1B would add. A notice row beside the questions, published the same way, shown in Needs a decision with "Got it". It needs its own table, button and script, which is the half day. Without it, a notice can go in as a question saying there is nothing to answer.

What 1C would add. When you reply "approve" to a question about a session's prompt, the Overseer would press option 1 in that session for you. Two things make this a real decision rather than a convenience. First, the Overseer's rules list "no keystrokes at a pane with a dialog open" as one of the things it may never do; the only exception is one kind of dialog you pre-approved on 10 September. Second, between your reply and the keypress the prompt can change, so it would need to check that the dialog is still the one you approved. It is worth doing if prompts keep being the main thing you are asked about after 1A.

What would decide it: whether you would rather read a few more questions here (1A) or get more machinery (1B, 1C). Reply "1A", or "1A and 1B", and so on.
