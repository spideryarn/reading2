---
id: q-yc2fp3
report: spya-hrx8z2
status: answered
asked: 2026-10-25
title: May an agent refresh The Order of Time once the asterisk fix is live, at the cost of about 7 minutes of reading time?
refs: docs/plans/261025a-asterisk-and-dagger-notes-at-the-back-of-a-book-link-to-their-markers.md · docs/user-feedback/261024_2112-asterisk-notes-link-to-their-markers.md · docs/plans/261024g-repoint-greg-s-bookmarks-and-reading-time-on-the-re-read-order-of-time.md · docs/plans/261025g-refresh-the-order-of-time-for-its-asterisk-notes-and-move-greg-s-reading-time.md · qi-jk3xk9zt
acted: spya-s4qkhh
---
The asterisk notes in The Order of Time are fixed on dev: all 11 will link, both ways, with the hover card. But your copy only changes when the book is re-processed. That is a Refresh, and it would detach about 7 minutes of your recorded reading time from four paragraphs.

A. Yes: once the fix is deployed, an agent refreshes the book, then moves that reading time onto the new paragraphs, the way your bookmarks were moved yesterday. Under a dollar. (Recommended.)
B. Yes, refresh it, and let those 7 minutes go. A little less work, same cost.
C. No: leave this copy as it is. Only future imports get the links.

Recommendation: A. Your bookmarks are not touched either way; none sit on the paragraphs that change.

Details

What you reported (24 October, on this book): "There are a lot of asterisks… We should be picking them up and turning them into links and tooltips, bidirectional links, like we do with other footnotes."

What was wrong: besides its 143 numbered notes, the book has 11 notes marked with an asterisk, printed at the back after the numbered ones. Spideryarn found the notes and listed them at the end, but looked for their asterisks only after the last numbered note's place in the text, near the end of the book. So it found none.

What changed: the asterisk notes are now looked for separately. Because an asterisk does not say which note it is, the PDF's own text is used to check each one: the 5th asterisk printed in the book goes with the 5th asterisk note, and each is matched to the word it follows. If one cannot be pinned down, it stays unlinked rather than risk pointing at the wrong note. On this book's current reading, all 11 link correctly. Nothing changes for any other article in production; I checked all 33 PDFs.

Why a Refresh costs something: a paragraph's identity includes which notes it cites. Four paragraphs that already cite a numbered note would also cite an asterisk note after the Refresh, so they become new paragraphs, and the reading time recorded on the old ones (about 400 seconds in all) no longer points anywhere. Option A moves it across, as plan 261024g did for your bookmarks. Nothing else of yours is affected. The fix changes no prompt, so the stored reading of the PDF should be reused; if it is not, the PDF is read again, which cost nothing last time. The paid parts are the contents tree and the labels, about 70 cents together on 23 October.

The deploy itself is the Overseer's to run, as always; this question is only about the Refresh afterwards.

Greg's reply, 2026-10-25 08:55 (spya-s4qkhh, in the Feedback dialog), choosing A:

> A

Acted on, 2026-10-25 at 14:08 UTC (queue item qi-jk3xk9zt): done. The book was refreshed, and all 11 asterisk notes now link both ways. Exactly four paragraphs got new ids, as this question said, and the 401.5 seconds you had spent on them moved to the new ones. Your total reading time on the book is unchanged. Your 6 bookmarks were not touched. It cost $0.75, and nothing was read from the PDF again. A first attempt failed on a bug in my script before doing any work, so it cost nothing and changed nothing. I dismissed its failed card so it would not show as a broken Refresh. Which old id went where is in docs/plans/261025g-undo.json. The plan: docs/plans/261025g-refresh-the-order-of-time-for-its-asterisk-notes-and-move-greg-s-reading-time.md.
