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
`makeRelationCache`'s bare `spawnSync`, by `scripts/readiness-loop.ts`'s `run()`, **by the `spawn()`
that launches the check itself**, and by the `npm` spawn inside `scripts/readiness-run.ts`. Stripping
in `run()` rather than only at its git call sites is deliberate: `run()` also launches `npm`, and an
`npm` script that shells out to git would inherit the same poison.

The set is the variables that **redirect** a command away from its `cwd`: `GIT_DIR`,
`GIT_COMMON_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`. `GIT_CEILING_DIRECTORIES` is left alone: it can
only make repository discovery *fail*, and a failure is a safe outcome here — every caller treats an
unreadable answer as unknown, and unknown never lets a run count towards green. GPT Sol ran it and
confirmed the reasoning: it cannot exclude the current directory, and from a child directory it made
discovery fail rather than select another repository.

**Simpler option passed over:** `git --git-dir=… --work-tree=…` on every invocation. It would fix
the two named variables and silently miss `GIT_INDEX_FILE` and the object-directory pair, it does
not help the `npm` children at all, and it puts the burden on whoever writes the *next* git call.
Stripping the environment is one edit that cannot be forgotten at a call site. (It does have one
advantage the environment scrub lacks — `--work-tree` overrides `core.worktree`, which is the next
paragraph.)

### What a clean environment does *not* buy, and the one check that does

A stripped environment is not the same as "`cwd` decides". GPT Sol demonstrated it on git 2.43.0
with all seven variables unset:

```sh
git -C A config core.worktree B
git -C A rev-parse --show-toplevel          # → B
git -C A merge --ff-only dev                # → wrote the new file into B, not A
```

So the honest claim is narrower, and it is the one the code should carry:

> `gitEnv()` removes inherited git path overrides, so those environment variables cannot replace
> git's normal repository discovery from `cwd`. It does not make `cwd` authoritative over repository
> metadata or repository-local configuration: `core.worktree` and a linked worktree's `.git`
> `gitdir:` pointer remain trusted inputs.

**Remedy taken:** one guard before the tick's fetch and fast-forward — assert that
`git -C <runner> rev-parse --show-toplevel`, run with a clean environment, canonicalises to the
runner path. If it does not, skip the tick and say so. That is one 5 ms git call every ten minutes
and it closes the `core.worktree` redirect at the only place the runner mutates anything.

**Remedy declined:** threading `--work-tree=<cwd>` through every invocation, and validating the
linked worktree's `.git` backlink. Once `--show-toplevel` agrees with `cwd`, `--work-tree` adds
nothing; and a redirected *metadata* directory with a correct work tree cannot move another
checkout's files, only its branch ref — which git's own worktree bookkeeping maintains and which
nothing here sets by hand. The limit is written down rather than defended against.

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
against the wrong dependencies. It must still be **loud** on stderr, naming both shas and git's own
error: a permanently broken classifier that quietly reinstalled on every sha while every verdict
looked healthy is precisely the shape [silent-success.md](../reusable/silent-success.md) is about.

**A sha alone does not identify a prepared state.** GPT Sol's F3: prepare from a tree that is at B
but *dirty* — `package.json` and `package-lock.json` both edited — and `npm ci` installs from files
that are not B's. Latch `preparedFor = B`, let a person restore the two files, and the next tick sees
`preparedFor === B`, skips the install, and checks B against modules built from something else.
Nothing downstream can see it, because the tree stamp is clean by then.

So the latch takes a second stamp *after* preparation, and records `preparedFor` only when that
stamp is `known`, not `dirty`, and still at the target sha. Anything else sets `preparedFor` back to
`null` — prepare everything next time — and says why. This is cheaper than Sol's proposed version,
which also gates entry on a clean tree: preparing from a dirty tree is harmless in itself (the tick's
own gates refuse to *check* a dirty tree anyway), and it is only the latch that must not believe it.

**`package.json` is a dependency input too, and was missing.** Sol's F4, established: the classifier
watches `package-lock.json` and not `package.json`, and this repo's history has many commits that
change one without the other. A commit that changes a dependency in the manifest without the lock is
a commit `npm ci` refuses — so a fresh checkout of it cannot pass, while the runner, having skipped
the install, records it green. Both root manifests go into the watched pathspec and into both the
`dependencies` and `fleetClient` rules. The cost is an extra `npm ci` on every commit that only
edits an npm *script*, about a minute, against a 26-minute check; taking the accurate rule rather
than parsing the manifest's dependency sections is the simpler-first choice.

### RR2-03: narrow the claim rather than close the channel

**Decision: narrow the documented claim.** The nonce protects against *accidental* collisions — a
test, a fixture, or a quoted log line printing the refusal sentence — and it does that. It is not
unforgeable against deliberate same-user code, and it never could be by this mechanism.

Building the one-shot out-of-band channel the review offers as the alternative would be defending
against an attacker who can already edit `vitest.config.ts` in our own repository. That is not in
this project's threat model — `docs/project/security-map.md` names the untrusted parties, and none
of them is our own test suite — and anyone in that position can do considerably worse than launder
one refusal. So the code stays and the comments stop over-claiming.

Three files, not the two this plan first said: Sol's F7 caught that `tools/fleet/readiness-parse.ts`
calls the marker "authenticated" and says "the authenticated sentence proves", which is the same
over-claim in different words. It becomes "token-matched".

### The shared local database can be ahead of the commit under test — named, not fixed

Sol's F5, established, and **new**: it is not one of the two findings this plan was dispatched for,
and it is not fixed here.

Every worktree on this box shares one local Supabase. `scripts/db-migrate.ts` passes
`allowHistoricalExtras: isLocal`, so on a local database a ledger row belonging to no migration in
this commit's journal is a warning and not a refusal. That is the right call for a developer's
laptop and the wrong one for a machine recording verdicts:

1. `origin/dev` is B. B's code declares a new column but its migration was left out of the commit.
2. Another worktree C adds that migration and applies it locally. C is not on `origin/dev`.
3. The runner prepares B. B's migrator tolerates C's ledger row as historical extra.
4. `db:check` finds the column and passes. B's tests pass **against C's schema**, and B is recorded
   green.

**Decision: weaken the claim, and hand the fix to the Overseer.** The two repairs Sol offers are a
dedicated readiness database, or holding the migration advisory lock across the whole 26-minute
check. The first is a real piece of work; the second would block every other agent's tests on this
box for 26 minutes at a time, which is an operational trade-off for the Overseer or Greg to make and
not one to slip into a bug-fix stage. Sol's own remedy permits this ending in as many words —
*"Without one of these, the stated exact-schema invariant must be weakened explicitly."*

So the runner's header stops claiming that a green means B passed against B's schema, and says what
it actually means: B passed against **this box's** schema, which is B's own migrations applied to a
database that other worktrees also migrate. A middle option was considered and refused for now —
making the runner skip whenever the ledger holds unknown rows. It is correct and self-clearing, but
on a box where several agents are usually mid-migration it could silence the runner for long
stretches, and trading availability for accuracy is the same decision, made smaller and less
visibly.

## The plan review, and what it changed

GPT Sol reviewed this plan before any code was written and **refused** it, on four established P1s —
two of them things this plan had got wrong, two of them new. The full answer is
[260909g-readiness-runner-plan-review-sol.md](260909g-readiness-runner-plan-review-sol.md), and the
findings are folded into the sections above.

| ID | What it said | Disposition |
|----|--------------|-------------|
| F1 | The check itself is launched by a separate raw `spawn()` that the proposed scrub never reaches, and `readiness-run.ts` copies the poison again into its own `npm` child. Reachable false green via `scripts/conflict-markers.ts`, which takes its tracked-file inventory from git. | **Taken.** Both spawns scrubbed, with a test over the spawn boundary rather than over `gitEnv` alone. |
| F2 | A clean environment does not make `cwd` authoritative — `core.worktree` still redirects, demonstrated on git 2.43.0. | **Taken**, with a narrower remedy than proposed: one `--show-toplevel` guard before the tick mutates, and the claim restated. |
| F3 | A sha alone does not identify preparation done from a dirty tree. | **Taken**, with a simpler remedy: latch only on a clean post-preparation stamp. |
| F4 | `package.json` is missing from the dependency inputs. | **Taken.** |
| F5 | The shared local database can be ahead of the commit under test, so a green can be produced against another worktree's schema. | **Named, not fixed** — see above. Both repairs are larger decisions than this stage; the claim is weakened instead and it goes to the Overseer. |
| F6 | The conservative diff fallback must be noisy. | **Taken.** |
| F7 | The nonce over-claim is in a third file too. | **Taken** — this plan had said that file needed no change, and was wrong. |
| F8 | The fleet-prerequisite comment misdescribes what needs the build. | **Taken.** Verified: `tests/fleet-decisions-route.test.ts` never reads `dist`; `tools/fleet/server.ts` exits at import unless `dist/index.html` exists. |

## Stages

### Stage 1 — one git environment, and the guard a clean environment cannot give

**Status: not started.**

- [ ] `gitEnv()` exported from `tools/fleet/readiness-git.ts`, with the set above and the reasoning
      for what is left out.
- [ ] Used by `git()` in that file, `makeRelationCache`'s `spawnSync`, `run()` in
      `scripts/readiness-loop.ts`, the `spawn()` that launches the check (F1), and the `npm` spawn
      in `scripts/readiness-run.ts` (F1).
- [ ] A `--show-toplevel` guard before the tick's fetch and fast-forward (F2).
- [ ] Red first: poison `GIT_DIR`/`GIT_WORK_TREE` at a second real repository and assert each
      consumer still describes its own `cwd` — including a test over the check's spawn boundary,
      because testing `gitEnv` alone cannot catch an omitted caller.
- [ ] Red first: a `core.worktree` redirect is refused rather than fast-forwarded (F2).
- [ ] Unit coverage that the helper removes every named variable and preserves the rest.

### Stage 2 — preparation latched to the sha, and to a clean tree

**Status: not started.**

- [ ] `PreparationState` with `preparedFor`, in `tools/fleet/readiness-loop.ts`.
- [ ] `preparationAfterChanges` accepts `null` for "could not classify" and returns everything
      pending; `package.json` joins `package-lock.json` as an input (F4).
- [ ] `tick()` classifies from `preparedFor`, prepares, re-stamps, and records `preparedFor` only
      for a clean tree still at the target (F3).
- [ ] A failed classification is loud on stderr and not fatal (F6).
- [ ] Red first: two ticks — an injected diff failure, then a failed `npm ci` — asserting the latch
      does not advance and the install is retried. It must fail against the current code.

### Stage 3 — the nonce's claim, and the runner's, narrowed to what they are

**Status: not started.**

- [ ] `vitest.config.ts`, `vitest-admission.ts` and `tools/fleet/readiness-parse.ts` say what the
      nonce actually protects, and name `/proc/self/environ` as the reason it is not more (F7).
- [ ] `scripts/readiness-loop.ts`'s header stops claiming a green means "against this commit's
      schema" (F5), and its fleet-prerequisite comment is made accurate (F8).

### Stage 4 — land it, and restart the loop on it

**Status: not started.**

- [ ] `npm test`, `npm run typecheck`, lint the touched files, merge `origin/dev`, push.
- [ ] Stop the running loop, relaunch it from the updated `readiness-checks` worktree, confirm one
      tick.
