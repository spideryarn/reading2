# Review: worktrees Step 0, the part that does not disturb a shared tree

You reviewed this plan three times already (`260828r-worktrees-review-sol.md`,
`-code-review-sol.md`, `-review-2-sol.md`). This is a **code review of the first slice actually
built**, plus a review of the operational doc written alongside it. Weight the code higher than the
prose.

## The constraint that shaped the slice

Roughly a dozen Claude sessions are editing this one checkout right now, with uncommitted work in it.
Greg's instruction on 2026-09-01:

> There are a bunch of other agents working right now, and I'd prefer not to disrupt them. So let's
> go as far as we can without messing up their work, which may block us on switching this primary
> checkout to dev, etc.

So Step 0 was **split**. The half that touches nobody is built (below). The half that moves the
primary's branch and GitHub's default branch is written up as a runbook and deliberately not run.

## Greg's other decisions, 2026-09-01

1. **This Linux box first** (`/home/greg/code/spideryarn2`, outside Dropbox). The Mac stays on one
   shared tree; instructions for it go in the doc for a later agent.
2. **A worktree pushes straight to `dev`** — `git push origin HEAD:dev` — and the local
   `worktree-*` branch is a scratch label deleted afterwards. His words: *"I want each worktree to
   push directly to dev, and then we'll tidy up the local worktree branch afterwards."* This
   replaces the plan's assumption that `worktree-*` branches would be pushed to the remote.
3. **One shared local Supabase with a lease for v1**, revisit a stack per worktree later.
4. **Design for 20–30 worktrees eventually**, not a hardcoded 10 (he accepts the box needs scaling).

## What was built

`scripts/deploy-checks.ts` — a new pure judgement `deployBranchProblem(branch)` plus
`DEPLOY_SOURCE_BRANCHES = ["main", "dev"]`, replacing the inline `if (branch !== "main")` in
`scripts/deploy.ts:324`. Five tests in `tests/deploy-checks.test.ts`.

`vercel.json` — `git.deploymentEnabled.dev = false`.

`docs/project/worktrees.md` — new, 260 lines, parented under `dev-and-deployment-overview.md`. The
operational half of the plan: status, the decisions above, the workflow, the database reasoning, the
port ceiling, and two runbooks (flip the trunk; get the Mac out of Dropbox).

### Evidence that the tests were seen red

With `DEPLOY_SOURCE_BRANCHES` temporarily reverted to `["main"]`, four of the five failed
(`Tests 4 failed | 1 passed`). Restored: `Tests 109 passed (109)` in that file, and 117 with
`doc-links` included. `npm run typecheck` has 3 errors, all in `tests/diagram-step.test.tsx`,
`tests/diagram.test.ts` and `tests/public-dto.test.ts` — files this change does not touch, another
agent's in-flight work.

## Deliberate judgement calls I want attacked

**A. `deploymentEnabled: {"dev": false}` rather than the default-deny `{"*": false, "main": true}`
your review 2 implied.** Reasoning: a branch not named defaults to `true`, so default-deny is
strictly better *if the wildcard behaves*. But I cannot verify wildcard-vs-exact-key precedence
without a real push, and if `"*": false` matched `main`, `waitForDeployment` in `deploy.ts` would
hang waiting for a production build that never comes — which is the one failure that disrupts every
other agent's ability to ship. Under Greg's decision 2 nothing pushes a `worktree-*` ref to origin
anyway, so the residual exposure is a *stray* `git push -u`, and the real mitigation for that is
taking the model keys off the Preview environment (written into the runbook as Greg's to run, since
removing an env var needs its value to restore). **Is deferring the wildcard the right call, or am I
protecting the wrong thing?**

**B. `main` stays in `DEPLOY_SOURCE_BRANCHES` indefinitely.** Rationale in the code comment: the flip
has not reached every checkout, and a deploy that refuses during the changeover is a deploy nobody
can ship. Counter-argument I want tested: once `dev` is the trunk, accepting `main` as a deploy source
means an agent standing on a stale local `main` can gate and promote a sha that is not on the trunk —
though `preflight` still refuses if the sha is behind `origin/main`. **Should accepting `main` expire,
and if so what should force it?**

