# Make the test suite pass reliably

**Status:** in progress, started 2026-09-02.

`npm run typecheck` is clean. `npm test` is not reliably clean: it passed once, then failed twice
in a row on the same tree, with no code change in between. A suite that is green on the third try
is not a gate — it teaches everyone to re-run rather than read
([silent-success.md](../reusable/silent-success.md)).

## The evidence

Three consecutive full runs of `npm test` on a clean `dev` (3804eb4), nothing else running:

| run | result | skipped |
| --- | --- | --- |
| 1, direct | 8893 passed | 7 |
| 2, via `npm run check` | gate FAILED | — |
| 3, direct | 3 failed, 4 files failed, 8511 passed | **411** |

~~The skip count is the loudest number here. Between run 1 and run 3 the same tree skipped 7 tests
and then 411, which means the Postgres/Supabase reachability probes that guard those suites
answered differently on the two runs.~~ **Wrong, and left here struck through because the mistake is
the lesson.** See [The skip count is not a signal](#the-skip-count-is-not-a-signal) below. The stack
was up and healthy throughout — all twelve containers `Up 17 hours (healthy)`, `supabase status`
fine before and after.

Run 3's four failures:

1. `tests/store-parity.test.ts` — `beforeAll` **hook timed out in 300000ms**, in `takeCorpusLock()`.
   145 tests skipped as a result. (The stack frame naming `takeCorpusLock` is *not* what proved that
   — see [the correction](#a-stack-frame-that-is-not-evidence) below.)
2. `tests/store-roundtrip.test.ts` — `Storage get failed (500): An unexpected error occurred`,
   from `src/store/blobs-supabase.ts:104` via `storeRawSource`.
3. `tests/admin-store.test.ts`, two tests — `the Auth service refused the account list (500)`,
   from `src/store/admin-accounts.ts:324`.
4. `tests/retry-is-only-for-a-failed-job.test.ts` — `SyntaxError: Unexpected end of JSON input` at
   `jobsOnDisk`, line 284, parsing a job file off disk.

(2) and (3) are the local Supabase services returning 500 rather than refusing a connection, which
is what a service under load does, not one that is down. (4) is independent of all of it and is a
plain robustness bug in a test helper: the `readFile` there catches a *missing* file and falls back
to `"{}"`, but a file that exists and is half-written parses as a syntax error.

## Stages

- **Stage 1 — diagnose from evidence, not from reading.** Three angles in parallel: the corpus lock
  and its 300s timeout; why auth and storage 500 under suite load (container logs, connection
  counts); why the reachability probes answer differently run to run.
- **Stage 2 — fix what is tractable**, each with a red test first where a test can express it.
- **Stage 3 — GPT Sol review, postmortem, commit and push to `dev`.**

Anything that turns out to need a product call or a real tradeoff gets written up here and left for
Greg rather than guessed at.

## What we are not doing

Not raising timeouts to make red go green. A 300-second hook that times out is not a hook that
needed 400 seconds.

## This was predicted, in writing, the day before

Two of the four failures are not a surprise. The commit that introduced the corpus lock —
`9671fcf`, *"Five suites seeded from the corpus, and the lock is the cost"*, 2026-09-01 — measured
it and said what would happen, and
[260831b-finish-the-database-move.md](260831b-finish-the-database-move.md) records it:

> `loadArticleIntoPg` takes `RUN_LOCK` unconditionally, and it is exactly linear: at sixteen
> concurrent seeds the worst wait is **4.9–6.1 s locked against 1.0–2.0 s unlocked**, because every
> caller queues behind every other *even though none of them shares a slug*. […] one run fits with
> little margin, two concurrent runs nearly do not, and the failure mode is a confident hard timeout
> naming a **sibling** suite.

A confident hard timeout naming a sibling suite is exactly what run 3 produced. The fix is already
chosen there, at sub-stage B item 1: **"Land `serialise: false` for unique-slug seeds as you go."**
So this is landing a decision that has already been made and reviewed, not inventing one.

The skip swing is written down there too, as a known and accepted hazard with a scheduled fix:

> **`pgReady` flips to required.** It currently makes 53 files *skip* without a database; after D
> that would be 100+, so a machine with no Docker would get a green run over a quarter of the suite
> — the exact silent-success class this repo keeps writing postmortems about.

That flip belongs to sub-stage D and is not ours to land here. What *is* ours is the narrower
question of why `pgReady` answers differently twice in ten minutes against a stack that is up.

## The skip count is not a signal

The first thing the diagnosis found was that our reading of the evidence was wrong, so it goes first.

**Vitest reports every test in a file whose `beforeAll` fails as *skipped*.** Proved in isolation: a
three-test suite with a throwing `beforeAll` prints `Test Files 1 failed (1)` / `Tests 3 skipped (3)`.
The arithmetic then closes exactly:

| source | tests |
| --- | --- |
| genuine skips, measured | 7 |
| `store-parity.test.ts`, `beforeAll` timeout in `takeCorpusLock()` | 145 |
| `store-roundtrip.test.ts`, Storage 500 in its `beforeAll` | 263 |
| | **415 ≈ 411** |

So run 3's 411 is run 1's 7 plus two cascade-skipped files. **The probes never fired at all** — zero
`⚠` lines from `pgReady` across a full run and a second run of all 69 pgReady-guarded files packed
together, and a 30-run timing distribution of the probe itself: p50 **27.8 ms**, max **45.7 ms**,
against a `CONNECT_TIMEOUT_MS` of **10 s**. Connections are not tight either: `max_connections=100`,
32 held at rest, peak **53** sampled through the pg-heavy run.

**The number to read is `Test Files … failed`, not the skip count.** A cascade skip and a deliberate
skip are identical in the summary, which is why the wrong story was so easy to believe. That belongs
in [testing.md](../project/testing.md), and this is the whole reason to write it down.

One real gap the probe work did turn up, not today's bug but worth the line: `pg-ready.ts`'s 10 s
budget is `connectionTimeoutMillis` **only**, with no query timeout — a probe that connects and then
hangs hangs the file, at module scope, with nothing to cut it off.

## Cause 2: an Auth 500 that any seeder can cause, for the whole database

Not load. The GoTrue container log says it outright:

```
"error":"unable to fetch records: sql: Scan error on column index 3,
 name \"confirmation_token\": converting NULL to string is unsupported",
 "path":"/admin/users","status":500
```

`auth.users.confirmation_token`, `recovery_token`, `email_change` and `email_change_token_new` are
nullable with no default; the other four token columns default to `''`. **Ten test files hand-roll
`insert into auth.users (…)` and none of them mentions those four columns.** While a single such row
exists, `GET /auth/v1/admin/users` returns 500 for the entire database — so it breaks the dev
server's `/admin` page too, not only the suite.

Reproduced 3/3 by scheduling `admin-store` beside the seeders, and green the moment those rows are
gone. This fires whenever `admin-store` lands in the same shard as a seeder, so it is a common flake
rather than a rare one.

**Fix:** one shared `seedAuthUser()` helper under `tests/helpers/` that sets the four columns to
`''`, and every hand-rolled insert moved onto it. Not an Auth probe added to the guard — that would
turn a real, reproducible defect into a silent skip.

**Landed**, 2026-09-02: `tests/helpers/seed-auth-user.ts` and the ten files moved onto it, with
`tests/auth-user-seeding.test.ts` holding both halves — one test that seeds a row and then asks the
Auth service for the account list, and a grep guard that fails if any other file under `tests/`
writes the insert out by hand. Red first with the four columns taken back out (the exact 500), green
with them in, and the 3/3-failing combination now passes 3/3.

Also confirmed while there: `tests/admin-store.test.ts` guards on **Postgres** reachability
(`tables: ["spideryarn.articles"]`) and then calls the **Auth** service, so an unhealthy GoTrue fails
rather than skips. The file's header records that the `auth.users` `readable` requirement was removed
on 2026-08-28; that removal is what left the guard aimed at the wrong service.

## Cause 3: a test helper reading the writer's temp files

The production writer is already correct — `src/store/jobs-fs.ts:99-102` writes
`${jobFile(id)}.${pid}.${counter}.tmp` and renames, and the production loader filters for it at
`src/store/jobs-fs.ts:218`:

```ts
files = (await readdir(JOBS_DIR)).filter((f) => f.endsWith(".json"));
```

The test helpers have no such filter, so they `JSON.parse` a zero-byte `.tmp` mid-write — which is
exactly `SyntaxError: Unexpected end of JSON input`. The existing `.catch(() => "{}")` covers only
the ENOENT half, which is why it was there and why it did not help.

Six unfiltered sites, three with no `.catch` at all:
`retry-is-only-for-a-failed-job.test.ts:283` and `:313`, `owner-jobs.test.ts:84`,
`jobs-walk.test.ts:254`, `jobs.test.ts:628` and `:1195`, `jobs-commit-path.test.ts:115`.
(`jobs.test.ts:1047` legitimately reads `.tmp` files — it asserts they get cleaned up — and must
keep doing so.)

**Fix:** one shared `jobFilesOnDisk()` under `tests/helpers/`, so the filter cannot drift out of step
with the writer again. No production change. Keep the `.catch`: a `.json` file can still vanish under
a concurrent `forgetJob`.

## Deferred — Greg's call, not ours

- **A local migration defaulting the four `auth.users` token columns to `''`.** It would fix the
  Auth 500 once for everything, including `/admin`, rather than for every insert we remember to
  update. But it writes to the `auth` schema, which Supabase owns and re-creates, so it is a
  decision rather than an obvious fix. The `seedAuthUser()` helper above is the version that needs
  nobody's permission, and it is what this work lands.
- **`REQUIRE_POSTGRES=1` on the `test` step in `scripts/check.ts`.** `pg-ready.ts` already supports
  it and nothing sets it, so 69 files can skip themselves into a green run. Turning it on in the
  gate is one line — but it makes `npm run check` fail on a machine with no Docker, which is a
  policy change about who can run the gate, and `scripts/deploy.ts:424-439` already covers the
  deploy path with its own direct `select 1`.

## Cause 1: a poisoned Kong connection, which is also cause 4

The Storage container never returned a 500 during the run. **Kong did**, at the exact second and URL
the test failed on:

```
07:34:06 [error] upstream timed out (110) while reading response header from upstream,
  request: "GET /storage/v1/object/sources/sha256/5e0eba41….pdf"
07:35:09 [error] [lua] init.lua:310: DNS resolution failed … supabase_storage_spideryarn2
172.18.0.1 - - [02/Sep/2026:07:35:09] "GET /storage/v1/object/…5e0eba41….pdf" 500 46
```

Kong's 500 body is `{"message":"An unexpected error occurred"}` with no `statusCode`, so
`realStatus()` in [`src/store/blobs-supabase.ts:74`](../../src/store/blobs-supabase.ts) falls back to
`res.status` and we report it as a Storage 500. The message we read in the failure is Kong's, word
for word.

**The mechanism, reproduced by probe rather than argued:**

| pattern | hangs |
| --- | --- |
| GET a 219 KB object, repeatedly | 0 / 15 (14–29 ms) |
| POST a **441 B** duplicate, then GET | 0 / 12 |
| `GET /object/info` (head) then GET | **0 / 15** |
| POST a **219 KB** duplicate, then GET the same key | **2 / 3, each 60,022 ms** |
| POST a **219 KB** duplicate, then GET a *different, small* key | **2 / 3, each 60,018 ms** |
| straight to `172.18.0.10:5000`, bypassing Kong | 0 / 5 (10–15 ms) |

So: `storeRawSource` POSTs the bytes; Kong buffers a large body to a temp file; Storage answers
**409 duplicate in ~20 ms without consuming the body**; Kong returns that connection to its keepalive
pool with an unsent body still on it. The *next* request through that connection — any request, any
key, as the fifth row proves — is never answered until `proxy_read_timeout` (60 s) fires. The retry
usually succeeds, so it normally reads as a slow 200; occasionally the retry's DNS lookup fails and
the client gets the 500.

**178 upstream timeouts in the container's 17-hour life — 178 minutes of dead wall clock**, 25 of
them in the hour of the failing run.

**And this is also the corpus-lock timeout.** `tests/helpers/corpus-lock.ts` records that
`store-roundtrip.test.ts` runs for 63 seconds. Add eight 60-second Kong stalls and it runs for nine
minutes — and `store-parity`'s `takeCorpusLock()` sits in its `beforeAll` waiting for it and times
out at 300 s. Two of the four failures, one cause.

**Fix:** in `storeRawSource` ([`src/store/blobs.ts:397`](../../src/store/blobs.ts)), `head(key)` before
uploading. On a hit, skip the POST and go to the existing `get` + hash check; on a miss,
`putIfAbsent` exactly as today. The "head then GET" probe row is 0/15, so it removes the trigger from
the only path that reaches it. `putIfAbsent` still performs every actual write, so the create-only
guarantee and the POST-not-PUT reasoning in that file are untouched, and the head-says-present-then-
vanishes race already has its answer (`get` returns null, `CorruptObject` throws). It is also a plain
win in production: today we push 6 MB of PDF over the wire to be told it is already there.

**What it does not fix, written down because it will bite someone:** this removes our exposure, not
Kong's defect. Any large POST that Storage rejects early — a 415, an oversize upload — still poisons
a connection on the local stack. Supabase cloud does not use this Kong, so it is a local-dev hazard.

## A latent one, not today's bug

`vitest.config.ts` sets no `poolOptions`, so vitest uses the default `forks` pool at
`availableParallelism()` = **16** workers here. `poolMax()` in
[`src/db/client.ts:65`](../../src/db/client.ts) defaults to **5** per process, plus a session `Client`
for each of the two advisory locks. 16 × 5 = 80 on top of a ~50 baseline overshoots
`max_connections = 100`. It has not fired — no `sorry, too many clients already` anywhere in six
hours of `supabase_db` logs — because pools open lazily and most files touch few connections. But it
is one busy run away, and `DATABASE_POOL_MAX=3` for the test run is a cheap belt. Capping vitest
parallelism would be the wrong lever: parallelism broke nothing here, and the Kong stall reproduces
with a single sequential client.

## Cause 4: the corpus lock is waited for on the clock that is meant to time the work

This one is independent of Kong. It reproduces on the first try with no storage stall involved.

`tests/helpers/corpus-lock.ts` is a **Postgres session advisory lock** (key `823117001`) on its own
`pg.Client`, not a file lock — so there is nothing on disk to go stale, and nothing did. Checked
live and repeatedly: no lock file anywhere, `pg_locks` clean before each run, and a session advisory
lock dies with its backend, so a killed worker releases it. `DATABASE_URL` is a direct connection
with no pooler, so the "unlock lands on a different backend" hazard the docstring warns about cannot
bite here. There is no deadlock either: the ordering is corpus outside, run inside, and no
file-scope `RUN_LOCK` holder ever wants the corpus lock.

**The actual shape.** Both `store-parity` and `store-roundtrip` wipe every article's revisions and
reload the whole 35-article corpus through the real write path, so they genuinely must not
interleave. Each takes the lock **inside a `beforeAll` with a 300 s timeout** and releases it in a
file-scope `afterAll` — so the lock is held for the file's entire run, while *the wait for it* is
charged to a single hook's clock.

Measured on this box:

| suite, run alone | wall | corpus-lock hold |
| --- | --- | --- |
| `store-roundtrip.test.ts` | 142 s, 263 passed | 135 s |
| `store-parity.test.ts` | 145 s, 145 passed | 139 s |

Run together, vitest forks them concurrently so **both 300 s clocks start at the same instant**:

- **Run 1: both files FAILED**, `Hook timed out in 300000ms` (300038 ms / 300052 ms). Reproduced
  first try.
- **Run 2: both passed**, 273.78 s — the waiter got the lock after 190 s and finished with **34 s of
  its 300 s left**.

And caught live in a peer agent's ordinary `npm test`, with nothing of ours running: holder released
after 147 s, the waiter acquired, and its connection vanished at age ~293 s — the hook timeout.

**The model:** hold ≈ 150 s per file, so the k-th file in the queue must fit `(k-1) × 150 s` of
waiting *plus* its own 150 s of work inside one 300 s hook. k=1 fits. k=2 *just* fits, with about
10% margin — which is exactly why the same tree passed on run 1 and failed on run 3. k≥3 cannot fit,
so two concurrent `npm test` on this shared box fails deterministically.

**Fix, in two halves, and the second is not optional.** Take the lock at **module scope** rather than
inside the timed hook, following the pattern `tests/helpers/run-lock.ts` already documents:

```ts
const { reachable } = await pgReady({ … });
if (reachable) await takeCorpusLock();   // top level, above the describe
```

The wait then lands in vitest's *import* phase, which has no hook timeout, and each `beforeAll`'s
300 s covers only its own ~150 s of work — a 2× margin instead of 10%. Both files already compute
`reachable` at module scope, so the guard is free.

But that leaves the wait with **no timeout behind it at all**, so `corpus-lock.ts` must at the same
time stop using blocking `pg_advisory_lock` and poll `pg_try_advisory_lock` against a deadline, the
way `takeRunLock` already does, throwing an error that names the waiting file. Its own docstring
already warns that the blocking form "waits for ever rather than reporting". The deadline should be
a real queue depth — ≥ 4 × 150 s ≈ 600 s, i.e. two concurrent `npm test` — not a fudge factor.

### A stack frame that is not evidence

Worth knowing generally, and it nearly sent us the wrong way. Vitest builds a hook-timeout error's
stack from an `Error` created at hook **registration**, so it *always* points at the `beforeAll(`
line whatever inside the hook was slow. Here the wait genuinely was in `takeCorpusLock()`, but the
frame did not prove it — the `pg_locks` sampling did.

### Deferred — Greg's call

**These two suites load the same 35-article corpus twice, ~150 s each — ~300 s of strictly serial
work in a suite that otherwise spreads across 16 cores. The hold grows linearly with `data/`, so any
deadline picked today walks back into the wall as articles are added.** Options: (a) the fix above,
which makes the current shape survive; (b) merge the two files so the corpus loads once and both
sets of assertions run off it, halving the cost and removing the lock's reason to exist between
them; (c) give each suite its own corpus copy so they never contend. (b) is the strongest on the
merits, but it is a real restructure of two large files. This work lands (a) only.

### Debris, not the cause

Two orphaned vitest fork workers, PIDs **1273220** and **1424712**, started 2026-09-01 evening,
re-parented to PID 1 and still alive 14 hours later. Neither holds an advisory lock. They belong to
other agents, so they have been left alone.

## A fifth thing, which is about the box rather than the code

Two full runs during this work failed, and neither failure was real:

| run | files failed | what failed | duration |
| --- | --- | --- | --- |
| A | 2 | `store-comments`, `store-shelf-reads` | 235 s |
| B | 9 | `pdf-chunk-concurrency`, `block-policy-prompts`, `public-network-trace`, … | **454 s** |

No overlap between the two sets, and everything in both passes in isolation. Run B's failures are
mostly `Test timed out in 5000ms` on tests that never touch the database. Both runs happened while
subagents of this same job were running suites of their own, and the duration doubling says the
rest: **`npm test` on this box does not give a trustworthy verdict while anything else is running.**

Two things follow, and only the first is ours:

- **A full-suite result is only evidence if the box was quiet.** Neither of those runs should have
  been read as a regression, and the first nearly was. `store-comments`'s fixture is not on disk, so
  the corpus suites could not have touched it — that is what ruled it out, not the re-run.
- **This is the case for the worktree-per-agent work already in `CLAUDE.md`.** Several agents sharing
  one checkout, one Supabase and one dev server is exactly what produced these two red runs and the
  hour spent reading them.

The final verdict below was taken on a quiet box, deliberately.

## What GPT Sol found, and what changed because of it

The review's verdict was **"I would not merge as-is"**, and it was right. Its finding was the one
worth having: *"the new lock and job-file tests introduce fresh intermittent-failure paths."* We had
written new flakiness into the fix for flakiness.

| # | finding | what we did |
| --- | --- | --- |
| 1 | **High.** The corpus-lock test could acquire and leak the **real** production key: if a genuine suite released mid-window, `takeCorpusLock()` succeeded instead of rejecting, and the `finally` neither unlocked nor closed the client — blocking every other corpus suite until that worker exited. | Rewritten on a per-run injectable test key in `[1e9, 2e9)`; rival ownership *asserted* rather than hoped for; defensive release in every `finally`. It cannot touch `823117001`. |
| 2 | **High.** The advertised 600 s deadline was not one: no timeout on `connect()` or on any `query()`, the clock started only after connecting, and it was checked only after a query returned — so a stall hung module collection for ever, the exact failure the change claimed to prevent. Plus leaks on a failed poll and on a failed release. | Deadline starts before `connect()` and is checked before each attempt and each sleep; connect and query timeouts; the whole loop in `try`/`finally` that always closes; `releaseCorpusLock` unlocks in `try` and ends in `finally`. |
| 3 | **Medium.** `jobFilesOnDisk()` turned every filesystem error into "nothing there" — `EACCES`, `EIO` and all — so an assertion could pass because the directory was unreadable. Silent success, inside the helper written to fix a silent success. | Only `ENOENT` is caught; everything else propagates, which is what production does and what the comment now says. |
| 4 | **Medium.** The new job-file test used fixed paths, so two concurrent runs collide. | Fixture id minted per run, following `ba6882a`, with an age-limited sweep — sweeping the prefix outright would delete a live peer's fixture. |
| 5 | **Low.** The auth guard's regex missed `insert into "auth"."users"` and spaced-dot forms. | Widened to the same shape as `AUTH_SCHEMA` in `tests/auth-users-fence.test.ts`, with ten cases pinning six caught spellings and four left alone. |

Sol also confirmed the things most worth confirming: the `head` fast path preserves create-only
semantics with no new integrity TOCTOU; failing on a `head` 503 is *preferable* to falling through
to the POST, because a fallback cannot tell absence from outage and would reintroduce the poisoned
connection; `"execute" in target` soundly discriminates the two drivers and there is no injection
path; and top-level `await` is sound under this vitest config. It called both deferrals reasonable.
Two comments it flagged as wrong — four takers implying four preceding holds, and polling implying a
queue — were corrected, and `corpus-lock.ts` now says outright that it is not FIFO and a waiter can
be starved.

## And the same defects, in the helper twelve files depend on

Fixing cause 4 turned up that **`tests/helpers/run-lock.ts` had all four of finding 2's defects** —
no connect or query timeout, deadline checked after the attempt, a leak on a failed poll, and a
`release()` that marks itself released before unlocking, so a failed unlock keeps the key while the
backend sits there holding it.

Its exposure is larger, not smaller: `takeRunLock` is taken at **module scope in twelve files**, so
an unbounded `pool.connect()` hangs the import phase exactly as it did for the corpus lock. Its
budget is shorter (120 s) and its holds are brief, which is why it had not fired yet.

It is fixed here rather than filed, because filing it is precisely what this postmortem is about.
The pool stays `max: 1` with the client checked out from take to release, so the unlock provably
lands on the backend that took the lock; every failure path uses `client.release(true)` to destroy
rather than return the connection.

**One deviation worth a reader's eye:** `query_timeout` sits on the connection, so it is inherited by
the four suites that use the exposed `lock.client` for their own setup. Ten seconds is many times
what any of those statements takes, and this connection lives in the import phase where nothing else
would time it out — but it is a real difference from `corpus-lock.ts`, which never exposes its
client. It is documented on `HeldRunLock.client`.

## What the final gate found, and what it was

The gate on a quiet box came back `test FAILED` with three failures. All three are **pre-existing
contention**, none attributable to this work, and the evidence says so specifically rather than by
assertion. Two of the three reproduce with a single suite running, and all three concern tables and
columns the corpus lock has never covered — `articles.opens`, `glossary_lookups`, `jobs.status`.

**1. `lists the same articles` — a counter the running app increments.** The `toEqual` diff is two
fields on one article:

```
-  "lastOpenedAt": "2026-09-01T19:50:37.833Z",   "opens": 169,   ← from files
+  "lastOpenedAt": "2026-09-02T09:17:58.373Z",   "opens": 170,   ← from Postgres
```

`seedShelfFromFiles` writes `data/fowler-phrenology/shelf.json`'s values onto the row in `beforeAll`;
then `pgShelfStore.recordOpen` ([`src/store/pg-shelf.ts:113`](../../src/store/pg-shelf.ts)) runs via
`POST /api/library/:slug/open`. **No test calls it for that slug.** Two dev servers are running on
this box with `SPIDERYARN_STORE=postgres` against the same database, and peers are driving browsers
at them. `shelf.json` has been frozen since the dev servers went Postgres-only, so the gap only
widens. Fixed by excluding the two fields from `comparable()` — as `addedAt` and `url` already are,
for the same reason — and asserting the true invariant instead: `opens` and `lastOpenedAt` may only
go **up**.

**2. `agrees about glossary` — an assertion inheriting state it does not own.** Postgres carried a
`glossary_lookups` row on entry `spya-uup6nt` whose text exists only in
`tests/fixtures/data-root/data/writes/glossary-lookups.json`. `store-parity` seeds shelf and comments
and **never seeds or clears `glossary_lookups`**, so the assertion was decided by whichever suite
wrote that table last. Proven three ways: it failed with store-parity alone; running `store-roundtrip`
alone replaced the row and store-parity then passed; two minutes later the fixture row was back and it
failed again. Fixed by seeding what it compares.

**3. `store-jobs-parity` — `expected 'busy' to be 'claimed'`.** `claim` counts
`count(*) from jobs where status = 'running'` across **all owners**
([`src/store/pg-jobs.ts:472`](../../src/store/pg-jobs.ts)), and a peer agent was running a full
`npm test` from the `concurrent-migrations` worktree against this same database. `loadArticleIntoPg`
defaults to `serialise: false` and inserts `status: 'running'` directly, bypassing both `RUN_LOCK`
and the cap, so a peer's seeds make our cap tests read `busy`. Alone, the suite passes.

### Deferred — Greg's call

**The global job cap is genuinely global, and a peer's running job is a legitimate running job.**
Nothing in the test can distinguish it. The fix is either not sharing one database between agents
(the worktree work) or scoping the count, and both are decisions rather than repairs. So: **this
suite still goes red whenever a peer suite or a dev server has a job running**, and that is the
honest state of it.

### One cost of the lock move, recorded

`store-parity` now holds `CORPUS_LOCK` from import to `afterAll` rather than from `beforeAll`, so
peers wait marginally longer for it. That is a cost, not a cause, and the 600 s deadline has ample
room — but it is a real change and belongs written down.

## Round two of the review, and a regression we had introduced

Sol's second verdict was again **"I would not merge as-is"**, and its high finding was ours:

> Every acquired global lock needs an outer `try/finally` whose final action is release. Module-scope
> setup also needs to release in its `catch`, because the teardown hook has not yet been registered.
> […] This makes the connection-wide `query_timeout` unsafe as currently integrated.

**We made a latent leak live.** Several suites take `RUN_LOCK` and then run their own setup queries
on the exposed `lock.client` *before* registering teardown. Our new 10 s connection-wide
`query_timeout` is inherited by those queries — so a slow setup query now **throws** where it used to
hang, the import rejects, and nothing releases the global lock, because no teardown hook exists yet.
A helper made safe in isolation made its callers less safe.

The fix is the lifecycle, not the timeout: Sol is explicit that once every acquisition has an outer
`try`/`finally`, keeping the inherited 10 s timeout is right and better than unbounded import-phase
hangs. So the timeout stays, and `takeRunLockAndSetUp` is now the thing designed to survive it.

**What landed:** one small helper beside the two lock helpers, `tests/helpers/lock-lifecycle.ts`,
with two functions rather than one because the two windows genuinely differ — setup releases *only*
on failure, since on success it must hand the lock onward; teardown releases *always*. `release` is
passed as a thunk, so one shape serves both keys.

Five callers had a real hole and were fixed; **nine were checked and left alone**, having nothing
between the take and the `afterAll` registration. `tests/store-parity.test.ts` needed nothing, and
`scripts/db-seed-dev.ts` — a peer's uncommitted file — already releases in a `finally`.

The reproduction is the part worth keeping: `tests/lock-lifecycle.test.ts` asks **Postgres**
(`pg_locks`) whether the key is still held, not the helper. Three of its four cases were red before
the fix, with `expected 1 to be +0`.

### A residual hole, recorded rather than closed

For the nine callers left alone the `afterAll` *is* registered — but **vitest never runs file-level
hooks for a module that failed to evaluate**, so a throw in any later module-scope statement would
still leak the key. None of those nine has fallible module-scope work after the registration today,
so it is latent rather than live. Closing it would mean restructuring nine healthy files, which is
not worth it now — but it is the same class, and the next person to add a module-scope statement to
one of them should know.

### The rest of round two

- **The deadline was bounded, not hard** — `>` rather than `>=`, and a poll begun just before the
  deadline could return up to ten seconds later and still be accepted, so "600 s" was really ~610 s.
- **`corpus-lock.ts` documented the opposite lock order from the code** — it told future callers to
  take run first, corpus second, while parity, roundtrip and `db-seed-dev` all do corpus outside, run
  inside. Not cosmetic: following it would create the very cycle both helpers warn about.
- **The already-held guard goes in after all.** The argument against it was wrong: sequential takes
  stay valid because `release()` clears `heldByThisProcess`, so the guard only rejects an
  *overlapping* direct `takeRunLock()` — which today waits 120 s for its own process instead of
  failing fast. (Sol agreed on the other omission: no `pool.on("error")` handler, because a no-op one
  could let tests continue after silently losing the lock.)
- **Counts that will rot**: twelve module-scope callers was wrong, it is fourteen; and the corpus
  timeout message claimed only two callers when `scripts/db-seed-dev.ts` takes it too.

### Sol on a deferral, and it changed our recommendation

Sol **would not defer `REQUIRE_POSTGRES=1`**:

> I would not defer this from the command whose green result is quoted as evidence. Otherwise
> `npm run check` can still succeed while the database suites decline to run — the exact
> silent-success class this change addresses. An explicit offline check command would preserve
> no-Docker use without weakening the real gate.

That is a better answer than ours, because it solves the objection instead of trading against it.
Still Greg's call, but the recommendation is now *do it*, with a separate offline command for a
machine without Docker.

Sol also confirmed: the monotonic shelf assertion is the right trade; the unlock provably lands on
the backend that took the lock; and **do not** scope the production job count merely to quiet
`store-jobs-parity` — database isolation is the honest fix.

### How round two was settled

**The deadline: bounded, and said so, rather than made hard.** Enforcing a hard deadline means
re-checking the clock after the query returns and then **unlocking a key we have just been granted**
— inventing a new way for a suite that genuinely held the lock to fail at module scope, to buy about
ten seconds of punctuality. The deadline's job is *never hang in silence, always name the file*, and
`waitMs` plus one query timeout already delivers that. So:

- `Date.now() >= deadline` in both helpers, which is the half of hardening that costs nothing: no
  attempt can now *begin* past the deadline, and `waitMs: 0` can never acquire a free key on a fast
  tick (the test previously leaned on "connecting takes at least a millisecond" — true, but not a
  guarantee).
- Both headers now say plainly that `waitMs` is a **bounded wait, not a hard deadline**: worst case
  ≈ `max(waitMs, CONNECT_TIMEOUT_MS)` + one `QUERY_TIMEOUT_MS`, so 120 s of budget is 130 s of wall
  clock and 600 s is ~610 s. Written down and attributed, so the next reader does not "fix" it by
  accident.

**A polling-query timeout is now actually exercised**, which nothing did before — the old test only
provoked an immediate SQL error with a bad key. The new case puts a TCP proxy in front of the
database that forwards startup and auth, so `connect()` genuinely succeeds, then **drops the first
`Parse` message** rather than forwarding it: the helper waits on a statement the server never
received, `query_timeout` fires for real, and no lock is taken upstream. It runs in ~400 ms.

**Poll-query errors are now wrapped in both helpers**, so a failed take always names the waiting file
as the headers promise, with the raw error kept as `cause`.

**Counts were replaced with descriptions.** Rather than write "fourteen" and let it rot the way
"twelve" did, the claims now describe the set and say `grep -rn takeRunLock tests/`. The one number
that was a genuine measurement is re-dated as a historical reading rather than a running total.

## The verdict, and the one failure left

Final `npm run check` on a quiet box:

```
  ✓ typecheck    clean
  ✗ test         FAILED  — 1 failed | 8978 passed | 7 skipped (8986)
  ✓ build        clean
  ✓ cycles       clean
```

Down from the four failures and 411 cascade-skips this started with, and the suite now runs in
**123.91 s** rather than 235 s or 454 s. The one remaining failure is **not ours, and it is deferred
rather than fixed**:

```
FAIL tests/library.test.ts > listArticles > gives every entry the counts a card needs
MalformedJson: data/test-reader-state-parity/blocks.json is not valid JSON: it is empty
 ❯ describeDir src/api.ts:1226 ❯ listArticles src/api.ts:1365
```

`test-reader-state-parity` is a scratch article that `tests/store-reader-state-parity.test.ts` creates
and tears down; `library.test.ts` scanned `data/` while it was half-built. It passes alone (15/15),
and the directory no longer exists.

**Why this is deferred and not fixed.** The throw is inside `listArticles` — production code — not in
an assertion, so a filter in the test cannot reach it. Making `listArticles` skip an article whose
JSON will not parse is a **product decision**: today a corrupt article makes the library page fail
loudly, and afterwards it would quietly vanish from the shelf. Which of those Greg wants is not ours
to pick.

It is also already known and already sentenced. `tests/store-shelf-reads.test.ts` hit this same slug
and solved its own version by filtering `test-` fixtures — *"`test-reader-state-parity` cost a run
before the filter went from this file's own prefix to every fixture's"* — and
[260831b](260831b-finish-the-database-move.md) § B′ has this half of `library.test.ts` marked for
deletion, with a line that is hard to improve on now that it has fired:

> `library.test.ts`'s `listArticles` half tests a half-built directory falling back to mtime —
> **there is no Postgres equivalent because Postgres cannot have a half-built directory.** That is
> the migration working, not a gap.

## Honest state of the suite

- `npm test` is **much** more reliable than it was, and every failure it had is either fixed or
  explained with evidence.
- It is **not** reliable while another agent runs a suite, a dev server, or a browser against the
  same database and the same `data/`. Two of the failures investigated here were purely that, and
  one nearly got read as a regression.
- `tests/store-jobs-parity.test.ts` still goes red whenever a peer has a running job, because the
  job cap is genuinely global. Deferred.
- `tests/library.test.ts` still goes red if it scans `data/` while a peer builds a fixture. Deferred.

**And the obvious fix for that class is blocked, which we did not know when we wrote the line above.**
A database per worktree was not merely deferred — it was considered and rejected, and
[worktrees.md § The database: one stack, and a lease](../project/worktrees.md) records why:

> One shared local Supabase, with a lease, for v1 — and a stack per worktree later if it earns it.

RAM is not the blocker (~1.16 GB for an idle stack). **Eleven foreign keys point at `auth.users`**, so
a fresh per-worktree database has no populated `auth` schema and the migrations fail; a template copy
cannot fix it either, because Postgres cannot enforce a cross-database foreign key. A schema-level
boundary was considered and rejected for the same reason. Four worktrees exist, and
`.worktreeinclude` copies the *same* `.env.local` into each, so they all point at the one stack on
port 54362 — by design.

The chosen mitigation is a **lease**, not isolation. `db:migrate` already takes an advisory lock, but
that covers migrator-vs-migrator only — not migrate-vs-running-suite, and not `db:reset`. That gap is
tracked separately as `260902c-concurrent-migrations-across-worktrees`.

So the honest statement is: **these two failures have no cheap fix available today.** They are the
cost of one shared database, the sharing is deliberate, and the thing that would end it is blocked on
the `auth.users` foreign keys rather than on anybody's time.
