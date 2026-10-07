---
id: q-f6ub8e
report: none
status: open
asked: 2026-10-07
title: Is waiting for the next deploy acceptable for a question to appear here?
refs: qi-ewwnsr85 · docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md § Questions for Greg (question 1; § What an unattended run may not build: the fast path)
---
Background. This list of questions is new. An agent asks you something by adding a small file to the code, and the question appears here only once that code has been deployed. The Overseer deploys ready work by itself, usually within hours, so that is how long a new question can wait before you see it. Your reply is stored the moment you send it. Making a question appear at once would need an agent to write into the live database directly, and both ways of doing that are outside what an unattended agent may do, so neither is built.

A. Keep what is built. Questions arrive with the next deploy. No new secret. Delay: until the next deploy, typically hours.

B. A new way in for agents. An agent holding a secret posts a question straight to the live site. Instant. Costs: it would be the third thing the site accepts before the sign-in gate, and the first that writes with no reader behind it. Every agent session would hold the secret, and whoever holds it can put words in front of you under the product's own name. It changes the sign-in gate, a listed security defence.

C. The Overseer copies questions across. Agents still write a file; the Overseer, which already holds the live database's credentials for the deploy, copies open questions into the live database between deploys. No new way in, and no secret for ordinary sessions. Costs: an agent writing to the live database as a standing job, and a second home for each question.

What would decide it: if, after a week of use, questions regularly sit undeployed for longer than you would have waited, C is the smaller step. B buys nothing C does not.

Recommended: A now, and C if the wait bites.
