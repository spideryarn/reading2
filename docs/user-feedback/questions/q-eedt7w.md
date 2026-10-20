---
id: q-eedt7w
report: spya-y43ha0
status: open
asked: 2026-10-20
title: Should we change how many feedback reports one reader may send, given there is no overall ceiling today?
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
