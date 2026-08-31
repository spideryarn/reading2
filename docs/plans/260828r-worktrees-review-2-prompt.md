# Review prompt: the worktrees plan, revised 2026-08-31

You reviewed an earlier version of this plan on 2026-08-28
(`docs/plans/260828r-worktrees-review-sol.md`) and the code from its step 1
(`docs/plans/260828r-worktrees-code-review-sol.md`). Both are in the repo; read them, because this
revision **deletes a large part of what you previously approved**, and the most useful thing you can
do is tell me whether the deletions are justified or whether I have talked myself out of necessary
machinery.

**The plan to review:** `docs/plans/260828r-worktrees.md`.

## What changed, and what I want challenged

The revision rests on four claims. Each one removes work. Please attack them.

**Claim 1 — `npm ci` is fast, so the fingerprint-keyed copy-on-write `node_modules` cache
(your section 1, which you endorsed) should not be built at all.**

My evidence, measured twice today on this laptop into empty scratch directories, with
`package.json` + `package-lock.json` copied in and a warm 21 GB npm cache:

```
npm ci --prefer-offline --no-audit --no-fund
  run 1: exit 0, wall 5 s, free-space delta 571 MB, 28,909 files
  run 2: exit 0, wall 4 s, free-space delta 564 MB, 28,909 files
smoke: vite 8.2.2, tsx 4.23.12, vitest 4.1.11, esbuild 0.28.2, sentry-cli 2.58.6,
       drizzle-kit 0.31.10, biome 2.5.10 — all executed --version successfully
```

The earlier plan measured 130 s for the same command, at load average 433, and built the cache
design on that. Disk free is now 333 GB; the cache would save roughly 11 GB across ten worktrees.

Questions: is a free-space delta from `df -k` on APFS a sound way to measure this, given other
processes were running? Is 28,909 files twice in a row adequate evidence of a complete install, or
should I be comparing against something else? Is there a failure mode of `npm ci --prefer-offline`
that would not show up in a `--version` smoke test but would break a worktree later? Note npm 11
blocked the install scripts of `esbuild` (x2) and `fsevents` and everything still worked, because
those ship prebuilt platform binaries — does that hold generally, or am I one dependency away from
it not holding?

**Claim 2 — Claude Code's native worktree feature replaces most of `scripts/worktree.ts`.**

Installed version is 2.1.252; `claude --help` shows `-w, --worktree [name]` and `--tmux`. I read
https://code.claude.com/docs/en/worktrees and the plan's table lists what it does and does not cover.
The parts I am relying on: creation, `worktree.baseRef`, `.worktreeinclude` for copying `.env.local`,
tool-level isolation blocking edits/bash/git-redirects into the main checkout, a `git worktree lock`
held while a session runs, and a periodic sweep that refuses to remove a worktree holding changed
files, untracked files or unpushed commits.

Questions: is depending on a harness feature for the *safety* property (isolation) sound, given the
repo's rule that a check you have never seen fail is not evidence — how would I verify the isolation
actually holds rather than trusting the documentation? Note that MindstoneRebel's AGENTS.md
explicitly tells agents *never* to use a harness's built-in worktree isolation, because it skips
their post-init hook; is that objection still live here given `WorktreeCreate` replaces creation
rather than following it, so there is no way to have both the defaults and an automatic `npm ci`?

**Claim 3 — one mechanism for macOS and Linux.** Greg asked for one approach unless a fork is
absolutely necessary. The box is Ubuntu 24.04, ext4 on both `/` and `/home` (verified via `df -Th`),
so no reflink. `npm ci --prefer-offline` is identical on both; its npm cache there is 266 MB vs the
laptop's 21 GB, so the first run fetches over the network. Is `--prefer-offline` the right flag for
both, or does it hide a determinism problem — could the box and the laptop end up with different
trees from the same lockfile?

**Claim 4 — the `dev` branch change is nearly free.** `scripts/deploy.ts` captures one sha, gates it,
pushes `<sha>:refs/heads/main`, and polls the Vercel API until a production deployment of that sha is
`PROMOTED`. I grepped for `main`/`origin/main` and found six live references, listed in the plan's
Step 0 table; I claim only line 323 (`if (branch !== "main")`) must change, because everything else
already means "what is live" rather than "the branch I work on".

Questions: is that reading right — check the table against the file. What breaks that I have not
listed? In particular: does making `dev` the GitHub default branch have consequences for the deploy
pipeline, and is my claim correct that Vercel's production branch and GitHub's default branch are
independent settings? Is `git.deploymentEnabled: {"dev": false}` in `vercel.json` genuinely
per-branch and safe against the production branch?

## The risk I most want a second opinion on

If this project's Vercel environment variables are scoped to "All Environments" rather than to
Production, then enabling preview deployments for `dev` means every agent push builds a deployment
holding production Supabase credentials and production model-provider API keys. This repo has **one
production database and no staging copy**, and around ten agents pushing many times a day. The
production env contains `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SPIDERYARN_STORE`,
`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`.

I could not read the per-environment scoping from this machine, so the plan says: disable preview
deploys on `dev` until it has been read. Is that the right default? Is there a way to determine the
scoping that I have missed? And is there a variant of this risk that survives disabling previews —
for example, does anything else in the repo build or run against `dev`?

## Also worth your attention

- **The sweep design** (step 5). Copied from Rebel: read-only `classify`, destructive `remove` that
  re-runs every guard itself with a fresh fetch, per-branch with no bulk flag, and an age guard
  because "merged" is trivially true for a branch created an hour ago. Is the age threshold the right
  mechanism, or is there something better than a wall-clock heuristic for "this worktree is not
  actively being used"? Note Claude Code holds a `git worktree lock` while a session runs — is that a
  better signal than age, and what happens when a session is `SIGKILL`ed?
- **Ports** (step 3). I changed the recommendation from an atomic lease to a deterministic hash of
  the worktree name into the allowed range, with `strictPort: true` turning a birthday collision into
  a loud refusal. Is that a good trade, or does a hash collision fail in a way `strictPort` does not
  catch — bearing in mind failure row 5, where a browser pointed at an already-taken port silently
  reaches the *other* worktree's server?
- **Postgres** (step 4). Unchanged: one shared local Supabase stack plus a migration lease. I have
  written it up as a known compromise rather than a solution, and added drizzle migration-number
  collisions (the tree is at `0036_`; two branches both generate `0037_` and each branch's
  `drizzle-kit check` is happy). Is "policy plus a post-rebase duplicate-number check" enough, or
  does this need a real mechanism before worktrees ship?
- **The `.claude/worktrees/` location.** Claude Code puts worktrees inside the repo, which is inside
  Dropbox. Symlinking that path is explicitly refused by the tool. The plan sets the two Dropbox
  xattrs and a `.gitignore` line instead of writing a `WorktreeCreate` hook to relocate them. Is that
  sound, and is there a failure mode of Dropbox-ignoring a directory that git actively writes into?

## What I want back

A verdict — proceed / revise before building / reject — and then findings ordered by how much they
cost times how quietly they happen, which is the ordering the plan itself uses. Be specific about
which of my four claims you think is weakest. Where you think I have deleted machinery that was
load-bearing, say what breaks and how it would be noticed.

Do not edit any files.
