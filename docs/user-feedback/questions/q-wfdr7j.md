---
id: q-wfdr7j
report: none
status: open
asked: 2026-10-21
title: Anyone with a private link can push up its "opened while signed out" count. Accept that, or add a firewall rule?
refs: R31 · docs/project/security-risks.md · plan 261021d (private-link opens) · fbcf30ac · decisions file item 86
---
The owner of a private link now sees how many times it was opened, including by people who were not signed in. Anyone holding the link could open it over and over and push that signed-out count up, by up to about 43,000 a day.

A. Accept it as a low risk. It is only a number, only the owner sees it, and nothing else is affected. Nothing to build.
B. Add a Vercel firewall rule limiting how often one address can open that one route. Costs a little setup and one more rule to remember; gives an honest count even against someone trying to inflate it.

Recommendation: A.

Details

Signed-in opens are counted once per reader, so they cannot be inflated this way; only the signed-out tally can. The risk is recorded as R31 in the security register.
