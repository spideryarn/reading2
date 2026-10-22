---
id: q-eedt7w
report: spya-y43ha0
status: answered
asked: 2026-10-20
title: Should we change how many feedback reports one reader may send, given there is no overall ceiling today?
acted: spya-p607q2
refs: SPIDERYARN-READING2-MN · qi-t9wekker · docs/plans/261020p-greg-gates-readers-feedback-admins-filter-readers-reports-in-needs-a-decision.md · docs/user-feedback/261019_2149-readers-feedback-shows-in-needs-a-decision.md · src/store/contracts.ts FEEDBACK_HOURLY_CAP · docs/project/feedback.md § The rate cap
---
You asked for no hard ceiling on how much feedback we receive (or a very high one, like a thousand a day), and to accept as much as a reader gives. There is already no ceiling across all readers. The only limit is per reader: 30 reports an hour each (so up to 720 a day), and none at all for you. That limit is a security defence, so I have not changed it without you.

A. Keep 30 an hour per reader (recommended). Nobody has come near it: the busiest any reader has been is 3 reports in a day. It is there to stop a broken script or a hostile account filling the table and our inbox in minutes, and each report also costs an agent session to read.
B. Raise it to a thousand a day per reader (with no hourly limit). A real person could never reach it; a script could send a thousand reports in a minute, each one an agent session the next sweep pays for.
C. No limit per reader at all. Simplest to say; nothing then stops a script, short of me noticing.

Details

What already happens: every report is stored and listed on /admin/feedback, whatever happens next. The email that tells you about a reader's report is limited separately, to 20 a day across everyone and 5 a day per reader, because the email service's free allowance is shared with sign-in emails; reports beyond that are still stored, just not emailed. You, as admin, have no limit of any kind.

The numbers, read from production today: 662 reports ever, from two accounts. In the last 30 days, 554 were yours and 3 were from one reader. Your busiest day was 85; the busiest any reader has been is 3 in a day, all in one hour.

The other half of your report, that readers' suggestions show up in Needs a decision clearly marked as a reader's, so you can be the gate on them, is built and on dev (not yet deployed): a question about a reader's report now shows their report beside it, labelled as a reader's, with the address they sent it from. Whether agents should bring every reader suggestion to you by default is the other open question, about the rule wording.

What would decide it: whether you expect readers who would genuinely want to send more than 30 in an hour. If you do, B; if not, A costs nothing and keeps a guard on the agents' bill. If you choose B or C, I will plan the change and its tests and bring it back before it ships, since it is a defence.

Greg's reply, 2026-10-20 21:45 UTC (spya-p607q2): "Use your judgment. Keep things simple. And can you make a minimal update to whatever prompt it is that is asking me these questions to sort of say, look, you know, is it important to ask me a question like this kind of question? I don't really care. The stakes are incredibly low. Either way doesn't really matter. All I'm trying to avoid is anything that's going to be a bad user experience. And, you know, the worst case is we have a bunch of rows in the database that are junk for some reason that we'd have to delete. Like, no big deal. So I guess, you know, I'm happy for you to ask me questions, and if it's consequential or importantly user-facing, the stakes are low or there's a kind of obviously good option or, you know, no real trade-offs, then, you know, use your judgment. If in doubt, ask GPT Sol for a second opinion. Or try asking an Opus sub-agent that's pretending to be a user and another Opus sub-agent that's pretending to be a different role and then, you know, make your judgment based on their arguments or something. But don't bug me for trivial stuff. Anyway, make a minimal update to the relevant prompt accordingly."

Acted on in qi-92cdpjxv, plan docs/plans/261021a-feedback-rules-greg-s-answers-reader-suggestions-and-asking-less.md. The cap stays at 30 an hour per reader (A): nothing changes, nobody has come near it.

The rule for whether to ask lives in docs/reusable/ask-me-questions.md § Whether to ask at all. Before, its first paragraph ended "Anything else is yours to settle with a second opinion (Sol, or Opus to arbitrate). Decide it, and say in a line what you decided." After, a new paragraph follows it: "That list is a reason to weigh the stakes, not by itself a reason to ask. Keeping things as they are is yours to decide when nothing about them gives a reader a bad time and it is cheap to revisit. So is a change where the stakes are low, one option is plainly good, or there is no real trade-off, unless it loosens a defence, changes a prompt or a privacy promise, or writes destructively to real data: those still go to him. In doubt, ask GPT Sol, or have two Opus subagents argue from different roles (a reader, and someone else with a stake), and judge between them." with this reply quoted. A question like this one, whether to change a defence nobody has come near, is now settled without you.
