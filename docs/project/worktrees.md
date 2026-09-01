# Worktrees

Parent: [dev-and-deployment-overview.md](dev-and-deployment-overview.md).

A dozen agents share one checkout of this repo, and almost every git rule in
[AGENTS.md § Working in a tree several agents share](../../AGENTS.md#working-in-a-tree-several-agents-share)
exists because of that one fact. The bans on throwing work away, and on switching branches, are there
not because those commands are dangerous in general but because **somebody else's uncommitted work is
in this tree and there is no second copy**. Worktrees are the fix: one tree per agent, so those
commands become ordinary again.

The design, the measurements and everything that was considered and rejected are in
[260828r-worktrees.md](../plans/260828r-worktrees.md). **This doc is the operational half**: what is
true today, what was decided, and the two runbooks nobody has run yet.

## Where this stands

**Nothing creates a worktree yet.** What exists is the safety layer and Step 0's deploy change:

| | |
|---|---|
| [`scripts/lockfile.ts`](../../scripts/lockfile.ts) | Atomic file lock. **Never steals a stale lock** — so a `SIGKILL`ed holder leaves a file a human must `rm`, and the error message says which. Deliberate: never two writers. |
| [`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts) | Forced removal of a throwaway worktree, a `--porcelain -z` parser, and `ghosts()` for the sweep that does not exist yet. |
| [`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) | `DEPLOY_SOURCE_BRANCHES` and `deployBranchProblem` — `npm run deploy` accepts `dev` as well as `main`, and refuses a `worktree-*` branch by name. Plus `trunkGap`, below. |
| the `level with origin/dev` gate | **Being on the trunk is not being level with it.** `preflight` only ever compared against `origin/main`, which proves the candidate contains current *production* and says nothing about current *trunk* — so a stale `dev` could promote code missing commits that had landed, and report success. The gate requires the captured sha to equal a freshly fetched `origin/dev`, fails closed if the trunk cannot be read, and does nothing when you are on `main`. Forcible as `--force-gate='level with origin/dev'`. |
| [`vercel.json`](../../vercel.json) | `git.deploymentEnabled` is default-deny — `{"**": false, "main": true}` — so only production builds. |

Still to build: the setup layer, ports, the database lease, and `worktree:sweep` —
[the plan's work list](../plans/260828r-worktrees.md#what-is-left-to-do).

## What Greg decided, 2026-09-01

1. **This Linux box first.** The plan was written on the Mac, where the repo lives inside Dropbox and
   that drives a lot of its cost. This box is at `/home/greg/code/spideryarn2`, outside Dropbox, so
   the Dropbox questions do not apply here at all. The Mac keeps sharing one tree for now —
   see [Runbook B](#runbook-b-the-mac-later).
2. **A worktree pushes straight to `dev`.** Not a `worktree-*` branch on the remote; the local branch
   is a scratch label you delete afterwards. See [The workflow](#the-workflow).
3. **One shared local Supabase, with a lease**, for v1 — and a stack per worktree later if it earns
   it. [Why](#the-database-one-stack-and-a-lease).
4. **Design for more than ten.** Twenty or thirty is a thing we might want, and the box would need
   scaling up to carry it. So nothing hardcodes ten — [Ports and the ceiling](#ports-and-the-ceiling).

## The workflow

```bash
# from a worktree, when a piece of work is done
git fetch origin dev
git merge origin/dev           # NOT rebase — see below
npm test && npm run typecheck
git push origin HEAD:dev       # commits land on dev; no worktree-* ref on origin
```

Three things follow from `push origin HEAD:dev`, and they are all improvements:

- **No stray branches on the remote**, so no preview builds from them, so the `deploymentEnabled`
  question shrinks to the trunk itself.
- **The "did it land?" test becomes one command** — `git merge-base --is-ancestor HEAD origin/dev` —
  which is what makes a safe sweep possible at all.
- **Integrate by merging, never by rebasing** — and note this needs no change to any rule, because
  the ban on rebasing in [AGENTS.md](../../AGENTS.md#working-in-a-tree-several-agents-share) and
  [version-control.md](version-control.md) stays exactly as written. An earlier draft of this doc had
  it the other way round and claimed the workflow *required* rebase. It does not. It requires
  **integration** before a push to a moved `dev`, and merge is integration. Why merge, specifically:

  1. **Your shas survive.** This repo references commits everywhere — Sol reviews cite them, plans say
     "done (`96c7661`)", postmortems are built around the commit that introduced a bug. Rebase rewrites
     every commit it moves, and those references do not break loudly; they keep looking fine and point
     at nothing.
  2. **You push what you tested.** After a merge the pushed commit is the one `npm test` ran on. After
     a rebase, and especially after losing the push race twice, the tested arrangement no longer
     exists.
  3. **A conflict arrives once, not once per commit.** Rebase replays each of your commits over the new
     base, so one conflict can surface N times — and with
     [git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md)'s "make a proposal,
     don't make changes yet" rule, N replays means N round trips with Greg.
  4. **It degrades better under contention.** Losing the race is routine with a dozen agents. A merge
     retry costs one more merge commit; a rebase retry replays your whole stack against a new base.
  5. **A stopped merge is a state you can read.** Interrupted mid-rebase you are on a detached HEAD
     with a rebase in progress, and the ways out — `git rebase --abort`, `--skip` — are indistinguishable
     from the throw-work-away commands you are told never to run, so a stuck agent is stuck between two
     rules. An interrupted merge leaves you on your own branch with markers in files.

  What it costs is a braided log on `dev`; `git log --first-parent` reads it back. The sweep is
  indifferent — `git merge-base --is-ancestor HEAD origin/dev` answers "did it land?" the same either
  way. And most landings never conflict at all: a plain non-fast-forward merges automatically, so the
  proposal rule only fires on real textual conflicts.

`main` is still written **only** by a gated `npm run deploy`, which pushes one gated sha
(`git push origin <sha>:refs/heads/main`) rather than the branch you are standing on. That is why
moving the trunk to `dev` costs one line in [`scripts/deploy.ts`](../../scripts/deploy.ts) rather than
a rewrite, and why Vercel's git auto-deploy on `main` must stay **on** — the script polls for the
production build that the push causes.

## The database: one stack, and a lease

The lease is one file lock, on [`scripts/lockfile.ts`](../../scripts/lockfile.ts), around the three
things that write schema: `db:migrate`, `db:reset`, and any database-backed test run. Held for the
whole run, not per statement. It isolates nothing — it only means two of those never overlap, so one
agent's migration cannot land in the middle of another's suite.

**It is not a detour on the way to a stack per worktree.** If we go there later, the lease becomes
something each worktree holds alone, and you delete it once you trust that. The thing that varies is
one `DATABASE_URL` either way.

Two more pieces belong with it, and the plan is emphatic that policy alone is too quiet here: a
`test:db` that **fails when the database is absent** (about a dozen Postgres suites currently skip
themselves silently, so a misconfigured worktree reports green while testing nothing), and an
automated refusal on duplicate migration numbers — a lease stops two migrations running at once and
does nothing about two branches independently minting `0044_`.

### Why not a stack per worktree yet (measured 2026-09-01)

One local Supabase stack, idle, on this box:

```
analytics (logflare)  263 MiB      pg_meta          54 MiB
postgres              212 MiB      auth (gotrue)    27 MiB
studio                161 MiB      vector           25 MiB
storage               140 MiB      inbucket         24 MiB
kong                  112 MiB      edge-runtime      6 MiB
rest (postgrest)       91 MiB      ──────────────────────────
realtime               65 MiB      total         ~1.16 GB
```

Box: 30 GiB total, ~19 GiB free — but 3 GiB of swap already in use, so it has been under pressure.
Docker images are shared (8.1 GB, one copy however many stacks); volumes are ~610 MB each. Ten full
stacks ≈ 11.6 GB, on top of a vite server and a vitest run per worktree.

**Postgres is only 212 MiB of that 1.16 GB.** Four of the containers above — logflare, studio,
inbucket, edge-runtime — are droppable per worktree with `supabase start -x`, which takes ~460 MiB off
and puts a trimmed stack near 0.7 GB. Ten of those is ~7 GB and fits; twenty or thirty does not,
without a bigger box.

**But RAM is not what blocks it — a *database* per worktree does not work at all.** Eleven foreign
keys across seven migrations point into `auth.users` — `drizzle/0001`, `0003`, `0011`, `0015`, `0021`,
`0040`, `0043`, each `REFERENCES "auth"."users" ("id") ON DELETE RESTRICT` — and that table belongs to
Supabase's GoTrue. Two consequences:

- A **fresh** database has no `auth` schema, so all seven migrations fail.
- A **template copy** does not rescue it. Postgres cannot enforce a foreign key across databases, so
  each copy needs its own `auth.users`, and that copy is frozen at creation while the shared stack's
  GoTrue keeps writing new users to the original. A freshly signed-up user then fails the key on
  insert.

### A schema per worktree is the cheap option, and it is not ruled out

An earlier version of this section concluded from the above that real isolation needs a whole Supabase
stack each. **That was too strong**, and GPT Sol was right to push back (finding 3 in
[the review](../plans/260828r-worktrees-step0-review-sol.md)). Both problems above come from crossing
a *database* boundary. A *schema* boundary inside one database has neither, because there is exactly
one `auth.users` and every worktree's foreign keys point at it:

```
one Supabase stack, one database, one shared auth.users
  worktree_a.<app tables>  ──┐
  worktree_b.<app tables>  ──┼──▶ auth.users
  worktree_c.<app tables>  ──┘
```

A new GoTrue user is visible to every worktree immediately. GoTrue needs no reconfiguring — its
`DB_NAMESPACE` prefixes its own table names and is not an app-schema selector, so it is not the knob
here and not a risk either.

It is not free. [`src/db/schema.ts`](../../src/db/schema.ts) hardcodes `pgSchema("spideryarn")`, and so
do the migration SQL, the migration ledger, the schema-drift checks, the grants, and a number of raw
SQL strings. Storage and Auth state stay shared whatever we do. But it costs a few MB per worktree
rather than 0.7–1.2 GB, and it is the option to evaluate **before** a stack each — which is the
opposite of what this section said before.

**Either way the honest next step is a measurement, not an argument**: for schemas, whether one
`WORKTREE_SCHEMA` indirection can reach every hardcoded `spideryarn`; for stacks, starting one trimmed
stack and watching it under load rather than reasoning from the idle numbers above.

## Ports and the ceiling

Half of this is worse than none, because each half hides the other's failure:

1. `SPIDERYARN_DEV_PORT` in `vite.config.ts` (which hardcodes `5273` today), with **`strictPort: true`**.
2. An **atomic port lease** on `scripts/lockfile.ts` — not a scan-then-pick, and not a hash. A hash was
   proposed and withdrawn: at ten worktrees it collides ~99.96% of the time.
3. The `additional_redirect_urls` range in [`supabase/config.toml`](../../supabase/config.toml), **then
   restart Supabase and check the running container** — the file is not re-read automatically
   ([supabase-local.md](supabase-local.md)).
4. An identity endpoint reporting worktree and commit, which browser checks assert against.

Why (4) is not optional: `strictPort` only makes the *second* server refuse to start. A browser
pointed at 5273 still reaches the *first* worktree's server and everything looks fine — so an agent
can screenshot another worktree's work and report success.

**The ceiling is a number, so make it one.** The `additional_redirect_urls` allow-list is a list of
exact ports, and its length is the maximum number of concurrent worktrees: a port that is not on the
list produces a sign-in that appears to work and silently drops the return path. So the port function
must **refuse** to produce a port outside the range rather than trusting it. Greg wants headroom for
twenty or thirty eventually, which needs a bigger box; generate the range from a single
`WORKTREE_PORT_RANGE` constant so raising the ceiling is one edit and a Supabase restart, not a
hand-maintained list.

## Runbook A: flip the trunk to `dev` (not yet run)

**Why it is waiting.** The last step changes the shared primary's branch, and a dozen agents have
uncommitted work in it. `git switch -c dev` is genuinely safe — it creates the branch at the current
`HEAD`, so no file in the tree changes and nobody's work is touched; it is a label move, not a
checkout. But it is the exact command AGENTS.md tells you to ask about, and it changes GitHub's
default branch, which every clone then has to be told about. Do it in a quiet moment, with Greg
present.

The parts that do **not** disturb anyone are already done and committed: `deploy.ts` accepts `dev`,
and `vercel.json` disables builds for it.

```bash
# 1. Confirm the primary is clean enough to reason about, and note the sha.
git -C /home/greg/code/spideryarn2 rev-parse HEAD

# 2. Create the trunk at the current HEAD and move onto it. Atomic; touches no file.
git switch -c dev

# 3. Publish it.
git push -u origin dev

# 4. On GitHub: Settings -> Branches -> default branch -> dev.
#    Vercel's PRODUCTION branch stays `main`. They are separate settings.

# 5. Teach THIS clone where the default went. GitHub changing it does not move
#    the local ref, and Claude Code's --worktree resolves "fresh" through it.
git fetch origin dev
git remote set-head origin -a
git symbolic-ref refs/remotes/origin/HEAD    # must print refs/remotes/origin/dev
```

**Step 5 is the one that bites if skipped.** `origin/HEAD` is a local ref in each clone and does not
follow a change made on GitHub. Miss it and the first worktree created afterwards branches from
`main` — production — and nothing says so. Repeat it on **every** clone, including the box and the
Mac. And keep the plan's rule: printing the base is not checking it. Worktree setup should assert
that its starting sha equals a freshly-fetched `origin/dev`.

Two things to do at the same time, both independent of worktrees:

- **Take `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` off the Vercel *Preview* environment.** They are
  present there today; `DATABASE_URL` and the service-role key are production-only, so a preview
  cannot reach the production database and fails cleanly at the store — but a preview build from an
  unreviewed commit currently carries spendable model keys. Removing an env var needs its value to put
  back, so this is Greg's to run, not an agent's.
- **The `deploymentEnabled` rule is already default-deny**, and it is worth knowing why that is safe
  rather than reading it as a risk. Vercel documents the precedence: *"If a branch matches multiple
  rules and at least one rule is `true`, a deployment will occur"*
  ([Git configuration](https://vercel.com/docs/project-configuration/git-configuration)). So the exact
  `main: true` cannot be suppressed by the deny glob, and the production build the deploy script waits
  for is safe. **`**`, not `*`** — minimatch's single star does not cross a slash, so `*: false` would
  miss a branch named `agent/foo`; checked against the repo's installed minimatch, not assumed.

### The AGENTS.md wording this needs, still to be approved

Rule changes to AGENTS.md go one approved set at a time
([edit-important-docs.md](../reusable/edit-important-docs.md)), and they would be wrong to land before
`dev` exists. One is needed when it does:

1. Under **Working in a tree several agents share** — commit and push to `dev`; `main` is written only
   by `npm run deploy`.

**And that is the only one**, because the workflow merges rather than rebases. An earlier draft wanted
a second change carving out a rebase exception for worktrees; choosing merge deletes it, and leaves the
"never run a git command that throws work away" rule whole. That is an argument for merge in itself —
[The workflow](#the-workflow) has the rest.

And [version-control.md](version-control.md) is a **required** step of the runbook, not an
afterthought: it currently says "`main`, and only `main`" and describes the old topology, so an agent
following it after the flip could push to production or mistake which branch is authoritative. It is
the source of truth for this, and a stale source of truth is worse than none.

And the convention Greg asked for, which belongs in AGENTS.md and
[engineering-manager.md](../reusable/engineering-manager.md): **push at the end of a piece of work.**
Rebel has the postmortem that argues for it — a fix that had been implemented, reviewed at 96/100 and
committed sat on an unmerged branch with no remote ref for 31 hours while the bug it fixed stayed
live. It is what makes a sweep's "merged" guard mean anything, and it is the only way work reaches the
remote box, which can see nothing unpushed.

## Runbook B: the Mac, later

The Mac's checkout is inside Dropbox, which is where most of the original plan's cost came from: a
worktree there means `node_modules` syncing to the cloud, and — the risk `git fsck` cannot see —
Dropbox restoring an older-but-valid ref into the shared `.git`, because every object in it is valid.

**Do this first, and most of the rest disappears:** move the checkout out of Dropbox, as this box
already is. Git supports moving a main worktree; do not delete worktrees to do it.

```bash
# Take an off-Dropbox backup before any of this.
# 1. Quiesce: stop every agent, dev server and editor holding the old path.
# 2. Record the registered paths — you will need them literally in step 4.
git worktree list --porcelain > ~/worktree-paths-before-move.txt
# 3. Move the primary out of Dropbox, e.g. to ~/code/spideryarn2.
# 4. Repair the links against the RECORDED paths, not a shell glob.
git worktree repair <each path from step 2>
# 5. From every worktree, verify: status, branch, common git dir, registered path.
```

Then run [Runbook A step 5](#runbook-a-flip-the-trunk-to-dev-not-yet-run) on the Mac — `git fetch
origin dev && git remote set-head origin -a` — or its first worktree silently branches from `main`.

If the move is not on yet, the Dropbox-tolerant version is: leave worktrees where Claude Code puts
them under `.claude/worktrees/`, add that path to `.gitignore`, and set the Dropbox ignore xattrs as
`node_modules` and `dist` already have. Note that ignoring a path **deletes Dropbox's copy of it**,
which is why `data/` was never ignored there.

Two Mac-only extras when a worktree is created: `tmutil addexclusion` on the new `node_modules`, and
nothing else — `npm ci --prefer-offline` is the same command on both machines, which is what makes it
the cross-platform answer rather than the copy-on-write cache the plan originally designed and
[deleted](../plans/260828r-worktrees.md#what-changed-on-2026-08-31-and-what-it-deletes).

## Traps

- **A worktree with an empty `data/` makes `npm test` meaningless.** A clean checkout costs ~50 test
  failures, not the 13 recorded in `deploy.ts`. The fix is the committed fixture corpus —
  [260901b-committed-fixture-corpus.md](../plans/260901b-committed-fixture-corpus.md) — and it is a
  **prerequisite** for worktrees, not a side quest.
- **Claude Code's own worktree cleanup cannot see `data/` or `.env.local`.** Both are gitignored, so a
  clean `git status` reports "safe" and then deletes real work. Any removal path must check
  `git status --porcelain=v1 --untracked-files=all` **and** `--ignored`.
- **Age of the last commit is the wrong clock** for deciding a worktree is abandoned: one created ten
  minutes ago from a month-old commit passes that test immediately. Record a creation timestamp at
  setup and age from that.
- **Every repo scanner walks into `.claude/worktrees/`** unless told not to — `SKIP` in
  `scripts/typecheck.ts`, `watch.ignored` in `vite.config.ts`, then `check.ts`, knip, biome, jscpd.
  Without this the primary typechecks ten peers' half-finished trees.
- **A `git worktree lock` held by a running session is not proof of activity.** A `SIGKILL`ed session
  leaves it behind. Fail closed and make a human clear it.
- **Timing numbers taken in the shared tree are close to worthless** — load averages of 200–400 are
  normal, and that is how `npm ci` came to be recorded at 130 s when it is 4–5 s. Disk and memory
  numbers are fine.
- And the rule all of this keeps proving: **break it on purpose first**
  ([silent-success.md](../reusable/silent-success.md)). The isolation Claude Code's worktrees provide
  is a documented guarantee, not a check anyone here has watched work.
