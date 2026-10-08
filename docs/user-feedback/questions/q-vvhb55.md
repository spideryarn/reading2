---
id: q-vvhb55
report: spya-ucftjt
status: answered
asked: 2026-10-07
title: Should Ask about Spideryarn, on the Help pages, work for people who are not signed in?
refs: qi-e6ksaejb · docs/plans/261007k-help-chatbot.md · docs/user-feedback/261006_2208-help-chatbot-on-the-help-pages.md · SPIDERYARN-READING2-E9
acted: spya-umnga8
---
You asked for a chatbot on the Help pages that answers only questions about how Spideryarn works, free, and available to people who are not signed in. It is built for signed-in readers: a box on every Help page, one question at a time, answered from the Help pages by a cheap model (GPT-5.6 Luna), nothing stored. A question costs about $0.007 the first time and $0.0006 after that, because the Help pages stay cached between questions, whoever asks. In a test of 24 questions it declined every off-topic question and every attempt to make it do something else.

Opening it to strangers is the first thing on the site that lets somebody with no account spend our money, so it changes the code in front of the sign-in check, a listed defence. That is why it waits for you. Signed out, the box says "Sign in to ask a question about Spideryarn."

A. Leave it signed in only. Nothing more to build. Someone deciding whether to try Spideryarn cannot ask it anything.

B. Open it to everybody, with limits (recommended). One extra address that works without signing in. Limits, from outside in: a rate limit in Vercel's firewall, which you would set in its dashboard; the request must come from our own page; a per-address allowance, stored as a keyed hash of the address and never the address itself, in its own table; and a daily ceiling for strangers alone, separate from signed-in readers', so a script cannot use up yours. A ceiling of 1,000 questions a day for strangers is at most about $7 on a bad day, after which strangers are told it is resting until tomorrow. The privacy page gains a line about the hashed address. About a day's work.

C. B plus a "are you human" check (Cloudflare Turnstile). Stops casual scripts from using up the strangers' ceiling. Costs a third-party script and a widget on the Help page, a privacy line, a key in Vercel, and a short-lived session we would have to mint, because each check can be used only once. About two days.

Pick B if strangers occasionally being told "resting" is acceptable; C if a script emptying the ceiling would be a real loss; A if this should wait.

## Greg's answer, 2026-10-08 (in the Feedback dialog, reply `spya-umnga8`)

> A for now

Settled: Ask about Spideryarn stays for signed-in readers only, for now. Nothing more built. Recorded by the feedback sweep.
