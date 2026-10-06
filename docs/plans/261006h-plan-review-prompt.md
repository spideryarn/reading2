# Review: plan 261006h (nothing is built yet)

You are a read-only reviewer. Change no file.

## The candidate

- `docs/plans/261006h-browser-storage-keyed-by-reader-and-the-feedback-switch-test.md`, untracked,
  in this worktree. Base is `8ad8fa8a3`. No code has been written.
- The code it proposes to change: `src/web/last-view.ts`, `src/web/modes/search/stored-pairs.ts`,
  `src/web/modes/search/auto-thorough.ts`, `src/web/lib/made-for.ts` (read only),
  `scripts/seed-accounts.ts`, `scripts/db-seed-owner.ts`, `scripts/browser-sign-in.ts`,
  `tests/feedback-dialog-has-its-reader.test.tsx`, `src/web/App.tsx`, `src/web/FeedbackButton.tsx`.
  Start there; it does not limit scope.
- Background: `docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md`,
  `docs/plans/261006f-reader-bound-code-review-sol.md` (your finding C7), `docs/project/auth.md`.

## What to do

Attack the plan independently first: is each proposed change sufficient and correct against the
code as it is, does it break anything a single-reader browser does today, and is anything missing
that the two queue items (quoted at the top of the plan) ask for? Read the code the plan's claims
rest on rather than trusting the plan's account of it.

Severity: **P0** data loss or cross-reader exposure the plan introduces; **P1** the plan as written
would not do what it says, or breaks existing behaviour; **P2** a real but minor gap; **P3** wording.
Give every finding an id (F1, F2, …), say whether you established it from the code or reasoned to
it, and end with one line: `VERDICT: approve` / `approve with changes` / `rework`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Is `useMadeFor()` the right source of the reader inside `useLastView`? It is frozen at mount;
  is `ArticlePage` remounted when the reader changes, and is it inside the provider on the public
  (signed-out) routes?
- Adopt-then-delete for the legacy last-view key versus dropping it: is the reasoning about
  `claimFirstOpen` right, and is the one-time inheritance acceptable?
- Two tabs racing the legacy adoption.
- The second seeded account sharing the admin's password file, and `db-seed-owner` being run from a
  worktree against the shared local database.
- Whether a sibling browser-storage key with the same defect exists that the plan misses (grep
  `localStorage` / `sessionStorage` under `src/web`), and which of those hold a reader's words.
