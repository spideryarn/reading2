# Delete `SPIDERYARN_STORE` and the filesystem store

**Status, 2026-09-03. Third draft. GPT Sol returned *not ready* on the first and
*ready with changes* on the second; those changes are in. Nothing built. Both of Greg's decisions
are in (§ *The two decisions, and what Greg decided*), so there is nothing left to ask before
stage A starts.**

**The order to build in**, per the second review — note it is not simply A→B→C:

1. **Stage A's manifest**, lightweight, first — it is a ledger the rest is tracked against.
2. **The smallest vertical slice of stage C** next, *before* B: two parallel test scopes plus a
   crashed subprocess, proving committed ledger tests stay separate. **C rests on the least
   mechanical assumption in the plan**, so it is where a wrong belief is cheapest to discover.
3. **Spike `blocks`** as the representative re-runnable Postgres CLI before committing to all six of
   stage E.

Then the rest in order: B → D → D′1–3 → E → F (hinge) → G → H → I.

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
that remains* is the ancestor, still worth reading for its traps.

**Read [the Sol review](260903f-delete-the-spideryarn-store-flag-review-sol.md) before building.**
It returned *not ready* on the first draft and restaged it; every change below is downstream of it.

## Counts are perishable here — re-derive, never inherit

The ancestor's appendix warned *"Four lists in this document have been wrong. Re-derive rather than
inherit — including from this appendix."* **We re-derived, found it stale in eight places, and then
our own re-derivation went stale within the day.** Numbers taken in the primary checkout on the
morning of 2026-09-03 were wrong by the afternoon because this worktree merged 31 commits:
`fs.ts` went 574 → 576, `createFsArtifactStore` gained `illustrated-step-registration.test.ts`, and
every line number in `jobs.ts` and `pipeline.ts` drifted by ~90.

**So: this document carries no line numbers for moving files, and every count below is a
*measurement with a date on it*, not a fact.** Stage A exists to turn them into a checked-in
manifest that a test can police.

| | as of 2026-09-03, in this worktree |
|---|---|
| `STORE ===`/`!==` comparison sites outside `src/store/index.ts` | **19**, across **10** files — nine under `src/` plus `vite.config.ts` |
| test files calling `createFsArtifactStore` | **14**, plus `tests/helpers/load-article.ts` |
| index-selected Postgres seams relying on the central `guardDbStore` | **15** |
| test files calling `pgReady` | **82** callers; 83 files mention the name (one is prose), and 85 match a looser grep — **exactly the ambiguity stage A exists to settle** |
| test files hand-rolling `.insert(articles)` | **28** |
| ungated test files importing `store/index`, `routes` or `api` | **43** |
| test files importing a condemned filesystem module (incl. helpers) | **67** — union **105 candidates**, deliberately over-inclusive |
| filesystem-only source | **~3,900 lines**; `src/store/fs.ts` alone is 576 |

Every count in this table was checked by the second review; those it corrected are corrected here.
**The candidate union is direct-import only** — see stage A on why that is not good enough.

## Why the flag has to go, beyond tidiness

**It is the single biggest source of silent success in this repo**, which is this codebase's chronic
failure class ([silent-success.md](../reusable/silent-success.md)). `SPIDERYARN_STORE` unset means
`files` ([`src/store/live.ts`](../../src/store/live.ts)), so every test, every fixture and every
ungated route suite exercises **the configuration that is not deployed**. Not hypothetical:

- **Claims shipped filesystem-only and answered 501 in production for four hours**, having passed
  its tests, its review and a browser pass — all three on the store that does not deploy.
  [260901e](../postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md).
- **Chat and meaning-search wrote files a Postgres read ignores**, reported success, and lost the
  data — what [`src/store/index.ts`](../../src/store/index.ts) calls "the worst available outcome".
  [deployment.md](../project/deployment.md).

**And it has tied a knot in the documented setup.** [setup-dev.md](../project/setup-dev.md) says
`cp .env.example .env.local`; [`.env.example`](../../.env.example) ships
`SPIDERYARN_STORE=postgres`; and [`scripts/seed-dev-rules.ts`](../../scripts/seed-dev-rules.ts) says
that exact line in that exact file **"turned 40 test files and 146 tests red on 2026-09-02,
silently"**, because `.env.local` is applied over `process.env` and so overrides every test that
sets the store itself. **A new developer following the documented setup lands in the broken state.**
That knot exists only because the flag exists, and no amount of documentation dissolves it.

