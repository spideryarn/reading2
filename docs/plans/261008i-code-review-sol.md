Review complete. I recorded six findings in [261008i-code-review-findings.md](/var/tmp/spideryarn-worktrees/fbar65p3-type-sizes-across-modes/docs/plans/261008i-code-review-findings.md) before fixing them.

Fixed:

- Made FAQ’s quote role independent of stylesheet order.
- Narrowed Debate and Mirror selectors so non-role variants are explicit exceptions.
- Added all documented exceptions to the test registry.
- Added representative DOM witnesses so different, more-specific selectors are tested against the actual cascade.
- Corrected `/design`’s role × voice matrix.
- Updated the typography documentation.

Negative controls confirmed the test goes red for:

- A registry selector changed back to a literal.
- A later exact-selector override in another sheet.
- A different, more-specific selector such as `.gloss-term .gloss-name`.

All sabotage was restored.

Checks:

- Focused tests: 67 passed.
- Typecheck: all four projects passed.
- `npm test`: blocked before collection because the sandbox cannot access local Postgres/Docker.
- The database-free unit run also encountered unrelated sandbox failures in subprocess-wrapper tests.
- No browser testing attempted, as requested.
- Scoped lint found only pre-existing findings in unchanged lines.

Wider observations: `readerSheets()` does cover the complete hand-written reading-view import graph; Search’s parent size does not override `.srch-hit-quote`; no registered line has an inline or Tailwind size override; the CSSOM parse guard is sound for the current sheets; and the matrix’s dash cells are accessible.

VERDICT: approve with changes

Files changed:

- `docs/plans/261008i-code-review-findings.md`
- `docs/project/typography.md`
- `src/web/DesignPage.tsx`
- `src/web/styles/debate.css`
- `src/web/styles/faq.css`
- `src/web/styles/referee.css`
- `tests/type-roles.test.ts`