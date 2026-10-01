# Code review: plan 261001a, stage 3 — *Investigate* reads the cited paper

You are GPT Sol. You reviewed the plan (`docs/plans/261001a-citations-read-the-paper-plan-review-sol.md`)
and the code of stages 1, 2 and 4, which are committed. Stage 3 is uncommitted in this tree; the whole
change is `docs/plans/261001a-stage-3-code-review.diff` (read the files themselves for context).
The spec is § Stage 3 of `docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md`.
The reader-facing description the builder drafted is `docs/plans/261001a-stage3-doc-draft.md` — check
that every claim in it is true of the code.

This is a **paid model path with a reader waiting**, reading **a stranger's document**, and adding
**schema** (an additive migration the Overseer applies to production before the code ships). Weight
accordingly.

The builder's decisions the plan did not settle — judge each:

1. Passages `null` = the call failed; `[]` = none survived the check; the row says each differently.
2. The global daily cap drops from 55 to 50 presses: the worst press is now $0.395
   (`INVESTIGATE_PRESS_BUDGET_USD`), and 55 × that is over the $20 ceiling.
3. The lease adds `PAPER_REGISTRY_MS` = 30 s for the registry lookup before the paper's own 25 s.
4. A malformed entry in a well-shaped answer is dropped and counted; more than 3 entries or the wrong
   shape keeps no passages and the press goes on.
5. If `readPaperEvidence` throws (our fault), the press fails.
6. Passages show only when the answer is opened. The *Investigate* card copy was rewritten, because
   "never fetches the paper itself" is now false.
7. The `not-confirmed` reason is not stored.
8. `untrusted()` moved from `chat-tools.ts` to `src/untrusted-fence.ts` (re-exported) to avoid an
   import cycle.
9. No test proves `PAPER_SELECTION_VERSION` is part of the fingerprint.

Look hardest at:

- **Can any words reach the reader as the paper's that code did not find in the chunk named?** Check
  the passages path end to end — parse, `verifyPassage`, store, row mapping, SSE, the view. Also check
  that the stream's guard and allowed texts are truly unchanged.
- **Can the prose claim the paper was read when it was not**, given what the prompt is told in each
  state?
- **Prompt injection from the paper's text** reaching either call: fencing, the reminder, delimiter
  defusing, no tools.
- **Money and time**: the allowance taken before any spend, the lease covering the longest press, the
  passages call bounded (tokens, deadline), the cost recorded on the ledger under its own job, nothing
  run twice on a retry.
- **The migration**: additive, nullable, and its CHECKs. Would they reject a row the code writes, or a
  legacy row? Safe ahead of the code on production?
- **Owner-only**: nothing new reaches the public projection or a visitor; all three exports carry the
  columns.
- The composition root really wires the real `lookupWork` and `readPaperEvidence`.
- Tests that could not fail.

**You may fix what you find** (sandbox workspace-write) in this stage's files; run `npm run typecheck`
(or `node --import tsx scripts/typecheck.ts` if the socket fails) and the affected tests by path. Do
not commit. Do not touch `src/citations.ts` or `docs/project/citations.md`. Findings as id (C-1 …),
severity (P0–P3), evidence file:line, and what you did. End with a verdict.
