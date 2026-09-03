# Delete `SPIDERYARN_STORE` and the filesystem store

**Status, 2026-09-03. Fourth draft, and the build has started.** GPT Sol returned *not ready* on the
first draft and *ready with changes* on the second; those changes are in. The three pre-build spikes
the second review asked for have all run, and each of them moved the plan — the sections below carry
what they found.

**Landed in the working tree:** D′1a (`guardDbStore` is idempotent) and stage A's witness 1
([`scripts/store-migration-candidates.ts`](../../scripts/store-migration-candidates.ts)).
**Prototyped, not landed:** stage E's [`scripts/stage.ts`](../../scripts/stage.ts).

**This plan absorbed [260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md)
on Greg's decision** — see stage T. That is the largest change to its shape since it was written.

**The order to build in**, after Sol's third review. Not alphabetical, and **T sits early because
three later stages consume it**:

```
A (store inventory) → B0 → T-B (factory) → T-C (lanes) → T-D (activation) → T-E (pollution)
  → C → B → D → D′1b → D′3 → E → F (hinge) → G → H → I
```

The `pdf` spike is independent and can happen any time before E.

**Two corrections that review made to our own draft of this order:**

1. **D′2 is gone, because it was scheduled twice.** 260903e's Stage D *is* the suite-registration
   abstraction D′2 was going to build. Absorbing one and keeping the other would have built it
   twice — exactly the duplication the absorption was meant to prevent.
2. **B0 moves ahead of T.** It is cheap, independently measured, and needs nothing from the test
   database.

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
| 1 | **Drop *"start over"* from the glossary** rather than build a Postgres `deleteGlossary` | Greg |
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

### B0 — take `RUN_LOCK` off the seed window, first, on its own

**Found at the start of the build, and the repo had already done the hard half.**
[`tests/helpers/scratch-article.ts`](../../tests/helpers/scratch-article.ts) records its own
measurement, 2026-09-01, 16 concurrent processes each seeding a **uniquely named** article:

```
with the lock     max seed 4.9–6.1s   (the last one waits for fifteen turns)
without the lock  max seed 1.0–2.0s
```

`loadArticleIntoPg` takes `RUN_LOCK` around its load window, which serialises **every seed in the
whole test run**. The one thing that genuinely needed it is fixed at the source: N clones of one
corpus article share a `raw_sources` row keyed `(sha256, kind)`, and the old
`select … for update` locked nothing over zero rows, so all but one clone lost its transaction to a
duplicate key. `writeRawSource` is now conflict-tolerant and reads the row back
([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts), `tests/store-raw-source-race.test.ts`). The
docstring's own conclusion: *"for these suites the lock really is pure queue. It is kept anyway for
now, because removing it is a change to `loadArticleIntoPg`'s contract and belongs in one deliberate
commit rather than as a side effect of converting a test file."*

**This is that commit, and B is why it is now worth making.** B multiplies the number of suites that
seed; doing it after B means paying the queue through the whole conversion and then re-measuring
everything.

**It is measured, not reasoned.** Re-run the 16-process concurrent-seed experiment before and after
on a **quiet box** — a measurement taken at load 144 says nothing, and this box reached that on
2026-09-03 with two suites running. Ten runs after, not one: the failure it used to have was a lost
race, and a race that does not fire is indistinguishable from one that cannot.

**And it is the one change here that can hurt other agents**, since every worktree shares this
helper and a flaky seed would surface as somebody else's unrelated red. If the measurement is not
clean, leave the lock alone and say so — B is slower, not blocked.

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
[`scripts/stage.ts`](../../scripts/stage.ts): `npx tsx scripts/stage.ts <step> <slug> [--force]`,
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

**`pdf` takes a local file path**, minting an upload record and enqueuing
`{ upload, steps: ["extract"] }` — the same full-ingest shape, entered through an upload instead of
a URL.

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
