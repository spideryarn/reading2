# Version control

Where the code lives, and the one habit that is different here because several agents share a
working tree.

## Where it is

| | |
|---|---|
| Remote | `git@github.com:spideryarn/reading2.git` — **private**, in the `spideryarn` org |
| Web | <https://github.com/spideryarn/reading2> |
| Branch | `main`, and only `main`. No branch protection, no PRs, no CI |
| Local | `/Users/greg/Dropbox/dev/experim/spideryarn2` — inside Dropbox, which matters, see below |
| Since | 2026-08-26. The first 239 commits, back to 2026-08-24, were pushed in one go when the remote was created |

Created with `gh repo create spideryarn/reading2 --private --source=. --remote=origin --push`.
Private because the whole history went up in a single push and unpublishing is not a thing you get
to do. The name is Greg's call: `reading2`, beside the original app's `spideryarn/reading`, rather
than `spideryarn2`, which is only ever the name of this directory.

**A push is not a deploy, and a deploy is not a push.** There is no GitHub Action, nothing rebuilds
on push, and Vercel is not connected to this repo — `vercel deploy` uploads your *working tree*.
See [deployment.md](deployment.md), including the part about that tree containing somebody else's
half-finished edit.

## The reason this doc exists: one tree, several agents

Several Claude sessions work in this directory at the same time. Their in-flight edits sit in the
same files yours do, uncommitted, and **there is no second copy of them**. That produces two rules
that are stricter than normal git practice, and both are in [CLAUDE.md](../../CLAUDE.md) as working
agreements. The reasoning is here.

### Never run a git command that throws work away

No `git checkout -- …`, no `git restore`, no `git stash`, no `git reset --hard`, no `git clean`, no
switching or rebasing branches — **not even "just on my own file"**, because you cannot tell whose
edits are in it. Undo your own mistake by editing the text back. If one of these really seems
necessary, ask Greg.

The remote does not soften this. It holds *commits*; everything dangerous here is uncommitted.

### Commit your own files, by name, in one command

```bash
git reset && git add <your files> && git commit -F <msg> -- <your files>
```

The leading `git reset` unstages whatever someone else left staged. Never `git add -A`, `git add .`
or `git commit -a`.

**The `--` at the end is the load-bearing part**, and the recipe did not have it until 2026-08-26,
when it produced exactly the accident it exists to prevent. `git reset && git add …` and
`git commit …` are two commands and **the index is shared**: another agent running its own
`git reset` in the gap unstages your files and stages its own, and your commit lands *their* work
under *your* message. This is not a race you win by being quick — the gap is however long the tool
call takes. A pathspec on `git commit` bypasses the index entirely and commits those paths whatever
anybody has done to it.

Use `-F <file>` rather than `-m`. A long message in `-m` is one shell-quoting mistake away from the
same mess.

### And the other half of that, which cost us twice on 2026-08-28

*"A pathspec on `git commit` bypasses the index entirely"* is true, and it is the protection above.
It is also a **guarantee that you commit a peer's unstaged work in any file you share**, and that
half was not written down until it had happened twice in one day.

`git commit -- <path>` commits the **working-tree** content of that path. Not the index as well —
*instead of* it. So every hunk sitting in that file goes in, whoever wrote it, however carefully you
staged. Reproducible in four commands:

```
printf 'mine\ntheirs\n' > shared.txt && git add shared.txt && git commit -m base
# stage a change to line 1 only, leave a change to line 2 unstaged
git diff --cached          # shows line 1 — yours
git diff                   # shows line 2 — theirs
git commit -m "with pathspec" -- shared.txt
git show                   # BOTH lines. The staging was discarded.
```

Drop the pathspec and the same setup commits line 1 alone, leaving line 2 unstaged and untouched.

**The two protections are mutually exclusive**, so it is a choice per file, and the cheap check that
decides it is `git diff <file>` — are there hunks in there that are not yours?

| | |
|---|---|
| **Nobody else is in the file** | The recipe above. The pathspec is the right protection, and the risk it guards is real. |
| **A peer has uncommitted hunks in it** | `git reset`, stage only your hunks (`git apply --cached` a filtered patch), confirm with `git diff --cached` **and** `git diff`, then `git commit -F <msg>` with **no pathspec** — so the index is what gets committed. |

Both accidents on 2026-08-28 were this: 338 lines of public-read-only work landed under an
error-monitoring message, and 114 lines of embeddings copy landed under a public-read-only message.
Both were recorded in the commit message and nothing was lost — which is the outcome to aim for when
it happens, because it will. **Commit, not destroy**, is the line that matters; a sweep is
recoverable and an overwrite is not.

