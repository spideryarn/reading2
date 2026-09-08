# Stop `worktree:check` crying wolf on `logs/`

**Status**: in progress, 2026-09-08.

`npm run worktree:check` refuses to call a finished worktree safe, the agent reads the refusal,
decides it is a false alarm, and removes the tree anyway. Greg has watched this happen enough times
to ask for it to stop:

> I keep asking an agent to remove the worktree when it says it has pushed everything, and it seems
> to trigger some sort of check that says it's not safe to do so, which the agent then inspects and
> decides is a false alarm.
>
> — Greg, 2026-09-08

The cost is not the wasted minute. It is that the refusal has become something an agent expects to
argue with, and the one that is real will be argued with in exactly the same tone.

## What is actually firing — measured, 2026-09-08

`npm run worktree:sweep` across the 19 live worktrees on the box. **13 of them are blocked by
exactly one thing**, and in every tree sampled that thing is the same path:

```
  ok   every commit here is on origin/dev
  ok   nothing uncommitted or untracked
  ok   nothing tracked is hidden from git status
  ok   .env.local is byte-for-byte the primary's copy
  ok   data/ matches tests/fixtures/data-root/data/ file for file
  ok   output/ matches tests/fixtures/data-root/output/ file for file
  ·    3 ignored entries rebuildable (node_modules, dist, …)
  FAIL 1 ignored path git has no copy of
       logs/
  DO NOT REMOVE — 1 blocker above.
```

A direct count of the trees: `logs/` present in 13 of 19; `.env.local` differing from the primary's
in 1 of 19; untracked-but-not-ignored files in 7 of 19.

So one path explains the whole complaint. Everything else the check says is either true or rare.

## Why `logs/` was never classified

`scripts/worktree-check.ts` landed at `a743c5de`, 2026-09-02 15:40. `/logs/` was added to
`.gitignore` at `d0141d13`, **three hours later the same day**, by a commit about the sweep loop —
"`/logs/` is gitignored for the loop's reports". Nobody gave it a verdict in `classifyIgnored`, and
the check's fail-closed default did the rest: an ignored path it does not recognise is a blocker,
for ever, in every worktree.

That is the class, and it is worth naming because it will happen again: **adding a line to
`.gitignore` silently arms a permanent blocker in a file nobody thinks to open.** The two signals
disagree by construction — `.gitignore` says "git need not track this", `worktree-check` says "git
does not have this, so it may be the only copy" — and nothing holds them together.

## Why `logs/` is not simply disposable

The tempting one-liner is `"logs/"` in `DISPOSABLE_IGNORED`. It would be wrong, and the commit that
created the directory says why: the ignore exists *for the loop's reports*.

`logs/` holds, across the primary and the worktrees:

| subtree | written by | is it work? |
| --- | --- | --- |
| `logs/tmux-jobs/` | [`scripts/tmux-job.ts`](../../scripts/tmux-job.ts) `LOG_DIR` | no — captured stdout of a rerunnable command |
| `logs/loops/get-ready-to-deploy/` | the loop in [get-ready-to-deploy.md](../reusable/get-ready-to-deploy.md) | **yes** — a dated report of what a run found |
| `logs/changelog/` | [`scripts/changelog/changelog.ts`](../../scripts/changelog/changelog.ts) `DEFAULT_WORK` | **yes** — `verified/<day>.json` is hand-edited |
| `logs/dev-server/` | nothing in the repo; an ad-hoc redirect | unknown, so it blocks |

Two of those four are the only copy of something a person made. A blanket verdict would print SAFE
over them, which is the exact failure the file exists to prevent.

There is a mechanical reason a `DISPOSABLE_IGNORED` prefix cannot express this either:
`git status --porcelain --ignored=matching` collapses a wholly-ignored directory into **one** entry,
`!! logs/`. The files inside are never named, so `"logs/tmux-jobs/"` as a prefix would match nothing.

## The framing this changed

Failing closed looked free — "the cost of a false *not yet* is that somebody reads a list", as the
file's own header puts it. Six days of this says otherwise. Nothing was ever lost to the `logs/`
blocker; what it cost was **the standing of the refusal**. An agent that has argued its way past this
printout four times will argue its way past the fifth, and the fifth is the pipeline run in `data/`.

