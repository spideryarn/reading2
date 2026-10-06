# Review: sixth sweep cluster S4 — tests that wait on a clock, or carry guards a type could delete

## The candidate

- Your working directory is the cluster's own git worktree. The candidate is six commits,
  `3ef151505` (stage 1) through `e52b10631` (the plan doc): `git log --oneline 3ef151505~1..HEAD`,
  `git diff 3ef151505~1 HEAD`.
- The plan: `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` § S4 and § "What the review
  changed" (U2, U5, U6). The builder's record: `docs/plans/261006j-sixth-sweep-s4-test-defences.md`.

## What it is meant to do

Make tests stricter or steadier without changing product behaviour: `pgReady` overloads so a
`keepPool: true` caller has a certain pool, and the 183 guards that made redundant are removed;
two tests stop waiting on a clock; three build-output skips and one database skip become
failures; two regex import checks move to a helper; six lint fixes. The one source change is a
`kill` injection seam in `tools/fleet/child.ts`.

## What you can run, and what you may change

No network and **no database, not even loopback**: tests that need Postgres cannot run in your
sandbox, so do not report their connection failures as findings. The builder ran them: stage 1's
26 database suites, 559 passed, 0 skipped. You can run `node --import tsx scripts/typecheck.ts`
and database-free files such as `npx vitest run tests/pg-ready.test.ts tests/fleet-child.test.ts
tests/admin-only-routes.test.tsx tests/sanitize-client.test.ts
tests/fleet-recovery-resume-route.test.ts` — run them.

**You may fix what you find, inside this cluster's files, narrowly and red-first.** Do not commit.
Report anything wider.

## Attack it

1. **Did any removed guard hide a real case?** For each of the removed `!pool` / `pool?.` /
   `pool!.` / `describe.skipIf(!pool)` guards, the binding must come from `pgReady` with
   `keepPool: true` and nothing may reassign it to undefined (an `afterAll` that ends and clears
   it, a `let pool` assigned in `beforeAll` and read at module scope before that runs, a
   conditional assignment). A guard removed from a `let` that is read before `beforeAll` assigns it
   now throws where it used to skip or no-op. Find any such site.
2. **Do the overloads lie?** Is there any path through `pgReady` where `keepPool: true` returns
   without a pool (an early return, a catch)? The type must not promise more than the code does.
3. **`tools/fleet/child.ts`'s `kill` seam** — the only production code touched (the fleet
   dashboard, which runs on a higher standard than dev). Is the default exactly the old behaviour?
   Is every call site of the old `process.kill` inside that module routed through it, including
   the delayed SIGKILL sweep? Could the injected parameter change an exported signature others
   call positionally?
4. **Skips into failures.** `tests/no-secrets-in-bundle.test.ts`, `cold-start-lazy-imports`,
   `pdf-bundle-trace` now fail without build output. Is there any way the suite is run without a
   build first — `scripts/check.ts`, `scripts/deploy.ts`, `scripts/readiness-loop.ts`,
   `package.json` scripts, a documented `npm test` in a fresh clone on the Mac — that this now
   breaks? `tests/migration-reconciliations.test.ts` now throws at module scope without a local
   database: does a module-scope throw produce a clear failure, and does the local-only check
   really run before any connection or mutation?
5. **The two moved import checks**: does each still fail on the thing it was written to catch, and
   on the wrong implementation the regex passed?
6. `tests/admin-only-routes.test.tsx`: is the new wait bounded, and does it fail (not hang, not
   pass) when the heading never arrives?
7. Any assertion weakened or deleted anywhere in the diff that the commit messages do not own up to.

## Format

Verdict line first: **ship**, **ship with these fixes (applied)**, or **do not ship**. Then
findings with ids (C1, …), severity P0–P3, `file:line`, reproduced or reasoned, fixed (name the
files) or reported. Under 900 words.

## My own suspicions — read last

A `let pool` read before assignment; a Mac or fresh-clone path that runs `npm test` without a
build.
