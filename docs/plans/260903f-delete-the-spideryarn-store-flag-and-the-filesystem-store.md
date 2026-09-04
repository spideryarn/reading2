# Delete `SPIDERYARN_STORE` and the filesystem store

**Status, 2026-09-04. Fourth draft; seven of thirteen stages are done, and stage B is started.** GPT Sol returned *not
ready* on the first draft and *ready with changes* on the second; those changes are in. The three
pre-build spikes the second review asked for have all run, and each of them moved the plan — the
sections below carry what they found.

**This plan absorbed [260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md)
on Greg's decision** — see stage T. That is the largest change to its shape since it was written.

**The order to build in**, after Sol's third review. Not alphabetical, and **T sits early because
three later stages consume it**:

```
A (store inventory) ✅ → B0 ✅ (already done) → T-B (factory) ✅ → T-C (lanes) ✅
  → T-D (activation) ✅ → T-E (pollution) ✅
  → B (12 of 26 done) → C → D → E → F (hinge) → G → H → I
```

**`C → B` became `B → C` on 2026-09-04**, and this line is the only place the order lives, so
the swap is recorded here rather than in the stage. B converts 16 of the 39 unit-lane files C
would otherwise have to convert itself, using the same edit — § *C is not independent of B any
more*.

## What is on `dev`, 2026-09-04

| stage | what landed |
|---|---|
| **A** | Both witnesses, the store inventory, and a guard watched failing four ways. |
| **B0** | **Nothing** — it had been done on 2026-09-01 and a stale docstring said otherwise. |
| **T-B** | [`scripts/db-test-create.ts`](../../scripts/db-test-create.ts) — a private, migrated database per run, ~4.6s. Reviewed; three blocking findings folded in. |
| **T-C** | `TEST_LANES`, `OWNER_AUDIT`, and `seedLocalAccounts`. Reviewed; the owner guard rebuilt per `(file, owner)` pair. |
| **T-D** | **`npm test` is three projects now** — see below. The first stage of the six that is visible to anybody else. |
| **T-E** | Four verdicts at the private lane's teardown, `POLLUTED` and `TEARDOWN FAILED` among them; the pool names itself; the shared lane reports its neighbours on failure. Two Sol rounds — the design one refused half the spec, the built one refused the commit. |
| **B** | **12 of 26.** Two in the pilot, then ten more in two parallel halves. All green, each with one mutation watched red and a written note of what that mutation does *not* cover. |
| **D′1** | Landed earlier; since **extended by another worktree**, and its "unforgeable" claim is measured false — see D′1b. |

**This paragraph used to say "nothing yet changes the default `npm test`", and T-D is where that
stopped being true** — left here as the marker rather than quietly overwritten, because a status
block that survives the change it describes is the failure this plan keeps finding in other people's
files. `npm test` now runs `unit`, `private-postgres` and `shared-services`, membership derived from
`TEST_LANES` rather than written out a second time. **It costs 267s → 444–466s**, all of it the
serialised private lane; a filtered run pays nothing and mints no database. The pair is two
measurements of the same tree on a box ten worktrees share, which is the honest spread — the
444 is the run that preceded the push to `dev` (`ae5ed824`), 3 failed / 630 passed / 1 skipped
of 634 files.

**What that bought:** the same 626 files run, set-compared before and after with an empty difference
both ways, against a baseline that was *nondeterministically* red — two runs of an unchanged tree
failing 6 and 31 files, in disjoint sets.

**The `pdf` spike is done** and moved stage E — see § `pdf`. **All of D′ is off the list: D′1 is
landed, D′2 was scheduled twice, D′3 is cancelled.**

## What this day cost, and what it bought

Two stages of the thirteen turned out to be **already done or wrong about the tree**, and four
separate counts in this document drifted inside a single day. That is not incidental to the job; it
is the job. The flag exists because the repo has two stores, and the reason it is still here is that
*nobody could tell what depended on which* — the same fog that made B0 a phantom stage and made
`store-guarded.test.ts` say "eighteen" over an array of twenty-one.

**The single most valuable thing found so far is not in the flag at all.** Running the Postgres
suites against a clean database showed **fifty of them writing rows under an ambient owner none of
them names**, which passes today only because somebody seeded it into the shared database weeks ago.
See stage T-C.


**Three corrections to our own draft of this order, two from review and one from the tree moving:**

1. **D′2 is gone, because it was scheduled twice.** 260903e's Stage D *is* the suite-registration
   abstraction D′2 was going to build. Absorbing one and keeping the other would have built it
   twice — exactly the duplication the absorption was meant to prevent.
2. **B0 moves ahead of T.** It is cheap, independently measured, and needs nothing from the test
   database.
3. **D′3 is cancelled**, because somebody built the Postgres glossary delete while this was being
   written. Decision 1 is overtaken rather than reversed, and there is now nothing to remove.

**And B does not run in parallel with T**, which was the tempting shortcut: B needs *a* database,
not an isolated one, so it looks parallelisable. But B's whole deliverable is **per-suite mutation
evidence** — each converted suite watched going red — and evidence gathered against the shared
database is vulnerable to the exact contamination T exists to remove. That is not useful parallelism;
it makes both red and green less trustworthy.

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

**Third data point, 2026-09-03 afternoon.** A fact-check was dispatched over this whole document off
the back of stage B0's finding, and re-derived the load-bearing numbers again. Every one had moved
*again*, in one day: the registry 92 → **94**; witness `ranAndTouchedNothing` 499 → **498**; the
candidates script 1,160 → **1,194** first-party files and 192 → **196** executable; flag mentions
81 → **88**; `pgReady` call sites 82 → **87**; `.insert(articles)` 28 → **29**. Note that the "92,
not 93" correction *was already stale in the commit that made it* — `59f01c9d` added two registry
entries and the corrected number in the same change.

**The rule this settles: no count in this document is an input to a stage.** Where a stage needs a
number, it re-runs the command; where a check needs a list, it holds the list rather than a length
(`tests/store-guarded.test.ts` § *Written out, not counted*, which had to learn this the hard way —
its comment said "eighteen" over an array of twenty-one). Counts here are for judging size, and for
nothing else.

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
| **test files that actually touch it, measured** | **88** — and this is the one to use; see stage A |

Every count in this table was checked by the second review; those it corrected are corrected here.
**The candidate union is direct-import only** — see stage A on why that is not good enough.

**Re-derived again on 2026-09-03 at the start of the build, and it moved again**, which is the
point of this section rather than an embarrassment. The 19 comparison sites hold — 18 under `src/`
plus `vite.config.ts`, with `vercel-health.ts` contributing three executable and one in prose. What
the earlier pass missed by scoping the grep to `src/`:

- **`scripts/ai-cost.ts` is a 20th comparison site**, not merely a consumer. It branches on `STORE`
  and prints *"Re-run as: SPIDERYARN_STORE=postgres npm run cost"*.
- **`package.json` injects the flag at four scripts, not two**: `dev` and `dev:pretty` default it,
  and **`eval:cost` and `eval:cost:interactions` set it outright**. `evals/cost/harness.ts` prints a
  sentence naming the first of those. The evals are the easiest thing here to forget, because
  nothing in `src/` or `tests/` points at them.
- **81 files mention the identifier at all** — 50 under `tests/`, 30 elsewhere, most of the latter in
  docstrings that stage I's grep has to reach.

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

## The decisions, and who made each

**Five so far, all on 2026-09-03.** Recorded together because each one deleted or moved work, and
because the last two were handed back rather than answered.

| # | decision | by |
|---|---|---|
| 1 | **Drop *"start over"* from the glossary** rather than build a Postgres `deleteGlossary` — **overtaken the same day: somebody built it, see D′3** | Greg |
| 2 | **Move the stage CLIs to Postgres** rather than delete them | Greg |
| 3 | **Absorb [260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md)** into this plan rather than depend on it or duplicate it | Greg — see stage T |
| 4 | **Retire `npm run labels`** | Greg delegated; settled with Sol — see stage E |
| 5 | **`npm run fetch` becomes `npm run ingest`, and does the whole ingest** | Greg delegated; settled with Sol, **against our own recommendation** — see stage E |

For 4 and 5 Greg's instruction was: *"Use your judgment — get input from GPT Sol if needed, aiming
for simple/clean/long-term-best."* Sol agreed with us on 4 and **disagreed on 5**, and the reasoning
that changed our mind is under stage E, because getting it wrong would have published incoherent
revisions rather than merely been untidy.

The first two, in full:

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

**And a fifth, found by stage A's static witness, 2026-09-03 — the sharpest of them.**
**`src/store/pg-chat.ts` imports `src/store/fs.ts`.** A *Postgres* adapter depends on the filesystem
store: `pg-chat.ts:80` takes `CHAT_SWEPT` and `requireTail` from it, and both are used at run time.
So `tests/store-chat-pg.test.ts` and `tests/store-slug-guard.test.ts` — two suites whose subject is
the Postgres side — are one hop from the module stage G deletes. **"Delete `fs.ts`" is not a
compiler-checked no-op for the Postgres chat store**; those two names have to move somewhere neutral
before `fs.ts` can go.

**Checked, and it is the cheap kind of problem**: neither symbol is filesystem-anything.
`CHAT_SWEPT` is a sentence, and `requireTail` is a pure function over `ChatThread[]` whose own
docstring says *"shared by both stores"*. They are in the wrong file, not entangled with it — so this
is a move, not a rewrite, and it should happen **before** G rather than inside it, along with
`SEARCH_SWEPT` next to them.

Two more of the same shape, less severe but worth naming because no `STORE ===` grep will find them
either: **`src/api.ts` imports `artifacts-fs.ts` unconditionally** (`createFsArtifactStore`, used at
`api.ts:1052`), which puts 39 test files one route away from it via `pg.ts → api.ts`; and
**`src/pipeline.ts` uses `fsLocations` directly**. Together with `blocks.ts` and `hierarchy.ts`,
which stage E already knows about, that is four modules writing files without going through the
adapter.

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

#### Witness 2 is measured: [`tests/store-migration-witness.json`](../../tests/store-migration-witness.json)

The whole suite run with the eight condemned modules instrumented at method level, default store.
**The number that matters is 88, and it is neither of the two we had.**

| | |
|---|---|
| test files that **actually reach** the filesystem store | **88** |
| test files that run and touch nothing | **499** |
| unresolved — skips entirely | **1** (`gjd-remote-tab-lifecycle`) |
| for comparison: statically reachable (witness 1) | 192 |
| for comparison: direct-import grep candidates | 105 |

**46 of the 88 touch it with no direct import at all**, and 38 were not static candidates by the
dynamic witness's own baseline either. **One file imports a condemned module and never touches it**
(`store-artefacts-pg`). So the grep over-counted by roughly a fifth and under-counted by about half,
in different files — which is the whole argument for having both witnesses.

**The instrument was proved before its output was believed.** Four positive controls hit, with
method-level detail (`store-parity` reaching twelve distinct `fs:` and `copy-artefacts:` methods);
four negative controls clean. **One positive control missed, and the miss is explained rather than
waved through**: `tests/store-fs-write-chains.test.ts` loads `ai-calls-fs` under a *second module id*
(`import("…?copy=2")`) and `vi.mock`s `node:fs/promises`, so by construction the instrument cannot
see it — and that duplication is the file's own subject. **A known blind spot of exactly one file,
recorded in the JSON.**

**"Did not report" was kept distinct from "did not touch"**, which is the distinction the whole
witness exists for. Three files failed or skipped mid-run and were re-run afterwards under the
instrument: `pg-session-real-step` **does** touch, `store-job-draft` does not, and
`gjd-remote-tab-lifecycle` skips and stays unresolved rather than being assumed clean.

#### Stage A is built: [`tests/store-migration-registry.ts`](../../tests/store-migration-registry.ts)

**93 entries** — the 88 the dynamic witness watched, plus `tests/slug.test.ts` (the grep-only
candidate an import walk is structurally blind to) and files that arrived from `dev` *after* the
witness ran, each carrying `evidence: "static-only"` so the field says which witness backs each
verdict.

| category | n |
|---|---|
| `database-integration` | 33 |
| `filesystem-adapter-behaviour` | 24 |
| `shared-mechanism-collateral` | 23 |
| `store-agnostic-fake` | 13 |

**The fourth category survived, and our framing of it was too narrow.** We proposed
`ledger-collateral`: files that touch the filesystem store only because `selected()` in
[`ai-calls.ts`](../../src/store/ai-calls.ts) returns the filesystem ledger whenever
`NODE_ENV === "test"`. Checked rather than accepted, the ledger turns out to be **one of five such
mechanisms**, and the other two large ones are more interesting than it:

- **`step-context-paths` (7)** — `runStep` in [`jobs.ts`](../../src/jobs.ts) calls
  `contextPaths(job.slug)` **unconditionally, under either store**. That is why `fsLocations` and
  `dataRoot` show up on pure-Postgres suites. `ai-calls-fs.ts` never touches either; it resolves its
  own root.
- **`fixture-loader` (12, the largest)** — `tests/helpers/load-article.ts` copies fixtures into
  Postgres with `copyArtefacts` **from a `createFsArtifactStore`**, so twelve already-converted
  Postgres suites inherit both touches from one helper. **Stage D decides all twelve at once.**
- `ledger-redirect` (7), plus a `shared-symbol` and an `import-only`.

**The rule applied is that a file is collateral only if *every* recorded site is incidental** — a
genuine database test that also happens to write ledger rows stays `database-integration`. So the
category removes **23 files from the work**, not the dozen we guessed.

**The hard tail is named, and it is not the big files.** Around ten no-database queue and coordinator
suites each keep the **real** `fsJobStore` deliberately, and **each one's docstring states the reason
the migration falsifies**: `owner-jobs` says *"jobs never reach Postgres"*;
`all-skipped-publication-log` says *"no database at all, deliberately… so this cannot skip itself
into a green run"*. Every one then needs an `auth.users` row — 5 of 5 writes refused without one, per
stage C's spike. Two of them, `retry-is-only-for-a-failed-job` and `step-failure-seam`, additionally
assert on bytes read back **out of `data/_jobs/`** on purpose, because that is what a later request
sees. `jobs.test.ts` alone carries **26 filesystem sites across three adapters** and is the single
largest conversion in the inventory.

**And `referee-routes-postgres.test.ts` exists because its author deliberately avoided this.**
Pinning `referee-claims-routes` and `referee-criteria-routes` to Postgres would have cost them their
no-model guarantee, so a third file was written instead. **The hinge removes the option they chose**,
so both need the rewrite that was consciously dodged.

#### The guard, and the four things broken to prove it fails

`tests/store-migration-registry.test.ts`. Seven assertions; the one that matters is the **hole
check** — every file the import graph can reach is either in the registry, or recorded by the witness
as having run and touched nothing, or listed by the witness as unresolved. **No fourth way to be
accounted for.** It re-derives the static universe by running `store-migration-candidates.ts` as a
subprocess on every run: 17 seconds, **deliberately uncached**, because a cached answer is a claim
about the tree as it was and the tree moving is the entire reason the check exists.

Each of these was broken on purpose, watched failing by name, and put back:

| broken | what it said |
|---|---|
| a registry key renamed | `files the import graph says can reach a condemned module… ["tests/glossary-delete-then-rebuild.test.ts"]` — **this is the one that proves the graph walk actually ran** |
| another key renamed | `witnessed as touching the filesystem store, with no registry entry: ["tests/routes.test.ts"]` |
| a reason copy-pasted between two entries | `entries sharing a reason word for word: [["tests/block-roles.test.ts", "tests/tweets.test.ts"]]` |
| `evidence` removed from a static-only entry | `entries claiming dynamic evidence the witness does not have: ["tests/slug.test.ts"]` |

Three further controls guard the hole check itself, because **both set-differences are empty when
their inputs are empty**: an unread witness, an empty `ranAndTouchedNothing`, or a walk that parsed
nothing would each pass silently otherwise.

**A fifth red was unplanned and was a real find**: a placeholder ban list caught the word `unknown`
inside *"an unknown `questionId` is a 404"*. Loosened, with the reason recorded — **a ban list that
catches ordinary English trains people to reword good prose**, which is worse than the thing it was
guarding against.

#### Three the registry is least confident about, recorded rather than smoothed over

- **`store-roundtrip.test.ts`** — its export target (`src/store/export.ts`) survives while its
  *source* side dies. It needs a new left-hand side rather than a new claim, and somebody should
  decide what before stage G.
- **`store-pg-session.test.ts` case 6** proves the preflight reads `session.reads` and never the disk
  **by planting a good `arc.json` in `data/`**. With no disk, that control has to be *re-expressed*
  rather than dropped — dropping it is how the claim quietly becomes untested.
- **`helpers-load-article` and `load-article-serialisation`** are the loader's own tests, so they are
  stage D's to edit and fit none of the three original categories. `database-integration` was widened
  in the registry's docstring to mean *"it belongs on Postgres — the work is getting it there, or
  removing the filesystem half it still carries"*, and says so.

#### The stage-end review found four things, and three of them were real holes

[The review](260903f-delete-the-spideryarn-store-flag-stage-a-review-sol.md), 2026-09-03, with
reproductions rather than readings. **Everything below is fixed.**

**1 — "every Postgres store is guarded at its export" was still too strong.** `createPgSourceStore`
is an exported **factory** returning a live `SourceStore`, four tests call it directly, and it was
unguarded while the singleton beside it was wrapped. The shape check could not see it because it
scanned `export const pgX` and **a factory is neither**. Widening it to cover
`export function` and `createPgX` then found **four** candidates, of which three were guarded all
along and invisible to the *discovery* half for the same reason.

**A fixed-size window was the wrong bound, and wrong in the direction that matters.** The first
attempt looked 400 characters past a signature for `return guardDbStore(`; `pgStoreSession` guards on
its last line, **450 lines below**, so it was reported unguarded. It is now bounded to the
declaration. **`pgArtifactsIn` is the one genuine remainder** and is a declared exception: it is
built per transaction inside `pgStoreSession`, whose returned object *is* guarded, so every escape
route already goes through a wrapper — verified by checking it has no caller outside `pg-session.ts`.

**2 — both marks are forgeable, and we said otherwise. `Symbol.for` stays anyway.** The docstring
claimed *"this mark can only be put here"*; `Symbol.for` is a process-global registry and the
reviewer planted both marks without touching the repo, getting a raw error and its stack straight
through. **We did not switch to a private `WeakSet`, and the reason is module duplication rather than
security**: a dev-server reload makes a second live copy of every server module — that duplication is
the entire subject of `tests/store-fs-write-chains.test.ts` — and under a `WeakSet` a store guarded by
copy A would be re-wrapped by copy B, which is exactly the double-diagnostic bug D′1a removed. A
registry symbol survives duplication; private state does not. Against hostile in-process code there
is nothing to defend, since it could read the article directly. **What was worth fixing is the check**:
it used `in`, which accepts a mark **inherited from a prototype**, and now asks for an own property.
The docstring says what the mark actually promises.