So a false alarm is not the cheap direction after all, and the rule that follows is not "fail closed
less" but: **recognise everything genuinely recognisable, fail closed on what is left, and make every
blocker name the action that clears it.** That is what the three pieces below are each doing.

## What was built

### 1. A `logs` verdict that goes and looks

`classifyIgnored("logs/")` returns a new `"logs"` verdict, and `logStrays` walks the directory the way
`corpusStrays` walks the corpus — the file already solves this exact shape once. `logs/tmux-jobs/` is
recognised as captured stdout; **every other entry under `logs/` is reported by name**, so a loop
report or a hand-edited changelog file still blocks. One line per top-level entry with a file count,
not one per file, so a thousand rotated logs cannot bury the other blockers.

The allowlist is the exception and the default stays "this blocks". Match is an **exact first path
segment**, not a prefix — `logs/tmux-jobs-keep/` is not `logs/tmux-jobs/`, the `.DS_Store-important`
lesson one directory down, and the test for it was watched red against a `startsWith` version.

**The allowlisted name buys an inspection, not a pass.** `logs/tmux-jobs/` is read, and anything in it
that is not a flat regular `<session>.log` — a nested directory, a symlink, another extension, an
unreadable directory — is reported. Without that, the only copy of anything could be parked inside the
one directory the check waves through, which is how an allowlist becomes the hole.

### 2. A test that makes the next `.gitignore` line decide

`tests/worktree-check.test.ts` reads the repo's own `.gitignore` and fails if a literal directory in
it has no verdict and is not in `BLOCKS_ON_PURPOSE` — `uploads/` (a file somebody handed the agent,
possibly the only copy) and `.claude/worktrees/` are the two that are there on purpose. A rule ending
in `/` must have the **slashed** spelling classified, since that is what git reports.

This does not weaken the runtime default; an unclassified path still blocks. It moves the noticing
from "an agent argues with a refusal three weeks later" to the moment of adding the rule. Watched red
by adding a fake `/new-cache-dir/` to `.gitignore`.

**What it does not catch, stated rather than implied**: globs (they name no single path), and the
nested `supabase/.gitignore` and `infra/hetzner/.gitignore`. It catches the way `/logs/` actually
arrived, not every way one could.

### 3. The docs

