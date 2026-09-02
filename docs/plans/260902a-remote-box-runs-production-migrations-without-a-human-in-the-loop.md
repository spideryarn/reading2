# The remote box runs production migrations, with nobody in the loop

**Status: proposed, 2026-09-02. Not built.** Greg has chosen the shape; the detail below is what a
first implementation would be, and the [open questions](#open-questions) are the parts still to
settle.

> I really want the remote-box to be able to kick off production migrations as part of its deploy
> (which it can trigger simply with a push).
>
> — Greg, 2026-09-02

> I don't want to be in the loop. I don't want to have to do something manually.
>
> — Greg, 2026-09-02

That second sentence is the constraint that decides the design, and it rules out the answer three
separate reviewers reached for first. It is written down here because everything below is a
consequence of it.

## The problem, in one paragraph

`npm run deploy` does everything from Greg's laptop: gates, then migrations, then the push that
makes Vercel deploy. The [Hetzner box](../project/hetzner-remote-server-box.md) can do the push and
therefore the deploy, because Vercel is git-connected — but it has no production credential, so it
cannot move the schema. **That is the wrong half.** The box can ship code that needs a column which
does not exist, and nothing stops it. Meanwhile any change that does need a migration stalls until
Greg wakes up, which on 2026-09-01 produced a hand-execution runbook for a human to carry out —
commit `5de7f1a`, *"The production runbook for a migration this laptop cannot run"* (on
`origin/dev`, not yet on `main`):

> Greg pre-approved applying 0048 to production. This machine has no credentials for it —
> DATABASE_URL, SUPABASE_URL and the Supabase MCP connection all point at 127.0.0.1 — so the step is
> handed over rather than done.

## This was discussed before, and stopped

On **2026-08-31** Greg asked almost the same question:

> I tried to deploy (including running migrations) from the Hetzner gjd-remote server, but it
> pointed out that it didn't have the Prod credentials to do that. I'd prefer, if possible, to avoid
> sending up .env.prod to the remote servers. Can you see a way around this? … Could we somehow run
> the migrations as part of the deploy (either on GitHub as an Action or similar, or on Vercel)?

That session ran web research and a GPT Sol design review, produced three options, and ended on
*"Want me to write this up as a plan doc, or start on the `/api/health` ledger change?"* — which was
never answered. Nothing shipped. This document is the missing answer, so the thread stops being
reopened every few days.

## The four facts that decide it

Each was measured this session, not assumed. Three of them kill an option that looks obvious.

### 1. No credential can migrate the schema without being able to read readers' data

Probed on the local stack, in a transaction, rolled back. A role with `usage, create` on schema
`spideryarn` and no `select`:

| Statement | Result |
|---|---|
| `select count(*) from spideryarn.articles` | `ERROR: permission denied for table articles` |
| `alter table spideryarn.articles add column zz int` | `ERROR: must be owner of table articles` |
| `create table spideryarn.zz_new (id int)` | succeeds |
| `alter table spideryarn.articles owner to zz_probe` | `ERROR: must be owner of table articles` |

And with ownership transferred to the probe role, `has_table_privilege(…, 'select')` is true. You
can `revoke select` from an owner and it reads false — but the owner keeps the implicit grant option
and can hand it straight back.

**Postgres has no grantable `ALTER TABLE` privilege**; altering an object is inherent in owning it.
So "a narrow DDL-only role that cannot see reader data" is not available for general Drizzle SQL.
GPT Sol's one correction: a `security definer` function taking *structured arguments* (a table name,
a column name, a type from an enum — never SQL text) is a genuine exception, but it is a bespoke
migration DSL and cannot apply normal Drizzle output. Noted, not chosen.

### 2. Production code cannot be a trust boundary against the box

The box pushes to `main`, and a push to `main` deploys. So an `/api/admin/migrate` endpoint, a
Vercel function, a build script, or **any CI job that runs `scripts/db-migrate.ts` at the box's own
commit**, is code the box itself wrote. None of them is a boundary.

