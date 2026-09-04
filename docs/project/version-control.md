# Version control

Where the code lives, and the one habit that is different here because several agents share a
working tree.

## Where it is

| | |
|---|---|
| Remote | `git@github.com:spideryarn/reading2.git` — **private**, in the `spideryarn` org |
| Web | <https://github.com/spideryarn/reading2> |
| Branch | `dev` is the trunk: commit and push there. `main` is **production**, written only by `npm run deploy` — see below. No branch protection, no PRs, no CI |
| Local | `/Users/greg/dev/spideryarn/reading2`, beside the original app's `reading`. Out of Dropbox since 2026-09-01, see below |
| Since | 2026-08-26. The first 239 commits, back to 2026-08-24, were pushed in one go when the remote was created |

Created with `gh repo create spideryarn/reading2 --private --source=. --remote=origin --push`.
Private because the whole history went up in a single push and unpublishing is not a thing you get
to do. The name is Greg's call: `reading2`, beside the original app's `spideryarn/reading`. The
directory was `spideryarn2` until 2026-09-01, when it was renamed to match —
[260901e](../plans/260901e-move-repo-out-of-dropbox-to-dev-spideryarn-reading2.md).

**A push to `main` IS a deploy.** Vercel's git integration is connected, `vercel.json` sets
`git.deploymentEnabled` to `{"**": false, "main": true}`, and a push to `main` builds on Vercel's
machine and goes live. [`scripts/deploy.ts`](../../scripts/deploy.ts) depends on exactly that: it
pushes one gated sha by name and then polls for the production deployment *that push causes*.

**So the invariant that matters is that only `npm run deploy` writes `main`.** Anything else that
pushes to `main` — a worktree landing its work, say — turns every landing into an unreviewed
production deploy, which is the thing the whole gate exists to prevent.

**That is why the trunk is `dev`.** Since 2026-09-02 the primary checkout stands on `dev`, agents
commit and push there, and the `**: false` wildcard above means such a push builds nothing. Two
consequences worth having straight:

- **`npm run deploy` now refuses to run from `main`** — `DEPLOY_SOURCE_BRANCHES` in
  [`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) is `["dev"]` alone. It accepted both
  through the changeover. `main` had to go because it is the one deploy path with **no trunk
  comparison**: `trunkGap` is scoped to the trunk, so a checkout still standing on `main` could
  promote main-only work and leave `dev` silently behind production.
- **Deploying still pushes to `main`, by sha and by name.** The trunk moving does not change where
  production lives. `dev` is where work lands; `main` is what is live.

**`origin/HEAD` is a local ref in every clone, and GitHub changing its default does not move it.**
Run `git remote set-head origin dev` in each one — the explicit form, because the `-a` spelling asks
GitHub, whose default branch is a separate setting that may not have been flipped yet. Miss this and
a tool resolving `origin/HEAD` branches from production without saying so.

> **This paragraph said the opposite until 2026-09-01**, and it was wrong rather than merely out of
> date: *"There is no GitHub Action, nothing rebuilds on push, and Vercel is not connected to this
> repo."* True once, and left behind when the git integration was connected. Recorded because it is
> not a harmless staleness — an agent reasoning from it would conclude that pushing to `main` is
> free, and that is the one mistake here that reaches real readers.

There is still no GitHub Action, and `vercel deploy` does upload your *working tree* — which is a
separate hazard, since that tree contains somebody else's half-finished edit. See
[deployment.md](deployment.md).

### What protects `main`, and what does not

**Nothing mechanical, as of 2026-09-02.** The invariant above is enforced by this document and by
AGENTS.md, and by nothing else. Measured on the box that day rather than assumed:

- **No git hooks exist.** `.git/hooks` holds only `.sample` files and `core.hooksPath` is unset. So
  `git push origin main`, `git push origin dev:main` and `git push origin <sha>:refs/heads/main` are
  all unblocked, from an agent's shell or yours.
- **A bare `git push` is safe.** `push.default` is unset, so git 2.43 uses `simple`: from `dev` it
  pushes `dev` and nothing else. Confirmed with `git push --dry-run`, which named only `dev -> dev`.
  So reaching `main` takes a command that *names* `main`.
- **`git push --all` ignores which branch you are on.** A dry run would have created `worktree-e2e`
  and `worktree-spike` on the remote. Those do not build (`"**": false`), but if local `main` were
  ever ahead, `--all` would ship it. Don't use it here.

The plan to make this mechanical — a tracked `pre-push` hook, and why it is the right layer rather
than an extension of `.claude/hooks/protect-shared-tree.sh` — is
[260902b-protect-main-from-an-accidental-push.md](../plans/260902b-protect-main-from-an-accidental-push.md).
One thing from it is worth knowing now, because it is not obvious: **a worktree resolves hooks to the
primary's `.git/hooks`**, so a single hook file would cover every worktree with no per-worktree step.

Until it exists, the rule is the protection: **do not push anything to `main` yourself.** Deploying
does it for you, from `dev`, by sha and by name.

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

#### `rm` is the hole in this rule, and it was found the same way — 2026-09-04

The list above is all `git`, and a hook enforces part of it. **`rm` is not on it and nothing stops
it.** An agent finishing a screenshot task was told to keep its files out of the repo root, tidied
up after itself, and removed three untracked files it had not created — `.tmp-smoke.mts` and two
`privacy-*.png` — which belonged to somebody else's unfinished work. Copies happened to survive in
the primary checkout, so nothing was lost, and that was luck rather than care.

Two things follow. **Delete only paths you wrote, by name** — never a glob, never "tidy the repo
root", because an untracked file in a shared tree is somebody's work by default and gitignored
artefacts have no second copy anywhere. And **when you brief a subagent, say it**: the brief that
caused this said *keep your files out of the repo root* and did not say *delete nothing you did not
write*, which the agent read, reasonably, as permission to clear the space.

Restoring from another tree is not the fix either. A file you cannot confirm is byte-identical is
worse in a shared tree than an absence somebody notices — say what went missing and let its owner
decide.

#### It happened, and the way it happened was carelessness rather than reasoning — 2026-08-30

An agent finishing a Sketch change wanted to know whether a failing test was its own, and wrote a
one-line shell command that began `git stash`. There was no argument for it and none was made: the
question could have been answered by reading the failing test's imports. It stashed all twenty
modified files in the tree — three of its own and seventeen belonging to four other agents.

**What made it recoverable was luck and one property of `stash`.** Unlike `reset --hard`, a stash
keeps what it takes. But the way back was blocked twice over: the harness's permission classifier
refuses `git stash pop` and `git stash apply` — correctly, since the rule above forbids the whole
family — and by the time Greg ran `pop` himself a peer had re-modified four of the files, so the pop
aborted with *"Your local changes would be overwritten by merge"* and did nothing.

**The route back, which is not a git command at all.** For each stashed path, if the working file is
still identical to `HEAD` then restoring it can lose nothing, so read the stash's copy and write it
as an ordinary file:

```bash
for f in $(git stash show --name-only stash@{0}); do
  git diff --quiet HEAD -- "$f" && git show "stash@{0}:$f" > "$f"
done
```

`git show` and a redirect: a read and a write, no index, no merge, and nothing touched that anyone
has edited since. Files a peer *has* re-modified are left alone and reported — here all four turned
out byte-identical to the stash anyway, because the peer had simply redone the same work. Verify
each restored file against the stash before believing it, and leave the stash entry standing until
somebody has looked.

**The lesson is not "stash carefully".** It is that a forbidden command can reach the shell inside a
compound one-liner written for an unrelated purpose, where nothing about the line looks dangerous —
which is why the rule is a flat ban on the words rather than a judgment to be made per case.

#### And the countermeasure, from one of the sessions it happened to

The prohibition above is not enough on its own, because it only has to be typed past once. What
follows is `spideryarn2-1f`, who lost four files that night and got them back from a copy it happened
to have made for something else:

> the sweep was invisible to me for about ten minutes, and nothing in my own loop would ever have
> told me. I had written three files, run the tests, run the typecheck, and moved on to reviewing.
> None of that re-reads a file you have already written — the tests I ran were against other code,
> the typecheck passed because the tree was internally consistent at HEAD, and I had no reason to
> open Masthead.tsx again. I found out only because a GPT Sol review I had running in the background
> mentioned, in a closing aside, that the implementation files had disappeared underneath it. The
> detection was an outside observer, by accident, and the inside view was structurally blind.
>
> So the countermeasure I would write down is: **re-grep your own content markers before you trust an
> earlier edit.** One `grep -c OriginMark src/web/Masthead.tsx` would have caught it in seconds, at
> any point in those ten minutes.
>
> It generalises past this incident … a peer rewriting a shared file can swallow your change just as
> completely as a stash, and that leaves no reflog entry to find afterwards. … A habit that catches
> the damage is worth more than a prohibition that can be typed past.

That is the same habit [§ Nobody knows who edited an uncommitted file](#nobody-knows-who-edited-an-uncommitted-file)
argues for from the other direction, and this is the case that shows why it is not optional.

And the thing that actually did the saving:

> I had a diff of my work in a scratchpad outside the repo, saved minutes earlier for an unrelated
> reason (feeding a review). That is the only reason my four files came back as current work rather
> than out of your loop. "If you have substantial uncommitted work in a shared tree, keep a copy
> outside it" is cheap and would have made this a non-event for everyone.

#### One of them is now enforced, not just written down — 2026-08-30

`git stash` is the one that actually happened, so it is the one that got a guard.
[`.claude/hooks/protect-shared-tree.sh`](../../.claude/hooks/protect-shared-tree.sh) is a
`PreToolUse` hook on `Bash`, wired up in [`.claude/settings.json`](../../.claude/settings.json). It
reads the command out of the tool call and **refuses any command mentioning both `git` and `stash`
as words** — exit 2, which blocks the call and hands the agent the reason.

It matches the *whole* command, not its first word, because that is how it got in last time: the
banned clause was the tail of a one-liner about something else. `npm test; git stash` is refused.

**It over-refuses, deliberately.** `grep -rn "git stash" docs/` is refused too. Either word alone is
fine, so `grep -rn stash docs/` still works; when a command genuinely needs both, use the Read/Grep
tools instead of Bash, or ask Greg. Judging it per command is what failed.

Three things it is worth knowing before you change it:

- **The other four are still honour-system.** `checkout --`, `restore`, `reset --hard`, `clean` —
  and `rm` — are unguarded. Extending `VERB` in the hook is small; nobody has asked for it yet.
- **It fails closed.** If `grep` errors, or the payload will not parse, it refuses rather than
  allowing — and it self-tests its own matcher on a known hit and a known miss before trusting it to
  say "safe". A guard that quietly stops matching is
  [a silent success](../reusable/silent-success.md), and this one is meant to be noisy instead.
- **Do not put the banned words in a file name.** The first draft was called `no-git-stash.sh`, and
  no Bash command could name it — including the `git commit -F msg -- <path>` that would have
  checked it in. That is why the file is named for what it protects.

Re-verify it with `bash .claude/hooks/protect-shared-tree.test.sh`: twenty-odd payloads that must be
refused, controls that must be allowed, and the whole suite re-run with `python3` and then `grep`
sabotaged. It is not wired into `npm test` — it is a shell script guarding a shell, and it takes a
second to run by hand.

### Always merge, never rebase

Integrate with `git merge`, never `git rebase`. **This holds inside your own worktree too**, where the
"you cannot tell whose edits are in it" reason above genuinely does not apply — so it needs its own
reasons, and it has six. Decided 2026-09-01, when Greg asked the right question about a draft that had
proposed the opposite:

> Does rebase make things more difficult for the agents than having always-merge as a rule?
>
> — Greg, 2026-09-01

It does. Two of the reasons are specific to this repo:

1. **A rebased sha is a citation that points at nothing.** This repo references commits constantly —
   GPT Sol reviews cite them, plans say "done (`96c7661`)", every postmortem names the commit that
   introduced the bug. Rebase rewrites every commit it moves, and the reference does not break loudly:
   it keeps looking like a sha and resolves to nothing.
2. **A replayed conflict is one round trip per commit.** Rebase replays each of your commits over the
   new base, so a single conflict can surface as many times as you have commits — and under
   [git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md)'s *"Make a proposal.
   Don't make changes yet"* rule, that is a round trip with Greg each time. One merge, one proposal.

And four that are ordinary good sense:

3. **You push the commit you tested.** After a merge, the thing you push is the thing `npm test` ran
   on. After a rebase — especially a second one, after losing a push race — the tested arrangement no
   longer exists anywhere.
4. **It degrades better under contention.** With a dozen agents landing on one branch, losing the race
   is routine. A merge retry costs one more merge commit; a rebase retry replays your whole stack
   against yet another base.
5. **A stopped merge is a state an agent can read.** Interrupted mid-rebase you are on a detached HEAD
   with a rebase in progress, and the ways out — `git rebase --abort`, `--skip` — are indistinguishable
   from the throw-work-away commands the rule above forbids. An agent is then stuck between two rules.
   An interrupted merge leaves you on your own branch with markers in files.
6. **Nothing has to change to allow it.** The ban above stays exactly as written, rather than growing a
   carve-out that a future reader has to reason about.

**What it costs** is a braided history once several agents are landing: `git log` on the trunk stops
being readable, and `git log --first-parent` is how you read it back. Worth knowing rather than worth
avoiding — and nothing downstream cares, because `git merge-base --is-ancestor` answers "did this
land?" identically either way, which is what a worktree sweep asks
([worktrees.md](worktrees.md)).

**Most landings never conflict.** A plain non-fast-forward merges automatically, so the proposal rule
fires on real textual conflicts only, not on every push.

### Commit your own files, by name, in one command

```bash
npm run check:staged-revert      # is the index quietly undoing somebody's commit?
git add -- <any NEW files> && git commit -F <msg> -- <all your files>
```

**The first line is [`scripts/check-staged-revert.ts`](../../scripts/check-staged-revert.ts)**, and
it is here because for a long time it was nowhere. It was written as the answer to the six hours of
phantom reverts [below](#the-cause-was-the-recipes-own-last-line-not-a-stray-command-2026-08-29) —
*"the fix is not a firmer comment — it is `scripts/check-staged-revert.ts` run before every commit,
by everyone"* — and then lived only in that sentence, two thirds of the way down this page, with no
npm script, no git hook and no mention in the recipe anybody actually reads. A guard reachable only
by someone who already knows the incident is a guard for nobody. It got its `npm` name and this line
on 2026-09-03; the hook is still not installed, and until it is, this line is the whole mechanism.

**The `--` at the end is the load-bearing part**, and the recipe did not have it until 2026-08-26,
when it produced exactly the accident it exists to prevent. A pathspec on `git commit` bypasses the
index entirely and commits those paths from the working tree, whatever anybody has done to the
index. Use `-F <file>` rather than `-m`; a long message in `-m` is one shell-quoting mistake away
from the same mess. Never `git add -A`, `git add .` or `git commit -a`.

`git add` is there for one reason only: **a pathspec cannot name a file git has never seen.**
`git commit -F msg -- brand-new.txt` fails with *"did not match any file(s) known to git"*, which
reads like a typo and is not one. Tracked files need no `git add` at all.

**The recipe used to open with `git reset`, and that was wrong.** It was described here as a
feature — "unstages whatever someone else left staged" — which is the same sentence as "destroys
whatever a peer spent ten minutes staging". It buys you nothing, because the pathspec has already
made the index irrelevant. Measured on 2026-08-30, with a peer holding `peer.txt` staged *and*
further modified, running `git commit -F msg -- mine.txt` with no reset at all:

```
before   M  mine.txt    MM peer.txt    ?? brand-new.txt
commit   mine.txt | 1 +                     ← only my file, as intended
after                   MM peer.txt    ?? brand-new.txt    ← peer untouched, both halves intact
```

So the reset was pure cost. It is also the only part of the old recipe that could be interrupted:
one `git add && git commit` is a single invocation, and there is no gap for a peer to land in.

**And the plain form repairs the shared index rather than corrupting it.** An ordinary `git commit`
rewrites the index entries for the paths it commits, so any staleness in them is gone. That matters
more than it sounds — see [the section below](#the-cause-was-the-recipes-own-last-line-not-a-stray-command-2026-08-29),
where a whole day of phantom reverts survived precisely because every session was carefully
avoiding the shared index.

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

So it is a question per file, and the cheap check is **`git diff HEAD -- <file>`** — are there hunks
in there that are not yours? Use that form, not bare `git diff`, which asks "how does the tree
differ from the *index*" and in this tree is a question about your colleagues rather than your files
([below](#a-stale-index-reports-the-file-deleted-while-it-sits-there-full-of-content-2026-08-29)).

#### And a third consequence: **there is no earlier version of the file to commit** (2026-08-31)

The two above are about hunks you did not mean to take. This one is about a commit you cannot make
at all, and it costs a wrong commit *message* rather than wrong contents.

A stage-2 commit was planned as two: the work, and then the fixes for a review that had come back
NO-SHIP. By the time it was written the agent holding `src/fetch.ts` had already applied its fixes
to that file — and a pathspec commits the working tree, so **committing `src/fetch.ts` at all meant
committing the fixed one**. There was no pre-fix version left anywhere: not in the index, which the
pathspec ignores, and not on disk, which is where the fix was. The split existed only in the plan.

The commit went in saying the fixes were "part-landed and complete in the next commit". They had
landed in full, so the log entry implied a fault was still live at a commit where it was not.
Amending was already unavailable — another session had committed on top — so the correction is its
own commit (`5cf7827`), which is the right shape: a message that was wrong about the tree is worth a
line in the history rather than a quiet rewrite.

**The rule.** Decide what a commit *says* from `git diff HEAD -- <paths>` at the moment you write
the message, never from what you asked somebody to do. In a tree where agents edit the files you are
about to name, the plan and the working tree diverge silently, and the pathspec always believes the
working tree.

| | |
|---|---|
| **Nobody else is in the file** | The recipe above. Nothing further to think about. |
| **A peer has uncommitted hunks in it** | Either commit it anyway and name their work in your message, or leave that file out and ship the rest. Both are fine. |

**Sweeping a peer's hunks is a cheap accident and it is meant to stay cheap.** It is loud, it is
recorded in your message, and nothing is destroyed — the two 2026-08-28 incidents cost a paragraph
each. Do not trade it for something worse, and both clever alternatives are worse: partial staging
into the shared index cost us the accident described two paragraphs down, and the private index cost
six hours of phantom reverts across the whole tree on 2026-08-29 and nearly removed the
DNS-rebinding fix under somebody else's message.

If a file really cannot be swept and really cannot wait, **ask Greg** rather than reaching for the
recipe below.

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

### The private index is gone — 2026-08-30

There used to be a third recipe here. When a file held your finished work *and* a peer's unfinished
work, it built a commit off to one side — a private staging area of your own (`GIT_INDEX_FILE`),
`hash-object` for a hand-made version of the file, `write-tree`, `commit-tree`, `update-ref` — so
that neither the shared index nor the working tree was touched.

**Greg removed it on 2026-08-30.** Do not use it, do not reintroduce it, and if you find a plan or a
commit message describing it, that is a record of what we used to do.

> get rid of the private index approach altogether … and accept that sometimes other agents' work
> might get included in a commit, and/or skip the file.
>
> — Greg, 2026-08-30

**Why.** It was clever, it worked for the person running it, and it broke things for everybody else.
A commit built that way deliberately never touches the shared index, so the shared index is left
describing the world *before* that commit — and to every other agent that reads as somebody having
staged an undo of the work. Six hours of 2026-08-29 went on hunting a stray command that nobody had
run. The recipe printed here was also **wrong as written**: its final resync was inside the `export`,
so it fixed the private staging area and left the shared one stale. Sessions that dropped that line
and sessions that followed the recipe exactly produced identical damage.

It also cost more than it ever saved. What it was avoiding — sweeping a peer's hunks into your commit
— is loud, recorded in your message, and recoverable; the two 2026-08-28 incidents cost a paragraph
each. What it caused nearly removed the DNS-rebinding fix from `src/fetch.ts` under somebody else's
message.

**What to do instead** is the table above: commit the file and say whose work rode along, or leave
that file out and ship the rest. Both are fine. Waiting is also fine.

The forensics are kept below because they explain why a stale index reads as a deliberate revert,
which you still need in order to read `git status` in this tree — not because the recipe is coming
back.

### The cause was the recipe's own last line, not a stray command — 2026-08-29

**Reproduced, in both directions, with a control.** For most of the day this was blamed on a stray
`read-tree` running against `.git/index` because `GIT_INDEX_FILE` had not survived into the call. That
hazard is real and is demonstrated below, but it was **not** what happened here. The cause is the
recipe's **final `git reset -q -- <every path you just committed>` being omitted.**

A private-index commit deliberately never touches the shared index. So without that last line the
shared index keeps the **pre-commit** state of every path in the commit, and that produces both halves
of the signature exactly:

| The commit | What the shared index keeps | How `git diff --cached` reads it |
|---|---|---|
| **adds** a file | no entry for it | a **staged deletion** of a file that is in HEAD and on disk |
| **modifies** a file | its pre-commit blob | a **staged modification** byte-identical to a revert of that commit |

In a throwaway repo, one private-index commit adding `late.txt` and no final reset:

```
late.txt in HEAD?   YES
late.txt on disk?   YES
SHARED INDEX SAYS:  D  late.txt
```

and for a modified file, the staged blob is the *old* content while HEAD holds the new one — a
byte-identical revert, staged, with nobody having staged anything. **With** the final reset, the
shared index stays empty. That control is what makes the reset the cause rather than a correlate.

**And on 2026-08-30 the second half of it turned up: you could run that line faithfully and still
get this.** The recipe printed in this file had the reset *inside* the `export GIT_INDEX_FILE`, so
it resynced the private index rather than the shared one. Sessions that dropped the line and
sessions that kept it produced the same damage, which is why "somebody is omitting it" never quite
accounted for the volume. Rather than fix it, Greg
[removed the recipe](#the-private-index-is-gone-2026-08-30).

**Why it went unattributed for six hours.** Nobody was running a stray command, so nobody could find
one. Each session omitted one line, the effects accumulated, and every clear was undone within minutes
by the next private-index commit. It also explains what never fitted the stray-command theory: why the
45 files were *modifications* byte-identical to an older commit rather than deletions, and why a5's
attempted reproduction **failed** when they used plain `git add` for the later commits — `git add`
writes the shared index and so keeps it current. The bug needs private-index commits specifically.

**So the final `reset` is load-bearing for your peers, not for you** — which is exactly why it gets
dropped. Its author's own commit is perfect; the damage is entirely in what everyone else's
`git status` says afterwards, and they have no reason to connect it to you.

**The sweep that would have broken it, and did not.** If any staged blob held content that never
existed anywhere in history, it would be a hand-crafted revert and this theory would be wrong. All 16
paths in the 20:20–20:55 batch matched a real historical version — and all 16 matched **the same
commit**, `f42a877`. One commit, its exact path set, held at its pre-commit state. That is the
omitted-reset signature in its purest form, and it retires the last of the "index read at some old
tree" framing: the index was never read at an old tree, it simply **never learned about `f42a877`.**

*Scope, so this is not over-read:* that sweep covered the 16-path batch, not the earlier 87-path one,
which nobody has been through path by path. And the reproduction shows the mechanism is *sufficient*;
attributing any particular incident rests on the dating work, not on the throwaway repo.

**Why it will happen again anyway, and this is the part to read if you skip the rest.** The mechanism
explains how; the *incentive* explains the recurrence. Omit that line and:

- your own commit is perfect
- your own `git status` looks briefly odd, then you move on
- **everyone else inherits a staged revert of your work, and nothing tells you**

No feedback ever reaches the person who could fix it. A step whose only victim is somebody else is the
step that rots, and a `# NOT optional` comment is no match for that gradient. The fix is not a firmer
comment — it is `scripts/check-staged-revert.ts` run before every commit, by everyone, so the cost
lands on the person who caused it.

**The rule behind all of this, and it is one rule rather than three.** In this harness, *separate
tool calls are separate shells and separate instants*, so **anything that must be true at the moment
a command runs has to be established in the same invocation as that command.** Three of the day's
accidents are the same mistake wearing different clothes:

| The thing that must hold | How it gets lost | What it cost |
|---|---|---|
| `GIT_INDEX_FILE` is set | `export` in the previous call — a fresh shell has none of it | the shared index, rewritten from a stale tree |
| the working tree still matches what you checked | `git diff --stat HEAD` in the previous call; `git commit -- <path>` reads the tree **again** | a peer's uncommitted section committed under somebody else's message, 2026-08-29 |
| the commit actually happened | `&& echo COMMITTED` reports on the command, not the repository | a minute spent believing work had landed that had not |

So the general form is: **put the check and the thing it guards in one invocation, and finish by
asking the repository rather than the pipeline.** `git show --stat HEAD` afterwards is the net that
catches whatever the window still let through — cheap, and it is the only one of these that works
after the fact.

The check-then-commit window is the least obvious of the three, because both commands are correct and
the gap between them is the entire bug. Reading `45 insertions` and then committing `74` is not a
command misbehaving; it is two reads of a moving tree.

**Watch the assertion fail once before you rely on it.** Run it in a call with `GIT_INDEX_FILE`
unset and confirm it prints `.git/index` and exits non-zero; only then does the passing case mean
anything. A guard you have never seen trip is not evidence it is guarding — and this one sits in
front of the operation that, from a single mistake, produced six hours of phantom reverts across
this tree on 2026-08-29 — see below.

**The recipe can print `COMMITTED` having committed nothing.** The block above ends by *doing* things
and never by *asking whether they happened*, and on 2026-08-29 that cost a minute of believing work
was landed that was not. A heredoc writing `msg.txt` was blocked by a permission prompt, so
`git commit-tree -F msg.txt` failed on a missing file, `NEW` came back **empty**, and

```sh
git update-ref refs/heads/main "$NEW" "$BASE" && echo "COMMITTED $NEW on $BASE"
```

still printed its success line. The only tell was a **doubled space** where the commit id belongs —
`COMMITTED  on 75ef7e5` — which nobody proofreads. `main` was untouched, so there was no damage that
time; the damage is that the next thing you do is move on.

It is the same shape as the index bug one level up: **the line reports on the command it ran, not on
the state that command was supposed to produce.** So guard the inputs, and finish by asking the
repository:

```sh
[ -s msg.txt ] || { echo "ABORT: no message file"; exit 1; }   # a blocked heredoc leaves no file
NEW=$(git commit-tree "$TREE" -p "$BASE" -F msg.txt) || exit 1
[ -n "$NEW" ] || { echo "ABORT: empty commit id"; exit 1; }
git update-ref refs/heads/main "$NEW" "$BASE" || exit 1
[ "$(git rev-parse HEAD)" = "$NEW" ] || { echo "ABORT: HEAD is not the new commit"; exit 1; }
```

A missing input file is worth calling out on its own: in an agent harness a blocked or denied tool
call is **routine, not an edge case**, and most recipes treat a missing input as an error that will
obviously propagate. Here it propagated into a success message.

**Two dated headings, one trap.** If you link to a heading here that ends `… — 2026-08-29`, the gate
and GitHub disagree: `tests/doc-links.test.ts` strips the em dash as a non-word character and then
collapses the remaining whitespace with a single `\s+` match, so it wants **one** hyphen before the
date, while a browser wants **two**. Both are right about themselves, they differ by a doubled
character nobody proofreads, and the gate is the one that fails the build. Write the single-hyphen
form, and check it by running the gate's own slug over the heading text rather than by eye:

```js
heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-")
```

For a link **into another file**, a5's rule is simpler and worth preferring: link the file and drop
the fragment entirely, rather than guessing which convention applies. Within one file that makes the
link useless, so there you do have to get the slug right.


**Why this went unattributed for a whole day.** On 2026-08-29 the shared index was rewritten at least
five times with a 65-file, ~7,000-deletion revert, and each time the person who looked likeliest
honestly said it was not them. It was not carelessness — **the agent following the recipe most
carefully is the likeliest source**, because they are the only one running `read-tree` at all. The
instruction was the defect, not the person.

**It is two faults multiplied, not one.** a5's reconstruction, and it explains a shape that a single
stale snapshot cannot produce:

- An absent `GIT_INDEX_FILE` decides **where** the write lands — the shared `.git/index` rather than
  a private one.
- A `BASE` captured once and reused on a later retry decides **how stale** the tree written there is.

Either alone is survivable. A private index with a stale `BASE` writes an old tree somewhere nobody
reads; a shared index with a fresh `BASE` is close to a no-op. Together they write an increasingly
old snapshot into the index everybody shares, and it reads as a precise, deliberate back-out of
exactly the work that landed in between.

**How many writes there were, and why this paragraph has now said three different things.** This paragraph first
said the opposite, on my evidence and 56's: that a file committed at 19:34 appearing as a staged
deletion minutes later proved a *later* stale write, since no single snapshot could both predate one
commit and postdate another. d7 refuted it. `git diff --cached` compares the index to **HEAD**, so a
file that is in HEAD and merely *absent* from a stale index reads as a deletion — one old index plus
a moving HEAD manufactures a fresh phantom deletion every time anybody commits a new file. That is
why the count climbed 3 → 58 → 65 → 87 with nobody touching anything. A second discarded signal:
`.git/index`'s mtime moves constantly because `git status` rewrites it to refresh the stat cache,
while its content hash does not change. **Mtime is not content.**

The measurement that actually dates it asks, for each commit, whether the file that commit *added* is
present in the index:

```
14:14 c469335  added=src/html.ts                in-index=YES
14:19 5697b21  added=tests/fetch-asset.test.ts  in-index=no
15:33 f7c5846  added=…/footnotes-final.diff     in-index=no
16:26 df81f17  added=drizzle/0029_assets.sql    in-index=no
19:34 0aa30ac  added=…defer-arc-and-rename…     in-index=no
20:16 837df17  added=tests/dock-mode-urls…      in-index=no
```

Everything up to 14:14, nothing from 14:19: that write happened inside a five-minute window.

**And then it happened again, between 20:20 and 20:55** — 16 paths, 0 of 16 matching disk, dated and
cleared the same way. So this is not a historical incident with a tidy ending. Whatever does it is
still live, `scripts/check-staged-revert.ts` is the standing guard rather than the postscript, and the
right habit is to run it before every commit rather than to assume the tree is clean.

**The three-step way this section reached the truth is worth more than the truth.** It read, in order:
*ongoing* → *one write* → *ongoing after all*. The first was asserted from the ordering argument,
which is invalid. The second refuted that argument correctly and then went one step too far, treating
"the evidence for X is bad" as "not X" — when the available conclusion was only *"X is unsupported,
go and measure again."* The conclusion had been right the whole time; only its reasoning was rotten,
and replacing rotten reasoning with a sound argument for the opposite is a satisfying move that was
wrong twice over.

So: **refuting an argument does not refute its conclusion**, and a correction deserves the same
suspicion as the claim it corrects — more, because it arrives feeling rigorous. The `BASE`-reuse
composition still stands as the shape of the mistake either way; what nobody has yet is the *cause* of
the repeat.

What the day cost: six hours of phantom reverts, three misattributions, five honest denials, and a
nearly-committed back-out of a finished feature — the worst of the three incidents staged a
`src/fetch.ts` carrying **zero** occurrences of `pinnedAgent` where HEAD had four, so committing it
would have silently removed the DNS-rebinding fix under somebody else's message.

"Is this still happening?" is the question to answer first and always with a measurement, because it
decides whether you clean up or hunt — and note that it has to be re-answered, not answered once.

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

**The second fault, which is why the recipe is gone rather than fixed.** It read the tree at one
commit and then moved the branch, and if a peer committed in the gap, everything they landed in
between was silently reverted. There was a guard against exactly that — `update-ref`'s
expected-old-value — and an earlier version of the recipe captured that value *after* reading the
tree, which compares the moved HEAD against itself. It succeeds every time. The guard was defeated
rather than tripped, and nothing printed.

That is not hypothetical. On 2026-08-28 a session doing outline-mode work landed a commit that
carried its own new files **and a stale-base snapshot of twenty-six files belonging to another
session** — reverting a fully verified stage-4 commit, including deleting two test files that had
been tracked forty minutes earlier. Nobody did anything careless: the working tree still held the
work, the shared index still held it, and only the committed tree had lost it, which is the one place
nobody looks. It was found because the next `git diff --cached` showed twenty-six files staged that
should have been empty.

And the window was widened by care rather than narrowed by it: the gap was seconds if you committed
blind and **minutes** if you verified the commit in a detached worktree first. The safer the process,
the more likely a peer landed in the middle of it.

**The last line is the half that bites, and it bites your peers rather than you.** `update-ref` moves
HEAD; the shared index is still the one from before, so it is now stale against the *new* HEAD, and
git renders every path your commit added as **staged for deletion**. For a file you modified, that is
a staged reversal of the lines you just committed. For a file that was **untracked** before the
commit it is worse: `D drizzle/0027_block_roles.sql` staged, `?? drizzle/0027_block_roles.sql` on
disk — a committed migration queued for removal while still sitting in the tree. The next agent to
run an index-based `git commit` commits that deletion under their own message, which is precisely
the accident this whole section exists to prevent, arriving by a new door.

It happened on 2026-08-28. A peer read the status, could not tell it from a deliberate revert,
refused to touch it, and asked — which was the right call and is the behaviour to copy. That shape
cannot arise any more, because nothing writes a commit without going through the shared index. If you
see it in an old plan or commit message, it is a record of the removed recipe.

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

## Four more ways the recipe goes wrong

Each of these printed nothing at the time.

### `CLAUDE.md` is a symlink, so a pathspec naming it commits nothing

Git tracks the target, not the link. `git commit -F msg -- CLAUDE.md` matches no tracked path and
commits **nothing** — no error, no warning, and `git status` afterwards still shows the change as
unstaged. On 2026-08-27 that shipped [ai-gateway.md](ai-gateway.md) without the AGENTS.md signpost
pointing at it, and [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts), which requires every
doc to have exactly one owner, failed on a fresh checkout of a commit that was green on this disk.

**Name `AGENTS.md`.** And after committing a new doc, check what git *recorded* rather than what is
on disk — `git show HEAD:AGENTS.md | grep <doc-name>`. The working tree reads and writes fine
through the symlink, which is exactly why every local check agreed with you.

### `rm` throws work away too, and the rule above does not name it

The banned list is `git checkout -- …`, `restore`, `stash`, `reset --hard`, `clean`. **`rm` does the
same damage to anything untracked and is not on it.** On 2026-08-28 a subagent finished with a probe
copy and ran `rm -f src/web/useChatProbe.ts rename-preview.tsx`. The second path was another
session's untracked Vite preview page. It is gone: git had never seen it, so there is no blob and
nothing in `git fsck --lost-found`, and Dropbox's `old_files` cache had no copy either. **An
untracked file deleted in a shared tree has no second copy anywhere.**

When a subagent makes a scratch file, tell it to delete that file **by the exact path it created and
nothing else** — one path per `rm`, never a list, for the same reason a commit pathspec is spelled
out file by file. The probe technique is fine; the tidy-up is where the care has run out.

Read what survived before calling it unrecoverable. `rename-preview.html` remained and named
`/rename-preview.tsx` as its script, which is the only reason the loss could be described at all.

### zsh does not split `$FILES`

`FILES="a.ts b.ts"; git add $FILES` hands git **one** pathspec — the whole string — and fails with
*did not match any files*. zsh does not word-split an unquoted parameter the way bash does.

That is loud in a command and silent in a check. On 2026-08-30, verifying that a path-limited
`git reset` had not touched the working tree, `P="a b c"; before=$(for f in $P; do git hash-object
"$f"; done)` captured the identical `fatal: could not open …` text before and after, so the
comparison printed **"disk untouched"** — a check that passed because it had measured nothing.

Write the paths out literally, however long the line gets, on loops as well as on commands, and have
the check print what it saw rather than only its verdict. (`${=FILES}` is zsh's split operator, if a
variable is truly unavoidable.)

### Verify the staged diff, not the resulting file

Grep `git diff --cached -- <file>` and read the hunks. Grepping the *file* gives false hits on
ordinary words: a peer checked their `src/store/export.ts` commit for `role|treatment|noteId`, got a
hit on `role: row.role` that had been in the file since `518161b`, and concluded they had swept up
another session's footnote work. They had not — `row.treatment` and `row.noteId` were both absent.
The false negative is equally available, so a clean grep is no safer than a dirty one.

A complementary check that needs no identifier at all: `git diff --numstat -- <file>` against the
size of the change you believe you made. `+41 -1` when you wrote four lines is somebody else's hunk,
whatever the words are.

## Nobody knows who edited an uncommitted file

**Git records no author until commit** — blame, log and the reflog all start there. So every claim
about who wrote an unstaged hunk is inferred from context, and a shared tree is precisely what
destroys the context. On 2026-08-29 that produced three wrong attributions in one afternoon, and
five sessions each honestly disclaiming the same index corruption. Nobody was lying, and nobody
could tell.

- **State the change as fact and the attribution as a question.** Fix the one-character gate failure
  in someone else's file rather than blocking on who owns it, then say *"I changed X — tell me if
  this isn't yours"*, never *"your edit had a bug"*. A wrong accusation costs goodwill you need from
  the same peers tomorrow, and sends the lesson to somebody who cannot act on it.
- **Never infer intent from how deliberate a change looks.** Precision reads as intent, and a stale
  index manufactures a surgical, coherent back-out of one feature for free. The expensive mistake is
  not getting *who* wrong; it is concluding that anyone meant it.
- **Content and the edit can have different owners.** Sending a peer your findings and asking them
  to write it up makes the words yours and the edit theirs, and the file shows only the second.
- **Canvass rather than deduce.** Asking every session "is this yours?" cost one round of messages
  and produced six honest disclaimers plus the real mechanism.
- **Ask the tree, not the diff.** `git log --diff-filter=A -1 -- <path>` says when a file arrived and
  `git show HEAD:<path>` says what is committed; a bare `git diff` in a tree with a stale index
  shows a peer's *already-committed* work as though it were their uncommitted edit, and "restoring"
  it is a silent revert.
- **Counting a diff is not reading it.** On 2026-09-02 an agent cleared four files for a blocked peer
  to overwrite, having checked each one by *how many lines differed* from what it had pushed. Three
  were genuinely its own stale drafts. The fourth was `docs/project/admin.md`, which also held forty
  lines documenting a *different* agent's spend column — unpushed, and its code still untracked. A
  line count tells you two files differ; it never tells you whose lines they are, and the files most
  likely to be a mix are exactly the ones several people have reason to edit. The doc that describes
  a shared page is the archetype. Nothing was lost, because the peer refused to run a
  `git checkout --` on a peer's say-so; that refusal is the rule below working, not caution.

## The thing that fails silently

**A commit can be green here and broken on any other machine**, because the typecheck and the tests
read your working tree, which has files in it that nobody `git add`ed. That is not hypothetical: on
2026-08-26 `src/routes.ts` was committed importing two files that were never added, and it was found
by a deploy, not by a test ([deployment.md](deployment.md)).

`git status` before you commit, and read the untracked list rather than skimming past it. If
something you import is in it, it is yours to add.

**And the variant where the import is not yours at all.** The recipe's trailing `--` pathspec commits
a named file *from the working tree*, so naming a file a peer is halfway through commits their half
too — which the recipe above says is usually fine, with one exception, and this is the exception. On
2026-09-02 a two-line change to `pgAdminStore` in `src/store/pg-admin.ts` carried sixty-three lines
of somebody else's in-progress spend column, without the module those lines import or the fields they
write. `npm run typecheck` failed on the tip and anything reaching the store layer died at load; one
peer lost thirty-two tests in four suites that had nothing to do with either feature.

So: before naming a file in a pathspec, `git diff HEAD -- <file>` and read it. If what comes back is
bigger than what you meant to write, the surplus is somebody's and the question is whether it stands
alone. The repair is to back their hunks out, not to finish their feature from a tree where you
cannot see whether it is finished — every line of it is still in *their* working tree and returns
whole when they commit.

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

## Dropbox, until 2026-09-01

The repository used to live inside Dropbox, which meant `.git/` — 128 MB of it by the end — was
synced continuously, along with `data/`, `output/` and `evals/`. That is a CPU tax, and syncing a
directory mid-write is a known way to corrupt a repository. It never bit us.

Only `node_modules/` and `dist/` carried the **two** xattrs Dropbox needs to leave a directory
alone, and the cost grew with every worktree, so the checkout moved out to `~/dev/spideryarn/` —
[260901e](../plans/260901e-move-repo-out-of-dropbox-to-dev-spideryarn-reading2.md), which also has
what a move like this breaks. What has not changed: since 2026-08-26 there is a remote, so a
corrupted `.git` costs you the uncommitted work rather than the project.

## The other repo, and the move that hasn't happened

[260825d-deploy-and-repo-move.md](../plans/260825d-deploy-and-repo-move.md) plans folding this codebase into the
original app's repo, `spideryarn/reading`, with everything currently there swept into `legacy/`.
That is still open and this remote does not do it — `spideryarn/reading2` is a separate repo, and
creating it changes nothing about the plan except that its step 4 can now fetch from GitHub instead
of from a Dropbox path.

Read the plan's [sequencing trap](../plans/260825d-deploy-and-repo-move.md#the-sequencing-trap) before
starting any of it: the moment this codebase lands at the root of `spideryarn/reading`, the old
Vercel project tries to build it as a Next.js app.

It used to say *the project serving spideryarn.com*, and that stopped being true on 2026-08-27 when
[the domain moved](deployment.md#the-domain) to `spideryarn-reading2`. The trap is still real — a
push would still turn that project red — but it now costs the old app rather than the live site.

## See also

- [CLAUDE.md](../../CLAUDE.md) — the working agreements these rules are stated in
- [git-commit-changes.md](../reusable/git-commit-changes.md) — the batch version: how to decide a
  pile of uncommitted changes is finished, quiet and safe to commit
- [git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md) — when a pull leaves
  conflict markers: read both sides' history, propose before editing, and don't reach for the
  commands that discard a side
- [deployment.md](deployment.md) — Vercel, and why it ships a working tree rather than a commit
- [setup-dev.md](setup-dev.md) — install, dev, secrets
- [testing.md](testing.md), [typechecking.md](typechecking.md) — what to run before you commit