## What is already true, verified rather than inherited

- Production and preview both set `SPIDERYARN_STORE=postgres`; production has since 2026-08-27.
- [`src/store/index.ts`](../../src/store/index.ts) **throws at boot** if the store is `files` under
  Vercel — the filesystem store has no `owner_id`, so every signed-in reader would share one library.
- `npm run dev` defaults the flag to `postgres` (since 2026-09-02) and will not boot without a
  database; `vite.config.ts`'s `assertStoreReachable` is the check.
- The 2026-09-01 audit traced every filesystem read and write reachable from a request or a job
  under `postgres` and found none.

**So the filesystem store is not a data dependency.** But note the correction Sol made to our first
draft: *"kept alive only by the test suite and two fixture paths"* was **false for the repository as
a whole** — the six standalone stage CLIs still depend on it. See stage E.

## Both reviewers said yes, and both said not in one commit

Asked independently on 2026-09-03, same brief, each told to argue against the framing.

**Neither found a surviving reason to keep the seam:**

| candidate reason | why it does not survive |
|---|---|
| **Developing with no Docker / offline** | Already decided against — `npm run dev` defaults to postgres and stops at boot without a database; `npm run check` sets `REQUIRE_POSTGRES=1`. And files mode **is not the product**: billing admission, sharing, admin, feedback and public reading are all switched off under it. "Developing offline" means developing against something that does not ship. |
| **Fast unit tests** | The only one with weight, and the answer is narrow injected fakes and tests of pure functions that never import a store — **not a 3,900-line second persistence engine**. `scratch-article.ts` measures ~280 ms a seed. |
| **An escape hatch if Supabase is down** | Fictional and actively unsafe. Vercel has no writable disk and the fs store has no owner column, so there is no host to fall over to; switching would turn an outage into missing or misplaced data. Fail closed. |
| **Rollback / export** | Keep explicit import/export tooling ([`src/store/export.ts`](../../src/store/export.ts)). A live alternative store is not a backup. |

**On shape, both were unprompted and identical: staged, with an atomic hinge — not a big bang.** The
reason is evidence, not caution. A test converted *before* the hinge runs green against unchanged
production code with `postgres` set explicitly, so you can mutate the code and watch it go red. A
test rewritten *inside* the hinge is a test bent until it passes. Sol put the cost plainly: a
3,900-line, ~80-file single commit would make **"coverage disappeared" indistinguishable from
"migration succeeded"** — the exact failure class this repo keeps writing postmortems about.

## The two decisions, and what Greg decided

Both were put to Greg on 2026-09-03 and both are answered. Recorded here because each deleted work.

**1 — the glossary. Decision: drop *"start over"* from the alpha.** `deleteGlossary` has no Postgres
implementation, so the glossary panel's *"start over"* has answered 501 on the deployed app since
2026-08-27 and nobody has reported it. Removing the button removes the seam entry, the
`GlossaryStore` asymmetry and the question. **Sol's separate finding is worth recording even though
the decision moots it:** the "open product decision" the refusal cited — whether a published
revision may be mutated — is **stale**, because `live.ts` itself records that nulling the glossary
should trigger the ordinary rebuild without deleting the step run. So the refusal outlived its
reason. We are removing the feature rather than implementing it, on Greg's call, but nobody should
re-derive the blocking question from the old docstring.

**2 — the stage CLIs. Decision: move them to Postgres.** `npm run fetch|extract|pdf|blocks|hierarchy|labels`
still write filesystem artefacts, and running `npm run fetch -- <url>` by hand satisfies the queue's
fetch step. [`src/fetch.ts`](../../src/fetch.ts) predicts its own death here — *"All of this dies at
stage 4 with the filesystem store, which is the right time for it to die"* — but AGENTS.md requires
every stage to stay runnable on its own, and Greg kept the rule. **This is stage E, and Sol called
it the plan's missing major stage:** it must land *before* the artefact filesystem machinery is
deleted, not after.

## Where the ancestor plan is wrong

Its architecture is right. Its inventory is stale, and one structural claim is wrong.

