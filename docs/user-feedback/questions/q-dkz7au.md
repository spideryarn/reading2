---
id: q-dkz7au
report: none
status: open
asked: 2026-10-11
title: Should a note you sorted major or minor be left off a shared link?
refs: qi-5fn7stsv · docs/plans/261011f-referee-outline-your-notes-sorted-major-and-minor.md (Plan review, F1) · docs/user-feedback/261011_0253-referee-notes-sorted-major-and-minor.md · src/store/public-reader.ts PUBLIC_COMMENTS_WHERE
---
When you share an article by link, should a note you have sorted Major or Minor in Referee's new Notes be kept off the link, the way a note placed on a criterion already is?

A. Leave it as it is. A note with no criterion goes out on a shared link whether or not it is sorted; the word Major or Minor never does. Nothing changes for anyone.
B. Keep a sorted note off the link. Sorting it says it is part of a review, so it is treated like a criterion note and withheld. One more condition in the query that decides what a visitor sees.
Recommended: B. It is a one-line change, and a reviewer who shares an article is unlikely to want their review notes in it.

Details

What was built (on dev, not deployed): Referee has a sixth chip, Notes. It lists your own notes on the paper. You sort each one Major or Minor, then Copy notes puts them on the clipboard as the bones of a report: a bare Summary heading, then Major, Minor and anything not sorted yet, each with the passage it is on. Only your words go out, and no AI writes or sorts anything.

Why ask. A shared link already shows the owner's reading notes to whoever opens it, but never a note placed on a Referee criterion: that one is review work, and it is kept off in the database query itself. A note you sorted Major or Minor is review work in the same way, but today it is still shown (as a plain note, without the word Major or Minor), exactly as it was before you sorted it. So nothing is newly exposed by this change; the question is whether sorting should also withhold it.

Why it was not just done. The query that decides what a visitor sees is one of the app's listed security defences, and the session that built Notes was told not to change a defence without asking you. GPT Sol, reviewing the plan, rated it the most important point (P0) and recommended B.

What would decide it: whether you see a shared link as "my reading, for others" (A keeps every note there) or whether anything to do with reviewing should stay private by default (B).
