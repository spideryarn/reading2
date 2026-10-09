---
id: q-rstqvz
report: none
status: open
asked: 2026-10-09
title: Which way should agents write their questions and replies into the database?
refs: follows q-f6ub8e (reply spya-nhmghm) · qi-mmqzr385 · docs/plans/261009f-agent-questions-and-replies-in-the-database.md · docs/plans/261009f-agent-questions-plan-review-sol.md · docs/user-feedback/261006_2118-earlier-tab-says-what-became-of-each-report-and-asks-greg-in-place.md
---
You asked for these questions and replies to live in the database, with a command an agent runs to ask and to reply. I have planned it; nothing is built. The design is the same whichever you pick: the questions and the agents' replies go into new tables, an agent runs one command to ask, reply or close, and this dialog reads the tables, so both sides appear at once. The one real choice is what lets the agent's command write to the live database. Which?

A. The database login agents already have. It can write any table, and today only a rule keeps agents to reading. Nothing for you to set up. Gives up: "agents never write to the live database" becomes "agents write through this one command", and only the command's code stops a slip from reaching other tables.

B. A new database login that can do only three things: ask, reply, close (recommended). The database checks every rule itself, so a slip by an agent cannot touch readers' data or your replies. Costs you about ten minutes: run one statement to create the login, and put its address in .env.prod on the box and the Mac.

C. A new web address agents post to with a secret key. It can rate-limit and log, but it is a new way into the site from the internet and a change to the sign-in gate. B gives the same checks without that.

D. Agents sign in as you, the way the Spideryarn MCP server does. No gate change, but the agent holds your whole account: every admin page, billing, publishing.

Recommended: B. A is fine if you are happy to rely on agents following the rule.

And separately: neither A nor B stops an agent that has been tricked by a hostile report, because the all-tables login stays on the box beside the new one. Closing that (call it B+) means taking that login off the box and the Mac and giving the reading scripts their own read-only login. Bigger, and its own piece of work. Want it queued? Yes / not now.

Details

What you said (8 Oct, replying to q-f6ub8e): waiting for a deploy is acceptable but does not fit your mental model; you imagined these questions and replies stored in the database, with a command the agent uses to send them, just as it already queries feedback reports.

How it works today. An agent asks you something by adding a file to the code; the question appears here after the next deploy, typically hours later. Your reply is stored in the database the moment you send it, and an agent reads it with a command. When the agent answers you, it edits the file, and you see that after another deploy. So your half is instant and the agent's half waits.

What changes. The question and the agent's replies move into the database beside yours. An agent runs one command to ask, another to reply (naming which of your replies it is answering), and one to close a question once it is settled. The dialog shows the whole thread in order, the agent's lines labelled with the session that wrote them. Every existing question file is copied in once, before the deploy, and the folder stops taking new ones. Notes about what became of each report stay files.

Why it is your call. Two of the site's listed security defences are in play: no agent writes to the live database, and nothing new gets in before the sign-in gate. A and B both have an agent writing to the live database; C adds a way in; D hands over your account. An unattended agent may not change any of those.

Why your replies get their own table. Agents treat your replies as your own words, so they are trusted and acted on. If an agent could write into that table, a slip or a trick could produce a line that the next agent reads as you giving an instruction. Under B the new login cannot write there at all.

The thing GPT Sol caught in review. I first wrote that B would stop a tricked agent. It does not on its own: the box also holds the live site's own login, which can write everything, and an agent determined to misuse it could simply use that one. B protects against mistakes, and stops this new channel from becoming a way in. Protecting against a tricked agent needs B+.

What would decide it. If you are content to rely on agents keeping to the rule, A is the least work. If you would rather the database enforced it, B. After you choose, it is about a day of work in three reviewed stages, then the Overseer deploys as usual.
