# Code review (stage 2, client) + narrow check of C-1: Citations' Investigate — review AND fix

Reviewer-fixer in this worktree. Under review: commit fc062e16 (`git show fc062e16`, the client) against the spec docs/plans/260930a-citations-investigate-one-work-on-demand.md (§ UI, § No quotes from sources, § Which result is the work, § What was read, Sol Q-4), and the server it talks to (src/citation-investigate.ts, the investigate route in src/routes.ts, src/types.ts).

ALSO, narrowly: your own stage-1 fix C-1 in src/investigate-quote-guard.ts (commit d398d30e) is unreviewed code. Check only that fix: can any quote-shaped span not found in the allowed texts still reach output, across every chunk split? Does it now refuse legitimate common prose (e.g. `the authors’ claim`, `‘fitness’ is`, a closing `’` at the end of a sentence)? Run tests/investigate-quote-guard.test.ts yourself and add adversarial cases if you find a hole.

Fix inside these narrowly and red-first; report anything wider without fixing. Don't commit. You can run unit tests (`npx vitest run <file>`): tests/citation-investigation-view.test.ts, tests/citations-investigate-client.test.tsx, tests/citations-panel.test.tsx, tests/citation-hover-card.test.tsx, tests/investigate-quote-guard.test.ts. No network/loopback for you.

Client things to look hardest at:
1. On `error`, is the WHOLE streamed text replaced (never a cut-off answer left on screen) — including when the fetch dies mid-stream without an error frame, and on abort? Is an earlier stored answer restored with the "not kept" line, and never shown as if it were the new one?
2. Is the provenance line exactly as true as the stored fields allow (N, hosts, longest words, the matched vs unconfirmed line)? Anything claimed that the record doesn't carry?
3. Owner-only: can a visitor's row ever show the button or an investigation?
4. Streaming render: plain text only (no HTML injection from the model's answer or source titles); source links safe (http/https only), new tab with rel=noopener.
5. One-at-a-time, abort on leave, re-read after failure; the moved `readAnswerStream` unchanged in behaviour for the glossary.
6. ControlTip copy: true on every surface (touch included), plain words.

Severity P0..P3; IDs D-1, D-2, …; file:line; problem; what you changed or "reported, not fixed"; the red→green test. Verdict: approve / approve with the fixes made / changes needed.
