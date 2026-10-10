You are reviewing a plan before it is built, read-only. Repo: the current directory (Spideryarn).

Plan: docs/plans/261010f-a-stale-referee-criterion-overflow-and-the-calls-one-notch-from-it.md

Background you should read: docs/plans/260928c-referee-claims-fail-on-long-pieces.md (the earlier fix of this class),
docs/postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md, src/token-budget.ts
(budgetFor, deadlineFor), src/ai-call.ts (CHAT_REASONING, warnIfThinkingAteTheCeiling, openRouterJson),
src/debate.ts (ANSWER_TOKENS, sendToProvider, the finish_reason "length" refusal), src/debate-themes.ts
(SYNTHESIS_ANSWER_TOKENS), src/search.ts (the max_tokens: 4000 request, SEARCH_TIMEOUT_MS, SEARCH_STALL_MS),
src/routes.ts (SEARCH_ORPHAN_GRACE_MS and its assertion), src/pdf-frontmatter.ts (MAX_TOKENS).

Questions:
1. Is the diagnosis right: the reported error is a stale stored row from before 260928c, and today's code passes?
   Is anything in the evidence weak?
2. Are the three budget changes right and enough? Is the thinking reservation for each sized sensibly? Is anything
   at risk that the plan leaves out (chat at 63% per round, citations-find, pdf at 54%, referee-mirror at 2,000,
   or the hidden-check)? Look at the code rather than trusting the plan's table.
3. Search: is raising the deadline from 60 s to deadlineFor(9,750) (≈129 s) right, given a reader is waiting?
   Or should search name an effort instead? Is anything else sized against SEARCH_TIMEOUT_MS (leases, rate
   policy, client timers, tests) that would break?
4. Debate: does the 9,296-output row above an 8,000 ceiling mean max_tokens applies per web-search round? Does
   that change the sizing? Is there any per-call or per-step clock in the debate step a 24,000 ceiling could
   outrun (job lease, maxDuration)?
5. The JSON-wire warning: is openRouterJson the right single place? Where does the reasoning count come from on
   that path (meterBody / Meter), and does any openRouterJson caller use a non-chat body shape (Messages wire, PDF)
   where reading choices[0].finish_reason would be wrong?
6. Anything in the tests that would pass against a broken implementation?

Answer with numbered findings, each with a severity (P1/P2/P3), the file:line evidence, and what to change.
End with a one-line verdict: build / build with changes / do not build.