### The hinge is not one line — the structural error

The appendix says the hinge is `guarded()` ceasing to branch. **There are 19 comparison sites across
ten files outside `src/store/index.ts`**, and several are feature gates rather than store selection:

| file | what the branch does under `files` |
|---|---|
| `src/billing/admission.ts` ×3 | **quota admission is a no-op** — `if (STORE !== "postgres") return null` |
| `src/billing/summary.ts` | billing summary short-circuits |
| `src/public/routes.ts` | public read refuses with a 501 |
| `src/jobs.ts` ×3 | the job store, `claimSession`, the slug-taken check |
| `src/pipeline.ts` ×2 | article existence and URL lookup |
| `src/upload-records.ts` ×2 | the upload store, and a grant check |
| `src/store/find-article.ts` ×2 | article discovery |
| `src/store/ai-calls.ts` | the cost ledger |
| `src/vercel-health.ts` ×3 | what health reports |
| **`vite.config.ts`** | `assertStoreReachable` returns early — **the one our own first draft missed** |

`jobs.ts` and `upload-records.ts` select their own deliberately: asking `index.ts` would close an
import cycle and `npm run check` gates on cycles. **That reasoning survives the flag's death** —
they stop branching and import the Postgres adapter directly.

**A route suite that never set the flag never exercised any of these.** Expect new reds at the hinge
where a test has no owner or quota row. **Those are findings; do not stub them away.**

### Three deletions that are not the compiler-checked no-ops the appendix promises

1. **`src/store/ai-calls-fs.ts` is the test-ledger isolation mechanism.** `selected()` returns the
   filesystem store whenever `NODE_ENV === "test"`, *including* under `postgres`, because
   Postgres-mode route tests once wrote 4,714 fixture rows into the development ledger. Asked **per
   call, not at module load** — the docstring explains why. Its replacement is stage C, and Sol's
   correction is that it is **harder than "Postgres plus cleanup"**: see there.
2. **`src/store/copy-artefacts.ts` has a production-adjacent caller.** `tests/helpers/load-article.ts`
   uses it, and **`npm run db:seed-dev` — the dev account on every box — depends on that loader.**
3. **`src/store/blobs-fs.ts` is not selected by the flag at all.** `blobs.ts` selects on
   *credentials*: a service key means Supabase, otherwise `data/_blobs/`. Deleting it is a **separate
   decision** that would make every test need local Supabase Storage, and `.env.example` ships an
   empty `SUPABASE_SERVICE_ROLE_KEY=`. **Out of scope.**

**And a fourth, from the review:** `src/store/data-root.ts` also serves evals, export and the
setup/worktree scripts. Deleting it means relocating those generic responsibilities, not just
dropping a file.

### Two things it omits entirely

- **The `attempt` token contracts get to tighten.** `beginAnswer` returns
  `{ attempt: string | undefined }` and the `undefined` is there **solely for the filesystem store**
  ([`contracts.ts`](../../src/store/contracts.ts)). With one implementation it becomes `string`, and
  the compiler finds every caller that dropped the fence — a correctness win, since without the
  attempt *"a model call this sweep already buried can land on top of the retry the reader is
  watching arrive."* **Sol's caveat, which changes the shape:** chat's `appendSpoken` legitimately
  returns no attempt, so `Turn.attempt: string` would be **wrong** without splitting the return type.
  This is stage H, not part of the hinge.
- **The stage CLIs** — decision 2 above, now stage E.

## The stages

Restaged per the review. Each commit independently green; `npm test` and `npm run typecheck` at the
end of each; GPT Sol at the end of each per
[engineering-manager.md](../reusable/engineering-manager.md). **Update the behavioural docs in the
stage that changes the behaviour** — deferring every doc change to the end leaves the instructions
wrong for the duration, which is how agents get misled mid-migration.

### A — the manifest, before any edit

**Counts are not auditable; a checked-in list is.** Produce one file naming every candidate (the ~80
union) with a verdict each, and **a recorded reason for every file excluded as already safe** — an
unexplained exclusion is where a missed file hides. Classify each into exactly one of the three
categories the review separates:

