---
id: q-yc2fp3
report: spya-hrx8z2
status: open
asked: 2026-10-25
title: May an agent refresh The Order of Time once the asterisk fix is live, at the cost of about 7 minutes of reading time?
refs: docs/plans/261025a-asterisk-and-dagger-notes-at-the-back-of-a-book-link-to-their-markers.md · docs/user-feedback/261024_2112-asterisk-notes-link-to-their-markers.md · docs/plans/261024g-repoint-greg-s-bookmarks-and-reading-time-on-the-re-read-order-of-time.md
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