[worktrees.md § Before you remove one](../project/worktrees.md#before-you-remove-one) gains the class
above; a recipe for settling `.env.local — DIFFERS` **by key name and value hash, never a raw
`diff`**; and a subsection on **`ExitWorktree`'s own two refusals** — the commit count that includes
the trunk you merged, and the ownership message you get for resuming somebody else's tree. Both are
false alarms, both read as alarming, and neither was written down anywhere in the repo.

## What the GPT Sol review changed

[The review](260908b-code-review-sol.md) agreed with the framing — *"recognise more, fail closed on
the rest is the right response to this class of credibility-eroding false alarm"* — and blocked two
parts of the first implementation. Both were right and both are now out.

**An `.env.local` line-subset test, reverted entirely.** The idea: if every meaningful line of the
worktree's copy is also in the primary's, nothing in it exists only here, so a copy that merely fell
behind could print as verified. It is wrong three ways. A worktree that **deleted** a key is a subset
too. Two files with the same lines in a different order differ under this repo's own last-wins parser
([`src/env.ts`](../../src/env.ts)) — checked, and it is last-wins. And a comment only here is
somebody's note, which the "meaningful lines" filter threw away.

The general form of the mistake is worth keeping: **history cannot be inferred from two current
snapshots.** A sound version needs the hash taken when the copy was made. And the measurement had
already said the narrowing cleared **none** of the box's nineteen trees — so it bought nothing
measurable while risking the one failure the file exists to prevent. That should have been enough to
stop me on its own.

**`dev-server` removed from the allowlist.** This plan's own table said it had no writer in the repo
and was "unknown, so it blocks", and then the implementation allowlisted it anyway on a subagent's
suggestion that I did not re-derive. `tmux-jobs` has an owner (`scripts/tmux-job.ts`, `LOG_DIR`) whose
output shape can be checked; `dev-server` was a guess about a name. The bar for a name in
`TRANSIENT_LOG_SUBTREES` is now written down: a writer in the repo whose output shape is checkable.

**The prescribed `diff` command, removed.** A blocker naming its own resolution was the right idea and
the wrong instance: `diff primary/.env.local .env.local` writes both secrets to stdout, and from there
into a transcript or a tmux job log. The resolution moved to the docs, as a key-name and value-hash
comparison that prints no value.

Accepted and not acted on: a snapshot race (a peer writing into `logs/` between the `git status` and
the walk) — inherent, low frequency, and the same shape as the pre-existing one for any newly created
ignored path. Sol also confirmed the ignored-path count is not inflated and the before/after table is
appropriately labelled uncontrolled. Its own test run was partial: 16 repository-construction tests
could not start in its sandbox (`EPERM` on `spawnSync git`), which is why the local run is the
evidence here.

## The simpler options passed over

**Blanket `"logs/"` in `DISPOSABLE_IGNORED`.** This is what
[260907e](260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md) put to Greg as a
decision — *"Should build and test logs count as work that blocks removal?"*, with a recommendation
to treat `logs/` as disposable and a note that it is "a one-way loosening of a guard, so it should be
your call". **No answer to that question is recorded anywhere in the repo**, and this plan does not
assume one, because the wholesale version is wrong by two concrete cases that were not known when it
was asked: the commit that created the directory says `/logs/` was gitignored *for the loop's
reports*, and `logs/changelog/verified/<day>.json` is where a person writes a regroup judgement by
hand — a run [changelog.md](../project/changelog.md) says is worth doing in a worktree overnight.

The walk gets the whole benefit of the blanket version (it clears every one of the 13 trees) while
loosening far less: it recognises **one** subtree, inspects even that one's contents, and leaves the
rest blocking. If Greg wants the blanket version anyway, it is a one-line change to
`TRANSIENT_LOG_SUBTREES` — but he should know about the changelog case first.

**Point `tmux-job.ts` at the scratchpad**, so the check never sees `logs/` at all. Rejected: it fixes
the one symptom and not the class — `logs/loops/` and `logs/changelog/` stay unclassified blockers,
the next `.gitignore` line still arms a silent one, and there is no stable out-of-tree location a
script can know (the scratchpad is per-session, and parallel subagents share one). The repo already
made this call the other way for `*.activity.log`: the file stays beside its answer and the check was
taught about it.

**Auto-moving unexplained paths to the scratchpad** (a `worktree:tidy`). Rejected: it is the
wave-it-through habit mechanised, inside a tool whose one guarantee is that it never writes.

## Evidence, before and after

`npm run worktree:sweep`, same box; the "after" column is the **final** code, re-run once the review's
changes were in. Not a controlled experiment — a dozen agents were working throughout, so trees gained
and lost commits and untracked files in between, and the tree count moved. The `logs/` row is
unambiguous regardless.

| | before | after |
| --- | --- | --- |
| trees carrying an ignored-path blocker | 16 of 19 | 3 of 18 |
| of those, blocked by exactly one ignored path (`logs/`) | 13 | 0 |
| trees held by nothing but the 24 h age floor | 1 | 5 |

The 3 that still block are all real, and none is `logs/`: `critiques-mode` (39 `data/` strays),
`fleet-dashboard-v01` (1), and `structure-mode`, whose `.env.local` genuinely differs from the
primary's.

**`.env.local` is untouched by this change, and that is the review's doing.** The one tree of
nineteen that differs does so because `STRIPE_SECRET_KEY` was rotated in the primary — established by
key name and value hash only, never printing a value — so the worktree holds the *old* value, which
genuinely exists nowhere else. It blocks, correctly, exactly as it did before. The line-subset test
that would have cleared the *other* shape of this case turned out to be unsound and cleared none of
today's trees anyway; what replaced it is a recipe in the docs that compares key names and value
hashes without putting a secret on stdout.

Every test here was watched red first, against the code that had the defect.