**3 — the witness had a second blind spot, and it had produced a false negative.** *"The instrument
records calls, not reads."* A test importing a non-function export and merely reading it executes
nothing the proxy observes — `store-artefacts-pg` reads `PATHS` from `artifacts-fs` and was filed
under **"ran and touched nothing"**. We had told the reviewer there was one blind spot; there were
two, and the claim was in the JSON.

**The class was then bounded statically rather than by re-running**: a sweep for runtime imports of a
condemned module across every test file found **exactly one member**, now classified. The JSON
records both blind spots, says plainly that **`ranAndTouchedNothing` is not proof on its own**, and
the guard asserts both survive an edit.

**4 — two collateral verdicts broke the category's own promise.** `a-claim-that-lost-its-draft` and
`claim-session-postgres` both import `DATA_ROOT_ENV` **from `data-root.ts`**, so stage G cannot
delete that module without editing them — and `shared-mechanism-collateral` means *"some other stage
resolves this without anybody editing this file"*. Their store *use* really is incidental (the second
asserts its scratch roots are **still empty**, which is the opposite of a dependency), so a new
`condemned-symbol-import` mechanism records the exception rather than a fourth category papering over
it. The second file's assertions are load-bearing: **with no filesystem store there is no root to
prove empty**, so G must re-express them rather than drop them.

**And the count was 92, not 93.** Ours was miscounted off a grep that included the type declaration.

**One thing the review confirmed rather than corrected**, worth recording because it was a judgement
call: removing the slug from the seven refusal messages is right — *"they are title-derived reader
data, while the caller/request context already identifies the article."* As is keeping `guarded()`
redundant until the hinge, and removing it with the selector.

**The instrument is kept, not thrown away.** `vitest.witness.config.ts` and `tests/setup/fs-store-witness*.ts`
are listed in `tsconfig.json` beside 260903e's spike config and are **not** wired into
`vitest.config.ts`, so `npm test` never loads them. Witness 2 is a measurement with a date on it and
the tree keeps moving — it counted 588 test files and the walk saw 597 ninety minutes later. Whoever
re-takes it needs this. It dies with the filesystem store in G.

#### Witness 1 is built: [`scripts/store-migration-candidates.ts`](../../scripts/store-migration-candidates.ts)

A real import-graph walk over 1,160 first-party files — `.js`→`.ts` specifiers, the `@/` alias,
`await import()`, and `import type` tracked as an **erased** edge rather than a real one.
**192 test files reach a condemned filesystem module through an executable import; 45 more reach one
only across type edges and execute nothing.**

| bucket | n | what it is |
|---|---|---|
| `subject` | 46 | imports a condemned module itself — path length 1 |
| `fixture` | 15 | reaches one through `tests/helpers/…` |
| `app-survives-flag` | 41 | reaches one through `src/` modules that **never read the flag** |
| `flag-selection-only` | 90 | every path runs through a module importing `live.ts` |
| `type-only` | 45 | erased; nothing executes |

**The bucketing rule we proposed was wrong, and the witness checked instead of assuming.** We
guessed that a path through `src/store/index.ts` meant "incidental wiring". Only **23 of 192** reach
exclusively that way: `ai-calls.ts`, `upload-records.ts` and `jobs.ts` each select their own adapter
to dodge the import cycle, so they are three more hubs of the same kind — 181 tests reach
`ai-calls-fs` through `ai-calls.ts` against 71 through `index.ts`. The cut that works is **"remove
every module that imports `live.ts`"**, which is exactly the set the hinge deletes: a reach that
survives the cut is a real dependency, and one that vanishes is store selection.

**Neither witness subsumes the other, so the manifest needs both predicates rather than a union of
their outputs.** The walk finds **103 files the direct-import grep missed**. The grep finds
**`tests/slug.test.ts`**, which `readFileSync`s `jobs-fs.ts` as *source text* — structurally
invisible to an import walk, and already flagged in stage G as the test that goes red purely because
a file was deleted. And four of the 105 candidates are **false positives**: `deploy-checks`,
`doc-links`, `store-artefact-manifest` and `fixture-corpus` matched on the substring
`tests/fixtures/data-root/`, a path collision with the fixture directory rather than the module.

**The script found a silent success in itself, which is why its number is worth anything.** Its first
version reported 162 reaching tests and looked clean. This repo's `@babel/parser` emits `import()` as
a `CallExpression` with an `Import` callee rather than an `ImportExpression`, so **all 494 dynamic
edges were being dropped** — a smaller graph returning a plausible answer. It surfaced only from
cross-checking 42 `subject` files against a grep's 47 and chasing the gap. The script now throws if
it finds fewer than 100 dynamic edges, so the same loss cannot come back quietly, and it reports
unresolved specifiers rather than swallowing them (zero — proved by a deliberately broken control
that made the counter fire).

### T — the private test database, absorbed from 260903e

**Greg's decision, 2026-09-03**: rather than depending on
[260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md) or duplicating
it, this plan takes it over. **Read that document for the full design** — the evidence, the root
cause, the ordering trap, and Sol's review of it are all there and are not repeated here. Its
Stage A is on `dev` already. What is absorbed is its **Stages B–E**:

| from 260903e | what it gives this plan |
|---|---|
| **B** — `scripts/db-test-create.ts`, the database factory behind a spike config | stage C's isolation, structurally rather than by convention |
| **C** — the manifest assigning every Postgres-touching test to a lane | **merges with our stage A** — see below |
| **D** — three disjoint vitest projects, wired into `npm test` and `npm run check` | **the suite-registration abstraction D′2 was going to build**, and the destination of § *Making the database required* |
| **E** — pollution as its own verdict in `scripts/check.ts` | part of the negative control |

**The two manifests share a file but not a verdict** — and our first framing of this was wrong.

We said they were one manifest with two columns: ours classifies a test by *which store it touches*,
260903e's assigns it to a *lane*, both per-file verdicts over the same ~200 files. **Sol rejected the
literal merge and the counter-example is decisive.** 260903e's shared-services lane holds
`tests/auth-user-seeding.test.ts`, `tests/seed-admin-signin.test.ts` and `tests/admin-store.test.ts`
— all three are genuine Postgres tests, so the *store* verdict says nothing about them, and their
lane is decided by GoTrue reading `postgres` no matter what the SQL does. **A classification that
cannot predict its own exceptions is not the same classification.**

So: **one registry file, two separately typed maps, two completeness guards.** Co-location is worth
having; pretending one verdict implies the other is not. **The store inventory is finalised in
stage A. The lane map is finalised in T-C**, after the factory exists — because deciding a lane means
testing an assumption about a clean database, which cannot be done before there is one.

**What this costs, honestly.** 6–10 hours for B plus half a day for C–E, and 260903e's own risk note
says the tail of tests assuming seeded local state is why Sol estimated four days against Fable's one
and a half. This plan just got substantially bigger. It also got *shorter than the alternative*,
which was building most of this twice.

**And one cost that is ours, found by the ledger spike and not in 260903e:** every route or job suite
that records cost needs its owner row in `auth.users` — 5 of 5 writes refused without it. Add the
route families to 260903e's Stage C list rather than discovering them one at a time.

**Storage is not isolated** even when the SQL is, and 260903e says so: the bucket stays shared.
Acceptable because keys are content-addressed, but it is a stated limitation, not a thing a reader
should find out.

#### T-B is built — [`scripts/db-test-create.ts`](../../scripts/db-test-create.ts), 2026-09-03

**Reviewed by GPT Sol, which returned three blocking findings, and all five are folded in** —
[`260903f-test-database-factory-review-sol.md`](260903f-test-database-factory-review-sol.md). What
follows is the state *after* that round.

Nothing is wired into `npm test`; that is still T-D. A run is 4–5s (`createdb` + restore ≈ 1s, 65
migrations ≈ 3.7s), and [`tests/db-test-create.test.ts`](../../tests/db-test-create.test.ts) is 57
tests — **43 of them pure and always on, 14 gated**, measured both ways:

| | result | databases created |
|---|---|---|
| `npx vitest run tests/db-test-create.test.ts` | 43 passed, 14 skipped | **0**, checked against `pg_database` |
| `SPIDERYARN_TEST_DB_FACTORY=1 …` | 57 passed | 0 left behind afterwards |

**Four things 260903e assumed that turned out not to hold**, each measured rather than reasoned:

1. **There are no Postgres client binaries on this box's host.** `command -v pg_dump` finds nothing;
   the only `psql`/`pg_dump`/`pg_restore` are inside the Supabase container. So the tools run through
   `docker exec`, which is also the better answer — client and server are then the same build, so a
   version-skew refusal cannot happen. The container is found by matching `DATABASE_URL`'s published
   port and then **proved** by comparing `pg_control_system().system_identifier` over TCP with the
   one seen inside it. That is not defensive programming: `docker ps` on 2026-09-03 shows
   `supabase_db_hellozenno` on 54322 beside `supabase_db_spideryarn2` on 54362, so port-matching
   alone is a guess that agrees with itself.
2. **The restore has to run as `supabase_admin`, not `postgres`.** The dump carries six event
   triggers and `postgres` is not a superuser on a Supabase stack, so `--exit-on-error
   --single-transaction` correctly takes the whole restore down. The clone is still `OWNER postgres`,
   matching the shared database, so the migrator can create the `spideryarn` schema. Sol confirmed
   the split is sound: without `--no-owner`, `pg_restore` restores each object's original ownership,
   and the database owner can still create the new app schema.
3. **`pg_restore` does not "continue past errors and exit 0".** 260903e's gloss on the silent success
   was wrong in a way worth correcting: `pg_restore` exits 1 whenever it ignored an error, so the
   exit code was always sufficient to *detect* — the spike's mistake was grepping instead of reading
   it. What `--exit-on-error --single-transaction` buys is **atomicity**. Measured, restoring the
   real archive into a clone that already had an `auth` schema:

   | | exit | `storage.buckets` afterwards |
   |---|---|---|
   | no flags | 1 | **present** — a half-restored database that looks migratable |
   | with the flags | 1 | absent — rolled back |

   Sol adds that `--single-transaction` already implies `--exit-on-error`, so writing both is
   redundant. Kept anyway, because the pair states the intent.
4. **`spideryarn_test_spike` will never be scavenged**, because the safety rule dates a database from
   its own name and that name carries no date. Dropped by hand on 2026-09-03, and 260903e's risk note
   is answered.

##### The scavenger, after Sol: the fix was to stop asking Postgres to force anything

260903e's two fences plus a re-check were **not enough, and a re-check cannot be made enough.** The
scan and the re-read are both observations taken *before* the drop, so either can be stale when it
lands. Sol's sequence: run A is over six hours old and momentarily idle, both checks see zero
sessions, A connects, and `DROP DATABASE … WITH (FORCE)` terminates it.

**So the drop is split in two, and the difference between the halves is the whole safety argument:**

| | |
|---|---|
| `dropStaleTestDatabase` — the scavenger's | **plain `DROP DATABASE`.** Postgres refuses while any session is connected, so a late arrival makes the drop *fail*, which is the outcome we want. The refusal is returned, not thrown, and recorded as one more spared database with a reason. |
| `dropTestDatabase` — teardown | **`WITH (FORCE)`**, called only by the run that minted that exact database and is finished with it. |

**Reproduced, not reasoned.** Restoring `WITH (FORCE)` in the scavenger's half and re-running the
test that covers it did not merely fail an assertion — Postgres emitted
`FATAL 57P01 … terminating connection due to administrator command` and killed the connection the
test was holding open. On this box that connection is another agent's test run, and the symptom
lands in *their* worktree as unexplained red. The control refuses to run unless its anchor matches
exactly once, so a mutation that patched nothing cannot report success.

**This still does not make the six-hour rule mean "unowned", and the plan should not pretend it
does.** Sol's second sequence has no race in it at all: a run that is old but alive, sitting between
two lazily-opened pools, has zero sessions throughout. Age is presumed staleness, not ownership, and
a clock corrected forward by more than the threshold makes a brand-new database look old.
**The real fix is a lease** — the run holds one dedicated connection to its own database for its
whole life, so "somebody is inside it" becomes continuously true rather than sampled, and the
non-forced drop then refuses for the entire life of the owning run. **That is T-D's**, because the
lease has to be held by the run; a factory function cannot hold one.

Also from that finding: a non-finite or negative `olderThanMs` and an invalid `now` are now refused
outright — `NaN` silently defeated every age comparison — and `only` is documented as a **test
capability rather than a fence**, since it proves knowledge of a name, not ownership.

##### The configurable prefix is gone, because it was the injection surface

Reviewing the diff I found `dropTestDatabase` and `createEmptyDatabase` interpolating the database
name into a quoted identifier — `CREATE`/`DROP DATABASE` take no bound parameters — behind a
`startsWith` prefix check only, so `spideryarn_test_a"; …` satisfied the fence and closed the
identifier. Watched failing: the call came back `DROP DATABASE cannot run inside a transaction
block`, which is Postgres refusing the *chained* form rather than this file refusing the input — a
protection that belongs to `DROP DATABASE` being non-transactional, and one that would not cover an
interpolation site whose first statement is an ordinary one.

My first fix was `assertMintedName`, requiring the whole minted shape. **Sol reproduced a hole in
it**: `parseTestDatabaseName(name, prefix)` strips the *caller-controlled* prefix before validating,
and the prefix check only required it to *begin* with `spideryarn_test_`, so the payload simply moved
into the prefix.

**The fix was to delete the parameter, not to validate it.** It had no caller anywhere in the repo,
and its only uses were tests of a fence that existed solely because the parameter existed — a
circular justification. `TEST_DB_PREFIX` is now a module constant, which removes the parameter, the
fence, the injection surface and several tests together. Sol also agreed that refusing a legacy name
like `spideryarn_test_spike` from `--drop` is right: it lacks the evidence to be called
factory-owned, so removing one should stay deliberate.

##### The ledger check was a count, which is the third one today

`count(*) === journal.length` passes when one row is missing and another is duplicated. It now
compares **identities** — the journal's tags and drizzle's own sha256 of each `.sql` file against the
set the ledger holds — and `ledgerProblems` is pure over two lists, so the case a count cannot see
is exercisable without corrupting a real ledger. Control: reinstating the length comparison turned
`expected [] to deeply equal [ …(2) ]` — the identity version finds two problems where the count
finds none.

**That is the third instance of a length standing in for a list in one day**, after
`store-guarded.test.ts`'s "eighteen" over an array of twenty-one and this document's own drifting
counts. See § *Counts are perishable here*.

The migrator's `Target:` line is now parsed and compared by host, port and pathname rather than by
two independent substring searches.

##### The event-trigger rationale was overstated

The clone retains all six event triggers, which is still right — but the reason given was wrong.
**Only `pgrst_ddl_watch` and `pgrst_drop_watch` are notification-only.** The other four react to
extension creation and removal and can grant privileges, recreate the GraphQL placeholder, or create
a role. They are dormant here because our migrations create no extensions, which is a different and
weaker claim than "a `NOTIFY` nobody listens for", and it is the one the file now makes.
`archiveProblems` also asserts the inventory, so a **seventh** trigger appearing in the shared
database is a failure rather than a silent inheritance.

##### What T-C and T-D inherit

- `vitest.config.ts`, `package.json`, `scripts/check.ts`, `tests/store-migration-registry.ts` and
  `.env.local` are untouched.
- The integration half is run with `SPIDERYARN_TEST_DB_FACTORY=1` until T-D gives it a lane.
  `REQUIRE_POSTGRES=1` turns an unreachable stack into a failure rather than a skip **but does not
  opt in by itself** — `scripts/check.ts` sets it, and a gate that started creating databases
  because somebody ran `npm run check` is what this variable exists to prevent.
- `baseUrl()` is memoised on purpose, so T-D's setup file can overwrite `process.env.DATABASE_URL`
  with the private database without the scavenger following it to the wrong cluster.
- **The lease connection is T-D's**, per the scavenger section above.
- **Storage is still shared.** Not addressed here, and a stated limitation rather than an oversight.

#### T-C is built — the lane map, its guards, and the tail a clean database exposes, 2026-09-03

Still opt-in. `vitest.config.ts`, `package.json` and `scripts/check.ts` are untouched; the three
vitest projects and the wiring into `npm test` are T-D's and land in one commit after this.

What landed:

- **`TEST_LANES`** in [`tests/store-migration-registry.ts`](../../tests/store-migration-registry.ts)
  — one lane for each of the **93** test files that open a Postgres connection of their own. Four
  `shared-services`, 89 `private-postgres`.
- **`OWNER_AUDIT`** in the same file — one verdict per *(file, owner uuid)* pair. Sol's review
  turned this from a file-keyed exception list into a pair-keyed audit; see below.
- **Three guard cases plus a compiler check** — the third rebuilt after review — in
  [`tests/store-migration-registry.test.ts`](../../tests/store-migration-registry.test.ts)
  § *the test-lane map*, over a live static scan of every test file.
- **[`tests/helpers/seed-local-accounts.ts`](../../tests/helpers/seed-local-accounts.ts)** and its
  suite [`tests/seed-local-accounts.test.ts`](../../tests/seed-local-accounts.test.ts) — the one fix
  that removes 49 of the 54 reds, described below.
- One test fixed: `tests/admin-feedback-store.test.ts`, for a reason worth reading.
- The 260903e spike setup `tests/setup/spike-db.ts` (deleted in T-D) gained a real
  positive control (`current_database()`, not the name in the URL it wrote) and calls the seeder.
  **T-D promotes both halves into the private lane's own setup.**

##### The universe is 93 files, and the predicate is mechanical

Every test file whose *code lines* contain `pgReady(` or `new Pool(`/`new Client(`. 85 call
`pgReady`, 15 build their own connection, union 93. Comment lines are dropped, because 86 files
contain the string `pgReady` and only 85 call it — `store-seams-have-two-implementations` discusses
it in a paragraph. **`tests/db-test-create.test.ts` and `tests/migration-reconciliations.test.ts`
were invisible to a first draft that looked only for `pgReady` and `new Pool`**: they use `new
Client`, and the factory's own suite is the last file that should have been missed.

##### The four in `shared-services`, and how each was settled

