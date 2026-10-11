# Code review: Referee › Notes (261011f)

You are GPT Sol, reviewing **and fixing** the code for one stage, in this worktree
(`/var/tmp/spideryarn-worktrees/fbh5aypq-referee-notes-skeleton`). Fix what is inside this stage,
narrowly and red-first (a test that fails before your fix). Report, do not fix, anything wider you
notice. Do not run any git command that commits, resets, stashes, checks out or rebases; leave your
changes in the working tree for me to read.

## The candidate

Committed. Base `e2a006517` (the plan), candidate `71bb89bbf`:

    git diff e2a006517 71bb89bbf
    git diff --stat e2a006517 71bb89bbf

Start with (this list does not limit scope):
- `docs/plans/261011f-referee-outline-your-notes-sorted-major-and-minor.md` — the plan, your own
  plan review (`261011f-referee-outline-plan-review-sol.md`) and how each finding was settled.
- `src/web/referee-notes.ts`, `src/web/RefereeNotesPanel.tsx` — the pure module and the panel.
- `src/web/modes/referee/RefereeMode.tsx`, `src/web/reader/Reader.tsx` — wiring.
- `src/web/useComments.ts` (`sort`), `src/routes.ts` (`/severity` route),
  `src/store/pg-comments.ts` (`patchSeverity`, `toComment`), `src/store/contracts.ts`,
  `src/store/export.ts`, `src/db/schema.ts`, `drizzle/20261011022926_comments_severity.sql`.
- Tests: `tests/referee-notes.test.ts`, `tests/referee-notes-panel.test.tsx`,
  `tests/comment-severity.test.ts`, and the three edited referee tests.
- Docs: `docs/project/referee-mode.md` § 4. Notes, `docs/project/comments.md`, the two help pages.

## What I ran (your sandbox has no network or Postgres, so these are mine)

- `npm run typecheck` — clean, all four projects.
- `npx vitest run tests/comment-severity.test.ts` — 12 passed (Postgres lane; covers 400 on missing
  key and bad values, 404, null un-sorts, `updatedAt` untouched, `severity_at` stamped, create
  ignores `severity`, resent Save keeps the sort, DB CHECK, rollback export).
- `npx vitest run tests/referee-notes.test.ts tests/referee-notes-panel.test.tsx` — 8 and 10
  passed; mutations (swapping major/minor; removing Copy's `disabled={saving}`) each went red.
- `tests/referee-mode.test.ts`, `referee-notices`, `referee-tooltips`, `pressing-a-chip-arms-it`,
  `command-bar-sub-modes`, `referee-copy-is-about-the-model`, `voices-css`, `doc-links`,
  `help-corpus` — all pass.

You can run the unit-lane tests yourself: `npx vitest run --project unit tests/referee-notes.test.ts`
and `npx vitest run tests/referee-notes-panel.test.tsx`.

## Independent pass

Look for: correctness bugs; anything a model wrote reaching the copied text; a wrong state the
types allow; the per-comment write queue and the panel's pending count (a sort that rejects, two
quick presses, unmount mid-sort); load-state handling; accessibility of the toggle pair and the
live region; CSS that breaks at narrow widths or in the voices/typography checks; docs that say
something the code does not do; anything that should have heard about a new comment field or a
sixth Referee sub-mode and did not.

Severity scale: P0 (wrong/unsafe), P1 (should fix), P2 (worth doing), P3 (nit). ID every finding
(C1, C2…), say file:line, say whether you fixed it (and with which test), and end with a one-line
verdict: LAND / LAND AFTER FIXES / DO NOT LAND.

## My own doubts (only after your independent pass)

- `useComments.sort` returns the queue's promise; does it ever reject (so `.finally` in the panel is
  enough), and does it settle if the component that queued it unmounts?
- `RefereeNotesView` gets `blocks` as `Block[]` and passes `[...blocks]` into `orderComments`,
  now generic; is `orderComments<T>` still right for its other callers?
- The Summary heading is kept bare against your F2; say if you still object, with reasons.
