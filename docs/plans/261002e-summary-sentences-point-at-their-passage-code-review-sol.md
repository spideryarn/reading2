Two P1 defects fixed, red-first. Edits and root-cause notes are uncommitted.

- **C1 — P1, fixed:** [simple-summary.ts:367](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/src/simple-summary.ts:367). The strict schema allowed empty sentence lists and blank text that the parser necessarily discards, potentially losing paragraphs or triggering retries. Added `minItems: 1` and a nonblank-text pattern.
- **C2 — P1, fixed:** [SimplePanel.tsx:179](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/src/web/SimplePanel.tsx:179). Rewriting identical words with a different passage reused the anchor, leaving an open card describing the old passage. Keys now include the target and wording.
- **C3 — P1, reported only; preexisting:** [simple-summary.ts:361](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/src/simple-summary.ts:361). `paragraphs` and paragraph `ids` still permit empty arrays despite the parser requiring both. This predates the candidate.
- **C4 — P2, reported only:** [probe.ts:230](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/evals/simple/probe.ts:230). The existing probe records neither retry counts nor guard outcomes, so the plan’s required screens remain unmeasured. Six successful outputs cannot establish zero retries.

Validation: **355 assertions passed across 11 files**, typechecking passed, and lint passed with one existing complexity advisory. All three new regression tests were observed failing before their fixes.

Database-backed owner/public reads, export preservation and persisted pipeline freshness assertions were not run because Postgres is unreachable. Real-browser wrapping and wash behavior remain unverified. No additional regression was found in fallback handling, whitespace, accessibility or Fuller’s token allowance.

**Verdict: in-scope defects fixed; approve the patched change subject to the outstanding database/browser checks.**