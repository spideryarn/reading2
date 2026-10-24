---
id: q-hc4y2j
report: spya-mxk20e
status: open
asked: 2026-10-24
title: Resting on a source: a quick note, or start a real chat in the card?
refs: SPIDERYARN-READING2-NA · docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md · docs/plans/261024m-plan-review-sol.md · docs/user-feedback/261023_2215-hover-a-source-starts-a-deeper-dive.md
---
When you rest the pointer on a citation in the prose, what should start by itself? Nothing is built yet, because most cited works have nothing we could ground a cheap note in. So the only versions that would reach your article spend money on a hover.

A. A quick note, only where we already hold a checked note from the work's abstract. Under a penny an article, 1 to 3 seconds. It would show on about 1 cited work in 9 today, and not on the article you filed this from. About a session to build.

B. After about 2 seconds of rest, run the web search that "Open in Sources" already runs for one work (0.8p, about 6 seconds, a note checked against the work's own page). This reverses your earlier choice that the search runs only on a press. It still needs a DOI or arXiv id, which most works without a note lack. A few hours to build.

C. After about 2 seconds of rest, start "Does it say that?" (a chat that searches and reads the cited paper about this paragraph) and stream its answer into the card. It reaches every work. Roughly 2p to 10p and 15 to 60 seconds each (estimates, not yet measured), and each one is a chat in Chat's list (one per work and paragraph, reused if you rest there again). About a session or two to build.

D. Leave the hover alone. Make the existing buttons (Ask in chat, Does it say that?) answer inside the card instead of taking you to Chat. You still choose when to spend. About a session to build.

Recommended: C, behind the Experimental switch first, so only you pay while you try it and can feel whether it is worth the money and the wait. Then A on top later, as the cheap first line where a note exists.

Details

What you asked, on 23 October (report spya-mxk20e, from the Effective expressiveness article): "any time I hover over a source, let's automatically start ... some kind of deeper dive, which could be the same as initiating an ask in chat with a default input and just stream in the response so that I can just hover over a source or a link or whatever and find out more without having to click and ask for it and be taken somewhere else."

Links already do this. Rest on a hyperlink in the prose and, once our server has fetched the page, the card streams a short note on what the page is and how it stands to the paragraph the link sits in. It is cheap (about a hundredth of a penny), cached for a fortnight per paragraph, and capped. So this question is about citations only.

What a citation's card shows today: the title, authors, the article's own entry, a short note from the work's abstract where one exists, and jumps to each paragraph that cites it. Then three buttons: Ask in chat (the work's own chat), Does it say that? (a fresh chat about this paragraph that reads the paper), and Open in Sources.

Why nothing cheap reaches most works. The plan was A: a quick note on what this paragraph uses the work for, and whether what we hold of the work bears it out. GPT Sol's review pointed out that without anything we fetched about the work, that note can only restate the paragraph. That is the "why" line we already hide on purpose, and it is the "say nothing rather than guess" rule you set for this mode on 3 and 17 October. So the note must rest on evidence. I then counted on production: of 790 cited works, 86 have a checked abstract note. The other 698 mostly have no abstract or no identifier to look one up by. Your article's one cited work has none.

So the honest versions that reach most works all spend something on the hover. In B it is the existing one-work web search. On 19 October you chose that it runs only when you press "Open in Sources", for the clicked work, never for every work, and B would change that. In C it is the existing paragraph chat, which costs more but reads the paper itself and reaches every work.

Cost controls that would apply to any of them: it fires only when the card shows exactly one work (a phrase can cite several, and we will not start several at once), only for your own articles, only after the rest (so a pointer passing over buys nothing), never twice for the same work and paragraph (cached), and under a daily cap per reader and overall.

What would decide it: whether you want depth on every hover (C), whether the 0.8p search is enough (B), or whether you would rather keep choosing when to spend and only stop being taken to Chat (D). A is cheap but would rarely show, which is why it is not the recommendation on its own.

The plan, with GPT Sol's review and the cost controls already designed, is ready for whichever you pick.