| category | what happens to it |
|---|---|
| **filesystem-adapter behaviour** — tests whose *subject* is the fs implementation | **Keep until its adapter dies in G.** Deleting these earlier creates an uncovered interval indistinguishable from success. `pipeline-artifact-store`, `artefact-copy`, `store-session` are examples. |
| **store-agnostic, using files as a cheap fake** | Move to narrow `ArtifactReads` or a purpose-built fake. |
| **genuine database integration** | Move to Postgres. |

**Our first draft collapsed these three into one bucket and would have deleted adapter tests before
their adapters.** That was the first review's leading finding.

**The manifest's own test is not sufficient, and we asked whether it would be.** It can prove every
mechanically discovered candidate has an entry and a reason. **It cannot prove the verdict is
right** — and if discovery and policing use the same predicate, it is precisely a guard that agrees
with the bug. So the manifest gets **two independent witnesses**:

1. **Generate the candidate universe by a different route than the manifest polices**, including
   **transitive** imports — a test reaching the filesystem store three modules deep is invisible to
   a direct-import grep, and our 105-file list is direct-import only.
2. **A dynamic witness**: run with the filesystem selection and methods instrumented, or throwing a
   sentinel, and record which suites *actually* touch them. A file's imports are a claim; what it
   executes is the fact.

**And the manifest is a ledger, not the protection.** The real protection against a wrong
classification is the per-suite mutation evidence from B and the assertion inventory in G. Do not
let a green manifest test stand in for either.

### B — convert the ungated route suites (parallelisable)

The pattern is proved: `tests/helpers/scratch-article.ts`, ~280 ms a seed. Land `serialise: false`
for unique-slug seeds as you go. **Each converted suite must run green against unchanged production
code with `postgres` set explicitly, and each gets one mutation watched going red.** That evidence is
retained — it is part of the final proof in the readiness work.

### C — ledger isolation, its own reviewed stage

Replacing `NODE_ENV === "test"` → filesystem is **not** "Postgres plus cleanup". Routes use a global
cost store and independent pooled connections while Vitest runs files concurrently, so **a
surrounding test transaction will not contain those writes unless the cost store becomes
executor/transaction-aware.** Acceptance must prove all five:

1. `pgCostStore.record` genuinely executed (not silently skipped).
2. Fixture costs were never visible to normal dev reports.
3. A crashed or failed suite still rolls back.
4. Parallel test files stay isolated from each other.
5. Direct ledger integration tests still exercise committed behaviour.

### D — the fixture loader, which is two tools not one

- **A minimal direct-row helper** for tests needing only an article record.
- **A corpus loader** for `db:seed-dev` and rich route tests.

**Do not force all 28 `.insert(articles)` sites through the helper** — the second review's
correction to us. Many are integration tests deliberately constructing unusual revisions, odd
ownership, explicit transactions or malformed rows, and routing those through a
"one ordinary article" helper would quietly delete the very thing they test. **Consolidate only the
repeated ordinary-row setup**, and leave the deliberate oddities alone.

**Do not collapse them.** `load-article.ts` does far more than insert a readable article: it loads
raw bytes, creates a job and draft, copies fixture stages **through the real writer**, runs the
publication guards and publishes. Replacing that with a "minimum coherent direct insert" would
**silently remove integration coverage** — and `scratch-article.ts` already documents why a second
files-to-Postgres implementation is undesirable. **Tests of publication keep using the real path.**

### D′ — additive, before the hinge — as three separate reviewed commits

They share no failure mode, so they are reviewed apart.

**D′1 — make `guardDbStore` idempotent, then move it onto each of the 15 Postgres exports.**

**"Double wrapping is harmless" was wrong, and both this plan's first draft and the docstring said
it.** `guardDbStore` does not return an already-guarded store unchanged, so the second wrapper wraps
the first wrapper's methods. Probed directly, 2026-09-03, with a fake `23505`:

| | single wrap | double wrap |
|---|---|---|
| `database call failed` log lines | **1** | **2** — `inner.fail`, then `outer.fail` |
| the error the caller sees | `StoreFailure`, `code="23505"` | `StoreFailure`, `code="23505"` — **unchanged** |
| the second line's diagnostics | — | **degraded**: no `table`, no `constraint`, no `routine`, and `errorType: "StoreFailure"` — it reports a database failure while naming our own wrapper as the thing that failed |

