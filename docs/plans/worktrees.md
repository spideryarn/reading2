# Thirteen agents share one working tree, and the rules that make that survivable

Right now every agent in this repo edits `/Users/greg/Dropbox/dev/experim/spideryarn2`. At the
moment of writing there were **thirteen live sessions** in it. The rules in `CLAUDE.md` that forbid
`git stash`, `git reset --hard` and branch switching, and that require naming your files twice on
every commit, all exist because of that one fact. Git worktrees are the fix.

The obstacle is cost. Greg, 2026-08-28:

> is there a way to make creating a worktree cheap and to minimise network activity (e.g. we don't
> want to have multiple node_modules etc for each worktree), because I'm on a slow internet
> connection and I've regrettably put this folder into Dropbox.

This plan adapts the worktree scripts from
`~/dev/gdconsult_work/mindstone/MindstoneRebel/coding-agent-instructions`, which already solved the
expensive half of it, and throws away the two thirds of them that are about a different repo.

## The measurements, first

Every number below is from this repo, this laptop, 2026-08-28. **Disk figures are reliable. Times
are not** — load average was 433 while they ran, because the other twelve sessions were working.
Treat the times as upper bounds and the disk as fact.

Getting `node_modules` (591 MB, 30,759 files) into a new worktree:

```
                                 real disk   network   wall (load 433)
  npm ci --prefer-offline          625 MB     ~none        130 s
  npm ci --offline (strict)        625 MB      zero         —
  cp -c -R   (APFS clonefile)       29 MB      zero          50 s
  cp -R      (control)             658 MB      zero          73 s
  symlink                            0 MB      zero        instant
```

The `cp -R` control is there on purpose: without it, `cp -c` reporting success proves nothing about
whether blocks were actually shared. 29 MB against 658 MB for the same tree is the proof. Measured
as a free-space delta (`df -k` before and after), because `du` counts a cloned file's blocks twice
and cannot see the sharing.

Two findings matter more than the table.

**The network problem is already solved.** `~/.npm/_cacache` is **20 GB**. `npm ci --offline` — which
contacts no registry at all, and fails rather than falling back — exits 0 and produces all 32 `.bin`
shims. So worktrees cost disk and Dropbox sync. They do not cost bandwidth.

**A fresh install and the live `node_modules` are the same tree.** `npm ci --offline` into an empty
directory produced 30,512 files; the primary has 30,759. The whole difference is three cache
directories:

```
  node_modules/.vite         35 MB
  node_modules/.vite-temp   3.8 MB
  node_modules/.cache       2.4 MB
```

That is worth knowing twice over. It means a copy of the primary is equivalent to an install. And it
names the exact hazard in *sharing* one `node_modules` between worktrees: those three caches.
`vitest.config.ts` sets no `cacheDir`, so several worktrees would fight over one Vite dep-prebundle.
A shared or symlinked `node_modules` is out, and that is why — not on principle.

## Three bugs found on the way

### `npm run deploy` leaks a worktree registration every time it runs

[`scripts/deploy.ts`](../../scripts/deploy.ts) creates its gate worktree with `--lock`, then removes
it with `--force` **once**. Git needs `--force` twice to remove a locked worktree. Tested:

```
$ git worktree remove --force <locked worktree>
fatal: cannot remove a locked working tree, lock reason: ...
use 'remove -f -f' to override or unlock first
exit=128
```

`run()` ignores that exit code, the `rmSync` on the next line deletes the directory anyway, and the
registration survives pointing at nothing. **Fifteen of the twenty-two registered worktrees in this
repo are these ghosts.** A gate that reports success while leaving litter behind is the pattern in
[silent-success.md](../reusable/silent-success.md), and it went unnoticed for as long as it has
precisely because the deploy still passed.

`git worktree prune` does not clear them: it exempts locked entries by design, which is how they
accumulated to fifteen.

### The deploy lock can be held by two processes at once

[`scripts/deploy.ts:295`](../../scripts/deploy.ts) — found by Sol reviewing this plan, and verified:

```js
if (!existsSync(file)) return claim();      // ← check
...
const claim = () => { const fd = openSync(file, "w"); … }   // ← act. "w" never fails.
```

Check, then act, with a gap. Two deploys starting together both see no file, both claim it, and both
proceed — which is precisely the thing the lock's own comment says must never happen, because
"drizzle takes no lock of any kind" and the second run hits a `CREATE TABLE` that now exists.

This matters twice: it is a live bug, and the DB lease this plan adds must not copy the pattern. An
atomic claim is `mkdir`, or `open` with the `wx` flag, which fails when the file exists. Never
`existsSync` followed by a write.

### Dropbox is syncing all of it

No ignore attribute on anything:

```
  node_modules   syncing  591 MB
  data           syncing   27 MB
  .git           syncing   35 MB
  dist           syncing  1.8 MB
```

That is a cost being paid today, before any worktree exists.

Stopping it is one command per directory, but it takes **two** extended attributes, not one — current
Dropbox versions on the File Provider engine check both:

```bash
xattr -w com.dropbox.ignored 1 node_modules
xattr -w 'com.apple.fileprovider.ignore#P' 1 node_modules
```

Both set and read back cleanly here, but neither was confirmed visually against the Dropbox UI, so
check the grey-minus badge appears once before trusting it. Note what ignoring means: the directory
stays on the laptop and is **removed from the cloud and from other devices**. Right for
`node_modules`; a decision for `data/`.

There is also `rules.dropboxignore`, but it lives at the Dropbox **root** and is account-wide, not
per-project — a bigger blast radius than this problem needs. None exists on this machine today.

The installed Dropbox is 268.4.4072 with `DropboxFileProvider.appex` present, yet the repo sits at the
legacy-style `~/Dropbox/…` path rather than `~/Library/CloudStorage/Dropbox/…`, so which sync engine
actually backs this folder is genuinely ambiguous. Setting both xattrs covers either.

## What Greg decided

Asked four questions on 2026-08-28; these are the answers, and they drive everything below.

- **Dropbox** — *"My plan is to move the whole repo out of Dropbox, but there are a bunch of agents
  working. Let's assume that we're going to do it later, but defer it for now."*
