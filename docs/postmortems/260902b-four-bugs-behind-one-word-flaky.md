# Four bugs behind one word, "flaky"

`npm test` passed, then failed, then failed, on the same tree with no code change in between. The
word for that is "flaky", and the word is the bug: it names a property of the suite and so stops
anyone looking for a cause. There were **four causes**, all real, and one of them was a live
production defect that had nothing to do with tests.

Full evidence and the fixes: [260902c-make-the-test-suite-pass-reliably.md](../plans/260902c-make-the-test-suite-pass-reliably.md).

## What broke

| # | cause | where it really lived |
| --- | --- | --- |
| 1 | A large POST that Storage 409s without reading the body poisons a Kong keepalive connection; the next request through it waits out a 60 s timeout | `src/store/blobs.ts` — **production** |
| 2 | Four `auth.users` token columns are nullable with no default; one NULL row 500s `GET /auth/v1/admin/users` for the whole database | ten test files, and **the dev server's `/admin` page** |
| 3 | Test helpers `readdir` the jobs directory without the `.json` filter the production loader has, and `JSON.parse` a temp file mid-write | six test helpers |
| 4 | `takeCorpusLock()` was called inside a `beforeAll` whose 300 s timeout was meant to cover the work, not the wait | two test files |

## The class

**A summary that cannot distinguish "did not run" from "passed" — and a word that closes the
question before it is asked.**

Two halves, and they need each other. The output has to be ambiguous, *and* there has to be a name
for the ambiguity that sounds like an explanation. "Flaky" is that name. It turns *"why did this
fail?"* into *"it's one of those"*, and it gets applied to a whole suite on the evidence of a single
re-run.

Every instance of this class looks the same from outside: a re-run makes it go away, so nobody
divides by cause, so several unrelated bugs accumulate behind one label and are counted as one
annoyance. Four of them here. Each could have been found on the day it started.

## The root cause, which is none of those four

**Nothing in the suite's output distinguishes "this did not run" from "this passed".**

The clearest proof is the number we chased first and were wrong about. Between the passing run and
the failing one, the skip count went from **7 to 411**, and we read that as the Postgres reachability
probes answering differently. It was not. Vitest reports every test in a file whose `beforeAll` fails
as *skipped*, so 411 was 7 genuine skips plus 145 and 263 from two cascade-failed files. The probes
never fired at all — measured afterwards at p50 **27.8 ms** against a 10 s budget.

So a cascade skip and a deliberate skip are the same word in the summary, and a suite can go green
over a quarter of itself not running. That is [silent-success](../reusable/silent-success.md) in the
place it does the most damage, because it is the thing that decides whether everything else is
believed.

Two smaller instances of the same shape sit underneath it. `pg-ready.ts` supports
`REQUIRE_POSTGRES=1`, which turns a skip into a failure, and **nothing sets it** — so 69 files can
excuse themselves and the run still reports success. And a vitest hook-timeout stack is built from an
`Error` created at hook *registration*, so it always names the `beforeAll(` line whatever inside the
hook was slow: the frame that said `takeCorpusLock` was not evidence that the time went there. It
happened to be right. Sampling `pg_locks` is what actually proved it.

## Which commit introduced it

Cause 4 was **predicted in writing, the day before it fired**, by the commit that created the lock —
`9671fcf`, *"Five suites seeded from the corpus, and the lock is the cost"*, 2026-09-01, and recorded
in [260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md):

> at sixteen concurrent seeds the worst wait is 4.9–6.1 s locked against 1.0–2.0 s unlocked […] one
> run fits with little margin, two concurrent runs nearly do not, and the failure mode is a confident
> hard timeout naming a **sibling** suite.

A confident hard timeout naming a sibling suite is exactly what arrived. The measurement was right,
the prediction was right, the fix was named — *"Land `serialise: false` for unique-slug seeds as you
go"* — and the work shipped without it. **Writing the hazard down is not the same as fixing it**
([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)). This is that doc's
own thesis, demonstrated at a day's remove.

Causes 2 and 3 have no single introducing commit, which is itself the finding: each is a statement
copied by hand into ten and six places respectively. Neither copy was wrong when written; the
schema's defaults and the writer's temp-file naming moved underneath them, and nothing was holding
the copies together.

## The fix that is right for the long term

Each cause got the fix that removes its class, not its instance:

- **1** — `head` before upload, so the only path that could poison a connection no longer takes it.
  Also 6× faster: `store-roundtrip` 139.80 s → 22.12 s.
- **2** — one `seedAuthUser()` helper, **plus a guard test that fails if anything in `tests/` writes
  that insert by hand again.** The guard is what makes it durable; without it this returns with the
  next suite that needs an owner.
- **3** — one `jobFilesOnDisk()` helper, with the filter in a single place and a comment naming the
  production file it must stay in step with.
- **4** — the wait moved to the import phase, which has no hook timeout, **and** the blocking
  `pg_advisory_lock` replaced by a polled `pg_try_advisory_lock` with a deadline that throws naming
  the waiting suite. The second half is not optional: moving a wait somewhere with no timeout behind
  it trades a loud failure for a silent hang.

## What would have caught the whole class — and the uncomfortable part

**It was already written down. All of it. And that did not work.**

[testing.md](../project/testing.md) has a section called *"A failed `beforeAll` reports its tests as
skipped"*, from a previous instance of the same confusion, and it ends:

> **Read `Test Files` as well as `Tests`.** `Test Files n failed` with fewer failed tests than failed
> files means a suite died in setup.

That is precisely the mistake made here, against a doc that names it, in a repo whose `CLAUDE.md`
points at that doc. The same file also documents `REQUIRE_POSTGRES=1` in full, under *"When a skip is
not acceptable"*, and says where to use it:

> Use it wherever a green run is about to be quoted as evidence — CI, the remote box […] and any time
> you are about to tell somebody the tests passed.

So the prevention cannot be another paragraph. The knowledge was correct, complete, well written, and
in the right file, and the failure still happened — because reading a summary line is a reflex and
a doc is not. **The only prevention that works here is mechanical.**

The one line that is actually load-bearing:

**Set `REQUIRE_POSTGRES=1` on the `test` step in [`scripts/check.ts`](../../scripts/check.ts).**
`npm run check` is the command whose whole purpose is to be quoted as evidence — it is exactly the
case testing.md says to use the flag for, and it is the one place the flag is not used. Left as it
is, the gate can report green over 69 files that declined to run. It is deferred to Greg only because
it makes the gate fail on a machine with no Docker, which is a policy question about who may run the
gate — not because it is the wrong thing. **If one thing from this postmortem gets done, it is this
one.**

One further note landed with this work, because it is new rather than a restatement: **a vitest
hook-timeout stack frame is not evidence of where the time went** — the error is built at hook
registration, so it always names the `beforeAll(` line. Sample the resource itself.

And the general one, which is the reason this file exists rather than a line in the plan: **"flaky"
is not a diagnosis.** Three of these four were deterministic given their trigger — a duplicate large
upload, an auth row with a NULL, a suite scheduled second. Only the scheduling was random, and
randomness in *when* a bug fires is not randomness in *whether* it is a bug.

## What to do, easiest and most valuable first

| do this | effort | what it buys |
| --- | --- | --- |
| **`REQUIRE_POSTGRES=1` on the `test` step in [`scripts/check.ts`](../../scripts/check.ts)** | one line | The gate stops being able to report green over 69 files that declined to run. **Deferred to Greg** — it makes `check` fail on a machine without Docker. |
| **Default the four `auth.users` token columns to `''`** | one migration | Kills cause 2 at the source, for the dev server's `/admin` as well as for the suite. **Deferred to Greg** — it writes to Supabase's own `auth` schema. |
| **Apply the corpus-lock robustness fix to `tests/helpers/run-lock.ts`** | a copy of work already done | The same four defects — no connect/query timeout, deadline checked late, leaks on a failed poll and on a failed release — in a helper taken at module scope by **twelve** files rather than two. Landed with this work. |
| **Isolate agents from each other's database** | **blocked, not merely unscheduled** | Two full runs during this work went red purely from peers on the box, and one nearly got read as a regression. But a database per worktree was considered and rejected — eleven foreign keys to `auth.users` mean a fresh database has no `auth` schema, and a cross-database FK cannot be enforced ([worktrees.md](../project/worktrees.md)). The interim answer is a lease, and it does not yet cover migrate-vs-suite or `db:reset`. |
| **Merge the two corpus suites** | a real restructure | Halves ~300 s of strictly serial work and removes the lock's reason to exist between them. **Deferred to Greg.** |

The first two decide whether this class can recur. The rest are worth doing and would not, on their
own, have caught it.