So the **caller-facing contract survives** — the 404/409 mapping is not broken, which is the half we
had right — but **one failure produces two diagnostics and the second is misleading.** In a repo
whose whole problem is checks that agree with the bug, an error log that invents a second database
failure is not acceptable noise.

**The mark is already there and unused for this**: `isGuardedStore` reads a non-enumerable symbol.
Return the store unchanged when it is set, **and test that one failure produces exactly one
diagnostic** before moving any guard. Then the move is genuinely additive.

**Fix the docstring in the same commit.** *"wrapping a wrapped store stays harmless"* is narrowly
about the mark not being re-enumerated, but it reads as a general guarantee — and it was read that
way twice on the day this plan was written. Say what it means.

Losing this guard entirely would **leak bound parameters, including article prose, through database
errors** — the durable fix from
[260901d](../postmortems/260901d-a-409-and-a-404-arrived-as-500.md).

**D′2 — the suite-registration abstraction, before the readiness flip.** See § *Making the database
required*: without it, the hinge inherits ~82 files of suite edits.

**D′3 — remove the glossary's *"start over"***, per decision 1.

### E — the stage CLIs move to Postgres, **before** the hinge

Decision 2. **The second review moved this earlier and corrected our reason for it.**

We had placed it before G on the grounds that G deletes the machinery it uses. **That dependency is
partly false:** several of the six write files *directly* rather than through `artifacts-fs` —
`src/blocks.ts` and `src/hierarchy.ts` among them — so G would not mechanically break them, and a
compiler-checked deletion would leave them silently writing files nothing reads. The real reason to
do it here is better: **doing it before the hinge lets each CLI be proved against Postgres while the
old path still exists to compare against.** After the hinge there is nothing to check the new
behaviour against.

**Write the contract first** — one short section covering slug and owner selection, draft and
session handling, what a re-run does, and what each command prints. Six commands sharing an
unwritten contract is six different answers to the same question.

**Spike `blocks` first** as the representative re-runnable CLI, before committing to all six.

### F — the hinge, one commit, and narrower than the first draft

Only the atomic policy change, because everything additive has already landed:

- Remove store selection and the runtime feature gates — **all 19 sites, `vite.config.ts` included**.
- Application, dev and health paths require Postgres unconditionally; `storeFromEnv` loses `"files"`.
- Test readiness flips from optional skipping to required preflight.
- The obsolete-value tombstone goes in (§ below).
- Remove active environment injection: `.env.example`, `package.json`, `vercel-health.ts`'s
  `EXPECTED` list, `gjd-remote push-env`'s allowlist.

**The sharper invariant, from the second review: after the hinge, the tombstone is the only
executable code allowed to read `SPIDERYARN_STORE`.** The 19-site inventory counts comparisons and
therefore **misses live consumers in `scripts/`** — `scripts/db-seed-dev.ts` reads the raw variable
via `storeVerdict`, and `scripts/ai-cost.ts` branches on `STORE` and prints
*"Re-run as: SPIDERYARN_STORE=postgres npm run cost"*. Their obsolete behaviour dies **in the hinge,
not in stage I**, or the repo spends the interval telling people to set a variable that no longer
does anything.

**Moved out of the hinge on review:** the self-guarding exports (→ D′1), the glossary (→ D′3), the
readiness infrastructure (→ D′2), and the `attempt` types (→ H).

### G — delete the adapters, in reviewable groups

uploads → ai-calls → jobs → the reader-state modules and `fs.ts` → `artifacts-fs.ts` → `data-root.ts`
(relocating its eval/export/script duties). **Not `blobs-fs.ts`.** Each group deletes its
filesystem-adapter behaviour tests from stage A's manifest **in the same commit as its subject** —
that pairing is what keeps the uncovered interval from existing.

**Before deleting any suite, port or enumerate every surviving assertion.** A green compiler cannot
detect deleted coverage. Specifically: `store-artefact-manifest`'s job is to notice a new artefact
filename arriving — confirm `store-artefacts-pg` covers "a new kind arrives and nobody homed it"
first, because **its two known failures vanish with it, which will look like a fix**.

**`tests/slug.test.ts` asserts the *source text* of `jobs-fs.ts`** — the only test that goes red
purely because a file was deleted, and it will look unrelated.

