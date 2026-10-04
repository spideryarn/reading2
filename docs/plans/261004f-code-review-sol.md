The candidate is safe to ship with the fixes below. F1–F6 are closed: current stamping makes unforced runs converge and Metadata current; `/4` is the safe floor; newer versions refuse; rewrite copy covers incompatible prompts; and zero-add feedback is correctly gated.

Findings:

- **F7 — P1 — established — fixed.** An older cached response without `panelRun` labelled every non-stale list “Find more”, including incompatible `glossary/1` lists that the server would replace. Restored the conservative `stale || outdated` fallback in [GlossaryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtry2v7-glossary-find-more/src/web/GlossaryPanel.tsx:389). The regression test failed red with “Find more” before the fix: [glossary-find-more-keeps-the-lists-profile.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtry2v7-glossary-find-more/tests/glossary-find-more-keeps-the-lists-profile.test.tsx:256).

- **F8 — P1 — established — fixed.** Help claimed replacement happened only after an article or profile change, omitting incompatible saved-list versions. It now explains all three cases plainly in [help-modes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtry2v7-glossary-find-more/src/web/help/help-modes.tsx:197), with a red-first check in [help-page.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtry2v7-glossary-find-more/tests/help-page.test.tsx:238).

- **F9 — P2 — established — fixed.** Comments gave the wrong reason for the `/4` boundary, claiming it was simply the first version with today’s source hash. The hash changed during `/3` without a version bump; `/4` is safe because it is the first version guaranteed to use the new hash. The functional boundary was already correct, but the false rationale could invite an unsafe relaxation. Corrected in [glossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbtry2v7-glossary-find-more/src/glossary.ts:479), [glossary.md](/home/greg/code/spideryarn2/.claude/worktrees/fbtry2v7-glossary-find-more/docs/project/glossary.md:217), and its tests.

- **F10 — P3 — established — fixed.** Several comments and documentation sentences generalized from “appendable older list” to every older list, or said every pass asks for more although rewrites and first passes do not. Those statements now distinguish appendable lists and append passes.

On the stated suspicions:

- `lastAdded` cannot become negative for a valid stored list. `dedupe` only appends or replaces output rows; it never removes an emitted incumbent, and stored lists have already passed through that same dedupe path. A fresh bridge can enrich one old row but cannot collapse two old rows.
- A legacy list with `passes > 1` and no `lastAdded` shows no result line because the condition is strictly `lastAdded === 0`.
- An unforced outdated appendable list appends once, receives the current stamp, then skips.
- JSONB storage, rollback export, downloadable export, and offline caching preserve the new fields whole. The public projection deliberately omits them. `rewrite-hold` remains valid because appends update `generatedAt`.

Verification:

- Requested suite: 7 files, 279 tests passed.
- Help regression suite: 26 passed.
- Public DTO/offline seams: 4 files, 145 tests passed.
- Typecheck passed for all four TypeScript projects via `node --import tsx scripts/typecheck.ts`; the npm wrapper itself hit a sandbox IPC permission error before checking.
- Scoped lint: no errors; three existing informational complexity/fragment diagnostics.
- The Postgres-classified export suite was not run because the harness correctly refused without a database; that seam was inspected directly.
- `git diff --check` passed.
- No commit made.

VERDICT: ship with the fixes I made