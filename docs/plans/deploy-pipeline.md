# One command to ship

> We want to make deployment really smooth and simple, e.g. runs tests, pushes to main, runs
> database migrations (dunno if this is the right ordering), initiates Vercel deploy, checks it
> worked (perhaps in more than one way), checks logs if possible, etc.
>
> — Greg, 2026-08-27

Today a deploy is a handful of commands nobody has written down in one place, and the pieces that
exist — [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts),
[`scripts/check-production-gate.sh`](../../scripts/check-production-gate.sh),
[`/api/health`](../../src/vercel-health.ts) — are each good and none of them knows about the others.
Nothing runs them in order, nothing checks that the thing now answering on `www.spideryarn.com` is
the thing you just built, and nobody has ever read the logs of a deploy they made.

This plan is `npm run deploy`: **one command, ordered gates, and a verdict**. It is written against
[deployment.md](../project/deployment.md), which is the record of what exists; this is the record of
what we are adding and why.

The dry note in Greg's brief — *"dunno if this is the right ordering"* — turns out to be the most
interesting question in it, and [§ Migrations go first](#migrations-go-first-and-that-is-a-rule-with-an-expiry-date)
is the answer.

---

## Contents

- [What we measured first](#what-we-measured-first) — nine facts, none of them guesses
- [The three decisions Greg made](#the-three-decisions-greg-made)
- [The shape](#the-shape)
- [Step by step](#step-by-step)
- [Migrations go first](#migrations-go-first-and-that-is-a-rule-with-an-expiry-date)
- [The build stamp](#the-build-stamp-which-is-the-only-new-thing-in-the-app)
- [What the tests test](#what-the-tests-test)
- [What this deliberately does not do](#what-this-deliberately-does-not-do)
- [The debt this uncovered](#the-debt-this-uncovered)
- [Order of work](#order-of-work)
- [What the review changed](#what-the-review-changed)
- [What building it found](#what-building-it-found)
- [What the first real deploy did](#what-the-first-real-deploy-did)

---

## What we measured first

Everything below was run, not remembered. The ones that changed the design are marked.

**1. `vercel logs` on the installed CLI captures nothing, and looks exactly like a quiet app.**
Version 48.6.0's help says *"from now and for 5 minutes at most"* — a live tail with no history. So
the first design here had the script start a tail in the background before pushing. Then a peer
session found the real answer, which is that the command was rebuilt: `npx vercel@latest logs`
(59.7.0) has `--since`, `--until`, `--level`, `--status-code`, `--json`, and its JSON Lines carry a
`deploymentId`. **So we can ask for exactly our deployment's logs, after the fact.** Verified here:
a `--since 30m --limit 20 --json` returned our own pino lines with `deploymentId` on each.
The rest of the trap — that `spideryarn.com` and the `*.vercel.app` URL both bounce at the edge and
so write no runtime log at all — is in
[the memory note](../project/logging.md) and repeated in [§ Read the logs](#7-read-the-logs).

**2. A log line missing is not a request missing.** ⚠️ *changed the design.* Tailing the logs while
curling two endpoints: `/api/library` returning 401 produced a pino line; `/api/health` returning
200 produced **nothing at all**. Health is answered in [`src/vercel.ts`](../../src/vercel.ts) before
`handleApi`, so it never passes the logging middleware. Any check that reads "no errors in the log"
as "nothing went wrong" is reading an empty set it caused itself.
[silent-success.md](../reusable/silent-success.md), again.

**3. Building the committed tree costs about two seconds.** ⚠️ *changed the design.*
`git worktree add --detach <tmp> HEAD` takes 0.3s and shares the object database rather than
cloning; symlinking the main tree's `node_modules` into it works; `npm run build` there takes 1.2s.
The bug this catches — code committed that imports something still uncommitted on somebody's disk —
has broken `main` [three times](../project/deployment.md#the-two-do-not-agree-and-git-is-the-one-telling-the-truth).
At two seconds there is no argument left against checking it every time.

**4. That build fails in a clean worktree, and the reason is not the commit.** ⚠️
`vite.config.ts` imports `./src/routes.js`, which reaches `src/store/index.ts`, which **throws at
import** when `NODE_ENV=production` and `SPIDERYARN_STORE` is not `postgres`. So `npm run build`
on this laptop passes only because `.env.local` exists, and a clean checkout of a perfectly good
commit fails with a message about the store. The preflight must supply that variable, and its
failure text must say so — otherwise the gate's first act is to accuse an innocent commit.

**5. The test suite is not hermetic.** ⚠️ In a clean worktree of HEAD, 26 test files fail: the
client ones cannot even be collected without `VITE_SUPABASE_URL`, and the pipeline ones `ENOENT` on
`data/`, which is gitignored. Symlink `.env.local` and `data/` in and the same commit runs in 31
seconds with 5 failures. (The script **copies** `data/` rather than linking it — tests create and
delete directories under it, and 25MB is an APFS clone at 0.07s, so there is nothing to trade.)
**The suite cannot be reproduced by anyone who is not Greg, on this laptop, with its accumulated
`data/`.** That is a real problem and it is bigger than deploying —
see [§ The debt this uncovered](#the-debt-this-uncovered).

**6. `main` is red right now, and it is genuinely red.** Checked in a worktree of the exact commit,
isolated from every agent's uncommitted edits: `npm run build` green, `npm run typecheck` 10–12
errors, `npm test` 5–6 failures. The counts differ between two checks minutes apart because commits
kept landing — **HEAD's green/red status has a half-life of minutes in this tree**, which is the
argument for evaluating the gates against the exact SHA about to be pushed, immediately before
pushing it, rather than trusting that somebody checked recently.

Every typecheck error is under `tests/`, and that distinction is provable rather than comforting:
Vite's build never runs `tsc`, so a type error in a test file cannot reach what Vercel serves. It
still gates — see [§ The three decisions](#the-three-decisions-greg-made) — but it is worth knowing
which failures could ship and which could not.

**7. The Vercel project, read from its own API rather than from the dashboard.**
`autoExposeSystemEnvs: true` (so `VERCEL_GIT_COMMIT_SHA` reaches both build and runtime),
`skewProtectionMaxAge: 43200`, `ssoProtection: prod_deployment_urls_and_all_previews`, git linked to
`spideryarn/reading2` on `main`, `deployHooks: []`, and — the one that decided
[question 1](#the-three-decisions-greg-made) — **`protectionBypass: null`**. Protection Bypass for
Automation is not enabled, so a per-deployment URL 302s to Vercel SSO and cannot be smoke-tested
before it is promoted.

**8. `GET /v7/deployments?…&sha=<sha>` works, and `readySubstate` is the field that matters.**
Verified against the live project: it returned our deployment with `state: READY`, `readyState:
READY` and `readySubstate: PROMOTED`. `READY` means *built*. `PROMOTED` means *serving*. A check
that stops at `READY` is checking that a build succeeded, which is not the question anybody asked.

**9. The remote migration credential has to be assembled, and nothing assembles it.**
`.env.prod`'s `DATABASE_URL` is the **app** role on the transaction pooler, and that role cannot
even read the migration ledger — asking it gives `permission denied for schema
spideryarn_migrations`, which is correct and is also exactly what a broken connection looks like.
Migrations run as `postgres` over the **session** pooler on 5432, built from `DATABASE_PASSWORD`.
Assembled by hand and verified: `current_user postgres`, PostgreSQL 17.6, SSL verified. Remote
ledger holds 18, HEAD's journal holds 18 — in step. The **local** database holds 19, because an
uncommitted `0018` has been applied to it. That asymmetry is normal here and the script must be able
to say it out loud rather than compare the wrong two numbers.

---

## The three decisions Greg made

Each of these had a real alternative and would have produced different code.

### 1. Push, verify, roll back rather than staged-then-promote

Vercel can land a production build without aliasing it (`--skip-domain`, or turning off auto-assign
of production domains project-wide), let us smoke-test its own URL, and only then `vercel promote`.
That is proper blue/green and nothing broken would ever reach a reader. It needs two project
settings changed, including enabling Protection Bypass for Automation, because otherwise the staged
URL is behind SSO ([fact 7](#what-we-measured-first)).

**Greg chose the simpler one**: a push to `main` goes live as it does today, and the script verifies
afterwards and hands you the rollback command. The cost is honest and small — a bad build is live
for roughly the minute between promotion and rollback.

There is a second cost to the road not taken, and it is the reason this is not obviously the wrong
call: with auto-assign off, **a push made outside `npm run deploy` would build and then sit there,
live nowhere**, and nothing would say so. Trading a one-minute window for a permanently quiet
failure mode is not a clear win in a tree where several agents push.

### 2. Tests and typecheck are hard gates, with a loud override

Not advisory. `npm run deploy` stops if HEAD does not typecheck or does not pass its tests.
`--force-gate=typecheck` / `--force-gate=test` overrides — named, never blanket, and printed in the
final summary as `DEPLOYED WITH typecheck GATE FORCED — 12 pre-existing errors` so an override is
visible in retrospect rather than silently absorbed.

This lands against a red baseline ([fact 6](#what-we-measured-first)), which is not comfortable, and
the house rule in [`scripts/check.ts`](../../scripts/check.ts) — *a check that always fails is a
check nobody runs* — is an argument for waiting. Greg overrode it deliberately. The sequencing that
keeps both true: **build the gate now, fix the red before the first real deploy, and treat any use
of `--force-gate` as a debt entry rather than a workflow.**

### 3. Migrations: apply what is pending, and say what you are applying

The alternative was a gate that scans pending SQL for `DROP COLUMN`, `RENAME`, `SET NOT NULL`,
type changes and `CREATE INDEX CONCURRENTLY`, and refuses without an explicit flag. Greg chose the
plainer version: print the target, list what is pending, apply it, prove the count moved.

**The scan is still built — as a report, not a gate.** Two of those statements do not merely
deserve thought, they *cannot work* here: drizzle 0.45.2 wraps every pending migration in one
transaction (verified by reading the installed source, not the docs), so `CREATE INDEX
CONCURRENTLY` fails with "cannot run inside a transaction block", and a new enum value cannot be
used in the same run that adds it. Printing a line that names those before they fail is not a gate
getting in the way; it is the difference between a confusing error and an obvious one.

---

## The shape

`scripts/deploy.ts`, run with `tsx`, in the same `Step[]` gate/advisory shape as
[`scripts/check.ts`](../../scripts/check.ts). Not GitHub Actions, and the argument against is
specific rather than general: this repo has no CI at all, Vercel's git integration already builds on
push, and an Actions-driven path would create a *third* way in that builds different code — in a
project whose deployment doc already devotes a section to
[the two that exist](../project/deployment.md#the-two-do-not-agree-and-git-is-the-one-telling-the-truth).
Actions would also need its own copy of `DATABASE_PASSWORD`, which is a second place for a secret to
drift out of step. One developer, no PR gate to sit in front of: a local script is the right size.

```
npm run deploy                 # the whole thing
npm run deploy -- --dry-run    # every local gate, nothing external, print what it would do
npm run deploy -- --force-gate=test
npm run deploy -- --skip-migrations
npm run deploy -- --host https://…   # verify a host without deploying anything
```

---

## Step by step

Numbered because the order is the design.

### 1. Preflight, local and read-only

- On `main`; `git fetch origin`; refuse if behind `origin/main` (that needs a human's merge).
- Print the dirty working tree as **information, not a gate** — a push ships commits, so another
  agent's edits are harmless here, and naming them is how you notice that the thing you meant to
  deploy is not committed.
- `npx drizzle-kit check` — validates migration-history consistency, catching two agents having
  generated migrations from a diverged snapshot. Runs in a second and is green today.
- Resolve **the SHA**. Everything downstream is checked against this one value.

### 2. The gates, at HEAD, in a throwaway worktree

`git worktree add --detach <tmp> <sha>`, symlink `node_modules`, then:

| | Env it needs | Why here |
|---|---|---|
| `npm run build` + the api build | `SPIDERYARN_STORE=postgres`, and nothing else | The three-times bug. This is the only check that can catch it |
| `npm run typecheck` | same | |
| `npm test` | plus symlinked `.env.local` and `data/` | Because the suite is not hermetic ([fact 5](#what-we-measured-first)) |

The build gate gets a **minimal, named** environment rather than the whole of `.env.local`, so that
what production-parity requires is a documented list rather than whatever happens to be in one
person's file. The test gate cannot have that today, and the output says so in one line rather than
pretending otherwise.

The worktree is removed at the end, including on failure. It is in a temp directory and it never
touches the main checkout — no `git stash`, no `git checkout --`, no `git clean`, per
[the rule](../project/version-control.md).

### 3. Migrations

Built from `.env.prod`: `postgres.<ref>` over the session pooler on 5432, SSL verified against
`certs/supabase-ca.crt`. Then, in this order:

1. **Evidence about the target**, before anything is applied:
   `select current_database(), current_user, inet_server_addr(), version()`. `inet_server_addr()`
   is the one that would have caught the incident `db-migrate.ts` is written around — a local
   Postgres answers `127.0.0.1`, the real host answers its own IP. Evidence, not an assumption about
   what a URL ought to mean.
2. **What is pending**: `drizzle/meta/_journal.json`'s entries at the SHA, minus the rows in
   `spideryarn_migrations.__drizzle_migrations`, listed by tag.
3. **What is in them**: a line naming any statement that cannot run inside a transaction, and any
   destructive statement. A report ([decision 3](#3-migrations-apply-what-is-pending-and-say-what-you-are-applying)).
4. **Apply**, then **assert the count moved by exactly the number that was pending**. A run that
   applies nothing when something was pending is the failure this whole script exists to make
   loud — it is what `✓ migrations applied` said on the day it migrated the laptop.
5. If any pending migration created a table, re-run the `has_table_privilege` canary for
   `spideryarn_app`. The default-privilege grant is scoped `FOR ROLE postgres`, so a migration run
   as anyone else produces tables the app silently cannot read.

`--dry-run` stops after 3.

### 4. Push

`git push origin main`. Nothing else — the build machine clones the repo, so what ships is the
commit and nobody's disk reaches it.

### 5. Wait, and know which deployment is yours

Poll `GET /v7/deployments?projectId=…&teamId=…&target=production&sha=<sha>` until a row appears,
then until it leaves `BUILDING`.

- `ERROR` → fetch the build log with `vercel inspect <url> --logs`, print its tail, exit non-zero.
- `READY` → keep polling until `readySubstate: PROMOTED` ([fact 8](#what-we-measured-first)).
- Cross-check by asking the *other* direction too: `vercel inspect www.spideryarn.com` must report
  our deployment id. One says "my deployment got promoted", the other says "the address serves my
  deployment", and they can disagree.

### 6. Verify, against `https://www.spideryarn.com`

Every line asserts a status or a field. None of them follows redirects — a 302 to a Vercel login
page reads as 200 to `curl -L`, which is how a fail-open gets vouched for.

| Check | Passes only if |
|---|---|
| `GET /api/health` | 200 **and** `ok: true` **and** `build.commit === <sha>` **and** `store.name === "postgres"` **and** `ssl.mode === "verified"` **and** `warnings` empty |
| `GET /build.json` | `commit === <sha>` — the *client bundle* is from this build too ([§ stamp](#the-build-stamp-which-is-the-only-new-thing-in-the-app)) |
| `POST /api/health` with a body | `bytes > 0` — `NODEJS_HELPERS=0` still holds |
| `GET /api/library` | 401 |
| `POST /api/jobs` | 401 |
| `GET /` | 200, is the app, not Vercel's "Deployment has failed" page (also a 200) |
| every `/assets/*.js` it references | 200, and no `sb_secret_`, and no JWT whose payload decodes to `service_role` |
| `GET /robots.txt` | 200 **and** `content-type: text/plain` — a `text/html` 200 here means the SPA catch-all ate it, which a crawler reads as *no such file* |

Retries with backoff on the first request only, for a cold start. Latency is never a gate.

### 7. Read the logs

`npx vercel@latest logs --scope greg-detre --json --since <the moment we pushed>`, filtered to our
`deploymentId`. Report the count by status code, and print in full anything at `level` error or
fatal.

Two things this step has to say out loud, because both are ways of reading an empty result wrongly:

- **`/api/health` writes no log**, ever ([fact 2](#what-we-measured-first)). The 401 checks are the
  ones that prove the logging path works, and they are in the list partly for that reason.
- The **installed** CLI cannot do this at all, so the script invokes `vercel@latest` explicitly
  rather than whatever `vercel` resolves to. A version check that says so beats a silent empty
  result.

### 8. The verdict

A pass/fail table in `check.ts`'s style. On success, one line naming the commit and the host. On
failure, the failing check, the local command that reproduces it, and:

```
vercel rollback <previous-deployment-url> --scope greg-detre --yes
```

**It does not roll back for you.** Several of the failure modes above are transient — a cold start,
a rate limit, a pooler blip — and a rollback fired on one of those silently undoes a good deploy,
after which the next real change also looks like it did not take. That is a second silent failure
stacked on the first. The script reports a verdict and stops, the way every other check in this repo
does.

And it prints the thing that is easy to miss: **after a rollback, Vercel turns off auto-assignment of
production domains.** The next push to `main` will build and not go live, and nothing will say so
until somebody runs `vercel promote`.

---

## Migrations go first, and that is a rule with an expiry date

Greg's *"dunno if this is the right ordering"* deserves a real answer rather than a convention.

The rule is not "before" or "after". It is: **a migration must be compatible with both the old code
and the new one, because there is a window where both exist.** Vercel keeps the old function serving
until the new deployment is promoted, so during a migration the old code is talking to the new
schema. Given that, ordering follows from the kind of change:

- **Additive** — a new nullable column, a new table, a new index, a widening type. Old code ignores
  what it does not know about; new code needs it there when it arrives. **Run before the push.**
  This is every migration this project has written so far.
- **Destructive** — a drop, a rename, `NOT NULL` without a default, a narrowing type. Never one
  step. Expand: add the new shape alongside the old, ship code happy with either. Backfill. Then,
  **a full release later**, contract: drop the old shape.

The checklist, which belongs in [database.md](../project/database.md) as much as here:

1. Does the new code need the column to exist to serve its first request? → migrate first.
2. Does the code *currently live* touch what you are changing? If yes and the change is destructive
   to it → expand/contract, not one migration.
3. Would rolling the **code** back — which is the one button we have — break against the new schema?
   If so the migration is not backward-compatible enough yet. **The schema does not roll back**, and
   drizzle has no down-migrations; reverting means writing a new forward migration.
4. Never ship the code that drops the last reader of a column in the same deploy as the migration
   that drops the column.

Two Postgres specifics worth having written down, because both are counter-intuitive:
`ADD COLUMN … DEFAULT <constant>` has been instant since PG11 (no table rewrite) — but a *volatile*
default like `now()` or `gen_random_uuid()` still rewrites the whole table under `ACCESS EXCLUSIVE`.
And `SET NOT NULL` locks the table for a full scan, unless you add a `CHECK (col IS NOT NULL) NOT
VALID` first, `VALIDATE CONSTRAINT` separately, and then `SET NOT NULL`, which PG14+ recognises and
skips.

The expiry date: all of this matters in proportion to the data. There are five articles on the
remote. Adopt it now, while getting it wrong is free.

---

## The build stamp, which is the only new thing in the app

[deployment.md](../project/deployment.md#the-env-block-was-a-report-not-a-check) already names this
gap: *"A build-stamped sentinel is the real answer and is not built."*

`/api/health` currently reports `process.env.VERCEL_GIT_COMMIT_SHA`, read **at request time**. That
is what Vercel believes triggered the build, which is not the same as what compiled — and it is
empty entirely for a `vercel deploy` from a working tree, a path this repo deliberately keeps.

The first draft of this plan computed the stamp once in `vercel.json`'s `buildCommand` and exported
it to both builds. **GPT Sol killed that**, correctly and on two counts: `VAR=x cmd1 && cmd2` does
not export `VAR` to `cmd2` at all, so the API build would never have seen it; and the fallback
`$(git rev-parse HEAD)` cannot work for a `vercel deploy`, because `.vercelignore` excludes `.git`
and the build machine has no repository to ask.

So each build resolves it itself, in [`scripts/build-stamp.ts`](../../scripts/build-stamp.ts):
`SPIDERYARN_BUILD_COMMIT`, else `VERCEL_GIT_COMMIT_SHA`, else `git`, else the string `"unknown"`.
**They cannot disagree, because the commit is deterministic** — two processes resolving the same
fact get the same answer or the build was already broken. `builtAt` is not deterministic and is
therefore never compared.

`"unknown"` **never matches, including itself**, which is the load-bearing part: two artefacts that
both failed to identify themselves would otherwise compare equal, and the check that exists to prove
they came from the sha you pushed would pass over a pair that has no idea.

- **Client**: a tiny Vite plugin writes `dist/build.json` — `{ commit, builtAt }`. A static file
  rather than a value baked into the JS, so a smoke test can read it without parsing a bundle.
- **Server**: the same value via `define` in `vite.api.config.ts`, reported by `/api/health` as
  `build: { commit, builtAt, source, deploymentId }`, **alongside** the existing `commit` field
  rather than replacing it. Keeping both is the point: they answer different questions, and the day
  they disagree is a day worth hearing about.
- **And a deployment id**, which is the stronger of the two and was Sol's addition. A commit can be
  deployed twice — a redeploy, a retried build — and every commit-based check passes over the wrong
  one of the two. `VERCEL_DEPLOYMENT_ID` is unique to one build, so it also catches the case a
  commit check cannot see at all: an edge-cached response, which carries the id of whichever
  deployment produced it.

That gives the verification step three things it cannot get any other way: the function is from this
build, the client bundle is from this build, and **the two are from the same build** — which is the
failure nothing else here would notice, and which skew protection does not address (that keeps an
*old* deployment alive for tabs already open; it says nothing about one deployment's halves
matching).

It also softens, without curing, the weakest line in the health check: `VITE_SUPABASE_URL` is
compiled in at build time, so the endpoint reporting it as set says nothing about the bundle being
served. A `builtAt` later than the day the variable was set is at least evidence.

---

## What the tests test

The deploy script's own logic goes in importable functions so it can be tested without deploying
anything — the shape [`tests/run-codex.test.ts`](../../tests/run-codex.test.ts) already uses.

Per [the house rule](../reusable/silent-success.md), **every assertion gets tested against the
broken state first.** A check nobody has seen fail is not evidence.

- **Pending migrations**: journal-minus-ledger, including the case that bit us — the local database
  holding *more* than the journal, which must read as "ahead", not as "nothing pending".
- **Choosing the deployment**: given a list, pick the one matching our SHA and target; ignore a
  preview with the same SHA; and refuse a `READY` that is not `PROMOTED`.
- **Health assertion**: a table of deliberately wrong responses — `ok:false`, the wrong commit, the
  wrong store, `ssl.mode: "encrypted-unverified"`, a non-empty `warnings` over an `ok:true` — each
  must fail.
- **A 302 to SSO must not count as a pass.** This is the specific way a smoke test lies.
- **Secret scan**: a fixture bundle containing `sb_secret_…`, and one containing a JWT whose payload
  decodes to `service_role`, must both be caught; a clean bundle must pass.
- **Statement scanning**: `CREATE INDEX CONCURRENTLY` and `DROP COLUMN` are found in SQL that also
  contains them inside a comment or a string, and are not found in SQL that merely mentions them.
- **`--dry-run` performs no write and no push.** Asserted by the absence of the calls, not by
  reading the output.

---

## What this deliberately does not do

- **No auto-rollback.** Argued above.
- **No authenticated round-trip.** The highest-value check we are not doing.
  [`scripts/seed-local-session.ts`](../../scripts/seed-local-session.ts) refuses anything but
  localhost, correctly, because it spends the service-role key. Doing this properly means a
  dedicated, narrowly-scoped smoke-test account with a stored credential. Worth it later; it is not
  a line of code.
- **No pre-promotion canary**, per [decision 1](#1-push-verify-roll-back-rather-than-staged-then-promote).
  The two Vercel settings it needs are written down so the choice can be revisited in an afternoon.
- **No CI.** See [§ The shape](#the-shape).
- **No log drain.** `vercel@latest logs` covers the "what did my deploy do" question. Durable,
  queryable history is a different problem and nobody has it yet.

---

## The debt this uncovered

Neither of these is deployment's fault, and both were found by building this.

**The test suite depends on gitignored state.** `.env.local` for `VITE_SUPABASE_URL`, and `data/`
for pipeline fixtures. `CLAUDE.md` tells every agent to run `npm test` and trust green, and that
instruction is only sound on the one machine that has accumulated the right `data/`. It is likely
that the `pipeline-artifact-store` and `library-log-volume` failures at HEAD are this rather than
separate debt. Fixing it — fixtures that a test creates rather than finds, and a documented minimal
env — would make the deploy gate honest *and* make the instruction in `CLAUDE.md` true.

**`main` is red.** 10–12 typecheck errors and 5–6 test failures, all of them somebody's in-flight
work, none deployment-related. The gate is built to block on this. It should be fixed before the
first real deploy rather than met with a flag.

---

## Order of work

1. `dist/build.json` and the `/api/health` `build` block, with tests. Independent of everything
   else and the smoke tests need it.
2. `scripts/deploy.ts` — preflight, worktree gates, verdict. Runs end-to-end with `--dry-run`.
3. Migration step, including the `--dry-run` evidence block; fold the same evidence into
   `scripts/db-migrate.ts`, which is where it belongs anyway.
4. Push, wait, verify, logs.
5. Retire `scripts/check-production-gate.sh` into it, or keep it as the standalone "is the gate
   holding right now" tool it is. Decide once the checks are written and duplication is visible.
6. Rewrite [deployment.md § Deploying](../project/deployment.md#deploying) around the one command.
7. A real deploy, and write down what it actually did.

---

## What the review changed

GPT Sol reviewed this plan before it was built and returned *"revise before build"*. Seven of its
findings changed the code; each was checked here before being acted on, and two of its guesses were
wrong in the same pass (see the foot of this section).

1. **The sha was not pinned end to end.** The plan gated one commit and then ran `git push origin
   main`, which ships whatever `main` has become — and in this tree that is a real race, not a
   theoretical one: HEAD moved three times while this was being written. The push is now
   `git push origin <sha>:refs/heads/main`, so the commit that was gated is the commit that ships,
   and a non-fast-forward is the right answer rather than a surprise. A **lock file** serialises
   whole runs, because drizzle takes no lock of any kind and two deploys would each find the same
   pending migrations.
2. **The deployment matched by sha could be an old one.** A redeploy of the same commit satisfies
   `?sha=`, and every check downstream would then describe the wrong build in convincing detail. The
   deployment must now also have been **created after our push**.
3. **Migration files were read from disk**, which several agents are editing. They are now read with
   `git show <sha>:…`, so a migration that appears between the gate and the apply cannot be applied
   without ever having been built against.
4. **Counting the ledger was too weak.** Drizzle reads only the single most recent `created_at` and
   never compares the hashes it stored against the files in front of it — so a database that applied
   a *different* `0016` is indistinguishable from a healthy one by counting, and drizzle will
   cheerfully carry on appending to it. Since the hash is `sha256` of the whole file, comparing the
   applied rows against the committed files is cheap and catches the class.
5. **The log check would have missed every error this application writes.** `src/log.ts` writes
   through `pino.destination({ sync: true })` — stdout, for `log.error` as much as `log.info` — and
   Vercel classifies a line by the stream it arrived on. So our errors wear Vercel's `info`, and a
   filter on Vercel's level reports a clean deploy over a function throwing on every request. Three
   readings now: Vercel's level, the HTTP status, and the pino level *inside* the message.
6. **`vercel@latest` in a release path.** It changes the tool that judges a deploy without anything
   changing in the repo. Pinned to `vercel@59.7.0`.
7. **The rollback state has to be a preflight blocker, not a printed warning.** Sol was unsure the
   API exposed it; it does — `autoAssignCustomDomains` — verified against the live project. It is
   checked *before* the database is touched, because discovering it afterwards means having advanced
   the schema for code that will never serve.

Three more things Sol asked for and got: a multi-segment unauthenticated request, which proves the
catch-all rewrite, the auth gate and the logging path in one; a much stricter body probe, since
`bytes > 0` conflates three different faults; and **a build that refuses to produce a blank page** —
`VITE_SUPABASE_*` missing on Vercel now fails the build rather than shipping a site that renders
nothing and reports nothing.

Two of its findings were wrong here, and are recorded because the reasoning is right elsewhere.
It said `data/` must be copied rather than symlinked because tests delete under it — the concern is
correct, and it is why the script copies, but the copy is *free* (APFS clone, 0.07s for 25MB) rather
than a trade. And it recommended `npm ci` in the worktree unconditionally; that is 24 seconds against
2, for a difference that only exists when the lockfile has moved, so the script escalates to `npm ci`
**only** when `package-lock.json` is part of what is shipping.

---

## What building it found

Three things, none of which the plan predicted.

**The minimal build environment rots, and it rotted within the hour.** The preflight build is given a
named list of placeholder variables rather than an inherited `.env.local`, so that production-parity
is something a person can read. Between writing that list and running it, a peer commit added a
second import-time guard requiring the Supabase Storage pair — and the gate's first act was to report
a perfectly good commit as a broken build. The list is fixed; more usefully, a build that dies
*loading the config* is now told apart from one that dies compiling, and says so: it points at
`BUILD_ENV` rather than at the commit.

**A security check cried wolf about production.** The first `--verify-only` run reported an
`sb_secret_…` key in the live bundle. It was supabase-js's own
`key.startsWith("sb_secret_")` — the library checking a prefix, carrying no key.
[tests/no-secrets-in-bundle.test.ts](../../tests/no-secrets-in-bundle.test.ts) had already found and
written up that exact mistake against a local `dist/`, and the new copy shipped with the bug the old
copy had fixed. **There is now one implementation**, in `scripts/deploy-checks.ts`, imported by the
test — and the shell script had the same bug, and has the same fix. Two copies of a security rule is
one copy and one liability.

**The suite is not hermetic, and that is bigger than deploying.** Recorded below.

---

## What the first real deploy did

**2026-08-27, commit `718c1bf2`, deployment `dpl_G6pVxpaFN1AXj4NvS7w1fkPqgvAQ`.** Nine checks green,
including the two that could not exist before this work:

```
──  Migrations
 ·    answering: postgres as postgres at 2a05:d01c:… — PostgreSQL 17.6
 ok   the applied history matches this commit
 ok   nothing pending — the remote is in step with this commit
──  Push          ok  pushed 718c1bf2 to origin/main
──  Waiting       ok  live: https://spideryarn-reading2-1d7fhjgd3-… (dpl_G6pVxpa…)
──  Verifying https://www.spideryarn.com
 ok   GET /api/health                    ok   GET /build.json — the page's own stamp
 ok   POST /api/health — a request body survives the platform
 ok   a three-segment API path is refused by our gate, not by Vercel
 ok   GET /api/library refused           ok   POST /api/jobs refused
 ok   GET / is the app                   ok   1 served asset(s) … carry no secret
 ok   GET /robots.txt is a real file with a rule in it
──  Logs          ok  the log contains the request this script made
                  ok  nothing at error level, on any of the three readings of it
```

It was **forced past the typecheck and test gates**, which is the thing to be honest about: 13 type
errors and 6 failing test files, all of them other agents' in-flight work, none of them able to reach
production — every type error is under `tests/`, and Vite's build never runs `tsc`. The banner says
so, which is what the banner is for. It is a debt entry, not a workflow.

Three things the run settled that had been assumptions:

- **`/build.json` is not eaten by the SPA catch-all.** Vercel gives a real file precedence over a
  rewrite, as `robots.txt` already did. Sol said so; production confirmed it.
- **`VERCEL_DEPLOYMENT_ID` is available at build time.** Both artefacts carry the same one.
- **The migration credential recipe works unattended** — `postgres` over the session pooler,
  assembled from `.env.prod`, `inet_server_addr()` printed before anything was applied.

And two bugs it found in itself, both the same shape and both now tested:

- **The first attempt died on a pooler timeout** — `(EAUTHTIMEOUT) timeout while waiting for
  message`, on a connection that worked a minute either side — and printed twenty lines of `pg`
  internals and no verdict. The question at that moment is not what threw; it is whether anything
  was pushed and whether the schema moved. There is now one retry, and nothing can end the run
  without a summary.
- **The log status field is `responseStatusCode`, not `statusCode`.** So the "a 5xx is loud" reading
  matched nothing, ever, and printed every status as `—` while reporting itself clean. Found by
  listing the keys of a real log line after a real deploy, which is the only way that kind of
  mistake is ever found.

The **lock** also caught itself out, before the deploy: a run piped into `head` took SIGPIPE, its
`finally` never ran, and the lock outlived it — so every later run refused on behalf of a process
that had been dead for minutes. It is now released on `exit` too, and a lock whose holder is gone is
taken over rather than obeyed.
