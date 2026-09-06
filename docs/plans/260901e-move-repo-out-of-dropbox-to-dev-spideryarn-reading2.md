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

### 4. Two containers bind-mount paths *inside* the repo

Sol could not reach Docker from its sandbox, so it asked for the mount list rather than answering.
Running it found what a directory rename would otherwise have broken quietly:

```
supabase_studio_spideryarn2        bind  <repo>/supabase/snippets
supabase_edge_runtime_spideryarn2  bind  <repo>/supabase/.temp/start-secrets/.../main/index.ts
```

Named volumes survive a rename because Docker owns them; a **bind** mount is a path, and the
container keeps running with a source that no longer exists. Nothing errors, `docker ps` still says
healthy, and Studio simply stops seeing its snippets.

So the stack is stopped **before** the move and started **after**, from the new directory, which is
what re-creates the mounts. `supabase stop` keeps the data — no `--no-backup`, and no `--all`,
which would also stop the unrelated `hellozenno` stack sharing this Docker daemon.

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

---

## What actually happened, 2026-09-01

Done. `mv` at 12:26; **inode `574720701` before and after**, which is the check that separates a
move from a copy.

**Baselines, recorded before and re-read after:**

| | before | after |
|---|---|---|
| `data/` · `output/` · `evals/` files | 254 · 106 · 213 | 254 · 106 · 213 |
| `.env.local` · `.env.prod` · `.vercel/project.json` | 3662 · 6805 · 404 bytes | same |
| Supabase rows | articles=19 users=7 storage=837 migrations=37 | **identical** |
| `HEAD`, origin, ahead/behind | `276aabe`, `spideryarn/reading2`, `0 0` | same |
| test suite | 42 files / 64 tests red | 41–42 files red — **unstable between runs** |
| typecheck | 3 errors in `tests/` | 3 errors in `tests/` |

`gjd-remote ls` was run **by bare name from `~`**, not `npx tsx` from inside the repo, and reached
the box: seven tmux sessions, ages 2–16h, all survived. The wrapper contains no `Dropbox` string.

**The suite was already red before the move, and — this is the honest version — the evidence does
not establish that the move added nothing to it.** The local database is **11 migrations behind**
(37 applied, 48 on disk), so the tests that touch Postgres die on
`column articles.short_id does not exist`: 35 of the 41 failing files are database-shaped, out of 47
`store-*`/`db-*`/`pg-*` files in total, so it is *most* of them and not all. The other six
(`blocks-baseline`, `client-imports`, `css-tokens`, `fixture-ids`, `glossary-ideas-baseline`,
`health`) are peer work in progress on `main`. The database was left behind on purpose: catching it
up in the same sitting would have changed two variables at once.

**Why the before/after comparison cannot carry the weight put on it, per GPT Sol's second review:**

- The baseline recorded failure **counts, not names**. 42 → 41 is consistent with "one flaky test
  settled" and equally with "one fixed, one newly broken".
- The count is **not stable between runs anyway** — consecutive post-move runs gave 41 and 42. A
  difference of one is inside the noise, so it measures nothing.
- The control was **not the same grep**. The path check searched for `Dropbox`/the old path; the
  control counted `AssertionError|Error`. It proved the output contained errors, not that the path
  search could have found a path if one were there — the control shared no assumption with the
  thing it was supposed to be validating, which is the exact shape of
  [silent-success.md](../reusable/silent-success.md).
- A pathless regression is easy to construct: `src/api.ts` derives a root path
  and its `readJson` turns `ENOENT` into `null`, so a wrong root surfaces as a value assertion or a
  404, with no path in the message.

What *is* established: no failure message names the old path; the working tree holds no reference to
it outside the historical docs; and every artefact count matches the baseline exactly. That is
consistent with a clean move and is not proof of one. The failing set is now recorded properly at
`/tmp/fail-set.txt` — **record the set, not the size**, and the next comparison will be able to say
something this one cannot.

### The six worktrees