The second accident is the one worth reading twice: that agent *knew* the file held a peer's hunks,
deliberately avoided `git add`, staged one hunk through `git apply --cached`, and **verified the
index was right** — and then ran the prescribed committing line, which threw all of that away. Doing
the careful thing and then following the recipe was worse than either alone.

Commit when a piece of work is done and working, without waiting to be asked. And don't stress if
someone sweeps up one of your changes anyway — it happens, it's recoverable, keep going.

### A third way, when you cannot touch the shared index either — 2026-08-28

The right-hand recipe in that table opens with `git reset`, which resyncs the **whole** index. That
is fine when nothing is staged and wrong when a peer has spent ten minutes staging hunks — and you
cannot always tell, because `git diff --cached` is a snapshot of a thing several agents are writing.

A **private index** avoids the question. It writes neither the shared index nor the working tree, so
a peer mid-commit cannot be disturbed:

```sh
export GIT_INDEX_FILE=$(mktemp) && rm -f "$GIT_INDEX_FILE"
BASE=$(git rev-parse HEAD)                                # pin ONCE, here, and reuse it below
git read-tree "$BASE"
git update-index --add -- <your clean files>              # read from the working tree
git show "$BASE:src/shared.ts" > /tmp/mine.ts             # then add ONLY your lines to it
BLOB=$(git hash-object -w /tmp/mine.ts)
git update-index --add --cacheinfo 100644,$BLOB,src/shared.ts
TREE=$(git write-tree)
NEW=$(git commit-tree "$TREE" -p "$BASE" -F msg.txt)      # $BASE, never a fresh rev-parse
git update-ref refs/heads/main "$NEW" "$BASE"             # $BASE = refuses on a race
git reset -q -- <every path you just committed>           # NOT optional — see below
git diff --name-only "$BASE" "$NEW"                       # must list your files and NOTHING else
```

**Run the whole block in ONE shell invocation, and prove it before you trust it.** This is the
single most expensive mistake in this file, because it is silent, it looks exactly like a deliberate
surgical back-out, and it frames somebody else.

An agent harness gives each tool call a **fresh shell**: the working directory persists, and
environment variables do not. So `export GIT_INDEX_FILE=…` in one call and `git read-tree` in the
next is not a subtle race — the variable is simply gone, and `read-tree` writes **`.git/index`**,
the shared one, from a tree that is usually stale. Measured here on 2026-08-29, two consecutive
calls:

```
call 1 sees: GIT_INDEX_FILE=/…/probe.index      call 1 git would use: /…/probe.index
call 2 sees: GIT_INDEX_FILE=<unset>             call 2 git would use: .git/index
```

The recipe above is written as one block because it **must** be run as one — join the lines with
`&&` or newlines inside a single invocation, and do not "tidy" it into readable separate steps.

So make the first line an assertion rather than a hope, in the same invocation as everything else:

```sh
test "$(git rev-parse --git-path index)" != ".git/index" || { echo "PRIVATE INDEX NOT IN EFFECT"; exit 1; }
```

`GIT_INDEX_FILE` is honoured by `git rev-parse --git-path index`, so this is the one command that
can tell you which index you actually got. A recipe whose failure mode is silent needs a check that
speaks.

**Watch the assertion fail once before you rely on it.** Run it in a call with `GIT_INDEX_FILE`
unset and confirm it prints `.git/index` and exits non-zero; only then does the passing case mean
anything. A guard you have never seen trip is not evidence it is guarding — and this one sits in
front of the operation that has already reverted other people's work five times in a day.

**Two dated headings, one trap.** If you link to a heading here that ends `… — 2026-08-29`, the gate
and GitHub disagree: `tests/doc-links.test.ts` strips the em dash as a non-word character and then
collapses the remaining whitespace with a single `\s+` match, so it wants **one** hyphen before the
date, while a browser wants **two**. Both are right about themselves, they differ by a doubled
character nobody proofreads, and the gate is the one that fails the build. Write the single-hyphen
form, and check it by running the gate's own slug over the heading text rather than by eye:

```js
heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-")
```


**Why this went unattributed for a whole day.** On 2026-08-29 the shared index was rewritten at least
five times with a 65-file, ~7,000-deletion revert, and each time the person who looked likeliest
honestly said it was not them. It was not carelessness — **the agent following the recipe most
carefully is the likeliest source**, because they are the only one running `read-tree` at all. The
instruction was the defect, not the person.

**The one number that settles who did it.** Compare each staged path's blob against `git hash-object`
of the file on disk. Anything a person deliberately staged matches disk; a stale `read-tree` matches
none of it. On the incident above, **0 of 65 staged paths matched disk**, which turns an argument
into a measurement. It proves nothing there is anyone's *current* intent — not that nothing was ever
staged deliberately.

