You are reviewing a plan, read-only. Do not edit files.

Plan: docs/plans/261101a-citations-every-work-cheaply-with-haiku.md

Context to read: src/bibliography.ts (SYSTEM prompt near line 2170, toDrafts ~710, keepLeanedOnMost ~748,
buildBibliography ~1853, rowsFromText ~1811, generateBibliography ~2368), src/types.ts MAX_CITATIONS,
src/messages-stream.ts streamMessage (the eval `model` override), src/models.ts (PINNED_MODEL, TASK_TIER
for "bibliography"), src/token-budget.ts, docs/investigations/261027a-how-often-citations-are-missed.md,
evals/results/citations-recall/261027a-hand-count.md, docs/plans/261029b-citations-in-a-comma-separated-list-are-all-read.md,
docs/user-feedback/questions/q-ns76uq.md, docs/project/prompting-guide.md.

Goal: an eval of whether Haiku 5.5 with a better prompt finds every citation an article makes, more cheaply
than Sonnet 5.5, and a ship/ask decision rule.

Look hard for:
1. Flaws in the measurement that would make a winning arm look better than it is (or a losing one worse):
   the scorer's matching rule, one-to-one matching, ground-truth construction, scoring before vs after the cap,
   same-surname/same-year collisions, numbered articles where rows have no reference block, Wikipedia
   footnotes that share a source.
2. Anything in shipping (pinning bibliography to Haiku, raising MAX_CITATIONS, raising max_tokens, the
   prompt change) that would break something downstream — places that assume <= 80 rows, token budgets,
   cost tracking, High-powered AI, stamps/versions, staleness, tests.
3. Whether the decision thresholds are sensible and whether any arm is missing or wasteful.
4. Haiku-specific risks: the >100K-token price step, refusals, the 128K output ceiling with thinking.

Write findings numbered, each with severity (high/medium/low), the evidence (file:line), and a concrete fix.
Be concise.
