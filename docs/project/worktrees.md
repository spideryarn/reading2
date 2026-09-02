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
| [`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts) | Forced removal of a throwaway worktree, a `--porcelain -z` parser, and `ghosts()` for the sweep that does not exist yet. |
| [`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) | `DEPLOY_SOURCE_BRANCHES` and `deployBranchProblem` — `npm run deploy` accepts **`dev` alone** since the flip, and refuses `main` and any `worktree-*` branch by name. Plus `trunkGap`, below. |
| the `level with origin/dev` gate | **Being on the trunk is not being level with it.** `preflight` only ever compared against `origin/main`, which proves the candidate contains current *production* and says nothing about current *trunk* — so a stale `dev` could promote code missing commits that had landed, and report success. The gate requires the captured sha to equal a freshly fetched `origin/dev`, and fails closed if the trunk cannot be read. Forcible as `--force-gate='level with origin/dev'`. |
| [`vercel.json`](../../vercel.json) | `git.deploymentEnabled` is default-deny — `{"**": false, "main": true}` — so only production builds. |
| [`.gitignore`](../../.gitignore) | `.claude/worktrees/` — where `claude --worktree <name>` puts a worktree. Ignored rather than merely untracked, because the primary would otherwise see every peer's whole checkout as untracked files and the commit recipe leans on `git status` being readable. |
| [`.worktreeinclude`](../../.worktreeinclude) | `.env.local` and `.env`, copied into each new worktree. `.env.prod` deliberately absent, so an agent in a worktree cannot deploy. |
| [`scripts/typecheck.ts`](../../scripts/typecheck.ts) | `.claude/worktrees` in `SKIP_PATHS`. **The one scanner that actually walks in** — it recurses from the repository root, so a worktree's `tsconfig.json` became a project of the primary's. A **joined path, not a basename in `SKIP`**, because `.claude/` also holds the tracked hooks and settings, and skipping every directory of that name would hide a TypeScript hook added there later. biome, knip and jscpd need nothing: their globs are anchored allowlists. |
| [`vite.config.ts`](../../vite.config.ts) | `server.watch.ignored` gains `**/.claude/worktrees/**`, so a peer's keystrokes do not reload your page. Plus a startup warning when the port is not allow-listed — see [Ports and the ceiling](#ports-and-the-ceiling). |
| [`scripts/worktree-port.ts`](../../scripts/worktree-port.ts) | The range, `PRIMARY_PORT`, `portInRange`, `parseDevPortEnv` and `allowListedPorts`. **No allocator**: Greg redirected the design to dynamic allocation on 2026-09-01, and the reservation, its tests and an export added to `lockfile.ts` for it were deleted — see [Ports and the ceiling](#ports-and-the-ceiling). |
| [`supabase/config.toml`](../../supabase/config.toml) | `additional_redirect_urls` covers **5273–5303**, matching `DEV_PORT_RANGE` exactly, so sign-in works on whichever port a worktree lands on. GoTrue bakes the list in at start, so editing it needs a Supabase restart. |
| [`scripts/worktree-setup.ts`](../../scripts/worktree-setup.ts) | `npm run worktree:setup`, run **inside** a worktree. Installs dependencies, materialises the corpus, and says what is still missing. **Refuses in the primary**, because it runs `npm ci` — see below. |
| [`scripts/corpus-materialise.ts`](../../scripts/corpus-materialise.ts) | The corpus copy, extracted from `deploy.ts` so the gate and the setup script share one implementation rather than two that drift. |
| [`.claude/settings.json`](../../.claude/settings.json) | `worktree.baseRef: "head"` — worktrees branch from the primary's local `HEAD`, not from the remote. See [Why not the remote](#why-a-worktree-branches-from-head-and-not-from-the-remote). |

Still to build: an identity endpoint, the database lease, and `worktree:sweep` —
[the plan's work list](../plans/260828r-worktrees.md#what-is-left-to-do). The auth allow-list is
done.

## Starting one

```bash
claude --worktree my-thing      # creates .claude/worktrees/my-thing, branch worktree-my-thing
npm run worktree:setup         # inside it: dependencies + the article store
npm test                        # expect ~14 of 477 files red, about what the primary has
npm run dev                     # walks up from 5273; warns if the port is not allow-listed
```

**`worktree:setup` refuses to run in the primary checkout**, and that guard is the most important line
in it: it runs `npm ci`, which deletes `node_modules` and reinstalls it, and a dozen agents work out of
the primary. It asks git rather than guessing from the path — in a worktree `--git-dir` is
`…/.git/worktrees/<name>` while `--git-common-dir` is the primary's `.git`; in the primary they are
identical. Verified by running it in the primary and checking `node_modules` came out with the same
inode and mtime.

### Why a worktree branches from `HEAD` and not from the remote

`worktree.baseRef: "head"` in [`.claude/settings.json`](../../.claude/settings.json), rather than the
default `"fresh"`, which branches from the default branch **on the remote**. Measured on 2026-09-01:

```
  origin/main   ←  8 commits            these are the Mac's deploys
  local main    →  60 commits ahead     this box's work since the last deploy
```

`origin/main` only moves when somebody deploys, so a worktree branching from it starts *sixty commits
stale* and cannot see anything done here today. `"head"` gives it the primary's current committed
state; uncommitted peer edits do not travel, because a worktree is a fresh checkout of commits.

It also means GitHub's default branch does not matter here, which is the one part of [Runbook
A](#runbook-a-flip-the-trunk-to-dev-done-2026-09-02) still outstanding: `"fresh"` would resolve
through `origin/HEAD`, and `"head"` never asks. So a worktree created today branches from this box's
`dev` regardless of what GitHub still says its default is.

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
```

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
2. **`origin/dev` already existed**, at `e3ef75f` from the previous day's spike, 57 commits behind.
   It was a strict ancestor, so the push fast-forwarded and no force was needed — but the runbook
   read as though it were creating the branch, and a diverged `origin/dev` would have needed a
   decision rather than a `push -u`.

### Still outstanding, and both are Greg's

- **GitHub: Settings → Branches → default branch → `dev`.** There is no authenticated `gh` on this
  box (`gh auth status`: *"You are not logged into any GitHub hosts"*), so this cannot be done from
  here. Until it is, a fresh `git clone` checks out `main`, and `set-head -a` in any clone undoes
  step 3. **Vercel's production branch stays `main`** — a different setting in a different place.
- **The Mac**, whenever it is next in use:

  ```bash
  git fetch origin dev && git switch -c dev origin/dev && git remote set-head origin dev
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

The steps from [Runbook A](#runbook-a-flip-the-trunk-to-dev-done-2026-09-02) the Mac still needs are
listed there, and the spelling matters: **`git remote set-head origin dev`, not `-a`.** An earlier
version of this line said `-a`, which would ask GitHub — whose default branch is still `main` — and
put `origin/HEAD` back on production.

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
