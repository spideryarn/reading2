# Review: how to make a subscription ingest-quota unbypassable, cheaply

You are reviewing **one design decision** in a Stripe billing build, not a whole plan. I want a
verdict on the design below versus the alternative, and I want you to attack the one I favour.

Answer in this order: (1) which design, and why, in a paragraph; (2) anything in the favoured
design that is outright broken; (3) anything that is a real hazard but survivable, ranked; (4) the
simpler thing I have missed, if there is one. Be concrete about SQL and about the failure
interleaving. Do not pad — I will act on this directly.

## The product rule

- Free tier: **3 successful ingests, lifetime.** Paid tier: **100 per billing period.**
- The unit is a **successful new ingest** (a URL added, or a PDF uploaded and processed).
  Re-running one pipeline step on an article already ingested is free. A failed ingest is free.
  Deleting an article does not refund the slot.
- At the limit: hard block. Reading is never blocked, only new spend.
- This is an **abuse boundary against model spend**, not accounting. It must not be bypassable by
  a script firing N concurrent requests, which is the specific failure a previous review caught.
- Pre-launch alpha, no real users yet. Simplicity is worth a lot; correctness of the boundary is
  worth more.

## The codebase facts that constrain this (all verified, do not assume otherwise)

1. **Jobs are inserted by `enqueueOrGet` in `src/store/pg-jobs.ts`, which is deliberately NOT a
   transaction.** It is a bounded retry loop of two pooled statements around
   `insert … on conflict do nothing` against a partial unique index `jobs_active_slug`
   `(owner_id, slug) where status in ('queued','running')`, and it is reached only after
   `enqueue()`'s own loop that tries successive slug suffixes. There is also a filesystem twin of
   the job store, pinned by a parity test. So "count and insert the job in one transaction",
   which is what the previous reviewer asked for, is not available without real surgery.

2. **The connection pool is small on purpose** — `DATABASE_POOL_MAX` defaults to **5**, because
   Supabase's pooler limit is global and serverless multiplies instances. So a design where each
   admission holds one connection open in a transaction *while* calling `enqueue()` (which takes a
   second connection from the same pool) deadlocks at 5 concurrent admissions. I consider this
   disqualifying for the "hold a lock across enqueue()" shape. Tell me if I am wrong.

3. **This repo has a postmortem about exactly the lock I first reached for**
   (`docs/postmortems/260901f-a-for-update-that-locks-nothing.md`): *"A row lock is taken on rows
   the statement returns, so a `SELECT … FOR UPDATE` that matches nothing locks nothing"* — and a
   free user has **no** billing row to lock. Its prescribed fix is
   `insert … on conflict do nothing` followed by a read-back, and it notes that `on conflict do
   nothing` is only an escape from a concurrent writer **at `read committed`** (at `repeatable
   read` an insert meeting a conflicting row raises `40001` at the insert, and nothing in this
   repo retries `40001`). Transactions in the store are pinned to `READ COMMITTED` explicitly.

4. **There is exactly one place a successful ingest is published**: the `status === "done"` branch
   of `settleIn()` in `src/store/pg-session.ts` (~line 423), already inside a `READ COMMITTED`
   transaction that publishes the article revision and finishes the job row.

5. **Jobs are reader-deletable** (`DELETE /api/jobs/:id`), so a count derived from job rows is
   erasable by the person being counted.

6. Retry is a separate route (`POST /api/jobs/:id/retry`) that builds a fresh request and calls
   `enqueue()` again as a **new job id**, keeping the old row as history. A retry of a failed
   ingest must not charge a second slot.

7. Identity is Supabase Auth; `owner_id uuid` is on every table; there is no local users table.
   Foreign keys into `auth.users` are added in hand-written migrations.

## Design A — what two earlier reviews landed on (and what I now think is wrong)

- An append-only `ingest_events` ledger, written **only on success**, inside the `settleIn`
  publish transaction.
- A durable boolean `counts_as_ingest` column on `jobs`, set only by the authenticated new-ingest
  route, threaded through `EnqueueRequest` → `enqueue()` → the job row, and copied from the old
  job by `retryJob`.
- Admission: take a lock per owner, `count(successful events in period) + count(active jobs where
  counts_as_ingest)`, then admit and create the job **while still holding the lock**.

