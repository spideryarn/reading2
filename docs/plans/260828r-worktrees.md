# Thirteen agents share one working tree, and the rules that make that survivable

Right now every agent in this repo edits `/Users/greg/Dropbox/dev/experim/spideryarn2`. At the
moment of writing there were **thirteen live sessions** in it. The rules in `CLAUDE.md` that forbid
`git stash`, `git reset --hard` and branch switching, and that require naming your files twice on
every commit, all exist because of that one fact. Git worktrees are the fix.

The obstacle is cost. Greg, 2026-08-28:

> is there a way to make creating a worktree cheap and to minimise network activity (e.g. we don't
> want to have multiple node_modules etc for each worktree), because I'm on a slow internet
> connection and I've regrettably put this folder into Dropbox.

The first version of this plan adapted the worktree scripts from
`~/dev/gdconsult_work/mindstone/MindstoneRebel/coding-agent-instructions`. **That is no longer the
answer** — see the next section. The reasoning in the middle of this document is kept because it
records what was rejected and why, but the work list at the bottom is much shorter than it was.

## What changed on 2026-08-31, and what it deletes

Four of this plan's premises stopped being true in the three days after it was written. Each one
removes work rather than adding it. A third Sol review then put two pieces back — see
[the reviews](#status) — so the net is a noticeably smaller build, not a trivial one.

**1. Claude Code has native worktrees, and this machine has them.** `claude --version` is 2.1.252 and
`claude --help` lists `-w, --worktree [name]` and `--tmux`. The documented feature
([code.claude.com/docs/en/worktrees](https://code.claude.com/docs/en/worktrees)) already provides
creation, branch selection, copying gitignored files in, a `git worktree lock` held while a session
runs, a stale-lock sweep, and — the part no script of ours was going to do well — **tool-level
isolation**: `Edit`/`Write` targeting the main checkout are blocked, as is a Bash command whose
working directory resolves there, and as is `git -C`/`--git-dir`/`GIT_DIR` pointed back at it. So
`scripts/worktree.ts` shrinks to the things the feature does not do: install dependencies, allocate a
port, and decide when a worktree is finished.

**2. `npm ci` is not slow, so the `node_modules` cache is not worth building.** Measured twice today
in an empty directory with a warm cache:

```
  npm ci --prefer-offline --no-audit --no-fund     4–5 s     564 MB real     28,909 files
```

Deterministic across both runs, and `vite`, `tsx`, `vitest`, `esbuild`, `sentry-cli`, `drizzle-kit`
and `biome` all execute from it. The old figure of 130 s was taken at load average 433 and was an
artefact of the shared tree, exactly as the document warned. **The entire fingerprint-keyed CoW cache
— step 2, the largest piece of work in the plan — buys 4 seconds and about 11 GB on a disk with
333 GB free. Delete it.** Rebel reached the same conclusion by a different route and reverted its
own version (`docs/plans/260611_worktree-postinit-cow-root/PLAN_HARRY_REVERT_260611.md`): its
measured saving was ~11 s, and cloning from a live checkout was unsound because the primary's
installed tree routinely lags its own lockfile.

**3. The box is ext4, so a copy-on-write cache could never have been the shared answer.** Greg's
answer on scope was "both, start with whichever is easiest, and only fork by OS if absolutely
necessary". `/home` and `/` on the Hetzner box are both ext4, which has no reflink; `cp --reflink=auto`
there silently makes a full copy. APFS `cp -c` is macOS-only. `npm ci --prefer-offline` is the same
command on both machines and touches no link of any kind, which is what makes it the cross-platform
answer as well as the cheap one.

**4. `origin` is current, and the trunk is becoming `dev`.** Local `main` is 5 commits ahead of
`origin/main`, not the ~100 this plan was written against. That kills the reason for branching from
local `main` (see step 3 of the old `worktree:new`), and it means "merged and pushed" becomes a
checkable property — which is what a sweep needs. Greg has chosen the dev-branch trunk; see
[Step 0](#step-0-the-dev-branch-and-what-it-costs) below.

### Status

**Step 1 of the old seven is done and committed (`96c7661`, 2026-08-28). Nothing creates a worktree
yet.** Steps 2 and 5 are largely deleted by the above. Read this section, [Step 0](#step-0-the-dev-branch-and-what-it-costs)
and [What is left to do](#what-is-left-to-do); the middle of the document is the reasoning and can be
read as needed.

What exists now:

| | |
|---|---|
| [`scripts/lockfile.ts`](../../scripts/lockfile.ts) | Atomic file lock. **Never steals a stale lock** — see step 1 below. Used by the deploy gate; step 4's database lease is the next caller. |
| [`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts) | `forceRemoveThrowawayWorktree` (both `--force` flags, exit code returned), plus a `--porcelain -z` parser and `ghosts()` for step 5's `doctor`. |
| [`scripts/deploy.ts`](../../scripts/deploy.ts) | Uses both. Teardown failures are now `record()`ed instead of swallowed. |
| [`src/monitoring.ts`](../../src/monitoring.ts), [`src/web/monitoring.ts`](../../src/web/monitoring.ts) | Sentry now needs a deployment as well as a DSN. Unrelated to worktrees; found because the plan copies `.env.local` into every worktree. |

Also done, outside the code: the sixteen stale worktree registrations were classified and cleared,
and `node_modules` and `dist` are marked ignored to Dropbox.

Three reviews are worth reading before continuing, because each one changed the design:

- [`260828r-worktrees-review-sol.md`](260828r-worktrees-review-sol.md) — the plan review.
- [`260828r-worktrees-code-review-sol.md`](260828r-worktrees-code-review-sol.md) — the code review. Its findings 4, 5
  and 6 are all addressed; its finding 1 is why the lock does not steal.
- [`260828r-worktrees-review-2-sol.md`](260828r-worktrees-review-2-sol.md) — the review of *this*
  revision, and the most useful of the three, because it was asked to attack the deletions. It
  accepted the two big ones (the cache, the single install mechanism) and caught two places where
  machinery had been removed that was load-bearing: **the port hash, which collides ~99.96% of the
  time at ten worktrees**, and **the assumption that Claude Code's cleanup protects `data/`, which it
  cannot, because ignored files are invisible to every check it makes**. Both are fixed above; both
  were verified here rather than taken on trust.

### Things that will waste your time if you do not know them

- **Twelve or more agents work in this tree at once.** `npm test` is not reliably green and the
  failures are usually not yours: peers mid-edit in `src/web/`, and concurrent runs colliding on the
  one shared Postgres (a literal `duplicate key (slug)=(constitution)`). Check whether a failing test
  imports anything you touched before believing it.
- **Load averages of 200–400 are normal here.** Vitest's default 5 s timeout turns healthy code red.
  Three tests in `tests/lockfile.test.ts` spawn `npx tsx` and carry a 60 s timeout for this reason.
- **A worktree at HEAD is not a usable baseline.** One was built for this work and thrown away:
  `tsx` crashed inside it and its Postgres suites skipped for environment reasons, so a comparison
  would have measured the environment rather than the change.
- **Timing numbers taken in this tree are close to worthless**; disk numbers are fine. Every timing
  in this document is marked accordingly.
- **`npm run typecheck` reports `rename-preview.tsx` "checked by no project".** Pre-existing,
  untracked, Greg's. Not yours, do not fix it.

## The measurements, first

> **Re-measured 2026-08-31, and the conclusion inverted.** The times below were taken at load average
> 433 and the document says so, but the number that mattered — 130 s for `npm ci` — was wrong by a
> factor of thirty. On a quiet machine it is **4–5 seconds for 564 MB and 28,909 files**, twice in a
> row, with every binary executing. The table below is kept because the *disk* figures were sound and
> because the `cp -R` control is still the right way to prove clonefile sharing. But it is what made
> the cache look worth building, and it should be read with the correction in mind.
>
> Two other numbers here have moved: `node_modules` is now **1.2 GB rather than 591 MB** — though
> 636 MB of that is leaked `.vite-temp` files, not dependencies — and the disk has 333 GB free rather
> than 169 GB. Both push the same way.

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
clone-from-primary and reverted it for this reason. So this plan ported Rebel's actual design — a
separate fingerprint-keyed cache, populated only from a verified install. **That is now deleted too**,
for the simpler reason that a plain install costs 4 seconds; see point 2 above.

### And on 2026-08-31

Three more answers, which set the shape of everything below.

- **The trunk** — *"dev branch as trunk, promote to main"*. Agents pull and push `dev`; `main` stays
  the production branch that Vercel deploys. [Step 0](#step-0-the-dev-branch-and-what-it-costs).
- **Which machines** — *"Both. Start with whichever is easiest. I would consider slightly different
  approaches for the different operating systems, but only if absolutely necessary."* So: one
  mechanism unless something forces a fork. Nothing does, now that the CoW cache is gone.
- **What this session was for** — *"Think through any issues that we haven't already got a good
  answer for, and then update the official plan doc."* No code was written.

## Step 0: the dev branch, and what it costs

**Ship this first, on its own.** It is worth doing whether or not worktrees ever happen, it is a
prerequisite for them (agent branches need something to branch from and merge into), and it is much
smaller than it looks.

Today every agent commits on `main`, and `npm run deploy` pushes `main` to `origin`, which is what
triggers the Vercel production build. So every push is a deploy. Greg's answer:

> maybe we switch to working out of a dev branch, and pull/push to that, and then every so often
> trigger a proper deploy with a script that pushes main? Maybe that latter idea would be best?
>
> — Greg, 2026-08-31

### `npm run deploy` is already the promotion script

This is the finding that makes the change cheap. [`scripts/deploy.ts`](../../scripts/deploy.ts)
does not deploy by pushing the branch you are on. It captures one sha, gates it, and then pushes
**that sha by name** into `main`:

```js
git push origin <sha>:refs/heads/main          // deploy.ts:1334
```

and then polls the Vercel API until a production deployment *of that sha* is `PROMOTED`. Everything
around it already treats `origin/main` as "what is live" rather than as "the branch I work on":

| line | what it does | with a `dev` trunk |
|---|---|---|
| 323 | refuses unless `HEAD` is on `main` | **the one line that must change** — accept `dev` |
| 335–342 | fetch `origin/main`, refuse if the sha is behind it | still right, and now more meaningful: production really is an ancestor |
| 570 | `git diff origin/main <sha>` to spot a lockfile change | still right |
| 1334 | push the gated sha to `main` | unchanged — this *is* the promotion |

`grep` finds no other `main` or `origin/main` in `scripts/deploy.ts`, and none at all in
`scripts/deploy-checks.ts`. What that file *does* use is Vercel's own `target === "production"`
concept ([`deploy-checks.ts:278`](../../scripts/deploy-checks.ts), and the `&target=production` query
at [`deploy.ts:903`](../../scripts/deploy.ts)), which follows whatever the dashboard has set as the
production branch rather than any branch string. So nothing there changes under any design.

**Two ways to do it, and the second one is a trap in this repo.**

- **Accept `dev` at line 323** and let the script keep pushing the gated sha into `main`. The primary
  never leaves `dev`. One line, plus a test that watches it refuse from the wrong branch.
- **Change nothing in `deploy.ts`,** and instead fast-forward local `main` to `dev` before running
  it. Tempting — it preserves "this script is the only thing that touches `main`" exactly as written
  — but it requires **checking out `main` in the primary**, and switching branches in the shared
  primary is one of the things `AGENTS.md` forbids, because a dozen agents have uncommitted work in
  that tree. It becomes reasonable only once everyone is in a worktree and the primary is Greg's
  alone.

Take the first now and reconsider the second later. Either way the invariant that matters is
unchanged: **the only thing that writes to `main` is a gated deploy.**

**Git auto-deploy on `main` must therefore stay ON.** Option (b) from Greg's list — disabling
push-to-deploy — would break the pipeline, because `waitForDeployment` is waiting for the build that
the push causes. That is a good reason to prefer the dev-branch option beyond the ones Greg gave.

### What a preview deploy of `dev` would and would not reach

A first draft of this section warned that preview deployments might carry production database
credentials. **That was checked with `vercel env ls` and it is not true**, which is worth recording
because the fear was reasonable and the answer is better than feared:

```
  in production, absent from preview:   DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
                                        SENTRY_DSN / _AUTH_TOKEN / _ORG / _PROJECT
  in both:                              SUPABASE_URL, SUPABASE_ANON_KEY,
                                        VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY,
                                        SPIDERYARN_OWNER_ID, SPIDERYARN_STORE,
                                        ANTHROPIC_API_KEY, OPENROUTER_API_KEY
```

**The production database is out of reach.** `DATABASE_URL` is production-only and
[`src/db/client.ts`](../../src/db/client.ts) throws rather than falling back, so a preview fails
cleanly at the store — which is what [deployment.md](../project/deployment.md) already says is the
intended behaviour. The service-role key is production-only too.

Two things do survive, both smaller:

- **The model-provider keys are on preview.** `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` would sit
  in a build produced from commits nobody has reviewed. Most paths that would spend them need the
  store and so fail first, and preview URLs are behind Vercel's deployment protection. It is not an
  emergency; it is a reason not to build previews you do not want.
- **Preview shares the real Supabase Auth project**, so a preview signs people in against the same
  `auth.users` as production. Sign-in works and every read after it 503s.

So the recommendation stands but the reason changes from safety to waste: with ten agents pushing
many times a day, every push would queue a full build — on one concurrent build slot — that is
guaranteed to fail at the store the moment anyone opens it.

**Naming only `dev` is not enough, and this is the part the first draft got wrong.** A branch not
named in `deploymentEnabled` defaults to **`true`**, so the moment agents start pushing
`worktree-*` branches — which the whole convention above requires them to do — every one of those
pushes builds a preview carrying the model-provider keys. The rule has to be default-deny:

```json
"git": { "deploymentEnabled": { "*": false, "main": true } }
```

in [`vercel.json`](../../vercel.json), with the wildcard form **verified against a real push** rather
than assumed, since a deny rule that silently matches nothing looks exactly like one that works. If
the wildcard is not supported, the fallback is an `ignoreCommand` that exits 0 for everything except
the production branch.

`main` must stay `true`: the pipeline depends on the push to `main` producing a `target: production`
deployment. A one-off preview is still available by hand with `vercel deploy`, which
`deploymentEnabled` does not affect — worth knowing, because it means this setting is a convenience
guard, not a security boundary. The real fix for the keys is to take
`ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` off the Preview environment, and that should be done
regardless.

### The base-branch catch

Claude Code's `--worktree` branches from **the repository's default branch on the remote** and
`worktree.baseRef` accepts only `"fresh"` or `"head"` — *not* a branch name. So with `main` still the
GitHub default, every native worktree would branch from production rather than from the trunk, and
nothing would say so.

Two ways out, and they want deciding together with the branch switch:

- **Change the GitHub default branch to `dev`.** Then `"fresh"` means `origin/dev` and everything
  lines up with no setting at all. This is the clean answer. It also changes where new PRs target,
  which is what you would want anyway.
- **Set `worktree.baseRef: "head"`.** Worktrees branch from the primary's local `HEAD`, which is
  `dev`. Simpler to do, but it inherits whatever the primary happens to be sitting on, and Rebel
  branches from the remote specifically to avoid inheriting a peer's uncommitted state.

Prefer the first. Note that `main` stays the Vercel *production* branch either way — Vercel's
production branch and GitHub's default branch are separate settings.

**And changing GitHub's default branch is not enough on its own.** Claude Code resolves "fresh"
through `origin/HEAD`, which is a *local* ref in each clone and does not follow a change made on
GitHub. This checkout right now:

```
$ git symbolic-ref refs/remotes/origin/HEAD
refs/remotes/origin/main
```

So the first worktree created after the switch would quietly branch from `main` — the exact silent
wrong-base failure of row 1, arriving by a route the original plan did not anticipate. After changing
the default branch, on **every clone including the box**:

```bash
git fetch origin dev
git remote set-head origin -a
git symbolic-ref refs/remotes/origin/HEAD     # must print refs/remotes/origin/dev
```

And keep row 1's rule: printing the base is not checking it. Worktree setup should assert that its
starting sha equals a freshly-fetched `origin/dev`.

### What Step 0 is, in full

1. Create `dev` from `main`, push it, and make it the GitHub default branch.
2. `deploy.ts:323` accepts `dev`. A test that watches it refuse from the wrong branch.
3. `vercel.json`: `git.deploymentEnabled.dev = false`.
4. Record the preview/production env-var split in [deployment.md](../project/deployment.md) — it was
   read on 2026-08-31 and is written up above, but it lives in a plan, which is the wrong place for
   a standing fact.
5. `AGENTS.md` and [version-control.md](../project/version-control.md): agents commit and **push** to
   `dev`; `main` is written only by `npm run deploy`.

### Push at the end of a piece of work

Greg asked for this convention, and Rebel has a postmortem that is the argument for it. A fix that
had been implemented, reviewed at 96/100 and committed sat on an unmerged worktree branch for 31
hours with no remote ref, while the bug it fixed stayed live; it was found only because a routine
sweep flagged the branch as `UNMERGED — has work`
(`docs-private/postmortems/260619_reviewed_fix_stranded_unlanded_on_worktree_postmortem.md`). The
recommendation from that postmortem — a session-close surfacer for unlanded commits — was never
implemented, which is why it could recur.

So: **push at the end of a piece of work**, into `AGENTS.md` and
[engineering-manager.md](../reusable/engineering-manager.md). It is not only tidiness. It is what
makes the sweep's "merged" guard mean anything, and it is the only way work reaches the remote box,
which can see nothing that has not been pushed.

## The layout

```
  Dropbox — syncs to the cloud            Not Dropbox — never leaves the laptop
  ───────────────────────────────         ──────────────────────────────────────
  ~/Dropbox/dev/experim/spideryarn2/
    src/ docs/ tests/ …
    node_modules/   1.2 GB   ← Dropbox-ignored already
    data/            27 MB
    .git             35 MB   ← still synced; see risk row 11
    .claude/worktrees/       ← where `claude --worktree` puts them
      <name-a>/    ← agent 1     MUST be Dropbox-ignored and gitignored
      <name-b>/    ← agent 2
```

**This is a change from the original layout, and it is forced.** That plan put worktrees at
`~/dev/worktrees/spideryarn2/`, outside Dropbox entirely. Claude Code creates them under
`.claude/worktrees/` at the repository root, and the only way to move them elsewhere is a
`WorktreeCreate` hook that **replaces the default creation logic entirely** — which costs you
`.worktreeinclude` (not processed when a hook is used), the marker the cleanup sweep looks for, and
the transcript following the session. Symlinking is not a way out either: Claude Code explicitly
refuses to create a worktree when `.claude`, `.claude/worktrees` or the worktree directory is a
symlink.

So the cheaper answer is to leave them where the tool puts them and stop Dropbox seeing them:

```bash
xattr -w com.dropbox.ignored 1 .claude/worktrees
xattr -w 'com.apple.fileprovider.ignore#P' 1 .claude/worktrees
```

the same two attributes `node_modules` and `dist` already carry — and `.gitignore` needs
`.claude/worktrees/` too, which the Claude Code docs also recommend, or every worktree shows up as
untracked in the main checkout. **Neither is done today**: `.claude/` carries no Dropbox attribute
and appears nowhere in `.gitignore`. Both must land *before* the first worktree is created, because
ignoring a directory removes it from the cloud rather than merely stopping the upload.

This is the one place where paying for a `WorktreeCreate` hook might still be right, and it should be
decided rather than defaulted: a hook could put worktrees on a non-Dropbox volume *and* run `npm ci`,
solving two problems at once, at the cost of reimplementing creation and losing `.worktreeinclude`.
Start without it.

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

**Most of the rest is now done by `claude --worktree`.** What the native feature covers, and what it
leaves:

| | |
|---|---|
| Creating the worktree and its branch | native |
| Choosing the base branch | native, via `worktree.baseRef` — but only `"fresh"`/`"head"`, see the base-branch catch above |
| Copying `.env.local` in | native, via `.worktreeinclude` — a gitignore-syntax file listing gitignored files to copy |
| Keeping one session out of another's files | native, and stronger than a script could be |
| Locking a worktree while a session runs, and releasing a killed session's lock | native |
| Removing a clean worktree at session exit; sweeping old subagent/background worktrees | native — but read the next section before trusting it, because "clean" does not mean what this repo needs it to mean |
| **Installing dependencies** | **ours** — the docs are explicit that a worktree is a fresh checkout and nothing installs for you |
| **Allocating a dev-server port** | **ours** |
| **The database** | **ours** |
| **Deciding a worktree's work has landed** | **ours** — the native sweep checks "unpushed", never "merged" |

So the script is much smaller than planned, and its remaining name is closer to `worktree:setup`
(run once inside a new worktree) plus `worktree:sweep` than to the `new`/`doctor`/`rm` trio below.
Written in TypeScript run by `tsx`, matching `scripts/deploy.ts` and `scripts/check.ts` — the repo's
scripts are TypeScript, and "prefer boring" here means matching what is already there.

There is one gap worth naming: **there is no post-creation hook**. `WorktreeCreate` *replaces*
creation rather than running after it, so "create the worktree and then `npm ci`" cannot be
automatic without giving up the defaults. Until that changes, the install is the first thing an agent
does in a new worktree, and `AGENTS.md` has to say so.

### The native cleanup cannot see `data/`, and that is the one that bites

This is the finding that most changes the shape of the answer, and it came from the second Sol
review. The native sweep skips a worktree that holds "changed files, untracked files, or unpushed
commits" — which sounds like it covers everything. It does not cover **ignored** files, and this
repo's two most valuable uncommitted things are both ignored: `data/`, which holds pipeline output
that cost real model calls, and `.env.local`.

Verified rather than reasoned, in a throwaway repo with `data/` in `.gitignore` and a file inside it:

```
$ git status --porcelain=v1 --untracked-files=all
                                    ← nothing. The file is invisible to the guard.
$ git status --porcelain --ignored
!! data/                            ← only this flag sees it
```

So a worktree whose entire content is a fresh, expensive pipeline run reads as clean to git and
**qualifies for automatic removal**. The original plan knew this — it is failure row 12, and the
reason `rm` was to record a manifest of ignored state at creation. What the revision got wrong was
assuming the native sweep's "unpushed commits" check subsumed it. It does not, and a `WorktreeRemove`
hook cannot veto the removal: hook failure there is informational.

The sweep only reaches subagent and *backgrounded* worktrees older than `cleanupPeriodDays`, so this
is not a hair trigger. But it is silent, it lands on work that has no other copy, and it is exactly
the class this repo writes postmortems about. Three ways to close it, in order of preference:

1. **Do not put paid pipeline output in a worktree.** Run `fetch`/`extract`/`toc` and the rest in the
   primary, and let worktrees hold code work only. Cheapest, and it also sidesteps failure row 10
   (two worktrees paying for the same artefact).
2. **Do not copy `data/` into worktrees at all** — leave the directory empty and let a worktree that
   genuinely needs an article fetch it. Then there is nothing valuable to lose.
3. **Take creation out of Claude Code's hands** with a `WorktreeCreate` hook, so the worktrees carry
   no cleanup marker and the native sweep leaves them alone entirely, and our guarded sweep owns
   removal. This is the expensive option and it costs `.worktreeinclude` as well.

Option 1 is a policy line in `AGENTS.md` and should be the v1 answer. It also means step 2's `data/`
copy can be dropped, which removes the only per-OS line in the whole plan.

### Two repo scanners walk straight into `.claude/worktrees/`

Also from the second review, and also verified. Dropbox-ignoring the directory and gitignoring it
does nothing about tooling that walks the tree itself:

- [`scripts/typecheck.ts`](../../scripts/typecheck.ts) recursively discovers `tsconfig.json` files
  and skips only `SKIP = new Set(["node_modules", ".git", "dist", ".temp"])`. With ten worktrees
  nested inside the repo, `npm run typecheck` in the primary would walk into all ten and typecheck
  peers' half-finished code — or fail because of it.
- [`vite.config.ts`](../../vite.config.ts) sets `watch: { ignored: ["**/data/**", "**/docs/**",
  "**/evals/**"] }`. `.claude` is not in that list, so the primary's dev server would watch every
  worktree and reload on peers' edits.

Both need an explicit exclusion, and the wider point is that **anything that walks the repo has to be
audited before worktrees land inside it** — `check.ts`, `knip`, `biome`, `jscpd`, the doc-links test.
This is the strongest argument for relocating worktrees outside the repo after all, and it should be
weighed against the cost of a `WorktreeCreate` hook rather than assumed away.

### `worktree:new <slug>` — superseded, kept for the reasoning

The ten steps below were the plan before the native feature existed. Steps 1, 3, 4, 5 and 9 are now
`claude --worktree`'s job; step 7 is `.worktreeinclude`; step 10's `READY` marker is the lock Claude
Code already takes. What survives into the new list is step 6 (`data/`), step 8 (the port) and the
`HEAD`-assertion idea inside step 3.

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

### The `node_modules` cache — **dropped**

> **Superseded 2026-08-31.** A plain `npm ci --prefer-offline --no-audit --no-fund` takes 4–5 seconds
> and 564 MB, and every binary runs from it. The cache below saves about 4 seconds and 11 GB out of
> 333 GB free, on a design that cannot work on the ext4 box anyway. The whole of it — fingerprint,
> blocking lock, staging directory, smoke test, `COMPLETE` marker, same-device probe, free-space
> assertion — is **not being built**. What replaces it is one line in the worktree setup script:
>
> ```bash
> npm ci --prefer-offline --no-audit --no-fund
> ```
>
> `--prefer-offline` rather than `--offline` because it is the one command that suits both machines:
> the laptop's npm cache is 21 GB and will serve all of it, the box's is 266 MB and will fetch the
> rest over a datacentre link. `--offline` would fail on the box for no benefit.
>
> Two things from the section below are worth keeping in mind anyway, because they are true of any
> future attempt: **never clone dependencies from the primary**, which is a tree Greg is editing and
> whose installed state routinely lags its own lockfile; and **a smoke test has to execute things**,
> not just check that a `.bin` shim exists.

The original design, ported from Rebel's `worktree-postinit.sh`, follows.

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

### The install-script policy has to be committed, not hashed — **mostly moot now**

> **Superseded 2026-08-31.** This section exists because a *cache* keyed without the script policy
> would serve a tree built under one policy to a worktree expecting another. With no cache, that
> failure has nowhere to happen. npm 11 does block these scripts by default here — the fresh install
> reported **five**, which is what the original section said and what a first re-reading of the log
> tail got wrong: `esbuild@0.18.20`, `esbuild@0.25.12`, `esbuild@0.28.2`, `@sentry/cli@2.58.6` and
> `fsevents@2.3.3`. Everything still works, because those packages ship prebuilt platform binaries;
> `esbuild --version` prints `0.28.2` and `sentry-cli --version` prints `2.58.6` from a tree whose
> install scripts never ran.
>
> **"Moot" is too strong, though, and the second review was right to push back.** A blocked install
> script can leave a package that installs cleanly and fails only when its generated or downloaded
> artefact is first used — weeks later, in one code path, on one platform. Committing the policy, and
> pinning the Node and npm versions with it, is cheap and still worth doing. It is simply no longer a
> prerequisite for anything.

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

**Where the port comes from.** The original plan scanned sibling worktrees' `.env.local` files and
took the lowest free port at or above 5274 — a scan-then-pick with a race between two simultaneous
creations. Two things have changed the recommendation:

- **Rebel has no allocator to copy.** The claim that this plan ports Rebel's design was wrong on this
  point: its worktree docs tell a human to "pick any free port ≥ 5184… increment to avoid
  collisions", and there is no registry, lock or allocator script anywhere in that repo. This is a
  gap in their tooling, not a pattern.
- **A deterministic hash of the worktree name was recommended here and it was wrong.** The idea —
  `5274 + (hash(name) % N)`, no registry, no lock, no race — is the pattern the parallel-agent tooling
  has converged on, and it is fine when the slots vastly outnumber the worktrees. Here they do not.
  The Supabase redirect allow-list caps the range at about ten, and **ten worktrees into ten slots
  collide with probability 1 − 10!/10¹⁰ ≈ 99.96%.** Five worktrees already collide about 70% of the
  time. It is not a rare birthday case; it is the normal case.
  Widening the range does not rescue it either: ten into a hundred still collides 37% of the time.

  Worse, `strictPort` does not make the collision safe, only loud on one side. It stops the *second*
  server starting; it does nothing about a browser aimed at that port, which reaches the **first**
  worktree's server and reports success — failure row 5, which this plan already knew about and
  which the hash proposal quietly contradicted.

**So: keep the atomic lease.** [`scripts/lockfile.ts`](../../scripts/lockfile.ts) is the primitive
and it already exists. `strictPort: true` stays as the backstop, and the identity endpoint of failure
row 5 stays mandatory rather than optional.

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

**This remains the weakest part of the plan, and it should be held as a known compromise rather than
a solved problem.** The wider practice is against it: the pattern everyone warns away from is exactly
one shared local database with no isolation, relying on timing. The ladder above it, in ascending
cost, is a per-worktree *schema* in one instance, a per-worktree database cloned with
`CREATE DATABASE … TEMPLATE`, and a full per-worktree Supabase stack with its own `project_id` and
port block. The last is real isolation and is what a `WorktreeCreate` hook would provision if this
ever hurts enough; on a laptop running ten of them it is roughly eighty containers, which is why it
is not v1.

**Migration numbers will collide, and more often than before.** `drizzle-kit generate` names files
sequentially — the tree is at `0036_drop_summary_column.sql` — so two agents on two branches both
generating a migration both mint `0037_`, and each branch's `drizzle-kit check` sees only its own
history and is happy. Rebasing does not prevent it; it only moves where the collision is noticed. For
v1 this is policy plus detection: treat schema work as exclusive (one agent at a time, claimed
explicitly), and add a check after rebase that no two migration files share a number.

### Landing

Agent branches get **no upstream**, so a bare `git push` fails rather than finding a path to `main`.
This is a deliberate departure from Rebel, which sets `push.default=upstream` so a worktree pushes
straight to the integration branch — seductive for a solo repo, and exactly the shape of accident the
`CLAUDE.md` rules exist to prevent.

```bash
# in the worktree, clean and committed
npm test && npm run typecheck
git rebase dev
npm test && npm run typecheck

# in the primary
git merge --ff-only <worktree-branch>
git push origin dev            # ← the part that makes "merged" checkable
```

`--ff-only` fails safely if `dev` moved after the tests ran; rebase and test again. The push is not
optional: without it the sweep cannot tell finished work from abandoned work, the remote box cannot
see the change at all, and the 31-hour stranding described in Step 0 is what happens instead.

Rebel's postmortem `260702_git_safe_sync_worktree_push_target_postmortem.md` is worth reading before
writing any of this. Their worktree branches tracked `origin/dev` and expected a bare `git push` to
land there; because `git push origin <branch>` expands a bare name to `<branch>:<branch>`,
`push.default=upstream` was never consulted and four pushes silently created stray `origin/<slug>`
branches instead — each printing "Sync Complete!" and exiting 0. One of them held a commit that never
landed. **This plan's choice of no upstream at all is the safer one and should stay**, and any script
that pushes should name its destination explicitly (`HEAD:refs/heads/dev`) and then verify the remote
actually moved, rather than trusting the exit code.

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

Three additions, from what the native feature turned out to do:

- **Claude Code enforces most of this itself now**, and more strictly than the rules did. Inside a
  worktree it blocks an `Edit` or `Write` aimed at the main checkout, a Bash command whose working
  directory resolves there, and any `git -C` / `--git-dir` / `GIT_DIR` / `cd` redirect back into it.
  The rules stay written down because the primary is still shared and because an agent needs to know
  why a refusal happened, but the enforcement is no longer only social.
- **One check will surprise people and cannot be turned off.** Claude Code refuses Bash commands
  whose scope it cannot trace without running them — brace expansion, and heredocs with unquoted
  delimiters. Plenty of habits in this repo use both. `AGENTS.md` should say so, and say the fix is
  to split the command up, or the first week of worktrees is spent rediscovering it.
- **Install dependencies first.** A new worktree is a fresh checkout with no `node_modules`, and
  nothing installs them for you. Rebel has a postmortem for precisely this
  (`251219_worktree_sync_missing_node_modules_postmortem.md`): tooling dispatched into fresh
  worktrees failed with `cannot find module 'clipanion'` for nine days, because `git worktree add`
  does not install and nothing checked.

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

| 13 | Sweep deletes a peer's worktree because "merged" was true for the wrong reason | **yes** | a branch created an hour ago, or reset to the trunk tip, is trivially an ancestor of it. **An age guard is the only thing that catches this** — see below |
| 14 | Sweep deletes untracked work because `git status --porcelain` looked clean | **yes** | `--untracked-files=all` is mandatory; plain `--porcelain` misses exactly the new files that have no other copy |

Rows 1, 4, 7 and 7b are now moot: there is no cache to publish, no `cp -c` to fall back silently, and
`claude --worktree` resolves and records the base ref itself. Row 5b is unchanged and still the
sharpest of the port failures. Row 11 has got **less** dangerous, not more: `origin/main` is 5
commits behind local `main` rather than a hundred, so the remote is now a real backup rather than a
theoretical one — and Step 0's push-at-the-end convention keeps it that way.

**Rows 13 and 14 are new, and both are from Rebel's field experience rather than reasoning.** Their
sweep tool refuses to remove anything whose last commit is under 24 hours old, and the guard is not
paranoia: the predecessor shell script lacked it and was retired on 2026-06-14 for that reason, after
two same-day worktrees read as "merged" with reflog activity fifteen minutes old. The other half of
their design is worth copying wholesale — **`classify` is read-only and `remove` re-runs every
mechanical guard itself**, with a fresh fetch, so a stale classification can never authorise a
deletion, and removal is per-branch with no bulk flag so each one re-validates independently.

Rows 10 and 11 are the two this plan does not close. Row 10 needs a global content-hash lease that
does not exist yet. Row 11 is only fully answered by moving the repo out of Dropbox — until then, a
verified bundle stored outside Dropbox is the mitigation.

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
  **Restated 2026-08-31:** the CoW cache is gone, so the comparison is now pnpm against a 4-second,
  564 MB `npm ci`, and the case for pnpm is weaker still. Its one remaining advantage is real and
  worth recording: pnpm handles the macOS/Linux split *for you* under one identical setting, cloning
  on APFS and hardlinking on ext4, which is precisely the fork this plan was worried about. If
  per-worktree disk ever becomes the complaint, pnpm is the answer rather than a bespoke cache.
- **A hardlink farm** (`rsync -a --link-dest=…`, which unlike `cp -al` is the same command on both
  machines). Near-zero disk, and hardlinks are invisible to build tools in a way symlinks are not.
  Rejected because a hardlink shares bytes rather than history: anything that ever writes into a
  package in place — a postinstall, `patch-package`, an editor save — silently corrupts every
  worktree sharing that inode. pnpm avoids this by baking postinstall output into its store before
  linking out; a bare rsync farm has no equivalent. Not worth the risk to save 4 seconds.
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

## What is left to do

Four steps, not seven. The order matters: Step 0 is independently useful and unblocks the rest, and
nothing that creates a worktree ships before the database and removal safeguards exist, because both
of those failures are silent and both land on work that is not in git.

### 0. The dev branch — do this first, on its own

Described in full in [Step 0](#step-0-the-dev-branch-and-what-it-costs). One line in `deploy.ts`, one
key in `vercel.json`, a GitHub default-branch change, and the env-var scoping read and written down.
It stands on its own merits and is the prerequisite for everything below.

### 1. The two `deploy.ts` bugs — done (`96c7661`)

Kept because step 3 inherits a decision from it.

**The lock does not steal a stale lock.** `read it, decide it is dead, unlink, create` lets two
processes both take the same leftover — the second unlinks the first one's *new* lock — and POSIX has
no unlink-if-unchanged, so a bounded retry does not help. A leftover is reported with the `rm`
command to clear it. Affordable because `process.on("exit")` already releases on every death except
`SIGKILL`. **Step 3 must not reintroduce stealing.**

Two smaller findings from the same review, both fixed and both worth not undoing: the claim links a
fully-written temporary file into place rather than using `open(…,"wx")`, which publishes the path
before its contents and lets a contender read an empty file and call the holder dead; and `release`
checks inode and token before unlinking, because the exit hook outlives the lock it was made for.

### 2. Make a worktree usable — the small setup layer

Everything the native feature does not do, and nothing it does.

1. **`.gitignore` gets `.claude/worktrees/`, and Dropbox gets told to ignore it** — both xattrs, as
   for `node_modules`. Before the first worktree exists, because ignoring removes the cloud copy.
2. **`.worktreeinclude`** listing `.env.local`. Only gitignored files that match are copied, so it
   cannot duplicate a tracked file.
3. **`worktree.baseRef`**, decided together with the GitHub default branch — see
   [the base-branch catch](#the-base-branch-catch).
4. **Exclusions for every scanner that walks the repo** — `SKIP` in
   [`scripts/typecheck.ts`](../../scripts/typecheck.ts) and `watch.ignored` in
   [`vite.config.ts`](../../vite.config.ts) at minimum, then an audit of `check.ts`, knip, biome and
   jscpd. Without this the primary typechecks ten peers' half-finished trees.
5. **`npm run worktree:setup`**, run inside a fresh worktree: `npm ci --prefer-offline --no-audit
   --no-fund`, write the leased port, record a creation timestamp, and print what it did. It has to
   be run by hand or by the agent, because `WorktreeCreate` replaces creation rather than following
   it.
6. `tmutil addexclusion` on the new `node_modules`, on macOS.

**`data/` is deliberately not copied in.** The original plan cloned it from the primary; the second
review showed why that is a liability rather than a convenience — a worktree holding fresh pipeline
output reads as clean to every check both our sweep and Claude Code's own make, because ignored files
are invisible to `git status` without `--ignored`. So worktrees start with an empty `data/`, paid
pipeline work happens in the primary, and a worktree that genuinely needs an article fetches it. That
also removes the only per-OS line in the plan, since there is no longer anything to copy.

### 3. Ports, as one unit

Half of this is worse than none, because each half hides the other's failure.

1. `SPIDERYARN_DEV_PORT` in [`vite.config.ts`](../../vite.config.ts) (currently hardcodes `5273`),
   with **`strictPort: true`**.
2. An **atomic port lease** on [`scripts/lockfile.ts`](../../scripts/lockfile.ts), not a
   scan-then-pick and not a hash — see [Ports](#ports) for why the hash was proposed and withdrawn.
3. The `additional_redirect_urls` range in [`supabase/config.toml`](../../supabase/config.toml),
   **then restart Supabase and check the running container**: the file is not re-read automatically
   ([setup-dev.md](../project/setup-dev.md)).
4. An identity endpoint reporting worktree and commit, which browser checks assert against.

Why (4) is not optional: `strictPort` only makes the *second server* refuse to start. A browser
pointed at 5273 still reaches the *first* worktree's server and everything looks fine. Without an
identity check, an agent can screenshot and test another worktree's work and report success.

Why (3) caps concurrency: the allow-list is a list of exact ports, so the number of listed ports is
the number of concurrent worktrees. The port function must **refuse** to produce a port outside it —
a port that is not on the list produces a sign-in that appears to work and silently drops the return
path.

### 4. The database lease, and a `test:db` that fails closed

One shared Supabase stack, per Greg. A lease around `db:migrate`, `db:reset` and any DB-backed test
run, built on `scripts/lockfile.ts`, **held for the whole suite** rather than per statement.

It inherits no-stealing from step 1, which has a cost worth stating plainly: a `SIGKILL`ed test run
will occasionally leave a lock that a human must `rm`. The error message says which file. This is a
deliberate trade of convenience for never having two writers.

`test:db` must fail when the database is absent or the migration head is not what the checkout
expects. Today about a dozen Postgres suites **skip themselves silently** when the DB is down, so a
misconfigured worktree reports green while testing nothing. `npm test` may stay usable without a
database; schema and store work must run `test:db` before landing.

Plus the migration-number collision check described under [Postgres](#postgres) — and the second
review is right that **policy alone is too quiet to trust here**. Two automated refusals are needed,
not a convention: landing or rebasing must reject duplicate migration numbers, and the migration
wrapper must check that the database's ledger is an exact prefix of the checkout's migrations
*before* applying anything, holding the lease across the whole check-and-apply. A lease alone stops
two migrations running at once; it does nothing about two branches independently minting `0037_`.

### 5. `worktree:sweep` — the part the native cleanup does not do

Claude Code's own sweep already refuses to remove a worktree holding changed files, untracked files
or unpushed commits, and holds a `git worktree lock` while a session runs. What it never asks is
whether the work **landed**. So the script is small, and its shape is Rebel's:

- **`classify`** — read-only. For each worktree: merged (`git merge-base --is-ancestor <branch>
  origin/dev`, after a fresh fetch), clean — and clean means **both** `git status --porcelain=v1
  --untracked-files=all` *and* `--ignored`, because the first cannot see `data/` — and **how old the
  worktree is**. Prints a table, writes JSON, deletes nothing.
- **`remove --branch <name>`** — the only destructive path, per-branch with no bulk flag, and it
  **re-runs every guard itself** with a fresh fetch rather than trusting the classification. Refuses,
  naming the blocker, if the worktree is the current checkout, unmerged, dirty, under the age
  threshold, or if the fetch failed.

The age guard is the one that is easy to leave out and must not be — failure row 13. But **age of the
last commit is the wrong clock**, as the second review pointed out: a worktree created ten minutes
ago from a month-old commit passes that test immediately. Record a **creation timestamp** at setup
and age from that. A `git worktree lock` held by a running session is an unconditional blocker on top
of it, but not proof of activity in the other direction — a `SIGKILL`ed session leaves the lock
behind, so fail closed and make a human clear it rather than auto-unlocking. Best positive signal of
all is an explicit `worktree:done` marker; age is only ever a grace period.

And the removal guard the original plan identified stays, now with a verified mechanism: `data/` and
`.env.local` are both gitignored, so a clean `git status` reports "safe" and then deletes real work.
Record a manifest of ignored state at creation and refuse removal when it has changed, unless given
an explicit discard flag. See [The native cleanup cannot see
`data/`](#the-native-cleanup-cannot-see-data-and-that-is-the-one-that-bites) — the same blind spot
sits in Claude Code's own sweep, which is why the v1 answer is to keep paid pipeline output out of
worktrees entirely.

### 6. Docs, alongside each step rather than batched

`AGENTS.md` — see [What changes in `CLAUDE.md`](#what-changes-in-claudemd) — and
`docs/project/worktrees.md`, parented under
[dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md), or
`tests/doc-links.test.ts` fails. The worktrees doc is the overview Greg asked for: how to start one,
what to run first, what the ports are, what the sweep does, and the traps above.

### 7. Later: move the repo out of Dropbox

Greg intends to; deferred while agents are working. Not by deleting worktrees — git supports moving
the main worktree and repairing the links:

1. Quiesce: stop agents, servers and editors holding the old path.
2. Record `git worktree list --porcelain`.
3. Move the primary.
4. `git worktree repair` against the **recorded paths, not a shell glob**.
5. From every worktree verify status, branch, common git dir and registered path.

Take the off-Dropbox backup before any of it. Note that this move would also make the
`.claude/worktrees/` location a non-issue, which is an argument for doing it sooner.

### And on the box

Nothing above is macOS-only, which was the point. The box runs Ubuntu 24.04 on ext4 with 44 GB free
on `/home`, 16 cores and 30 GB of RAM, so ten worktrees at 564 MB each is 5.6 GB and comfortable. Two
differences to expect rather than discover: its npm cache is 266 MB against the laptop's 21 GB, so the
first `npm ci --prefer-offline` there fetches over the network (cheap, it is a datacentre link), and
`gjd-remote` currently assumes one checkout per repo — `new` would need to know how to start a session
in a worktree. That is the same seam as the `.gjd-remote/run setup` contract being designed in
[260831ad-multi-repo-support-for-gjd-remote-box.md](260831ad-multi-repo-support-for-gjd-remote-box.md),
and the two should be decided together rather than growing two answers.
## Open decisions

Everything here needs Greg. The first four are new on 2026-08-31 and the first two block Step 0.

0a. **Preview deploys on `dev`** — checked and **no longer the scary one**. `DATABASE_URL` and the
   service-role key are production-only, so a preview cannot reach the production database; it fails
   at the store. What remains is waste (a build per push, on one concurrent slot, that is guaranteed
   to 503) plus two small things: the model-provider keys are present on preview, and preview shares
   the real auth project. Recommendation: `deploymentEnabled: {"dev": false}`. Confirm that is wanted
   rather than previews-with-their-own-database, which is a bigger piece of work.

0b. **Change the GitHub default branch to `dev`?** Recommended, because it makes
   `claude --worktree` branch from the trunk with no setting at all — `worktree.baseRef` cannot name
   a branch. The alternative is `baseRef: "head"`. Vercel's production branch stays `main` either way.

0c. **`.claude/worktrees/` inside Dropbox.** The plan is to leave worktrees where Claude Code puts
   them and set both Dropbox xattrs plus a `.gitignore` line. The alternative is a `WorktreeCreate`
   hook that relocates them off the Dropbox volume and runs `npm ci` at the same time, at the cost of
   `.worktreeinclude` and the cleanup marker. Worth a decision rather than a default — and it
   disappears entirely if the repo moves out of Dropbox first (step 7).

0d. **`node_modules/.vite-temp` is holding 636 MB of leaked files** — 107 `vite.config.ts.timestamp-*.mjs`
   dating back to 27 August, left by vite processes that were killed before they could clean up. It is
   most of the gap between the primary's 1.2 GB `node_modules` and a fresh install's 564 MB. Harmless
   but not free, it will get worse with a dev server per worktree, and it is safe to delete. Unrelated
   to worktrees; found while measuring for them.

1. **`data/` and Dropbox.** `node_modules` and `dist` are ignored; `data/` is not. Ignoring it stops
   27 MB syncing but **deletes Dropbox's copy**, and that is 27 MB of pipeline output that cost model
   calls. Asked, not yet answered.
2. **How many concurrent worktrees to list in `additional_redirect_urls`** (step 3). Ten was the
   working assumption from "like today — 10+".
3. **Is the manual `rm` after a `SIGKILL` acceptable** for the database lease (step 4)? The
   alternative is a lease that can be held by two runs at once, which is worse, but it should be
   Greg's call rather than assumed from step 1.
4. **The Sentry gate allows preview deployments to report.** Greg asked for "only in production"; the
   gate implemented is "not on a laptop", so previews still report and are labelled by `environment`.
   Narrowing it to production-only is one condition if that is what he meant.
5. **`.env.prod` is deliberately not provisioned into worktrees**, so an agent in one cannot deploy.
   Confirm that is wanted.

## Open risks this plan does not close

From the ranked table above, the two with no mechanism behind them:

- **Row 10** — two worktrees each paying for the same `data/` artefact. Needs a global content-hash
  lease that does not exist. Policy only for now: treat pipeline work on one article as exclusive.
- **Row 11** — Dropbox restoring an older-but-valid ref into the shared `.git`. `git fsck` cannot see
  it, because every object is valid. Only step 7 really answers it, and Greg has accepted the risk
  knowingly. It is **smaller than when this was written**: local `main` was a hundred commits ahead of
  `origin/main` then and is five ahead now, so the remote is a real backup. Step 0's
  push-at-the-end-of-a-piece-of-work convention is what keeps it that way, which makes it a safety
  measure as well as a workflow one.

## How to check you have not broken anything

```bash
npm run typecheck                     # all three projects; ignore rename-preview.tsx
npx vitest run tests/lockfile.test.ts tests/worktree-admin.test.ts tests/monitoring-config.test.ts
```

**The isolation is a documented guarantee, not a check you have seen work.** Before relying on it,
build a disposable repository and try to escape a worktree in it on purpose: an absolute-path `Edit`
into the main checkout, `git -C`, `--git-dir`, a `GIT_DIR` variable, a `cd` then git, and a symlink
pointing out. Assert a canary file in the main checkout is untouched and the worktree is locked.
Make it part of what gets re-run when Claude Code updates, because this is a guarantee that could
regress in a release and would do so silently.

And the rule this work kept proving: **break it on purpose first.** Every fix in step 1 was watched
failing before it was trusted — reverting `"wx"` to `"w"` and `--force --force` to `--force` turned
exactly four tests red, putting the stale steal back turned five red that the previous suite had
passed blind, and removing the Sentry gate turned its test red. A suite that has only ever been green
is not evidence ([silent-success.md](../reusable/silent-success.md)).
