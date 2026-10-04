# Code review, round 2: 261004b — the fallback that ships, and the conclusion drawn from the eval

Same worktree and rules as round 1 (`…-code-review-prompt.md`; your answer is `…-code-review-sol.md`,
F6–F12). You may write: fix narrowly inside this change, red first; report anything wider. No git
commands that change state. Number new findings from F13.

## The candidate

Committed: `423aa57dd` (parent `b56d949ce`). `git diff b56d949ce..423aa57dd`; paths from
`git diff --name-only b56d949ce..423aa57dd`. Your round-1 fixes (F6–F9) are in it, taken as you
wrote them apart from F9's wording, which now says "about half a minute" because the shipped arm
measures 30.9 s.

## What changed since round 1, and what to check

1. **F10, F11, F12 → the fallback.** `PITCH.fuller` asks for about 350 words in four to seven
   paragraphs (never more than 430); `KEY_RULE` asks Simple for no key. `SIMPLE_LIMITS.fuller` stays
   3 / 8 / 850 on purpose. Is this a real answer to F10–F12, or does any remain open? Check the
   narrow fix, not the whole change again.
2. **The conclusion.** `docs/investigations/261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md`
   reports arms `fbazb*`, `fbaza*`, `fbazc*` and decides to ship `fbazc`. Recompute what you can
   from `evals/results/simple/high-none-fbaz*/*.json` and
   `evals/results/simple/fuller-format-261004b/` (`npx tsx evals/simple/fuller-format.ts screen`,
   `tally-fidelity …/verdicts-fidelity-sol.txt`, `tally-format …/verdicts-format-sol.txt` all run
   offline) and say whether **each number and each "met / not met" in the write-up is accurate**,
   and whether the decision follows from the ship rule in the plan as declared, including where I
   say rule 1 is not met by design. Am I explaining away an inconvenient result anywhere?
3. **Docs now true?** `docs/project/summaries.md` (§ A longer Fuller, § Bold and bullets, the
   Markdown paragraph), the plan's ledger, `src/simple-summary.ts`'s comments on PITCH and
   `ANSWER_TOKENS`, `/help` in `src/web/help/help-modes.tsx`, the mode card in
   `src/web/modes/summary/SummaryMode.tsx`. Fix wording that is false; report wording that is a
   judgment call.

Run: `npx vitest run tests/simple-summary.test.ts tests/simple-panel.test.tsx tests/public-dto.test.ts tests/simple-fuller-format-eval.test.ts`.

Findings with IDs, P0–P3 by consequence, established or reasoned, file:line, fixed or not. One-line
verdict at the end.
