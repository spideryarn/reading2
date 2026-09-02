# Review: `npm run dev` now defaults to the Postgres store

Repo: `/home/greg/code/spideryarn2`. Please review the change below **as code**, not as a plan. It
is small and already tested by hand; I want to know what I got wrong.

## Why this change exists

A now-fixed bug (`docs/postmortems/260902c-the-truncation-retry-cost-storm.md`, plan
`docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md`) cost real money:
the **filesystem** job queue kept its mutual-exclusion state in a module-scope `Map`, a Vite dev-server
restart made a fresh copy of the module, and the same eight-minute model call ran several times
concurrently. Aggregating the ledger afterwards put the waste at **$10.47–$10.81 of $31.22 — a third
of all spend we have ever made.**

The process-scope fence that fixed it does not cover **several OS processes over one `data/`
directory**, which is real (three `vite` servers from this checkout at once). You reviewed that work
and made it a P1, recommending: *"make `npm run dev` use Postgres by default, or refuse multiple
files-mode servers over one checkout."* The Postgres queue has never had the bug — its claim is one
atomic `update … where status = 'queued'`.

Greg has now chosen the first option: *"We want to move towards using the database instead of files,
so probably it does make sense for npm run dev to use Postgres by default."*

## The design decisions taken, and what I deliberately did not do

1. **Only the `dev`/`dev:pretty` npm scripts move. `src/store/live.ts` is untouched — unset still
   means `files`.** So the CLI stages, seeding scripts, evals and the whole test suite are exactly
   where they were; only the dev and preview servers moved. Flipping `storeFromEnv`'s default itself
   would break `tests/store-selection.test.ts` outright and flip the effective store for ~112 test
   files that never set the variable (about twenty of which write fixtures into `data/<slug>/` and
   read them back through `src/routes.ts`). That is a separate job belonging to
   `docs/plans/260831b-finish-the-database-move.md`.
2. **A soft default (`${SPIDERYARN_STORE:-postgres}`), not a hard set.** A hard set would silently
   discard `SPIDERYARN_STORE=files npm run dev`, which is the failure class this repo keeps writing
   postmortems about — and `src/store/live.ts` already refuses to guess a misspelled value for the
   same stated reason. Verified empirically that npm's `sh` expands it: unset → `postgres`, explicit
   `files` → `files`.
3. **A boot-time `select 1`.** The existing guards read *settings*: `src/store/index.ts` throws when
   the Supabase Storage variables are missing, `getDb()` explains an absent `DATABASE_URL`. But with
   every setting present and the containers merely **stopped**, nothing threw — the server booted
   clean and died with a raw connection error on the first `/api` request. `vite.config.ts` states as
   its own anti-goal that "a store misconfiguration must not first show up as a 500 on somebody's
   first request", and the new default makes that state routine for a fresh checkout. So the probe is
   in `createApiMiddleware`, which both `configureServer` and `configurePreviewServer` await, and
   which `apply: "serve"` keeps out of any build.
4. **`cause` before `message` in the probe's error.** Drizzle wraps a failure as `Failed query:
   select 1`, which names what we asked and not what went wrong — the `ECONNREFUSED` a person needs
   is on the `cause`.

## What I verified, and how

- **Red, by mutation**: with `sql\`select 1/0\`` the dev server refuses to boot, exit code 1, message
  `SPIDERYARN_STORE is "postgres", but the database did not answer: division by zero. Locally: npm
  run db:start, and check DATABASE_URL in .env.local. To work off the filesystem instead,
  SPIDERYARN_STORE=files npm run dev. See docs/project/supabase-local.md.` (The first draft printed
  `Failed query: select 1/0` instead of `division by zero` — that is what made me add the `cause`
  unwrapping.)
- **Green**: reverted to `select 1`, `npm run dev` boots, logs `serving article reads from Postgres`.
- **Escape hatch**: `SPIDERYARN_STORE=files npm run dev` boots with no Postgres store line and no probe.
- `npm run typecheck` clean apart from an unrelated `TS6133` in another agent's untracked file.
- The full suite is currently broadly red for a reason that is not mine: another agent is mid-flight
  renaming `upstream_inference_nanos` → `byok_upstream_nanos`, and the migration is written but not
  applied to the local database, so every Postgres-backed test fails. `tests/store-selection.test.ts`
  and `tests/store-guarded.test.ts` pass.

## Questions

1. **Is the probe in the right place, and is it the right size?** It runs on every dev and preview
   boot. Should it be skipped in some case I have not thought of — a worktree, `vite preview` in CI,
   `NODE_ENV=test`? Is one un-retried `select 1` the right call, or does it introduce a flake on a
   cold Docker start where the container is up but Postgres is still recovering?
2. **The soft default.** Is `${SPIDERYARN_STORE:-postgres}` in `package.json` acceptable here, or is
   it too clever for a file people skim? Note a subtlety: `src/env.ts` deliberately makes `.env.local`
   **beat** the inherited environment, so an `SPIDERYARN_STORE=files` line in someone's `.env.local`
   overrides the npm script under either form. Does that make the soft form pointless, or more
   important?
3. **What breaks for somebody that I have not listed?** Specifically: worktrees (`npm run
   worktree:setup`), `vite preview` used for performance measurement, and any agent currently mid-task
   whose articles live in `data/` (22 slugs on disk vs 20 rows in the local database, overlap unknown).
4. **Is leaving `storeFromEnv` alone the right call**, or is the split — dev server on Postgres, CLI
   and tests on files — a worse state to be in than either end?
5. Anything wrong in the two documentation edits (the decision record appended to
   `260902j-…md`, and the correction to the postmortem's cost arithmetic)?

Be concrete and rank anything you find P0/P1/P2. If it is fine, say so briefly rather than inventing
findings.

## The diff

See the attached `dev-default.diff`.
