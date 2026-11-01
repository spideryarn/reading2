You are reviewing the code and write-up of an eval, and may fix what you find within its scope.

Plan: docs/plans/261101a-citations-every-work-cheaply-with-haiku.md (and its review, 261101a-plan-review-sol.md).
Write-up: docs/investigations/261101a-citations-recall-haiku-vs-sonnet-prompt-eval.md.
Question to Greg: docs/user-feedback/questions/q-ns76uq.md (plain text, no markdown; read docs/project/feedback-reports.md § Asking Greg a question for its rules).

Code:
- src/bibliography.ts: `git diff HEAD -- src/bibliography.ts` — an eval-only `cap` option on buildBibliography / keepLeanedOnMost. Production must behave exactly as before when it is not passed.
- evals/citations-recall/run.ts (the paid runner), prompt.ts (the candidate prompt, built by replacing exact passages of production's systemPrompt()), score.ts (scoring: buildBibliography three ways, maximum one-to-one matching), union.ts, why-pairs.ts, build-truth.py + ay.py (the truth builder; its block dumps are not in the repo).
- Results: evals/results/citations-recall/261101a/<arm>-<run>/<slug>.json (raw answers), scores.json, why-pairs.json, why-key.json; truth in evals/results/citations-recall/261101a-truth/.

Do NOT call any model or run run.ts (that spends money). score.ts, union.ts and why-pairs.ts are free and may be run (they need the local Supabase; `npx tsx evals/citations-recall/score.ts`).

Look hard for:
1. Scoring bugs that would flatter or penalise an arm: the matcher (score.ts `match`, `surnameYear`, `entryNumber`, `fromEntry`), the reference-block uniqueness rule, aliases, ambiguous keys, list-only classification, failed/truncated answers counted as zero. One bug was already found and fixed (places use `blockId`, not `block`) — look for others of that kind: a check that silently matches nothing.
2. Whether the request in run.ts really is production's generateBibliography request apart from the three declared differences (model, system prompt, max_tokens).
3. Whether the investigation's numbers match scores.json and the raw files, and whether any claim in the write-up or the question overreaches the evidence.
4. The src/bibliography.ts change: any production behaviour change; tests.

Fix real defects in the eval code (and re-run score.ts if you change scoring, then update the write-up's numbers to match). Do not edit the question file or src beyond fixing a defect. Write your findings, numbered, with severity and what you changed, to your answer.