| file | how decided |
|---|---|
| `tests/auth-user-seeding.test.ts` | **Measured.** Red on a private database: it seeds a row and asks `GET /auth/v1/admin/users` to list it, and GoTrue answers about `postgres`. `expected [ …(11) ] to include '6fece419-…'` |
| `tests/seed-admin-signin.test.ts` | Signs in through the Auth service. Same service, same database. |
| `tests/admin-store.test.ts` | **Reasoned, and the measurement is the argument for moving it, not against.** It is *green* on a private database while checking nothing: accounts come from GoTrue over HTTP so its `users.length > 0` control still fires, and every aggregate beside them is `?? 0` out of the empty clone. `typeof 0` is `"number"` however wrong the number is. |
| `tests/db-test-create.test.ts` | **Chosen by contract, not by a red, and the measurement says so**: 57/57 pass in the private lane as well as the shared one, because `dumpSharedSchema` hardcodes `-d postgres` and the host and port are the same either way. What is wrong is quieter — `baseUrl()`'s documented job is to mean *the shared database*, and in the private lane it silently means a clone, so the factory's own suite would be minting siblings of a clone and T-D's lane would create a database in order to create databases. The file whose job is to police the factory is the worst place to leave that ambiguity. |

**`tests/store-realtime-sessions.test.ts` is not among them, and 260903e's first list was wrong to
include it** — checked here rather than inherited. Its Postgres half seeds its own `auth.users` row
through `seedAuthUser` and drives `pgRealtimeSessionStore` over Drizzle; `Realtime` in the name is
the feature's, not the service's. **It passed on a private database, first time, unchanged.**

##### The tail is one row, fifty-odd times over

Ran 91 of the 93 one file at a time against a factory-minted database under `REQUIRE_POSTGRES=1`,
so a skip counted as a failure (`db-test-create` and `migration-reconciliations` were run
separately, being the two the first scan had missed). **54 red** — out of the 76 files that ran
before the seeder below existed; the last 15 of that run were already benefiting from it, so 54/76
is the bare-clone figure and the run's own 54/91 understates it.

The commonest failure by a wide margin, and it is the same line every time:

```
insert or update on table "articles" violates foreign key constraint "articles_owner_fk"
Key (owner_id)=(f4d08b58-…) is not present in table "users".
```

That id is not a fixture. It is the **ambient owner** — what `currentOwnerId()` answers outside a
request, from `SPIDERYARN_OWNER_ID` in `.env.local` (`src/owner.ts` § `environmentOwnerId`) — and
suites write rows owned by it without ever naming it, because `npm run db:seed-owner` put that row
in the shared database weeks ago and everything has been quietly borrowing it.

**47 of the 54 reds are a key into `auth.users`** — `articles_owner_fk`,
`ingest_events_owner_fk`, `ai_calls_owner_id_users_id_fk` and their siblings; 23 tables carry one,
and a schema-only clone can satisfy none of them. **Two more of the remaining seven are the same
cause wearing a different symptom**: `a-claim-that-lost-its-draft` fails an outcome assertion and
`claim-session-postgres` reports *"case 1 has to have published before this case runs"*, and both
went green on the seeder with no edit. **So 49 of 54, one cause.**

