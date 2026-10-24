You are reviewing a change before it is pushed, in the Spideryarn repo (read AGENTS.md first). Since 2026-09-09 the code reviewer fixes what it finds inside the change and reports anything wider. Do not run git commands that discard work, do not commit, do not touch files outside this change, and do not call any paid model or run the eval probe.

The change: plan docs/plans/261024x-summary-links-the-body-that-argues-a-point-not-the-abstract.md (read it in full, with its plan review), measured in docs/investigations/261024f-summary-links-to-the-body-or-the-abstract-measured.md.

See the scoped diff with: git diff HEAD~1 -- . and git diff -- . (stage 1 is the last commit; stage 2 is uncommitted) plus the untracked files: docs/investigations/261024f-summary-links-to-the-body-or-the-abstract-measured.md, docs/user-feedback/questions/q-r8kumx.md, evals/results/simple/high-none-link1a/, evals/results/simple/high-none-link1b/, evals/results/simple/link-targets-261024x/.

Files changed: src/simple-summary.ts (the new paragraph in WHERE EACH PARAGRAPH COMES FROM; SIMPLE_PROMPT_VERSION /13 and its history comment), tests/simple-two-levels.test.ts, tests/simple-summary.test.ts, tests/simple-length-bands.test.ts, docs/project/summaries.md, evals/simple/link-targets.ts.

Check:
1. The prompt wording: does it say what the plan says (support first; prefer the body over the abstract or a front executive summary; never a merely related block; use the front summary where only it makes the point)? Plain words per docs/project/prompting-guide.md. Any conflict with the paperwork rule, the sentence-id rule, or the "paragraph with no id is thrown away" rule?
2. Version handling: /13 outdated-not-stale; inputFingerprint's legacy regex; anything else that compares prompt versions (grep for simple-prompt) that needed changing.
3. Tests: are the pins right, and is there anything a test should now pin that it does not (e.g. that both levels carry the new rule)?
4. evals/simple/link-targets.ts: correctness of the counting (front ranges by block index, first-chip, sentence coverage), the pairs/blinding/seed, and score's unblinding. Does any number in the investigation not follow from the results files? Recompute `npx tsx evals/simple/link-targets.ts table` and `npx tsx evals/simple/link-targets.ts score evals/results/simple/link-targets-261024x/answers.json` (both free, local database read-only) and compare with the investigation's tables. answers-unsupported.json is the second judges' answers; check the 8 vs 8 claim against pairs-key.json.
5. The question file q-r8kumx.md: does it parse (npx tsx scripts/feedback-endings.ts reads it; do not publish) and is every factual claim in it true per the plan and the code (src/matter.ts, src/matter-labels.ts, src/rerun-steps.ts)?
6. Docs: summaries.md's new paragraph accurate?

Run npx vitest run tests/simple-two-levels.test.ts tests/simple-summary.test.ts tests/simple-length-bands.test.ts tests/stage-stamp-agreement.test.ts tests/feedback-endings.test.ts after any fix.

Output: numbered findings with severity (P0/P1/P2), file:line evidence, what you changed (or why not), then a one-line verdict.
