You are reviewing a plan before it is built, read-only. Repo: Spideryarn (AI-assisted reading). Read AGENTS.md first.

The plan: docs/plans/261024x-summary-links-the-body-that-argues-a-point-not-the-abstract.md

Context to read: src/simple-summary.ts (the Brief/Fuller prompt; the section "WHERE EACH PARAGRAPH COMES FROM", keptIds/keptSentences, SIMPLE_PROMPT_VERSION and its history comment, inputFingerprint), src/simple-check.ts (the fidelity guard), src/paperwork.ts (the abstract/executive-summary reasoning), evals/simple/probe.ts (the eval runner the plan reuses), evals/plain-words/run.ts (blindCoin), docs/project/summaries.md, docs/project/front-and-back-matter.md, docs/project/prompting-guide.md § Measuring a prompt change, tests/simple-two-levels.test.ts.

Questions:
1. Is the diagnosis right, and is a prompt rule the right minimal fix? Is there a simpler or more robust option the plan missed?
2. Could the rule hurt: worse fidelity-guard behaviour (guard reads only cited blocks), more dropped paragraphs, links to passages that do not support the sentence, harm on essays with no abstract, conflict with the paperwork rule or the Structure abstract rule, or the escape clause being so broad it changes nothing?
3. Is the measurement sound and enough to decide shipping: arms, control, the hand-marked front-summary ranges, the ship condition, the judge design? What would you change? Be concrete.
4. Version and staleness: is /13 handled right (outdated, not stale; nothing rewritten)? Anything else that must change with the version (tests, docs, stamps)?
5. The fold half: is the factual claim about matter and executive summaries right, and is asking Greg (rather than building) the right call?

Output: numbered findings, each with severity (P0 blocker / P1 should fix / P2 nice), the evidence (file:line), and a concrete change. Then a one-line verdict.
