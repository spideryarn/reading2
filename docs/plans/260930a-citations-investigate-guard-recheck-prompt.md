# Narrow re-check: the in-stream quote guard's final version (read-only)

Read-only; change nothing. Scope is ONE file and its test: src/investigate-quote-guard.ts and tests/investigate-quote-guard.test.ts at commit cc2a26f4. Its history: stage-1 build, then your C-1 fix (d398d30e, plural possessive leak), then your D-1 fix (cc2a26f4, `‘fitness’ is` was refused). House rule: a P0 whose final fix was not in a reviewed snapshot gets a narrowly scoped check of that fix. This is that check; discovery is otherwise closed.

The property: no quote-shaped span (from `"`, `“`, `‘` to its close, or a `>` line) that is not found in the allowed texts may ever appear in the guard's output, under ANY chunking of the input. Secondary: common legitimate prose must not be refused (the authors’ claim; ‘fitness’ is; what’s; a closing ’ at a sentence end; ‘Principia’, then).

Do: read the code; run `npx vitest run tests/investigate-quote-guard.test.ts`; try to construct a counterexample for the property, and if you can, write it as a failing test in your answer (text only — do not edit files). Report: counterexamples found (with the input and chunking), legitimate-prose refusals found, and a verdict: "property holds as far as I can tell" or "broken: …". IDs G-1…, severity P0..P3.
