## Findings

No P0 findings.

- **P1 — [root-flags.ts:92](/var/tmp/spideryarn-worktrees/fbk3g78t-dialog-scroll-and-send/src/web/root-flags.ts:92):** `useLayoutEffect` ran after descendant layout effects, allowing children to measure stale CSS variables on first render. Reproduced with a failing ordering test. Changed flags to `useInsertionEffect`, before layout measurement, and updated the plan.

- **P2 — [SkipToModes.tsx:47](/var/tmp/spideryarn-worktrees/fbk3g78t-dialog-scroll-and-send/src/web/reader/SkipToModes.tsx:47):** the root lease used passive cleanup, so it could outlive the dock’s own `data-skip-arrived` marker by one paint during navigation. Changed cleanup to `useLayoutEffect` and added an ordering regression test.

- **P2 — [no-document-wide-has.test.ts:138](/var/tmp/spideryarn-worktrees/fbk3g78t-dialog-scroll-and-send/tests/no-document-wide-has.test.ts:138):** the guard missed case variants, nested `&` selectors, and `:scope` rooted at `.reader`; it also incorrectly flagged component subjects containing `#root` only as an ancestor and `@supports selector(...)` feature checks. Tightened subject parsing and added positive and negative fixtures.

No further issues found in flag ownership, focus cleanup, public/design routes, StrictMode, or specificity. The rewritten selectors preserve their old weights and source-order behaviour.

## Files edited

- `src/web/root-flags.ts`
- `src/web/reader/SkipToModes.tsx`
- `tests/root-flags.test.tsx`
- `tests/no-document-wide-has.test.ts`
- `tests/skip-to-modes.test.tsx`
- `docs/plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md`

## Tests

- All 21 changed non-browser test files: **718 current tests passed**.
- Two Chrome-backed files: **6 tests environment-blocked** because Chrome exited before opening a page; Crashpad’s socket call received `EPERM`.
- `npm run typecheck`: blocked by the same sandbox socket restriction in the `tsx` CLI.
- `node --import tsx scripts/typecheck.ts`: **passed**, all four projects and all 4,099 source files covered.
- Targeted lint: passed with one informational complexity advisory on the existing selector parser.
- `git diff --check`: passed.