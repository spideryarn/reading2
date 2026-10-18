Revision is required because the measured prompt still leaks model memory into an unlabelled article-only note.

- P1 — [src/relations.ts:521](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/relations.ts:521): putting both arrays in one model call does not enforce the provenance boundary. The shipped arm contains an `explain` note calling Fight Club a film ([w99-after3.json:607](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/evals/results/margin-notes/w99-after3.json:607)), though the article does not say that. It renders as an ordinary Note without “AI memory, unchecked,” violating the zero-leak gate and F1’s requirement to separate calls if leakage remained. Not changed: correcting this requires a redesigned call boundary and paid remeasurement. I corrected the overclaim in [marginalia.md:255](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/project/marginalia.md:255).

- P2 — [261018i plan:151](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261018i-marginalia-notes-that-save-a-click.md:151): the shipped prompt failed its predeclared zero-negatives gate. Three of fourteen origin notes landed on manifest negatives; the blind judge called four redundant. The plan explicitly overrules the gate at line 253, but that is a product-quality trade-off rather than a passing measurement. Not changed: Greg should accept that threshold, or the prompt needs another measured round.

- P2 — [export-bundle.ts:680](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/store/export-bundle.ts:680): exported `relations.json` was described as giving origins without saying `kind: "source"` means unchecked model memory. A recipient could read it as sourced fact. Changed: both README and HTML descriptions now say “AI memory, unchecked,” with a regression assertion in [store-export-bundle.test.ts:605](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/tests/store-export-bundle.test.ts:605).

- P2 — [evals/margin-notes/run.ts:83](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/evals/margin-notes/run.ts:83): the harness recorded `notesDropped` but omitted `sourceNotesDropped`, so gate 7 cannot be established from the committed arms. Changed: future arms record `sourceNote.*`; the report now explicitly prints “origin drops unrecorded” for historical arms, and the plan records the limitation.

Other checks found the caps, shared `taken` set, separate drop counters, strict schema, required keys, and enum exclusion correct. `relations/3` rows remain compatible. Chat and MCP do not expose relation notes; rendered model text remains React text, not markup. The committed measurement counts and agreement percentages match the plan.

Verification:

- 9 focused Vitest files: 246 passed, 1 skipped.
- Typecheck: all four projects passed; all 3,811 TypeScript files covered.
- The export test could not reach its assertion because the local database is unavailable; no database was started or touched.
- `tsx` was blocked by sandbox IPC permissions, so the same scripts were run directly with Node type stripping.
- No models were called.

VERDICT: REVISE