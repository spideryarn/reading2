---
id: q-jb5cnd
report: spya-tddvg2
status: open
asked: 2026-10-07
title: May security-map.md list the two new guards the guide added?
refs: SPIDERYARN-READING2-E7 · docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md § A rule-doc edit proposed, not made
---
What this is about. security-map.md is the page that lists where each security defence lives in the code. It is one of the docs whose wording is a rule, so changes go to you first. Building the guide added two guards, and the reviewer (GPT Sol) asked for them to be listed there.

The two guards, in plain words:
1. A conversation can now only use the tools it was offered. Before, a model could name any tool and the server would run it; the guide is offered only the article's own tools, and the server now refuses anything else, for every kind of conversation.
2. A model's suggested button is drawn only if it is on an allowed list, its argument is valid, and (for a mode) you can open that mode here now; this is checked when it is drawn and again when you press it.

Before: the row for src/chat-tools.ts says "isSlug on the model's slug, URL-length cap on the model's URL".

After: that row gains "; runTool refuses any tool not in toolsFor(kind), so a conversation's tool list is a boundary and not a suggestion", and one new row for src/web/chat-commands.ts and command-proposal.ts: "chipFor: what a model's [cmd:...] token may become: an id on CHAT_PROPOSABLE, an argument its own command accepts, a mode the reader can open here now, checked at the draw and again at the press. A press is the only way any of it runs."

A. Yes, make both edits as worded.
B. Yes, with changes (say which).
C. No: these belong in chat-tools.md only (they are described there already).

Recommendation: A.