Sol sharpened this further, and it changes the honest description of today's posture: **one
malicious deployment can simply return Vercel's `DATABASE_URL`**, after which the box holds the
`spideryarn_app` password and needs no further commit. So withholding `.env.prod` does not mean "the
box cannot reach reader data". What it actually buys is:

- no production DDL — no dropping tables, the migration ledger, or grants;
- no `postgres` reach into `auth` and other platform-owned schemas (emails, sessions, identities);
- no credential that can be copied and used from somewhere else;
- no *immediate* access without first compromising a deployment, which leaves a git and Vercel trail.

That is a real delta and a narrower one than the guard rails in
[`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) imply. Worth saying out loud before
weighing anything against it.

### 3. The approval gate everyone reaches for is not available, and Greg does not want it anyway

Measured via the GitHub API on 2026-09-02: org `spideryarn` is on plan **`free`** with 8 filled
seats; `reading2` is **private**; one environment `Production` exists, created 2026-08-26 by
Vercel's integration, with `protection_rules: []`.

GitHub's rule: environments in private repos need Pro or Team, and **required reviewers and wait
timers in private repos need Enterprise** (~$21/seat, ≈ $168/mo here). Branch protection and
rulesets need Team (~$32/mo here). A prior session measured `/branches/main/protection` returning
`403 "Upgrade to GitHub Pro"`, so **there is no branch protection on `main` today.**

Both a Fable consult and the 2026-08-31 thread recommended the environment-reviewer design. It is
unavailable at this price point — and Greg has now ruled out human approval regardless, which
matters more.

### 4. The box's token cannot reach a GitHub Actions secret, and that is the one real wall here

The box holds two **fine-grained PATs** with **Contents: Read and write, Metadata: Read**
([infra/hetzner/README.md § Giving the box GitHub access](../../infra/hetzner/README.md#giving-the-box-github-access)).
Checked against GitHub's own permission tables:

- pushing a commit that touches `.github/workflows/**` needs a separate **Workflows: write**;
- `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` needs **Actions: write**;
- GitHub never returns an Actions secret's plaintext through the API, and this PAT cannot use one.

The box has none of those. Say it that way rather than "nobody can read the secret", which is too
broad and was Sol's correction: **a privileged workflow can always use or exfiltrate what it is
given** — which is the whole reason the job below must not run the box's own code. This is enforced server-side by GitHub, is independent of the billing
plan, and is the only boundary in this whole design that is a wall rather than a guard rail — the
distinction [infra/hetzner/README.md](../../infra/hetzner/README.md) already insists on for the MCP
deny list. **A workflow file is the one thing in this repository the box cannot change.**

## The design

Three steps, and **step 3 is not optional** — GPT Sol's second review argued it back in, and won.
See [the owners work](#the-owners-work-yes-after-all-and-it-is-cheaper-than-it-looked).

### Step 1 — the box learns when the schema is behind, with no credential at all

The failure this closes is today's, not tomorrow's: code shipping ahead of the schema.

1. **`/api/health` publishes a digest of the applied-migration ledger.** Two grants are needed, not
   one: `usage` on schema `spideryarn_migrations` **and** `select` on `__drizzle_migrations`. The
   app role currently gets `permission denied for schema spideryarn_migrations`, which
   [`deploy-checks.ts`](../../scripts/deploy-checks.ts) already records as the right answer to the
   wrong question.

   It must be a canonical digest over the **complete ordered list**, not the count plus the newest
   hash — two different histories can agree on both. And the expected side is **not** a digest of
   `_journal.json`: the journal holds `when` and `tag`, not SQL hashes. Compute
   `(entry.when, sha256(the corresponding .sql bytes))` and digest that, which is the pairing
   `migration-ledger.ts` already knows how to build.

2. **A required [Vercel Deployment Check](https://vercel.com/docs/deployment-checks) compares the
   two.** Vercel holds a production deployment off the custom domains until required checks pass,
   and a GitHub Actions result can be selected as one directly. Automatic aliasing has to stay on.

   This is the highest-value single guard in the document. It catches direct pushes,
   `--skip-migrations`, redeploys, an Actions/Vercel ordering race, a migration applied from another
   machine, and count-based false success — and needs **no production credential** to do any of it.
   On failure the previous deployment keeps serving.

   The check must run on **every** push to `main` with no `paths:` filter, carry one stable name,
   never treat a skipped or neutral result as success, and read the **trusted Action's** answer
   rather than the candidate commit's `/api/health` — which is code the box wrote.

   Sol on the failure mode: Vercel marks registered checks stale after an hour and running checks
   after five minutes, and does not promise stale becomes a conclusion. Treat it as fail-closed —
   the new deployment stays off the domains, the old one keeps serving — and **prove that with a
   live canary on this project before making it load-bearing.**

3. **An interim pre-push refusal, which step 2 then deletes.** Until the workflow exists, anything
   about to push compares the digests itself and refuses when a migration is pending.

   **This must not survive step 2.** Once the workflow is triggered *by* the push, a refusal to push
   when something is pending deadlocks the whole design — the push is what applies the migration.
   Sol caught this; it is the kind of thing that reads as a safety feature right up until nothing
   can ship.

4. **Fix the two bugs found while reading `scripts/deploy.ts`:**
   - `--skip-migrations` skips `migrationPlan()` — the **check**, not just the apply
     ([`deploy.ts:1332`](../../scripts/deploy.ts)). It should mean *check, and refuse to ship if
     anything is pending*.
   - the post-apply verification compares a ledger **row count** (`moved === plan.pending.length`,
     [`deploy.ts:895`](../../scripts/deploy.ts)) rather than hashes. If another machine applied the
     pending migration in between, this run applies nothing, sees the count move by one, and reports
     success — [silent-success.md](../reusable/silent-success.md) again.
   - the deploy lock is a **file** lock (`deploy.ts:288`), so it is machine-local; only
     `db-migrate.ts`'s advisory lock crosses machines. Holding it across plan → apply → verify is
     **a refactor, not a flag**: the parent cannot take the lock and then invoke `db-migrate.ts`,
     because the child's `pg_try_advisory_lock` would find the parent holding it and refuse. One
     process must own the lock for all three phases, or the report has to say honestly that the
     expected hashes are present and another runner may have put them there.

**And a ledger digest proves ledger agreement, not schema agreement.** A hand-inserted row passes
it while the column does not exist —
[§ A watermark is not a ledger](../project/database.md#a-watermark-is-not-a-ledger) already says so.
This is a necessary check, not a sufficient one.

### Step 2 — the migration runs in GitHub Actions, on the push, with nobody watching

**Trigger: push to `main`.** Not `workflow_dispatch`. Sol recommended manual dispatch twice and it
is the safer design, but it requires Greg to tap a button, which he has ruled out. This document
takes the trade deliberately: see [the trade, stated plainly](#the-trade-stated-plainly).

The job:

1. Checks out **trusted tooling at a full commit SHA pinned inside the workflow file** — the
   migrator, the recogniser, the lockfile. Not the pushed commit. Every third-party action pinned to
   a full SHA too, which is the only immutable way to name one.
2. Checks out the pushed commit's `drizzle/` directory **as data, never as code**.
3. Runs the recogniser over every pending `.sql` file. Anything rejected ⇒ the job fails, nothing is
   applied, and the migration goes to Greg's laptop.
4. Takes the Postgres session advisory lock, applies, verifies the full ledger digest, releases.
5. The Deployment Check from step 1 passes, and Vercel promotes the build.

The migration credential is a **repository Actions secret**. The box cannot read it, cannot edit the
workflow that uses it, and cannot dispatch it. The pinned checkout is what keeps that true: **a
workflow that ran `npm run db:migrate` at the pushed commit would be running code the box wrote**,
and fact 2 would apply again in full.

#### Where the pinned checkout still leaks

Sol's list, and every one of these is a way the "data, never code" claim goes quietly false:

- **Path traversal through the journal tag.** Drizzle builds the filename as `${folder}/${tag}.sql`
  with no validation of `tag` (`node_modules/drizzle-orm/migrator.js`). A tag of `../../trusted/…`
  escapes the data directory.
- **Symlinks.** A `.sql` file can be a symlink; `readFileSync` follows it. Require regular files and
  prove every `realpath` stays below the candidate directory.
- **Parser/executor disagreement.** Drizzle splits each file on the literal text
  `--> statement-breakpoint`. Validate exactly the chunks Drizzle will execute, and reject that
  delimiter anywhere but its exact standalone form. Validating a different decomposition from the
  one that runs is the whole silent-success shape.
- **Untrusted SQL must never go through `psql`.** Over the `pg` protocol, `\!` and `\copy` are
  inert; through the client they are local code execution.
- **Workflow expression injection.** Never interpolate commit messages, authors, refs or filenames
  into a `run:` block — GitHub documents those as attacker-controlled.
- **Checkout credentials, caches, artifacts.** `permissions: contents: read`,
  `persist-credentials: false`, and no executable cache restored in the privileged job.
- **`npm ci` is better than I said** — under a valid lockfile it installs the lock and verifies
  integrity rather than resolving ranges. The live risks are lifecycle scripts and an
  already-pinned bad dependency. Keep the secret out of job scope; install in a separate job before
  any secret exists, or ship a dependency-free bundled runner.
- **No `cancel-in-progress`.** A cancellation after the commit but before the check reports leaves
  the schema ahead and the deployment blocked — recoverable on the next run, but it looks broken.

**And verify the PAT boundary rather than inferring it**: try, once, to modify, delete and
force-push away a workflow file with the box's token. The permission tables say it cannot. That is
documentation, not evidence.

#### The recogniser is the whole of the safety, and it must be positive

Not the current scanner. [`scanSql`](../../scripts/deploy-checks.ts) is a deny list of seven
regexes, and `stripSqlNoise` **removes `$$…$$` bodies before scanning**, so this passes it clean:

```sql
DO $$ BEGIN EXECUTE 'drop table spideryarn.articles'; END $$;
```

A longer deny list is still a deny list. Use **`libpg-query@pg17`**, which wraps PostgreSQL's own
parser at the version this database runs, with a hand-written **exhaustive recogniser over the AST
where every unknown node rejects**. Not `pgsql-ast-parser` — a useful TypeScript parser is not
PostgreSQL's grammar, and here the grammar is the security boundary.

Sol's v1 allowlist: `create table spideryarn.<name>` with a fixed type list, no inheritance,
partitioning, `LIKE`, `OF` or `AS SELECT`, defaults absent or constant, constraints limited to
primary key, unique, simple check, and same-schema foreign keys; `alter table spideryarn.<name>`
limited to adding a nullable column, adding a `NOT NULL` column with an allowed constant default,
adding a simple `CHECK` or same-schema foreign key (preferably `NOT VALID`), and dropping
`NOT NULL`; `create index` non-concurrent, non-unique, B-tree, plain columns only; and
`create type … as enum` of string literals.

Three rejections matter beyond the obvious ones:

1. **Reject every unqualified object name.** "Names no schema but `spideryarn`" is not enough,
   because an unqualified name resolves through `search_path`.
2. **Reject every expression node not explicitly allowed** — function calls, subqueries, casts to
   unapproved types, generated expressions, index expressions and predicates, collations, operator
   classes.
3. **Reject every ownership, privilege, destructive, rewriting or session-control form** —
   `owner to`, `set schema`, all `drop`, `rename`, `alter type`, `using`, `set not null`, `grant`,
   `revoke`, `create role`, `create extension`, `create function`, `create trigger`,
   `create policy`, `copy`, `call`, transaction control, and `set`. Trusted session options are set
   by us; candidate SQL never sets them.

Per [silent-success.md](../reusable/silent-success.md), the recogniser is not finished until a
smuggled `update` and a `DO $$ … drop table … $$` have each been watched to go red. **A gate nobody
has seen refuse is not a gate.**

#### Two things that are true whatever the recogniser says

- **"Additive" does not mean harmless.** `add column` takes `ACCESS EXCLUSIVE`, and a plain index
  build blocks writes for as long as the table is big. **`lock_timeout` is not enough** — it bounds
  only the wait for the lock, not the work after it. Set `statement_timeout` as well.
- **`create index concurrently` cannot run here at all** — the migrator wraps each file in one
  transaction, which `scanSql`'s `NON_TRANSACTIONAL` list already knows. That stays a laptop job.

### Step 3 — hand ownership to a restricted role, so the database is the last boundary

See [the owners work](#the-owners-work-yes-after-all-and-it-is-cheaper-than-it-looked).

## The trade, stated plainly

Sol reviewed this twice. Its first verdict was **"Do not build P2 as written"**, because a migration
workflow triggered by a push **converts the box's existing push permission into production DDL
permission**. That objection is correct and nothing below softens it. Greg has accepted it knowingly:

> I don't want to be in the loop. I don't want to have to do something manually.

Sol's second verdict, once autonomy was fixed rather than negotiable: **(A) is genuinely better than
(B)**, because with (B) any process on the box can read the credential and bypass every check, while
with (A) the box can only submit *input* to fixed code. That is a real capability boundary.

But the honest claim is narrower than "the box cannot run destructive DDL". It is:

> The box gets the subset of production DDL that the recogniser accepts.

A missed AST child, an unqualified name or an allowed expression widens that subset. Which is
exactly why step 3 exists: **the recogniser is TypeScript, and ownership is Postgres.**

**And it is not fully autonomous.** Sol's closing point, which Greg should have before anything is
built: the existing migrations in `drizzle/` contain `DO` blocks, DML, drops, complex checks,
partial indexes and `auth` foreign keys. A safe recogniser will reject a meaningful fraction of real
migrations. **(A) is autonomous for the boring subset, and hands the interesting ones to the
laptop.** That is still most nights, and it is not the same as never being in the loop.

### The simpler option, and why not

**Put a production credential on the box** — Greg's own fallback, and the honest comparison:

| | credential on the box | credential in Actions |
|---|---|---|
| Autonomous | for everything | for what the recogniser accepts |
| The gate | advisory — an agent can bypass the script | enforced — the box cannot edit the workflow |
| Who can read the credential | every agent on the box, one user, passwordless sudo | not through the API, and not by this PAT |
| Destructive DDL | possible | refused, to the limit of the recogniser |
| `auth` schema | reachable if the role is `postgres` | refused by the recogniser, then by step 3 |
| New moving parts | none — it extends `push-env` | a workflow, a recogniser, a role handoff |

The box is shared by many autonomous agents running as one account with passwordless sudo
([Greg's call, 2026-08-31](../../infra/hetzner/README.md)), and prompt injection is an
**acknowledged in-product threat** here — [security-map.md](../project/security-map.md) names "the
document addressing the model" as untrusted party #5, and
[`src/injection-scan.ts`](../../src/injection-scan.ts) exists because of it. A standing `postgres`
password in that trust domain is the thing
[`assertPushableName`](../../scripts/gjd-remote-env.ts) was written to prevent, in those words.

**The cost is not "one workflow file".** Sol is right that the plan understated it: this is a
security-sensitive SQL subset, a filesystem validator, a concurrency protocol, a role handoff, a
release gate and a recovery path. Budget accordingly, and take the fallback deliberately if the
budget is not there — with the row "the gate: advisory" read out loud.

## The owners work: yes after all, and it is cheaper than it looked

**This section reverses itself, and the reversal is the most useful thing in the document.**

Greg's lean was against it, and so was mine, on the grounds that per fact 1 the new owner could read
every article and note anyway, so it did not shrink the blast radius where it counts. Sol
disagreed, and is right: **the recogniser and ownership do not buy the same protection.**

- A recogniser bug cannot reach `auth`.
- A leaked Actions secret cannot administer platform schemas, extensions or unrelated roles.
- A missed `create role`, ownership change or cross-schema expression is refused **by Postgres**,
  not by our TypeScript.

The grammar is the boundary we wrote; ownership is the boundary the database enforces. Given step 2
rests entirely on the first, the second is what makes a mistake in it survivable.

**And the cost was overstated, by this plan and by `database.md` before it.** Do **not** edit
migrations `0001`, `0003` and `0011` — that would break the repo's own rule that an applied
migration's hash never changes ([§ A watermark is not a ledger](../project/database.md#a-watermark-is-not-a-ledger)),
which is the reason the work was deferred in the first place. **One new forward migration** does it:

- create and populate `spideryarn_identity.owners`;
- repoint the existing foreign keys;
- re-own tables, sequences, types, the schema and the migration ledger;
- update default privileges for the new owner;
- revoke database-wide `create`, `createrole`, `createdb` and unwanted schema rights;
- make the owner a `NOLOGIN` role, with a separate rotatable Actions login that may `set role` to it.

The real remaining cost is **keeping the bridge table populated as new users sign up**, which needs
a design rather than a line. That is the open question, not the re-owning.

## Open questions

- **How does `spideryarn_identity.owners` stay populated?** A trigger on `auth.users`, a write on
  first request, or a backfill plus an insert in the sign-in path. This is the one genuinely
  undesigned piece of step 3.
- **Where does the pinned recogniser live?** Simplest is a SHA of this repo pinned in the workflow
  file, which the box cannot edit. A separate repository outside the box's PAT scope is stronger and
  is one more thing to maintain.
- **Does the Vercel Deployment Check hold promotion on this account?** The docs show no paid-plan
  requirement for the GitHub-backed feature, but this becomes load-bearing, so run a live canary
  before relying on it.
- **Is roughly half the autonomy enough?** Measured below rather than left open, because it decides
  whether any of this is worth building. See [how much autonomy this actually buys](#how-much-autonomy-this-actually-buys).

## How much autonomy this actually buys

Sol's closing point was that a safe recogniser rejects a meaningful fraction of real migrations. It
is answerable, so here is the answer rather than a caveat. Approximating Sol's v1 allowlist with a
scan over all 48 committed migrations:

```
  WOULD PASS a strict additive recogniser (approx):   26 / 48
  WOULD BE REJECTED (approx):                         22 / 48

    15 files   drop            (13 × drop constraint, 12 × drop column, 1 × drop index)
     5 files   DML
     4 files   unique / partial / expression index
     2 files   DO block
     1 file    create function/trigger/policy/view
     1 file    grant / revoke
     1 file    set not null
```

**So the box would have shipped a bit over half of them unattended**, and handed the rest to the
laptop. Two things about that number, in both directions:

- It is a **regex approximation of** the recogniser, not the recogniser. The real one rejects on any
  unknown AST node, so the true pass rate is **lower**, not higher.
- These are **historical** migrations, and they carry the schema churn of building the thing —
  twelve `drop column`s is what early design looks like. A settled schema skews additive, so the
  forward rate should be better than 26/48.

The honest summary for the decision: **this buys "most nights, not every night".** If that is not
enough, the answer is the credential on the box, with the trade-off row *the gate: advisory* read
out loud.

## See also

- [database.md](../project/database.md) — the roles, the pooler ports, and the trap where
  `DATABASE_URL=… npm run db:migrate` migrates the laptop and prints `✓ migrations applied`
- [deployment.md](../project/deployment.md) — what `npm run deploy` does, and the two ways in
- [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) — the box, and what
  `push-env` will and will not carry
- [security-map.md](../project/security-map.md) — the untrusted parties, none of them another reader
- [260827v-deploy-pipeline.md](260827v-deploy-pipeline.md) — the deploy script this extends
- [260901b-committed-fixture-corpus.md](260901b-committed-fixture-corpus.md) — why the gates now run
  on the box at all
- [silent-success.md](../reusable/silent-success.md) — the habit every check above is shaped by
