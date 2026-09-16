Review complete. Findings are recorded in [260916d-faq-mode-code-review-2-findings.md](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode-code-review-2-findings.md).

Fixed:

- D1 P1 — added a read-only retry for failed FAQ GETs in [useFaq.ts](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/web/useFaq.ts:51) and [FaqPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/web/FaqPanel.tsx:134). It never starts a model job and preserves an existing list during failed revalidation.
- D2 P1 — FAQ questions now use `h2`, matching the article’s heading hierarchy.
- D3 P3 — replaced the card’s duplicated foot disclosure with the non-obvious reading-order rule in [mode-catalog.ts](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/mode-catalog.ts:463).
- D4 P2 — strengthened [faq-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/tests/faq-panel.test.tsx:227) to distinguish unforced `ensure` from forced `regenerate`.

Reported only: none.

Not defects after review:

- Stale winning when stale and outdated are both true is deliberate; one forced rerun repairs both, and sibling modes use the same precedence.
- The dropped count is honest enough: it explicitly counts “questions or passages” and usefully discloses validation loss.
- Visitor isolation, experimental gating, `ModeBoundary`, `BlockRef` wiring, and FAQ-prefixed CSS were correctly implemented.

Mutation results:

- Changing every panel button to forced regeneration left all 13 original panel tests green, confirming D4. The strengthened test now catches it.
- Removing FAQ’s `useAutoRun` call failed exactly the new FAQ auto-run test: no POST was recorded instead of `steps: ["faq"]`.

Verification:

- Targeted FAQ and auto-run tests: 39 passed.
- Stage scope: 580 passed; one infrastructure failure because sandbox policy denied the test’s `spawnSync git`.
- Typecheck: all four projects green, covering 2,208 source files.
- Touched paths produced no lint diagnostics. Whole-tree lint remains red on the existing baseline of 175 errors.
- `git diff --check`: clean.
- Full suite could not initialize because Postgres/Docker is inaccessible in this sandbox.
- No real-browser visual/jump check was possible; the jsdom jump assertion passes.
- No commit made.