# Stage 1 code review prompt: shelf topics chosen by a model (260929c)

Reviewer-fixer. **Candidate (committed)**: 10a21a0e — `git show 10a21a0e --stat`. Start with src/shelf-terms/choose.ts (`ChooseOptions.quality`, `candidatePool`), tests/shelf-terms-choose.test.ts, src/spend-declarations.ts (the `shelf-topics-jev` declared bypass and `/api/alpha/decisions` in `PAID_ENDPOINT_PATHS`), evals/shelf-topics/*.ts (jev.ts, run-arms.ts, prompt.ts, make-pairs.ts, derive-jev-floor.ts, summarise.ts), and the plan's § Stage 1 — what the eval found. The per-run lists and raw responses are gitignored (regenerable, and paid to regenerate) — judge the method from the code, the summary, the pairs, the key and the verdicts.

## Please
1. The seam: behaviour-preserving when unset? Can an external quality map produce a wrong result (a topic whose members disagree with membership, a non-deterministic order, a NaN slipping through)?
2. The spend: is every paid call in the eval recorded (the Jev bypass declaration — correct wire/job/metering; the chat arms via `withLedger("eval")`)? Does `tests/no-undeclared-spend.test.ts` actually cover the new file (the author says they pointed the declaration at a wrong path and saw it go red — check the test's logic)?
3. The eval's conclusions: do the numbers in the plan follow from summary.md and the judgements joined to pairs-key.json (you may join them yourself with a short script; don't change the files)? Is the shuffle balanced? Is anything in the method likely to have produced the result (e.g. the candidates each arm saw, the prompt, the floor added post hoc — is it labelled everywhere)? Is the plan's reading — "our greedy costs quality in the score arms" — supported by the lists?
4. Run `npx vitest run tests/shelf-terms-choose.test.ts tests/no-undeclared-spend.test.ts`.
5. Fix narrowly, red first, inside the stage; report anything wider. Do not commit. Do not make paid calls.

## Output
Findings S1-1… with severity (P0/P1/P2/P3), established or reasoned, evidence, what you changed. Test tail. One-line verdict.
