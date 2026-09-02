# Commit what's uncommitted, in batches

Not project-specific. What to do when you're asked to sweep up a working tree that has drifted —
lots of uncommitted changes, some of them yours, some of them not — and turn it into a sane run of
commits.

The rule that makes it safe: **commit only what you're confident about, and leave the rest.** A
batch you skip costs nobody anything. A batch you commit while someone is still typing into it
ships half-written work under a confident message, and the message is what the next person will
believe.

## Three questions per batch, in this order

**1. Is anyone still working on it?** `git status` cannot tell you. It shows a file as modified
whether the agent editing it finished an hour ago or is mid-save right now. Poll instead:

```bash
# Linux — on macOS, stat -f "%m %N" instead
git status --porcelain -z | tr '\0' '\n' | cut -c4- | while IFS= read -r f; do [ -e "$f" ] && stat -c "%Y %n" "$f"; done | sort -n
```

Two ways this line goes wrong, and both print nothing or nonsense, which reads as "the tree is
quiet": `stat` takes different flags on the two platforms, and each porcelain entry starts with a
two-character status and a space, which `cut -c4-` strips — hand `stat` the raw entry and it
looks for a file called ` M path`. Keep its errors visible.

Take that reading, wait, take it again. If nothing has moved for a few minutes, the tree is quiet.
If mtimes keep ticking, wait longer or narrow to the files that have gone still — and don't touch a
file whose mtime moved since your last reading.

**2. Is it finished?** Read the diff, not the file list. Half-done work usually looks like it:
a function called nowhere, a test with no assertions, a doc paragraph that stops. If you can't tell
what a change was *for*, you can't write its message, which is the same signal.

**3. Does it work?** Run the project's checks — the typecheck and the suite — before each batch,
not once at the end. A stale failure that vanishes on a second run was a mid-edit snapshot rather
than a bug; a failure that survives means the batch is not ready, and the fix is to skip it, not
to fix somebody else's work in passing.

## Oldest first

Order the batches by when the work happened — oldest mtime first — and group by what the change
*was*, not by directory. That gives a history somebody can read backwards, and it puts the
long-settled changes (safe) before the ones that were being typed ten minutes ago (not).

**Get new files in early.** An untracked file that a committed file imports breaks the build for
everybody while your own tree stays green, so nothing you can run will tell you. When a batch
includes new files, they go in the same commit as whatever imports them — or earlier.

## Then commit, naming the files twice

```bash
git add -- path/new.ts && git commit -F msg.txt -- path/new.ts path/existing.md
```

The trailing `--` pathspec is load-bearing when the tree is shared: it commits those paths **from
the working tree, ignoring the index**, so whatever anybody else has staged is neither committed nor
disturbed. Without it you commit the shared index, which is somebody else's business.

`git add` is only for files git has never seen — a pathspec cannot name an untracked file, and the
error (*"did not match any file(s) known to git"*) reads like a typo. Tracked files need no `git
add` at all.

**Do not put `git reset` in front of it.** It buys you nothing, because the pathspec has already
made the index irrelevant, and it throws away whatever a peer had staged.

Write the paths out literally on both commands. In zsh an unquoted `$FILES` is **not** word-split —
`FILES="a.ts b.ts"; git add $FILES` passes one giant filename and git rejects it.

## Say what you skipped

Finish by listing the batches you left alone and why — still moving, tests red, couldn't tell what
it was. That list is the useful half of the report: an unexplained gap reads as "the tree is
committed" when it isn't.
