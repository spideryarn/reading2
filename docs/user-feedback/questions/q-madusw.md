---
id: q-madusw
report: spya-vc6uzm
status: answered
asked: 2026-10-12
title: Should a web page or search result be kept in a Chat, and may the guide open pages?
acted: spya-eqtvhz
refs: qi-ht2wtjg8 · qi-jbfehgss · q-g492eq · docs/plans/261017e-bring-a-web-page-into-chat.md · q-w26r6u · docs/plans/261012g-web-search-through-a-subagent-for-chat-and-the-guide.md · docs/investigations/261012b-web-search-subagent-spikes.md · docs/plans/261012d-chat-at-mention-your-own-articles.md · docs/user-feedback/261012_1007-web-search-through-a-subagent.md · SPIDERYARN-READING2-HY
---
Guide search now works, through a small search helper as you suggested. Two things are left for you.

1. You asked for a web page or search result to be "loaded into the Chat's context". Today Chat reads a page you paste, but only for that one answer. How should a page stay in a conversation?

1A. Add it to your shelf, then bring it in like an @-mentioned article. A "Bring into this chat" button sits on each link in a search result, and on a pasted address. Pressing it imports the page like the Add box does, then puts it in the box as a mention. From then on Chat has the whole page for the rest of the conversation, and can point to its passages. Costs: one article slot for each page (admins are exempt), and a short wait while it imports (seconds for a web page, minutes for a PDF). Reuses everything the @-mention work built.

1B. Keep the page in this conversation only, not on the shelf. No slot is used and there is no import wait. But it means a second way of storing text, with nothing to point back to: an answer could not cite a passage in it. This is the shape we turned down for attachments on 11 October.

1C. Not now. A pasted address keeps working for one answer, and links in earlier answers can be opened again.

Recommendation: 1A.

2. Should the guide (the "how should I read this?" conversation) also be able to open one of its search results and read the whole page, as Chat can? 2A: yes. 2B: no, it links the results and Chat reads pages. Recommendation: 2B for now. The guide's job is how to read the piece, and its search results already say what each page says. Each conversation's list of tools is one of our security checks, so this is yours to decide.

Details

What you asked. On 12 October you replied to q-w26r6u: make guide search work, perhaps with a helper that runs the search and hands back links and a summary. In the same sweep, report #579 asked to drop addresses into Chat, or ask for web searches, and have one or more results loaded into the Chat's context, so you could ask where the article sits in the wider literature.

What was built. A tool called search_web. A small, cheap model (GPT Luna) is required to search Exa, then writes up to five lines: a title, a link and a sentence on what the page says. We keep only links the search really returned (the cheaper Haiku mistyped 1 link in 30 in the trial). The guide gets the lines as an ordinary tool result. That is what fixes the old bug: before, the search's results vanished when the guide pressed its next-steps buttons before writing anything. It is limited to two calls per answer; a call cost about seven tenths of a cent at the median in the trial. The guide searches only on questions about how to read the piece: is it well regarded, what to read alongside it, who the author is. Questions about the subject itself go to Chat, which the guide now hands them to with a button.

Chat. Chat already searches the web with OpenRouter's own search, and shows the sources as chips under its answer. We tried it with the new helper instead: it searched in the same places and cost about 15% less, but each answer that searched took 11 seconds longer and lost its source chips. So Chat keeps its own search.

On question 1. The @-mention work (also from your 12 October reports) brings one of your shelf articles into a conversation whole, so the model can quote it and point at its passages. By design only you can bring something in, by pressing; a model or a web page cannot. 1A uses exactly that path. A page on your shelf also shows up in your library searches later, which may be welcome or clutter.

On question 2. Opening a page means the guide could fetch any address a search result or the article hands it. Chat has done this safely for weeks, behind the same checks. The guide was deliberately kept to the article's own tools when it was built, and your reply asked for search, not page-reading, so it was not added without asking.

Greg's reply, 2026-10-17 (spya-eqtvhz): "1A and 2A / Re guide: our approach should be that it prefers to hand off substantive work (e.g. by offering to create new Chat threads), but that it's not hobbled by lack of tools/capability/access if it tries to do things"

Acted: 1A built (plan 261017e, stage 1). 2A planned in 261017e § Stage 2; it edits a listed defence, so whether an unattended agent may build it is asked in q-g492eq. The principle is recorded in chat-tools.md § The guide.
