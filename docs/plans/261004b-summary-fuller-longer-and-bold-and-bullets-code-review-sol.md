## Findings

- **F6 — P1 — Established — fixed:** The public DTO forwarded `list: true` for malformed two-sentence lists even though the owner renders them as prose. It now uses `paragraphShape`, so visitors receive list formatting only when it is valid. [dto.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/public/dto.ts:542)

- **F7 — P1 — Established — fixed:** `tallyFormat` validated only the number of verdict IDs. A duplicate plus an unexpected ID could conceal a missing pair and silently count it as a vote for plain formatting. It now rejects duplicate, unexpected, and missing IDs. [fuller-format.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/evals/simple/fuller-format.ts:356)

- **F8 — P1 — Established — fixed:** The free eval report discarded `retriedAfterFlag`, making a fidelity-flagged answer that passed on retry indistinguishable from an ordinary validation retry. It now prints `passed/2 after flag`. [fuller-format.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/evals/simple/fuller-format.ts:56)

- **F9 — P3 — Established — fixed:** The reader-facing empty state still promised generation “usually in under half a minute”; all six after-arm runs took 42.1–70.8 seconds. It now says “usually in about a minute.” [SimplePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/web/SimplePanel.tsx:128)

- **F10 — P1 — Established — not fixed, report-only:** The after arm fails guard rule 3. Two Simple levels were flagged on their first answer, while the declared ceiling is one flagged level across all 18. Both retries passed, but `retriedAfterFlag: true` records the flags. [entropy result](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/evals/results/simple/high-none-fbaza2/entropy-24-00930-spya-pywwkq.json:397), [scaling result](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/evals/results/simple/high-none-fbaza2/scaling-hypothesis.json:389)

- **F11 — P1 — Established — not fixed, report-only:** The after arm fails wait rule 8: median wall time is 55.1 seconds, against the declared 38.3-second ceiling. [ship rule](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md:206)

- **F12 — P1 — Reasoned — not fixed, wider:** The plan responds to any guard failure by shortening Fuller, but both observed failures are in Simple. Shortening Fuller cannot address a regression in the level whose only intended change was formatting. [fallback rule](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md:208)

The nullable `key` schema succeeded in all six real after-arm calls. `simpleKey` and rendering use matching substring semantics; `ANSWER_TOKENS`/`budgetFor` are conservative; no overlooked five-paragraph consumer or false project/help/mode-card statement was found.

Checks: requested suite **219 passed**; added eval regressions **2 passed**; typecheck passed all projects; touched-file Biome check passed with one pre-existing complexity info. Full `npm test` still needs local Postgres. The remaining manual check is desktop/iPad/phone rendering plus bullet hover, jump, and on-screen wash.

**Verdict: Request changes—the narrow implementation defects are fixed, but the candidate fails its declared guard and latency ship gates.**