1. **P2 — Eval results could silently be scored against a different article revision.** The script used current database block indexes without comparing them to each arm’s recorded `articleHash`. Fixed by rejecting revision mismatches and missing linked blocks in [link-targets.ts](/var/tmp/spideryarn-worktrees/fbhnw9xq-summary-links-body/evals/simple/link-targets.ts:68).

2. **P2 — The investigation reported four test-pair ties; the score has two.** The 14–4 result is correct: Brief is 8–2 and Fuller is 6–2 with two ties. Corrected [the investigation](/var/tmp/spideryarn-worktrees/fbhnw9xq-summary-links-body/docs/investigations/261024f-summary-links-to-the-body-or-the-abstract-measured.md:45).

3. **P2 — “Mostly” unsupported third passages was false.** `answers-unsupported.json` and `pairs-key.json` give 8 old and 8 new unsupported links, but only 2 of the new 8 are uncited third passages. Block 53 occurs three times on each side. Corrected [the investigation](/var/tmp/spideryarn-worktrees/fbhnw9xq-summary-links-body/docs/investigations/261024f-summary-links-to-the-body-or-the-abstract-measured.md:51).

4. **P2 — Minor auditability issues.** Expanded three assignment-in-expression lint errors in the eval and updated the stale `/10`–`/11` freshness-test description to cover all later prompts in [simple-two-levels.test.ts](/var/tmp/spideryarn-worktrees/fbhnw9xq-summary-links-body/tests/simple-two-levels.test.ts:374).

The prompt matches the plan and conflicts with neither paperwork nor paragraph/sentence-ID rules. `/13`, legacy fingerprinting, prompt hashes, both-level coverage, the question file, and `summaries.md` are correct. The score recomputed as 14–4 with two ties; the second judges’ 8–8 claim also checks out.

Checks: 255 focused tests passed; TypeScript passed; scoped lint has no errors. The table command could not reach local PostgreSQL because this sandbox denies the connection (`EPERM`), so its front-range totals were audited from code/results but not re-executed here.

**Verdict: Pass after fixes; no P0/P1 findings remain.**