# The readiness runner's two P1s: git's environment, and preparation that outlives a failed diff

The periodic readiness runner
([260909f](260909f-readiness-checks-recorded-and-run-periodically.md)) shipped on `dev` at
`f5b79d81` without a cross-family verdict — its Stage 2 GPT Sol review was killed at the timeout.
The Overseer commissioned that review afterwards and it came back **REFUSE**, on two established
P1s and one reasoned P2:
[260909f-readiness-runner-stage2-overseer-commissioned-review-sol.md](260909f-readiness-runner-stage2-overseer-commissioned-review-sol.md).

This plan is the fix. It is not a redesign: the runner's shape, its gates and its records are
settled, and everything here is about two ways it can quietly answer the wrong question.

Queue item `qi-aksntcbd`. Not in scope, all queued separately: the `ReadinessPanel` decomposition,
the `build:fleet` step that belongs in `scripts/check.ts`, anything under `infra/`.

## What the runner is, for somebody who has not read 260909f

`scripts/readiness-loop.ts` runs under tmux on the Hetzner box and answers one question for the
fleet dashboard's Readiness tab: **is the commit `dev` is on known to pass its own checks?** Every
ten minutes it fast-forwards a dedicated worktree — `.claude/worktrees/readiness-checks` — to
`origin/dev`, decides whether a full `npm run check` there would tell the tab anything new, and if
so runs one and records the result against the sha it tested.

Two things it must never do, because a wrong answer here is worse than no answer:

- **act on a checkout other than its own.** The record says "this sha, checked in this directory".
- **test commit B using commit A's `node_modules` or A's database schema** and record the result as
  a fact about B.

The two P1s are exactly one of each.

## The reproductions, run before anything was designed

Both findings were treated as unverified until reproduced here. Both reproduce.

### RR2-01 — git reads its target from the environment, not only from `cwd`

`GIT_DIR` and `GIT_WORK_TREE` override `cwd` and `git -C`. Neither the loop nor
`tools/fleet/readiness-git.ts` strips them, so both pass `process.env` through unchanged. Calling
`stampTree()` on the runner worktree with the primary checkout's values in the environment:

```
clean stamp of worktree:    {"kind":"known","sha":"4086904a…","branch":"worktree-readiness-runner","dirty":false}
poisoned stamp of worktree: {"kind":"known","sha":"4086904a…","branch":"dev","dirty":true}
```

The second line is the **primary checkout's** branch and dirtiness, read while `cwd` was the
worktree. (The two shas happen to be equal at this instant, so that column does not discriminate;
`branch` and `dirty` do.) The same override reaches the mutating call — the tick's
`git merge --ff-only origin/dev` would advance the primary while the check that follows still runs
in the worktree, and the record would describe one tree while the test read another.

**This is latent, not live.** The running loop's environment was checked and holds none of these
variables. It is a hole in a process that is meant to be safe to launch from anywhere, at any time,
by anything — which is the whole point of an unattended runner.

### RR2-02 — a failed classification consumes the transition and loses the preparation it implied

The fast-forward happens first; the flags that say "reinstall dependencies", "apply migrations",
"rebuild the fleet client" are set only *after* `changedPaths()` returns. `changedPaths()` runs one
`git diff --name-only before after` through `requireCommand`, which **throws** on failure.

So: `dev` advances A → B, B changed `package-lock.json`, and the diff fails or times out. The tick
throws after the branch has already moved. The flags are still false. On the next tick
`before === after === B`, `changedPaths()` returns empty by its own fast path, and the runner checks
**B with A's `node_modules`**. `node_modules` is gitignored, so both tree stamps say clean and
nothing anywhere notices. That is a false pass, or a sticky false failure, recorded as a fact about
B.

The same loss happens whenever either stamp is momentarily `unknown` across a successful
fast-forward — the guard requires both, and there is no second chance because the transition it
needed has already been spent.

### RR2-03 — `delete process.env[…]` does not remove a value from `/proc/self/environ`

Confirmed directly on this box: a variable present at `exec` is still readable from
`/proc/self/environ` after JavaScript deletes it.

```
before delete, in process.env: deadbeef…
after delete, in process.env:  undefined
set-at-exec value still in /proc/self/environ: ["SPIDERYARN_RR_INHERITED=cafebabe…"]
```

So the admission-refusal nonce is recoverable by code running in Vitest's own process — the config
itself, or a global setup file — which could then print the exact refusal sentence and its marker,
and turn a genuine failure into `void`.

## The decisions

### Strip git's location variables in one place, and use it everywhere