`git worktree remove` **refused all five** scratch trees — the right refusal, and the reason to look
rather than reach for `--force`. Each was obstructed by an untracked `node_modules` symlink into the
old repo; `wt-verify` also had a modified `tests/jobs.test.ts`, and that diff turns out to be **the
same guidance-removal edit already committed on `main`** (`tests/jobs.test.ts:510-537`) in a verify
tree that predates the `toc`→`hierarchy` rename. Saved to a patch file before removing, then
`--force`; the deploy tree needed `--force --force` and its real lock, `.git/spideryarn-deploy.lock`,
was absent at the moment of removal as well as an hour earlier.

### The one loose end: this session's own transcript split

A live Claude session holds the project path it started with, so while the state directory moved,
**this** conversation kept writing to the old slug and recreated it. The split is clean — 264
entries up to 09:28:17 in the new directory, 76 entries from 09:28:39 in the old, **zero shared
uuids**, strictly chronological. Once the session that did the move has ended:

```
cat ~/.claude/projects/-Users-greg-Dropbox-dev-experim-spideryarn2/*.jsonl \
  >> ~/.claude/projects/-Users-greg-dev-spideryarn-reading2/<same-uuid>.jsonl
```

then delete the old directory. Nothing else landed there — 415 entries and all 67 memory files
moved intact.

The old `~/.claude.json` project key was **copied, not moved**, and is still there as a fallback;
delete it once a resume from the new path has been seen to work. Backups:
`~/.claude.json.bak-260901-move`, `~/.codex/config.toml.bak-260901-move`.

### Lessons

**Record the set, not the size.** The baseline captured failure counts and not names, and no command
run afterwards can reconstruct the missing pre-move set. The question "did the move break a test"
is now permanently unanswerable for this move; it cost nothing to record and cannot be recovered.

**A control has to share the assumption it is testing.** Counting `AssertionError` lines to
"validate" a search for `Dropbox` tests only that the output was non-empty. A real control greps for
a string known to be present *of the same kind as the one being looked for* — here, the old path
deliberately planted in a scratch file, or the same expression run against the pre-move tree.

**Ask the reviewer for the thing it cannot see.** Sol could not reach Docker from its sandbox, so
instead of guessing it asked for the mount list — which is how the two bind mounts were found. The
same move surfaced the stale `file://` fixture URLs. A reviewer that names its blind spot is more
useful than one that fills it.

### What the second review found, and what was done about it

The post-execution review looked at the *result* rather than the plan, and found four things the
verification had missed. All four were checked independently before acting.

1. **A tracked file still linked into the deleted tree.**
   `evals/hierarchy-structure/REVIEW-SOL.md` held 31 absolute links under the old path — the only
   tracked file outside `docs/plans|research|postmortems` that did. Rewritten as **repo-relative**
   links rather than repointed at the new absolute path, so the next move does not break them again.
   Two of the 31 were already dead before the move: `heading-tree.ts` was never tracked in git at
   all, and `evals/` holds 213 files before and after, so the move deleted nothing.
2. **Three PDF articles had stale `file://` source URLs**, in `meta.json` and `raw.json` for
   `ball-lightning`, `coolabah-memory` and `fowler-phrenology`. This one had teeth:
   [`src/store/find-article.ts`](../../src/store/find-article.ts) de-duplicates filesystem articles
   by `meta.url`, so re-ingesting one of those PDFs from its new path would have created a **second
   copy of an article already there** rather than matching it. All three PDFs exist at the new path,
   so the repair was exact; the six files were backed up first and re-parsed as JSON afterwards.
3. **Postgres was clean** — the review could not reach the database and said so rather than
   guessing. Every `text`/`varchar` column in the `spideryarn` schema was scanned: **zero rows**
   hold the old path. So the duplicate-article risk was filesystem-only.
4. **Four gitignored experiment scripts** under `output/` hardcoded the old path. Repointed.

Left alone deliberately: 206 files under `docs/plans|research|postmortems` that name the old path,
because they are records of what was true when written; the Dropbox xattrs on `node_modules/` and
`dist/`, inert outside Dropbox; and `.vite-temp`/Jiti caches, which `npm ci` regenerates.

Still open and **not** caused by this move: iTerm's saved-session state and ~765 Codex threads store
the old `cwd`, so a restored tab or a resumed Codex thread may open in the wrong directory. Neither
loses data and both are cosmetic; noted here rather than fixed.