Related: [§ A stale index reports the file deleted while it sits there full of content](#a-stale-index-reports-the-file-deleted-while-it-sits-there-full-of-content-2026-08-29),
which is what this looks like from the other end — bare `git diff` compares the tree against the
index, so a corrupted index both invents changes and hides them. `git diff HEAD` reporting *clean*
can be believed; `git diff HEAD` reporting a deletion cannot; bare `git diff` cannot be believed in
either direction.

Build the blob from `git show "$BASE":<file>` **plus your own lines**, never from the working tree, and
anchor each insertion on an exact string that occurs once. That is what guarantees none of their work
rides along. Check afterwards that every symbol you know to be theirs appears zero times in your
version, and parse it (`npx esbuild <file> --loader:.ts=ts --outfile=/dev/null`) — a hand-built blob
is exactly the kind of thing that looks right and is truncated.

**Pin `$BASE` once and pass that same value to all four commands**, and treat the last line as part
of the recipe rather than a flourish. The version above this one captured `OLD=$(git rev-parse HEAD)`
*after* `read-tree HEAD`, which reads as a race guard and is the opposite of one: if a peer commits in
the gap, `OLD` is the **new** head while the tree was read from the old one, so `update-ref` compares
the moved HEAD against itself, succeeds, and silently reverts everything the peer landed in between.
The guard is defeated rather than tripped, and nothing prints.

That is not hypothetical. On 2026-08-28 a session doing outline-mode work landed a commit that
carried its own new files **and a stale-base snapshot of twenty-six files belonging to another
session** — reverting a fully verified stage-4 commit, including deleting two test files that had
been tracked forty minutes earlier. Nobody did anything careless: the working tree still held the
work, the shared index still held it, and only the committed tree had lost it, which is the one place
nobody looks. It was found because the next `git diff --cached` showed twenty-six files staged that
should have been empty.

The gap between `read-tree` and `update-ref` is normally seconds. It is **minutes** whenever you do
the right thing and verify the commit in a detached worktree first, so the safer the process, the
wider this window gets. `git diff --name-only "$BASE" "$NEW"` costs nothing and names every file you
did not mean to touch; run it before you tell anyone the work has landed.

**The last line is the half that bites, and it bites your peers rather than you.** `update-ref` moves
HEAD; the shared index is still the one from before, so it is now stale against the *new* HEAD, and
git renders every path your commit added as **staged for deletion**. For a file you modified, that is
a staged reversal of the lines you just committed. For a file that was **untracked** before the
commit it is worse: `D drizzle/0027_block_roles.sql` staged, `?? drizzle/0027_block_roles.sql` on
disk — a committed migration queued for removal while still sitting in the tree. The next agent to
run an index-based `git commit` commits that deletion under their own message, which is precisely
the accident this whole section exists to prevent, arriving by a new door.

It happened on 2026-08-28. A peer read the status, could not tell it from a deliberate revert,
refused to touch it, and asked — which was the right call and is the behaviour to copy. Run the
`reset` in the **same command** as the ref move rather than as a follow-up step, keep it
path-limited to the paths you just committed so a peer's staged work is untouched, and if somebody
asks, the answer is: transient, mine, not a revert.

### A stale index reports the file deleted while it sits there full of content — 2026-08-29

The shared index falls behind HEAD on its own, without anybody reverting anything: a session reads a
tree into it, or simply staged something before a peer's commit landed, and from then on the index
describes a world that no longer exists. On 2026-08-29 it held a **1,056-line deletion of three
files that had been committed an hour earlier and were sitting on disk the whole time**, and 55
paths were stale in total. A pathspec-less `git commit` at that moment would have shipped that
deletion under whatever message it was given.

**And the obvious check agrees with the index rather than with the disk.** `git diff --stat HEAD --
<path>` reported all three as deleted. That is not a bug and it is not evidence of lost work: a
staged deletion removes the index entry, and with no index entry the file on disk is *untracked* as
far as `git diff HEAD` is concerned — so it compares HEAD against nothing and prints a deletion. The
reading a person takes from that is **the work is gone**; the true reading is **the index does not
know about it**.

The check that answers the actual question needs no index at all:

```
git hash-object <path>          # what is on disk
git rev-parse HEAD:<path>       # what is in HEAD
```

Equal means the file is fine and only the index is wrong, and then `git add` on those paths is
**safe**: it writes index entries pointing at content that is already committed and already on disk.
Nothing changes, no other path is touched, and the landmine is gone. That is what took the 55 stale
paths down to 49. Do the comparison first, every time — it is the step that makes it safe rather
than lucky, and it is also what catches the opposite case, where the on-disk copy is somebody's
unfinished work and staging it would ship a half-done edit.

**And it lies in the other direction too, which is worse.** A few minutes after the above, a peer
checked whether anyone had uncommitted work in the three files their next stage touches. Two
commands, same tree, same instant:

```
git diff --stat src/jobs.ts src/store/artifacts-pg.ts src/store/pg-revisions.ts
  → 3 files changed, 192 insertions(+), 65 deletions(-)
git diff HEAD --stat <the same three>
  → nothing
```

`hash-object` against `rev-parse HEAD:` said all three matched HEAD exactly. Nobody was mid-edit in
any of them. The stale index had **invented** 192 lines of change — and what it was showing was that
peer's own committed work, seen from an index that predates the commit. Trusting it would have meant
waiting for a colleague who was not there, or routing around a file that was free.

So the stale index does not only hide work that exists, it manufactures work that does not, and the
manufactured version is a plausible-looking diff you can sit and read. Both readings of `git status`
in a shared tree are unsafe in both directions: a file it calls deleted may be fine, and a file it
calls modified may be untouched. The sentence to keep is the peer's:

> **`git diff` with no commit argument answers "how does the tree differ from the index", which in a
> shared tree is a question about your colleagues, not about your files.**

`git diff HEAD -- <path>` is the one to reach for when you want "has anyone edited this", and it is
sound in that direction — the failure above is `git diff` *without* `HEAD`. Its own failure is the
opposite one already described: it reports a deletion when the index entry is missing. So "clean"
from `git diff HEAD` can be believed; "deleted" from it cannot, and neither reading of bare
`git diff` can.

Two more things learned the same day. `GIT_INDEX_FILE` **is** honoured by `git rev-parse --git-path
index`, so printing that inside the same invocation proves which index a private-index command
actually got — worth doing, since a `read-tree` that silently landed in `.git/index` is the best
explanation anyone has for how these stale snapshots keep appearing. And a file that is
byte-identical to an older commit is the signature of a stale index at least as often as it is a
deliberate revert; read it as the former first, and ask.

## The thing that fails silently

**A commit can be green here and broken on any other machine**, because the typecheck and the tests
read your working tree, which has files in it that nobody `git add`ed. That is not hypothetical: on
2026-08-26 `src/routes.ts` was committed importing two files that were never added, and it was found
by a deploy, not by a test ([deployment.md](deployment.md)).

`git status` before you commit, and read the untracked list rather than skimming past it. If
something you import is in it, it is yours to add.

## What is deliberately not in git

`.gitignore` has the list; the two worth knowing:

- **`.env*`, with `!.env.example` after it** — every env file, not just the ones that exist today,
  and the negation comes second because order decides. `.env.example` is the only one in git and
  must never gain a real value. See [setup-dev.md § Secrets](setup-dev.md#secrets).
- **`data/`** — every article you have run through the pipeline. Regenerated by spending money, and
  it is where the *article prose* lives, so it stays out. `example/` is the committed fixture that
  gives a fresh clone something to read ([database.md](database.md)).

Also `node_modules/`, `dist/`, `api-dist/`, `.vercel`, and `scratch-bakeoff` (tens of megabytes of
transcribed prose — the numbers worth keeping are committed under `evals/pdf/baselines/`).

## Dropbox

The repository lives inside Dropbox, which means `.git/` — 38 MB of it — is synced continuously.
That is a CPU tax, and syncing a directory mid-write is a known way to corrupt a repository. It has
not bitten us. Since 2026-08-26 there is at least a remote, so a corrupted `.git` costs you the
uncommitted work rather than the project.

## The other repo, and the move that hasn't happened

[deploy-and-repo-move.md](../plans/deploy-and-repo-move.md) plans folding this codebase into the
original app's repo, `spideryarn/reading`, with everything currently there swept into `legacy/`.
That is still open and this remote does not do it — `spideryarn/reading2` is a separate repo, and
creating it changes nothing about the plan except that its step 4 can now fetch from GitHub instead
of from a Dropbox path.

Read the plan's [sequencing trap](../plans/deploy-and-repo-move.md#the-sequencing-trap) before
starting any of it: the moment this codebase lands at the root of `spideryarn/reading`, the old
Vercel project tries to build it as a Next.js app.

It used to say *the project serving spideryarn.com*, and that stopped being true on 2026-08-27 when
[the domain moved](deployment.md#the-domain) to `spideryarn-reading2`. The trap is still real — a
push would still turn that project red — but it now costs the old app rather than the live site.

## See also

- [CLAUDE.md](../../CLAUDE.md) — the working agreements these rules are stated in
- [git-commit-changes.md](../reusable/git-commit-changes.md) — the batch version: how to decide a
  pile of uncommitted changes is finished, quiet and safe to commit
- [deployment.md](deployment.md) — Vercel, and why it ships a working tree rather than a commit
- [setup-dev.md](setup-dev.md) — install, dev, secrets
- [testing.md](testing.md), [typechecking.md](typechecking.md) — what to run before you commit