**C. A `worktree-*` branch is refused by name rather than allowed.** Worktrees get no `.env.prod`, so
a deploy from one cannot work; refusing early gives a legible reason instead of a
missing-credential failure halfway through. Is there a case where deploying from a worktree is
wanted, e.g. Greg's own worktree once the primary is his alone?

**D. Rebase is declared allowed inside a worktree.** AGENTS.md bans rebasing outright today, and the
doc now says that ban is about the shared primary only. The workflow *requires* it: with N agents
pushing to one `dev`, non-fast-forward rejections are routine and fetch-and-rebase is the fix. Is
declaring this in `worktrees.md` — while AGENTS.md still says otherwise, pending Greg's approval of a
rule change — an unacceptable window where two docs disagree? The AGENTS.md wording is drafted in
`worktrees.md` but deliberately not applied.

**E. The push-straight-to-`dev` model, versus the plan's `worktree-*`-on-origin model.** Greg's
choice removes preview builds, stray refs, and simplifies the sweep's landed test to
`git merge-base --is-ancestor HEAD origin/dev`. What does it *cost* that the plan's model did not? My
list: no remote backup of in-progress worktree commits (the plan's push-at-the-end convention was
partly a backup story, and Rebel's postmortem about a fix stranded 31 hours on an unpushed branch cuts
both ways); a busier single branch; and rebase-before-push becoming mandatory. **What am I missing?**

## The database claim I most want checked

`worktrees.md` argues a database per worktree is blocked by more than RAM. Measured on this box: one
Supabase stack is ~1.16 GB idle across 12 containers, of which Postgres is only 212 MiB; dropping
logflare/studio/inbucket/edge-runtime via `supabase start -x` gets a trimmed stack near 0.7 GB, so
ten fit in ~7 GB of 30 GB but twenty or thirty do not.

Then the structural claim: **"a database per worktree" cannot mean a bare Postgres database**, because
six migrations (`drizzle/0001`, `0003`, `0015`, `0040`, `0043`) declare hard foreign keys into
`auth.users`, which GoTrue owns inside the same database. A fresh database has no `auth` schema, so
those migrations fail. And `CREATE DATABASE … TEMPLATE` does not rescue it: the copy's `auth.users` is
a frozen snapshot while the shared stack's GoTrue keeps writing new users to the original, so a
freshly signed-up user fails the FK on insert.

**Is that reasoning sound?** Specifically: is there a cheap arrangement I have missed — a shared
GoTrue pointed at one auth database with our tables in another (cross-database FKs are impossible in
Postgres, which I think kills it), a schema-per-worktree inside one database, or a GoTrue configured
with a non-default schema search path? If schema-per-worktree works, it is far cheaper than a stack
per worktree and the doc is wrong to send Greg toward the expensive option.

## Also worth your attention

- Does `deployBranchProblem` handle detached HEAD correctly? `git rev-parse --abbrev-ref HEAD`
  returns the literal `"HEAD"`, which the function refuses; there is a test for it. Any other value
  that string can take that would wrongly pass or wrongly fail — a branch literally named `dev`
  in a worktree, say?
- The runbook claims `git switch -c dev` is safe in a tree with a dozen agents' uncommitted work,
  because it creates the branch at the current HEAD and therefore changes no file. Is that right,
  and is there a race worth naming (a peer committing between the `rev-parse` and the `switch`, so
  `dev` is created one commit behind)?
- `worktrees.md` says step 5 of the runbook — `git remote set-head origin -a` — is the one that bites
  if skipped, because Claude Code resolves `--worktree`'s "fresh" base through the local
  `origin/HEAD`. Is the failure mode stated strongly enough?

## Files

Read these in the working tree (the scoped diff was handed over as a scratch `step0.diff`,
since removed — the same content is in the commit):

- `scripts/deploy-checks.ts` (the new block is just above `migratorUrlFrom`)
- `scripts/deploy.ts` (`preflight`, around line 320)
- `tests/deploy-checks.test.ts` (the `deployBranchProblem` describe)
- `vercel.json`
- `docs/project/worktrees.md`
- `docs/plans/260828r-worktrees.md` for the design this slices from

Answer with findings ranked by severity, each one naming the file and what would go wrong. Say
explicitly if you think a judgement call above is wrong, and say so about the database reasoning
even if the rest is fine.
