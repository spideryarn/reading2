You are reviewing code in the repo at the current directory (Spideryarn), a git worktree. You may edit files to fix what you find, within this change only; report anything wider instead of fixing it. Do not commit, push, run git commands that change state, or touch the database.

The change: docs/plans/261003d-paperwork-in-every-whole-piece-mode-code-review.diff (the scoped diff, results files excluded). The plan, your earlier plan review and the ledger with the measurements: docs/plans/261003d-paperwork-in-every-whole-piece-mode.md (read § What GPT Sol's plan review changed and § Ledger). The measurement harness: evals/paperwork/modes.ts; its results in evals/results/paperwork-modes/ (the blind pairs and keys are there).

Check, with file:line evidence:
1. Each prompt now carries `paperwork(kind)` exactly once, in the system prompt actually sent, with the right kind; no prompt now gives two conflicting rules (Sketch's apparatus line, Illustrated's per-node rule, Timeline's own-dates rule, Glossary's title/author rule, Quiz's title rule, Arc's first/last-part rules).
2. The final "part" wording for Arc (src/paperwork.ts) — does it now conflict with anything in Arc's SYSTEM? Is the ledger's reason for dropping the label version sound?
3. Stamps: every bumped constant, every test literal and fixture that should move, any client code comparing versions; anything a bump triggers that the plan does not say (spend, staleness, fingerprints).
4. tests/paperwork-coverage.test.ts: was it truly able to go red (the plan says it was red on exactly the nine files first)? Is PAPERWORK_EXEMPT right, file by file? Does the "would reject" test test what it claims?
5. The ledger: does the evidence in evals/results/paperwork-modes support each claim it makes (check the unblinding against the keys; the Arc counts; the "load, not the prompt" claim)? Say plainly if a conclusion is stronger than the data.
Rank findings P0/P1/P2. For each fix you make, say what and where. End with a one-line verdict.
