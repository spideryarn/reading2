# Delete `SPIDERYARN_STORE` and the filesystem store

**Status, 2026-09-03. Plan written, nothing built. Two decisions are Greg's and are named in
§ *The two decisions that are not ours* — stage D cannot land without the first of them.**

Greg asked on 2026-09-03 whether the database move is finished enough to delete the flag:

> In the past, we had set up SPIDERYARN_STORE to be able to switch between files-mode and
> Postgres-mode. I very much hope we've now finished the switch to database for everything, so that
> it works in production across webservers, and so everything is all in one place. Does that mean we
> can now get rid of SPIDERYARN_STORE?
>
> — Greg, 2026-09-03

**The answer is yes**, and it was already his own stated goal:

> cleaning up use of filesystem to use database, so that eventually we can completely remove
> `SPIDERYARN_STORE` (because it's always postgres everywhere)
>
> — Greg, 2026-09-01, quoted in
> [260831b](260831b-finish-the-database-move.md#appendix-the-cleanup-that-remains)

This plan is the execution. [260831b](260831b-finish-the-database-move.md) § *Appendix: the cleanup
that remains* is the ancestor and is still worth reading for its traps — but **its inventory is
stale in eight places and its shape is wrong in one**, both catalogued below. That appendix warned
about exactly this: *"Four lists in this document have been wrong. Re-derive rather than inherit —
including from this appendix."* We did, and it was.

## Why the flag has to go, beyond tidiness

**It is the single biggest source of silent success in this repo**, which is this codebase's
chronic failure class ([silent-success.md](../reusable/silent-success.md)).
`SPIDERYARN_STORE` unset means `files` ([`src/store/live.ts`](../../src/store/live.ts)), so every
test, every fixture and every ungated route suite exercises **the configuration that is not
deployed**. That is not a hypothetical:

- **Claims shipped filesystem-only and answered 501 in production for four hours**, having passed
  its tests, its review and a browser pass — all three on the store that does not deploy.
  [260901e](../postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md).
- **Chat and meaning-search wrote files a Postgres read ignores**, reported success, and lost the
  data — what [`src/store/index.ts`](../../src/store/index.ts) calls "the worst available outcome".
  [deployment.md](../project/deployment.md).

**And it has tied a knot in the documented setup.** [setup-dev.md:50](../project/setup-dev.md) says
`cp .env.example .env.local`; [`.env.example`](../../.env.example):218 ships
`SPIDERYARN_STORE=postgres`; and [`scripts/seed-dev-rules.ts`](../../scripts/seed-dev-rules.ts):213
says that exact line in that exact file **"turned 40 test files and 146 tests red on 2026-09-02,
silently"**, because `.env.local` is applied over `process.env` and so overrides every test that
sets the store itself. A new developer following the documented setup lands in the broken state.
**That knot exists only because the flag exists**, and no amount of documentation dissolves it.

## What is already true, verified 2026-09-03 rather than inherited

- Production and preview both set `SPIDERYARN_STORE=postgres`; production has since 2026-08-27.
- [`src/store/index.ts`](../../src/store/index.ts):185 **throws at boot** if the store is `files`
  under Vercel — the filesystem store has no `owner_id`, so every signed-in reader would share one
  library.
- `npm run dev` defaults the flag to `postgres` (since 2026-09-02) and will not boot without a
  database.
- The 2026-09-01 audit traced every filesystem read and write reachable from a request or a job
  under `postgres` and found none.

**So the filesystem store is dead weight, not a data dependency.** What keeps it alive is the test
suite and two fixture paths.

## Both reviewers said yes, and both said not in one commit

Asked independently on 2026-09-03, with the same brief and told to argue against the framing.

**Neither found a surviving reason to keep the seam.** The four candidate reasons and their answers:

| candidate reason | why it does not survive |
|---|---|
| **Developing with no Docker / offline** | Already decided against — `npm run dev` defaults to postgres and stops at boot without a database; `npm run check` sets `REQUIRE_POSTGRES=1`. And files mode **is not the product**: billing admission, sharing, admin, feedback and public reading are all switched off under it (§ *The hinge is not one line*). "Developing offline" means developing against something that does not ship. |
| **Fast unit tests** | The only one with any weight, and the answer is narrow injected fakes and tests of pure functions that never import a store — **not a 3,900-line second persistence engine**. `scratch-article.ts` measures ~280 ms a seed, which is cheap. |
| **An escape hatch if Supabase is down** | Fictional and actively unsafe. Vercel has no writable disk and the fs store has no owner column, so there is no host to fall over to; switching would turn an outage into missing or misplaced data. Fail closed. |
| **Rollback / export** | Keep explicit import/export tooling ([`src/store/export.ts`](../../src/store/export.ts)). A live alternative store is not a backup. |

**On shape both were unprompted and identical: staged, with D atomic — not a big bang.** The reason
is not caution, it is evidence. A test converted *before* the hinge runs green against unchanged
production code with `postgres` set explicitly, so you can mutate the code and watch it go red. A
test rewritten *inside* the hinge commit is where a test gets bent until it passes. Sol put the cost
plainly: a 3,900-line, ~50-test-file single commit would make **"coverage disappeared"
indistinguishable from "migration succeeded"** — which is the exact failure class this repo keeps
writing postmortems about. A big-bang commit is also the most likely to collide in a shared tree.

## Where the ancestor plan is wrong

Its architecture is right. Its inventory is stale, and one structural claim is wrong.

### The hinge is not one line, and this is the structural error

The appendix says D is `guarded()` ceasing to branch. **There are ~20 `STORE ===` sites across 10
files outside [`src/store/index.ts`](../../src/store/index.ts)**, and several are feature gates
rather than store selection:

| file | what the branch does under `files` |
|---|---|
| [`src/billing/admission.ts`](../../src/billing/admission.ts) ×3 | **quota admission is a no-op** — `if (STORE !== "postgres") return null` |
| [`src/billing/summary.ts`](../../src/billing/summary.ts) | billing summary short-circuits |
| [`src/public/routes.ts`](../../src/public/routes.ts):268 | public read refuses with a 501 |
| [`src/jobs.ts`](../../src/jobs.ts):121, 1360, 2233 | the job store, `claimSession`, the slug-taken check |
| [`src/pipeline.ts`](../../src/pipeline.ts):1085, 1149 | article existence and URL lookup |
| [`src/upload-records.ts`](../../src/upload-records.ts):55, 170 | the upload store, and a grant check |
| [`src/store/find-article.ts`](../../src/store/find-article.ts):105, 126 | article discovery |
| [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts):75 | the cost ledger |
| [`src/vercel-health.ts`](../../src/vercel-health.ts) ×3 | what health reports |

`jobs.ts` and `upload-records.ts` select their own deliberately — asking `index.ts` would close an
import cycle and `npm run check` gates on cycles. **That reasoning survives the flag's death**: they
just stop branching and import the Postgres adapter directly.

**A route suite that never set the flag never exercised any of these.** Expect new reds at D where a
test has no owner or quota row. **Those are findings; do not stub them away.**

### Three deletions that are not the compiler-checked no-ops the appendix promises

1. **[`src/store/ai-calls-fs.ts`](../../src/store/ai-calls-fs.ts) is the test-ledger isolation
   mechanism**, not dead weight. `selected()` returns the filesystem store whenever
   `NODE_ENV === "test"`, *including* under `postgres`, because Postgres-mode route tests once wrote
   4,714 fixture rows into the development ledger. It is asked **per call, not at module load**, and
   the docstring explains why. **A test-scoped Postgres destination with transactional cleanup is a
   prerequisite**, not a follow-up.
2. **[`src/store/copy-artefacts.ts`](../../src/store/copy-artefacts.ts) has a production-adjacent
   caller.** [`tests/helpers/load-article.ts`](../../tests/helpers/load-article.ts):427 uses it to
   load the committed fixture corpus into Postgres, and **`npm run db:seed-dev` — the dev account on
   every box — depends on that loader.** A replacement fixture seeder is a prerequisite.
3. **[`src/store/blobs-fs.ts`](../../src/store/blobs-fs.ts) is not selected by the flag at all.**
   [`blobs.ts`](../../src/store/blobs.ts) selects on *credentials*: a service key means Supabase,
   otherwise `data/_blobs/`. Deleting it is a **separate decision** that would make every test need
   local Supabase Storage, and `.env.example` ships an empty `SUPABASE_SERVICE_ROLE_KEY=`.
   **Out of scope for this plan.**

### Counts, re-derived 2026-09-03

| the appendix says | actually |
|---|---|
| `pgReady` makes 53 files skip | **~80–83** test files call it |
| ~12 `createFsArtifactStore` doubles | **13 test files plus one helper** |
| `fs.ts` is 533 lines | **574** |
| "about 25 files, not 120" | **~40 files of real edits**; ~29 route/api suites have no pg gate at all |
| only 2 of 15 Postgres stores self-guard | **zero of the 15 in `index.ts` do**; the two that self-guard (`pg-jobs`, `pg-uploads`) are selected elsewhere. `find-article`, `ai-calls`, `pg-session`, `checkpoints-pg` also self-guard. **The rider is still right** |

### Two things it omits entirely

- **The `attempt` token contracts get to tighten.** `beginAnswer` returns
  `{ attempt: string | undefined }` and the `undefined` is there **solely for the filesystem store**
  ([`contracts.ts`](../../src/store/contracts.ts):383). With one implementation it becomes `string`,
  and the compiler then finds every caller that dropped the fence. That is a correctness win, not
  tidying: the docstring says that without carrying the attempt, *"a model call this sweep already
  buried can land on top of the retry the reader is watching arrive."* Same for chat, search and
  referee. **Let the types catch it** — this is the payoff.
- **The stage CLIs.** `npm run fetch|extract|pdf|blocks|hierarchy|labels` still write filesystem
  artefacts, and [`src/fetch.ts`](../../src/fetch.ts):302 says so: running `npm run fetch -- <url>`
  by hand under `files` satisfies the queue's fetch step. Its own comment says *"All of this dies at
  stage 4 with the filesystem store, which is the right time for it to die."* But **AGENTS.md
  requires every stage to stay runnable on its own**, so they must move to Postgres rather than
  simply going. See § *The two decisions*.

## The two decisions that are not ours

**1 — the glossary, and it blocks D.** `deleteGlossary` has **no Postgres implementation**: the
glossary panel's *"start over"* answers 501 on the deployed app today, recorded in
`SEAM_ASYMMETRIES` ([`live.ts`](../../src/store/live.ts)) with the production gap spelled out. It is
refused rather than built because `deleteGlossary` nulls `article_revisions.glossary` on a
**published** revision, and *whether a published revision may be mutated* is the open decision step
11 of [260826e](260826e-postgres-storage-implementation.md) owns.

- **Cheap route:** drop *"start over"* from the alpha. The seam entry goes, D is unblocked, nothing
  else moves.
- **Other route:** build it, which means settling the published-mutation question first.

Per AGENTS.md — *"when a small product tweak would take a lot of the engineering out, ask Greg
before you build the hard version"* — this is Greg's.

**2 — the stage CLIs, and it shapes E–H.** Either they move to Postgres (real work, and the
`npm run fetch -- <url>` → queue-satisfying trick changes shape), or the *"every stage stays runnable
on its own"* rule is relaxed. Also Greg's.

## The stages

Each commit independently green. `npm test` and `npm run typecheck` at the end of each, GPT Sol at
the end of each per [engineering-manager.md](../reusable/engineering-manager.md).

### B — convert the ungated route suites (parallelisable)

~29 route/api suites import `src/store/index.js`, `routes.js` or `api.js` with no `pgReady` gate.
The pattern is proved: [`tests/helpers/scratch-article.ts`](../../tests/helpers/scratch-article.ts),
~280 ms a seed. Land `serialise: false` for unique-slug seeds as you go. **Each converted suite runs
green against unchanged production code with `postgres` set explicitly** — that is the property that
makes this safe, and it is worth checking one mutation per suite.

### B′ — delete, do not rewrite, the suites that test filesystem behaviour

`store-selection` ("defaults to files"), `dev-server-store-default`, `billing-admission-files`,
`stage2c-raw-bytes`, `shelf`, `library-search`, four of `parse-json`'s six scenarios,
`library.test.ts`'s `listArticles` half (**Postgres cannot have a half-built directory — that is the
migration working, not a gap**), the 8 parity suites, `store-seams-have-two-implementations` and
`SEAM_ASYMMETRIES` itself (with one side there is nothing to police; `typecheck` already fails an
unimplemented contract assigned in `index.ts`), and `seed-dev-rules`'s `storeVerdict`.

**Before deleting any parity suite, check each Postgres-side property survives somewhere else.**
Deleting a parity suite removes assertions that may be the only test of a pg behaviour, and that
loss looks exactly like a clean-up. **Port individual assertions; never the suites.**

**`tests/slug.test.ts`:81 asserts the *source text* of `jobs-fs.ts`** — the only test that goes red
purely because a file was deleted, and it will look unrelated.

### C — the 13 `createFsArtifactStore()` doubles point at Postgres

**Do not build an in-memory `ArtifactStore`.** Both reviewers said so independently, twice now: a
nine-method double whose fidelity nothing checks is a *third* implementation, built at the exact
moment the goal is getting down to one.

### C′ — the two prerequisites the appendix missed

- A test-scoped Postgres cost ledger with transactional cleanup, replacing the `NODE_ENV === "test"`
  filesystem redirect.
- A `seedPublishedArticle`-style fixture seeder that inserts the minimum coherent state directly,
  replacing `copyArtefacts` for `load-article.ts` and `db:seed-dev`. Sol notes this would also
  consolidate the **20 test files that already hand-roll `db.insert(articles)`**. **Tests of
  publication must keep using the real path.**

### D — the hinge, one commit, with every rider inside it

Splitting any rider out leaves a window where the guard is gone and nothing replaces it.

- `guarded()` becomes `guardDbStore(what, pg)`; `storeFromEnv` loses `"files"`.
- **All ~20 `STORE` sites outside `index.ts`**, not just `guarded()`.
- **`guardDbStore` moves onto each Postgres store's own export.** Thirteen adapters rely on the
  wrapper D deletes; losing it can **leak bound parameters, including article prose, through database
  errors**, and turns expected 404/409 responses into 500s. This is the durable fix from
  [260901d](../postmortems/260901d-a-409-and-a-404-arrived-as-500.md).
- **Database readiness fails closed** — see § *Making the database required*.
- **The `attempt` tokens become required** in comments, chat, search and referee contracts.
- The tombstone (below). Drop the flag from `.env.example`, `package.json`, `vercel-health.ts`'s
  `EXPECTED` list and `gjd-remote push-env`'s allowlist in the same commit.
- The glossary decision, whichever way it went.

### E–H — delete the adapters, innermost outward, in reviewable groups

uploads → ai-calls → jobs → the reader-state modules and `fs.ts` → `artifacts-fs.ts` →
`data-root.ts`. **Not `blobs-fs.ts`** (§ above). Mostly compiler-checked after D.

**The eight `data/_jobs` teardowns become permanent no-ops** — `readdir(...).catch(() => [])` over a
directory that will never exist. **Convert them to check the `jobs` table; do not delete them.**
Filesystem teardown quietly becoming a no-op leaves shared database rows behind and produces
cross-agent failures that look like somebody else's bug.

**`store-artefact-manifest`'s job is to notice a new artefact filename arriving.** Confirm
`store-artefacts-pg` covers "a new kind arrives and nobody homed it" before deleting it — **its two
known failures vanish with it, which will look like a fix.**

### J — the docs and the deploy script

`scripts/deploy.ts`'s corpus copy loop, and the 15 project docs that name the flag. The 13 gate
sentinels already live under `tests/fixtures/data-root/`, so if the sentinel list does not move there
is no collision with [260901b](260901b-committed-fixture-corpus.md).

## Making the database required, without the cure being the disease

After D, ~100 files need a database where ~80 gate on one today. **`pgReady` becoming a failure
rather than a skip is right, and `REQUIRE_POSTGRES=1` already exists** — `scripts/check.ts` sets it.
Make that the only behaviour: **missing database = one failing test naming the fix, never a skip.**
Keep the helper for its migration and grant diagnostics.

Sol's sharpening, worth taking: a **mandatory fail-fast preflight** checking `DATABASE_URL`,
reachability and current schema beats 100+ per-file probes and 100+ synthetic skips. Do not globally
require Postgres for a focused pure unit test — require it in database consumers.

**Two traps here, both the shape this repo keeps meeting:**

- **Prove the policy with a negative control.** Stop or misdirect Postgres and require the default
  run to **fail with the expected message**. A check you have never seen fail is not evidence
  ([silent-success.md](../reusable/silent-success.md)). Without this the whole change can report
  success while running a quarter of the suite.
- **After D every importer of `index.ts` also needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`**,
  because the boot check calls `postgresBlobStore(...)`, which throws without them. Loud, but a **new
  failure shape** — fold it into the preflight's message so it does not read as a database fault.

## The tombstone: keep the name for about a week, and tolerate `postgres`

**Accept unset and `postgres` silently; throw on `files` or any other value** with a dated sentence:
*"the filesystem store was removed on <date>; there is one store; unset this."*

Two reasons it is not simply deleted. **Silently ignoring `SPIDERYARN_STORE=files` would do the
opposite of what the operator asked** — the failure mode this codebase is trying to leave behind.
And **there is no Vercel credential on this box**, so Greg has to remove the variable from
Production and Preview himself; if D threw on *any* value including `postgres`, the next deploy would
break until he did.

**Then delete the tombstone**, with the date in the message so it is self-policing. A permanent
validated no-op preserves the false impression that store selection still means something.

## What "done" looks like

`SPIDERYARN_STORE` appears nowhere in `src/`, `tests/`, `scripts/`, `package.json` or `.env.example`;
`grep -r 'STORE ===' src/` is empty; there is one `ArtifactStore` implementation; `npm test` fails
loudly on a machine with no database, **and somebody has watched it do so**.