**Job teardown is 11 files, not the appendix's eight.** They become permanent no-ops —
`readdir(...).catch(() => [])` over a directory that will never exist. **Replace each with a database
postcondition querying for leaked test identifiers; do not delete them.** Teardown quietly becoming
a no-op leaves shared rows behind and produces cross-agent failures that look like somebody else's
bug.

### H — tighten the contracts the filesystem store was weakening

`attempt` becomes required in comments, search and referee. **Chat needs the return type split
first**, because `appendSpoken` legitimately has no attempt.

### I — retire the tombstone

**A separate, post-deployment stage**, once Greg has removed the variable from Preview and
Production. The first draft said "keep it about a week" and also declared completion only when the
identifier is gone; those cannot both be true in one stage.

Final grep must cover `src/`, `tests/`, `scripts/`, **`evals/`, `vite.config.ts`, `package.json`,
`.env.example` and `AGENTS.md`** — not only the source paths.

## Making the database required, without the cure being the disease

After the hinge, ~100 files need a database where ~82 gate on one today (**stage A settles the exact
number** — direct counts here ranged 82–85 depending on whether helpers and prose mentions count,
which is the point of § *Counts are perishable*). **`REQUIRE_POSTGRES=1` already exists** —
`scripts/check.ts` sets it — so the destination is a **mandatory fail-fast preflight** checking
`DATABASE_URL`, reachability and schema, once per command, rather than 100+ per-file probes and
100+ synthetic skips.

**The current helper is not the end state:** under required mode `pgReady` registers a failing test
**and then still skips its suite**. That is a red line and a skipped suite at the same time.

**D′2 exists because of the arithmetic here.** Building the preflight alone still leaves the hinge
needing edits in ~82 files to satisfy the *"no `reachable ? describe : describe.skip`"* invariant —
which would put a mechanical 82-file diff inside the one commit that must stay readable. So **first
migrate every caller behind one central suite-registration abstraction with its behaviour
unchanged**, which is reviewable on its own and provably a no-op; then the hinge activates the
mandatory preflight and removes the skip branch **in one place**.

### The negative control, and why one failing run does not prove it

Stopping Postgres and seeing one expected error is **necessary but insufficient** — it can pass while
80 suites still register `describe.skip`. The proof is all five together:

1. A global pre-collection database check that fails the command **once**.
2. **No `reachable ? describe : describe.skip` pattern left anywhere.**
3. A static test or inventory assertion enforcing that absence, so it cannot come back.
4. A **positive** run showing the named database suites were collected and executed with **no
   database-related skips**.
5. The per-suite mutation evidence retained from stage B.

**Two traps in running the control itself.** A bad shell `DATABASE_URL` **may not misdirect
anything**, because `.env.local` overrides inherited values — the same override that turned 146 tests
red on 2026-09-02. And **stopping the shared Supabase would disrupt every other agent on this box.**
So provide an injectable preflight target or an isolated subprocess, and assert the diagnostic
**names the deliberately bad target**.

**One more new failure shape:** after the hinge every importer of `index.ts` also needs
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, because the boot check calls `postgresBlobStore(...)`,
which throws without them. Fold that into the preflight's message so it does not read as a database
fault.

## The tombstone: keep the name briefly, and tolerate `postgres`

**Accept unset and `postgres` silently; throw on `files` or any other value** with a dated sentence:
*"the filesystem store was removed on 2026-09-XX; there is one store; unset this."*

Two reasons not to simply delete it. **Silently ignoring `SPIDERYARN_STORE=files` would do the
opposite of what the operator asked** — the failure mode this codebase is trying to leave behind.
And **there is no Vercel credential on this box**, so Greg must remove the variable from Production
and Preview himself; a hinge that threw on *any* value would break the next deploy until he did.

Stage I retires it. A permanent validated no-op preserves the false impression that store selection
still means something.

## What "done" looks like

`SPIDERYARN_STORE` appears nowhere in `src/`, `tests/`, `scripts/`, `evals/`, `vite.config.ts`,
`package.json`, `.env.example` or `AGENTS.md`; `grep -rn 'STORE ===' src/ vite.config.ts` is empty;
there is one `ArtifactStore` implementation; the stage CLIs still run standalone, against Postgres;
and **`npm test` fails loudly on a machine with no database, with somebody having watched it do so**.
