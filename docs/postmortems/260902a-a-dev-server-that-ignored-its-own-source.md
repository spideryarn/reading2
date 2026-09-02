# A dev server that ignored its own source

**Found 2026-09-02**, by a browser agent sent to verify a colour change in Referee mode, which
measured the change in a real browser and reported that it had not happened. It had happened. The
dev server it was looking at could not see it, and had not been able to see anything since the moment
it started.

Every worktree since worktrees began has had this. Nobody noticed, because the failure looks exactly
like your change not working.

## What broke

[`vite.config.ts`](../../vite.config.ts) told the file watcher to ignore four globs, one of which is:

```
**/.claude/worktrees/**
```

It is there for a good reason and the reason is written beside it: a peer's worktree is an entire
second checkout, and watching it would reload a reader's page on somebody else's every keystroke.

**Chokidar matches these globs against absolute paths.** A worktree's absolute path is
`/home/greg/code/spideryarn2/.claude/worktrees/<name>/…`, which contains `.claude/worktrees/`. So a
dev server started *inside* a worktree hands its watcher a pattern that excludes **its own entire
source tree**.

The pattern meant to exclude the neighbours excluded the house.

## Why nobody saw it

Nothing errors. The server starts, prints its port, serves the app; the app loads and works. Vite
transforms each module the first time it is asked for and caches it, and the watcher is what
invalidates that cache. With the watcher ignoring everything, nothing is ever invalidated — so the
server goes on serving the source it read at boot, for as long as it runs.

What an agent then sees is its own change missing from the page. The obvious readings are all wrong
and all plausible: the browser cached it, the change was in the wrong file, the change was wrong. A
hard reload does not help. `Network.setCacheDisabled` does not help, because the browser was never
the problem.

This is the shape [silent-success.md](../reusable/silent-success.md) collects, with the extra turn
that makes it expensive: **the check disagrees with the code, and the check is the one you trust**.
Driving a real browser is the strongest evidence this project has, and here it was systematically
lying.

It was caught because the agent did not stop at "it did not work". It proved the server was the
source three ways — the categorical colours were on marks whose API response plainly carried a
valence; a plain `curl localhost:5274/src/web/valence.ts`, no browser anywhere, returned a
transformed file with no `valenceDirection` in it while the file on disk had one; and appending a
throwaway `?bust=` to the same URL made Vite re-transform and return current code.

## The commit that introduced it

`**/.claude/worktrees/**` was added to `server.watch.ignored` when worktrees arrived
([260828r-worktrees.md](../plans/260828r-worktrees.md)), and it was correct for the checkout it was
written in. Worktrees were built from the primary, tested from the primary, and the doc's own
measurements — `npm ci` at 16.6 s, `node_modules` at 681 MB, 95 → 14 red test files — are all things
you can measure without ever starting a dev server in one.

So this is not a bug that was introduced and then broke something that worked. It is a line that was
**only ever right from one of the two places it runs from**, and it was written from that one.

## The fix

[`devWatchIgnored`](../../scripts/worktree-admin.ts) — a pure function, handed the directory the
config sits in, which drops the worktrees glob when that directory is itself inside a worktree.
Dropping it there costs nothing: worktrees live under the *primary's* `.claude/`, so a worktree never
contains one.

Read from the config file's own location rather than `process.cwd()`, because which checkout is being
served is a fact about where the file sits, not about where the command was typed.

**Measured rather than assumed**, on two servers running side by side against one tree:

```
                      warm cache      after editing the file
  5274, no fix        "after"         "after"      ← never sees it, ever
  5275, with fix      "one"           "two"        ← tracks every edit
```

## What would have caught the class

The unit test that now exists (`tests/worktree-admin.test.ts` § *what the dev server's file watcher
ignores*) is worth having, and it is not the answer — it was written *after* somebody knew what to
look for, which is the easy half.

The generalisable lesson is smaller and sharper than "test your config":

> **A path-matching rule that names a directory the program can also be running inside is a rule with
> two behaviours, and you have only tried one of them.**

`.gitignore` ignores `.claude/worktrees/`, [`scripts/typecheck.ts`](../../scripts/typecheck.ts) skips
it, [`scripts/worktree-setup.ts`](../../scripts/worktree-setup.ts) writes into it. Three of those
four are fine, and the reason is worth writing down: they run *from the primary* by construction, or
they resolve the path relative to a root they establish themselves. The watcher was the one that
runs from both places and matches absolutes. When adding the next such rule, the question to ask is
*what does this do when we are standing inside the thing it excludes?*

`worktree-setup.ts` already asks a version of that question and answers it well — it **refuses to run
in the primary**, because it runs `npm ci` and a dozen agents work out of the primary. It asks git
rather than guessing from the path. That guard is the model; this was the same class of question left
unasked.

## Also worth knowing

The stale server had been serving this session for over two hours before it was caught, which means
**every browser observation taken against it before 2026-09-02 11:00 is suspect** unless it was taken
against a freshly started server. The baseline pass earlier that morning is fine — it started its own
reading before any source had changed — but that is luck rather than method.

Practical rule until something better exists: **start the dev server after your edits, or restart it
before you measure.** Better still, one command that does both, which is
[worktrees.md](../project/worktrees.md)'s to own.
