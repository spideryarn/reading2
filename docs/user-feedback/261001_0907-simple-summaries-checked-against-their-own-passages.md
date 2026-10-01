---
reports: none
ending: shipped
---
# Simple summaries are checked against their own passages

Not from a reader. The Overseer dispatched it as the build that plan 261001h's measurement
recommended, with no Sentry id. The fault behind it: on the PID paper, a Simple summary said
synergy *"grows with more feedback loops"*, where the paper finds feedback connections lower it.
261001b's blind read found it, and 261001h traced it. The time in the file name is when this session
received the brief.

**Ending: Shipped.** On `dev` in 93d0a91d, 2a6c7ef3 and 43b01d46, merged as c6f0a3a7. Not
deployed: the Overseer deploys. There is no Sentry issue to resolve.

After each Simple level is written, a quick-tier model reads every paragraph beside the passages it
cites and says whether they contradict it. A flag buys that level one rewrite, and the rewrite is
kept whatever it says. If the check itself fails, the level is kept unchecked. It cannot cost a
reader a summary, only a few seconds. Every stored summary records what the check said, and
`scripts/simple-check-report.ts` counts the flags, retries and checker failures. It is switched off
by one line, `SIMPLE_CHECK_ENABLED`. [summaries.md](../project/summaries.md#simple-a-plain-words-orientation);
the build is [261001i](../plans/261001i-simple-fidelity-guard-built.md).