One exported helper in `tools/fleet/readiness-git.ts`, used by its own `git()`, by
`makeRelationCache`'s bare `spawnSync`, and by `scripts/readiness-loop.ts`'s `run()`. Stripping in
`run()` rather than only at its git call sites is deliberate: `run()` also launches `npm`, and an
`npm` script that shells out to git would inherit the same poison.

The set is the variables that **redirect** a command away from its `cwd`: `GIT_DIR`,
`GIT_COMMON_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`. `GIT_CEILING_DIRECTORIES` is left alone: it can
only make repository discovery *fail*, and a failure is a safe outcome here — every caller treats an
unreadable answer as unknown, and unknown never lets a run count towards green.

**Simpler option passed over:** `git --git-dir=… --work-tree=…` on every invocation. It would fix
the two named variables and silently miss `GIT_INDEX_FILE` and the object-directory pair, it does
not help the `npm` children at all, and it puts the burden on whoever writes the *next* git call.
Stripping the environment is one edit that cannot be forgotten at a call site.

### Latch preparation to the sha it was prepared for

Replace the three free-floating booleans with a state that names its subject: **the sha this
checkout's derived state is prepared for**, or `null` when nothing is known to be prepared.

```
preparedFor: string | null
needs: { dependencies, migrations, fleetClient }
```

A tick prepares when `preparedFor !== <the sha we are now at>`, classifies by diffing
`preparedFor..now` rather than `before..after`, and sets `preparedFor` **only after every piece of
preparation has succeeded**. A failed classification is no longer fatal: it means *we do not know
what changed*, which resolves to **prepare everything** — an `npm ci` and a migrate, both idempotent
and both cheap next to the 26-minute check they protect.

Why this is better than the conservative latch the review also offered ("set every flag true before
any fallible classification, narrow them afterwards"): the latch still spends the transition. If the
diff fails, the next tick sees no change and has nothing to re-derive from. `preparedFor` is not a
transition at all — it is the state, so it survives any number of failed ticks and repairs itself on
the first one that works. It also deletes the `before` stamp entirely, and with it one git call per
tick.

**Consequence worth naming:** a classification failure now costs an `npm ci` where before it cost a
thrown tick. That is the trade — a minute of work in exchange for never recording a check that ran
against the wrong dependencies.

### RR2-03: narrow the claim rather than close the channel

**Decision: narrow the documented claim.** The nonce protects against *accidental* collisions — a
test, a fixture, or a quoted log line printing the refusal sentence — and it does that. It is not
unforgeable against deliberate same-user code, and it never could be by this mechanism.

Building the one-shot out-of-band channel the review offers as the alternative would be defending
against an attacker who can already edit `vitest.config.ts` in our own repository. That is not in
this project's threat model — `docs/project/security-map.md` names the untrusted parties, and none
of them is our own test suite — and anyone in that position can do considerably worse than launder
one refusal. So the code stays and the comments stop over-claiming, in the two places that currently
say more than is true. `tools/fleet/readiness-parse.ts` already says the narrow thing ("an ordinary
test, fixture or quoted log line") and needs no change.

## Stages

### Stage 1 — one git environment, stripped, used by every git call the runner makes

**Status: not started.**

- [ ] `gitEnv()` (or similarly named) exported from `tools/fleet/readiness-git.ts`, with the set
      above and the reasoning for what is left out.
- [ ] Used by `git()` in that file, by `makeRelationCache`'s `spawnSync`, and by `run()` in
      `scripts/readiness-loop.ts`.
- [ ] Red first: a test that poisons `GIT_DIR`/`GIT_WORK_TREE` to point at a second real repository
      and asserts the helper's consumers still describe their own `cwd`. It must fail against the
      current code.
- [ ] Unit coverage that the helper removes every named variable and preserves the rest.

### Stage 2 — preparation latched to the sha it was prepared for

**Status: not started.**

- [ ] `PreparationState` with `preparedFor`, in `tools/fleet/readiness-loop.ts`.
- [ ] `preparationAfterChanges` accepts `null` for "could not classify" and returns everything
      pending.
- [ ] `tick()` classifies from `preparedFor`, prepares, and only then records `preparedFor`.
- [ ] Red first: two ticks — a successful fast-forward with an injected diff failure, then a second
      tick at the same sha — asserting that dependencies are still installed. It must fail against
      the current code.

### Stage 3 — the nonce's claim, narrowed to what it does

**Status: not started.**

- [ ] `vitest.config.ts` and `vitest-admission.ts` say what the nonce actually protects, and name
      `/proc/self/environ` as the reason it is not more.

### Stage 4 — land it, and restart the loop on it

**Status: not started.**

- [ ] `npm test`, `npm run typecheck`, lint the touched files, merge `origin/dev`, push.
- [ ] Stop the running loop, relaunch it from the updated `readiness-checks` worktree, confirm one
      tick.
