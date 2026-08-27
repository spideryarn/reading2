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
git status --porcelain; git status --porcelain -z | xargs -0 -n1 sh -c 'stat -f "%m %N" "$1" 2>/dev/null' _
```

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
git reset && git add path/one.ts path/two.md && git commit -F msg.txt -- path/one.ts path/two.md
```

The trailing `--` pathspec is load-bearing when the tree is shared: `git add` and `git commit` are
two commands and the index is shared between everyone, so without it another agent's `git reset` in
the gap lands *their* work under *your* message.

Write the paths out literally on both commands. In zsh an unquoted `$FILES` is **not** word-split —
`FILES="a.ts b.ts"; git add $FILES` passes one giant filename, git rejects it, and the `git reset`
in front of it has already run.

## Say what you skipped

Finish by listing the batches you left alone and why — still moving, tests red, couldn't tell what
it was. That list is the useful half of the report: an unexplained gap reads as "the tree is
committed" when it isn't.