**So the fix is one place, not fifty edits.** `tests/helpers/seed-local-accounts.ts` writes the rows
a local database is *expected* to have — derived from `SEEDED_ACCOUNTS` in
[`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts), the repo's own declaration of what
`db:seed-owner` guarantees, plus whatever `SPIDERYARN_OWNER_ID` names if it is not one of them.
Derived rather than hand-copied, so a fourth account added there arrives for free — a hand-copied
list of ids is the shape that stopped `db:export` writing `shelf.json`.

The alternative considered and rejected: fifty files each calling `seedAuthUser` on the same id.
They would all say the same thing, drift separately, and bury the genuinely interesting owner
dependencies — a *second* owner, a fixture id — under fifty that are not interesting at all.

**What it costs, stated rather than discovered:** a private database is no longer a bare clone. It
carries three or four `auth.users` rows, so no suite can use it to prove *"this works with no
accounts at all"*. Nothing needs that today.

Re-run in full on a fresh database with the seeder in the lane setup: **86 of 91 green**, and one of
the five reds is `auth-user-seeding` failing exactly as its shared lane predicts.

**The three files 260903e named are the proof that it is one cause and not three.** All three were
red on a bare clone and green after the seeder, with **no edit to any of them**:

| | bare clone | with the seeder |
|---|---|---|
| `tests/store-checkpoints.test.ts` | red | green |
| `tests/store-artefacts-pg.test.ts` | red | green |
| `tests/blocks-baseline.test.ts` | red | green |

**And this is where the cost-recording families went.** § T says *"every route or job suite that
records cost needs its owner row in `auth.users` — 5 of 5 writes refused without it. Add the route
families to 260903e's Stage C list rather than discovering them one at a time."* They are all in
`TEST_LANES` — the scan takes every file that opens a connection, so there is no family to remember
— and the seeder is what satisfies them, because the owner they record cost against *is* the ambient
owner. `ai-calls-spend-pg`, `billing-admission`, `billing-quota-race`, `billing-settlement` and
`running-slot` are green in the private lane.

##### What is left after the seeder — the catalogued tail

| shape | files | what it needs |
|---|---|---|
| **`billing_tiers.stripe_price_id` is NULL in a clone** | `billing-checkout`, `billing-usage-route`, `plans-match-tiers` | The tiers themselves come from a migration (`20260902181004_seed_billing_tiers.sql`); the **price ids** are written by `npx tsx scripts/stripe-setup.ts --apply` against the shared database and are not in it. `offerableTiers` filters on `stripePriceId !== null`, so a clone offers nothing: two of the three throw `billing_tiers has no active 'reader' row with a stripe_price_id` from their own helper, and `plans-match-tiers` fails as `the table advertises "Reader" and no active tier sells it`. |

**The recommended fix for that family, not taken here — and the first version of this
recommendation was unsafe.** It said: backfill a plainly fake `price_local_test_…` onto the `reader`
row, **only when `stripe_price_id` is null**. GPT Sol found two defects, both certain, and this
paragraph is the corrected version.

- **Null is not evidence of a private database.** Null is the *legitimate* state on any machine
  where nobody has run `npx tsx scripts/stripe-setup.ts --apply` — a fresh clone of the repo, or the
  Mac. On such a machine the "safe" conditional fires against the shared `postgres` and **persists a
  Stripe price id that does not exist** into a developer's own database. Nullness cannot tell
  private from shared, and no refinement of it can.
- **`reader` is not the only tier.** `20260902181004_seed_billing_tiers.sql` creates `reader` *and*
  `researcher`, both `active`, both with a null price id, and `plans-match-tiers` requires every
  paid row the UI advertises to be offerable. Filling `reader` alone leaves `researcher` red — a fix
  that turns three failures into one and looks like progress.

So the safe version is: **positively prove the target is a factory-owned private database** — the
name matches what `scripts/db-test-create.ts` mints, and nothing weaker — then backfill **every**
active paid tier the UI requires, derived from what the page advertises rather than from a list of
tier ids somebody typed. Never infer privateness from the data.

None of the three suites asserts anything about a price id's *value*, so a placeholder preserves
each claim exactly: `plans-match-tiers` compares the website's copy against the `amounts` the
migration seeded, and the other two only need the route to have something to sell. Left for T-D
because it needs all three suites' Stripe stubs read, and now also because it needs the
private-database proof that only T-D's lane can supply.

**One found and fixed, and it is a third shape worth naming:**
`tests/admin-feedback-store.test.ts` § *says there are more only when it has seen one more* wrote
**one** feedback row and then asked for a page of `n - 1`. On the shared database the table always
held several, so that was a sensible limit; on an empty one `n` is 1 and `n - 1` is **zero**, which
the store legitimately clamps to one — so the length assertion failed on a suite that was already
careful enough to *measure* the count rather than assume it. The class is **boundary arithmetic that
is only non-degenerate because the table was not empty**, and measuring the count is not a defence
against it. Fixed by writing two rows, with the floor raised to `> 1` so the case cannot go
degenerate again silently.

##### Storage is not isolated, and the docs now say so

The private lane clones the SQL. The bucket does not move: `blobStore` talks to the Storage service
over HTTP and that service is bound to `postgres`, so two runs share one bucket and
`storage.objects` in a clone is permanently empty. Acceptable, because every key this repo writes is
content-addressed — two runs writing the same bytes write the same object. But it is a **stated
limitation** in `TEST_LANES`'s own docstring, not something a reader discovers:
**Two files reach it**, and the count was wrong twice before it was right —
`tests/helpers-load-article.test.ts` and `tests/source-store.test.ts`; see the review section
below for why the other three candidates do not.

##### The guards, and the violation planted in each

**Five reds, each watched and each naming what was broken.** The violation was a *new file* rather
than an edited line wherever it could be — `tests/zz-lane-control.test.ts`, one `pgReady(` call and
one literal owner uuid — because the line a control breaks is otherwise the least stable text in the
file and a peer may have edited it minutes ago.

| planted | what it said |
|---|---|
| the control file exists, with no lane | `test files that open a Postgres connection and have no lane in TEST_LANES …: [ "tests/zz-lane-control.test.ts" ]` |
| … given a lane, still no `seedAuthUser` | `files naming a fixed owner uuid … that neither seed it nor appear in UNSEEDED_OWNER_EXCEPTIONS …: [ "tests/zz-lane-control.test.ts" ]` — **the file-keyed guard this round replaced**; its pair-keyed successor's controls are in the review section below |
| … declared, with a nine-character reason | `the reason recorded for tests/zz-lane-control.test.ts: expected 9 to be greater than 40` |
| the control file deleted, its entries left behind | `TEST_LANES entries the scan does not find …: [ "tests/zz-lane-control.test.ts" ]` |
| the same, for the exception list | `UNSEEDED_OWNER_EXCEPTIONS entries that are no longer true …: [ "tests/zz-lane-control.test.ts" ]` |

**Those two rows are about the guard as first built, and it was replaced** — the owner half is
now pair-keyed, with five controls of its own. Kept rather than rewritten because a superseded
control that was actually watched is evidence about the *mechanism*, and quietly restating it as
though it had always been pair-keyed is how a record stops being one.

**And the sixth is the compiler's, which is why no vitest case looks for it.** *"A file in no lane or
in two"* was the brief; a `Record` cannot hold a file twice, so duplicating
`"tests/store-comments.test.ts"` with the other lane is not a runtime fact to assert on —
`npm run typecheck` answers

```
tests/store-migration-registry.ts(1174,3): error TS1117: An object literal cannot have
  multiple properties with the same name.
```

Watched, then put back. The guard case says where that half went, so the next reader does not
conclude it was forgotten.

**The scan's controls are in both directions.** Each assertion is a set difference, and a difference
is empty when its inputs are empty — a regex edited into never matching, or a moved `tests/`
directory, would pass all three in silence. So the scan must find more than 70 Postgres files, more
than 5 files naming a fixed owner uuid, and more than 5 seeding one, before any difference is
believed.

##### Six things 260903e § Stage C got wrong, and what was done instead

Its design held. Its inventory and its proposed scan did not, and the two errors pull in opposite
directions — the scan looks for the wrong thing, and the tail is far bigger than the three files
named.

1. **Sol's marker list misses the commonest case entirely.** It proposed grepping for
   `DEV_OWNER_ID`, `ADMIN_USER_ID_LOCAL`, `auth.users`, `SUPABASE_URL`, `blobStore` and `new Pool`.
   **The dominant failure has none of those markers**: it is `currentOwnerId()`, which names no id
   at all. Measured over the 76 files run before the seeder existed — 54 of them red — **only 20 of
   the 54 carry any of Sol's six markers. 34 do not**, and 19 of those 34 use `currentOwnerId()`,
   the rest reaching an owner through a helper. So the proposed scan would have found rather more
   than a third of the tail and vouched, silently, for the rest.
2. **`require every fixed owner … to call `seedAuthUser` or be a declared exception` is unusable as
   literally written.** Applied to every fixed owner it demands fifty declarations or fifty edits,
   and either way fifty entries saying the same thing. The version that earns its keep is narrower:
   the *lane* provides the accounts a local database is expected to have, and the guard covers the
   owners it cannot. **And the narrow version was still too coarse**: keyed by file it treated one
   seed call as covering every owner in the file, which Sol's review then caught. Pair-keyed, it
   is a couple of dozen entries — a list, deliberately without a total beside it, since this is
   the count that has now drifted four times.
3. **`new Pool` is not the whole pool predicate.** `tests/db-test-create.test.ts` and
   `tests/migration-reconciliations.test.ts` use `new Client`, so a scan for `pgReady` and
   `new Pool` misses both — including the factory's own suite, which is the last file that should
   have been invisible to a lane guard.
4. **`admin-store.test.ts` is in the shared lane for a different reason than the one given.**
   260903e says *"an empty clone yields no accounts"*. It does not: the accounts come from GoTrue
   over HTTP and GoTrue reads `postgres`, so the list is non-empty and the suite is **green on a
   private database while checking nothing**. The right reason is that its claim is about a join
   with one real side and one empty one.
5. **The shared lane has a fourth member 260903e does not list** — `tests/db-test-create.test.ts`,
   for the contract reason above.
6. **`store-realtime-sessions` really is not shared**, and this was checked rather than taken from
   the plan: it seeds its own `auth.users` row and drives `pgRealtimeSessionStore` over Drizzle,
   and it passed on a private database first time, unchanged.

##### The T-C review found one real hole, and it was in the guard rather than the manifest

[`260903f-lane-manifest-review-sol.md`](260903f-lane-manifest-review-sol.md), 2026-09-03. Verdict:
**would not ship the guards under the claim that they prove completeness.** It confirmed the
substance — no wrongly assigned private-lane suite; `store-realtime-sessions` correctly private; all
four shared assignments defensible including `db-test-create` by contract; the marker-scan
correction right; `environmentOwnerId` correct on a differently-configured machine, reproduced
including the invalid-uuid throw; and only one emptiness oracle in the tree, which is shared-lane,
so the baseline seeding invalidates nothing. What follows is what changed.

**1 — the owner guard was file-complete, not owner-complete.** It treated a `seedAuthUser(` call
anywhere in a file as covering **every** literal owner in it, and the witness was already in the
tree: `tests/store-jobs-parity.test.ts` declares `STRANGER` and seeds only `OWNER` and `OWNER_B`.
Safe today because `STRANGER` is read-only, and **green on the day that stops being true**.

Rebuilt as `OWNER_AUDIT`, keyed *(file, owner uuid)*, two verdicts:

| | |
|---|---|
| `seeded` | the file puts a row in `auth.users` for this owner. **Mostly checked, not promised** — the scan resolves each seed call's balanced-paren arguments plus one enclosing `for (… of […])`, and where it sees the owner there no reason is required. |
| `no-row-needed` | a foreign key is checked on **write**, and this owner is never on the writing side of one. Always with a reason, saying what the owner is for *and* what would change if that stopped being true. |

Keyed by uuid rather than by the constant's name, because the uuid is the identity the foreign key
checks — a renumbered constant goes stale and the guard says so — and the reason names `OUTSIDER` or
`STRANGER` out loud for the reader.

**Watched failing, with `STRANGER` as the witness**, before it was exempted:

```
fixed owners under the auth.users foreign key with no verdict in OWNER_AUDIT …
  [ "tests/store-jobs-parity.test.ts STRANGER 00000000-0000-4000-8000-0000000000b5" ]
```

Four more planted and watched, so every assertion in the case has been seen to fire by name:

| planted | what it said |
|---|---|
| a `seeded` verdict in a file with no seed call | `declared \`seeded\` in a file that contains no seedAuthUser or seedLocalAccounts call: [ "tests/zz-lane-control.test.ts" ]` |
| `no-row-needed` on an owner the scan sees seeded | `declared \`no-row-needed\` while the file demonstrably seeds them — the verdict is stale` |
| a verdict for a uuid the file does not contain | `OWNER_AUDIT entries the scan no longer finds — the constant was renamed, its uuid changed, or the file stopped naming a fixed owner` |
| a twelve-character reason | `verdicts that need a reason and have none …: [ "tests/source-store.test.ts 00000000-…c8" ]` |

**Detection is three rules, and each catches what the others miss** — which is the answer to *"why
not just one regex"*. (1) a uuid literal on a line that says `owner`: alone it missed `STRANGER` in
`store-uploads-parity`, declared without an `as OwnerId`. (2) a `const NAME = "uuid"` whose name is
later used in an **owner position** — `ownerId:`, `owner_id`, `setRequestOwner(`, `runAsOwner(`,
`as:`, `sub:`, derived from the seams rather than from a list of names somebody thought of, since a
fixture called `PROPRIETOR` would defeat a name list: alone it missed the inline literal in
`store-ai-calls`. (3) anything resolvable inside a seed window, which is also a *widening* — a row
put in `auth.users` is an owner by definition, and it is how `store-realtime-sessions`' second owner
arrives at all.

**And the counts drifted again — the fourth time in one day.** The report and the first draft of
this section said 20 literal-owner files, 10 of them seeding; Sol re-derived 18 and 9; the
pair-level scan says 18 files. **No total is written into `OWNER_AUDIT` or into this section**, per
§ *Counts are perishable here* — the entries are the list, and a number beside them is a second
claim that can be wrong on its own. The guard holds floors (`> 15` pairs, `> 5` seeded, `> 5` files
with a seed call) rather than pins, because a floor cannot go stale into a false green.

**2 — the lane guard is a syntactic inventory guard, and now says so.** Sol reproduced the inventory
independently and audited direct `pg` imports and `getDb()` use without finding an omission, so it
is not vacuous. But the predicate reads *text*, so it cannot see an aliased or namespaced
constructor, a helper of a file's own that connects elsewhere, a dynamic `import()`, or a transitive
`getDb()`. The docstrings on both `TEST_LANES` and `laneScan` now say that in as many words, and
name T-D's `DATABASE_URL`-poisoning obligation as the backstop — an over-claimed guard is worse than
a modest one, and this plan has spent a day on that class. Connection-opening **helpers**
(`pg-ready`, `corpus-lock`, `run-lock`, `lock-lifecycle`) were added to the scan as an import-
specifier match; re-derived, they add **nothing today** — every file importing one also calls
`pgReady(` or builds a pool — so it is a forward guard, and saying so is the point.

The first version of that clause matched the bare helper names and **flagged the guard file itself**,
which contains them in its own array. Caught on the first run; matched as an import specifier now.

**3 — the Stripe backfill recommendation was unsafe and is rewritten**, above. Both defects were
real: nullness cannot tell a private database from a shared one, and `researcher` is active with a
null price id beside `reader`.

**4 — `admin-store`'s oracle could be vacuous, and now cannot.** Sol's point: it requires non-empty
auth accounts while every aggregate accepts zero, and `pg-admin.ts` fills a missing `group by` row
with `?? 0` — so on a database where nobody has uploaded anything, all seven counts are the literal
`0` this file supplied, never the string node-postgres hands back for `bigint`, which is the entire
bug the file was written for. Added: a per-run owner seeded through `seedAuthUser`, four `uploads`
rows of which exactly **three** are `verified`, and `expect(mine?.uploads).toBe(3)`. Exact equality
rather than `>= 1`, because `"3" >= 1` is true in JavaScript — the same trap the file's own header
records about `"3" > 2`. `uploads` because it is the only aggregate needing no article, no revision
and no `onTheShelf()`. Per-run id and a `finally` that removes both the rows and the account,
because this suite runs against the shared `postgres` that peers are inside.

**Proved both halves, with one mutation.** Replacing `count()` with an unmapped
`sql<number>\`count(*)\`` in `pg-admin.ts` § `uploads` — the original bug, reinstated:

| run | result |
|---|---|
| shared `postgres` | `expected '3' to be 3`, and the pre-existing `typeof` case also went red *because this box happens to have uploads for the dev admin* |
| a factory-minted clone | **the two pre-existing cases passed** while the bug was live — Sol's vacuity point, measured — and the new case failed |

The clone run also produced independent confirmation of the lane: the new case failed as
`the seeded account 3e10b9ea-… is not in the admin list`, because the row went into the clone while
GoTrue reads `postgres`. That is `admin-store` belonging to `shared-services`, said by a failure
rather than by an argument. Mutation reverted; `src/` is clean.

**5 — three exception reasons were wrong, and one of them was wrong in the file itself.**

- **`export-route` was backwards.** It said seeding the outsider would let the 404 arrive for a
  second reason; it would *remove* one — *"the requester does not exist"*. And the suite already has
  better evidence: the owner goes through the same path for a 200, and removing the ownership
  predicate was watched answering 200 for the outsider too. **The wrong reasoning came from that
  file's own docstring**, which claimed seeding a second owner would mean driving GoTrue's admin API
  — it would not; `seedAuthUser` inserts directly over the same connection and touches no service.
  Corrected in `tests/export-route.test.ts` as well as in the audit.
- **`public-visibility-pg`'s outsider is not read-only** — it is the `as:` of a `PUT`. What makes it
  safe is that the `UPDATE` carries `owner_id = OUTSIDER` in its `WHERE`: no row matches, nothing is
  written, the id never lands in a column. `store-uploads-parity`'s `STRANGER` is the same shape
  through `claim({ owner })`, and its entry says so.
- **`owner-isolation` conflated two roles.** Alice and Bob are request-context identities for the
  `AsyncLocalStorage` half; the persisted fixture is owned by the ambient owner. Each of its three
  pairs now says which job it belongs to.
- And **`seedAuthUser` is not "driving GoTrue"** anywhere any more.

**6 — the Storage count was wrong twice, and the second answer was Sol's.** The registry said three
files reach the real bucket; Sol said one. **It is two.** Five suites mention `src/store/blobs.js`:
`illustrated-route` and `store-export-bundle` `vi.mock` it (the second to a store that *throws* on
any read), and `store-export-raw` imports only a type — so Sol is right about those three. But
`tests/source-store.test.ts` calls `storeRawSource(bytes, kind)` with its **default third
argument**, which is `blobStore()`. Nothing in the file says "bucket", which is why one count
missed the mocks and the other missed the default. The way to see it is to follow what `blobStore()`
is *called by*, not what a test file mentions — recorded in `TEST_LANES`'s docstring with both
wrong answers, because the shape of the mistake is the useful part.

##### What T-C deliberately left for T-D

- **`vitest.config.ts`, `package.json` and `scripts/check.ts` are untouched.** Three disjoint
  projects and the wiring into `npm test` land in one commit, per Sol's blocking finding that B and
  C cannot be separated.
- **An obligation, not a suggestion: the unit project must delete or poison `DATABASE_URL` after
  `.env.local` has loaded.** The lane scan is a *syntactic* inventory guard — it reads the text a
  file contains, so it cannot see an aliased constructor (`new PgPool()`), a helper of a file's own
  that connects elsewhere, a dynamic `import()`, or a transitive `getDb()` inside application code.
  A test that escapes it today reaches the shared database and passes, silently. Poisoning
  `DATABASE_URL` in the unit lane is the **semantic backstop** that a syntactic guard cannot be, and
  it costs one line in a setup file. *After* `.env.local` has loaded, for the ordering reason in
  260903e § *The ordering trap* — before it, the file simply puts the shared URL back.
  A transitive-import guard is **not** an alternative and should not be tried: Sol measured of the
  order of a hundred and fifty test files outside the lane map that can *reach* a module importing
  `pg`, nearly all of them legitimate unit tests that mock it or never execute that path, so a
  manifest built that way would cover half the suite and mean nothing.
- **The lease connection** (T-B's scavenger section) — a factory function cannot hold one.
- **Promoting `tests/setup/spike-db.ts`** into the private lane's real setup: the ordering, the
  `current_database()` control and the `seedLocalAccounts` call, none of which changes.
- **`docs/project/testing.md`** — 260903e § Stage F says explicitly to update it *alongside*
  activation rather than after it. T-C changes no behaviour, so documenting a lane nothing selects
  yet would be wrong in the other direction. The Storage limitation is stated in `TEST_LANES`'s own
  docstring in the meantime.
- **The `billing_tiers.stripe_price_id` family**, above, with the recommended fix and its trap.
- **Residue within one run.** The private lane is one database for the whole invocation, so a row an
  earlier file leaves behind is visible to a later one. Per-run isolation removes dev servers,
  peers, and residue from killed runs — not the run's own. Nothing in the 93 currently depends on
  it, and 260903e's Stage G (per-worker) is where that changes if it starts to.

#### T-D is built — three lanes, a lease and a poison, and `npm test` moved, 2026-09-04

**This is the first stage anybody else can see.** Everything before it was opt-in; this one changes
what `npm test` does in every worktree, so the numbers below are the deliverable rather than the
decoration.

What landed, in one change:

- **[`vitest.config.ts`](../../vitest.config.ts)** — three disjoint projects, their file lists
  **derived from `TEST_LANES`** rather than restated. `unit` includes everything and subtracts the
  two database lanes; `private-postgres` and `shared-services` include exactly their keys. A floor
  (`< 50` private, `< 3` shared) refuses to build a config out of an import that returned nothing.
- **[`tests/setup/private-db-global.ts`](../../tests/setup/private-db-global.ts)** — one database
  per run: scavenge, mint, **lease**, seed, `provide`; drop on teardown.
- **[`tests/setup/private-db.ts`](../../tests/setup/private-db.ts)** — per file: redirect, then
  assert `current_database()` **and** the lease.
- **[`tests/setup/shared-db.ts`](../../tests/setup/shared-db.ts)** — per file: assert `postgres`.
- **[`tests/setup/unit-no-database.ts`](../../tests/setup/unit-no-database.ts)** plus
  [`tests/helpers/unit-lane-poison.ts`](../../tests/helpers/unit-lane-poison.ts) and
  [`tests/unit-lane-has-no-database.test.ts`](../../tests/unit-lane-has-no-database.test.ts) — the
  poison, its value, and the in-tree control that proves the poison is applied.
- **[`tests/helpers/seed-private-billing-prices.ts`](../../tests/helpers/seed-private-billing-prices.ts)**
  — the `billing_tiers.stripe_price_id` family T-C left, with Sol's fence: privateness is *proved*,
  never inferred from nullness, and every active tier is filled rather than `reader`.
- **`LANES_BEYOND_THE_SCAN`** in the registry, with four controls — see *health.test.ts* below.
- `docs/project/testing.md` § *Three lanes, and which one your test is in*.

##### The acceptance, both arms, one hold

260903e § Stage D, re-run rather than inherited. `scripts/spike-hold-singleton.ts` held the
**shared** database's `queue_state` singleton for 200s, and `tests/store-jobs-parity.test.ts` ran
once against each database inside that window:

| arm | database | result |
| --- | --- | --- |
| **A** | the run's private clone | **99 passed, 1 skipped, 0 failed** |
| **B** | the shared `postgres` | **43 failed**, 56 passed, 1 skipped — **32 `TEST DATABASE CONTENDED` banners** |

Same file, same minute, same contention; only the database differs. Arm B is also the positive
control for arm A: had the redirect silently not happened, A would have looked like B.

##### What it costs, measured, and it is not free

All on the Hetzner box, same tree, load average 10–25 throughout (it is shared, and this is not a
laboratory — if anything the baseline had the *busier* box):

| | files | result | wall clock |
| --- | --- | --- | --- |
| before — one project, `git show HEAD:vitest.config.ts` | 626 | 5 failed / 620 passed / 1 skipped | **267s** |
| after, run 1 — three lanes | 626 | 8 failed / 617 passed / 1 skipped | 436s |
| after, run 2 — after the health lane and the billing backfill | 626 | 6 failed / 619 passed / 1 skipped | 465s |
| after, run 3 — after `livemode`, and the two doc links the deletions broke | 626 | **4 failed** / 621 passed / 1 skipped | 471s |

**`npm test` is roughly 170–200 seconds slower — call it 1.6–1.8×** — and the whole of it is the
serialised private lane: the unit and shared lanes finish in ~130s, and the 90 private files then run
one at a time for ~305–340s. Creating the database is 4.2–5.0s of that; the rest is 90 sequential
forks, each paying its own import cost where sixteen workers used to share it. A *filtered* run pays
nothing at all: `npx vitest run tests/arc.test.ts` is 1.2s and creates no database.

The four still red in run 3 are the four that were already red before the stage — see below.

**That is the price 260903e chose** — *"Serialise the private lane for v1. Slower is acceptable;
reproducible is the point."* It is worth knowing that the cheaper setting is one line
(`fileParallelism: false` → a small `maxWorkers`), and that a *parallel* private lane would still be
strictly more isolated than what we had this morning, since the dev servers and the peers are
outside it either way. Left serial, because that is the decision on the page and this is not the
stage to revisit it. **Greg's call if five minutes turns out to be the wrong trade.**

##### Every guard was watched failing, and one of them was wrong when it passed

| guard | how it was broken | what it said |
| --- | --- | --- |
| the private lane's redirect | the assignment moved above `src/env.ts`'s module load (a dynamic `import()` underneath it) | `this setup wrote spideryarn_test_260904055918_… and the suite reached postgres` |
| the lease | `await lease.end()` immediately before the `provide` | `no lease connection is inside spideryarn_test_…: nothing in pg_stat_activity is called spideryarn-test-lease-199448` |
| the shared lane's identity | a temporary config gave `auth-user-seeding` the *private* setup as well | `this file is in the shared-services lane and must run against postgres, and it reached spideryarn_test_…` |
| the unit lane's poison | the assignment moved above `src/env.ts`'s module load | `expected 'postgresql://postgres:…@127.0.0.1:54362/postgres' to be 'postgresql://unit-lane:none@127.0.0.1:1/…'` — **and the connection case then connected to the shared database**, which is the whole failure in one line |
| … its self-exclusion from `TEST_LANES` | `SELF` pointed at a file that is in the map | `expected [ 'tests/admin-store.test.ts', …(93) ] to not include 'tests/store-comments.test.ts'` |
| `LANES_BEYOND_THE_SCAN`, four ways | a missing file; an exempted file with no lane; an exemption the scan *does* find; a nine-character reason | each named itself; the third is the one that matters — `declared beyond the scan, and the scan now finds it — delete the exemption` |
| the stale-entry direction, unchanged by the new clause | `tests/arc.test.ts` given a lane and no exemption | `TEST_LANES entries the scan does not find …: [ 'tests/arc.test.ts' ]` |
| the private setup running with no `globalSetup` behind it | a config listing `private-db.ts` and no global setup | `the private lane's setup ran without its globalSetup — nothing provided privateDatabase` |

**And the first version of the private lane's control could not have failed.** It opened its
`Client` on `db.url` — the string the setup had just been handed — and asked *that* connection what
its name was, which is a question with one possible answer. The redirect mutation above passed
against it. It now connects on `process.env.DATABASE_URL`, the way the suite will.
**`tests/setup/spike-db.ts` had the same shape**, so 260903e's *"positive control"* — the one its
own § Stage B insisted on — could not in fact have caught the ordering trap it was written for.
That is two files in one day where the control shared its input with the thing it was checking.

##### The ordering trap is real and the plan's wording is loose about it

Both plans say the redirect must come *"after `.env.local` has loaded"*. Measured three ways, the
boundary is **`src/env.ts`'s module load** — where `INHERITED` is snapshotted — and not the
`loadEnvLocal()` call:

| where the assignment goes | poison survives? |
| --- | --- |
| after the static `import`, after `loadEnvLocal()` | yes |
| after the static `import`, **before** `loadEnvLocal()` | yes |
| **before** `src/env.ts` is loaded (dynamic `import()` underneath it) | **no** — `.env.local` wins, silently |

A plain `import` at the top of a setup file therefore makes the ordering safe by construction, and
`DATABASE_URL=… npx vitest` is the third row and cannot be made to work. The silence is the
dangerous part: `src/env.ts`'s shadowing warning is gated on `NODE_ENV !== "test"`, and vitest sets
`NODE_ENV=test`.

##### The poison found an escapee on its first run, and it is `tests/health.test.ts`

The point of the backstop, arriving on schedule. `tests/health.test.ts` calls no `pgReady(`, builds
no pool and imports no `pg` — the lane scan cannot see it — and it reaches Postgres through the
health handler's own `getDb()`, reading the migration ledger. It had been quietly using whatever
database the box happened to have; under the poison it failed four times with *"the migration ledger
could not be read"*. Its own comment had admitted the dependency all along: *"with a full
environment **and a populated shelf** there is nothing left to complain about"*.

It is **28/28 in the private lane, unchanged**. Giving it that lane needed a door in the
completeness guard, because `TEST_LANES` was defined as *exactly* the scan's universe in both
directions — so `LANES_BEYOND_THE_SCAN` is a per-file declaration, with a reason, that the guard
itself polices: the file must exist, must have a lane, must **still** be invisible to the scan (an
exemption that goes stale is deleted, not kept), and must carry a real reason. Four controls, all
watched.

**That door is the shape to watch.** One entry is evidence the design works; a page of them would
mean the syntactic scan had stopped being a useful approximation, and the answer then is a better
predicate rather than more entries.

##### The lease, in both directions

Sol's blocking finding on T-B was that "old enough *and* nobody inside it" samples an instant, and a
live run between two lazily-opened pools has zero sessions. Measured on 2026-09-04, with
`scavengeTestDatabases({ only, olderThanMs: 0 })` — the age fence deliberately defeated, so the only
thing left is somebody being inside it:

| | `pg_stat_activity` | the scavenger |
| --- | --- | --- |
| a run in progress, mid-file, no test connected | **1 session** — the lease, and nothing else | `spared … 1 session(s) are still inside it` |
| a database minted by the CLI with no lease | 0 sessions | **dropped** |

The first row is exactly Sol's sequence, and the lease is the only reason it is a 1.

##### Two other things a clean database wanted

- **The Stripe price family**, which T-C catalogued and left. Three suites went red on the first
  full run (`billing-checkout` ×16, `billing-usage-route` ×8, `plans-match-tiers` ×1) and are green
  with the backfill. The fence is Sol's: `current_database()` must equal the name the factory
  minted **and** satisfy `assertMintedName` before a row is written, so nullness chooses *which*
  rows and never *whether*; and every active tier is filled, not `reader` alone.
  **And it is two columns, not one** — `resolveSellableTier` refuses on
  `!tier.stripePriceId || tier.livemode === null` and answers the same 503 either way, so the first
  version of the backfill turned sixteen failures about a missing price into sixteen about a missing
  Stripe key. `livemode = false`, because a placeholder is a test-mode price. Both columns are
  written with `coalesce`, so a row that already has one keeps it.
- **Nothing else.** T-C's seeder covered the rest, which is the retrospective argument for having
  done it in one place.

##### What `npm run check` needed: nothing

Its `test` gate is `npm run test` under `REQUIRE_POSTGRES=1`, so the lanes arrive through it
unchanged. Under that flag an unreachable stack now fails the run in `globalSetup` rather than
skipping 90 suites, which is the direction § *Making the database required* is going; without it the
lane provides `null`, the per-file setup poisons `DATABASE_URL`, and the suites that go through
`pgReady` skip and say so. **The ones that do not, do not** — see *What Sol's review changed* below;
a dozen private-lane files fail with the stack off, and did so before the lanes existed too.
**Stage T-E — pollution as its own verdict in `scripts/check.ts` — turns out not to be buildable where it says**; see § *T-E — measured before it was built* below.

##### Deleted, and what was kept

`tests/setup/spike-db.ts` and `vitest.spike.config.ts` (replaced by the private lane; the tsconfig
entry that named the second one went with it), and `scripts/spike-migrate-to.ts` (replaced by
`migrateInto` inside the factory). Nothing outside `docs/plans/` referenced any of them.

**`scripts/spike-hold-singleton.ts` and `scripts/spike-contended-claim.ts` were kept**, and that is
a decision rather than an oversight: neither has a replacement, and they are the instruments that
produce the A/B table above and Stage A's contention evidence. A stage that deletes the only way to
re-run its own acceptance is not tidy.

##### Four things about the shape of the run, which 260903e could not have known

1. **A project's `globalSetup` does not run when the filter excludes every one of its files.**
   Measured: `npx vitest run --project unit tests/arc.test.ts` and `npx vitest run
   tests/doc-links.test.ts` create no database. The edit/test loop on a unit test pays nothing.
2. **Vitest 4 hands `globalSetup` the `TestProject`**, not the `GlobalSetupContext` every 2.x-era
   example shows, and `inject()` works in a `setupFiles` file — which is what makes one database per
   run reachable from 90 workers without an environment variable.
3. **The projects do not interleave.** The unit and shared lanes ran to completion first and the
   private lane followed, so the wall clock is a sum rather than a maximum. That is where the 169
   seconds are.
4. **`vitest.witness.config.ts` had a guard on `vitest.config.ts`'s exact text** (`setupFiles:
   ["./tests/setup/no-provider-calls.ts"]`) which the three projects broke. Narrowed to the path,
   and the file now says out loud that it reproduces no lanes — a Postgres suite run through it is
   on the shared database.

##### What is still red, and it is not this stage

Four files fail identically before and after, on this tree: `tests/client-imports.test.ts`
(a client module reaching out of `src/web`), `tests/cold-start-lazy-imports.test.ts` (`jsdom` at
module scope again), `tests/fixture-ids.test.ts` (two uuids in two files) and
`tests/paid-cli-ledger.test.ts` (`unscoped` spend declarations diverged from `ADMITTED`). They are
not database failures, none of them moved across the four runs above, and they are what run 3's
`4 failed` is.

**Three of the four on the run before the push, and the fourth sentence above was wrong.** The
2026-09-04 09:26 run — the one `ae5ed824` was pushed on — is `3 failed | 630 passed | 1 skipped`
of 634 files in 444s: `fixture-ids` has been fixed on `dev` since. And this document blamed
`paid-cli-ledger` on *"the untracked `scripts/stage.ts` in this worktree"*, which was a guess that
was never checked. The assertion names `dictation-bench-models` and `dictation-gate-models` —
`unscoped` declarations that arrived from `dev` in another worktree's work, and nothing to do with
the spike sitting here. **A red attributed by plausibility rather than by reading its message is
the same failure as a green nobody checked**, and it survived two runs of this document.

##### A fourth red appeared once, and it is a filesystem race in one of stage B's own 26

`tests/step-failure-seam.test.ts` failed on the 2026-09-04 11:08 full run and **has not failed
since**: it passes alone, and it passes in a complete `unit`-lane run of 529 files. The distinguishing
condition is load — that run took 651s against 444s for the one before it, because other worktrees
were busy.

The assertion is `row.error` coming back `undefined` from `persisted()`, which scans `data/_jobs/`
and **found the file**. So the file existed and its `error` field did not yet: a read-after-write on
the filesystem job store that a slow enough box loses.

**It is recorded rather than dismissed, and rather than chased**, for three reasons. It is not in
either stage's files and cannot be reached by anything they changed — it is a `unit`-lane test with a
poisoned `DATABASE_URL`. The seam it tests was rewritten by another worktree in `b0556bd7`, merged
here at 09:33 the same morning. And it is one of stage B's own 26, and one of the three the pilot
flagged as outliers *because it asserts on bytes read back out of `data/_jobs/`* — so **the race is
in the store this plan deletes, and converting the file is what removes it.** Chasing it now would be
fixing something on its way out; leaving it unnamed would be the thing this document keeps objecting
to.

**And two of the reds along the way were this stage's own**, worth recording because both were
invisible until a full run: deleting `tests/setup/spike-db.ts` and `scripts/spike-migrate-to.ts` left
a dangling link in each of 260903e and this file, which `tests/doc-links.test.ts` caught; and the
first `billing_tiers` backfill filled one of the two columns the route needs. A deletion is not
finished until the link checker has run.

##### What Sol's review changed, 2026-09-04

Sol's verdict on the built stage was *"I would not activate T-D unchanged"*, with three P1s. All six
findings are answered; the review is
[260903f-test-lane-activation-review-sol.md](260903f-test-lane-activation-review-sol.md).

| # | finding | what was done |
| --- | --- | --- |
| P1-1 | **the `unit` lane reached the real shared Storage.** The poison covered `DATABASE_URL`; `blobStore()` chooses Supabase Storage from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, which this box has. Four files were using it, one of them re-planting a single canonical key with corrupt bytes | the unit lane poisons `SUPABASE_URL` too, and **six** files get `private-postgres` plus a `LANES_BEYOND_THE_SCAN` entry each — Sol's four, and two the new poison found on its first full run |
| P1-2 | **a child process lost the poison.** It becomes part of the child's own `INHERITED` snapshot, so `.env.local` beats it — silently, under `NODE_ENV=test` | `PINNED` in [`src/env.ts`](../../src/env.ts): a variable naming what `.env.local` may not write. A variable is inherited; an assignment is not |
| P1-3 | **every factory error was reported as "Docker is off"**, and `health.test.ts` failed rather than skipping | `StackUnreachable`, raised only by the three places that can mean nothing else; and a real `pgReady` gate on the four health cases that assert the warning list is empty |
| P2-4 | **the shared lane's identity control accepted any database named `postgres`** | plus `projectMismatch(DATABASE_URL, SUPABASE_URL)` — the repo's existing same-stack check, which locally is the port |
| P2-5 | a post-`CREATE` failure leaked a database outside the cleanup fence | creation moved inside the `try` |
| P3-6 | `why.length` accepted forty-one spaces | `why.trim().length` |

**Every one of those was watched failing.** The two worth quoting:

```
AssertionError: the child's DATABASE_URL:
  expected 'postgresql://postgres@127.0.0.1:54362/postgres' to contain
  'this_test_is_in_the_unit_lane_and_may_not_use_a_database'
```

— the subprocess control, with the `PINNED` line deleted: a unit test's child on the shared database.
And, pointed at the *other* local Supabase stack's `postgres`, the shared lane's original control
printed `the first control reached postgres` and was satisfied, while the new one said
`DATABASE_URL is on port 54322, not 54362`.

**Three corrections to the review, none of which changes what was built.**

- **`assertSameCluster` is the wrong machinery for P2-4**, though it does the `system_identifier`
  comparison the finding asks for. It locates its container *by the port in `DATABASE_URL`*
  (`findPostgresContainer`), so pointed at the other stack it finds the other stack's container and
  agrees with itself. Reused there, it would have been a tautology — the thing the review was
  checking for.
- **`unset SUPABASE_URL` would have been the wrong fix**, and worse than the bug: `blobStore()` falls
  back to the filesystem adapter when either credential is missing, so the lane would have got a
  *working* store writing under `data/_blobs/` — a test meant to exercise Storage passing having
  exercised the store this plan exists to delete. The poison is a URL for that reason, and the
  control asserts the adapter's identity as well as the failure.
- **T-D did not make Docker-off red; it already was.** Measured with `DATABASE_URL` on a dead port:
  **12 private-lane files fail** rather than skip, and **9 of the same 10 sampled fail identically
  under `HEAD`'s single-project config**, which is the world before the lanes. `health.test.ts` was
  4-failed under that config too. So the sentence in `private-db-global.ts` promising a clean skip
  was false when it was written, rather than falsified by this stage — the same *prose outliving its
  subject* class as B0 below. It is now corrected there and in
  [testing.md](../project/testing.md), rather than re-promised.

**The poison earned its keep on the day it was widened.** Sol found four Storage files by reading
the lane map against `src/store/blobs.ts`; running with `SUPABASE_URL` poisoned found
`tests/job-failure.test.ts` and `tests/acquire-extract-blocks-end-to-end.test.ts` as well, and the
second of those **names no store at all** — it reaches the bucket through the pipeline's acquire
step, three modules down. No reading of the map could have found it, which is the argument for a
semantic backstop restated with a fresh example.

**Not fixed, and Greg's call.** Those dozen files reach the database from fixtures outside any
`pgReady` gate, and the four Storage files have no readiness gate at all — with Docker off they fail
on `ECONNREFUSED` from `fetch`. Making Docker-off genuinely green is a change to a dozen files with
no bearing on the store flag, and § *Making the database required* is heading the other way anyway.

#### T-E — measured before it was built, and the spec does not survive the measurement

260903e's Stage E was written **before** its Stage D existed, and reads:

> In [`scripts/check.ts`](../../scripts/check.ts), before the test gate: `select application_name
> from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`. Any row
> means somebody is inside *my* test database — name them and fail as **polluted**, which is a
> different answer from red. **Exact only once the database is private.**
>
> Make the gate print the database it reached and refuse to run its Postgres gate against
> `postgres`, so a shared-database green stops being representable.

Its own last clause is the warning, and the thing it warns about has now happened. `scripts/check.ts`
runs *before* it spawns `npm run test`, and the private database is minted **inside vitest's
`globalSetup`** — so at the moment the check would run, `current_database()` is the shared
`postgres`, and the rule is being applied to the one database it explicitly does not hold for.

##### What the two measurements say

**Three runs found the minted database empty at teardown — and *"every time"*, which is what this
paragraph used to say, does not follow.** It holds when the last file to run closes its pool, and
all three of these did. See § *The zero was true and unrepeatable* below; the sentence is left
standing with its correction attached because generalising from three runs is the failure this plan
keeps finding, and it is worth one instance of its own. Instrumented in
[`private-db-global.ts`](../../tests/setup/private-db-global.ts) on the lease's own connection,
2026-09-04:

| run | files | tests | non-lease sessions at teardown |
| --- | --- | --- | --- |
| 3 files | `store-checkpoints`, `run-lock`, `pg-ready` | 40 passed | **0** |
| 15 files | a spread across the lane | 260 passed | **0** |
| **the whole lane, 99 files**, exit 0, 380s | | 1566 passed, 1 skipped | **0** |

No leaked pools and no strangers.

**The sentence that stood here was wrong, and it is left named rather than quietly swapped.** It
said the name *"is handed out only through vitest's `provide`/`inject`, so there is no channel by
which a process outside the run learns it"*. GPT Sol refused it, and it is refuted by this file's
own behaviour: `private-db-global.ts` **prints the name to stderr**, it is listed in `pg_database`
and in `pg_stat_activity`, it is in every worker's environment and is inherited by any child they
spawn, and every worktree on this box connects with the same local superuser credential. The uuid
buys **accident-resistance, not access control** — the same distinction `ScavengeOptions.only`
already makes about itself in `scripts/db-test-create.ts`, in a comment written by this plan two days
ago and not applied here. `dropTestDatabase` carries the equivalent claim and needs the same
correction.

**And the private lane does write to the shared `postgres`.** Its six Storage files go through the
shared Storage API, which writes `storage.objects` *there* — so "the private lane touches only its
own database" is false, and `SUPABASE_URL` staying live means a misclassified private test could
reach GoTrue or PostgREST too. Nothing currently does; nothing structurally prevents it.

**And the shared `postgres` is never empty.** Five samples over six minutes:

| | rows | what they were |
| --- | --- | --- |
| at rest | **11–12** | the Supabase stack itself: `cluster_node_realtime` ×2, `supabase_mt_realtime` ×4–5, `PostgREST 16.1`, `Supabase Storage API` ×1–4, `pg_cron scheduler`, `pg_net` |
| one sample | **19** | the same, **plus 7 sessions running live `spideryarn.*` statements** — `delete from spideryarn.jobs`, `update spideryarn.articles`, `insert into spideryarn.jobs` |

So bullet 1 applied to the shared database is **a permanent red of eleven-or-twelve rows that all
have to be there**, and the floor is not even constant — the Storage API holds between one and four
connections, so 12 and 19 are not distinguishable by a reader who does not already know today's
number. A rule whose baseline moves is not a verdict.

**The 19-row sample is the first direct observation of the contention this plan had only inferred.**
`admin-store.test.ts` failing in a batch and passing alone was the symptom; another agent's process
writing to `spideryarn.jobs` while the shared lane ran is the cause, seen rather than deduced.

##### And bullet 2 was answered by T-D, in three places

*"Make the gate print the database it reached, and a shared-database green stop being
representable"* is what T-D's per-lane controls already do, one per lane, closer to the suite than a
gate could be: [`private-db.ts`](../../tests/setup/private-db.ts) asserts `current_database()`
against the minted name **and** that this run's lease is inside it;
[`shared-db.ts`](../../tests/setup/shared-db.ts) asserts `postgres` **and** `projectMismatch`,
because `postgres` is a name and not an identity;
[`unit-no-database.ts`](../../tests/setup/unit-no-database.ts) poisons both URLs and
[`unit-lane-has-no-database.test.ts`](../../tests/unit-lane-has-no-database.test.ts) asserts the
connection fails. Each was watched failing. **Refusing `postgres` outright, which is the other half
of the bullet, is now simply wrong**: the `shared-services` lane runs there on purpose, because
GoTrue reads it.

A third piece of the same intent is older still and already on `dev` — 260903e's own Stage A gave
contention a banner of its own, `TEST DATABASE CONTENDED` in
[`expect-claimed.ts`](../../tests/helpers/expect-claimed.ts), which is *"a different answer from
red"* for the queue singleton.

**So T-E's intent is delivered by three things already built, and what the spec literally asks for is
unbuildable in one half and wrong in the other.** That went to GPT Sol as a design fork, with both
measurements and an explicit invitation to say the stage was being talked out of existence —
[260903f-pollution-verdict-design-sol.md](260903f-pollution-verdict-design-sol.md).

##### Sol's answer: keep T-E, much smaller, and the version proposed here would not have worked

> *"Your re-derivation is substantially right. Do not close T-E entirely as absorbed: keep a much
> smaller stage for private teardown integrity and shared-failure diagnostics. Delete the original
> `check.ts` requirements."*
>
> — GPT Sol, 2026-09-04

Four blocking findings. **The one that matters most is that the guard as proposed would have been a
silent success**, in the stage built to remove one:

**A `throw` from a `globalSetup` teardown does not fail the run.** `close()` in
`node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js` collects every teardown rejection into
`teardownErrors` and does exactly one thing with it — `this.logger.error("error during close", …)`.
Nothing sets an exit code. **Measured here rather than read**, because reading a docstring instead of
running the code is how two tautological controls got endorsed on 2026-09-04:

```
 Test Files  1 passed (1)
error during close Error: TEMPORARY PROBE: does a teardown throw fail the run?
    at Object.teardown (tests/setup/private-db-global.ts:182:9)
EXIT=0
```

The banner prints **after** the summary, so in a seven-minute run it scrolls past and the exit code
says green. **And the throw skipped the drop**, leaking a 12 MB database the scavenger would not
touch for six hours — the failure would have cost more than the thing it reported.

`process.exitCode = 1` in the same place **does** propagate, measured the same way: `EXIT=1`, with
the drop still running. That is the mechanism, and it is one line.

**The other three findings.**

| # | finding | what it changes |
| --- | --- | --- |
| P1 | the minted name is discoverable, and the private lane writes to shared `postgres` | the two corrections above |
| P1 | **a setup-time session count is not useful** — sample when a shared-lane test *fails*, via `onTestFailed`, and print identities rather than a number | replaces the proposal in (ii) |
| P1 | **`usename = postgres` is the wrong discriminator** — incidental configuration, and it already needs a `pg_net` exception. Name the connections instead: `PGAPPNAME` for this run's shared clients, and a `spideryarn…` application name carrying a worktree identifier on the dev-server pool, which today sets **none** ([`src/db/client.ts`](../../src/db/client.ts) § `new Pool`) | the anonymous sessions in the 19-row sample become attributable |
| P2 | **use a non-forced `DROP DATABASE` as the atomic backstop** — sample, close the lease, try the ordinary drop; if anyone appeared in between, Postgres refuses *atomically*. `FORCE` only afterwards, for cleanup | closes the check-to-drop race, and reuses the distinction already in the factory |

Sol also asks that the report **not print SQL text**, which may carry article prose or a secret —
this repo's own logging rule, and the probes written earlier today selected `query` without thinking
about it.

**So T-E is real, and it is: private teardown enumerates, backs itself with a non-forced drop, and
fails the run through `process.exitCode`; the shared lane prints attributed sessions on failure
only; and the original `check.ts` requirements are recorded as superseded rather than built.**

##### The zero was true and unrepeatable, and the condition nobody stated is "the last file"

**Building it broke the measurement it was built on.** The table above says the minted database holds
**0** non-lease sessions at teardown, on 3, 15 and 99 files. Running the new check against
*single* private-lane files, **7 of 8 fail it** — each leaving one or two of its own `getDb()`
connections behind, because vitest tears down `globalSetup` **before** it closes its worker pool and
about 29 of the lane's 101 files never call `closeDb()`.

Two measurements of the same quantity, disagreeing, both correct. The missing fact, measured
2026-09-04:

| run | files | sessions left at teardown |
| --- | --- | --- |
| `billing-usage-route` alone | 1 | **2**, and `EXIT=1` |
| `billing-usage-route`, then `pg-ready`, `run-lock` | 3 | **0**, `EXIT=0` |
| `billing-usage-route` **and** `billing-checkout` — two known leakers | 2 | **2**, not 4 |

**Only the last file's pool survives.** Vitest recycles the worker when the next file starts, so an
unclosed pool outlives the run only if its file happened to run last. Every one of the three runs in
the table above this one ended on a file that closes its pool, which is the whole of why they said
zero — and nothing in the measurement said so, because nobody knew it was a condition.

**The number was not wrong. The sentence around it was**, and this plan has now produced that shape
itself after finding it in four other people's files. *"0 non-lease sessions at teardown"* is a fact
about three particular runs; *"the minted database is empty at teardown"* is the generalisation it
does not support. The check being built is what exposed it, four hours later, which is the argument
for building checks rather than reasoning about them.

**What it changes in the design.** A verdict that fires on a clean run and blames *"something outside
this run"* for a worker of that very run is a gate whose red is noise — the position
[`vitest.config.ts`](../../vitest.config.ts) already argues at length about a timeout. So
"unexpected" has to mean **"not this run"**, which the connection naming built for the shared lane
now makes expressible: the private lane tags its own workers through `PGAPPNAME`, the teardown
partitions the sample into the lease, this run's workers and strangers, and only a stranger fails the
run. Our own unclosed pool becomes a line that says so, bounded to one file and honest about it.

**And the non-forced drop needs the same correction**, which is the subtle half: our own workers are
alive at teardown, so Postgres refuses the ordinary drop on clean runs too.

**The first answer to that was re-sampling after a refusal, and the stage-end review refuted it** —
[260903f-pollution-verdict-built-sol.md](260903f-pollution-verdict-built-sol.md), *"do not commit T-E
yet"*. Once one of our own pools guarantees the refusal, a stranger can arrive after the sample,
contribute nothing distinguishable to a refusal that was coming anyway, disconnect before the
re-read, and the run goes green. **A re-read is a second sample, not an atomic decision**, and
calling it a backstop was the same move as the two tautological controls this document already
records: naming a check after the property it was supposed to have.

The fix restores the property instead of lowering the claim: **terminate our own tagged backends
first**, by pid, and only then attempt the ordinary drop — at which point `55006` means an
unexpected client and nothing else. A clean run then reaches a drop that *succeeds*, which is a
better outcome than forcing.

**The review's second blocking finding is a silent success in the error handling**, and of a kind
this plan has now found at every level of the stack: `dropStaleTestDatabase` converts *every* error
into `{ dropped: false }`, so a permission or network failure is indistinguishable from "in use" —
and with our own workers present that combination produces no stranger, no ghost, and a green run.
A failed *forced* cleanup, likewise, only printed that the database had leaked. Both now fail the
run, and as a **teardown failure** rather than as POLLUTED, because *"we could not tell"* and
*"somebody was inside"* are different claims and the banner should not confuse them.

##### T-E is built — four verdicts, and the two that were added by being refuted

| what the teardown found | verdict | exit |
| --- | --- | --- |
| a stranger | **POLLUTED** | 1 |
| the drop, the lease close or the re-read failed | **TEARDOWN FAILED** — *"we could not tell"* | 1 |
| only this run's own tagged connections | one line saying so | 0 |
| nothing | silent | 0 |

**Only the first of those was in the design.** The second came from the review, the third from the
measurement collapsing, and the fourth was always there. A stage specified as one verdict shipped as
four, and each addition came from something being *refuted* rather than from scope creep.

The sequence is: sample on the lease's connection → **terminate this run's own tagged backends by
pid** → close the lease → ordinary `DROP DATABASE` → re-read from the *base* database only if it was
refused as `in-use` → classify → drop → verdict. Terminating ours first is what makes the refusal
mean something again: with them gone, `55006` is an unexpected client and nothing else.

**Verified here rather than reported**, on 2026-09-04:

```
stranger held inside the minted database     EXIT=1, POLLUTED, names it, then drops WITH FORCE
the run's own unclosed pool, alone           EXIT=0, "2 … tagged connection(s) remained", then
                                             dropped — not WITH FORCE, because ours were closed first
a clean multi-file run                       EXIT=0, silent
```

The middle row is the one worth noticing: **the clean path now reaches an ordinary drop that
succeeds**, which is a stronger property than the stage started with — before T-E every run forced,
and a forced drop cannot tell you anything because it terminates whatever it finds.

Three pieces of machinery, all small: `PGAPPNAME` naming this run's connections (asserted in
[`private-db.ts`](../../tests/setup/private-db.ts) by asking Postgres what *this backend* is called,
which is a measurement rather than an echo of what we set); `backend_type`, so that **an autovacuum
worker inside the freshly restored database** — null `usename`, empty `application_name`, and
indistinguishable from an intruder by name — is not accused, which it was on the first run; and a
`DropOutcome` of `dropped | in-use | failed` replacing a boolean, because **a boolean cannot carry
*"I could not tell"*, so it carried it as *"no"***.

**And the tag is honest about what it is.** `application_name` is client-chosen, so the pid makes it
collision-resistant between two cooperative runs on this box and nothing more; it is not an
adversarial boundary and cannot be while every worktree shares one superuser credential. Said in the
code, in [testing.md](../project/testing.md), and here, because the last thing this stage needed was
a fourth check that sounds stronger than it is.

**`src/db/client.ts` is the one production change**: the pool names itself
`spideryarn <cwd-basename>:<pid>` where it used to name itself nothing, which is why seven sessions
in the measured sample were unattributable. `PGAPPNAME` wins where set. Printable ASCII, cut to 63
**bytes** rather than 63 UTF-16 units — the review's catch, and the sort of thing that makes a
comment false rather than a program wrong.

### B0 — take `RUN_LOCK` off the seed window — **already done, and this plan was wrong about it**

**Nothing to build. It landed on 2026-09-01 in `df7a7980`, two days before this plan was written.**
`LoadOptions.serialise` defaults to `false`, and `withRunLock` has exactly one caller in the tree —
[`load-article.ts`](../../tests/helpers/load-article.ts) § `withRunningJob`, gated on that flag. The
four places that pass `true` are all legitimate and none of them is the seed path B multiplies:
`store-parity` (×2) and `store-roundtrip`, which load a **fixed** slug; the suite that tests the
option itself; and `scripts/db-seed-dev.ts`, which is a dev script rather than part of the run.
`tests/helpers/scratch-article.ts` — the helper the ~48 converted suites use — never passes it.

**So the 16-process measurement this stage called for was not needed**, and running it would have
measured a change that was already in the tree.

**Why we believed otherwise, which is the part worth keeping.** `scratch-article.ts`'s own docstring
opened *"`loadArticleIntoPg` takes `RUN_LOCK` around its load window, which serialises every seed in
the whole test run"* and closed *"It is kept anyway for now, because removing it is a change to
`loadArticleIntoPg`'s contract and belongs in one deliberate commit."*

**The sequence, all on 2026-09-01, and the middle step is the one that matters:**

| | |
|---|---|
| `9671fcfa` 13:20 | wrote the paragraph. **True when written.** |
| `df7a7980` 14:45 | flipped `serialise` to opt-in in `load-article.ts`, **and did not touch this file**. The paragraph became false, silently. |
| `e3ef75fd` 15:13 | **edited that very paragraph**, adding the `raw_sources` narrative, and left its top and tail describing the world before the flip. |

So it was not merely un-updated. It was revised half an hour after being falsified, by someone
reading it closely enough to rewrite its middle, and the two false sentences survived because
nothing connects a comment to the code it describes.

It then stayed wrong for two days and was read as fact by this plan, by the brief that drew stage B0
out of it, and by a review that did not challenge it. **The class is a comment that survives the
change it describes** — the same shape as [silent-success](../reusable/silent-success.md), one level
up: not a check that agrees with the bug, but *prose* that agrees with the code it used to describe.
The tell was available cheaply — `grep -rn "serialise: true"` returns four lines and none of them is
this file — and the lesson for the rest of this plan is to **grep the call sites before believing a
docstring's account of them**, especially where the plan's next stage depends on the answer.

**This section got the attribution wrong on its first attempt**, blaming `df7a7980` for prose it
never touched — a `--stat` on that commit lists eight files and `scratch-article.ts` is not among
them. Caught by the fact-check dispatched off the back of this very finding, which is the argument
for dispatching it: the correction to a stale-prose bug was itself stale prose within the hour.


Fixed in the same commit as this note: the docstring now says what the code does, and records that
it was wrong and for how long, so the next reader is not the fourth to be misled.

**What B0 changes for the stages after it: nothing.** B was already going to get the unserialised
seed. The ~19–24s of serial demand that `load-article.ts` warns about is a description of what
`serialise: true` *would* cost at B's scale, not a debt B has to pay.


### B — convert the suites that exercise the filesystem store

The pattern is proved: `tests/helpers/scratch-article.ts`, ~280 ms a seed. **Each converted suite
must run green against unchanged production code with `postgres` set explicitly, and each gets one
mutation watched going red.** That evidence is retained — it is part of the final proof in the
readiness work. Three registry edits go with each conversion and are about a fifth of the work:
`TEST_LANES`, `OWNER_AUDIT` where the file names a fixed owner uuid, and the `STORE_MIGRATION`
verdict.

**Two things this heading used to say, both wrong and both left named.** It said *"the ungated route
suites"*, and the set is 26 files of which only about half are routes — § *B's manifest* below. And
it said **(parallelisable)**, which is true of the editing and false of the verifying: the private
lane is serialised, so every converted file adds ~11s to every future run, and two agents converting
in two worktrees each mint a database.

**It also said "land `serialise: false` for unique-slug seeds as you go", and that is already the
default.** `LoadOptions.serialise` is `false` and `scratch-article.ts` never passes it — the same
thing B0 records about itself two stages down. The pilot below looked for something to change here
and correctly found nothing, which is a stale instruction costing somebody's time for the second
time in one plan.

#### B's manifest is 26 files, and it is derived rather than written

**"The ungated route suites" is not a set anybody can act on**, and this plan's own rule is that a
count without a derivation is perishable. Now that both maps exist in one file, the set is an
intersection: `STORE_MIGRATION` says which tests are `database-integration`, `TEST_LANES` says which
have a database, and **a file in the first and not the second is a database test running on the
filesystem store**. Computed 2026-09-04 against `ae5ed824`:

| | in a database lane | in the `unit` lane |
| --- | --- | --- |
| `database-integration` (36) | 10 | **26 — this is stage B** |
| `shared-mechanism-collateral` (28) | 23 | 5 |
| `filesystem-adapter-behaviour` (24) | — | 24, and stage G deletes them |
| `store-agnostic-fake` (13) | — | 13, correctly |

```
all-skipped-publication-log        jobs-walk                    referee-criteria-routes
article-cache-call-site            jobs                         referee-mirror-route
chat-anchor-route                  list-reconciles-expired      referee-scan-route
chat-live-ticket-route             live-session-routes          retry-is-only-for-a-failed-job
chat-live-turn                     one-article-for-one-address  routes
chat-spoken-route                  owner-jobs                   second-job-queues
jobs-commit-path                   quiz-mark-route              step-failure-seam
                                   referee-claims-omitted       term-lookup
                                   referee-claims-routes        the-query-string-does-not-decide-the-route
                                                                upload-records
```

**Only about half of them are routes.** `jobs`, `jobs-walk`, `jobs-commit-path`, `owner-jobs`,
`second-job-queues`, `step-failure-seam` and `upload-records` are the queue, and the stage's name has
been quietly wrong about its own contents since the first draft.

**And stage B had never had an estimate.** The *"6–10 hours"* this session twice attributed to it is
260903e's figure for **its** stage B — the database factory, which is built and on `dev`. Two stages
in two plans share a letter, and the number migrated between them unchallenged. It has a measured
one now, from converting two of the 26 — see below.

**This is the first time the two maps have been intersected**, and it is the composition the T-C
review argued for over a literal merge: neither verdict predicts the other, but the *pair* answers a
question neither could. Re-derive it rather than copying the list: the files whose `STORE_MIGRATION`
category is `database-integration` and which have no `TEST_LANES` entry, both in
[`tests/store-migration-registry.ts`](../../tests/store-migration-registry.ts). Five of the six
counts in this document that went stale went stale by being copied instead.

**But the set shrinks from both ends as the stage runs, so 26 is a starting position and not a
size.** A converted file gains a lane *and* stops being `database-integration` — the pilot found the
right post-conversion verdict is `shared-mechanism-collateral`, because what a converted route suite
still touches is the loader's copy step and the ledger redirect. So the derivation above returns 24
after two conversions, and anyone re-deriving mid-stage will get a number that does not match this
heading. **That is the derivation working, not drifting**, and it is the one case in this document
where a moving count is the correct behaviour rather than the failure.

#### Two of the 26 are converted, and the estimate is now measured rather than guessed

**A pilot, 2026-09-04**: one from each half, chosen to be representative rather than easy.
`tests/chat-anchor-route.test.ts` (the route shape — copy `example/` under a throwaway slug, drive
`handleApi`, read back through a store function) and `tests/owner-jobs.test.ts` (the queue shape —
the *"jobs never reach Postgres"* tail this stage's § A names).

| | edit | green | one mutation, watched red |
|---|---|---|---|
| `chat-anchor-route` | ~25 min | 20 passed, 15.7s | `anchorQuote: quoteOf(…)` → `null` in `pg-chat.ts` — **4 failed** |
| `owner-jobs` | ~20 min | 10 passed, 11.4s | the `where(eq(jobs.ownerId, owner))` deleted from `pgJobStore.list` — **2 failed** |

**Both mutations are ones the filesystem version could not have caught**, which is the argument that
the conversion bought something rather than merely moved something: neither line exists in the
filesystem store. The first is sharper than intended — a null `anchor_quote` beside a non-null
`anchor_start` violates the `chat_threads_anchor_both` CHECK, so the route 500s where the fs store
would have written the fourth anchor shape and said nothing.

**The review passed both conversions and named two gaps in the *evidence*, not the code**
([260903f-pollution-verdict-built-sol.md](260903f-pollution-verdict-built-sol.md) § 7). Worth
carrying into the remaining 24, because they are about how a mutation is chosen:

- **Mutate the thing the conversion was justified by.** `chat-anchor-route` was converted because
  its header said the foreign key was left to another file *"because this harness writes to the
  filesystem store"*. The mutation that matches that reason is deleting the route's `checkAnchor`
  call — which should turn the foreign-block case from a 400 into a 500. `anchorQuote → null` is a
  valid persistence mutation and it is not that one.
- **One predicate is not the family.** Deleting `list`'s `where owner_id` proves list isolation;
  `get`, `claim`/`getIn` and `forget` each carry their own SQL predicate and none of them was
  mutated. Not a hole in the behaviour — the tests do cover those outcomes — but the *watched red*
  covers one quarter of what the file claims.

Neither is worth re-doing on these two. Both are worth writing into the brief for the rest, because
"one mutation watched going red" is a rule this plan wrote and it does not say *which* mutation,
which turns out to be most of its value.

#### Ten more, in two parallel halves — 12 of 26, 2026-09-04

Two agents, disjoint file sets, both editing `TEST_LANES` at different alphabetical positions. Five
route suites (`the-query-string-does-not-decide-the-route`, `chat-spoken-route`,
`chat-live-ticket-route`, `chat-live-turn`, `quiz-mark-route`) and five queue and article-identity
suites (`second-job-queues`, `upload-records`, `list-reconciles-expired`,
`one-article-for-one-address`, `article-cache-call-site`).

All ten green together — `10 passed, 79 tests` in one private database, no `POLLUTED`. **The pilot's
30–40 minutes a file held for nine of ten.** `quiz-mark-route` took roughly twice that, and for a
reason worth naming: its fixture is an *artefact it rewrites per test*, not an article it reads, so
three seeded articles and a real second publication had to stand in for what a directory copy used to
do.

##### The most valuable result is a mutation that did not bite

Deleting `row.workKey === ticket.workKey` from `tryEnqueue`'s re-read classifier — a
predicate the Postgres path owns and the filesystem never had, exactly the kind this plan asks for —
left `second-job-queues` **green**. That re-read only runs when the insert conflicts, and the suite's
two accepted-job cases insert cleanly. So the file exercises one branch of that classifier and none
of `sourceTaken`, `nameTaken` or id-collision.

**Nothing in the file, the plan or the review would have revealed that.** It is the argument for the
rule the plan already has — one mutation watched going red, per file — restated as: the rule's value
is not the red, it is that a mutation which *stays green* names a hole nobody knew was there. Both
agents were asked to say what each mutation does **not** cover, and every one of the ten has an
answer written down.

##### Two more traps, and both are Postgres being stricter than a directory was

3. **A global `fetch` stub that catches model calls also catches the seeder.** `scratchArticleInPg`
   → `storeRawSource` puts bytes in the Supabase bucket **over HTTP**, so seeding inside a test whose
   `fetch` is stubbed fails with the stub's own *"no model in tests"* and reads as a route bug. Swap
   the real `fetch` back for the length of the seed and restore it in a `finally`.
4. **Postgres validates ids the filesystem store never looked at.** `jobs_id_format` refuses a
   hand-written mnemonic like `spya-2ndrun` (the body must start with a letter), and `jobs.attempt_id`
   is a `uuid`, so a string token like `"attempt-2nd"` fails the insert. Any converted queue suite
   that writes its own ids needs `mintId()` and `mintAttempt()`. **This is the migration finding
   underneath the trap**: a filesystem store validated nothing, so a decade of hand-written fixture
   ids were never wrong until now.

And one that is not a trap but a shortcut: **`claimSession` is the answer for any suite driving
`advanceJobWith`**, is already exported, and already says so in its docstring. `article-cache-call-site`
converted in 20 minutes using it. That downgrades the fear about `jobs-walk` and `step-failure-seam`
— their difficulty is the `data/_jobs/` byte assertions, not the walk.

##### The category question, escalated rather than decided, and the answer is to re-run the witness

The two halves disagreed. The pilot moved both its files to `shared-mechanism-collateral`; the queue
agent moved only one, leaving four as `database-integration` because after conversion they seed no
article and run no step, so **they reach no condemned module at all** — and
`shared-mechanism-collateral` requires a non-empty `mechanisms`, which there is nothing to fill.

Read against the definitions at the top of the registry, neither is right. Those categories say **what
work the file still needs**: `database-integration` is *"move it, or finish moving it"*, which a
converted file does not need, and `shared-mechanism-collateral` is *"none, to this file"*, which is
the correct action but claims a mechanism that is gone.

**The resolution is that the map should shrink, and cannot yet.** Membership is one-directional —
`tests/store-migration-registry.test.ts` demands an entry for every file
[`tests/store-migration-witness.json`](../../tests/store-migration-witness.json) saw touching the
filesystem store, and nothing demands a listed file still touch it. So a converted file may leave the
map **only once the witness is re-run**, and the witness is dated 2026-09-03. So:

> **Re-run the witness at the end of stage B**, and let every file the conversion took out of its
> reach drop out of `STORE_MIGRATION` entirely.

At that point the category question dissolves rather than being answered, which is the better
outcome, and the map becomes a measurement of the *current* tree again instead of a September the 3rd
one. Until then the four entries stay `database-integration` with reasons that say the conversion is
done — the honest verdict rather than an un-updated one, in the queue agent's words, and it is
recorded here so that the next reader knows it was a decision.

**Call it 30–40 minutes a file for the twenty-four that are left, plus a day for the three that are
not this shape.** The editing is nearly all pattern: pin `postgres` in `vi.hoisted`, a `pgReady`
gate, `scratchArticleInPg` in `beforeAll`, delete rows instead of re-copying a directory in
`beforeEach`, and read back through the store rather than through a filesystem-only reader. Three
registry edits follow — `TEST_LANES`, `OWNER_AUDIT` where the file names a fixed uuid, and the
`STORE_MIGRATION` verdict, which for a converted route suite becomes
`shared-mechanism-collateral` with the loader and the ledger as its remaining touches. **The
outliers are `jobs.test.ts` (26 filesystem sites), `jobs-walk.test.ts` and `step-failure-seam.test.ts`**;
the last two assert on bytes read back out of `data/_jobs/`, which has no Postgres equivalent and
has to be re-expressed rather than translated.

**Four things the pilot found that this plan and `scratch-article.ts` do not say:**

1. **The lane entry comes first, or the run finds no files.** `vitest.config.ts` derives each
   project's file list from `TEST_LANES`, so `--project private-postgres tests/<new file>` exits 1
   with *"No test files found"* until the registry names it. Converting the test and running it is
   two steps in the wrong order.
2. **Route suites read back through filesystem-only functions, and the import does not look like
   one.** `chat-anchor-route` called `loadThreads` from [`src/chat.ts`](../../src/chat.ts), which
   `readFile`s `chat.json` unconditionally — nothing in the name or the import path says "files".
   The replacement is `chatStore.load` inside `asTestOwner`, and a conversion that pins the flag and
   leaves the read alone gets an empty list rather than an error. **That is a green suite asserting
   nothing**, and it is the one failure mode of this stage that no gate would catch: the flag is
   pinned, the seed is real, the lane is right, and the assertion reads a file nobody wrote.
3. **The `OWNER_AUDIT` guard fires on the lane, not on the conversion**, and it names the constant:
   giving `owner-jobs` a lane turned it red with
   *`tests/owner-jobs.test.ts ALICE 00000000-…a7`*. It also resolved `seedAuthUser(db, { id: ALICE, … })`
   through the constant, so `kind: "seeded"` needed no `why`.
4. **Literal block ids and quoted prose do not survive the move**, exactly as `ScratchArticle.blocks`
   warns: `scratchArticleInPg` seeds `writes`, not `example/`, so anything the old file quoted has
   to be re-derived from `article.blocks` at run time.

##### The trap in finding 2 has a measurable surface, so it is a checklist rather than a warning

Derived 2026-09-04, and the derivation matters more than the list. Modules under `src/` that read
the data root directly **and never import `src/store/` or name `STORE`** cannot be store-aware, so a
converted test that keeps calling one of their readers gets an empty answer:

| module | the readers a converted suite might keep calling |
| --- | --- |
| [`src/chat.ts`](../../src/chat.ts) | `loadThreads` — **the one the pilot hit** |
| [`src/comments.ts`](../../src/comments.ts) | `loadComments` |
| [`src/searches.ts`](../../src/searches.ts) | `readSearches`, `loadRuns` |
| [`src/referee-claims-store.ts`](../../src/referee-claims-store.ts) | `loadClaimsRun` |
| [`src/referee-criteria-store.ts`](../../src/referee-criteria-store.ts) | `loadCriteria` |
| [`src/glossary-lookups.ts`](../../src/glossary-lookups.ts) | `loadLookups` |
| [`src/shelf.ts`](../../src/shelf.ts) | `loadShelf` |
| [`src/profile.ts`](../../src/profile.ts) | `loadReaderProfile`, `loadReaderExperimental` |

Eight modules, thirteen readers. **`src/api.ts` is deliberately not on the list** — it reads files
too, but it imports `./store/`, so its `loadArticle` and its ten siblings dispatch rather than
assume. That is the discriminator, and it is why the list is short enough to check by hand.

**These are the filesystem adapter's implementation, exported from `src/*.ts` instead of from
`src/store/`.** The only non-client caller of `loadThreads` in the tree is
[`src/store/fs.ts`](../../src/store/fs.ts), which stage G deletes — the `src/web/` matches are a
different `loadThreads`, a client controller's effect. So calling one of these from a test is not
merely reading the wrong store, it is **reaching past the selection into the condemned half**, which
is the reach stage A's witness was built to count. This predicts which of the remaining 24 will hit
it: the three chat route suites, both referee route suites, and anything reading a shelf or a
profile.

### C — ledger isolation, its own reviewed stage

Replacing `NODE_ENV === "test"` → filesystem is **not** "Postgres plus cleanup". Routes use a global
cost store and independent pooled connections while Vitest runs files concurrently, so **a
surrounding test transaction will not contain those writes unless the cost store becomes
executor/transaction-aware.** Acceptance must prove all five:

1. `pgCostStore.record` genuinely executed (not silently skipped).
2. Fixture costs were never visible to normal dev reports.
3. A crashed or failed suite leaves nothing behind.
4. Parallel test files stay isolated from each other.
5. Direct ledger integration tests still exercise committed behaviour.

#### Spiked, 2026-09-03, and it changed the answer

Measured rather than argued, with no edits to `src/`. The numbers:

| what was asked | what the database said |
|---|---|
| do route tests really write ledger rows? | `tests/chat-route.test.ts` — 4 tests, **5 rows**, all 5 kept out of Postgres by today's redirect |
| would Postgres take those exact rows? | **5 of 5 refused** with the owner unseeded; **5 of 5 accepted** once seeded |
| the control — same rows at the shared database | **5 of 5 landed**, counted there, then deleted by id |
| two parallel files, 25 rows each, private database | each saw exactly its own 25; **both saw 51 total**, so they genuinely ran together |
| `SIGKILL` mid-write | **6 rows survived** in the private database, **0** in the shared one |

**Criterion 3's wording was wrong and is corrected above.** A killed run does not roll back —
committed rows stay committed. What saves us is *teardown*, so the criterion is "leaves nothing
behind", proved by dropping the database and by a scavenger, not by a transaction.

**The transaction-aware design is out.** It is mechanically possible — `runInRequest` +
`collectSpend` in `routes.ts` mean an `AsyncLocalStorage` the test opened really would reach
`record`, and one objection we expected turned out to be false (a call finishing after the collector
closes never reaches `record` at all; `ai-spend.ts` counts it as a late finish and writes no row).
It fails on criterion 2: isolation would become **a convention 43 route files and 25 job files each
have to remember**, and one that forgets pollutes the real ledger silently. That is the shape this
plan exists to delete, not to relocate.

**A separate schema is out too, on a fact worth keeping**: `pgSchema("spideryarn")` puts the schema
name into the SQL, so `search_path` cannot redirect it. A scratch *schema* would need a second
Drizzle table object; a scratch *database* needs none, because the name is then correct. This is the
one place where the elaborate option is cheaper than the apparently simpler one.

#### C now sits on stage T, by Greg's decision

The recommendation is a **private test database per run**, at which point C is small: `selected()`
collapses to `export const costStore = guardedLedger`, `ai-calls-fs.ts` goes, and
`tests/cost-store-under-test.test.ts` is rewritten from *"the selection is the filesystem one"* into
*"the selection is Postgres, and it is the private database"*. Half a day.

**But that machinery is somebody else's plan, already written and partly built** —
[260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md), Stage A landed
on `worktree-test-db-isolation`, Stages B–E estimated 6–10 hours plus half a day. And the overlap is
not only stage C:

| 260903f needs | 260903e already plans |
|---|---|
| stage A's manifest of Postgres-touching tests | **Stage C**, a manifest assigning every Postgres-touching test to a lane, with a guard test |
| a central suite-registration abstraction (was D′2) | **Stage D**, three disjoint vitest projects with per-lane setup |
| the mandatory preflight in § *Making the database required* | **Stage D**, wiring the lanes into `npm test` and `npm run check` |

**Two plans were converging on one piece of infrastructure from opposite ends.** Left alone they
would have built two manifests and two suite-registration mechanisms, and the second to land would
have had to unpick the first.

> **Absorb 260903e into this plan.**
>
> — Greg, 2026-09-03, asked which of four ways the two plans should relate

**So 260903e's stages B–E become stage T below, owned here.** Its Stage A — a contended run saying
so rather than looking like a bug in `claim` — **is already on `dev`** (`a0fb2eb2`) and therefore
already in this worktree; nothing needs moving. The `worktree-test-db-isolation` tree holds only its
spike scripts, uncommitted and untouched since 08:41.

**One new cost the spike found that 260903e does not yet list:** every route or job suite that
records cost needs its owner row in `auth.users` — measured, 5 of 5 refused without it.
`tests/chat-route.test.ts` uses `ADMIN_USER_ID_LOCAL`, which exists on this box only by accident of
`db:seed-dev` and would not exist in a clean clone. That is a named member of the tail 260903e's
Stage C warns about, and it probably reaches most of the 43 route files.

#### C is not independent of B any more, and the reason is the poison

**Half a day was costed when a test that reached Postgres by accident merely got the shared
database.** T-D changed that: a `unit`-lane file's `DATABASE_URL` is now a refusal. So the moment
`selected()` stops redirecting to the filesystem under `NODE_ENV === "test"`, **every unit-lane test
that actually records a row fails**, and C's real cost is however many of those there are plus a lane
for each.

An upper bound, computed 2026-09-04 against `ae5ed824` — the unit-lane files mentioning `handleApi`,
`costStore`, `withLedger` or `collectSpend`:

| | files |
| --- | --- |
| can open a ledger, anywhere in the suite | 56 |
| …already in a database lane | 17 |
| …**in the `unit` lane** | **39** |
| of those 39, also in stage B's 26 | 16 |
| **C's own tail, after B has run** | **23** |

**39 is a ceiling, not a count, and the difference matters.** The grep proves that a file *names* the
machinery, not that a row is written — `vercel-url`, `cold-start-lazy-imports` and `paid-cli-ledger`
are on the list and at least the last is a static AST test that executes no route at all. The true
number is what C's own acceptance criterion 1 asks for (*"`pgCostStore.record` genuinely executed,
not silently skipped"*), and it can only come from a run. **Recording the ceiling rather than
guessing at the number is the point**: an unmeasured 39 is honest, and a confidently wrong 12 is what
this document keeps catching elsewhere.

What it settles regardless: **B goes before C**, because B converts 16 of the 39 anyway and each
conversion is the same edit either stage would make. That is a change to the build order the plan
had as `C → B`.

**And a caveat about what C can honestly claim.** All five rows the route suites produced came back
`outcome: "error"`, `cost_source: "none"`, `credits_used_nanos: null` — the model call is stubbed, so
what those suites cover is the **unpriced** path. Nothing in them would exercise a BYOK or realtime
`CHECK`. So *"the route suites prove the ledger columns work"* is not true today, and C should either
add a fixture that makes it true or stop implying it.

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

**Landed, 2026-09-03 — D′1a.** [`tests/store-guard-idempotent.test.ts`](../../tests/store-guard-idempotent.test.ts)
was watched failing `expected 2 to be 1` before the early return went in, and its third case is the
positive control that stops a silenced logger passing the first two. The inner name wins, so a
diagnostic keeps naming the adapter rather than the seam that selected it.

**Landed, 2026-09-03 — D′1b.** All fifteen seams now guard at their export, so
`tests/store-guarded.test.ts`'s discovery finds **seventeen** names, and a new section asks the
fifteen objects for their seam name — the `where:` prefix everybody greps existed only as prose
until now. `guarded()` in `index.ts` keeps calling `guardDbStore` **deliberately redundantly**: the
early return makes it free, and it means a store added tomorrow is wrapped even if its author has
read none of this.

**A sixteenth Postgres store exists and is not one of them.** `pgPublicReader`
([`public-reader.ts`](../../src/store/public-reader.ts)) is a real Drizzle store selected raw in
`src/public/routes.ts`, and it never touches `guardDbStore` — because it scrubs its own, deliberately
and more narrowly, for a documented import-graph reason. **The hazard was covered; the rule was
not**, and `database.md` now says so rather than implying an exception that does not exist.

#### D′1b found a second double-diagnostic the early return cannot reach

**Guarding at the export creates a shape that did not exist before: a guarded store calling a
*different* guarded store.** `pgShelfStore.patch → entryFor → pgArticleReader.listArticles`, and
`pgArticleReader → pgReaderStore.readProfile`. Idempotency cannot help — these are two objects, each
legitimately wrapped. Measured against the local database with a non-uuid owner:

```
where:"reader.listArticles"  sqlstate:"22P02"  routine:"string_to_uuid"  errorType:"Error"
where:"shelf.patch"          sqlstate:"22P02"  errorType:"StoreFailure"   (no table, no routine)
```

The same degraded second line D′1a was written to abolish, arriving through a different door.
**The fix is at the other end: an already-scrubbed error passes the next guard unchanged**, marked
with a non-enumerable `SCRUBBED` symbol and one line at the top of `mayPassThrough`. It is the one
allowlist entry that needs no judgement — *we* wrote its message, and it is one of the two sentences
in `messages.ts`. The diagnostic then stays where the failure actually happened.

**Tightened since, by another worktree, and this plan is recording it rather than discovering it
later.** `ad22f508` (merged here 2026-09-03) replaced the bare mark test with `alreadyScrubbed`,
which requires the mark **and** `Object.isFrozen(err)` — so a mark alone is no longer a pass, and an
attacker-shaped object carrying the symbol cannot borrow the exemption. The same commit made the
`name`/`stack` reads null-safe, so a thrown `null` no longer takes the guard down with it. That
worktree also converged independently on `Symbol.for` over a module-private symbol, for the reason
recorded in D′1a: a private symbol breaks under module duplication.

**Two worktrees have now landed on this file within a day without either knowing about the other**,
which is the third such collision in this plan (260903e, the glossary delete, and now this). It is
not a problem to solve here, but it is the reason this document re-derives rather than inherits.

**And the "unforgeable" claim is not true, measured 2026-09-03.** `ad22f508`'s message says *"make
the scrubbed-error mark unforgeable"* and `db-errors.ts` says the mark *"can only be put here"*.
Neither holds. `SCRUBBED` is `Symbol.for("spideryarn.scrubbedDbError")`, and `Symbol.for` reads a
**process-global registry any module can reach** — that was the deliberate choice, for a good reason
(a module-private symbol breaks under module duplication), but it means the key is public by
construction.

What actually rejects the committed forge test in
[`store-guard-idempotent.test.ts`](../../tests/store-guard-idempotent.test.ts) is **the freeze, not
the mark** — that test marks its error and leaves it unfrozen. Probed both arms directly:

| the forged error | result |
|---|---|
| carries the real `SCRUBBED` key, **not** frozen | scrubbed to `STORAGE_FAILED` — the committed test's case |
| carries the real `SCRUBBED` key **and** is frozen | **passes through unscrubbed**, `SENTINEL-frozen` intact |

So the boundary is *mark plus freeze*, and **a forger can supply both** in two lines. The same
finding is P1 of [`260903e-merge-review-sol.md`](260903e-merge-review-sol.md), reached independently
by another worktree's reviewer.

**What the real defence is, and it should be the one written down.** Nothing can make a guarded
store throw an attacker-constructed object: the errors reaching `mayPassThrough` come from Drizzle,
from `pg`, or from our own named classes, and an attacker controls article *content* — Drizzle's
bound parameters — not the shape of a thrown object. That is a sound argument and it is why this is
**not** live. It is also a much narrower claim than "unforgeable", and the gap matters: if some later
path rethrows a caller-supplied object, the boundary fails silently and the comment says it cannot.

**Not fixed here, deliberately.** `db-errors.ts` is another worktree's active area as of
2026-09-03, that reviewer already has the finding, and CLAUDE.md's rule is to stay inside your stage
and talk through artefacts rather than reaching into somebody else's code. This paragraph is the
artefact. **What this plan must not do is inherit the stronger claim** — D′1's account of the
boundary is exactly as strong as the paragraph above, and no stronger. The right long-term fix is
probably to stop describing the freeze as an integrity check *and* an authenticity check, since it
is only the first; whoever fixes it should say which of the two the code is actually buying.

#### And it surfaced a live instance of 260901d's class, seven times over

**The mechanism, stated generally, because it will recur:** guarding a store at its *export* means
that **a test importing the adapter directly stops seeing raw errors**. Those tests had been green
about a path production never takes — the route goes through `index.ts`, where the store was guarded
all along. So every refusal thrown as a bare `Error` from inside an adapter had *already* been
reaching the reader scrubbed, and nothing was red.

Seven of them, in four files:

| refusal | where |
|---|---|
| a fenced write with **no attempt token** ×4 | `SearchStore.finish`, `CommentStore.patch`, `ChatStore.finish`, `RefereeCriteriaStore.finish` |
| a patch that **would not end the run** ×3 | `must end a run`, `must end an answer`, `must end a criterion` |

All seven had *always* read *"this app asked its database for something it would not do"* in
production — a true-ish sentence that drops the entire content of the refusal, which is **what the
caller did wrong**. That is
[260901d](../postmortems/260901d-a-409-and-a-404-arrived-as-500.md) exactly, one layer up.

**All seven now carry `status` and name the method rather than the slug.** Door 1, which
`db-errors.ts` explicitly prefers — *"Adding another closed class: don't. Give it a `status`
instead."* The four attempt refusals share one class, `MissingAttempt`
([`contracts.ts`](../../src/store/contracts.ts)); the three status refusals carry theirs inline.
**The slug is dropped deliberately**: *"a `status` is not a licence to leak"* is the file's own rule,
and a slug is a URL path segment derived from a title. Which article it was is in the request the
log already carries.

**Two agents fixed halves of this family within minutes of each other and split it across two
doors** — one on the allowlist with no slug, one with a `status` and a slug. Both were defensible;
having both is not, and an error boundary carrying two spellings of one rule is precisely how
260901d happened. Reconciled to one shape before commit.

**The tests needed no changing**, which is the strongest evidence the fix was right rather than
convenient: they asserted `/needs the attempt/` and `/must end a run/` before, and they assert them
still. Editing those assertions to match the scrubbed sentence would have been green and wrong.

**The repo never exports a raw store, so "test the adapter's own message" was not an option** —
checked: `rawPgJobStore` and `rawPgUploadStore` are private and no test imports either. Guarding at
the export means a refusal that must survive has to say so in its type. That is the cost of the rule
and it is the right cost.

**One test was genuinely wrong rather than a code bug.** `violation()` in
`tests/feedback-store.test.ts` read the constraint name off `err.cause` — which only a *raw* store
has. It now reads it from the log line the guard emits as a **field**, which is where an operator
reads it in production, so the test covers the real path for the first time. Its own docstring had
said *"these tests call the raw store"*; that sentence was the tell.

#### Two silent successes in the tooling, in one afternoon

Both were a test run that never happened being reported as one that passed, and they are worth
recording together because neither is about this repo's code:

- **`npm test` in a background shell exited 143 (SIGTERM) having emitted nothing**, and the harness
  reported *"completed (exit code 0)"* — it was reporting the wrapper's status, not the suite's. The
  box was at load 100+; background work gets reaped there. **Run the gate in `tmux`.**
- **`--reporter=basic` does not exist in vitest 4.** The run never started, wrote a stack trace, and
  was reported as exit 0.

Both have the same remedy and it is the one [silent-success.md](../reusable/silent-success.md)
already prescribes: **a monitor whose filter covers the run dying as well as the run passing**, and
reading the suite's own `Test Files` line rather than an exit code from something wrapping it.

**A probe trap worth recording**, because it wasted a first attempt: forcing a failure by pointing
`DATABASE_URL` at a dead port does not work. The loader prints
`[env] .env.local overrode DATABASE_URL from the shell environment` and the probe **silently hits the
real database and succeeds** — the same override that turned 146 tests red on 2026-09-02, in a third
costume. A deliberately bad owner id is the reliable route.

**And it turned up a doc that had run ahead of the code.**
[database.md](../project/database.md) § *A guard belongs on the thing, not on the place* says
*"Every Postgres store is now wrapped **at its export**, so there is no unguarded spelling left to
import"*. That is **true of two stores out of seventeen** — `tests/store-guarded.test.ts` asserts
the set of self-guarding exports is exactly `["pgJobStore", "pgUploadStore"]`, the two that had the
2026-08-27 accident. The sentence generalised the fix from the two that hurt to the whole family,
and nothing was checking it, so a reader of that doc would conclude the work D′1b is about was
already done. **D′1b makes the sentence true rather than editing it down**, which is the better
direction and is why that half is worth doing now rather than late.

Losing this guard entirely would **leak bound parameters, including article prose, through database
errors** — the durable fix from
[260901d](../postmortems/260901d-a-409-and-a-404-arrived-as-500.md).

**D′2 was the suite-registration abstraction. It is gone — stage T-D builds it**, and keeping both
would have built the same thing twice. See § *Making the database required*. The numbering is left
alone so that the two Sol reviews, which discuss D′2 by name, still read.

**D′3 — cancelled. Decision 1 was overtaken by events on the same day.**

Greg chose to drop *"start over"* from the alpha rather than build a Postgres `deleteGlossary`.
**Somebody built it instead**, on `worktree-glossary-delete-pg`, and it merged to `dev` hours later:
[`src/store/pg-glossary.ts`](../../src/store/pg-glossary.ts) and
[260903e-glossary-delete-in-postgres.md](260903e-glossary-delete-in-postgres.md). The seam is
symmetrical, the 501 is gone, and the button works — so there is nothing to remove and nothing to
ask. The decision's *reason* has expired, not been reversed.

**Do not re-derive the old refusal from a stale docstring.** This plan already warned about that once
for a different reason (§ *The decisions*, note under decision 1); it now applies to the feature
itself.

**And its arrival broke D′1b's rule within the hour**, which is the more useful finding.
`pgGlossaryStore` was wrapped at its *selection* in `index.ts`, not at its export — the exact
arrangement [database.md](../project/database.md) had just stopped describing — and
**`tests/store-guarded.test.ts` stayed green**, because an exact list catches a store that *stops*
being guarded and never one that **never was**. That asymmetry is a guard agreeing with the bug.
The store is now guarded at its export (eighteen), and the test asks the question from the other end
as well: **every `export const pgX` under `src/store/` is guarded at its export or is one of two
declared exceptions** — `pgCostStore`, guarded in the `ai-calls.ts` leaf to avoid an import cycle,
and `pgPublicReader`, which scrubs its own. Discovery by shape, so a nineteenth adapter joins the
check by being written rather than by somebody remembering.

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

#### Spiked, 2026-09-03. It works, and it moved the stage's shape

**The dependency claim is stronger than the review had it: none of the six touches `artifacts-fs.ts`,
and none touches `data-root.ts` either.** Every one does a bare `fs.writeFile` to a path computed off
`process.cwd()`. `blocks.ts` imports `store/artifacts.js` for **types only**. So stage G would break
none of them at compile time and all of them in fact.

**The finding that changes the stage: the CLI cannot live in the stage module.** Every Postgres
artefact write is fenced on a running `jobs` row and a draft revision (`requireLiveJobOwnsDraft`,
`pg-session.ts`), so a standalone run must reach `src/jobs.ts` — and `jobs.ts` imports `pipeline.ts`
imports `blocks.ts`. A `main()` reaching for the queue from inside a stage closes a cycle, and
`npm run check` gates on cycles. **So stage E is six `main()`s deleted and one script written**, not
six files edited. The spike's working prototype is
`scripts/stage.ts`: `npx tsx scripts/stage.ts <step> <slug> [--force]`,
with `package.json` keeping the six old names.

**Verified against local Postgres**, on a scratch clone of the `writes` corpus:

- `blocks --force` twice, then unforced. Both forced runs: **19 blocks, 0 minted, 19 kept**, a new
  draft off the published revision, published. Three revisions, **one distinct id set** — the
  block-id contract survives a re-run because it is the same code the queue runs.
- Unforced: `skipped`, job `done`. `isDone` answered from Postgres.
- Someone else's slug: refused 404 — but as a raw stack trace, which needs a sentence.

**One real bug, reproduced and then cleaned up.** `enqueue` refuses only when the slug is *somebody
else's*: a slug that exists nowhere is treated as **claiming a name**, so `npm run blocks -- typoo`
creates an `articles` row and a failed revision and leaves the wreck on the shelf. The script
pre-checks `articleExists` and refuses with exit 1. Worth fixing at the source too.

**Owner selection needs no new concept**, which removes the crux we expected: outside a request
`currentOwnerId()` falls through to `SPIDERYARN_OWNER_ID`, else `DEV_OWNER_ID`, and throws in
production ([`owner.ts`](../../src/owner.ts)). `npm run setup` already writes it.

**Three things the stage has to deal with that are not in the contract:**

1. **`withLedger("cli", …)` becomes wrong.** The job runner already opens a `job_step` spend scope
   per step, so a CLI wrapping the whole run in a `"cli"` scope double-scopes it. **`tests/paid-cli-ledger.test.ts`
   asserts the *source shape* of the old tails in `hierarchy`, `labels` and `pdf-read`** — it has to
   be rewritten in this stage, deliberately, not deleted quietly when it goes red.
2. **`enqueue` ends by calling `pump()`**, which would race the script's own `advanceJob` loop.
   `evals/cost/run.ts` sets `VERCEL=1` around the call to stop it. That is a wart and a third caller
   lying about being on Vercel — **give `enqueue` an explicit `pump: false` instead.**
3. **Startup roughly doubles**, because importing `jobs.ts` pulls the whole graph: measured 47 s wall
   / 7.3 s user against 26 s / 4.3 s for `blocks.ts` alone, on a box at load 100. A few seconds on an
   idle machine. Say so in the docs so nobody files it as a regression.

**`architecture.md` § Conventions is self-contradictory and this stage should fix it**: it says
"two of seven" stages cache on a content hash in one line and "seven stages do it" in another.
Neither describes these six. `blocks` freshness is **structural** — `blocksMatchTheirHtml` re-splits
the stored HTML and compares block for block; `hierarchy`'s `tree.json` carries no hash at all; and
since 2026-09-01 `pdf`'s per-chunk cache is `checkpoints` rows, which the CLIs pass
`nullCheckpointStore()` for. **So the CLIs have no resume today**, and moving them to Postgres makes
one possible for the first time — not part of this stage.

**Estimate: a day and a half**, with the decisions below settled first. `extract`, `blocks` and
`hierarchy` are already done by the spike's script. `fetch` is an hour plus decision B. **`pdf` is
the one that is reasoned rather than measured** — it needs `mintUpload` and bytes through the blob
store — and should be spiked separately before anybody commits to its number.

#### The contract the six commands share

`npm run fetch|extract|pdf|blocks|hierarchy|labels` become one command with six names:
**`npx tsx scripts/stage.ts <step> <slug> [--force]`**. They are the same code path the queue runs,
driven from a terminal instead of from a browser — `enqueue` then `advanceJob` in a loop, exactly as
[`evals/cost/run.ts`](../../evals/cost/run.ts) already does.

**Which article — by slug, and only one that is already there.** Every command but `fetch` refuses
if the reader has no article under that slug, and refuses *before* enqueueing, for the bug above.
Exit 1, with a sentence saying this command re-runs a stage and does not add an article.

**`fetch` becomes `npm run ingest -- <url>`, and does the whole ingest** — not a fetch-only job.
**This reverses our own recommendation, on Sol's review of 2026-09-03, and the reasoning is worth
keeping** because "just enqueue the one step" is the obvious thing to try:

- **Publication happens once, when the job settles**, not per step
  ([`pipeline.ts`](../../src/pipeline.ts) § *Why it asks Postgres*: *"The job settles, and
  `publishRevisionIn` … resolves the slug"*).
- **`reasonsNotToPublish` refuses a draft with no blocks and no tree**
  ([`pg-revisions.ts`](../../src/store/pg-revisions.ts)). So a fetch-only job on a new article
  **fetches, pays, and then fails at publication**, leaving an article row nothing can show.
- **And on an *existing* article it is worse, because it succeeds.** The draft carries the published
  revision's blocks and tree, so a fetch-only run publishes **new raw bytes beside stale derived
  content** — an incoherent revision, reported as success.

**The question was malformed and Sol reframed it.** The workflow being preserved — *write the fetch
output now, let another process continue later* — worked only because a file was a durable handoff
between two processes. Postgres has no such handoff, and building one would be a fourth design for
durable unfinished jobs, inside a cleanup. **The honest v1 is that re-fetching cascades**, which is
what `cascadeForce` already does for every other step.

This does not weaken AGENTS.md's every-stage-runnable rule. That rule is *"against a slug"*, and
`fetch` is the stage that has no slug yet — for the first stage, "on its own" means "create the
article". **Rename rather than alias**: an alias is a second name to keep in step, and
`npm run fetch` failing loudly with *"Missing script"* is better than it quietly doing something
else. Per CLAUDE.md's rename rule, sweep the whole repo for the old name.

#### `pdf` — spiked 2026-09-03, and it is not a stage CLI at all

**The draft said:** *"`pdf` takes a local file path, minting an upload record and enqueuing
`{ upload, steps: ["extract"] }` — the same full-ingest shape, entered through an upload instead of
a URL."* **Four of those clauses are wrong.** The spike ran the whole thing end to end against the
local database and Supabase Storage — a 1-page PDF ingested to a published revision in 20.1s for
$0.0142 — so what follows is measured, not read.

**1. `steps: ["extract"]` fails immediately, and `fetch,extract` fails *after paying*.**
`extract` is not the step that acquires an upload; `fetch` is (`acquireUpload`,
[`pipeline.ts`](../../src/pipeline.ts)). Measured: `No fetched document for "…" — run the fetch step
first`, job `error` in 0.16s, leaving an article row and a failed revision behind. With
`--steps=fetch,extract`, `extract` made its paid model call ($0.0006, 8.3s) and *then* the commit
threw `PublishRefused: … it has no blocks; it has no tree` — the transcription thrown away with the
draft. **This is the argument the plan already makes for turning `fetch` into `ingest`, and it
applies verbatim here.** The plan contradicted itself. The only shape that works is the default
ingest: `fetch, extract, blocks, hierarchy, assets`.

**2. Mint is two of five steps, not the whole thing.** The CLI must copy `queueAnUpload`'s order —
mint, **put the bytes**, **claim**, enqueue, **`noteSlug`**. `settleUpload(…, "verified")` runs only
`if (record.status === "claimed")` ([`pipeline.ts`](../../src/pipeline.ts)), so skipping the claim
leaves the record `pending` for ever with no slug. **The article is fine and the record silently is
not** — which is why the spike's first two runs looked like successes.

**3. It needs no grant issuer** — a simplification, measured both ways. Signed grants exist so a
*browser* can write; a CLI already holds the service key and can
`blobStore().putIfAbsent(stagingKey(id), …)` directly. Identical result, 0.05s.

**4. `--force` is meaningless for `pdf`.** `enqueue` gives every upload
`{kind: "minted", slug: slugWithShortId(…)}` unconditionally, so two runs of one file are two
articles — Greg's own decision, in [`jobs.ts`](../../src/jobs.ts). So `pdf` is a **second** exception
to *"every command but `fetch` refuses if the reader has no article under that slug"*, and the
contract above should say so.

**And the finding that outranks all four: `npm run pdf` is the PDF extraction-quality tool, not a
stage runner.** Today it prints the pages, the chunk plan, and `report(checked)` — the per-chunk
recall table from [`pdf-score.ts`](../../src/pdf-score.ts) — then the title, the records, mean recall
over N pages, token counts and retries. **That is where the numbers in `evals/pdf/README.md` came
from.** The queue path surfaces none of it: the job's entire `detail` for extract is the title.
Replacing this command with a queue ingest **silently retires the PDF quality tooling**, which is
not a thing the plan noticed it was proposing.

**Decision: split the name in two, rather than convert it.** The ingest entry point is a new name;
the quality tool keeps its behaviour under an eval name (`npm run eval:pdf-read`), pointed at
`output/`. Its file writes are `output/<slug>.html` and `data/<slug>/meta.json` **for a human to
look at, not store artefacts**, so stage G does not force this and the tool can keep writing them.
This is a technical fork rather than a product one, so it goes to Sol with the stage rather than to
Greg — but it is recorded here because "we quietly deleted the PDF eval tooling" is exactly the kind
of thing a plan should not let happen by omission.

**Two more things the stage inherits:**

- **`blobStore()` falls back to `fsBlobs()` when either Supabase credential is missing**
  ([`blobs.ts`](../../src/store/blobs.ts)), rather than refusing the way `postgresBlobStore()` does.
  After stage F removes the flag, `npm run pdf` on a machine with no Supabase would happily write
  bytes under `data/_blobs/`. **The CLI should ask `postgresBlobStore("npm run pdf")` for its
  store.** Flagged as a code read, *not* measured — `.env.local` is applied over `process.env`, so
  the spike could not unset the key to prove it. Worth proving in stage F.
- **A second test file the plan did not name.**
  [`stage2c-raw-bytes.test.ts`](../../tests/stage2c-raw-bytes.test.ts) has a describe block *"npm run
  pdf keeps the original where the reader can reach it"*, and `keepTheOriginal`
  ([`pdf-read.ts`](../../src/pdf-read.ts)) **has no caller but `main()` and that test** — delete
  `main()` and it becomes exported dead code with a green test describing a command that no longer
  exists. `paid-cli-ledger.test.ts` also names `src/pdf-read.ts` in eight places, including an AST
  gate and negative controls that mutate the source, so it is more than the one-line rewrite the
  plan implied.

**The measured plumbing cost: ~0.2s**, all of it. Mint 0.05s, PUT 0.04s, claim 0.01s, enqueue 0.01s,
fetch step 0.12–0.16s. Process wall was 5.0s, of which ~4.5s is module import — which also settles
the `blocks` spike's *"startup roughly doubles"* note as **a load artefact**: 47s was a box at load
100. **`pdf` is 3–5 hours of the day and a half, under an hour of it plumbing** — and that estimate
holds only if the split above is settled before anyone starts.


**`npm run labels` is retired**, per the same review. There is no `labels` step and adding one is a
pipeline redesign to preserve a debugging command: `hierarchy.md` is explicit that hierarchy
deliberately produces structure, gists, blocks and labels as **one typed atomic result**, and labels
are a second model pass rather than an independently publishable stage. Option (ii) would only be
coherent if `labels` became a *required* default step, and excluding it from normal ingest would
create an intermediate tree the existing contract calls incomplete. Re-labelling becomes
`npm run hierarchy -- <slug> --force`; the extra structure call is the honest price.
`generateLabels` stays exported for `evals/`. If re-labelling turns out to be common, that is a
maintenance operation later, not a fake optional pipeline stage.

#### Fix the unknown-slug bug at the choke point, not in the script

The spike's `articleExists` pre-check in `scripts/stage.ts` is a plaster. The invariant belongs in
`enqueue`:

```ts
if (!request.url && !request.upload && !(await articleExists(request.slug))) throw 404;
```

`articleExists` is **owner-scoped**, so "absent" and "somebody else's" stay indistinguishable to the
caller, which is the existing privacy rule. URL and upload requests are exempt because those are how
an article is created. A bare-slug request already means *"run something on my existing article"*, so
no legitimate route path changes — **but a test that currently blesses an unknown slug will reverse,
and it must be reversed deliberately rather than patched green.** Remove the script-level guard once
this lands.

**Whose — the environment owner**, `SPIDERYARN_OWNER_ID` else `DEV_OWNER_ID`, a throw in production.
Where that names an account that does not exist the failure would arrive as a foreign-key violation
from inside `enqueue`, so the script checks the row first and says so — the same check
`evals/cost/run.ts` already makes.

**Which revision — a new draft each run, published at the end, in one transaction.** The job opens a
draft off the current published revision, the step writes into it, the commit publishes it. **Nothing
is edited in place**, so a re-run that goes wrong leaves the reader on the revision they were already
reading. The block-id contract survives because it is the same code: `beginDraftIn` carries the
published revision's block rows into the draft, `previousBlocksFrom` reads them as the baseline, and
`assertIdsCarried` stops the stage if this run shares no ids with it
([block-ids.md](../project/block-ids.md)).

**What a re-run does without `--force`: nothing, and it says so.** Freshness is the step's own
`isDone`, asked of Postgres. `--force` re-runs the step and, per `cascadeForce`, everything after it
in that job — for a one-step job, just that step. **`--force` is not "start over"**: it is the
ordinary idempotent path and it keeps its ids.

**What it prints.** Article, owner, step, job id; then the step's own one-line `detail`
(*"19 blocks, 0 new ids (19 kept)"*); then the job's status. **Exit 0 if the job finished, 1
otherwise.** The step's `error` field is the *reader's* sentence and is not enough on its own — a
missing upstream artefact reads as "something about how this app is set up", while the developer's
sentence is in the log. The script prints the log's.

**When the previous stage has not run**, the step fails with that sentence and the job ends `error`.
**There is no auto-chaining**: naming one step runs one step. Chaining is what `POST /api/jobs` with
several steps is for.

### F — the hinge, one commit, and narrower than the first draft

Only the atomic policy change, because everything additive has already landed:

- Remove store selection and the runtime feature gates — **all 19 sites, `vite.config.ts` included**.
- Application, dev and health paths require Postgres unconditionally; `storeFromEnv` loses `"files"`.
- Test readiness flips from optional skipping to required preflight.
- The obsolete-value tombstone goes in (§ below).
- Remove active environment injection: `.env.example`, **all four `package.json` scripts** (`dev`,
  `dev:pretty`, and the two `eval:cost*` ones), `vercel-health.ts`'s `EXPECTED` list, `gjd-remote
  push-env`'s allowlist, and the sentence in `evals/cost/harness.ts` that names `eval:cost` as the
  thing which sets it.

**The sharper invariant, from the second review: after the hinge, the tombstone is the only
executable code allowed to read `SPIDERYARN_STORE`.** The 19-site inventory counts comparisons and
therefore **misses live consumers in `scripts/`** — `scripts/db-seed-dev.ts` reads the raw variable
via `storeVerdict`, and `scripts/ai-cost.ts` branches on `STORE` and prints
*"Re-run as: SPIDERYARN_STORE=postgres npm run cost"*. Their obsolete behaviour dies **in the hinge,
not in stage I**, or the repo spends the interval telling people to set a variable that no longer
does anything.

**Moved out of the hinge on review:** the self-guarding exports (→ D′1), the glossary (→ D′3), the
readiness infrastructure (→ **T-D**), and the `attempt` types (→ H).

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

**This arithmetic is why the abstraction has to exist, and stage T-D is now where it comes from.**
Building the preflight alone still leaves the hinge needing edits in ~82 files to satisfy the
*"no `reachable ? describe : describe.skip`"* invariant — a mechanical 82-file diff inside the one
commit that must stay readable. So **first migrate every caller behind one central
suite-registration abstraction with its behaviour unchanged**, reviewable on its own and provably a
no-op; then the hinge activates the mandatory preflight and removes the skip branch **in one place**.

That abstraction was going to be D′2. It is 260903e's Stage D, which this plan absorbed, so it is
built once as **T-D** and the hinge consumes it.

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
