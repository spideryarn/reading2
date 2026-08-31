# Review request: the deploy pipeline plan

You are reviewing a plan **before it is built**. Be adversarial and specific. I would rather have
five findings that change the design than twenty that restate it.

## What to read

1. **The plan**: `docs/plans/260827v-deploy-pipeline.md` — this is the thing under review.
2. **What exists today**: `docs/project/deployment.md` (long; the sections "Deploying", "The five
   that fail quietly", "/api/health", "Who can reach it", "Environment variables"),
   `scripts/check-production-gate.sh`, `scripts/check.ts`, `scripts/typecheck.ts`,
   `scripts/db-migrate.ts`, `src/vercel-health.ts`, `src/vercel.ts`, `vercel.json`,
   `vite.config.ts`, `vite.api.config.ts`, `.vercelignore`, `drizzle.config.ts`,
   `docs/project/database.md` (§ Connecting to the remote, § Roles).
3. **The house pattern this project cares about most**: `docs/reusable/silent-success.md`.
4. `CLAUDE.md` for the working agreements, especially the git rules (several agents share one
   working tree; `git stash` / `git checkout --` / `git clean` / branch switching are forbidden).

## Context you need

The app is a Vite SPA plus **one** Node serverless function on Vercel (project
`spideryarn-reading2`, team `greg-detre`, production branch `main`, custom domain
`www.spideryarn.com`, region lhr1, Pro plan). Data is Postgres on Supabase, migrated with Drizzle
SQL files applied by `scripts/db-migrate.ts`. There is an application-level auth gate, so
unauthenticated API calls get 401. **There is no CI.**

The plan's § "What we measured first" lists nine facts that were measured rather than assumed. Treat
those as evidence, but **check my reasoning from them** — several of them were surprising and I may
have drawn the wrong conclusion.

Three design decisions were made by the project owner (Greg) after being shown the alternatives, and
are **not open for you to relitigate on preference**: push-and-verify rather than staged-then-promote;
tests and typecheck as hard gates with a named override; migrations apply what is pending without a
destructive-statement gate. You *may* — and should — tell me if one of them is unsafe in a way the
options I presented did not surface.

## The questions I actually want answered

1. **Ordering.** Migrations run before the push. Is there a case in this specific codebase where
   that is wrong? Note the window: Vercel keeps the old function serving until the new deployment is
   promoted, so old code meets new schema. Also: if the migration succeeds and then the *build*
   fails, we have migrated for code that never shipped and the script exits having half-deployed.
   Is that the right trade, and should the script say something specific about it?

2. **The worktree gate.** `git worktree add --detach <tmp> <sha>`, symlink the main tree's
   `node_modules`, build/typecheck/test there. Non-destructive to the shared tree — please confirm,
   and say if `git worktree add` can touch anything another agent cares about (index? refs? a
   concurrent `git worktree prune`?). What breaks if `package-lock.json` changed in the commit being
   deployed and `node_modules` is the *old* one? Is symlinking `node_modules` sound at all given
   Vite/rolldown resolution and `.bin` shims, or does it silently resolve something wrong?

3. **The build stamp.** The proposal computes `SPIDERYARN_BUILD_COMMIT` once in `vercel.json`'s
   `buildCommand` and feeds both builds. Does `${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD)}`
   actually work in Vercel's build shell — is `git` present, is the repo a real clone with history,
   and is the buildCommand run through a shell that does parameter expansion? If not, what is the
   right mechanism? Also: `dist/build.json` is served by the SPA — check it is not swallowed by the
   catch-all rewrite in `vercel.json` the way `/robots.txt` was, and say how the smoke test could be
   fooled by caching.

4. **Verification that can lie.** Go through the check table in § 6 and find the ones that can pass
   over a broken deployment, or fail over a good one. I have deliberately excluded redirect-following
   and latency. What am I still missing? In particular: is asserting `build.commit === <sha>` on
   `/api/health` sound given Vercel's build cache — could a cached `api-dist` produce a function
   older than the stamp it reports?

5. **The gates against a red baseline.** `main` currently has ~12 typecheck errors and ~6 failing
   tests, all in other people's in-flight work, and the plan gates on them anyway with a named
   `--force-gate` override. The repo's own rule is "a check that always fails is a check nobody
   runs". Is the sequencing in the plan (build the gate, fix the red, then deploy for real) actually
   coherent, or does it produce a command nobody can use for a week?

6. **The non-hermetic test suite.** The plan symlinks `.env.local` and `data/` into the worktree so
   the tests can run, and calls that a compromise. Is that acceptable as a *deploy gate*, or does it
   defeat the isolation the worktree exists for — i.e. can a test pass in the worktree and fail on
   Vercel *because* of that state? Rank how bad this is.

7. **Logs.** `npx vercel@latest logs --json --since <push time>` filtered to our `deploymentId`.
   Measured: `/api/health` writes no log at all, because it is answered before the logging
   middleware. What else in this codebase would make "no error lines" misleading? Is filtering by
   `deploymentId` reliable, and what does the script do if the log query returns nothing —
   is that a pass, a warning, or a failure?

8. **What is missing entirely.** The plan's § "What this deliberately does not do" lists
   auto-rollback, an authenticated round-trip, a pre-promotion canary, CI and log drains. Is there a
   check or a step that belongs in the *first* version and is not in the plan at all?

9. **The rollback footgun.** After `vercel rollback`, Vercel turns off auto-assignment of production
   domains, so the next push builds and does not go live. The plan only *prints* this. Should the
   script detect the state instead — and can it, from the API?

## How to answer

- Lead with the findings that would change the design, most important first. Say what is wrong, why,
  and what to do instead.
- Separate **"this is wrong"** from **"I am not sure"**. Say which of your claims you verified
  against a file or a doc, and which are from memory — I will check them.
- If a section of the plan is fine, one line saying so is enough. Do not restate it back to me.
- Flag anything where the plan asserts a measured fact that you think is misread.
- Finally: list the questions this plan should be putting to Greg that it is not.

Read-only. Do not modify any file, do not run anything that deploys, pushes, or writes to a database.
