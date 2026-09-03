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
true today, what was decided, and the two runbooks — both now run.

## Where this stands

**`claude --worktree <name>` plus `npm run worktree:setup` works end to end**, including sign-in.
The trunk is `dev` as of 2026-09-02 ([Runbook A](#runbook-a-flip-the-trunk-to-dev-done-2026-09-02)).
What is built:

| | |
|---|---|
| [`scripts/lockfile.ts`](../../scripts/lockfile.ts) | Atomic file lock. **Never steals a stale lock** — so a `SIGKILL`ed holder leaves a file a human must `rm`, and the error message says which. Deliberate: never two writers. |
| [`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts) | Forced removal of a throwaway worktree, a `--porcelain -z` parser, and `ghosts()`, which the sweep now uses. |
| [`scripts/worktree-sweep.ts`](../../scripts/worktree-sweep.ts) | `npm run worktree:sweep`, run in the **primary**: which trees have landed, and the removal of one that has. Owns only what one tree cannot see — enumeration, ghosts, the 24h age floor — and asks `worktree:check` everything else. See [Sweeping them up](#sweeping-them-up). |
| [`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) | `DEPLOY_SOURCE_BRANCHES` and `deployBranchProblem` — `npm run deploy` accepts **`dev` alone** since the flip, and refuses `main` and any `worktree-*` branch by name. Plus `trunkGap`, below. |
| the `level with origin/dev` gate | **Being on the trunk is not being level with it.** `preflight` only ever compared against `origin/main`, which proves the candidate contains current *production* and says nothing about current *trunk* — so a stale `dev` could promote code missing commits that had landed, and report success. The gate requires the captured sha to equal a freshly fetched `origin/dev`, and fails closed if the trunk cannot be read. Forcible as `--force-gate='level with origin/dev'`. |
| [`vercel.json`](../../vercel.json) | `git.deploymentEnabled` is default-deny — `{"**": false, "main": true}` — so only production builds. |
| [`.gitignore`](../../.gitignore) | `.claude/worktrees/` — where `claude --worktree <name>` puts a worktree. Ignored rather than merely untracked, because the primary would otherwise see every peer's whole checkout as untracked files and the commit recipe leans on `git status` being readable. |
| [`.worktreeinclude`](../../.worktreeinclude) | `.env.local` and `.env`, copied into each new worktree. `.env.prod` deliberately absent, so an agent in a worktree cannot deploy. |
| [`scripts/typecheck.ts`](../../scripts/typecheck.ts) | `.claude/worktrees` in `SKIP_PATHS`. **The one scanner that actually walks in** — it recurses from the repository root, so a worktree's `tsconfig.json` became a project of the primary's. A **joined path, not a basename in `SKIP`**, because `.claude/` also holds the tracked hooks and settings, and skipping every directory of that name would hide a TypeScript hook added there later. biome, knip and jscpd need nothing: their globs are anchored allowlists. |
| [`vite.config.ts`](../../vite.config.ts) | `server.watch.ignored` gains `**/.claude/worktrees/**`, so a peer's keystrokes do not reload your page. Plus a startup warning when the port is not allow-listed — see [Ports and the ceiling](#ports-and-the-ceiling). |
| [`scripts/worktree-port.ts`](../../scripts/worktree-port.ts) | The range, `PRIMARY_PORT`, `portInRange`, `parseDevPortEnv` and `allowListedPorts`. **No allocator**: Greg redirected the design to dynamic allocation on 2026-09-01, and the reservation, its tests and an export added to `lockfile.ts` for it were deleted — see [Ports and the ceiling](#ports-and-the-ceiling). |
| [`supabase/config.toml`](../../supabase/config.toml) | `additional_redirect_urls` covers **5273–5303**, matching `DEV_PORT_RANGE` exactly, so sign-in works on whichever port a worktree lands on. GoTrue bakes the list in at start, so editing it needs a Supabase restart. |
| [`scripts/worktree-setup.ts`](../../scripts/worktree-setup.ts) | `npm run worktree:setup`, run **inside** a worktree. Merges `origin/dev`, installs dependencies, materialises the corpus, and says what is still missing. **Refuses in the primary**, because it runs `npm ci` — see below. |
| [`scripts/worktree-freshen.ts`](../../scripts/worktree-freshen.ts) | The merge, on its own: fetch `origin/dev` and merge it into the worktree's branch, refusing over modified tracked files and stopping on a conflict. Why the merge rather than a different `baseRef` is [below](#why-a-worktree-branches-from-head-and-then-merges-the-remote). |
| [`scripts/corpus-materialise.ts`](../../scripts/corpus-materialise.ts) | The corpus copy, extracted from `deploy.ts` so the gate and the setup script share one implementation rather than two that drift. |
| [`scripts/worktree-check.ts`](../../scripts/worktree-check.ts) | `npm run worktree:check`, run **inside** a worktree: **is it safe to delete this directory?** Reads only. Fails closed on every unknown, and the part no other signal covers is the gitignored one — it compares `data/` and `output/` against the committed fixture corpus file by file, so a pipeline run nobody committed shows up as a blocker rather than as silence. See [Before you remove one](#before-you-remove-one). |
| [`.claude/hooks/primary-checkout-notice.sh`](../../.claude/hooks/primary-checkout-notice.sh) | `SessionStart` hook: in the primary it prints one line telling the agent to call `EnterWorktree` before editing code; in a worktree it says nothing. A nudge, not a refusal — Greg, 2026-09-02: a SessionStart print, "but not a hard refusal". |
| [`.claude/settings.json`](../../.claude/settings.json) | `worktree.baseRef: "head"` — worktrees branch from the primary's local `HEAD`, not from the remote, and `worktree:setup` then merges `origin/dev` on top. See [below](#why-a-worktree-branches-from-head-and-then-merges-the-remote). |

Still to build: an identity endpoint —
[the plan's work list](../plans/260828r-worktrees.md#what-is-left-to-do). The auth allow-list is
done, and so is the sweep, which landed on 2026-09-02 in two pieces on the same day:
`worktree:check` answers for **one** tree and prints, and `worktree:sweep` reads across every tree
and is the only thing that removes one. The sweep asks `blockers(gather(path))` for its per-tree
verdict rather than deriving a weaker one from `git status` — one judgement, in one place, so the
two cannot quietly disagree.

**The "database lease" on that list is half built already, and not where the plan looks for it.**
`db:migrate` has taken a Postgres advisory lock since before worktrees —
`MIGRATION_LOCK_KEY` in [`scripts/migration-ledger.ts`](../../scripts/migration-ledger.ts), taken as
`pg_try_advisory_lock` in [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) and held across the
preflight as well as the migrate. So migrator-against-migrator is safe. What is not covered is
migrate against a running test suite, and `db:reset`, which takes nothing —
[260902c](../plans/260902c-concurrent-migrations-across-worktrees.md#6-locking-moves-to-its-own-plan)
hands that to a plan of its own and it is not written yet.

**What two worktrees do to `drizzle/meta/` is closed, as of 2026-09-02.** Both generating from one
trunk fork the snapshot chain, and the next `drizzle-kit generate` refuses on it and **exits 0
having written nothing**. Migrations now carry timestamp prefixes, `npm run check` gates
`drizzle-kit check`, `npm test` walks the chain, and `npm run db:generate` requires that success
produced output. The repair depends on whether the losing migration is published, hand-edited, or
merely generated —
[database.md § Two worktrees generated at once](database.md#two-worktrees-generated-at-once) is the
runbook.

**The limit no lock can lift**: a non-additive migration — a dropped column — applied by one
worktree breaks the running dev server of every other worktree at once. One shared database, one
schema; the advisory lock serialises the writers and cannot do anything about that.

## Starting one

```bash
claude --worktree my-thing      # creates .claude/worktrees/my-thing, branch worktree-my-thing
npm run worktree:setup         # inside it: merge origin/dev, dependencies, the article store
npm test                        # expect a handful red, about what the primary has at the same moment
npm run dev                     # walks up from 5273; warns if the port is not allow-listed
```

### The dev server used to be blind in here — fixed 2026-09-02

Worth knowing even though it is fixed, because for four days a worktree's `npm run dev` **could not
see its own edits** and nothing said so. `vite.config.ts` ignores `**/.claude/worktrees/**` so the
primary's page does not reload on a peer's every keystroke; chokidar matches that against absolute
paths, and a worktree's absolute path contains `.claude/worktrees/` — so inside one, the pattern
excluded the server's whole source tree. The app still loaded and still worked; it just served the
source it read at boot, for ever. An agent measuring its own change in a browser was shown the code
from before the change.

`devWatchIgnored` in [`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts) now drops the
glob inside a worktree, with the two cases tested. The reasoning, the three-way proof and the lesson
about path rules that name a directory you can also be standing in are in
[260902a-a-dev-server-that-ignored-its-own-source.md](../postmortems/260902a-a-dev-server-that-ignored-its-own-source.md).

**Until a command does it for you: restart the dev server before you measure anything in a browser.**
Any observation taken against a server started before your edits is worthless, and it does not look
worthless.

**`worktree:setup` refuses to run in the primary checkout**, and that guard is the most important line
in it: it runs `npm ci`, which deletes `node_modules` and reinstalls it, and a dozen agents work out of
the primary. It asks git rather than guessing from the path — in a worktree `--git-dir` is
`…/.git/worktrees/<name>` while `--git-common-dir` is the primary's `.git`; in the primary they are
identical. Verified by running it in the primary and checking `node_modules` came out with the same
inode and mtime.

### Why a worktree branches from `HEAD` and then merges the remote

`worktree.baseRef: "head"` in [`.claude/settings.json`](../../.claude/settings.json), rather than the
default `"fresh"`, which branches from the default branch **on the remote**. Measured on 2026-09-01:

```
  origin/main   ←  8 commits            these are the Mac's deploys
  local main    →  60 commits ahead     this box's work since the last deploy
```

`origin/main` only moves when somebody deploys, so a worktree branching from it starts *sixty commits
stale* and cannot see anything done here today. `"head"` gives it the primary's current committed
state; uncommitted peer edits do not travel, because a worktree is a fresh checkout of commits.

It also means GitHub's default branch does not matter here — it was the last part of [Runbook
A](#runbook-a-flip-the-trunk-to-dev-done-2026-09-02) to land, on 2026-09-02, and this setting is why
the wait cost nothing: `"fresh"` would resolve through `origin/HEAD`, and `"head"` never asks. A
worktree branches from this box's `dev` whatever GitHub says, and whatever a stale `origin/HEAD`
says.

**But `HEAD` is stale too, and since the flip to `dev` it is stale in the other direction.** The
argument above was written when the trunk was `main`, which only a deploy moves. `dev` moves every
time any agent finishes something, and the primary is only as current as the last time somebody
pulled into it. Measured on 2026-09-02, minutes after Runbook A landed:

```
  local dev   ←  7 commits behind origin/dev
```

So a worktree created that minute started seven commits stale, and nothing said so. Greg, 2026-09-02:

> When we start a new worktree, ideally it would initialise that worktree with the latest changes
> from dev remote, rather than the primary checkout (because that might be stale).

The fix is **not** to flip `baseRef` to `"fresh"`. Branching from the remote drops any commit the
primary has and has not pushed, and this box has had both at once. Branching from `HEAD` and then
**merging** `origin/dev` keeps both — and merge is what this repo does anyway
([version-control.md](version-control.md#always-merge-never-rebase)). That merge is the first thing
`worktree:setup` does, before `npm ci`, because the merge can move `package-lock.json` and installing
the old one first leaves `node_modules` describing a lockfile that is gone.

Three things it will not do, each because the alternative loses work:

- **It will not merge over modified tracked files.** In a fresh worktree there are none; in one you
  re-run setup in, there might be. It says so and carries on to the install.
- **It will not resolve a conflict.** The tree is left mid-merge and setup stops, because a conflict
  is a proposal before it is an edit —
  [git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md).
- **It will not pretend a failed fetch means "current".** Offline, you get a `FAIL` line naming the
  command to run by hand, not a green tick.

[`tests/worktree-freshen.test.ts`](../../tests/worktree-freshen.test.ts) builds a real origin, a real
primary that is behind it and a real worktree of that primary, and asserts the *number of commits
recovered* rather than merely that a merge ran — a merge of a trunk you already contain passes the
weaker test and proves nothing.

### What a worktree costs, measured rather than assumed

```
  npm ci --prefer-offline      16.6 s      at load average 3.75, so not a load artefact
  node_modules                  681 MB     thirty worktrees is ~20 GB; /home has 43 GB
  npm test, bare                 95 of 477 files fail, most unable to collect at all
  npm test, after setup          14 of 477 files fail
```

The plan had 4–5 s and 564 MB, both from an earlier measurement, and both optimistic. The 95 → 14 is
what `worktree:setup` buys, and it is the number that made a worktree worth having: the bare run also
*collected* 1,137 fewer tests, so its lower raw failure count was hiding the problem rather than
showing it.

**And then measured again on the Mac, 2026-09-02, because those are the Linux box's numbers and
nobody had run this here.** It works end to end, and every figure is better:

```
  npm run worktree:setup        6.8 s      the npm cache was warm
  the whole worktree           637 MB      558 MB of it node_modules
  npm test, after setup          4 of 504 files fail
  npm test, in the primary       4 of 504 files fail    at the same moment, 254 s against 65 s
  npm run typecheck              clean, 989 files
  npm run dev                    landed on 5274 and correctly said nothing
```

Two things worth keeping from it. **The primary's own count is the only baseline worth comparing
to** — the failing files were not quite the same set in both, because peers are hitting the shared
Supabase throughout, so an absolute number would have read as a worktree defect. And the port warning
staying silent on 5274 is the *right* answer now rather than the old bug: the allow-list covers the
range, so there was nothing to warn about. It was checked against the running container when that
landed, not against the file.

## What Greg decided, 2026-09-01

1. **This Linux box first.** The plan was written on the Mac, where the repo lives inside Dropbox and
   that drives a lot of its cost. This box is at `/home/greg/code/spideryarn2`, outside Dropbox, so
   the Dropbox questions do not apply here at all. The Mac keeps sharing one tree for now —
   see [Runbook B](#runbook-b-the-mac-done-2026-09-01).
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

# and to see just your own branch's changes — for a review, or a scoped diff:
git diff origin/dev...HEAD     # THREE dots. Two is a trap; see below.
```

**Type the three dots.** `git diff origin/dev..HEAD` — two — is a live comparison against wherever
`origin/dev` has got to, and it renders commits *other agents landed* as deletions your branch makes.
That is not a display problem: the workflow hands GPT Sol "the scoped diff" as review evidence, so a
two-dot diff spends a review on phantom findings, or gets an agent to "restore" the phantom deletions
and silently revert landed work. Three dots compares against the merge base — where you actually
forked — which is the question you meant. [Below](#traps) for why this bites here in particular.

Three things follow from `push origin HEAD:dev`, and they are all improvements:

- **No stray branches on the remote**, so no preview builds from them, so the `deploymentEnabled`
  question shrinks to the trunk itself.
- **The "did it land?" test becomes one command** — `git merge-base --is-ancestor HEAD origin/dev` —
  which is what makes a safe sweep possible at all.
- **Integrate by merging, never by rebasing.** That is now a repo-wide rule rather than a worktrees
  one, with its six reasons in
  [version-control.md § Always merge, never rebase](version-control.md#always-merge-never-rebase), and
  it applies **inside your own worktree** as much as in the shared primary. An earlier draft of this
  doc had it the other way round and claimed the workflow *required* rebase. It does not: it requires
  **integration** before a push to a moved `dev`, and merge is integration. Greg settled it on
  2026-09-01, and the settling deleted work — the ban in
  [AGENTS.md](../../AGENTS.md#working-in-a-tree-several-agents-share) stays whole rather than growing a
  carve-out.

`main` is still written **only** by a gated `npm run deploy`, which pushes one gated sha
(`git push origin <sha>:refs/heads/main`) rather than the branch you are standing on. That is why
moving the trunk to `dev` costs one line in [`scripts/deploy.ts`](../../scripts/deploy.ts) rather than
a rewrite, and why Vercel's git auto-deploy on `main` must stay **on** — the script polls for the
production build that the push causes.

## Before you remove one

```bash
npm run worktree:check          # inside the worktree, before anyone deletes it
```

One question — **would deleting this directory lose anything?** — and it fails closed on every part
of the answer it cannot get. Read-only: it never removes the tree, and it never will, because the
whole reason it can afford to be blunt is that nothing follows automatically from what it prints.

`git status` is not this check, and that is the point:

- **`data/`, `output/` and `.env.local` are gitignored**, so committing and pushing does not save
  them and a clean `git status` says nothing about them. The corpus halves are compared against
  [`tests/fixtures/data-root/`](../../tests/fixtures/data-root) **file by file, by content**, so a
  pipeline run somebody paid for shows up by name. Claude Code's own cleanup has this same blind
  spot — see [Traps](#traps) — and **so does git**: `git worktree remove` refuses over modified and
  untracked files but not over ignored ones, so for the case that matters most there is no second
  guard behind this one.
- **A copy elsewhere is checked, not assumed.** `.env.local` and `.claude/settings.local.json` are
  compared byte for byte against the primary's, because they arrive by being copied and an edit made
  only here exists nowhere else. They were plain "worth an eye" notes until a GPT Sol review pointed
  out that a worktree whose only uncommitted state was an edited `.env.local` printed SAFE.
- **Tracked files can be hidden from `git status`** by `assume-unchanged` or `skip-worktree`. That
  bit lives in this worktree's own index, so it goes with the directory and so does the edit.
- **"Nothing unpushed" is not "it landed."** The native sweep asks the first; this asks the second,
  with `git merge-base --is-ancestor HEAD origin/dev` after a **fresh fetch**. A fetch that fails is
  `unknown`, which blocks — a stale remote-tracking ref answers a question about an hour ago.
- A half-finished merge, cherry-pick, rebase or bisect lives in the git dir and can sit under a
  clean-looking tree.

Anything it does not recognise is a blocker rather than a shrug, so a new `.gitignore` entry makes it
cautious instead of silent. What it does not check is printed when it passes rather than left to be
discovered: file modes under `data/`, a commit reachable only through this worktree's HEAD reflog
(which needs a branch-moving operation [AGENTS.md](../../AGENTS.md) bans), and whatever is only in the
session's context.

It answers for the tree you are standing in and takes no arguments. For every tree at once, and for
the removal itself, see below — the sweep calls `blockers(gather(path))` here rather than keeping a
cheaper copy of the same judgement.

### Sweeping them up

```bash
npm run worktree:sweep                                    # read-only. Deletes nothing.
npm run worktree:sweep -- remove --branch <name> --dry-run
npm run worktree:sweep -- remove --branch <name>
```

**`remove` takes one branch and has no bulk form**, and re-runs the whole classification — fresh
fetch included — before each deletion, so a verdict cannot be carried from an earlier decision into a
later removal. Three things it owns that `worktree:check` deliberately does not, because they need the
primary's vantage point or would be wrong inside a single tree:

- **Ghosts** — a registration whose directory is gone. Unregistered, but its **branch is left alone**:
  the tree is gone, and its commits are not this command's to judge.
- **You are standing in it.**
- **The 24-hour age floor.** A worktree touched this recently is never removable, however landed. This
  is not caution, it is the bug that retired the sibling repo's sweep: a fresh tree whose tip equals
  the trunk passes the merged check trivially, and since `worktree:setup` merges `origin/dev` that is
  the *normal* state of every worktree here for its first day. `worktree:check` has no age floor and
  should not — asked inside a three-hour-old landed tree it is right to say "safe", because the person
  standing in it knows whether they are done.

Two things worth knowing about how it is wired:

**It fetches once, not once per tree.** `gather()` fetches the trunk for itself, which is right for
one tree and is one shared ref fetched thirty times across thirty. The sweep calls `fetchTrunkSha`
once and passes the **sha** down — a sha and not a ref name, because a ref can be moved under you by
any peer between the fetch and the test, which is the hazard `FETCH_HEAD` was chosen to dodge. A
failed central fetch makes every tree `UNKNOWN`, never removable.

**A tree it cannot read is `UNKNOWN`, kept, and still printed.** One tree's failure never costs you
the others' answers, and a tree that silently dropped out of the list would be the failure mode where
success is the absence of something.

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

#### The run lock does not reach far enough — measured 2026-09-03

**Read [testing.md § the run lock](testing.md) first; most of this ground is already covered there.**
Contention between concurrent test *files* was measured on 2026-08-30 (23–50 failures per run with
the lock neutralised, 0 with it taken), it produces exactly the `expected 'busy' to be 'claimed'`
shape, and `takeRunLock` is the fix. None of that is new here, and an earlier draft of this section
claimed it was.

What is new is a case the lock cannot cover, and testing.md predicts it in one line: *"a lock only
excludes the holders that agree to take it, and a dev server mid-ingest never will."*

On a box carrying eleven worktrees, `tests/store-jobs-parity.test.ts` failed with
`expected 'busy' to be 'claimed'` and **kept failing away from the full suite**. Counting the rows
explained it:

```
select status, count(*) from spideryarn.jobs group by status
  →  error 48 · done 4 · running 3 · cancelled 1 · queued 1
```

`running: 3`, and the job concurrency cap is three (`CONCURRENCY_ENV`,
[`src/jobs.ts`](../../src/jobs.ts)). None of the three belonged to the worktree running the test. The
cap is **deliberately global** — counted across every row, which is what makes the lease design
correct in production — so the store answered `busy` correctly about a machine that other worktrees
had filled.

**That suite takes the run lock** (`tests/store-jobs-parity.test.ts` § `takeRunLockAndSetUp`), so
this is not the 2026-08-30 case wearing a new hat. The lock serialises the holders that take it. It
cannot exclude a dev server mid-ingest, and it cannot remove rows an earlier crashed or killed run
left sitting at `running` — and either is enough to fill a **global** counter that every worktree
reads. So the residue, not the concurrency, is what got through.

Three things follow, and they are why this is a sharper argument than flakiness:

- **Re-running in isolation does not clear it.** Isolation clears a timeout. It clears this only if
  the other worktrees happen to be idle, which a test run can neither arrange nor detect.
- **The failure is plausible rather than obviously spurious.** `busy` is a real status with a real
  meaning, so it reads as a genuine cap violation. The cost is not a re-run; it is an agent debugging
  a concurrency bug that does not exist.
- **It scales the wrong way** with the number of agents, which is the direction this repo is going.

So the question to weigh is not "how much time do flaky suites cost" but **"how long before a shared
global counter makes somebody believe a false thing about the code"** — which it already has.

**And there is a cheaper thing to try first, which is why this is evidence and not yet a
recommendation:** if the residue is the problem rather than live concurrency, then sweeping orphaned
`running` rows at the start of a test run may buy most of what a schema per worktree would, for
almost nothing. Nobody has measured how often those rows are left, or by what. That measurement is
the honest next step — the same conclusion this section reaches above, arrived at from a different
direction.
Reproduced by [260903d](../plans/260903d-improve-the-codebase-second-sweep.md) § T1.3.

## Ports and the ceiling

**The design changed on 2026-09-01, after the reservation allocator was built and reviewed.** Greg
asked whether the init script should probe for a free port, mark it, and be able to change its mind if
something outside our control took it — and then answered his own question: *"maybe it's better to
just make the whole thing dynamic"*. He is right, and the reason is worth keeping:

**`bind()` is already an atomic port allocator, and the kernel is a better arbiter than any file we
can write.** A reservation file answers "does another worktree claim this port", which is only a proxy
for "can I listen on it" — and a weak proxy both ways, since a reserved port can be taken by something
outside this repo and an unreserved one can be free. Vite already walks upward from the configured
port when `strictPort` is false, so *dynamic is less machinery, not more*. And nothing actually needs a
stable port: the auth allow-list accepts any port in the range, which was the unexamined assumption
underneath the whole reservation idea.

The tell was his own "change its mind" requirement. A reservation needs a release path, a staleness
rule, a sweep step and a story for a `SIGKILL`ed holder. Dynamic allocation needs none of those,
because it re-decides on every start.

So the shape is: start at the bottom of the range, let Vite walk, and **check the resolved port after
`listening`**. `reservePort` and friends came out — `scripts/worktree-port.ts` went from 287 lines to
about 150, and the export it had needed from `scripts/lockfile.ts` went back to being private.

**And the check reads `supabase/config.toml`, not our own range constant** — which is the one part of
this that had to be found by running it rather than reasoning. A worktree's dev server walked to 5274,
landed inside `DEV_PORT_RANGE`, and said nothing, while sign-in on 5274 was in fact broken: the
allow-list names **only 5273**. The warning had rebuilt the silent failure it existed to prevent, one
level up. It now parses the file, so it tells you what is true today rather than what will be true
after somebody extends the list — and it says which of the two situations you are in.

The identity endpoint below becomes *more* important, not less: it is what stops a stale browser tab
reaching a peer's server, and a reservation never guaranteed your process was the listener either.


Half of this is worse than none, because each half hides the other's failure:

1. ~~`SPIDERYARN_DEV_PORT` in `vite.config.ts`, with `strictPort: true`~~ — **half done, and the half
   that was dropped is the interesting one.** The port is
   `parseDevPortEnv(process.env.SPIDERYARN_DEV_PORT) ?? PRIMARY_PORT`, so the primary is on 5273
   exactly as before, and a value that is *set but malformed* now **throws** rather than falling back —
   `Number(x) || 5273` on a typo turned a worktree into a second server on the primary's port.

   **`strictPort` was written, then deliberately removed.** The reasoning for it was good: an occupied
   5273 makes Vite drift to 5274, which is not on the auth allow-list, so a Google sign-in *succeeds*
   and drops the reader at the bare site URL with nothing saying why ([setup-dev.md](setup-dev.md)).
   GPT Sol pointed out what that trade actually costs in this tree, and it was right: a dozen agents
   share one checkout, so **a fallback server is genuinely useful** for everything except sign-in —
   especially for server work, because the API middleware is imported at server boot, so you cannot
   rely on a peer's existing 5273 process reflecting your own changes. `strictPort` would leave that
   agent stuck. And the evidence was immediate: at the time of writing, ports **5273 to 5277 were all
   listening**, so shipping it would have broken the next `npm run dev` for everybody.

   So the fallback stays and the *silence* goes: a `spideryarn-port-warning` plugin says so after
   `listening`, where the port is known rather than asked for. Verified both ways — loud on 5310,
   silent on 5290. `strictPort` belongs here once the whole port system is wired, not before.
2. ~~An **atomic port lease**~~ — **done as a persistent reservation, and nothing reads it yet.**
   [`scripts/worktree-port.ts`](../../scripts/worktree-port.ts), 27 tests. Not a hash: at ten worktrees
   in a 30-wide range that collides ~99.96% of the time. Not a scan-then-pick, whose failure is subtler
   (two setups starting together both see 5274 free and both take it) — the claim *is* the test, via
   `publishExclusive` from [`scripts/lockfile.ts`](../../scripts/lockfile.ts).

   **And not a lock, which was a real bug caught in review.** The first version used `takeLockFile`,
   which registers `process.on("exit", release)` — right for a lock, fatal here, because
   `worktree:setup` claims a port and *exits*, so the reservation would evaporate on the way out and
   the next setup would hand out the same port. No test in the file could have caught it: they all hold
   their reservations inside one vitest process, which is exactly the case where a lock looks fine.
   There are now two tests that spawn a real `npx tsx`, claim, exit, and assert the file is still
   there — and they go red if you put the lock back.

   **The reservations live in the shared git directory** — `git rev-parse --git-common-dir`, so
   `spideryarn-worktree-ports/<port>.reserved` beside the repository rather than inside any one
   checkout. Two properties fall out of that rather than needing arranging: every worktree sees the
   same set, and they cannot be committed by accident. Each file names its holder, so a full range can
   tell you who to ask. `DEV_PORT_RANGE` is the only place the range is written down; 5273 is the
   primary's and is **never** handed to a worktree; and an out-of-range port is refused, not clamped —
   for every candidate, not just an explicitly requested one.
3. ~~The `additional_redirect_urls` range in [`supabase/config.toml`](../../supabase/config.toml)~~ —
   **done, 2026-09-01.** The list now covers 5273–5303, exactly `DEV_PORT_RANGE`, and the two agreeing
   is the point: while they disagreed, the startup warning sat silent on a port where sign-in was
   broken. Verified in the running container, not just the file — GoTrue bakes the list in at start
   and never re-reads it, so the file is never the answer
   ([setup-dev.md](setup-dev.md)).

   **The restart cost 48 seconds**, taken deliberately after checking that no agent was touching the
   database: all 17 connections were Supabase's own services. `supabase stop` keeps the data — it is
   not a reset — and it reported `backup: true`, "Starting database from backup", with 17 articles and
   4 users still there afterwards.

   **The wildcard was not used, and the reason is a warning about testing.**
   `http://localhost:52*/**` would have replaced 66 entries with two, and GoTrue does glob-match the
   list. But the glob-in-a-port question cannot be answered cheaply: `/auth/v1/authorize` returns an
   identical 302 to Google for an allow-listed port, an unlisted port **and**
   `http://evil.example/steal`. Validation happens at the callback, so observing it needs a real OAuth
   round trip. The probe was built to test the wildcard and instead proved it could not — which is why
   the verbose, known-good list is what shipped. An untested entry guarding a silent failure is worse
   than a long one.
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

## Runbook A: flip the trunk to `dev` (done, 2026-09-02)

**Ran on this box at 06:23 on 2026-09-02**, once the other agents had committed and pushed and the
tree was genuinely empty — `git status --porcelain=v1 --untracked-files=all` printed nothing, and
`main` was level with `origin/main` at `ba6882a`.

```bash
git switch -c dev                    # label move: HEAD sha unchanged, 0 files touched
git push -u origin dev               # e3ef75f..ba6882a  (fast-forward, no force)
git remote set-head origin dev       # NOT -a; see below
```

`git switch -c dev` is the command AGENTS.md tells you to ask about, and the reason it was safe here
is worth stating rather than assuming: it creates a branch at the current `HEAD`, so it is a label
move and not a checkout. That was **checked rather than trusted** — the sha before and after, and the
dirty-file count before and after, both compared. In a tree with uncommitted work it would still be
the wrong command to reach for without asking.

**No deployment fired.** All 20 most recent Vercel deployments carry `githubCommitRef: main`. The
newest is the same sha as the `dev` push, which on its own proves nothing — so the check that counts
is the timing: it was created at 06:18:21, and the `dev` push was at 06:23:05. The deployment
predates the push it might have been mistaken for.

### Two corrections to the runbook as it was written

1. **`git remote set-head origin -a` was wrong, and wrong in the direction that hides.** `-a` means
   *ask the remote*, and GitHub's default branch is a **separate setting** that had not been flipped
   yet — so `-a` would have queried GitHub, been told `main`, and quietly set `origin/HEAD` straight
   back to production. The explicit `git remote set-head origin dev` is what this step needs while
   the two disagree. `-a` reads like the careful option, which is exactly the problem.

   **This expired later the same day.** GitHub's default branch became `dev` on 2026-09-02, so the
   two settings now agree and `-a` is the right command again — it asks the remote and is told
   `dev`. The correction was true of a window, not of the command, and the general form is the one
   worth keeping: `-a` delegates the answer to a setting somewhere else, so it is only ever as
   correct as that setting.
2. **`origin/dev` already existed**, at `e3ef75f` from the previous day's spike, 57 commits behind.
   It was a strict ancestor, so the push fast-forwarded and no force was needed — but the runbook
   read as though it were creating the branch, and a diverged `origin/dev` would have needed a
   decision rather than a `push -u`.

### Both of these are now done — 2026-09-02, from the Mac

- **GitHub's default branch is `dev`.** It could not be done from the box, which has no
  authenticated `gh` (`gh auth status`: *"You are not logged into any GitHub hosts"*); the Mac has
  one, so `gh api -X PATCH repos/spideryarn/reading2 -f default_branch=dev`. **Vercel's production
  branch stays `main`** — a different setting in a different place, and it was read before and after
  rather than assumed: `link.productionBranch` on the project is explicitly `"main"`, so it does not
  fall back to the repo default and a push to `dev` cannot promote itself.

  **A clone that has not re-run `set-head` still answers `main`.** GitHub's setting does not reach
  anybody's `origin/HEAD`; each checkout has its own copy. So on every clone including the box:

  ```bash
  git fetch origin dev && git remote set-head origin -a
  git symbolic-ref refs/remotes/origin/HEAD     # must print refs/remotes/origin/dev
  ```

  `-a` rather than the explicit spelling, now that the two settings agree — see correction 1 above.
- **The Mac is on `dev`**, done the same day with the merge form rather than the switch form, since
  it had two local commits to bring along:

  ```bash
  git fetch origin dev && git switch dev && git merge main && git remote set-head origin -a
  ```

  The older recipe, for a Mac with nothing local to carry:

  ```bash
  git fetch origin dev && git switch -c dev origin/dev && git remote set-head origin -a
  ```

  It is on `main` today, and `npm run deploy` now refuses from `main` (below), so a deploy attempted
  there before this will stop with `on branch 'main', not dev`. That is a clear refusal rather than a
  surprise, which is why the flip did not wait for it.
- **Take `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` off the Vercel *Preview* environment.** They are
  present there today; `DATABASE_URL` and the service-role key are production-only, so a preview
  cannot reach the production database and fails cleanly at the store — but a preview build from an
  unreviewed commit currently carries spendable model keys. Removing an env var needs its value to put
  back, so this is Greg's to run, not an agent's.

### `npm run deploy` no longer accepts `main`

`DEPLOY_SOURCE_BRANCHES` in [`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) is `["dev"]`
alone; it held both names through the changeover. Narrowing it was the point of the flip rather than
tidying after it, because **`main` is the one deploy path with no trunk comparison**: `trunkGap` is
scoped to `TRUNK_BRANCH` by design, so a checkout still standing on `main` could promote main-only
work and leave `dev` silently behind production. The `origin/main` ancestry check would catch the
*next* deploy and demand a merge — which is the divergence being found one deploy late.

Deploying still writes `main`, by sha and by name. The trunk moving does not move production.

**The `deploymentEnabled` rule is already default-deny**, and it is worth knowing why that is safe
rather than reading it as a risk. Vercel documents the precedence: *"If a branch matches multiple
rules and at least one rule is `true`, a deployment will occur"*
([Git configuration](https://vercel.com/docs/project-configuration/git-configuration)). So the exact
`main: true` cannot be suppressed by the deny glob, and the production build the deploy script waits
for is safe. **`**`, not `*`** — minimatch's single star does not cross a slash, so `*: false` would
miss a branch named `agent/foo`; checked against the repo's installed minimatch, not assumed.

### The AGENTS.md wording (approved and landed, 2026-09-02)

Rule changes to AGENTS.md go one approved set at a time
([edit-important-docs.md](../reusable/edit-important-docs.md)); Greg approved both of these. The
bullet under **Working in a tree several agents share** said the primary *"is moving off `main` onto
`dev`"*, which had happened, and *"Pushing to `main` will still deploy"*, which was true but read as
permission. It now says: commit and push to `dev`, a push there builds nothing, and `main` is
production written only by `npm run deploy`.

The second was the convention Greg asked for: **"Commit when the work is done… and push it."**
Unpushed work is invisible to the other machine and to every check that asks whether it landed.

**And that is the only one**, because the workflow merges rather than rebases. An earlier draft wanted
a second change carving out a rebase exception for worktrees; choosing merge deletes it, and leaves the
"never run a git command that throws work away" rule whole. That is an argument for merge in itself —
[The workflow](#the-workflow) has the rest.

[version-control.md](version-control.md) was a **required** step of this runbook rather than an
afterthought, and is done: its `Branch` row said "`main`, and only `main`", which would have led an
agent following it to push to production or to mistake which branch is authoritative. A stale source
of truth is worse than none.

The push convention also belongs in
[engineering-manager.md](../reusable/engineering-manager.md), which does not have it yet.
Rebel has the postmortem that argues for it — a fix that had been implemented, reviewed at 96/100 and
committed sat on an unmerged branch with no remote ref for 31 hours while the bug it fixed stayed
live. It is what makes a sweep's "merged" guard mean anything, and it is the only way work reaches the
remote box, which can see nothing unpushed.

## Runbook B: the Mac (done, 2026-09-01)

**Nothing to do here.** While this work was going on, another agent moved the Mac's checkout out of
Dropbox to `~/dev/spideryarn/reading2` (`276aabe` and `6cb277e`, and its own plan under
`docs/plans/`). Verified from that commit: inode 574720701 before and after, which is the check that
separates a move from a copy, with artefact counts and Supabase row counts identical.

So **the whole Dropbox dimension of the worktrees plan is gone**, on both machines:

- No `.claude/worktrees/` inside a synced folder, so no xattrs to set and no question about whether
  ignoring a path deletes its cloud copy.
- The risk `git fsck` could never see — Dropbox restoring an older-but-valid ref into the shared
  `.git`, because every object in it is valid — no longer exists anywhere.
- `node_modules` at 681 MB per worktree costs disk and nothing else.

What still applies on any machine after a move like that, and is worth keeping because the next one
will need it: `git worktree repair` against the **recorded** paths from `git worktree list --porcelain`
rather than a shell glob, and then verifying status, branch, common git dir and registered path from
every worktree.

The Mac has since run the steps from
[Runbook A](#runbook-a-flip-the-trunk-to-dev-done-2026-09-02) — it is on `dev`, and its
`origin/HEAD` points there. This line spent a day insisting on **`git remote set-head origin dev`,
not `-a`**, which was right while GitHub's default was still `main` and stopped being right the
moment that flipped. Either spelling lands on `dev` today.

## Traps

- **A worktree with an empty `data/` makes `npm test` meaningless.** A clean checkout costs ~50 test
  failures, not the 13 recorded in `deploy.ts`. The fix is the committed fixture corpus —
  [260901b-committed-fixture-corpus.md](../plans/260901b-committed-fixture-corpus.md) — and it is a
  **prerequisite** for worktrees, not a side quest.
- **Claude Code's own worktree cleanup cannot see `data/` or `.env.local`.** Both are gitignored, so a
  clean `git status` reports "safe" and then deletes real work. Any removal path must check
  `git status --porcelain=v1 --untracked-files=all` **and** `--ignored`.
  [`npm run worktree:check`](#before-you-remove-one) is the one that does — nothing stops the native
  cleanup, so run it first.
- **Age of the last commit is the wrong clock** for deciding a worktree is abandoned: one created ten
  minutes ago from a month-old commit passes that test immediately, and so does one that merged the
  trunk by fast-forward, which writes no commit at all. Solved without the recorded creation timestamp
  this trap used to ask for: `lastActivityAt` in
  [`scripts/worktree-sweep.ts`](../../scripts/worktree-sweep.ts) takes the **branch reflog's** top
  entry too — that moves when the branch is created and on every merge — and the mtime of the
  worktree's own `.git/worktrees/<name>`, which is the only one of the three a **detached** worktree
  has. Without that third signal a detached tree checked out from an old commit is born looking
  abandoned, which is this same trap arriving through the one door the reflog does not cover. Latest
  of the three wins.
- **`git diff origin/dev..HEAD` in a worktree shows other agents' landed commits as your deletions.**
  Two dots is a live comparison against wherever `origin/dev` has reached, so every commit it has that
  you do not reads as a deletion on your side. Use `git diff origin/dev...HEAD`, three dots, which
  compares against the merge base.

  **This is not caused by worktrees**, and believing it is will get you two-dotting confidently in the
  primary. Any checkout has it the moment it fetches. What the shared `.git` removes is your control
  over *when*: `refs/remotes/` lives in the common directory, so a **peer's** fetch moves `origin/dev`
  between two of your own commands while you sit still — and since 2026-09-02 every
  `npm run worktree:setup` fetches, so this now happens whenever anyone starts a worktree.
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
