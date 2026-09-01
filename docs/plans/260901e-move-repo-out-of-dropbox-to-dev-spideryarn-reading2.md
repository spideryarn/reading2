# Move the checkout out of Dropbox, to `~/dev/spideryarn/reading2`

Rename the working directory

```
/Users/greg/Dropbox/dev/experim/spideryarn2   →   /Users/greg/dev/spideryarn/reading2
```

so that the directory name matches the repo name, and so the tree stops syncing to Dropbox.

> I'd like to move this to /Users/greg/dev/spideryarn as `reading2`, so that the folder name matches
> the `reading2` repo name … and so that we're not in Dropbox (which will reduce network activity
> when we have lots of worktrees).
>
> — Greg, 2026-09-01

Reviewed by GPT Sol before execution (`gpt-5.6-sol`, high effort, 2026-09-01). Sol found three
things this plan had missed; all three are verified below and folded in.

## Why now, and how much Dropbox is actually carrying

Only `node_modules/` and `dist/` have the **two** xattrs Dropbox needs to leave a directory alone
(`com.dropbox.ignored` and `com.apple.fileprovider.ignore#P` — see the memory note *Dropbox ignore
needs two xattrs*). Everything else is syncing:

| | |
|---|---|
| `.git` | 128 MB, and it changes on every commit in every worktree |
| `data/` | 64 MB of article fixtures |
| `evals/` | 35 MB |
| `output/` | 11 MB |

So the answer is not "set more xattrs" — it is to leave. Moving is also what makes the *next*
worktree free, which is the thing Greg is actually buying.

## `mv`, not a fresh clone

`stat -f %d` says source and destination sit on the same device (`16777234`), so `mv` is a rename:
instant, and it carries the gitignored artefacts — `data/`, `output/`, `evals/`, `.env.local`,
`.env.prod`, `.vercel/`, `node_modules/` — across untouched.

