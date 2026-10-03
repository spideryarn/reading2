# Review: 261003i stage A — the quick-search eval and the wording change it led to

You may **fix what you find inside this stage** (the one-line wording change, its comments and
tests, the investigation's prose and the `search.md` lines about it), narrowly, with a red test for
any behaviour fix. Report anything wider. Do not commit. You have no network: you cannot re-run the
eval, so judge it from its saved raw results.

**Candidate (committed).** Commit `035a2d9c7` on `worktree-fb-search-quick-2610`
(`git show --stat 035a2d9c7`). Its paths:

- `src/quick-search.ts` (the question in `questionFor`, and the comments on it and on `QUICK_FLOOR`)
- `tests/quick-search.test.ts`, `tests/ai-call.test.ts`
- `docs/investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md`
- `evals/results/quick-search-recall-2026-10-03/` — raw results (`jev-raw.json`, `llm-raw.json`,
  `judged.json`, `out-repro*.json`, `out-counterfactual.json`, `summary-*.json`, `latency-jev.json`,
  `spend.jsonl`) and the scripts that made them, saved as `.ts.txt`
- `docs/project/search.md` (§ Quick search, § What is still open)
- the plan's "What landed", `docs/plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md`

Your own plan review of this eval's design is `docs/plans/261003i-quick-search-plan-review-sol.md`
(F4–F7). The earlier spike is `docs/investigations/261002o-quick-search-spike.md`.

## What to do

**Check the conclusion, not only the method.** The conclusion that shipped is: the question's verb
was the cause; "mention or discuss" at floor 0.7, cap 20, is better on one-word topic queries and
no worse on phrases and questions; an ids-only LLM is not worth switching to now.

1. Recompute the headline numbers from the raw files yourself (a small script over `jev-raw.json`
   and the query and target definitions in `queries.ts.txt` / `literal.ts.txt`): literal mentions
   missed on the short set for the shipped wording and for "mention or discuss" at 0.7; the
   held-back set; reference recall on the spike's 16; the absent-topic top scores; blocks kept. Say
   which you reproduced and which you could not.
2. Look for what would make them misleading: targets chosen after seeing results, the held-back
   queries leaking into the choice, a literal-substring yardstick that flatters a "mention" wording
   by construction, junk the new wording lets in that the write-up understates (precision after the
   cap, especially on the spike's phrase and question queries and on long articles), run-to-run
   noise larger than the differences claimed.
3. Check every number quoted in `src/quick-search.ts`'s comments and in `search.md` against the
   investigation and the raw files.
4. Check that no prose from the production article (slug begins `entropy-26-00481`) is in any
   committed file: ids, scores and character counts only.
5. Run `npx vitest run tests/quick-search.test.ts tests/ai-call.test.ts tests/doc-links.test.ts tests/no-undeclared-spend.test.ts`.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A number in a doc or comment that the raw results do not support is P1 if it is the basis of the
shipped change, P3 otherwise. Give every finding an ID (A1, A2, …), a severity, where it rests,
and whether you fixed it. End with a one-line verdict: does the evidence support shipping the
wording change at floor 0.7?

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The eval's author never saw capital-B "Buddhism" score under 0.7 (29 runs, 0.70–0.75), while
  Greg's saved run has zero hits. Rounding at the floor (`p >= 0.7` on an unrounded score, shown
  as 70)? A different model snapshot? Does the explanation hold?
- The yes/no junk judging was done by the eval's author alone.
- "Evolution" on the Entropy article keeps 18–20 blocks on the new wording. Is flooding on broad
  one-word topics worse than the write-up says?