- **The primary checkout** — he keeps working in it; agents get worktrees. *"without a dirty-primary
  hard-refusal (it won't be a big deal if new worktrees start out slightly behind)"*
- **Postgres** — one shared Supabase stack plus a migration lock.
- **Scale** — ten or more worktrees alive at once, like today.

The last two answers together **changed the dependency recommendation**. The first draft of this plan
proposed cloning `node_modules` straight from the primary, guarded by a lockfile hash. That is unsafe
once Greg is actively editing the primary *and* ten worktrees are cloning from it: the source is
mutable, and an install in progress is invisible to a hash of the lockfile. Rebel tried
clone-from-primary and reverted it for this reason. So this plan ports Rebel's actual design — a
separate fingerprint-keyed cache, populated only from a verified install.

## The layout

```
  Dropbox — syncs to the cloud            Not Dropbox — never leaves the laptop
  ───────────────────────────────         ──────────────────────────────────────
  ~/Dropbox/dev/experim/spideryarn2/      ~/dev/worktrees/spideryarn2/
    src/ docs/ tests/ …                     <slug-a>/    ← agent 1
    node_modules/   591 MB                  <slug-b>/    ← agent 2
    data/            27 MB                  <slug-c>/    ← agent 3
    .git             35 MB
                                          ~/.cache/spideryarn-worktree-nm/
                                            <fingerprint>/node_modules
                                            (one copy, cloned into each worktree)
```

Worktrees outside Dropbox is the whole answer to *"we don't want multiple node_modules per
worktree"* syncing. Dropbox never sees them. The cache is under `~/.cache` for the same reason, and
because APFS `clonefile` needs source and destination on one volume — verified, `/Users`,
`/Users/greg/.cache` and `/private/tmp` are all device `16777234`.

`.git` stays in Dropbox for now, by Greg's decision. **When the repo moves out**, every worktree's
recorded `gitdir` path breaks; the fix is one command from the moved primary:

```bash
git worktree repair ~/dev/worktrees/spideryarn2/*
```

Worth doing the move with no worktrees alive, and this plan's `doctor` command will say whether any
are.

## The scripts

Rebel's `init-worktree.sh` is 972 lines of bash and `sweep-worktrees.ts` another 608. Most of it is
about a repo this is not: git submodules, a `PROJECT_OVERRIDES.md` YAML config layer, CE2
orchestration, Electron, five subprojects, a 15 GB disk floor. This repo has no submodules, no
workspaces, one `package.json`, and **no `preinstall`, `postinstall` or `prepare` script at all** —
verified, which removes the main reason Rebel's cache needs its lifecycle-script handling.

Written in TypeScript run by `tsx`, matching `scripts/deploy.ts` and `scripts/check.ts`, rather than
bash — the repo's scripts are TypeScript, and "prefer boring" here means matching what is already
there.

```
  npm run worktree:new <slug>     create and provision
  npm run worktree:doctor         list, and name what is broken
  npm run worktree:rm <slug>      remove, with guards
```

### `worktree:new <slug>`

1. **Validate the slug** — lowercase, non-alphanumeric runs to a single `-`, reject if it normalises
   to empty. Refuse if `agent/<slug>` already exists or the path is occupied.
2. **Warn if the primary is dirty; do not refuse.** Print the base SHA either way, so a worktree that
   starts behind says so in its own creation log. Greg asked for a warning, not a gate.
3. **Branch from local `main`, not `origin/main`.** A deliberate change from Rebel, which defaults to
   the remote. Local `main` here is roughly **a hundred commits ahead of `origin/main`** and moving:
   it was 83 when this plan was drafted and 97 two hours later, during review. Copying Rebel's
   default unchanged would silently start every worktree months in the past. Provide `--from-origin`
   for the rare case that wants it.
   **Printing the base SHA is not a check.** Resolve the expected `main`, create the branch, then
   assert the new worktree's actual `HEAD` equals the SHA that was captured. A printed line nobody
   reads detects nothing.
4. `git worktree add --lock --reason initialising -b agent/<slug> <path> main`, then mark
   `INITIALIZING` in the git admin dir.
5. **`node_modules` from the CoW cache** — below.
6. **`data/` by `cp -c -R`** from the primary. Clone, not symlink: the tests create and delete
   directories under `data/`, so a link would point that at the real one — a trap
   [`deploy.ts`](../../scripts/deploy.ts) already documents. 27 MB apparent, roughly 1 MB real.
7. **`.env.local` copied, mode 0600.** Copy, not symlink, because each worktree needs its own port —
   and because one agent's edit to a symlink would change every running process at once. `.env.prod`
   is **not** provisioned: agents have no business holding production keys.
8. **Allocate a dev port** and write it into the copied `.env.local` — below.
9. `tmutil addexclusion` on `node_modules`. Backups cannot see CoW sharing, so an unexcluded tree
   costs the backup its full apparent size.
10. Mark `READY`, unlock, and print the absolute path on stdout with everything else on stderr.

The `INITIALIZING` → `READY` marker is worth keeping at this scale even though the script also has a
cleanup trap: a trap does not run on `SIGKILL` or a shutdown, and with ten worktrees a half-built one
will happen. It only earns its keep if `doctor` and `rm` refuse to treat a non-`READY` tree as
usable, so they must.

### The `node_modules` cache

Ported from Rebel's `worktree-postinit.sh`, minus the parts this repo doesn't need.

```
  fingerprint = sha256( cache-format version
                      + package-lock.json
                      + package.json
                      + .npmrc (project), if present
                      + full node version + module ABI
                      + full npm version
                      + platform + arch + libc
                      + the normalised install-shaping config )

  ~/.cache/spideryarn-worktree-nm/<fingerprint>/
      node_modules/
      COMPLETE            ← written last, and only after the smoke test passes
```

The flow, which is simpler than Rebel's because it never publishes from a worktree:

1. Compute the fingerprint.
2. Take **one blocking, atomic lock** on it — `mkdir`, or `open` with `wx`. Not the `existsSync`
   pattern above.
3. Re-check for a completed entry (another creation may have built it while we waited).
4. **`npm ci --offline --no-audit --no-fund` directly into a cache staging directory.** On failure,
   retry once with `--prefer-offline`, the only step in the whole flow that may touch the network.
5. Run the smoke test.
6. Atomic rename of staging into place, `COMPLETE` written last.
7. Same-device probe, then `cp -c -R` into the worktree. 29 MB.

Installing straight into the cache is Sol's improvement on Rebel and it removes a whole class of
problem. Rebel installs in a worktree and publishes afterwards, so the published tree can have been
touched by Vite or a test run in between — which is why it needs a delete-these-three-directories
list. A tree that has never been anything but a fresh `npm ci` needs no cleanup list, and **"pristine
by construction" is a better invariant than a denylist** that has to stay in step with whatever writes
into `node_modules` next.

A denylist would also be dangerous to generalise. `node_modules/drizzle-orm/cache` and
`node_modules/undici/lib/cache` are real package source. Anything that recursively deletes directories
named `cache` destroys the install.

**Never clone from the primary.** It is a tree Greg is editing.

**The smoke test has to run things.** "One `.bin` shim resolves" proves almost nothing — I checked
`@sentry/cli`'s binary the lazy way earlier in this work and concluded it was missing, when
`node_modules/.bin/sentry-cli --version` in fact prints `2.58.6`. So: execute `vite`, `tsx`, `vitest`,
`esbuild` and `sentry-cli`, and verify the embedded lockfile and fingerprint, before writing
`COMPLETE`.

### The install-script policy has to be committed, not hashed

An earlier draft of this plan reasoned that because the repo has no `preinstall`, `postinstall` or
`prepare` script, lifecycle scripts could be left out of the fingerprint. **That reasoning is wrong**,
and it is worth writing down because it is the kind of wrong that reads as careful.

Root scripts are not the issue. *Dependencies* have install scripts — five of them here: esbuild
(three versions), `@sentry/cli` and `fsevents`. npm 11 gates them behind `allowScripts`, and
`ignore-scripts`, `strict-allow-scripts` and `dangerously-allow-all-scripts` can each produce a
**different installed tree while `npm ci` still exits 0**. A cache keyed without them would serve a
tree built under one policy to a worktree expecting another, silently.

Hashing whatever configuration the invoking user happens to have is the fragile answer. The robust one
is to **commit the intended policy** to `package.json`/`.npmrc`, make unreviewed scripts fail closed,
and run every install with an explicit sanitised configuration. Then the policy is a repo fact that
lives in the fingerprint via the files themselves. npm's own documentation warns that `npm ci` must
use the same tree-shaping flags that produced the lockfile.

**Dropped from v1:** the non-blocking lock and the 21-day TTL prune. A non-blocking lock either lets
ten installs run at once or needs a fallback path nobody has specified; blocking is correct and the
wait is bounded by one install. Pruning becomes an explicit command later. It is safe whenever it
happens — a clonefile keeps its own blocks after the source is deleted.

The same-device probe is not optional. `cp -c` does **not** error across volumes — per `man cp` it
silently falls back to a full copy, which would cost 625 MB per worktree while logging success.

Cost at Greg's stated scale of ten worktrees. Ten plain installs are 10 x 625 MB = **6.25 GB**. One
cache entry plus ten clones is 625 MB + 10 x 29 MB = **0.92 GB**. A saving of about **5.3 GB**, on a
disk that is 91% full with 169 GB left. That is worth the machinery; the earlier draft of this plan
asserted "8.1 GB becomes 0.9 GB" without showing the multiplication, and 8.1 GB was thirteen
worktrees, not ten.

### Ports

[`vite.config.ts:208`](../../vite.config.ts) hardcodes `port: 5273`. Change it to read
`SPIDERYARN_DEV_PORT` with 5273 as the default, and **set `strictPort: true`**.

`strictPort` is the load-bearing half. Without it Vite silently takes the next free port, and an agent
then browses, screenshots and tests against a different worktree's server while everything reports
success. That is the failure this repo has been bitten by in other forms often enough to have written
a doc about it.

`worktree:new` scans sibling worktrees' `.env.local` files for used ports, takes the lowest free one
at or above 5274, and persists it. A scan-then-pick has a race between two simultaneous creations;
`strictPort` is what makes that race loud instead of silent.

**Changing the port breaks sign-in, and breaks it quietly.** `supabase/config.toml:217` pins
`site_url = "http://localhost:5273"`, and `additional_redirect_urls` lists that exact port and no
other. The file's own comment says what happens to a redirect that isn't on the list: it "falls back
to `site_url` and the reader lands on the shelf instead of where they were". So an agent on port 5274
gets an auth flow that appears to work and silently discards the return path.

The allow-list therefore has to cover the whole worktree port range, in `supabase/config.toml` — one
shared stack, so one edit:

```toml
additional_redirect_urls = [
  "http://localhost:5273", "http://localhost:5273/**",
  "http://127.0.0.1:5273", "http://127.0.0.1:5273/**",
  # …and the same four lines for 5274 through 5283, the worktree range.
]
```

Which caps the number of concurrent worktrees at whatever range is listed — ten, matching the stated
scale. `worktree:new` must **refuse** when the range is exhausted rather than allocating a port that
is not on the list, because the resulting failure is invisible.

### Postgres

One shared local Supabase stack, per Greg's decision. `supabase/config.toml` pins `project_id =
"spideryarn2"` and the 5436x port block, so every worktree points at the same stack with no work.

Two additions make that survivable:

- **A migration lease.** A lock file wrapping `db:migrate`, `db:reset` and any DB-backed test run, so
  two agents cannot migrate one database at once, and a schema change cannot land underneath another
  worktree's test run.
- **A `test:db` that fails closed.** About a dozen Postgres suites currently *skip themselves
  silently* when the database is down — a misconfigured worktree would report green while testing
  nothing. `test:db` must fail when the database is absent or the migration head is not what the
  checkout expects. `npm test` can stay usable without a database; schema and store work must run
  `test:db` before landing.

Per-worktree databases were considered and rejected: the schema depends on `auth.users`, and Supabase
Auth and Storage stay bound to the project's main database, so it is half-isolation that would not
hold. If concurrent schema work ever becomes normal, the answer is separate full stacks with distinct
project ids and port blocks, not separate databases inside one.

### Landing

Agent branches get **no upstream**, so a bare `git push` fails rather than finding a path to `main`.
This is a deliberate departure from Rebel, which sets `push.default=upstream` so a worktree pushes
straight to the integration branch — seductive for a solo repo, and exactly the shape of accident the
`CLAUDE.md` rules exist to prevent.

```bash
# in the worktree, clean and committed
npm test && npm run typecheck
git rebase main
npm test && npm run typecheck

# in the primary
git merge --ff-only agent/<slug>
npm run worktree:rm <slug>
```

`--ff-only` fails safely if `main` moved after the tests ran; rebase and test again.

### What changes in `CLAUDE.md`

Inside a one-agent worktree the shared-index reasoning disappears, but not all of the rules should go
with it, and this is worth stating explicitly or agents will guess:

- `git commit -- <paths>` — no longer needed for safety, still worth doing so generated files don't
  ride along. **Still mandatory in the primary**, which stays shared.
- `git stash` — **stays banned everywhere.** The stash ref is global across worktrees, so it is
  ambiguous rather than merely local.
- `git restore`, `git clean`, `git reset --hard` — **stay banned for agents.** They no longer
  threaten anyone else's work, but they still destroy that agent's only uncommitted copy.
- `git rebase` — allowed in a worktree on a clean, committed agent branch. Still banned in the
  primary.

## Ranked failure modes

Ordered by how much they cost times how quietly they happen.

| # | Failure | Silent? | What actually catches it |
|---|---|---|---|
| 1 | Worktree branches from `origin/main`, silently omitting ~100 local commits | **yes** | resolve `main` to a SHA, create, then **assert the worktree's `HEAD` equals it**. Printing it detects nothing |
| 2 | DB suites skip themselves; or one worktree's migration moves the schema under another's test run | **yes** | `test:db` fails closed on absent DB or wrong migration head; the lease held for the **whole suite**, claimed atomically |
| 3 | Deploy leaves a locked registration behind | **yes, today** | `--force --force`, and *check the exit code* |
| 4 | `cp -c` silently full-copies | **yes** | same-device probe is necessary but **not sufficient** — it proves cloning is possible, not that it happened. Assert the free-space delta on the first clone |
| 5 | Agent's browser session hits a different worktree's dev server | **yes** | `strictPort` only makes the *second server* fail; the browser still connects to the first. Needs an atomic port lease **and** an identity endpoint reporting worktree and commit, which browser checks assert |
| 5b | A worktree's port is absent from `additional_redirect_urls`; sign-in appears to work but drops the return path | **yes** | list the whole range in `config.toml`, **restart Supabase and verify the live container** — the file is not re-read automatically ([setup-dev.md](../project/setup-dev.md)) — and refuse to allocate outside the list |
| 6 | Init dies after `worktree add`; tree exists, deps and env are partial | **yes** | `INITIALIZING`/`READY`; `doctor` and `rm` refuse a non-`READY` tree |
| 7 | A cache entry is published from a broken install | **yes** | smoke test **executes** vite, tsx, vitest, esbuild, sentry-cli and checks the embedded fingerprint; `COMPLETE` written last |
| 7b | Cache serves a tree built under a different install-script policy | **yes** | commit the policy; fail closed on unreviewed scripts; policy files feed the fingerprint |
| 8 | Two worktrees generate the same Drizzle migration number | **yes** | rebasing does **not** prevent this and `drizzle-kit check` sees only its own branch's history. Needs branch-level exclusivity on schema work, plus collision detection after rebase |
| 9 | Agent pushes its branch straight to `main` | usually not | `--no-track` explicitly, then **verify** the branch has no upstream |
| 10 | Two worktrees each pay for the same new `data/` artefact; or a clone captures a torn write | **yes, until the bill** | "treat it as exclusive" is policy, not detection — this one stays genuinely open, see below |
| 11 | Dropbox writes back an older-but-valid ref into the shared `.git` | **yes** | `fsck` **cannot** see this — every object is valid. Only an off-Dropbox backup and reflog comparison will |
| 12 | `rm` deletes untracked work — `data/` artefacts, a `.env.local` an agent edited | **yes** | a clean `status` plus an ancestor check reports safe and deletes it anyway, because both are gitignored. Record a manifest of ignored state at creation; refuse removal when it has changed, unless given an explicit discard flag |

Rows 10 and 11 are the two this plan does not close. Row 10 needs a global content-hash lease that
does not exist yet. Row 11 is only fully answered by moving the repo out of Dropbox — until then, a
verified bundle stored outside Dropbox is the mitigation, and it should be taken **before** rollout,
because local `main` is a hundred commits ahead of `origin/main` and that is currently the only copy.

## What this deliberately does not do

- **pnpm.** This is the one with a real case. pnpm has an [official page for exactly this
  problem](https://pnpm.io/git-worktrees): set `virtualStoreType: global` in `pnpm-workspace.yaml`
  and every worktree's `node_modules` becomes symlinks into one global store — near-zero per-worktree
  cost, instant creation, and worktrees may even hold different dependency versions without
  colliding. It is the purpose-built answer and it beats the CoW cache on every axis except one: it
  is a third exception to "prefer boring" on top of Postgres and shadcn, a migration off
  `package-lock.json`, and a non-hoisted layout that surfaces phantom-dependency breaks in any code
  importing something it did not declare. The CoW cache gets most of the benefit for none of that.
  Worth revisiting if worktrees become permanent and heavy. (pnpm's own caveat — do not share one
  writable store between mutually untrusted agents — does not apply here.)
- **A shared or symlinked `node_modules`.** Measured above: the three cache directories live inside
  it. There is a second, independent reason. esbuild does not follow symlinks without
  `--preserve-symlinks`, which then breaks its own watch-mode change detection; and both esbuild and
  Rollup have a known class of bug where a module reached through a symlink resolves to a realpath
  *outside* `node_modules`, defeating any logic that asks "is this a dependency?". This repo is vite,
  which is both of them.
- **`ditto`.** It makes real copies, not clonefiles. `cp -c` is the only thing that clones.
- **Cloning `node_modules` and then running `npm ci` as a correctness pass.** Tempting and
  self-defeating: `npm ci` deletes `node_modules` before installing, so it throws the clone away and
  you pay the full install anyway. The fingerprint is the correctness check; there is no cheap second
  one.
- **Per-worktree Supabase stacks.**
- **Rebel's `PROJECT_OVERRIDES.md` YAML layer, submodule object sharing, disk pre-check, plan-document
  matching, and the 608-line classify/age policy.** A `doctor` that names ghosts and half-built trees
  is what this repo needs; the merge-status guards belong on `rm`, not in a separate tool.
- **An off-the-shelf worktree tool.** There is a small 2025–26 ecosystem aimed at exactly this — `uzi`
  (worktrees plus port ranges for parallel agents), `gwq`, `agentree`, `git-worktree-runner`,
  `worktree-cli` (an MCP server for Claude Code that copies `.env` and runs setup hooks), and
  `container-use`, which isolates in containers instead. All are recent and single-maintainer, none is
  standard, and none of them knows about our Supabase port pinning or the `data/` clone. The script
  described here is most of what they do.

## Order of work

Reordered after review: nothing that creates a worktree ships before the shared-database and removal
safeguards exist, because both of those failures are silent and land on work that is not in git.

1. ~~**Fix the two `deploy.ts` bugs**~~ — **done, 2026-08-28.** `scripts/lockfile.ts` and
   `scripts/worktree-admin.ts`, both used by `deploy.ts`, both reused later by steps 4 and 5. All
   sixteen ghosts classified and cleared (fifteen gone, one from an interrupted run — clean, detached,
   its commit already in `main`).

   **The lock does not steal a stale lock, and that is a deliberate change.** Review found that
   `read it, decide it is dead, unlink, create` lets two processes both take the same leftover: the
   second unlinks the first one's *new* lock. POSIX has no unlink-if-unchanged, so it cannot be made
   safe with ordinary file operations. A leftover is now reported with the `rm` command to clear it.
   Affordable because `process.on("exit")` already releases on every death except `SIGKILL`.
   **Step 4's database lease inherits this** — it must not reintroduce stealing.
2. **Define the deterministic install contract**: commit the install-script policy, then the minimal
   cache — blocking atomic lock, install straight into cache staging, executing smoke test.
3. **Ports as one unit**, because half of it is worse than none: atomic port lease, `SPIDERYARN_DEV_PORT`
   + `strictPort` in `vite.config.ts`, the `config.toml` allow-list *with a Supabase restart and a
   live-container check*, and an identity endpoint a browser check can assert against.
4. **The DB lease and a `test:db` that fails closed.**
5. **`scripts/worktree.ts`: `new`, `doctor`, `rm`** — including the ignored-file manifest that stops
   `rm` deleting untracked `data/` and `.env.local` work.
6. **Docs alongside each step, not batched at the end**: `CLAUDE.md`, and `docs/project/worktrees.md`
   parented under [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md).
7. **Later, when the tree is quiet: the Dropbox move.** Not by deleting ten useful worktrees — git
   supports moving the main worktree and repairing the links. Quiesce first (stop agents, servers and
   editors holding the old path), record `git worktree list --porcelain`, move, then
   `git worktree repair` against the **recorded paths rather than a shell glob**, then verify from
   every worktree that status, branch, common git dir and registered path are right. Take the
   off-Dropbox backup before any of it.