**The simpler option passed over** was `git clone` at the new path and delete the old tree. It is
easier to reason about and gives a clean `.git`, but it silently loses everything gitignored, and
[hetzner-remote-server-box.md § Getting the app running on a new box](../project/hetzner-remote-server-box.md#getting-the-app-running-on-a-new-box)
already records that a fresh clone leaves about nineteen test files without an article to work on.
Re-fetching the corpus costs money. `mv` has one real risk in exchange — a half-completed rename
if something holds the tree open — and that is what the quiescence step is for.

## What moves by itself, and what is keyed on the old path

```
MOVES WITH THE FOLDER — nothing to do        KEYED ON THE OLD PATH — must be fixed
────────────────────────────────────────     ─────────────────────────────────────
.git                                          ~/bin/gjd-remote            ← blocker
.vercel/project.json  (the Vercel link)       ~/.claude/projects/<slug>/   1.7 GB
.env.local, .env.prod                         ~/.claude.json  projects key
data/ output/ evals/ node_modules/            ~/.codex/config.toml  trust entry
.claude/settings.json ($CLAUDE_PROJECT_DIR)   6 worktree gitdir files

UNAFFECTED — deliberately not touched
─────────────────────────────────────
the box's ~/code/spideryarn2                  Supabase containers + data volumes
the gjd-remote log (~/.local/state)           the Vercel project itself
```

## The three things the review caught

### 1. `~/bin/gjd-remote` hardcodes the old path — this is the blocker

```bash
exec /Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/.bin/tsx \
     /Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts "$@"
```

Both paths are absolute **on purpose**, and the comment in the file says why: the shebang's
`npx tsx` resolves `tsx` from the *current* directory's `node_modules`, so a bare symlink works
inside the repo and silently re-downloads or fails anywhere else. So the fix is to edit the two
paths, not to make it relative.

**The false pass**: `npx tsx scripts/gjd-remote.ts ls` run from inside the repo bypasses the
wrapper entirely and passes while `gjd-remote` is still broken for every other directory. Verify
from `cd ~` using the bare name.

### 2. `git worktree prune` would have removed nothing, silently

Six worktrees are registered, and all six **still exist on disk** — five throwaway verify trees
under `/private/tmp/claude-501/…/scratchpad/`, and the deploy gate's tree under `/private/var/…`.
`prune` only removes registrations whose working tree is *missing*, so
`git worktree prune --dry-run --verbose` prints nothing here. A real run would print nothing too,
and the two are indistinguishable — [silent-success.md](../reusable/silent-success.md).

They need `git worktree remove`, and afterwards `git worktree repair` for anything kept.

None of the six holds work worth saving. Checked one by one: five have no diff against their own
HEAD, and `wt-verify`'s modified `tests/jobs.test.ts` is **the same guidance-removal edit that is
already on `main`** (`tests/jobs.test.ts:510-537`) — a verify tree where the change was reproduced,
at a commit predating the `toc`→`hierarchy` rename.

Each of the five also symlinks `node_modules`, and three of them `.env.local`, into the old repo
path. Those dangle after the move; `git worktree repair` fixes `.git` pointers and knows nothing
about ordinary symlinks. That is a second reason to remove rather than keep them.

### 3. The deploy worktree's `locked` flag is not evidence a deploy is running

`.git/worktrees/tree/locked` only means "do not prune me". The lock that actually spans a
deployment is **`.git/spideryarn-deploy.lock`**, taken before the gate worktree is created and held
through migration, push and verification — [`scripts/deploy.ts`](../../scripts/deploy.ts).

At the time of writing that lock is absent, `lsof +D` on the tree finds no open handle, there is no
deploy process, and its mtime is 2026-08-30. Stale. **Re-check the lock immediately before
removing it**, because the answer can change between reading this and running it.

If a deploy *is* running, do not move. What breaks depends on where it got to: during the gates,
its Git calls fail because the linked tree points at a vanished main repo; after migrations but
before push, the production schema advances while the code does not ship.

## Decisions

| | |
|---|---|
| `supabase/config.toml` `project_id` | **stays `spideryarn2`** — see below |
| `package.json` `"name"` | changes to `reading2`, and both name fields in `package-lock.json` with it |
| the box's `~/code/spideryarn2` | **unchanged**; someday-maybe, below |
| the six worktrees | removed |
| `~/.claude/projects/<slug>/` | moved, so session history and agent memory survive |

### Why `project_id` stays `spideryarn2` even though the directory is now `reading2`

`project_id` names a **local Docker stack**, not the directory. The CLI would default it to the
working-directory name, and it is set explicitly here precisely so that the stack is decoupled from
where the checkout happens to live. Leaving it is what makes this move a rename rather than a
database migration.

**The wrong version of changing it looks like success.** Edit the id, `supabase stop`,
`supabase start`, and you get a green healthy stack under new container names — and an *empty*
database, because the data is still in the `supabase_db_spideryarn2` volume that nothing now points
at. Run `npm run setup` afterwards and it looks healthier still: schema applied, accounts seeded,
articles and auth identities stranded. The mismatch between the directory name and the container
names is the only thing that would tell you, and it is exactly the mismatch a tidy-minded agent
would "fix".

So: **leave it, and do not tidy it.** This is recorded in
[supabase-local.md](../project/supabase-local.md) as well, because that is the file somebody reads
before touching the local stack.

If it is ever worth changing, it is a separate job with its own plan: record exact row counts, stop
only this stack without `--no-backup`, enumerate every volume *and* bind mount, clone each volume to
its `_reading2` twin offline, then change the id, start, verify the counts, and keep the old volumes
until the new stack has been used in anger.

### Someday-maybe: rename the box's checkout too

The box has an independent checkout at `~/code/spideryarn2` on its persistent volume. The laptop's
path never reaches it — Sol checked the indirect routes and confirmed: `REPO` is derived locally
from `import.meta.url`; `push-env` reads locally and writes to `REMOTE_REPO`; `provision` sends
script *bytes*; `clone` sends a GitHub URL and a remote destination; `--wait` job scripts contain
only remote paths; `.mcp.json` holds URLs. So the two names can stay out of step indefinitely.

Renaming it later means `REMOTE_REPO_DEFAULT` and the help text in
[`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts), the roots in
[`scripts/remote-smoke-browser.mjs`](../../scripts/remote-smoke-browser.mjs), the fixture in
`tests/gjd-remote-log.test.ts`, and — the awkward part — any live tmux pane already `cd`'d into the
old path, and any `--wait` job whose script names it. Not now.

## The procedure

**Stage A — commit the tracked changes first, while the old path still works**

`package.json` and both name fields in `package-lock.json`; the hardcoded paths in
`.claude/hooks/protect-shared-tree.test.sh`; this plan; the Dropbox sentence in
`hetzner-remote-server-box.md` (below); the `project_id` note in `supabase-local.md`. Then
`npm test`, `npm run typecheck`, commit by named paths, pull, push.

Historical plans, postmortems and review transcripts keep their old paths — they are records of
what was true then.

**Stage B — record baselines** (a rename that half-worked has to be detectable)

```
git rev-parse HEAD; git remote get-url origin; git worktree list --porcelain
stat -f '%d %i' <old>                       # inode, to prove the new tree is the moved one
find data output evals -type f | wc -l      # and the same for sizes
docker exec supabase_db_spideryarn2 psql -U postgres -Atc '…counts…'
gjd-remote ls                               # while the old wrapper still works
```

**Stage C — quiesce, and prove it from outside the tree**

Stop the vite dev server, `scripts/live-spike.ts`, every shell whose cwd is inside, and every other
Claude session. Greg closes the `gjd-remote` tabs; **that does not kill the remote tmux sessions**,
which is the whole point of tmux there.

Then, from `cd ~` so the checking shell is not itself a hit:

```
lsof -a -d cwd +D <old> ; ps axww -o pid=,command= | grep -F <old>
```

Empty output is only meaningful once you have seen those commands produce non-empty output first.

**Stage D — remove the six worktrees**

Re-check `.git/spideryarn-deploy.lock` first. Ordinary `git worktree remove` for the five; the
deploy tree needs `remove --force --force` because a script created it locked. This is the first
genuinely destructive step.

**Stage E — the move**

```
cd ~ && mv /Users/greg/Dropbox/dev/experim/spideryarn2 /Users/greg/dev/spideryarn/reading2
```

**Stage F — repair the routing that lives outside the tree**

`~/bin/gjd-remote`; the two `~/.claude/projects/` directories; the `projects` key in
`~/.claude.json`; the trust entry in `~/.codex/config.toml`.

**Do not launch Claude at the new path before moving its state directory** — it would create an
empty one and turn a rename into a merge.

**Stage G — verify** (§ Proving it worked)

## Rollback

The `mv` is **not** the point of no return. While everything is still quiet:

```
mv /Users/greg/dev/spideryarn/reading2 /Users/greg/Dropbox/dev/experim/spideryarn2
```

then put `~/bin/gjd-remote` and the state directories back. What *is* irreversible: removing the
worktrees (done first, deliberately, and justified above), deleting the old Claude state, deleting
Docker volumes, and letting agents write at both paths at once. Only the first of those happens
here.

## Proving it worked, and what each check's false pass looks like

Every check below has a way of passing while the thing it tests is broken. That is the reason each
one is phrased the way it is — [silent-success.md](../reusable/silent-success.md).

| check | false pass |
|---|---|
| `stat -f '%d %i'` matches the recorded inode | the destination exists but is a copy, not the moved tree |
| file counts for `data/`, `output/`, `evals/`; `.env*` and `.vercel/project.json` present | git is perfectly healthy while the ignored content is gone |
| `git -C <new> status`, `remote get-url`, `rev-list --left-right --count`, `fsck --full` | running it from a stale shell tests a different checkout — always use `-C <new>` |
| `cd ~ && gjd-remote ls` **by bare name** | `npx tsx scripts/gjd-remote.ts` from inside the repo bypasses the wrapper |
| `docker ps --filter name=_spideryarn2`, then the recorded row counts | `docker ps \| grep supabase` also matches the unrelated `hellozenno` stack; and a green stack can be a *new empty* one |
| resume a known session id from the new root, then `/memory`, `/hooks`, `/mcp` | widening the `/resume` picker to all projects finds the old transcript even when routing is broken |
| `node -e` printing `package.json` name and both `package-lock.json` names | `npm test` passes regardless; nothing tests package identity |

## What does not matter

- The Dropbox xattrs on `node_modules/` and `dist/` are inert outside Dropbox. Leave them.
- Old absolute paths inside historical plans, postmortems, Claude transcripts and shell history are
  evidence, not errors. Do not bulk-rewrite them.
- `.vercel/project.json` travels with the directory and stays authoritative.
