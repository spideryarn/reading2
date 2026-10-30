---
id: q-bjkb37
report: spya-gkmgdd
status: open
asked: 2026-10-29
title: Should Start again also be able to wipe your comments, chats and bookmarks?
refs: docs/plans/261029l-re-run-structure-from-metadata-and-start-again-from-the-command-bar.md · docs/user-feedback/261029_1635-re-import-from-the-command-bar-and-the-wipe-option.md · docs/user-feedback/261029_1637-re-run-structure-on-its-own-from-metadata.md · docs/plans/260928a-reset-and-regenerate-article.md · qi-74cjmsq2
---
You asked for a re-import that keeps your data, and a second version, off by default, that also throws away your chats, comments, bookmarks and other input. The first one exists and now has a command-bar row. Should I build the wipe?

A. Not now (recommended). Delete the article and add it again: that already gives you a clean copy. Nothing new to build, and nothing new that can delete a reader's things by mistake. The cost: for an ordinary reader, adding it again spends a slot, because deleting an article does not give its slot back. You are an admin, so that does not touch you.

B. Build it: a box in Start again's confirm, "Also delete my comments, bookmarks, chats, notes, quiz answers and reading time on this article", unticked by default, then a second "this cannot be undone" confirm. Same article, same link, no slot spent. The cost: it has to know every table that holds reader input for an article, and one that gets missed is left behind without a word. Medium-sized, and it needs its own tests.

C. Never: a reader who wants a clean slate deletes the article.

My recommendation is A for now, with B later if you find yourself deleting and re-adding often.

Details

What you asked (2026-10-29, on Consciousness in AI): an easy way, from the command bar, to re-import an article so it picks up the pipeline's newer improvements, keeping your data. Separately, an option off by default that wipes your input as well. You wanted it so you could see the new, deeper Structure on that paper. Two minutes later you looked on the Metadata page for a way to re-run only Structure and found none.

What was already there: on the Metadata page, under AI processing (a section that is shut until you open it), the first row is "Whole article — Start again". It re-reads the stored copy of the article with today's pipeline and keeps your comments, highlights, bookmarks, notes, chats and reading time. A tick box makes the extra modes again too. It is behind the experimental switch on /profile. If you could not see it, that switch is the likely reason.

What I built, with no question needed:
1. A "Structure › Run again" row on Metadata and in the command bar. It rebuilds the outline with today's Structure. If nothing about how Structure is made has changed, it replays the saved answer and costs almost nothing. If the prompt or model has changed, as it has for the deeper level, it builds a new tree. The paragraph labels are rewritten after it and are missing for those minutes. Your comments are untouched.
2. A command-bar row, "Start this article again", for re-import, reset, reload and start over. It opens AI processing, where Start again is the first row, and it keeps its confirm. It shows while the experimental switch is on, like the row it leads to.

Neither does anything on this paper until the AI key resets on 1 November and the change is deployed.

The wipe is the only part that destroys your data, which is why it is a question and not a build.