My objections: the lock has nowhere to live (fact 3 — free users have no row), and holding it
across `enqueue()` deadlocks the pool (fact 2). Also a job wedged in `queued`/`running` pins a
slot indefinitely.

## Design B — what I want to build instead

**One table, doing reservation and ledger at once.** No `counts_as_ingest` column on `jobs` at
all; the existence of a reservation row pointing at a job *is* the provenance.

```sql
create table ingest_events (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null,               -- FK to auth.users, hand-written migration
  job_id       text,                        -- set immediately after enqueue() returns
  reserved_at  timestamptz not null default now(),
  succeeded_at timestamptz,                 -- set in the publish transaction
  released_at  timestamptz,                 -- set when the job fails or is cancelled
  slug         text                         -- diagnostic snapshot only, never an identity
);
```

**Usage for an owner over a half-open period `[start, end)`:**

```sql
select
  count(*) filter (where succeeded_at >= $start and succeeded_at < $end) as used,
  count(*) filter (where succeeded_at is null
                     and released_at is null
                     and reserved_at > now() - interval '6 hours') as inflight
from ingest_events where owner_id = $1;
```

(For the free tier the period is all of time, so the first filter drops the bounds.)

**Admission**, one transaction, one connection, `READ COMMITTED`:

1. `insert into billing_accounts (owner_id) values ($1) on conflict (owner_id) do nothing`
   — so the anchor row always exists, per the postmortem's pattern.
2. `select … from billing_accounts where owner_id = $1 for update` — now guaranteed to lock a row.
3. Read the entitlement off that row (tier, period bounds), and run the usage query above.
4. If `used + inflight >= limit`, return a refusal (no row written).
5. Otherwise `insert into ingest_events (owner_id) values ($1)` and commit.

**Then**, outside the transaction: call `enqueue()`. On success, `update ingest_events set job_id
= $job where id = $reservation`. If `enqueue()` throws, `update … set released_at = now()` in a
`finally`.

**Completion**: in the `settleIn` done branch, `update ingest_events set succeeded_at = now()
where job_id = $1 and succeeded_at is null and released_at is null`. A job with no reservation
(CLI work, a step re-run, seeding) updates zero rows and is therefore free, with no flag anywhere.

**Failure/cancel**: `update ingest_events set released_at = now() where job_id = $1 and
succeeded_at is null`.

**Retry**: re-point the existing reservation at the new job id rather than reserving again — one
statement, and it is why a retry costs nothing.

**Stale reservations** are bounded by the 6-hour clause rather than needing a sweeper: a process
that dies between reserving and enqueueing leaks at most one slot for at most six hours.

### What I claim Design B buys

- The lock target always exists, so the postmortem's class cannot recur.
- One connection per admission — no nesting, no pool deadlock.
- No new column on the hot `jobs` table, no threading through three call sites, no filesystem-twin
  parity problem for a boolean.
- Stuck jobs cannot pin a slot forever.
- A ledger that survives job deletion, which was the whole point of not counting job rows.

## What to attack

- **Is `used + inflight` under a `for update` on `billing_accounts` genuinely enough** to stop N
  barrier-synchronised concurrent requests exceeding the limit? Walk the interleaving. I believe
  every admission for one owner serialises on that row, but say if you see a path around it.
- **The six-hour window.** Is a time-bounded reservation the right call versus a sweeper or versus
  joining `jobs.status`? What is the worst a determined caller can do with it — can they get more
  than the limit *concurrently*, and does that matter given the limit is about spend?
- **`job_id` set after commit** is a window. Is it acceptable, and is there a cheap way to close it
  that does not need `enqueue()` to accept a pre-minted id?
- **Double-counting and lost updates** across the success/release/retry statements — particularly
  a job that is cancelled while its publish transaction is in flight.
- **Is a nullable-timestamp triple (`reserved_at`/`succeeded_at`/`released_at`) the right shape**,
  or should this be one status column with a CHECK? This repo's stated rule is that a nullable
  timestamp beats a boolean where a flag is really an event, and prefers CHECK constraints over
  application-enforced rules.
- Anything about **`billing_accounts` rows existing for free users who will never pay** — I think
  a bare row per owner is fine and it is where comp subscriptions will live, but say if that is a
  mistake.
