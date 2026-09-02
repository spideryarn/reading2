## 1. Which design

Choose Design B’s reservation-ledger architecture, but not B as written. A’s pool deadlock is real: with five admissions, five outer transactions can hold all five connections—four may be waiting for the same owner lock—while the lock holder calls `enqueue()` and waits for a sixth connection. B’s admission mutex is sound: T1 locks the owner, counts, inserts R1, commits; T2 then acquires the lock, and its next `READ COMMITTED` statement sees R1. When the anchor is initially absent, T2’s `INSERT … ON CONFLICT DO NOTHING` waits for T1 and then reads the committed row. Thus N barrier-synchronised admissions admit at most the remaining capacity, provided every admission and retry uses this lock.

## 2. Outright broken

1. **The six-hour condition directly bypasses the quota.** With limit 100, create 100 jobs that remain queued/running for six hours, then create another 100. All 200 can later succeed in the same period. This can be repeated in cohorts. A global worker cap makes it easier to age queued jobs; it does not protect total spend.

   Attached work must count until actual success, failure, or cancellation:

   ```sql
   count(*) filter (
     where succeeded_at is null
       and released_at is null
   ) as inflight
   ```

   A TTL may apply only to a reservation proven never to have produced a job—and enqueue must reject an expired reservation if an old request resumes. For v1, an indefinitely leaked orphan is safer than a bypass.

2. **Attaching `job_id` after `enqueue()` is not safe.**

   - Reserve R; `enqueue()` inserts J and starts its pump; J publishes before the attachment update; settlement updates zero rows. R is attached too late.
   - Or the process dies after inserting J but before attachment. J remains runnable but uncharged.
   - Two duplicate Adds reserve R1 and R2; `enqueue()` returns the same existing J to both; both rows acquire `job_id = J`; one publication marks both successful.

   At minimum this needs:

   ```sql
   create unique index ingest_events_one_job
     on ingest_events(job_id)
     where job_id is not null;
   ```

   But uniqueness only turns double-charging into an error; it does not close the publication/crash gap.

3. **Retry repointing is internally inconsistent.**

   - Leave `released_at` set: retry success matches zero rows and is free.
   - Clear it without admission: failed A releases its slot; other ingests fill the quota; retry A reactivates outside the lock, producing `limit + 1`.
   - Repointing erases the mapping from the previous attempt, so later retries of older failed jobs cannot reliably find their lineage.

   A retry that can incur spend must reacquire capacity under the same owner lock. “Not charged twice” means there is at most one eventual success in the lineage; it does not mean retries bypass admission.

4. **Release cannot happen when cancellation is requested.** This code intentionally permits a Stop during the last step to finish as `done`. The bad interleaving is:

   1. `/cancel` sets `cancelling`.
   2. Separate code sets `released_at`.
   3. The publication transaction wins the job fence and publishes.
   4. Its success update matches zero because the reservation is released.

   Release only on an authoritative terminal `error`/`cancelled` transition. Success/release must be in the same transaction as that terminal job transition—including immediate queued/lapsed cancellation and expiry settlement. Conditional competing updates merely make the first writer win; they do not ensure the correct outcome wins.

## 3. Real hazards but survivable, ranked

1. **Successful-ingest quota is not a complete model-spend boundary.** A caller who can cause expensive ingests to fail can repeat forever because each failure releases capacity. A small daily attempt/failure cap may eventually be necessary; this affects both designs.

2. **Fail-closed leaks.** A crash between reservation and job creation can pin a slot. Prefer that over expiry-based bypass. Add conservative reconciliation later, releasing only reservations proven to have no live job.

3. **Lock waits consume pool connections, though they do not deadlock B.** The lock holder needs no second connection, so it eventually commits. Keep Stripe/network calls and helpers that open their own transactions outside this transaction; otherwise the old pool problem returns.

4. **The timestamp shape is good; add constraints rather than a status column.**

   ```sql
   check (num_nonnulls(succeeded_at, released_at) <= 1)
   ```

   Optionally also constrain terminal timestamps to be no earlier than `reserved_at`. A status column duplicates information and creates another disagreement state. Use `statement_timestamp()` or `clock_timestamp()` for decisions made after potentially waiting on the owner lock; `now()` is transaction-start time.

A lazily created `billing_accounts` row for every ingesting free owner is fine. Make `owner_id` the primary key and never delete/recreate these rows casually; they are now both entitlement state and a security mutex.

## 4. The simpler thing missed

Put a nullable stable `ingest_event_id` on `jobs`, not a boolean and not a mutable `ingest_events.job_id`. Create the event under the owner lock, pass its ID into `enqueue()`, and store it atomically with the job insert. Every retry copies the same event ID and must reacquire its reservation under the owner lock. Settlement updates by that ID and asserts exactly one row for quota-bearing jobs; CLI/re-run jobs have `NULL` and intentionally update none.

That one provenance column closes the fast-completion gap, crash gap, retry-lineage loss, and duplicate-job double-counting. Avoiding it has recreated those problems in lifecycle code.