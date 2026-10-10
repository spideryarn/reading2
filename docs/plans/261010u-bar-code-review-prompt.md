# Code review: 261010u — the command bar's suggestions, capped, dismissable, foldable, Guide first

You are reviewing uncommitted work in this git worktree (the current directory). You may edit files
to fix what you find **inside this change's scope**; report anything wider instead of fixing it.
Do not commit, push, run `npm run deploy`, run `npm run db:migrate` or `db:reset`, or touch
`.env.local`, `infra/`, systemd, or any database other than the test lanes the suite builds itself.
Never run a git command that discards work (checkout --, restore, stash, reset, clean, rebase).

## What it is for

Two reader reports (quoted in
`docs/user-feedback/261010_0759-bar-suggestions-four-dismissable-foldable-and-the-guide-first.md`):
the command bar's "Suggest what to do here" list was too long, could not be dismissed or collapsed,
pushed the rest of the bar down, and the Guide chat should be reachable near the top of the bar.

The plan, and how it changed after your own plan review (verdict: rethink, findings F1–F10), are in
`docs/plans/261010u-bar-suggestions-capped-dismissable-collapsible-and-the-guide-at-the-top.md`
(read the whole file, including the "After GPT Sol's plan review" section) and
`docs/plans/261010u-bar-plan-review-sol.md`.

## The evidence

- The full diff: `git diff HEAD` plus the untracked files
  `src/store/pg-suggestion-dismissals.ts`, `drizzle/20261010221230_command_suggestion_dismissals.sql`,
  `drizzle/meta/20261010221230_snapshot.json`.
- Client: `src/web/CommandBar.tsx`, `src/web/command-suggest-client.ts`, `src/command-suggest.ts`.
- Server: `src/routes.ts` (`dismissSuggestion`, `suggestFromWhyReading`), `src/db/schema.ts`,
  `src/store/*`.
- Tests: `tests/command-bar-suggest.test.tsx`, `tests/command-suggest.test.ts`,
  `tests/command-suggest-route.test.ts`, and the registry tests in the diff. Run them with
  `npx vitest run <files>`; `npm run typecheck` is clean now.
- Known and expected: `tests/knip-without-build-output.test.ts` fails while the migration `.sql`
  is untracked (it copies the git checkout). Ignore that one.

## What to look hardest at

1. Does each of your plan findings F1–F10 actually hold in the code, not just in the plan's prose?
2. The upsert in `pg-suggestion-dismissals.ts`: atomicity under concurrent dismissals, the
   fingerprint-change reset, the cap of 50, and that the CHECK constraints refuse what the route
   refuses.
3. Ownership and auth on `POST /api/command-suggest/:slug/dismiss`; that nothing derived from the
   profile (words) is stored or logged, and nothing about dismissals reaches the model.
4. The client: keyboard and screen-reader behaviour of the fold row, Delete, and the pointer-only ×;
   selection after dismiss and after fold/unfold; the optimistic dismissal's rollback; whether a
   dismissal made under one `readFrom` can leak into a list for another.
5. Interleave-then-cap: does the list always keep a mode and the chat question when they exist,
   and does a dismissal backfill correctly?
6. Guide first: that it is the Guide row from the executor and appears exactly once.
7. Anything that reports success while doing nothing (see `docs/reusable/silent-success.md`), and
   any test that could not go red.

## Answer

Start the answer with one line `VERDICT: ship`, `VERDICT: ship after fixes` or `VERDICT: rethink`.
Then numbered findings, each with file:line, severity, what is wrong, and whether you fixed it (and
how) or are leaving it for me. End with the list of files you edited and the test commands you ran
with their results.
