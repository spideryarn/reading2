---
id: q-w26r6u
report: spya-drbkvc
status: open
asked: 2026-10-11
title: Should the guide get web search after all, at the cost of a special case in the chat loop?
refs: qi-bj329ze3 · qi-zvsky2aj · docs/plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md · docs/plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address-guide-consult-sol.md · docs/user-feedback/261011_0140-web-search-in-every-chat-mode.md · SPIDERYARN-READING2-H9
---
You asked for web search in every chat mode. Recall and Tutorial now search when a reader asks where the piece stands. The guide (the "how should I read this?" chat) still cannot: I gave it search, it went wrong, and I took it out. It now tells the reader that Chat can look it up. Should I build the fix that makes guide search work?

A. Yes, build it (about half a day). When the guide searches, it calls its "next steps" buttons tool before writing anything, so what it found is lost, and it then tells the reader "I haven't looked this up". The fix keeps what the search found and makes the guide write its answer from it. It adds one special case to the chat loop, and a second search provider (Exa) for the guide. I would also give the guide page-reading (opening a link the reader pastes), as Chat has.

B. Search only, no page-reading. The same fix, but the guide still cannot open a pasted link and sends the reader to Chat for that.

C. Leave it (what is live now). The guide says "Chat can look that up" and offers Chat as a next step. No new machinery. The guide stays about how to read the piece; questions about the world go to Chat.

Recommendation: C for now. The guide's job is how to read the piece, Chat and Learn already search, and the fix adds a special case to the loop every conversation runs through. If you often find yourself wanting the guide itself to look things up, A.

Details

Your report (11 October, 01:40): chat should be able to look at specific web addresses, and every chat mode, Learn's included, should search the web, because readers want to place an article among others.

What I found. Chat, Recall, Tutorial and Explore could already search the web and open a page; every one of them opened a link a reader pasted, every time I tried. Recall and Tutorial are told to stay inside the article, so "where does this piece sit among others?" never got a search (0 of 8 tries). They now treat that question as a reason to search: Tutorial did 4 of 4, Recall 2 of 4 (its two misses answered from a relevant article already in the reader's library). Questions that test memory still get no search.

The guide. With search switched on, it searched and then pressed its own "next steps" tool before writing a word. A search's results only exist inside the reply that ran it, so they were gone by the time it wrote, and it told the reader "I haven't looked this up" (most of a dozen tries; one failed outright). Telling it to write first did not help. GPT Sol's suggested fix: use a search provider that hands back what it found straight away, and when the guide does exactly this, pass those findings forward and make it answer with no tools. Sol puts it at half a day, starting with a check that the provider really does hand the findings back in this case.

Page-reading is asked here too because each conversation's list of tools is one of the security checks, and your report named page-reading only for Chat, which already had it.
