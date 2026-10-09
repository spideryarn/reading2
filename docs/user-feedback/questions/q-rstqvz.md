---
id: q-rstqvz
report: none
status: open
asked: 2026-10-09
title: Which way should agents write their questions and replies into the database?
acted: spya-qnak8d, spya-b3qx08
refs: follows q-f6ub8e (reply spya-nhmghm) · qi-mmqzr385 · docs/plans/261009f-agent-questions-and-replies-in-the-database.md · docs/plans/261009f-agent-questions-plan-review-sol.md · docs/user-feedback/261006_2118-earlier-tab-says-what-became-of-each-report-and-asks-greg-in-place.md · qi-32rmtndv · docs/plans/261009o-security-risks-register-and-a-security-review.md
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

## Greg's answer, 2026-10-09 (in the Feedback dialog, reply `spya-qnak8d`)

> A although I accept it's a bit of a security risk, so if you haven't already, can you create a doc for security risks and add this as a medium risk or whatever level you think it is? I don't have access to my computer network right now, I don't want to deal with it, but I also don't want to block the work from happening. And so at some point in the future we might switch it over to a separate database login. And then maybe can you kick off, and then maybe can you kick off another agent whose job it is just to do a security review and update that security risks doc with anything else, and then we can work through their proposals in it.

So A, with the risk written down. The register is docs/project/security-risks.md (plan 261009o), where A is entry R1 and the later fix (B, then B+) is recorded; the security review's findings are in the same doc for Greg to work through. A itself is still to be built, under qi-mmqzr385 (plan 261009f), and that build is held for Greg because it relaxes a listed defence. This question stays open until A is built.

## Greg's second answer, 2026-10-09 19:38 UTC (in the Feedback dialog, reply `spya-b3qx08`)

> A. I think it's fine. Perhaps we have a script that they use for this, so they're not doing bespoke queries. And let's keep the rule against live writes in agents.md with this as the exception.

Added to the held build, qi-dr9nnvjm. Still held: a reply cannot let an unattended run change a defence. It starts when you run it in a session you watch, or tell the Overseer an unattended one may.
