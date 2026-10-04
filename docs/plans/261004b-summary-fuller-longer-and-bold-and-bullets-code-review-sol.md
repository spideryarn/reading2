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

## Round 2 — fallback and eval conclusion

### Findings

- **F13 — P3 — Established — fixed:** The eval write-up miscounted the keys and rounded two cost
  claims incorrectly. The six long results contain 63 kept keys and 2 refused keys (63/65 kept),
  while the six shipped results contain 38 kept and 1 refused (38/39, 97% kept), not 2 of 51 and
  43 of 44. The 18 stored `costUsd` values total $4.604822, and the shipped range ends at
  $0.2751296, so the prose now says about $4.60 and the table $0.24–0.28. This does not change rule
  6's `met` result. [investigation](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/investigations/261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md:46)

- **F14 — P3 — Established — fixed:** Two source comments still described the rejected first arm as
  the shipped `simple-prompt/7`: about twice the old length, with keys at every level. They now say
  that the shipped prompt asks for about half as much again and keys only in Brief and Fuller; the
  limits comment now records why the deliberately generous 3 / 8 / 850 contract remains.
  [simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/simple-summary.ts:168),
  [types.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/types.ts:5325)

### F10–F12 and the declared ship rule

F10, F11 and F12 are closed by the fallback. The shipped arm has one first-answer flag in 18 levels,
exactly the declared ceiling, no stored flag, and a 30.9-second median, 4.6 seconds over the
26.3-second baseline and below the 38.3-second ceiling. Removing Simple's key request is a targeted
answer to F12; the remaining Simple flag means these six presses do not establish that keys caused
the earlier two flags, but causation is not required by the declared gate.

The decision follows the rule as written. The long arm met rules 1, 2, 4, 5 and 6, failed rule 3
(two flags) and rule 8 (55.1 seconds), and rule 7 was measured only on the eventual shipped arm.
Rule 3's failure explicitly calls for shipping formatting with a smaller, about-350-word length
step. That fallback necessarily falls below rule 1's original 406-word floor, so reporting 374 words
and `not met as first written, by design` is the transparent consequence of the predeclared fallback,
not an after-the-fact exception.

For the shipped arm, every stated gate result is accurate after F13: rule 1 is not met under the
original threshold; rules 2–8 are met. The other levels are inside their ±20% bands; fidelity is
0.92 unsupported sentences per 100 words with 3 serious-bearing Fullers, against before-draw rates
of 1.76 and 1.33 and 4 serious-bearing Fullers; repeated plus filler is zero; formatting wins 6–0
at each level; and the corrected key survival is 38/39. The remaining medians, ranges, paragraph
counts, list counts, guard counts, fidelity counts, example word counts and 12–0 formatting tally
all reproduce from the stored JSON, keys and verdict files.

The sentence that the entropy paper's one flag “looks like its ordinary rate” is an explicitly
hedged interpretation, not a measured conclusion from this six-press arm. It is not being used to
waive a failed rule—the rule permits one flag—and the next sentence discloses both the one-in-six
rate and the before arm's zero. I do not find an inconvenient result being explained away.

### Documentation audit

The named project documentation is true after F14. `summaries.md`'s roughly half-again length,
350/430 prompt, 3 / 8 / 850 stored contract, Brief-and-Fuller keys, Fuller-only lists, and no-Markdown
claim all match the code. The plan ledger's numbers and fallback account reproduce. `PITCH` and
`ANSWER_TOKENS` are accurately described: the prompt asks 350/430 while the answer budget remains
conservatively sized from the 850-word stored ceiling. `/help`'s “several times longer” is a copy
judgment, but the six paired outputs are 3.4–4.8 times as many words as Brief, so it is defensible.
The mode card's “longer and more detailed” and the docs' “the text was good” are qualitative product
judgments, not contradicted factual claims.

Checks: requested suite **221 passed**; all three offline reports reproduced through
`node --import tsx` (the `npx tsx` CLI could not open its IPC socket in this sandbox); typecheck
passed all projects; touched-file Biome check passed with one pre-existing complexity info. Full
`npm test` could not start because local Postgres at port 54362 is unavailable.

**Verdict: Approve—the fallback closes F10–F12 and follows the declared ship rule; the only new findings were corrected reporting and comment inaccuracies.**
