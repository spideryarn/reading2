# Deploy a commit the readiness loop already saw green

Status: built, 2026-10-07. Started by the Overseer at Greg's request. Sol's plan review
([…-review-sol.md](261007k-deploy-a-commit-the-readiness-loop-already-saw-green-review-sol.md))
found four P1s; what changed because of each is in [§ After the plan review](#after-the-plan-review).

> How can we make the deploy take less time and be more robust without too many tradeoffs? For
> example, perhaps when we want to deploy, we push to a branch (could be `main`), then try and deploy
> from there, and if there are bugs then we fix them on that branch, re-deploy, and also merge those
> fixes back to `dev`. That way, any new stuff that happens on dev won't affect the deploy. And
> perhaps we won't have to re-run all the tests when we deploy if we've just run them successfully -
> your call.
>
> — Greg, 2026-10-07

## What went wrong on 2026-10-07, and what did not

The deploy started at 10:49 from dev's tip. Its gates already run in a worktree pinned to one sha
(`gatesAt` in [`scripts/deploy.ts`](../../scripts/deploy.ts)), so commits landing on `dev` during
the deploy did **not** disturb it. Greg's branch would buy isolation we already have.

What cost the day:

1. **The deploy chose a commit nothing had seen green.** It takes `HEAD` and insists it equals
   `origin/dev` (`trunkGap`). The readiness loop had already recorded that commit's neighbours red,
   but the deploy does not read those records.
2. **Its own ~60-minute test gate found the reds one at a time**, and each fix meant a fresh
   `changelog:prepare` (~25 min) and a whole new gate run.

The records in `~/.fleet-readiness/runs/` say how often the second would happen. Of the runner's
last 22 `npm run check` runs (10-05 to 10-07), **five passed**, and after 10-06 02:40 only one
did — `d58a13c6` at 10-06 23:49. Thirteen of the reds had `test: failed` in their table. Runs take
70–80 minutes. So dev is usually red, and the loop already knows which commits are not.

## The change

### 1. `npm run deploy -- --ready`: deploy the newest commit known to be green

A new flag, combinable with `--dry-run`, `--skip-migrations` and `--force-gate`, refused beside
`--verify-only`. Instead of `HEAD`, the candidate is **the newest commit on `origin/dev` that has a
reusable green readiness record** (§ 2 says what "reusable" is). Newest is decided by ancestry, not
by when its run finished: past tips of `dev` form one chain (dev only fast-forwards), so the
candidate with the most ancestors (`git rev-list --count`) is the newest, and the others are all
inside it.

If there is none, the deploy stops before the lock's other work and says what the newest records
were and why none counts. It does **not** fall back to the tip — the operator asked for a green
commit, and silently deploying a different kind of commit is the thing this is replacing.

Pinning the deploy to that commit does what Greg's branch would: nothing landing on `dev` afterwards
can change what is gated or pushed.

The trunk gate changes with it, and only in this mode. `trunkGap` demands *equality* with
`origin/dev`, deliberately — ancestry one way lets a stale checkout deploy, the other way lets an
unpushed commit deploy. Under `--ready` the candidate is chosen *from* `origin/dev`'s history, so:

- it must be an ancestor of (or equal to) `origin/dev` after a fetch — that rules out an unpushed
  commit, which is what equality's second half was for;
- the stale-checkout case is the point of the mode rather than a hazard, so instead of refusing it
  the preflight **names it**: *"`origin/dev` is N commits ahead of this; they are not in this
  deploy"*. The gate is named `in origin/dev`, so `--force-gate=level with origin/dev` cannot be
  mistaken for it.

Everything else in preflight already takes the sha as a parameter (`origin/main` ancestry, notes,
migrations, storage buckets) and is unchanged.

**Plain `npm run deploy` is unchanged**: it still deploys the tip and still requires equality.

### 2. Reuse a green test run instead of re-running the suite — only when it provably covers this

Inside `gatesAt`, before the `test` step, for **whichever** sha is being deployed (either mode): if
the readiness store holds evidence that covers this sha, the `test` gate passes on that evidence and
says so; otherwise it runs exactly as today. `build`, the tooling builds, `fixtures` and
`typecheck` always run — they take minutes, and a gate that is never run is a gate nobody can see
working.

The evidence is the readiness verdict that already exists, asked about this sha instead of dev's tip,
plus three clauses of its own. All must hold:

1. **`readinessVerdict` says `ready` for this sha** (`tools/fleet/readiness-verdict.ts`, required
   checks `test` and `typecheck`). That brings its five clauses for free: a wrapper record, not a
   tmux reconstruction; full scope; the same sha at both ends of the run and clean at both,
   untracked files included; every required check passing on it; no later unfinished attempt. (The
   newest *settled* run decides: a pass after a red on the same sha reads green, as on the tab; only
   an unfinished rerun cannot clear a red.) It also reads `npm run check`'s table row by row, so a `check` that failed
   on `cycles` but has `test` and `typecheck` clean still counts — correctly, because the deploy
   does not run `cycles` either.
2. **The `test` evidence came from a full `npm run check` run in the readiness runner's own
   checkout** (`<primary>/.claude/worktrees/readiness-checks`). A `readiness-run.ts test` in some
   agent's worktree is honest about its tree, but its `.env.local`, `node_modules` and corpus are
   whatever that agent left there. The runner is the one place prepared the same way every time
   (§ 3), and `check` runs the builds before the suite in the same order the deploy does.
3. **The passing run finished within the last 24 hours.** The commit cannot change, but the box
   can: the shared local database, the runner's `.env.local`, the tools. Twenty-four hours is the
   Readiness tab's own window, and the store is read over that window: anything that could outrank
   a pass inside it is newer still.
4. **No record in that window is unreadable.** The verdict already turns that into `unknown`; it is
   listed because it means one corrupt file anywhere stops reuse — the conservative way round.

The `test` line then reads, for example:

```
  ok   test — reused: readiness run 9382a9af4a0c, npm run check in readiness-checks,
              finished 2026-10-06 23:49 (3h ago), test and typecheck clean on d58a13c6
```

or, falling back:

```
  ·    test evidence: running the suite here — no readiness run on 8b2c9d33 counts:
              test: failed in a full `npm run check` on this commit
```

and the summary says which happened, in both cases, so a log read afterwards cannot be ambiguous.
The record's `runId` and file are named so anyone can open it.

**Everything above is a pure function in `scripts/deploy-evidence.ts`**, `testEvidenceFor`, with the
store read and git calls outside it, so each refusal is a test against a broken record rather than
against the working one.

### 3. Make the runner's run the same as the deploy's, where they differ

The Overseer's brief: if the two differ, make them the same rather than accept the difference. They
were compared step by step:

| | deploy's `test` gate | readiness runner | done |
|---|---|---|---|
| command | `npm run --silent test` (+ a JSON reporter) after `build`, tooling builds, `typecheck` | `npm run check`: `typecheck`, `build`, tooling builds, `test`, … | same script, same order; the reporter is output only |
| tree | throwaway worktree at the sha | the runner worktree, clean at both ends at the sha | same |
| `.env.local` | **symlink to the primary's** | **a copy taken 2026-09-09**; today it lacks `RESEND_API_KEY` and `SUPABASE_ACCESS_TOKEN` | **make it the same**: the loop replaces the copy with a symlink to the primary's, every tick |
| corpus (`data/`, `output/`) | copied fresh from the commit's `tests/fixtures/data-root` | **copied once, when the runner was created**, and mutated by every run since | **make it the same**: the loop deletes both halves and re-materialises from the commit before every check |
| `node_modules` | the primary's, symlinked — or `npm ci` when the lockfile moved since `origin/main` | `npm ci` whenever the lockfile moved since the last prepared sha | accepted: the runner's is the stricter one, installed from the commit's own lockfile |
| database | the shared local Supabase | the same one, migrations applied to the sha | same, and the same caveat for both (readiness-loop.ts header, F5) |
| environment | the deploy's own shell, inherited | git's and npm's inherited settings scrubbed, `DATABASE_URL` pinned local | accepted: the runner's is the stricter one |
| `VITE_*` in the build the tests read | placeholders (`BUILD_ENV`) | the runner's `.env.local` | accepted: the bundle's assertions do not read these values, and the deploy's own `build` gate still runs with the placeholders |

The `.env.local` difference is the one that could make a reused record **wrong rather than
merely different**: a suite that skips when a key is absent would pass in the runner and run in the
deploy. Linking is also what `scripts/deploy.ts` does, so the two now read one file.

### 4. `changelog:prepare` needs no target, and why

The brief asked to point `changelog:prepare` at the chosen commit. It has no target option
(`release-notes.ts` plans to dev's tip), and it does not need one: the notes have to be **inside**
the commit that ships, so the order is prepare first, deploy second, and the deployed commit must
descend from the notes commit. Since 2026-10-02 later commits roll to the next release's notes
(261002h), so **any green commit after the notes commit passes the `changelog` gate**, and a fix that
lands later does not send prepare round again.

That gives the Overseer this sequence:

1. `npm run changelog:prepare` (as today; it commits the notes on dev).
2. Wait for the readiness loop to record a green commit *after* that notes commit — it runs on its
   own, one `check` every 70–80 minutes when dev moves.
3. `npm run deploy -- --ready`.

When the newest green commit predates the notes, `--ready` says that in so many words rather than
leaving the `changelog` gate's general refusal to explain it.

Pointing the notes at an older commit (cutting `release/<sha>` = green commit + a notes commit) was
considered and set aside: the shipped commit would differ from the green one by the notes file, which
`src/web/ChangelogPage.tsx` imports and tests read, so the green record would not cover it.

## Not built: a release branch for fixes (Greg's branch idea, item 4 of the brief)

The case it helps: a gate other than `test` fails (a build that differs on Vercel's recipe, a
fixture, a migration), and `dev` has meanwhile gone red, so fixing it on `dev` waits for dev to
recover. A `release/<sha>` branch cut from the green commit would take the fix alone.

It is not small, so it is written up rather than built:

- `DEPLOY_SOURCE_BRANCHES` and `trunkGap` both assume the source is `dev`, deliberately
  (deploy-checks.ts explains why `main` was dropped as a source); a release branch is a third
  answer to "what must the candidate contain".
- The fix commit has no readiness record, so the deploy falls back to the full test gate — the
  60 minutes this plan exists to avoid, though only in the rare case.
- The fix must be merged back to `dev` (never rebased), and production then holds a commit `dev`
  does not until that merge lands; the next deploy's `origin/main` ancestry check catches a missed
  merge, one deploy late.

With `--ready` in place the common case — a red that `dev` fixes — no longer costs a deploy anything,
so this waits until a non-test gate actually blocks a deploy that cannot wait.

## The simpler options passed over

- **Reuse without `--ready`**, i.e. only skip the suite when the tip happens to be green. Already
  included (reuse applies to any sha), but alone it rarely fires: the tip is seldom the commit the
  loop last ran, and the deploy would still pick red commits.
- **Trust a record's outcome alone** (`pass` on this sha). Rejected: `readinessVerdict` exists
  because five review rounds found five ways that is wrong (readiness.md § What "green" is allowed
  to mean). Asking it is less code and more honest than restating it.
- **Re-run only the tests that changed since the green commit.** Not sound — nothing here maps a
  file to the tests that depend on it — and unnecessary once the deploy picks the green commit
  itself.

## Tests, red first

The functions were written a step ahead of their tests, so "red first" was established the other
way round: **every clause was removed in turn and its test watched fail** (a script that mutates
one line, runs the file, restores it). All nineteen mutations were caught.

`tests/deploy-ready.test.ts`, against the pure functions:

- `testEvidenceFor` runs the suite for: no record; a record for a different sha; dirty at start,
  dirty at end, moved during the run; red on test; a pass followed by a red; a pass older than
  24 h; a finish time in the future; a pass from another worktree; a bare `test` pass rather than
  `check`; an unreadable record; an unfinished attempt after a pass; a narrowed run; no
  preparation stamp (null, and absent as in an old record); a stamp of an older version, or about
  another sha; a changed or missing `.env.local`; a failed `build` under clean test rows; a missing
  tooling-build row. It reuses a fresh stamped pass, a pass after a red, and a check whose only red
  is a gate the deploy does not run (`cycles`).
- `newestReadyCommit`: none, with reasons; an empty store; the most ancestors wins; a commit not on
  `origin/dev` is ignored; a newer red does not beat an older green; candidates on different
  branches refuse.
- `readyTrunkGap`: ancestor passes; not an ancestor, unreadable `origin/dev`, undecidable ancestry
  each refuse.
- `parseDeployArgs`: `--ready` accepted alone and with `--dry-run`, off by default, refused beside
  `--verify-only`.

`tests/readiness-preparation.test.ts`: a copied `.env.local`, none, or a link elsewhere becomes a
link to the primary's, and a missing primary file refuses without touching the runner's; the corpus
refresh removes what earlier runs left and refuses on a missing half; the stamp carries the hash of
the file the run will read; the wrapper keeps a stamp only for its own clean sha and drops anything
malformed; the store round-trips it and reads a bad one as none.

**Run against the real store** on 2026-10-07 (read-only, a scratch script): every red commit was
refused for its red, and the one green, `d58a13c6`, for having no preparation stamp. So nothing is
reused until the loop is restarted on this code and stamps a run.

## Files

- `scripts/deploy-evidence.ts` (new) — `testEvidenceFor`, `newestReadyCommit`, `readyTrunkGap`.
- `scripts/deploy-checks.ts` — the flag.
- `tools/fleet/readiness.ts` — the runner's path, the `Preparation` stamp and its parser.
- `scripts/readiness-run.ts` — keeps the stamp when it is about this run.
- `scripts/deploy.ts` — the candidate choice, the trunk gate under `--ready`, the reuse at `test`,
  the summary line.
- `scripts/readiness-loop.ts` — link `.env.local`, refresh the corpus before each check.
- Docs: `deployment.md`, `overseer.md` § Deploying, `readiness.md`.

## After the plan review

Sol's review is in
[261007k-…-review-sol.md](261007k-deploy-a-commit-the-readiness-loop-already-saw-green-review-sol.md).
Each P1 was checked against the code and held; what was done:

- **P1-1 — the runner's directory does not prove the runner was prepared.** A record from before
  this change, or a wrapper run by hand in the runner, has the right `cwd` and none of the refresh.
  **Fixed with a preparation stamp**: the loop hands the wrapper `{by, version, sha,
  envLocalSha256}` in `SPIDERYARN_READINESS_PREPARATION` after preparation latched at that sha and
  the corpus was refreshed; the wrapper writes it into the record only when the sha is the one it
  started on, clean. Reuse requires it at the current `PREPARATION_VERSION`, for this sha, with the
  same `.env.local` hash as the primary's file now. Old records and hand runs fall back.
- **P1-2 — a clean `test` row can sit on a stale bundle.** `check.ts` carries on after a failed
  `build`, so the suite can pass against the previous commit's `api-dist/`, and the verdict counts a
  missing row as a pass. **Fixed**: reuse requires `typecheck`, every `SUITE_BUILDS` script and
  `test` present and clean in the same record; a missing row refuses.
- **P1-3 — the deploy's dependencies were the primary's.** It symlinked the primary's
  `node_modules` unless the lockfile moved since `origin/main`; under `--ready` the candidate is
  usually older than the primary's install. **Fixed by always running `npm ci` in the gate
  worktree** (41 s on the box). This also closes the plain-mode case of a primary that pulled a
  lockfile change without installing.
- **P1-4 — the two environments are not provably the same.** Partly fixed: `.env.local` is the same
  file by construction and its hash is compared. **Not fixed, and named here**: the rest of the
  process environment each inherits — the loop's tmux shell, the Overseer's — is not compared.
  Sol's example, `SPIDERYARN_CHROME`, is read by no test today (checked), but the class is real: a
  variable outside `.env.local` that a suite skips on. Fingerprinting the whole environment would
  never match (`TMUX`, `PWD`, tokens); an allowlist of variables the suite reads is a second list
  to keep in step. Revisit if a reused gate is ever found to have skipped something the deploy's
  own run would not have.
- **P2-5** — the corpus refresh runs immediately before an admitted check, not in preparation, and
  refuses unless both halves were copied. **P2-6** — `newestReadyCommit` checks that every other
  usable candidate is inside the chosen one, and refuses if not, rather than trusting the
  fast-forward habit. **P3-7** — a failed `git fetch origin main` now stops the deploy.
- **P2-8, a shared recipe** — one prepared-check command used by both the loop and the deploy —
  would remove the need to prove equivalence at all. It is the better long-term shape, and larger
  than this change: the deploy's gate and `npm run check` would become one entry point. Left as a
  follow-on.
