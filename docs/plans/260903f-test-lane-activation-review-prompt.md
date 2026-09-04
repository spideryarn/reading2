# Review: stage T-D — activating the private test lane

You are reviewing built code, not a plan. Weight this higher than a plan-stage review: a plan review
cannot catch a test configuration that runs fewer files than before and reports green.

## Why this stage is different from the four before it

Stages A, B0, T-B and T-C were deliberately invisible — new files, new guards, everything behind
`SPIDERYARN_TEST_DB_FACTORY=1`. **T-D is the one that changes `npm test` for every agent and every
worktree on a shared box.** If it is wrong, it is wrong for everybody, immediately, and the
characteristic failure is not a red suite — it is a green one that tested less than it used to.

## What was built

`npm test` now runs three disjoint vitest projects, with membership derived from `TEST_LANES` in
`tests/store-migration-registry.ts` rather than written out a second time:

| project | files | database |
|---|---|---|
| `private-postgres` | the lane manifest's private entries | one database minted per run, dropped after |
| `shared-services` | four files bound to a Supabase service | the stack's own `postgres` |
| `unit` | everything else | none — `DATABASE_URL` is **poisoned** |

## The context you need: why the poison exists

T-C's lane manifest is a **syntactic** guard. It reads each test file's text and assigns a lane to
anything calling `pgReady(` or constructing a `pg` `Pool`/`Client`. It cannot see an aliased
constructor, a helper of the file's own, a dynamic `import()`, or a transitive `getDb()` inside
application code. A file that escapes it lands in `unit`, reaches the shared `postgres`, and
**passes** — the check shares its assumption with the thing it checks.

Poisoning `DATABASE_URL` is the semantic backstop. GPT Sol required it as an obligation on T-D in the
T-C review, and it earned its place on the first full run by catching `tests/health.test.ts`, which
reaches Postgres through the health handler's own `getDb()` with none of the syntax the scan looks
for.

## The trap this stage is built around, measured rather than read

`src/env.ts` snapshots `process.env` **at its own module load** and then lets `.env.local` beat the
shell — except where the current value differs from that snapshot, which it reads as "this process
meant it". Measured three ways on 2026-09-04:

| where the assignment goes | result |
|---|---|
| after the static import, after `loadEnvLocal()` | poison survives |
| after the static import, before `loadEnvLocal()` | poison survives |
| **before `src/env.ts` is loaded** | **poison erased** — the control read back the real URL and connected to the shared database |

**And it is silent.** `src/env.ts` prints a line when `.env.local` shadows an inherited value, gated
on `NODE_ENV !== "test"`. Vitest sets `NODE_ENV=test`. Under the runner the overwrite says nothing
at all. That is why the controls assert a *connection*, never a string.

The same row-three shape is what `DATABASE_URL=… npx vitest` does, which is worth knowing
independently.

## What the reviewer before you got wrong, so you can calibrate

260903e's spike setup had a "positive control" that could never have failed. It opened its own
connection **on the URL string it had just been handed**, then asked that connection
`current_database()` and compared it to the name parsed from the same string. Its docstring argued
the correct principle — *"the name in a URL we set ourselves cannot tell us which database the suite
actually reached"* — directly above code that did exactly that. It was found by mutation, not by
reading, and the reviewing agent (me) had repeated the docstring's claim as though verified.

**Assume there is another one of these.** Controls in this diff that look right may be tautologies.
For each one, ask what value it reads and where that value came from.

## What I verified myself, so you need not re-derive it

- **The poison control fails when broken.** Mutating `unit-no-database.ts` to load `src/env.ts`
  after the assignment: 2 of 3 tests fail, and the connection case *actually connected to the shared
  database* (`postgresql://postgres:…@127.0.0.1:54362/postgres`). File restored.
- **No test file was dropped.** `vitest list --filesOnly` before and after, against the same file
  tree with only the config differing: 626 → 626, and the **set difference is empty in both
  directions**. Not a matching total — a set comparison, because a file whose tests all become
  conditionally skipped would keep a total looking right.
- **No leaked databases**, before or after.

## What I want from you, in priority order

1. **Is any control in this diff a tautology?** See above. Especially `private-db.ts`'s
   `current_database()` check, `shared-db.ts`'s identity check, and the lease assertion.
2. **Can a file reach the shared `postgres` from the `unit` project anyway?** The poison is one
   variable. Is there another route — a hardcoded URL, a Supabase client reading a different env
   var, a connection opened before the setup file runs?
3. **`LANES_BEYOND_THE_SCAN` is a declared hole in the completeness guard.** It is policed four ways
   (the file exists, it has a lane, it is *still* invisible to the scan, its reason is long enough).
   Is that enough, and is "still invisible" the right staleness check?
4. **The private lane is serialised** (`fileParallelism: false`). Is the serialisation actually
   achieved by that setting given `isolate: true` and `maxWorkers: 1` — and is there a collision it
   would not prevent?
5. **Teardown.** The database is dropped with FORCE on teardown, and a lease connection protects it
   from a peer's scavenger meanwhile. What happens on SIGKILL, on a failure between mint and
   `provide`, and if two runs start within the same millisecond?
6. **Does `docs/project/testing.md` describe the config as built, or as intended?** This plan has
   caught four counts and two docstrings that outlived their subject inside a single day.

## The cost, which is real and which I am not hiding

Wall clock went from **267s to 436–471s** across three runs — 1.6–1.8×. All of it is the serialised
private lane: unit and shared finish in ~130s, then ~90 files run one at a time. A *filtered* run
pays nothing and mints no database. Serialising is what 260903e chose for v1 and per-worker
databases are its stage G. **I am keeping it**, because the baseline it replaces was
nondeterministically red — two runs of an unchanged tree failed 6 and 31 files, in disjoint sets —
and three minutes is cheaper than one re-run of a suite nobody trusts. Tell me if you think that
trade is wrong.

## Attached

- `260903f-test-lane-activation.diff` — the scoped diff, plus every new file in full.
- Deleted with this stage: `tests/setup/spike-db.ts`, `vitest.spike.config.ts`,
  `scripts/spike-migrate-to.ts`. Kept: `scripts/spike-hold-singleton.ts`,
  `scripts/spike-contended-claim.ts`, which are the instruments that produce the A/B evidence.

Check each finding yourself before you report it, and say plainly when you are unsure rather than
padding the list.
