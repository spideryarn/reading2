# Plan review: one Simple press, one article cache (261001j)

Read-only review of docs/plans/261001j-simple-press-cost-and-latency.md. The code is already built
in the working tree (uncommitted), because the plan is the spike's conclusion: review the plan's
reasoning and evidence here; the code gets its own review afterwards. Do look at the code where it
bears on whether the plan's claims hold.

Evidence to check, not just the prose:
- The spike: evals/simple/fanout-spike.ts, and its results under evals/results/simple-fanout/
  (cold-* are the counted arms; the others read warm caches). `npx tsx evals/simple/fanout-spike.ts
  report` prints the table (free).
- The production change: `git diff HEAD -- src/simple-summary.ts src/messages-stream.ts
  tests/simple-summary.test.ts tests/messages-stream.test.ts`.
- Background: docs/project/prompt-caching.md § What breaks a cache; src/pipeline.ts
  `cacheArticleForStep`; src/article-prompt.ts `underCacheFloor`; the guard's plan
  docs/plans/261001i-simple-fidelity-guard-built.md; 261001b's one-call measurement
  (docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md § Ledger).

Questions:
1. Does the evidence support the choice (stagger on stream start, Fuller first), and is the cold
   methodology sound? Is anything in the table mis-summarised or over-claimed?
2. Is there a cheaper or faster design the spike missed, within reason?
3. Any way the stagger can strand a level, double-bill, break an abort, or change a stored result?
   Any interaction with a job that already marks the article?
4. Is the streaming section fair to Greg, the numbers right, and the recommendation reasonable?

P0/P1/P2 with file:line, then a verdict.
