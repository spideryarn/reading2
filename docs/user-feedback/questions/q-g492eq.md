---
id: q-g492eq
report: spya-vc6uzm
status: open
asked: 2026-10-17
title: May an agent build the guide opening pages, limited to addresses it was handed?
refs: qi-jbfehgss · q-madusw · reply spya-eqtvhz · docs/plans/261017e-bring-a-web-page-into-chat.md · docs/user-feedback/261012_1007-web-search-through-a-subagent.md · SPIDERYARN-READING2-HY
---
You said yes to the guide opening pages (2A). Because it changes one of our security checks, an agent working on its own does not make that change without your say-so. The plan is written; may an agent build it?

A. Yes, as planned: the guide may open a page only if it was handed the address (a result from its own web search this turn, an address you typed in the conversation, or a link in the article), at most one page per answer, with every check Chat already has. GPT Sol reviews the code before it lands.
B. Yes, but as Chat has it: the guide may open any address, including one it writes itself. Fewer refusals, but it gains the one way a hostile article could get your About you out (see Details).
C. Not yet.

Recommendation: A.

Details

What you asked. On 17 October you answered q-madusw "1A and 2A", and added: the guide "prefers to hand off substantive work (e.g. by offering to create new Chat threads), but … it's not hobbled by lack of tools/capability/access if it tries to do things". 1A (a "Bring into this chat" button that imports a web page and puts it in Chat's box as an @-mention) is built. 2A is this question. Your principle is now written into the guide's doc.

Why ask again. Each conversation's list of tools is one of the checks our security map lists, and the rule for agents working unattended is that they plan a change to one of those checks but do not make it on their own. So the plan is ready and waiting for a yes.

What 2A does. Today the guide can search the web (a small helper returns up to five links with a sentence each) but cannot open a page. With 2A it can open one and read it, as Chat does, for questions about how to read this piece: is this review fair to it, what does the author's other piece say. Questions about the subject still go to Chat, with the button it already offers.

The risk, plainly. Opening a page means sending a request to an address. The guide always has your reason for reading and your About you in front of it. A hostile article could tell it to "open" an address with your About you written into it, which would send those words to that site. Chat has this exposure today, limited to about 2,000 characters an address. Option A removes it for the guide: an address the search engine returned, that you typed, or that the article's author wrote cannot contain what the guide read this turn, so the guide never opens an address it made up. What A gives up: the guide cannot follow a link it found inside a page it opened, or guess an address; it offers Chat for those.

Cost and speed. A page adds up to 12,000 characters to the answer's input and up to 20 seconds of waiting. One page per answer keeps that bounded; the guide's eval will measure how often it reads, how long answers take and what they cost, before and after.

If yes. An agent builds it from the plan, with tests that a made-up address is refused before anything is fetched, runs the guide eval, has GPT Sol review the code, and lands it on dev for the Overseer to deploy.
