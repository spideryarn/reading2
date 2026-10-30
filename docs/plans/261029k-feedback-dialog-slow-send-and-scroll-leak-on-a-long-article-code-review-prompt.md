# Code review prompt: plan 261029k, stage 1

You are reviewing, and fixing inside the stage, the code built from
`docs/plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md` (read it, and
your own plan review beside it, `…-review-sol.md`). The working tree is uncommitted; the diff
against HEAD is the stage. Read it with `git diff HEAD -- src tests docs`, and the new files
(`git status --short | grep '^??'`): `src/web/root-flags.ts`, `src/web/band-root-flags.ts`,
`tests/root-flags.test.tsx`, `tests/band-root-flags.test.tsx`, `tests/band-back-chip-flag.test.tsx`,
`tests/install-hint-flags.test.tsx`, `tests/no-document-wide-has.test.ts`,
`tests/feedback-earlier-still-while-hidden.test.tsx`.

What it does:

1. `StillWhileHidden` in `src/web/FeedbackDialog.tsx` stops the hidden Earlier tab re-rendering.
2. Every `:root`/`html`-anchored `:has()` in the client CSS becomes a `data-*` attribute on `<html>`
   set by the component that renders the element (`useRootFlag`, ref-counted, layout effect), with
   focus-within reconciled by `trackFocusWithin`. Specificity is meant to be preserved exactly
   (doubled attributes); the shell.css `--bar-bottom` ladder and narrow-window.css's dock guard
   depend on it.
3. `.reader:has(table…)` takes `>`.
4. `tests/no-document-wide-has.test.ts` refuses the class.

Look hardest for:

- **A flag whose truth differs from the selector it replaced**, in any state: StrictMode double
  effects, the element rendered by a path that does not hold the flag (or held while the element is
  absent — hidden, `display:none`, unmounted under a Suspense fallback, the error fallback), two
  owners, `/design` and the public chrome (PublicChrome.tsx) where there is no `.reader`, SSR or
  first paint if any.
- **Specificity**: for every rewritten rule, old weight vs new, and whether a rule that used to win
  a tie still wins (source order included).
- **Focus tracking**: leaks of listeners/observers, a flag stuck on after the element is removed
  while focused, the departure from `matches(':focus-within')` (the comment explains why).
- **The SkipToModes lease** lifetime against the dock's own `data-skip-arrived`.
- **The class test**: can a document-wide `:has()` still slip past it? Is anything wrongly flagged?
- Tests that could not fail.

Rules for you: fix what you find inside this stage, directly in the files; keep the code's style and
comment density. Do not commit, do not run git commands that discard work (checkout --, restore,
stash, reset, clean). Do not touch `.env.local`, `infra/`, systemd. Run `npm run typecheck` and the
suites you touch (`npx vitest run <files>`); the full suite takes over 10 minutes, so do not run it.
Report anything wider than the stage rather than doing it.

Answer with: findings ranked P0/P1/P2, each with file:line, what is wrong, and what you changed (or
why you did not); then the list of files you edited; then the test commands you ran and their
results.
