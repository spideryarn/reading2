1. **F1 — P2 — FAQ passage suppression could hide distinct words** — [stop-card.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/stop-card.ts:240)  
   Symmetric containment treated a longer FAQ passage containing the shorter stop quote as already visible, hiding part of the answer. It also could not distinguish repeated identical text within one block. Changed matching to use stored source offsets when available and require the entire FAQ passage to lie inside the stop quote. Legacy Quotes retain a directional, normalized-text fallback. Added both regressions to [stop-card.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/tests/stop-card.test.ts:197).

The 40-character floor is reasonable as a conservative legacy fallback, but not as proof of identity; current Quotes’ offsets now provide that proof. Exact legacy matches still bypass the floor.

No findings for the shorter FAQ tooltip, wrapped chips, or sparkline sizing/padding.

Checks:

- Requested Vitest suite: **108 passed**
- `npm run typecheck`: attempted; sandbox rejected `tsx`’s IPC socket with `EPERM`
- Equivalent `node --import tsx scripts/typecheck.ts`: **all 2,334 files covered and clean**
- Scoped lint: clean; one pre-existing informational suggestion
- Scoped `git diff --check`: clean
- No database, server, index, or history changes

**Verdict: approve after F1 fix.**