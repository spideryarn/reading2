# Delete `SPIDERYARN_STORE` and the filesystem store

**Status, 2026-09-06. Everything through stage G has landed and is on `dev`. The flag and the
filesystem store are gone.** What is left is two stages, and neither is ordinary work in progress:

- **H is optional and currently declined** — tightening contracts the filesystem store had been
  weakening. It is the only stage of the nine with no failure behind it; every other one had a bug,
  an outage or a flag that lied. Greg has said he was "not sure about H and I".
- **I is unblocked as of 2026-09-06 16:35.** Greg ran `vercel env rm SPIDERYARN_STORE production`
  and `… preview`; both returned *Removed Environment Variable*. It had been blocked on that and on
  nothing else, because deleting the tombstone while a deployment still asks for `files` would
  silently ignore what the operator asked.

  **The sensor kept firing after the removal, and that was not a fault.** A deployment's
  environment is baked at build time, so `/api/health` on the deployment built at 09:49 that day
  still reported `retired: [SPIDERYARN_STORE]` — accurately, about what *it* was built with.

  **This header said, for about an hour, that the confirmation stage I needed was "the first
  production deploy after the removal coming back with no `retired` field". That was circular and
  is struck out.** GPT Sol's review of stage I found it (F2): the next production deploy contains
  stage I, which deletes the field unconditionally, so its absence would have proved nothing
  whatever about the deployed environment — a check that reports success no matter what the world
  is doing, which is [silent-success.md](../reusable/silent-success.md) wearing this plan's own
  colours. It is worth keeping the mistake visible, because it was made *by* the person who had
  just finished writing the sensor and understood exactly how it worked.

  **The evidence is the removal itself**: `vercel env rm SPIDERYARN_STORE production` and
  `… preview`, both returning *Removed Environment Variable*, quoted by Greg into the session at
  16:35 on 2026-09-06. The sensor's job was to say *when to look*, and it did that. It was never
  able to confirm its own retirement, and nothing that deletes itself in the same commit can.

**Do not re-derive a stage count from this file.** An earlier version of this header said "seven of
thirteen stages are done, and stage B is started" and was two days and five stages out of date —
the failure § *Counts are perishable here* is about, in the header warning about it.

GPT Sol returned *not ready* on the first draft and *ready with changes* on the second; those
changes are in. The three pre-build spikes the second review asked for have all run, and each of
them moved the plan — the sections below carry what they found.

**This plan absorbed [260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md)
on Greg's decision** — see stage T. That is the largest change to its shape since it was written.

**The order to build in**, after Sol's third review. Not alphabetical, and **T sits early because
three later stages consume it**:

```
A (store inventory) ✅ → B0 ✅ (already done) → T-B (factory) ✅ → T-C (lanes) ✅
  → T-D (activation) ✅ → T-E (pollution) ✅
  → B ✅ → B2 ✅ → B3 ✅ → C ✅ → D ✅ → D′ ✅ → E ✅ → F ✅ (hinge) → G ✅
  → H (optional, declined) → I ✅ (2026-09-06) — the plan is finished
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
| **B** | **26 of 26.** Two in a pilot, ten in two halves, then thirteen in three, then `routes.test.ts` as B2. Every file carries its mutation, the run's own numbers, and what the mutation does *not* cover — retained in the file after a review found the first ten had reported the evidence without keeping it. |
| **B2** | `routes.test.ts`, one `describe` at a time. 127 tests, ~150 minutes against an estimate of 240. |
| **B3** | The stage-end review's seven findings. The evidence guard rebuilt after Sol **reproduced** that it could not see nine of ten markers deleted; `STORE_CONVERSIONS` replaces `convertedInB`; two kept greens closed and three evidence notes corrected against re-run mutations. `routes.test.ts` 129 tests. |
| **witness** | Re-run twice on 2026-09-04. **91 files touch the store, against 88 before stage B** — see below; that is the measurement that moved stage D onto the critical path and cut stage C by an order of magnitude. |
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

**The headline number, and it is not the one this plan expected.** After 26 conversions the
filesystem store's reach went **up**, 88 → 91, because 22 of the 26 still reach it through
`scratchArticleInPg`. **Stage B moved the assertions and left the fixtures.** Nothing is deletable
until stage D replaces the fixture loader, and B was never on that path — see § *The witness was
re-run*.

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
`files` (`src/store/live.ts`), so every test, every fixture and every
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

**Six. Five on 2026-09-03, one on 2026-09-04.** Recorded together because each one deleted or moved
work, and because two of them were handed back rather than answered.

| # | decision | by |
|---|---|---|
| 1 | **Drop *"start over"* from the glossary** rather than build a Postgres `deleteGlossary` — **overtaken the same day: somebody built it, see D′3** | Greg |
| 2 | **Move the stage CLIs to Postgres** rather than delete them | Greg |
| 3 | **Absorb [260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md)** into this plan rather than depend on it or duplicate it | Greg — see stage T |
| 4 | **Retire `npm run labels`** | Greg delegated; settled with Sol — see stage E |
| 5 | **`npm run fetch` becomes `npm run ingest`, and does the whole ingest** | Greg delegated; settled with Sol, **against our own recommendation** — see stage E |
| 6 | **Run the job to the end of G. `I` waits on Greg's Vercel change; `H` is sized after G rather than committed to now** | Greg, 2026-09-04 — below |

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

**6 — how far to run. Decision: through G, on a better reason than the one we gave.** Asked
mid-flight whether the whole thing was still worth doing, we recommended C → F and said G could be
reassessed, costing G as *maintenance burden* — which is nearly inert in a repo this young. Greg
overruled the framing:

> I would like to delete dead code, to avoid future agents being confused.
>
> — Greg, 2026-09-04

That is the stronger argument and it is the one to keep. **In a repo where agents read the code to
decide what to do, 3,900 lines of live-looking filesystem store is an active hazard, not clutter.**
Every agent that opens `src/store/fs.ts` has to work out for itself that nothing runs it.

**The same reason carries `I`, which is why `I` is not optional either.** The tombstone is live code
reading `SPIDERYARN_STORE` and throwing on `files`; a permanent validated no-op says a store
selection still exists. See § *The tombstone*, which already says so in its own words. `I` is small —
one deletion and the grep listed under the stage — but it is **gated on Greg**, not on us: there is no
Vercel credential on this box, so the variable has to come out of Preview and Production by hand
first, and a hinge that threw on any value before that would break the next deploy.

**`H` is the odd one out and is deliberately left open.** `G` and `I` remove things that mislead;
`H` *adds* strictness the filesystem store had been preventing. Nothing is incoherent without it, it
carries its own design question (chat's return type split, and whether `claimsProblem`'s unreachable
400 stays as a fail-safe), and bundling it would mean the store deletion cannot be called done until
an unrelated type change lands. **Size it after G**, which touches the same seams, rather than
committing either way now.

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

##### Dropping them out collides with the evidence guard, and the plan did not see it

Written down before the re-run rather than after, because it is the kind of thing that gets decided
by whatever breaks first.

The instruction above — *let every converted file drop out of `STORE_MIGRATION` entirely* — was
written before the evidence guard existed. **The guard read `convertedInB` off the registry entry**
— it no longer does, see B3 below — so deleting the 26 entries would have deleted the guard's
subject. Its control
(`expect(converted.length).toBeGreaterThan(20)`) fires, which is the control doing its job, but the
outcome is that mutation evidence stops being checked **at exactly the moment stages C, D and E start
producing more of it**.

The two facts have different lifetimes, which is the root of it: a `STORE_MIGRATION` entry says *what
work this file still needs* and should die when the work is done; the evidence record says *this file
was converted, and here is where its proof lives* and should outlive the entry by a long way.

**The fork, unresolved here on purpose:**

1. keep the converted entries with a fifth category `converted` — the map stops meaning
   "work remaining";
2. move the record out to a separate exported `CONVERTED` (file → date) the guard reads, so the map
   shrinks and keeps its meaning;
3. retire the guard at the end of B and trust the markers.

**Resolved as 2 by GPT Sol, 2026-09-04**, on the lifetime argument: `STORE_MIGRATION` describes
current remediation, and conversion evidence is *historical and monotone*.

**And my stated objection to 2 was wrong.** I wrote that option 1 at least has the witness forcing an
entry to appear. It does — and it **does not force that entry to be marked converted**, so option 1
carries the same "conversion quietly unmarked" hole and buys nothing for it. The objection was real
about 2 and simply false as a comparison.

What actually closes it is a **two-way guard on marker-set equality**, which is the completeness check
the `> 20` control was standing in for:

- every file in the converted list carries both markers;
- **every file carrying either marker appears in the list.**

That catches *evidence written, list forgotten* and *list written, evidence forgotten*. It cannot
catch a conversion where **both** are omitted, and no snapshot guard can — inferring an entirely
unrecorded event needs an independent oracle. So:

> **Freeze each stage's target cohort before editing anything in it**, and require every member to
> reach the converted list or an explicit other disposition. B's 26 exist already; C, D and E's must
> be derived and frozen *before* their conversions start.

**And not by witness delta**, which was the obvious cheap oracle and is a trap: removing a shared
mechanism can stop a file touching the store without that file having been converted at all.

Four design corrections taken with it:

- **`convertedInB` becomes stage-neutral** — `STORE_CONVERSIONS`, since C, D and E convert too and a
  field named for one stage will be lied to by the next. Sketched here as `file → { date, stage }`;
  it landed with five fields, because freezing each file's marker *counts* turned out to be what
  makes an individual marker load-bearing. B3 below.
- **The two maps are not required to be disjoint.** A converted suite may still reach the filesystem
  through collateral machinery, and forcing an either/or would push somebody to delete a true entry.
- **`STORE_MIGRATION` means *how each current filesystem reach will be eliminated***, not *"work this
  file needs"* — `shared-mechanism-collateral` already contradicts the stricter reading, so the
  header's wording is what is wrong, not the category.
- **`> 20` is demoted to what it always was:** an anti-empty control under the real check, not the
  check.



**And that re-run is now a command rather than a reconstruction**, 2026-09-04.
`vitest.witness.config.ts` and `tests/setup/fs-store-witness*.ts` were kept, but the thing that ran
them and assembled the JSON was not, so the step above was unrunnable — a number recorded without its
derivation, which is the failure this plan spends a section on.
[`scripts/store-migration-witness.ts`](../../scripts/store-migration-witness.ts) is that missing half:

    npx tsx scripts/store-migration-witness.ts --self-check                                  # ~1 min, 12 control files
    npx tsx scripts/store-migration-witness.ts --full --out tests/store-migration-witness.json

The command is recorded in the JSON's own `what` field so it cannot go missing twice. Three things
changed with it, each of which alters what a re-run will say:

- **The instrumented run now reproduces the three lanes**, derived from `vitest.config.ts` rather than
  restated. The 2026-09-03 measurement ran every file in one project on the shared database, which was
  fair when the lanes were a day old and is wrong now that stage B's output *is* the Postgres suites.
- **`--self-check` runs seven positive controls covering all eight instrumented modules, four
  negatives, and the read-only blind spot**, and it was watched failing three ways: the hook pointed
  at a module nobody imports (7 positives red, negatives still green), method wrapping removed (the
  subtle one — module-level exports stay green, `fsJobStore.get` and friends vanish), and the
  recorder's output disabled (everything "DID NOT REPORT", which is the distinction the witness
  exists for). Two of its original controls had already been converted by stage B and the check said
  so, which is the intended way for it to age.
- **`--full` re-runs each non-reporting file on its own** before scoring it `unresolved`, which is
  what was done by hand on 2026-09-03, and it **refuses to write** a witness with 50 or fewer touched
  files — the floor `tests/store-migration-registry.test.ts` keeps, applied at the source.

The one hand-edit the committed JSON carries is now code: `tests/store-artefacts-pg.test.ts` is in
neither bucket (`READ_ONLY_BLIND_SPOTS`), which is why its counts sum to 587 of 588.

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
| `src/referee-claims-store.ts` | `loadClaimsRun` |
| [`src/referee-criteria-store.ts`](../../src/referee-criteria-store.ts) | `loadCriteria` |
| [`src/glossary-lookups.ts`](../../src/glossary-lookups.ts) | `loadLookups` |
| [`src/shelf.ts`](../../src/shelf.ts) | `loadShelf` |
| [`src/profile.ts`](../../src/profile.ts) | `loadReaderProfile`, `loadReaderExperimental` |

Eight modules, thirteen readers. **`src/api.ts` is deliberately not on the list** — it reads files
too, but it imports `./store/`, so its `loadArticle` and its ten siblings dispatch rather than
assume. That is the discriminator, and it is why the list is short enough to check by hand.

**These are the filesystem adapter's implementation, exported from `src/*.ts` instead of from
`src/store/`.** The only non-client caller of `loadThreads` in the tree is
`src/store/fs.ts`, which stage G deletes — the `src/web/` matches are a
different `loadThreads`, a client controller's effect. So calling one of these from a test is not
merely reading the wrong store, it is **reaching past the selection into the condemned half**, which
is the reach stage A's witness was built to count. This predicts which of the remaining 24 will hit
it: the three chat route suites, both referee route suites, and anything reading a shelf or a
profile.

#### The five referee suites — 17 of 26, and the feared one was the safe one

2026-09-04. `referee-claims-omitted`, `referee-claims-routes`, `referee-criteria-routes`,
`referee-mirror-route`, `referee-scan-route`. **Five files, 44 tests, one private database, green.**
Cost held at 30-40 minutes for four of five; `referee-criteria-routes` ran long because four
mutations mean four runs.

**`referee-scan-route` was the one this plan was afraid of, and the fear was wrong.** The worry was
that a silently wrong sha256 would point the scan at nothing, and a scan of nothing reports a clean
paper — silent success in the one feature whose job is to say *this manuscript is talking to your
model*. Three independent things make it impossible rather than unlikely, and the conversion proved
it rather than asserting it: the hash is computed twice by two different pieces of code and
`storeRawBytesFor` **throws** if they disagree; `readRawDocument` re-hashes what the bucket returned
and raises `MissingRawObject` rather than answering `null`, so a wrong key is a 500 and never an
empty scan; and a poisoned document and a clean one are seeded in the same run, so a mix-up fails one
of the two. The mutation — rotating the digest in `canonicalKey` — turned **4 of 8 red, all
`MissingRawObject`**. Loud, not empty. Worth carrying forward: **the address being the content hash
is what makes this safe**, so anything that lets a caller pass a key it did not derive re-opens it.

##### Two mutations stayed green, and one of them was a real hole in a Vercel-only guard

1. **`sweep`'s `lt(created_at, cutoff)` could be deleted and `referee-claims-routes` stayed green.**
   That predicate *is* the difference between the two stores: the filesystem store sweeps whatever it
   is shown, Postgres leaves another process's run alone for `CLAIMS_ORPHAN_GRACE_MS`. **On Vercel
   the polling process is never the streaming one**, so without the guard every poll errors a run
   that is still arriving. Nothing in the file began a run and then asked whether a GET had left it
   alone. One assertion added — a young run is still `pending` after the GET — and the mutation goes
   red. The same hole existed in `referee-criteria-routes` and got a whole case.
2. **`criteriaFor` losing `where article_id` stayed green, and was kept.** One article in a private
   database cannot tell a scoped read from an unscoped one. `tests/owner-isolation.test.ts` is what
   speaks for that predicate, and the note saying so sits at the assertion it undermines. **A private
   database per run removes the cross-run leak and leaves the single-article blindness**, which is
   worth knowing before trusting any "writes nothing at all" assertion in this stage.

##### Coverage genuinely lost, because the code is unreachable under the store that deploys

Two whole cases went from `referee-claims-routes` — *"refuses a paper with no text, before a header
is written"* and *"writes nothing when it refuses"*. **`claimsProblem`'s 400 cannot happen under
Postgres**: `reasonsNotToPublish` ([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts))
refuses to publish a revision with no blocks, so `loadArticle` can never hand the route an empty
`blocks` array. The *ordering* claim those cases carried survives on the 404, which is the other
refusal above `sse(res)`.

**So the conversion turned a covered branch into uncovered dead code**, and that is the honest
description rather than a loss to be smoothed over. The code stays — a fail-safe above a stream costs
nothing and the guard it duplicates lives in a different module — but **stage H should decide whether
it stays as a fail-safe or goes**, and it is recorded here so that decision is made rather than
inherited. Same shape as `referee-criteria-routes`'s dropped `sourceHash` assertion, and resolved the
same way: do not manufacture a row so condemned code can go on being exercised.

##### The filesystem-only list is readers *and writers*, and the table was half of it

**[`src/comments.ts`](../../src/comments.ts) § `createComment` is a filesystem-only writer** — same
property as the thirteen readers, and verified: nothing in that module imports `src/store/`. Neither
its name nor its import path says "files". The table above should be read as *the filesystem
adapter's implementation exported from `src/*.ts`*, which is what it always said — but it lists only
the read half, and **a converted test that keeps calling a filesystem writer does not get an empty
answer, it gets a write nobody will ever read.** That is worse, because the assertion that follows it
tends to be about the route's reply rather than the row.

##### One trap for the next converter

**The store's own clock beats an `UPDATE`.** `RefereeClaimsStore.begin(slug, now)` takes a clock, so
an abandoned run can be seeded honestly. `RefereeCriteriaStore.begin` does **not** —
`attempt_started_at` is `clock_timestamp()` — so testing its sweep needs
`vi.useFakeTimers({ toFake: ["Date"] })` and nothing else faked, or the pg driver's own timers stop.
Both are documented in the files themselves.

#### The review found the evidence was reported and not retained — 2026-09-04

[260903f-stage-b-ten-conversions-review-sol.md](260903f-stage-b-ten-conversions-review-sol.md).
Verdict: *land with named follow-ups*, and the approach is right — *"explicit store selection, real
per-run Postgres, serialized files, non-vacuous readbacks"*. It checked every one of the ten for a
surviving filesystem-only reader and found none, and it compared each file against its
pre-conversion self assertion by assertion and found **nothing lost**. The one changed meaning is
`expect(STORE).toBe("files")` becoming `postgres`.

**The finding that matters is about the process, not the conversions.** The plan requires each
converted file to *retain* its mutation and what that mutation does not cover. **Eight of the ten
retain nothing.** The mutations were run — the agents reported them, and this document repeated the
reports — but the evidence was never written into the artefact, so nothing distinguishes *watched
red* from *reported green*. Confirmed by grep before acting on it: only `list-reconciles-expired`
carries a real record (*"Watched red with the final `store.list(owner)` replaced by `return listed`:
one call, not two"*), and `second-job-queues` carries the green one.

That is this plan's own subject turned on the plan: **a claim of evidence is not evidence**, and the
orchestrator relayed ten subagent reports without opening the files. The rule *"'Done, all tests
pass' is a claim, not a result — read the diff"* exists for exactly this and was not followed.

**Re-run, not reconstructed.** Writing a plausible note from reading the code would manufacture the
evidence rather than retain it, which is worse than having none. The eight go back through the
mutation, the run and the watch.

**The process fix is a guard, and it is deferred rather than dropped.** A convention that a comment
should be there is the same instrument that just failed. The evidence wants a typed home — a
`mutation` field on the `STORE_MIGRATION` entry, carrying what was broken, what the run printed, and
what it does not cover, with a test requiring it of every converted file. Not done in this batch
because three agents were editing
[`tests/store-migration-registry.ts`](../../tests/store-migration-registry.ts) concurrently and a
type change would have collided. **Do it when the registry is quiet, before stage B closes.**

##### Two registry accounts that disagree with the code, both verified

Both are `mechanisms` lists that under-state what the converted file still reaches. Neither
invalidates a Postgres assertion; both would leave stage G's account wrong.

1. **`quiz-mark-route` still reaches the filesystem ledger.** Its entry says *"the provider is stubbed
   to reject, so no ledger row"*, and that is wrong twice. `src/ai-call.ts`'s streaming wrapper
   records spend through a `finally`, so a rejection and an aborted stream both record — and
   **[`src/store/ai-calls.ts`](../../src/store/ai-calls.ts) line 74 returns `fsCostStore` whenever
   `NODE_ENV === "test"`, so the ledger ignores the store flag altogether in tests.** The 2026-09-03
   witness corroborates it: `ai-calls-fs:fsCostStore.record`. Wants `ledger-redirect` added — and it
   is a reminder that pinning a file to Postgres does not pin its ledger, which is the whole reason
   **C** is a stage.
2. **`the-query-string-does-not-decide-the-route` uses a symbol from the condemned module.** Its GET
   always calls `sweepChat`, and the *Postgres* sweep writes `CHAT_SWEPT` — declared in
   `src/store/fs.ts` line 390 and imported by
   [`src/store/pg-chat.ts`](../../src/store/pg-chat.ts) line 81. Not a filesystem read returning an
   empty answer; a shared symbol living in the half being deleted. Wants `shared-mechanism` naming
   it, and it is one for stage G's list: **deleting `fs.ts` moves this string, it does not remove
   it.**

Both edits wait for the registry to be quiet, for the same reason the guard does.

##### And it agreed with the two calls this plan had already made

The green mutation's conclusion was checked against the code and confirmed: `tryEnqueue` returns
immediately after a clean insert, so the two accepted-job cases never reach the classifier at all,
and the double-click case reaches `sameWork` with a row that already agrees on owner, slug and work
key — so removing the work-key predicate *cannot* change that answer. The file exercises `sameWork`
but not the necessity of its predicate, and none of `sourceTaken`, `nameTaken` or the id-collision
path.

And on the four entries left as `database-integration`: *"I agree with the plan's resolution: rerun
the witness and remove these entries rather than inventing a completed/transitional category.
Shrinking the map is cleaner than recategorising."*

##### The review could not run anything, and said so

The managed sandbox denied the local Postgres connection (`connect EPERM 127.0.0.1:54362`), the
private setup then installed its poison URL, and collection failed with zero tests. Every finding
above is reasoned rather than reproduced, and the review **says so itself, unprompted, in its own
verdict** rather than letting a retained log stand in for a run it did not do. That is the behaviour
the instruction to hand it evidence is meant to produce, and it is worth recording that it worked —
but it means the follow-ups were verified here, in this tree, and not there.

### B2 is done — `routes.test.ts`, and stage B's 26 of 26

2026-09-04, ~150 minutes against an estimate of 240. **127 tests, green, in the private lane**, which
now runs 126 files and 1966 tests. Converted one `describe` at a time, as the stage said, and **not**
split into siblings.

**Thirteen mutation runs across the 17 blocks, ten of them recorded: seven red, three green.** Every
one is written beside the assertion it bears on with its `**Blind to.**`. Five blocks were judged to
need none, and each says so in its own header — the two stream-refusal blocks and the two PATCH-body
tables validate above any store, and the tweets route's every plausible break also answers *"nothing
here"*, which is not a mutation, it is an ambiguity.

##### Three findings, and the first should stop somebody deleting a check

- **The slug guard is triply redundant and no single mutation can move it.** `require-slug`,
  `routes.ts` § `slugPart` and `api.ts` each refuse independently; the block proves *some* guard
  refuses and cannot say which. Only turning off all three moved it — and then a traversal is a
  **404, not an escape**, because it is the filesystem store that made the class reachable at all.
  Worth having before somebody deletes a "redundant" check on the strength of a green suite.
- **`PATCH /api/reader` answers from its own input, not from the row.** `writeProfile` returns its
  argument, so a write that did nothing still replies with what it was told. Only the `GET`-backed
  assertions can see a broken write, which is a general shape worth looking for: **a route that
  echoes cannot witness its own persistence.**
- **Nothing in the file could tell *this run* from *these runs*** for saved searches — `remove` and
  `recolour` could each lose their id predicate silently. One assertion closed `recolour`; `remove`
  has no two-run case at all, and that green is kept and recorded rather than papered over.

##### What changed meaning, and the one case that had to be added

The reader-profile block's `SPIDERYARN_READER_FILE` isolation has no Postgres equivalent, so it is a
seeded owner under `asTestOwner` with the row **asserted gone** in `afterAll` — the decision this plan
recorded before B2 began. The three admin cases now assert 200-and-a-list, 200-and-a-page, and
`[401, 403, 200]`; *"says nothing about users in three refusals"* keeps its name and gains force,
because the third arm is what proves an empty `users` really would be indistinguishable from a
refusal.

And **an orphaned `pending` comment turns out to be one whose lease has expired**, which needed a new
case — *leaves a live attempt alone*. It is the only case the sweep mutation can reach: **all three
inherited cases would have watched that mutation go green.** Nothing was dropped; two cases gained
assertions.

##### A trap this plan states, which is false

Trap 5 above says `scratchArticleInPg`'s `mutate` rewrites the article URL to
`spideryarn-test.invalid`. **It does not.** The string is defined locally in two test files
(`jobs.test.ts` and `retry-is-only-for-a-failed-job.test.ts`), each with its own `urlFor`. The trap
was written into B2's brief by generalising one agent's local fix into a claim about the shared
helper, without opening the helper. Harmless in B2, where nothing pumps — but it is the fourth thing
today asserted from a report rather than from the code, and the correction belongs next to the claim.

**Promoting it to the helper is the right fix and is not done**, because it changes a fixture every
suite in the lane uses and stage B is closing. It is a candidate for stage C or D: one place, distinct
per slug, so `freeSlug` cannot adopt one fixture for another.

#### The guard is built, and marking the 25 found four files whose evidence was not evidence

**Superseded by B3**, which found this version could not see nine of ten markers deleted. Kept as
written because the four findings below are what the *marking* turned up, and they stand.

`convertedInB` on the `STORE_MIGRATION` entry, and
[store-migration-registry.test.ts](../../tests/store-migration-registry.test.ts) §
*"makes every converted file show its working"*, which requires `**Mutation.**` and `**Blind to.**`
in every file carrying it — with the same three checks the registry already applies to `reason`: a
length floor, and no text repeated word for word **between** files. Watched failing on all 25 before
the marking began, and watched failing again afterwards on a deliberately broken marker.

**The exercise was meant to be transcription and was not.** Marking a claim forces somebody to read
it, and four of the twenty-five did not survive that:

- **`chat-anchor-route` — a *pilot* — had no evidence in it at all.** Its mutation lived only in this
  document's own table. It is now in the file, attributed as *recorded, not re-watched*, which is the
  honest label.
- **`owner-jobs` cited this plan for its evidence** — *"the mutation recorded in § B is exactly that
  line"*. That is precisely the failure the guard exists to close: a file whose proof is a pointer to
  prose somewhere else. Re-run, and it now points at the case above `is not in Bob's list`.
- **`list-reconciles-expired`'s four "watched red" notes are all *call-site* mutations** — replacing
  `store.list(owner)`, dropping the owner argument at the call. **Not one of them reaches a line of
  SQL**, so the conversion had no Postgres-reaching evidence at all, while reading as the
  best-evidenced file in the batch. It was cited as such in this document. Re-run against
  `settleExpired`'s owner predicate: `1 failed | 8 passed`.
- **`jobs-walk`'s seven mutations were all on the filesystem queue.** A `claimIn` that had lost its
  `where` entirely would have left every one of them green.

**And the pilot's own account here needed correcting.** § *Two of the 26 are converted* says
`anchorQuote: quoteOf(…) → null` is a mutation the filesystem store could not have caught, which is
true, and adds that it is *"sharper than intended"* because it trips the `chat_threads_anchor_both`
CHECK. What it does not say is the consequence: **because the route 500s, its four reds do not
separate *the quote was written* from *the row was written at all*.** A sharper mutation is not
automatically a better one.

##### The guard had two bugs of its own, and the second was the instructive one

The first stopped a marker's body at the next `**`. These files bold mid-sentence constantly, so
`**Mutation.** Deleting **the owner term** from …` captured `"Deleting"` — eight characters — and
would have been failed as too short, **teaching authors to strip emphasis out of good prose to satisfy
a guard**. Caught before dispatch by running the regex against realistic prose rather than reading it.

The second looked 900 characters ahead for the next marker or `*/`. A marker further than that from
its terminator matched nothing, and because the file passed on its *other* marker, it was **silently
not counted** — a guard under-reporting while green, which is the shape this whole plan is about.
Caught by the agent using it, and only because it was using it. Rewritten as a scan with no window and
therefore no cliff.

#### The inventory that sized the tail was wrong in both directions

The 16.75-hour figure above came from reading all fourteen remaining files and classifying every
filesystem site. Three of its numbers have since been checked against the files, and none survived:

| | inventory said | actually |
| --- | --- | --- |
| `jobs.test.ts` tests | ~35 | **71** |
| `jobs-walk.test.ts` tests | 9 | **10** |
| `routes.test.ts` filesystem sites | ~40 | **46** — and the inventory was right; see below |
| `routes.test.ts` "501 because filesystem" tests | ~9 | **4 assertions** across 3 tests |

**It is not that the inventory was careless — it is that a site count is the wrong instrument.** The
queue round's own verdict was that *"the byte assertions were the easy part — they are rows"*, and
that the real cost was `claimSession` needing a draft and the Postgres store shape-checking products,
neither of which any count of `readFile` calls can see. So `step-failure-seam` was called an outlier
and took forty minutes, while `jobs-walk` was called ordinary and took ninety.

**And the row about `routes.test.ts`'s sites is a correction of a correction.** This section first
said the inventory had over-counted by more than tenfold — *"3 functions, `cp`, `rm`, `writeFile`,
over a handful of fixture slugs"* — from a grep for `readFile|writeFile|mkdir|rm\(|existsSync|dataRoot`.
B2 counted properly: **16 call sites of those functions, 28 calls into filesystem-only readers and
writers** (`loadComments` ×13, `loadRuns` ×7, `loadShelf` ×5, `createComment` ×2, `deleteRun` ×2,
`patchComment`, `beginAnswer`, `beginRun`) and 2 `SPIDERYARN_READER_FILE` sites. **46, so the
inventory's ~40 was right and the correction was wrong.**

The grep missed the 28 because **it looked for filesystem verbs, and the filesystem-only readers do
not have filesystem verbs in their names** — which is the trap this document spends a table and two
paragraphs on, made by the person who wrote the table. It is the same failure in a third costume: a
search that did not cover the answer, reported as an absence.

**The 240 minutes was still too high — B2 took ~150** — but not for the reason given here. The
estimate was wrong because a site count is the wrong instrument, not because the sites were few.

Recorded because § *Counts are perishable here* is this document's rule and this document keeps
breaking it: **five of the six counts that went stale went stale by being copied**, and these went
wrong by being derived from the wrong thing, which is the harder failure to notice.

#### The evidence guard: cite it, do not copy it

The review's process finding — evidence reported and not retained — wants a mechanical check, because
the instrument that failed was *"a convention says a comment should be there"*, and this orchestrator
then demonstrated the point twice in ten minutes: a grep for the word "mutation" **falsely accused**
five converted files of carrying no evidence, and a second grep nearly **missed** the evidence three
of them did carry. Prose cannot be audited by looking for prose.

**The obvious design is wrong.** A typed `mutation` field on the `STORE_MIGRATION` entry — what was
broken, what the run printed, what it does not cover — makes the compiler enforce the pairing, which
is this registry's own idiom (`StoreEntry` is a discriminated union precisely so that a collateral
verdict without a mechanism cannot be written). But it would put **one fact in two homes**, against
`CLAUDE.md`'s *cite, don't restate*, and the two would drift: the registry entry is edited by whoever
is thinking about categories, and the test file by whoever is thinking about the test.

**And the test file is the better home**, which settles it. The evidence earns its keep by sitting
beside the assertion it bears on — *"what this cannot tell you is whether the read was scoped to this
article"*, three lines above the assertion that cannot tell you. Moved to the registry it becomes a
record; left where it is it is a warning to the next person to touch that line.

**So the guard checks that the citation exists, not what it says.** Every file with a `TEST_LANES`
entry whose `STORE_MIGRATION` entry records a stage-B conversion must contain a findable marker; the
marker's neighbourhood is the evidence, and no copy of it lives anywhere else. What the guard can
honestly check is presence and shape — that a converted file says which mutation was run, what the run
printed, and what it does not cover — and **not** whether any of that is true. That limit is the point
rather than a weakness: a guard that claimed more would be the next thing to trust wrongly.

Deferred out of the stage-B batch because three agents were editing the registry, and out of the
commit that closed it because 25 files were mid-run. **Do it before B2**, so that `routes.test.ts` —
the file with the thinnest mutation coverage per test in the whole stage — lands under it rather than
before it.

#### The four queue suites, the `jobs-fs-adapter` split, and 25 of 26

2026-09-04. `jobs`, `jobs-walk`, `jobs-commit-path`, `retry-is-only-for-a-failed-job`. **4 files, 80
tests**, plus `tests/jobs-fs-adapter.test.ts` at 12. Only
`routes.test.ts` remains, and it is B2.

**Two of this document's counts were wrong.** `jobs.test.ts` had **71** tests, not the *"~35"*
recorded above, and `jobs-walk` had 10, not 9. Both came from an inventory that counted `it(` at a
glance. The § *Counts are perishable* rule keeps being right about this document's own numbers.

**The split took 12 tests, not the 5 the brief named**, and the two extra are the right call:

- **`sweepStopped` (6 tests)** — a pure function exported only from `src/store/jobs-fs.ts` and used
  only by it. Left inside a converted `jobs.test.ts`, it would have kept that file importing a
  condemned module **and** orphaned six tests at stage G. That is the brief's own argument for the
  other two blocks, applied to a block the brief had not seen.
- **`leaves the marker behind when a step fails` (1)** — asserts `fsArtifacts.interrupted` and then
  `rm`s `data/<slug>/steps`. Postgres has no marker; the equivalent is a rolled-back draft and a
  `revision_step_runs` row left `error`.

The new file's header names **two deletion moments**, not one — `jobs-fs`/`artifacts-fs` for most of
it, `step-context-paths` for the `outputs(ctx)` block — and, per block, what already covers the
Postgres side, **checked rather than assumed**: `store-jobs-parity` for `sweepStopped`,
`store-artefacts-pg` for `interrupted` both ways, and **nothing for `writeOnce`'s rename, correctly**.
It also records the one thing none of them has: the marker seen through the real runner.

##### A green mutation says the artefact check cannot see what it is for

Deleting `if (run?.status !== "done") return false;` from `hasArtefacts` left `jobs.test.ts` at 60/60.
A control in the same function (`if (run) return false;`) turned 3 red, so the function is genuinely
on the path — **nothing in the file distinguishes "the artefacts are present" from "a step is recorded
as having run".** `jobs.test.ts` is the only converted queue suite whose skip decisions come from real
rows; `jobs-walk` and `retry` both replace `session.reads`, so neither could have found it.

##### Three traps, and the first is the most dangerous thing found today

1. **`vi.resetModules()` silently moves a private-lane worker onto another database.** The reload of
   [`src/env.ts`](../../src/env.ts) takes a **fresh `INHERITED` snapshot** in which our minted URL
   already sits, so nothing "differs from what was inherited" and `.env.local` wins the next
   `loadEnvLocal()`. Measured: the next pool lands in **`postgres`**, the maintenance database. **A
   suite that only writes would have written there and passed.** Surfaced in `jobs-walk` as a job
   reading `gone` instead of `busy`.

   Fixed in [`tests/setup/private-db.ts`](../../tests/setup/private-db.ts) with the one line
   `src/env.ts` § `PINNED` exists for, which [`unit-no-database.ts`](../../tests/setup/unit-no-database.ts)
   has always had and this lane never did. Above the branch, so the deliberately-unreachable poison URL
   is pinned too — otherwise a reset in a lane with *no* database replaces *"refused fast"* with a live
   connection to the shared one.

   [`tests/private-lane-survives-a-module-reset.test.ts`](../../tests/private-lane-survives-a-module-reset.test.ts)
   is the control, and **its first form passed while the hole was open**: importing `src/env.ts` after
   the reset changes nothing, because `loadEnvLocal()` is a function and not a top-level effect. The
   reload has to reach a caller — `src/db/client.ts` § `databaseUrl` calls it before every pool. That
   wrong first version is recorded in the file, because it is the more useful half.

2. **A seeded article gives `requireUrl` a real URL, and the pump will fetch the web.** These fixtures
   were free of it only because they had no `meta.json`. `scratchArticleInPg`'s `mutate` now rewrites
   to a per-slug `https://spideryarn-test.invalid/<slug>` — verified to fail at DNS with nothing
   leaving the box, and *distinct per slug* so that `freeSlug` cannot adopt one fixture for another.
3. **`jobs.upload_id` is a third id Postgres validates** — a foreign key, so an invented uuid fails the
   insert with `23503`. Beside `jobs_id_format` and `attempt_id` in trap 2 above.

And two shortcuts: **a claim does not need an article** (`lockOrCreateArticle` makes the row when a
draft opens on a bare slug), and **a fake step's product must be one the store accepts** — `{ made:
name }` is refused, `raw` needs a manifest naming a real `raw_sources` row, and without a `stamp`
`publishRevisionIn` refuses with *"the tree was built from different blocks"* and the job ends `error`
one step after the thing under test.

##### Where the manifest was wrong about its own outliers

§ *B's manifest* called `jobs`, `jobs-walk` and `step-failure-seam` the expensive ones because of
`data/_jobs/` byte assertions. **The byte assertions were the easy part — they are rows.** The real
cost was that `claimSession` needs a draft and the Postgres store **shape-checks products**, neither of
which this document mentions anywhere. Estimating conversion cost from a count of filesystem sites
over-counted `step-failure-seam` badly and under-counted `jobs-walk`.

And *"one mutation per `describe`"* needs the qualifier the agent used: **one per *store-touching*
`describe`**, since eight of `jobs.test.ts`'s blocks are pure functions.

#### The lane went green, then two files went red, and neither was what it looked like

Running the whole `private-postgres` lane after the pin: **2 failed of 125**. Both diagnosed, both
fixed, and the lane now runs **125 files, 1839 tests, exit 0**.

##### `store-shelf-reads` had never seeded the articles it audits

It filters the shelf to `!slug.startsWith("test-")` and asserts over what remains, believing that to be
the `data/` corpus. **This file has never put an article anywhere.** It was reading whatever another
suite had loaded under a corpus name and left behind in the run's shared database, and stage B's move
onto `scratchArticleInPg` — which names articles `test-…` — removed the accident. **It fails when run
alone**, and did so before today; the full lane was hiding it.

**Its own non-vacuity guard is what caught it** — `expect(entries.length).toBeGreaterThan(0)`, written
so the file could not pass while asserting over nothing. It fired the first time the accident stopped
happening, which is the entire argument for writing such a guard.

Fixed by seeding three corpus articles through the real `loadArticleIntoPg` → `publishRevision` path,
and by **turning the filter from a deny-list into an allow-list** — the deny-list is what made the file
order-dependent, and both concerns its original comments record (a foreign fixture's `title_override`
changing mid-run, a foreign fixture's wrong column reddening the wrong file) are settled by owning the
slugs, where *"exclude the fixtures we know about today"* holds only until the next suite arrives.

**And the fix uncovered a second vacuity.** The case *"and the corpus, where it has one, really does
exercise the fallback"* had been printing a warning and returning, because the committed corpus has no
untitled article — **a permanently vacuous non-vacuity control**. One of the three seeded articles is
`writes` with its title deleted, so it is now a real assertion. A third, from `openai-huggingface`, is
the only corpus article with a `supplement` block, which makes the scalars audit's recomputation
distinguishable — something that file's own comment says nothing in the database previously did.

##### `jobs.test.ts` was a defect, and not the cross-file interference it looked like

*"Expected 'busy' to be 'claimed'"*, only in full-lane runs. **`pgJobStore.claim` opens by taking the
`queue_state` singleton with `for update nowait`**, so any claim arriving while another claim is
mid-transaction is answered `busy` — *"another claim is being decided"* — whatever job it names. The
other claimant is **the same file**: `enqueue` starts a pump, a request handed an already-running job
is given one too, and those pumps are still waking on their 250 ms→5 s backoff several cases later.

Established from a timeline, not a story — every `claim` call logged, six job ids inside 400 ms in the
red run against four and no overlap in green ones. The obvious alternative was ruled out by measurement:
a probe for `running` rows immediately before the fixture claim, after deliberately running five other
database suites first, returned **zero** — the concurrency cap is not involved and no other file leaves
a `running` row.

**It reproduces alone on a loaded box — 3 of 12, then 1 of 15 — and never on a quiet one.** It read as
interference only because a full lane run is slow enough to be loaded. Worth knowing separately: **lane
file order is not stable run to run**, because vitest's default sequencer sorts by cached durations in
`node_modules/.vite/vitest/*/results.json`.

Fixed by asking again on `busy`, which is the queue's **documented contract** — *"whoever takes it
runs; everybody else is told `busy` and asks again. The pump is not privileged."* **And the retry does
not soften the file**: re-applying the mutation its header records (`leaseIsOver` → `leaseIsLive`)
still produces exactly the two documented reds, with the first now taking 3046 ms instead of 94 ms
because it exhausts the whole budget first. 20 of 20 green repeats under the load that gave 3/12 before.

[`docs/project/testing.md`](../project/testing.md) § *One database, many suites* attributed this error
message solely to a stray `running` row filling the cap. It now carries the second cause, because
looking for a `running` row finds nothing in this case.

#### The eight mutations, re-run and retained — and five of them stayed green

2026-09-04, after the review found the evidence missing. Twenty mutations across the eight files;
**fifteen red, five green**, all twenty written into the file beside the assertion they bear on, with
the run's own numbers. All eight re-run green afterwards (**66 tests**), `src/` clean.

**The five greens are the return on the whole exercise**, and none of them is a small point:

1. **The seeder ships the artefact the oracle asserts.** Suppressing `artifacts.write` in
   `pg-session.commit` left `article-cache-call-site` **green**, because `scratchArticleInPg` clones
   `data/writes`, which already contains `arc.json`, `tweets.json` and `glossary.json`;
   `openOrBeginJobDraft` carries them forward, and `assertProduced` reads back **the fixture's**
   artefact. Verified here: those files are in `data/writes/`. **The file would pass over a session
   that persisted nothing.** This is not one file's bug — **any converted suite whose oracle is "the
   artefact exists after the step" is blind exactly to the extent that the corpus slug it cloned
   already had one**, and that is most of them. It goes in every remaining brief and it is a question
   for the ones already landed.
2. **An unjournalled ticket ships green.** Suppressing `realtimeSessionStore.issue` in the route left
   `chat-live-ticket-route` untouched: no assertion in it ever asks whether the row exists — the table
   appears in a `pgReady` list and a teardown comment, and nowhere else. Covered now only because
   `live-session-routes` was converted the same day, by a different agent, which is luck rather than
   design.
3. **The token is carried and never checked.** Removing the `attemptId` fence from `pgChatStore.finish`
   left `chat-live-turn` green. The `MissingAttempt` throw above it still catches an *absent* token —
   another mutation proved that — but nothing calls `finish` with a **stale** one, because the retry
   aborts the original stream rather than letting the loser land.
4. **"First" is untested.** Swapping the two 409 checks in `refuseAMovedQuiz` left `quiz-mark-route`
   green: the case named *refuses a source-stale quiz before it looks at the batch at all* deliberately
   sends the **correct** batch id, so under either order the batch check passes and the staleness one
   throws. Ordering claims need a case with **both** wrong.
5. **One owner cannot see a predicate that narrows to one owner.** Deleting the owner term from
   `ownedSlug` left the query-string suite green. **That is the fourth file today** — with
   `criteriaFor`, `markConnected`/`close`/`find`, and the referee half's own note. It is a property of
   the private lane, not of any of the four: *a private database with one seeded owner cannot tell a
   scoped query from an unscoped one.* `tests/owner-isolation.test.ts` is what speaks for all of them.

**Two more greens are recorded in the files rather than here**, both of the same shape — a case that
refuses one line earlier than the claim it is cited for, so its 409 is evidence about a different
claim than the file thinks.

##### Three header claims that no mutation can reach

Worth having, because a claim nothing can falsify is a claim resting on a reading of the code:

- `quiz-mark-route`'s *"every refusal happens before a single SSE header is written"* — asserted as
  `streamed === false` on four cases, but nothing can move `sse(res)` relative to the checks without
  rewriting the handler.
- `chat-live-ticket-route`'s *"the history and the tail, from one read"* — both come out of the same
  `threadsFor` call, so the file would not notice if somebody split it.
- `one-article-for-one-address`'s reliance on `jobs_active_source`, which is a partial unique index in
  [`src/db/schema.ts`](../../src/db/schema.ts): loosening it is a **migration, not an edit**, so both
  mutations reached the classifier and the repair while the index went on doing the refusing.

##### And one correction to a header, found by mutating it

The query-string suite claimed `chatStore.load` reaches the article through its slug *and its current
revision*. It does not: `articleIdForOwned` predicates on `ownedSlug` **alone**, and `onTheShelf` — the
published-revision rule — is not in that path. The header named the wrong predicate and now names the
right one.

##### A failure shape that reads as a finding

The first attempt at one mutation used `desc(chatMessages.ordinal)`, a symbol `pg-chat.ts` does not
import. **All 11 tests failed, including the ungated `STORE` control.** That is a module that would not
load, and in a summary line it is indistinguishable from a real whole-file red — so a mutation must be
checked for *which* tests it turned red, not only how many. Recorded in the file beside the real
result.

#### The other four — 21 of 26, and the worst trap yet is a suite that is green and blind

2026-09-04. `all-skipped-publication-log`, `term-lookup`, `live-session-routes`, `step-failure-seam`.
**Four files, 37 tests, one private database, green.** With the five referee suites, stage B stands at
**21 of 26**: four queue files and `routes.test.ts` (→ B2) remain.

##### Seed as one owner, read as another, and every refusal passes for the wrong reason

`term-lookup` seeded as `DEV_OWNER_ID` and read as `currentOwnerId()` — which is `SPIDERYARN_OWNER_ID`
from `.env.local`, a different uuid. **Both 404 cases passed.** A 404 for *"not yours"* is
indistinguishable from a 404 for *"no such term"*, so the suite was green with its fixture completely
invisible. Fixed by running every call inside `runAsOwner(DEV_OWNER_ID, …)`, with the 409 case
documented as the control that keeps the two 404s honest.

**The general form is the most valuable thing this stage has produced, and it goes in every remaining
brief:**

> **A converted suite whose assertions are all refusals can be entirely green while its fixture is
> invisible.** Every refusal-shaped suite needs at least one case that can only pass through a fixture
> the reader can actually see.

The filesystem store had no owner scoping to get wrong, so this failure mode **did not exist before
the conversion** and is created by it. It is not on the trap list because nobody had met it yet.

##### Two instructions in the brief were wrong, and the agent checked instead of obeying

Both came from a careful read of the file rather than a run, which is precisely the distinction this
plan keeps making, and this time the read was mine.

1. **"Replace the 2-JSONL-lines-collapse-to-1 assertion with a `count = 1` query."** Wrong: that
   assertion is about the **ledger**, and `selected()` in
   [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts) returns `fsCostStore` whenever
   `NODE_ENV === "test"` *whatever the flag says*, so the ledger did not move and the assertion was
   already true. Following the instruction would have replaced a working assertion with a weaker one.
   **That is the second finding today to land on that same line**, the first being `quiz-mark-route`'s
   ledger reach, and both say the same thing: **pinning a file to Postgres does not pin its ledger**.
2. **"Replace the journal-write-failure's directory trick with a `vi.spyOn` rejection."** Followed, and
   it cost coverage: the old trick made a **real write fail**, so it would have caught an `issue` that
   swallowed its own error. The spy cannot. Written into the file. A narrower test arrived by
   instruction rather than by accident, which is worse, and it is recorded rather than quietly kept.

##### `step-failure-seam` was never an outlier, and its race is gone

The manifest called it one alongside `jobs` and `jobs-walk`, on the grounds that it asserts on bytes
read back out of `data/_jobs/`. **Its sixteen filesystem sites were mostly scaffolding**, it converted
in about forty minutes like the others, and the `data/_jobs/` assertion **had a direct Postgres
analogue** — it did not have to be dropped. Estimating from a site count over-counted this file badly.

Its intermittent red is also gone: **ten consecutive runs at load average 32-52** with three other
agents working, green every time, recorded in the file as a dated measurement rather than a proof.
There is no `data/_jobs/` left in it to race on.

##### Three more stated-but-not-tested predicates, all found by mutation

- **`live-session-routes`: `eq(ownerId)` can be deleted from `markConnected`, `close` *or* `find` and
  everything stays green.** The file's own header says sessions are "looked up for the authenticated
  owner". Stated, not tested — nothing in it is cross-owner. Same shape as the referee half's
  `criteriaFor`, and the same cause: **a private database with one owner cannot tell a scoped query
  from an unscoped one.** That is now three files, and it is a property of the lane rather than of any
  of them.
- **`all-skipped-publication-log`'s mutation left every one of its six `logged` assertions green** —
  and the log line is the file's actual subject. It proves the `error` column round-trips and says
  nothing about the thing the file is named for.
- **`step-failure-seam`'s mutation missed `job.error` entirely**, and `releaseStepIn` — the mid-walk
  writer a reader actually watches — is never exercised, because every job in the file has one step
  and ends on the first failure.

##### And one docstring that had quietly stopped being true

`persisted`'s justification in `step-failure-seam` said `getJob` hands back a `structuredClone` of an
in-memory index, so only the file read was real. **Under Postgres `getJob` is a `SELECT` too** — proved
by the mutation turning the *in-memory* assertion red first. The function was kept and its docstring
rewritten, rather than leaving a claim the code no longer supports. Prose that survives the change it
describes, found for the fourth time in this plan.

#### The witness could be re-run and could not be re-*proved* — and this section was wrong twice first

`STORE_MIGRATION` membership is driven by the **dynamic** witness — which files *executed* a condemned
function — so a converted file genuinely does stop being witnessed, and the resolution recorded above
holds. (Had it been witness 1's static import graph it would not: a converted route suite still
imports the app, which still imports `src/store/index.ts`, which still imports `fs.ts` until stage G.)

**This section claimed twice that the witness could not be re-run, and both claims were false.**
They are left here named rather than quietly swapped, because the mistake is more instructive than the
work it prompted.

- *"The script that produced the JSON is not in the repo."* Wrong. The instrument —
  [`vitest.witness.config.ts`](../../vitest.witness.config.ts) and `tests/setup/fs-store-witness*.ts`
  — landed in `4900c89e` on 2026-09-03, in stage A's own commit.
- *"Nothing recorded the command."* Also wrong. [`tsconfig.json`](../../tsconfig.json) carried it, in
  a comment above the config's own entry, along with the reason the file is kept and the note that
  stage G deletes it: `FSW_OUT=<path>.jsonl npx vitest run --config ./vitest.witness.config.ts`.

**Both conclusions came from an absence in a search rather than an absence in the tree.** The greps
covered `scripts/`, `tests/`, `src/`, `vitest.config.ts` and `vitest.setup.ts`, and the answer was in
neither of those two places. Treating an incomplete search as proof of absence is the same move as
treating a green test as evidence — [silent-success.md](../reusable/silent-success.md) one level up,
committed to this document and reported before it was checked.

**What was actually missing is narrower, and still worth the build.** The raw run was reproducible;
the **aggregation and the proving** were not. Nothing turned the JSONL into the witness JSON's shape,
separated *did not report* from *did not touch*, re-ran the files that failed to report, applied the
undocumented hand-edit the committed JSON carries, or ran the controls that say whether the instrument
still hooks anything. So *"re-run the witness at the end of stage B"* would have produced **a file, on
the first attempt, with nothing saying whether it meant anything** — which is worse than producing
nothing.

##### Built: [`scripts/store-migration-witness.ts`](../../scripts/store-migration-witness.ts)

`--self-check`, `--files <paths…>` and `--full [--out FILE]`. It hooks the eight modules with a Vite
`resolveId`/`load` plugin that re-exports each one through a proxy — a call trap for functions and a
`get` trap returning per-method recorders for objects — so it records **calls, not imports**, survives
`vi.resetModules()` and `await import()`, and needs no cooperation from the code under test.

**Seven positive controls now cover all eight modules, asserted rather than claimed**, plus four
negatives and the read-only blind spot. And it was **watched failing three ways**, which is what makes
the controls evidence:

| the break | what it printed |
| --- | --- |
| plugin pointed at a module nobody imports | 7/7 positives red, 4/4 negatives still green, 0 method-level sites, exit 1 |
| object proxy returns methods unwrapped | 5 positives red — `data-root` and `artefact-copy`, whose exports are plain functions, **stayed green**, which is exactly why the method-level assertion is separate |
| the recorder's output disabled | every file *"DID NOT REPORT"*, including *"NEGATIVE CONTROL DID NOT REPORT — 'did not run' is not 'did not touch'"* |

It also **aged correctly on its first run**: two of its own positive controls had already been
converted by stage B, and it said so instead of passing.

**Two things about the 2026-09-03 measurement are now known that were not.** The committed JSON is a
measurement **plus a hand-edit** — `tests/store-artefacts-pg.test.ts` was lifted out of
`ranAndTouchedNothing` and put in neither bucket, which is why 88 + 498 + 1 is 587 of 588, and the
registry test asserts that absence. **A naive regeneration would therefore have gone red**, and the
edit is now code (`READ_ONLY_BLIND_SPOTS`) rather than a thing somebody did once. And this document's
*"499 touch nothing"* is the pre-edit number against the JSON's post-edit 498.

**One deliberate change to the engine**: the witness config now derives its three lanes from
`vitest.config.ts` rather than running everything in one laneless project. Defensible on 2026-09-03;
wrong for a stage-B re-run, because stage B's output *is* the Postgres suites, and a laneless run puts
them on the shared database racing every dev server — where a suite that dies in setup writes no
record and scores `unresolved` rather than clean.

**The commands, recorded here so this cannot go missing again:**

```
npx tsx scripts/store-migration-witness.ts --self-check          # ~1 min, first
npx tsx scripts/store-migration-witness.ts --full --out tests/store-migration-witness.json
```

`--full` refuses to write when 50 or fewer files touched the store — the registry test's own floor,
applied at the source, because **an unhooked instrument and a finished migration look identical**.

#### The tail was measured, and it is 16.75 hours, not 7 — 2026-09-04

The twelve done average 30-40 minutes, so the obvious extrapolation says the remaining fourteen are
about seven hours. **They are about seventeen.** Measured by reading all fourteen — every filesystem
site classified as *has a database equivalent* / *asserts something only the filesystem has* /
*incidental scaffolding* — rather than by extrapolating, which is this document's own rule about
perishable counts applied to an estimate for once instead of a count.

It is not spread. Eleven of the fourteen cluster at 25-70 minutes, exactly as the pilot predicted.
Three carry the difference:

| file | minutes | why |
| --- | --- | --- |
| `routes.test.ts` | **240** | 1,598 lines, ~95 tests, ~40 filesystem sites, and two design decisions of its own |
| `jobs.test.ts` | 140 | 1,515 lines, and six of its tests are about the filesystem adapter rather than the queue |
| `referee-scan-route.test.ts` | 80 | needs four correctly sha256-hashed raw-document manifests |

**`referee-scan-route` is the one to be afraid of, and it is not the expensive one.** A silently wrong
hash makes the prompt-injection scan a no-op **while the test stays green** — the exact shape of
[silent-success.md](../reusable/silent-success.md), inside the stage built to remove it. Its brief
says to prove the hash two ways, or to plant a known injection and watch the scan find it, rather
than accepting a green.

**And none of the fourteen is a filesystem-adapter test in disguise.** The registry's
`database-integration` calls all held up under a close read. That is the first independent check
stage A's map has had, and it passed.

#### `routes.test.ts` becomes its own stage, B2, and the split was passed over

The build order gains a stage: **B (13 files) → B2 (`routes.test.ts`) → C**. B2 must land before the
hinge; it does not block C.

Put to Fable as three options — convert it as an ordinary item, lift it into its own stage, or let it
happen inside the hinge — and the third was the one to kill, on a premise this plan had not checked.
The argument for it was that ~9 of its tests assert *"501 because filesystem"*, behaviour F deletes,
so converting them in B writes assertions F rewrites. **That premise is false.** The moment the file
is pinned to Postgres those assertions are already unreachable, and what they become — administrator
gets 200 and a list, anonymous 401, stranger 403, malformed 400 — is behaviour **the hinge does not
touch**, because F deletes the `files` path and not the Postgres one. The work is done once whichever
stage does it. So C had only its cost: a 1,600-line rewrite inside the commit two reviews have spent
their time shrinking, and the largest route suite left on the undeployed store for the whole of C, D,
D′ and E.

**The simpler option passed over: splitting `routes.test.ts` into sibling files** — `reader-routes`,
`admin-gate`, `search-routes` and so on, one per `describe` block, each with its own lane entry and
its own mutation. Recommended, and the reasoning behind it is right: **the mutation rule's unit is the
file, and one mutation over 95 tests is about 1% of what the file claims.** It is the same finding as
`second-job-queues` staying green, pointed at a file instead of a predicate.

It was passed over anyway, and the reason is scope rather than disagreement. The file is named from
seven docs under `docs/project/` and about 133 lines across the repo; splitting it is a
test-organisation refactor with a rename sweep, landing in a tree five other agents are working in,
on top of a store migration. **The benefit is obtainable without the refactor: change the rule's
unit, not the file.** B2 converts `routes.test.ts` one `describe` block at a time, with **one mutation
per block** and each block a stopping point — four or five pieces of mutation evidence instead of one,
which is what the recommendation was actually for, and no references move.

If B2 turns out to want the split anyway once it is inside the file, that is a finding for this
section and not a decision to take quietly.

**The two design decisions B2's brief has to carry, settled now so they are not settled mid-flow:**

1. **Reader-profile isolation.** `pg-reader.ts` keys every row on `currentOwnerId()`, so the answer is
   a seeded owner per run under `asTestOwner` — the shape `OWNER_AUDIT` already audits — not a scratch
   root, for which there is no equivalent. Assert the row is gone in `afterAll`, per stage G's
   teardown rule.
2. **The nine 501 tests.** Rewrite them to real admin behaviour; **do not** split them into a
   `routes-postgres` sibling. The `referee-routes-postgres` split exists *because* the flag existed —
   one process is one store — and a store-pinned sibling is the pattern this plan is deleting.
   `tests/seed-admin-signin.test.ts` already drives `/api/admin/users` against Postgres and is the
   thing to cite. Keep *"says nothing about users in three refusals"*, with its third arm becoming
   200-with-`users`: its comment that a page saying *no accounts* and a page that *could not answer*
   look identical is still exactly the point.

#### Two smaller calls, and both go against building the fixture

**`jobs.test.ts` splits before it converts.** Six of its tests have the filesystem adapter as their
subject — five asserting `STEPS[name].outputs(ctx)` returns on-disk paths, one asserting no
`<id>.json.<pid>.<n>.tmp` files survive `writeOnce`'s rename. They move to
`tests/jobs-fs-adapter.test.ts`, categorised `filesystem-adapter-behaviour`, and stage G deletes that
file beside `src/store/jobs-fs.ts`. The registry classifies files, and `jobs.test.ts` currently
deserves two verdicts at once, which the map cannot express. Leaving them in forces one of two bad
outcomes: a conversion that keeps the file able to reach the filesystem adapter, or six tests quietly
deleted during B — **the uncovered interval G's "same commit as its subject" rule exists to
prevent**. The new file's header says the `outputs(ctx)` block is really about `StepContext.dir` and
`htmlFile`, so whoever removes those fields is the one who deletes it, rather than it being orphaned.

**`term-lookup`'s `example` assertion is dropped, not rebuilt.** It passes only because the filesystem
reader hard-codes a special-cased `example` slug to fall through to a committed fixture. Postgres has
no such directory and no such fall-through, so building a row to keep the guard testable would be
manufacturing state so that condemned code can go on being exercised — a green test proving nothing
about deployed code, which is worse than not converting. The 404-for-unknown-slug arm stays; it is
real under Postgres and it is the half that matters. Recorded in the file header and the registry
`reason` so G's *"enumerate every surviving assertion"* pass can see the drop was deliberate.

### The witness was re-run, and it says stage B did not shrink the store's reach

2026-09-04, 22:0x, on a box carrying six other worktrees at load 36–79. **648 test files, one
unresolved** (`tests/gjd-remote-tab-lifecycle.test.ts`, re-run alone and still silent — it is
machine-specific). The instrument's `--self-check` passed first: all eight condemned modules hooked,
22 method-level sites.

| | 2026-09-03 | 2026-09-04 |
| --- | --- | --- |
| touches the filesystem store | 88 | **91** |
| runs and touches nothing | — | 555 |
| unresolved | 3 | 1 |

**The number went up, and the plan expected it to fall by 26.** Here is why, and it is not a
regression:

- **22 of the 26 conversions still touch the store**, every one through the same four entry points —
  `copy-artefacts:copyArtefacts`, `artifacts-fs:createFsArtifactStore`, `artifacts-fs:fsLocations`,
  `data-root:dataRoot`. That is `scratchArticleInPg`. **The fixture helper the conversions were built
  on clones its corpus article through the filesystem store**, so a converted suite asserts against
  Postgres and seeds off files.
- **Only 4 left its reach**: `list-reconciles-expired`, `one-article-for-one-address`,
  `second-job-queues`, `upload-records` — the four that seed no article.
- **And one file newly touches that did not before**: `tests/store-shelf-reads.test.ts`. Cause known
  and it is ours — `17d2f00d` gave it `scratchArticleInPg` seeding to fix an order dependency, and
  that is precisely the filesystem path above. A stage-B fix *added* a filesystem reach to a file
  that had none.

> **Stage B moved the assertions and left the fixtures.** It did not reduce the filesystem store's
> reach; it increased it by three. Those 22 leave when **stage D** replaces the fixture loader, and
> not before.

Worth stating plainly because *"26 files converted"* reads like 26 files removed from the problem,
and the measurement says otherwise. The conversions are not thereby worthless — each moved a suite's
oracle onto the store we are keeping, which is what stage B was for — but the store cannot be deleted
until D lands, and **B was never on that critical path**.

**This settles § *The category question, escalated rather than decided* in the pilot's favour, with
evidence.** The pilot moved both its files to `shared-mechanism-collateral`; the queue agent left four
as `database-integration` because after conversion they reach no condemned module. Both were reasoning
about files; the witness measured them. The mechanism is real, shared, and now named by the
instrument — and GPT Sol, asked about `STORE_CONVERSIONS` an hour before this run finished and
without seeing any of it, said *don't require the two maps to be disjoint, a converted suite may still
touch the filesystem through collateral machinery.* It does.

#### And stage C is much smaller than it was costed

§ *C is not independent of B any more* records a **grep ceiling of 39** unit-lane files that might
open a ledger, and says the true number "can only come from a run". `src/store/ai-calls-fs.ts` is one
of the eight instrumented modules and `NODE_ENV === "test"` redirects the cost store to it, so **this
run counts it** — criterion 1 (*"`pgCostStore.record` genuinely executed, not silently skipped"*) read
backwards.

| | files |
| --- | --- |
| reach `ai-calls-fs` at all | 27 |
| …of those, **`fsCostStore.record` actually called** | **11** |
| …the rest reach only `read` / `forJob` | 16 |
| **`record` callers in the `unit` lane** | **2** |

The two are `tests/cost-store-under-test.test.ts` and `tests/store-wiring.test.ts`, both of which are
*about* the store selection and which C rewrites by definition. The other nine are already in the
private lane.

**Temper it before banking it.** This measures today's run, where the redirect is still in place. When
C flips `selected()`, those nine private-lane files need their owner row in `auth.users` — the spike
measured **5 of 5 refused** without it. So C's real work is two files plus an owner-seeding sweep,
not the 23 conversions the ceiling implied. **Half a day was costed against a number that was 10×
too big**, which is the cost of a ceiling nobody could turn into a count until the instrument existed.

#### A fourth instance of the same personal failure, caught by luck

The first extraction script reported C's tail as **0 files** and I nearly wrote that down. It matched
witness records against module *paths* (`src/store/ai-calls-fs.ts`) when the records are stored at
method level (`ai-calls-fs:fsCostStore.record`), so the filter matched nothing and returned a clean,
confident zero.

It was caught only because the raw touched-lists printed above the total contradicted it on screen.
**Same class as the inventory grep, the "witness isn't in the repo" claim and the referee-file
accusation: a search that does not cover the answer, reported as an absence.** Four in two days, all
mine, and the one thing they have in common is that the empty result was never checked against a case
known to be positive. A control costs one line.

### B3 — what B2's review found, and the guard that could not see it

Stage B's obligatory end-of-stage review, 2026-09-04, on the landed `f6b5d982`. **Seven findings,
all seven checked by hand, six confirmed and the seventh a real ambiguity.** Sol could not run the
private lane — its sandbox refused Docker and the loopback port — so only the first is reproduced
and the rest are reasoned and then verified here. B is **not** closed until these land.

#### The guard does not do what it was built to do, and this is the third hole in it

**Reproduced.** [store-migration-registry.test.ts](../../tests/store-migration-registry.test.ts) §
*"makes every converted file show its working"* requires one `**Mutation.**` and one `**Blind to.**`
**anywhere in the file**. And [routes.test.ts](../../tests/routes.test.ts) line 35 contains
`**Mutation.**` inside the sentence *"Search for `**Mutation.**`"* — the instruction telling a reader
where the evidence is. So the file offers eleven markers for ten mutations. Sol renamed **all ten real
mutation markers and nine of the ten blind-spot markers** in a scratch copy and the guard still
passed, satisfied by the instruction and one orphaned survivor.

**Three holes now, all the same shape: it under-reports while green.** The
[silent-success](../reusable/silent-success.md) class, in the guard written to catch that class.

The fix is not a fourth threshold. **The stage's rule is already precise** and the guard was checking
a proxy for it: *one mutation per store-touching `describe`, and the blocks that need none say why in
their own headers.* So check that.

- **Anchor the markers at line start** (`^\s*\*?\s*\*\*Mutation\.\*\*`), so prose *about* a
  marker is not a marker. Kills line 35 without asking anybody to stop writing the instruction.
- **Every top-level `describe` carries, in its header, either a `**Mutation.**` or an explicit
  no-mutation judgement** — the five waivers in `routes.test.ts` already write one, so this enforces
  the existing convention rather than inventing one.
- **Pair them:** each `**Mutation.**` is followed by a `**Blind to.**` before the next `**Mutation.**`.
- **Plus the two-way marker-set equality** from § the fork above.

**Watch it fail on Sol's exact mutation before believing it** — rename the ten real markers, keep the
instructional one — as well as on a deleted `describe` header. Two of this guard's three holes were
found by somebody *using* it rather than reading it.

#### Two greens that should have been closed rather than recorded

B2 kept three green mutations as findings. Two of them are holes small enough to close in the stage
that found them, and Sol is right that keeping them is inconsistent with having closed the identical
`recolour` hole in the same file:

- **`PATCH /api/reader`, the clearing case** — asserts only the two echoed responses, and
  `writeProfile` returns its argument, so an `onConflictDoNothing` that left the old row untouched
  passes both. The case is *named* for clearing. Two `GET`-backed assertions close it.
- **Saved-search `remove` has no two-run case**, so dropping the `runId` predicate from the delete in
  `src/store/pg-searches.ts` leaves all 127 green. A second run is a few lines.

The third — the triply-redundant slug guard — **stays a finding**, because it is a genuine statement
about the code rather than a gap in the test, and § *Three findings* explains why.

#### Three evidence notes that say more than the mutation showed

- **The admin mutation is a call-site mutation.** It replaces the whole
  `await adminStore.listUsersAcrossOwners()` call, so **no SQL executes** and it proves only that the
  route rejects an empty list. Its `**Blind to.**` names the list's fields and not this. **The same
  shape this document already recorded for `list-reconciles-expired`, recurring in the very next
  file** — which says the lesson did not transfer, and is an argument for the guard checking what a
  mutation *reaches* rather than trusting the prose.
- **The comment-create note's reasoning is false.** It claims the route's 201 and echoed body are
  unchanged and *"only the row is wrong"*. But `create` is `INSERT … RETURNING` converted through
  `toComment`, and `src/routes.ts` returns that result, so the echo changes too and the response
  assertion fails for a different reason than the one recorded. The mutation is real and
  SQL-reaching; **the story about what it proved is not.**
- **The tweets waiver does not hold.** It says every plausible break also answers *"nothing here"*,
  but only `SLUG` has its `tweets.json` removed by `mutate` — the other four `scratchArticleInPg`
  articles keep theirs, so a wrong-article or wrong-revision read returns **another article's
  thread**. Either add the positive read the file already has everything for, or rewrite the
  judgement.

#### And an arithmetic that an evidence ledger should not have

`tests/store-migration-registry.ts` § `routes.test.ts` says *"Ten mutations, seven red and three
green"* against **thirteen runs** — three slug runs and two recolour runs collapse differently
depending on whether you count markers or executions. Immaterial as prose and material as a ledger,
and it is § *a reason may cite a mutation in a clause; it may not be where the record lives* being
bent one more time. The number goes, or it becomes exact.

#### B3 is done, and two of my three specifications were wrong

2026-09-04. `tests/routes.test.ts` **129 tests** (was 127; 98 `it`s, was 96 — nothing dropped),
registry guard **13 tests**, typecheck clean.

**All five evidence items fixed, every mutation watched by the agent rather than reasoned about.**
The two greens are red: the reader-clearing case gained four `GET`-backed assertions and
`onConflictDoNothing` now fails **2 of 129** where it failed 1 of 127; saved-search `remove` gained a
two-run case and dropping `eq(searchRuns.id, runId)` fails **1 of 129**. The comment-create note was
false exactly as read — the mutation fails at the route's **own echo**, three lines *above* the store
read-back it was offered as evidence for. The admin block kept its call-site mutation, now labelled
*"no SQL runs at all"*, **and gained a second one that reaches Postgres** (inverting the shelf
aggregate's `live` filter), because the block previously had no way to see the store at all. The
tweets waiver became a real mutation on `loadTweets`, with both 404 cases staying green under it.

**And Sol's finding 6 was right for the wrong reason, which is worth keeping.** It argued the waiver
failed because the other four articles keep their `tweets.json`, so a wrong-article read could return
another article's thread. True — but **every `scratchArticleInPg` article is a clone of the same
corpus article**, so those threads are identical and a cross-article read would have been invisible
anyway. The waiver was indeed unjustified; the mechanism named for why was not the one that bites.
The `SLUG`/`SHELF` pair now catches a read that lost the slug badly enough to answer for the article
that has none. Recorded because *"the reviewer was right"* and *"the reviewer's reason was right"* are
two claims and this plan keeps conflating them.

##### The per-`describe` rule is B2's convention, not B's, and the numbers say so

I specified it as an equality. Measured across the 26 files: **100 top-level blocks, 24 carrying a
judgement** — and split by stage it is stark.

| | blocks | carrying a `**Mutation.**` or `**No mutation…**` |
| --- | --- | --- |
| `routes.test.ts` (B2) | 18 | **15** |
| the other 25 (B) | 82 | **9** |

The stage-B suites write their evidence **per file**, usually in the file's own header docstring. As
an equality the rule would have reddened 25 suites at once, and `routes.test.ts` itself would fail on
three blocks whose headers argue in prose without the marker.

**Held as a ratchet instead**: `blocksWithoutJudgement` is a per-file *maximum*. A block added to a
converted file without a judgement fails; writing a judgement lowers the number; **a new conversion
records 0**, so C, D and E are born under the full rule and B's 76 blocks of debt are named in the
code rather than hidden. That is the right shape — the alternative was to weaken the rule silently or
to spend the stage editing 25 files nobody asked me to touch.

**The pairing rule was also wrong as stated.** *Each `**Mutation.**` followed by a `**Blind to.**`
before the next* is broken **legitimately by 8 of the 26**, which write "Mutation 1 — …; Mutation
2 — …" and then one blind spot speaking to both — better prose than two notes repeating each other.
The enforceable residue is that the sequence **opens with a Mutation and closes with a Blind to**,
documented as weaker than one-to-one with the eight counter-examples named, rather than quietly
substituted.

**And my anchor regex would have lost a real marker.** `referee-mirror-route.test.ts` writes
`/* **Mutation.** …` on one line, which `^\s*\*?\s*` does not match — the file would have failed
with zero mutations. Widened to allow a leading `/*`, and it still excludes line 35, where the marker
sits mid-sentence after `` Search for ` ``.

##### What makes a marker load-bearing, checked rather than trusted

The counts frozen in `STORE_CONVERSIONS` are what catch Sol's rename — *at least one of each* cannot
see nine of ten go missing, and a floor against the file's own past can. **Verified independently
here rather than taken from the report**: every one of the 26 recorded counts equals the file's actual
anchored-marker count exactly, so there is **no slack anywhere** and losing any single marker is
red. And `routes.test.ts` carries **13 raw occurrences of the marker text against 12 counted** — the
instructional one at line 35 is excluded, which is the reproduction closed.

Six negative controls were watched failing, in a symlink mirror of the tree under the scratchpad and
never in the repo, including Sol's exact reproduction in both its forms.

##### The tally is gone rather than corrected

`routes.test.ts`'s registry `reason` said *"Ten mutations, seven red and three green"* and named the
search store's `remove` predicate among the greens. B3 falsified every number in that sentence within
a day: `remove` is now red, the tweets block has a mutation where it had a waiver, and the admin block
has two. **So the count went rather than becoming exact** — a tally in a `reason` is a copy of a fact
whose home is the test file, and § *a reason may cite a mutation in a clause; it may not be where the
record lives* already said so.

Six `evidence: "static-only"` claims the re-run witness disagrees with were reconciled at the same
time, each saying what changed. They had been hiding behind the four `dynamic` overclaims in the same
assertion, and only surfaced once those were cleared — **one wrong entry masking another in the same
check** is worth watching for elsewhere.

#### The guard fires on other people's arrivals, and that is a running cost until G

Found by merging `origin/dev` **immediately after committing B3**. The merge brought thirteen new
test files from other worktrees, and § *leaves no file that the import graph can reach and nothing
accounts for* went red on one of them — `tests/feedback-dictation-vocabulary.test.tsx`, which nobody
here wrote and which has nothing to do with this plan.

The guard was right: the file's import graph reaches a condemned module, and neither the registry nor
a witness measurement accounted for it. But **in a tree where six agents land test files continuously,
that makes every unrelated arrival this plan's problem**, and it will keep happening until stage G
deletes the adapters and the static universe empties.

The three ways out, and what each costs:

| | cost | honest? |
| --- | --- | --- |
| re-run `--full` | ~25 min on a loaded box, and more files arrive while it runs | yes, and it re-measures everything the merge changed |
| `--files <the arrival>` | ~10 seconds | **measures correctly and does not satisfy the guard** — the JSON has no way to take one file |
| hand-add it to `ranAndTouchedNothing` | seconds | **no.** That file is a dated measurement carrying its own regeneration command; editing one by hand so a guard goes green is the shape of thing this plan exists to delete |

**Taken: the full re-run**, 2026-09-04 23:1x — 661 files (13 more than the run 40 minutes earlier),
**91 touching, unchanged**, 568 clean, the same single unresolved file. So every one of the merge's
arrivals touches nothing, which is the answer `--files` had already given for the one that fired.

**Do not "fix" this by loosening the check.** The cheap-looking move — let a file off if the witness
has never seen it — deletes the guard, because a genuinely new file that *does* touch the store is
exactly the case it is for. If the re-run cost becomes intolerable before G, the thing to build is a
way for `--files` to merge one measured file into the JSON with its own timestamp, so a single
arrival costs ten seconds and still carries provenance. **Not built now** — it is machinery on the
critical path of a plan whose point is to remove machinery, and the cost so far is one 25-minute run.

### C — ledger isolation, its own reviewed stage

Replacing `NODE_ENV === "test"` → filesystem is **not** "Postgres plus cleanup". Routes use a global
cost store and independent pooled connections while Vitest runs files concurrently, so **a
surrounding test transaction will not contain those writes unless the cost store becomes
executor/transaction-aware.** Acceptance must prove all five:

1. `pgCostStore.record` genuinely executed (not silently skipped).
2. Fixture costs were never visible to normal dev reports.
3. A crashed or failed suite leaves no ledger rows anywhere a report can see. **Corrected twice** —
   see below; a `kill -9` proves *confinement*, and cleanup is the scavenger's job, not the run's.
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

#### C's target cohort, frozen 2026-09-04 before a single edit

Sol's advice on stage B was that a conversion stage needs an **independent oracle fixed before the
work starts**, or the cohort quietly becomes "whatever turned out to be easy". This is C's, and it is
not a grep: it is the dynamic witness, which records every call that actually reached the filesystem
adapter, crossed with `TEST_LANES` and with which files set the flag themselves.

**27 files reach `ai-calls-fs` at run time. 23 are already in `private-postgres`; 4 are in `unit`.**
And 23 of the 27 set `process.env.SPIDERYARN_STORE = "postgres"` in their own hoisted block, because
`src/store/live.ts` reads the variable once at module load.

Cross those two facts and C's blast radius falls out exactly. Removing the `NODE_ENV === "test"`
redirect changes the answer **only** for a file that sets the flag to `postgres`; every file that
leaves it unset still gets `fsCostStore` from the `files` branch, which survives until F.

| after C, this file… | predicted | actual |
| --- | --- | --- |
| writes its ledger rows to the **private database**, as intended | 22 | 21 |
| **breaks, and is C's actual work** | **1** — `tests/cost-store-under-test.test.ts`, the only file both pinning the flag to `postgres` and living in the lane where `DATABASE_URL` is poisoned | **2** — that one, plus `tests/live-session-routes.test.ts`, four cases |
| is untouched, because it leaves the flag unset | 4 | 4, confirmed by run |

**Reproduce the freeze with** `scripts/store-migration-witness.ts` output crossed against `TEST_LANES`;
the counts above are from `tests/store-migration-witness.json` measured `2026-09-04T22:17:39Z`.

##### The freeze was one file short, and the predicate is why

`tests/live-session-routes.test.ts` sets the flag and is in `private-postgres`, so the cross put it in
the twenty-two called *"intended, should stay green"*. It was not green. It does not only **write**
ledger rows — it **reads them back**, out of a JSONL it pointed `SPIDERYARN_LEDGER` at. Remove the
redirect and the rows go to Postgres while the assertions go on reading an empty file.

**The predicate was wrong, not the measurement.** *"Removing the redirect changes the answer only for
a file that sets the flag to `postgres`"* is true, and it predicts **where rows go** — not **which
assertions look for them**. A witness of writes cannot see a reader.

This is the fourth outing of the same personal class in this plan — *an incomplete search reported as
an absence* — and its most interesting one, because nothing was searched incompletely. The scan was
exhaustive over the thing it scanned. **The freeze answered a different question from the one the
stage was asking**, and read as an answer to both.

Worse, **the file said so itself.** Its header carried *"the ledger deliberately did not move …
stage C owns that redirect"*. The cross never asked it.

> **When freezing a cohort for D or E, cross the write-witness with a grep for files that read the
> store back.** A file that reads is affected by a change to where writes land, and no dynamic
> witness of writes will ever list it.

**So C was two files, not one, and not the 23 costed or the 39 the grep ceiling allowed.** The
ceiling was honest and about 20× too big. `cost-store-under-test.test.ts` was rewritten *and moved to
`private-postgres`* — the same edit the plan already described as *"the selection is Postgres, and it
is the private database"*, which also implies a lane change the earlier costing never mentioned.

#### C does not delete `ai-calls-fs.ts` — G does

The earlier costing said *"`selected()` collapses to `export const costStore = guardedLedger`,
`ai-calls-fs.ts` goes"*. **That contradicts stage G**, whose deletion order names `ai-calls` as one of
its groups, and it is G that is right. Deleting the adapter in C would mean the ledger required a
database while every other store was still on files — breaking the one thing `ai-calls-fs.ts`'s
docstring says it exists for, three stages before the hinge that makes it safe.

**C removes the `NODE_ENV === "test"` line and nothing else about the selection.** The `files` branch
stays until F, the adapter until G. That keeps C at a stopping point where the tree is deployable,
which is what a stage boundary is for. Settled here rather than asked, as a technical fork; put to
Sol at the stage-end review.

#### C is done, 2026-09-05, and all five criteria were proved by run

One line removed from `selected()`; `ai-calls-fs.ts` untouched, as § *C does not delete it* argued.
Two test files rewritten, one lane change, four docstrings that described the redirect as present
tense corrected.

| # | criterion | what the run printed |
| --- | --- | --- |
| 1 | `pgCostStore.record` genuinely executed | **16 rows** in `spideryarn.ai_calls` of the run's own database, counted **from outside the process** by an external poller; every other test database `0` |
| 2 | fixture costs never visible to dev reports | `postgres` held `914 / 2026-09-04T22:52:15Z` before and after a full unit lane, three full private lanes and both mutation runs — **unchanged** |
| 3 | a crashed run leaves no rows a report can see *(wording corrected twice — see below)* | `kill -9` mid-run: 13 committed rows survived **in the run's own database**, `postgres` still 914. Ordinary runs print `dropped spideryarn_test_…`; a live scavenge fired unprompted during the stage |
| 4 | files stay isolated | two concurrent private-lane runs, one route file each: two distinct databases, `test-chat-route-fixture=4` and `test-remember-route-fixture=16`, neither seeing the other — **and those are the literal fixture slugs from the 4,714-row incident** |
| 5 | direct ledger tests still exercise committed behaviour | `store-ai-calls` + `ai-calls-spend-pg`, **35 passed** |

**Criterion 1 is the one worth reading twice.** With the redirect in place, **no route suite in the
tree had ever put a row through `pgCostStore`** — the adapter that meters real money was exercised
only by tests importing it directly. The redirect bought isolation by removing coverage of the only
store that deploys, and C is where that stops.

**Criterion 4's wording no longer fits the design it is being applied to**, and the plan should say so
rather than let a green tick stand for a question nobody asked. The private lane is
`fileParallelism: false`, so *parallel test files* do not exist inside it — files share one database,
serially. What was measured instead, and is the true statement, is that concurrent **runs** are
isolated. The residual risk the criterion was written for reappeared as the range-scan problem below,
which is a different question with a different answer.

##### The range scan, found by looking and fixed by scoping

One database per run and no rollback means `costStore.read()` over the default window returns **every
earlier file's rows**, not this file's. Every caller was enumerated:

| | verdict |
| --- | --- |
| `tests/live-session-routes.test.ts` — `const before = (await ledger()).length` | **the one real instance.** `ledger(id)` now filters on the session id **inside the helper**, so all six call sites are scoped |
| `tests/store-ai-calls.test.ts` | already safe — every read filtered by `runId` |
| `tests/ai-calls-spend-pg.test.ts` | already safe *and deliberately*: its fixtures are dated **2031**, with a docstring saying that is so no other test or report shares its window |
| `src/jobs.ts` → `costStore.forJob(job.id)` | job-scoped |
| `scripts/ai-cost.ts` | the only wide reader; no test drives it against a live store |

**Fixed by scoping the assertion, not by widening a tolerance** — a range assertion loosened until it
passes is the same failure this plan keeps finding.

#### C's stage-end review — one round, three findings, all three real

GPT Sol, 2026-09-05, `gpt-5.6-sol` at high effort. **Refused on an established P1.** All three
findings checked by hand; none was wrong.

| ID | sev | finding | disposition |
| --- | --- | --- | --- |
| F1 | **P1**, established | `scripts/store-migration-witness.ts` § `POSITIVE_CONTROLS` uses `cost-store-under-test.test.ts` as its positive control for `ai-calls-fs`. C converted that file, so **the witness's own self-check could no longer pass** | fixed — control moved to `tests/store-ai-calls.test.ts` |
| F2 | P3, established | criterion 3's wording claims a killed run leaves nothing behind, while the stage's own evidence shows the opposite | fixed — see above |
| F3 | P3, established | the new `ledger()` helper's comment says "scoped by session id **in the query**"; it is a JavaScript filter over an unbounded read | fixed — comment now says what the code does, and why JS is the right call at 16 rows |

**F1 is the interesting one, and it is the fourth thing this stage got wrong.** The control's own
docstring predicts it exactly — *"Stage B converts these files one by one, and when it converts one
this self-check goes red saying so … replace the control with a file that still touches the same
module"* — and neither the implementer nor I ran the self-check, because C is not stage B and the
sentence names stage B. **A rule written for one stage stopped being read at the stage boundary.**

Watched red before it was fixed, then green after, which is why it is recorded as established rather
than reasoned:

```
SELF-CHECK FAILED (1):
  - tests/cost-store-under-test.test.ts: expected ai-calls-fs:fsCostStore.record,
    ai-calls-fs:fsCostStore.describe; saw nothing
```

**Add `--self-check` to the end of every remaining stage that converts a file**, D through G. It
takes ~40 seconds and it is the only thing that notices a control has gone stale.

**Sol also checked three things and cleared them**, and they are worth recording because they were
the ones I was least sure of: the second connection in `cost-store-under-test.test.ts` cannot escape
to a remote database (the test-database factory refuses non-loopback hosts and `host`/`hostaddr`
overrides, and `urlForDatabase` replaces only the pathname); restoring `SPIDERYARN_STORE` after the
hoisted imports is safe, because `STORE` is captured at module load and vitest isolates module graphs
per file; and **there is no third ledger read-back dependency** — the direct readers reduce to the
corrected helper, job-scoped `forJob`, the explicitly filtered adapter tests, and the report script.

**One round, not two, and the reason is mechanical.** The cap allows a narrowly scoped second pass on
a P0/P1 established at round two; F1 was round one, and its fix is verified by the instrument's own
self-check going red and then green — which outranks a second reasoned opinion about a two-line
change.

##### Criterion 3 was wrong a second time, and Sol caught it

The first draft said a killed run would *roll back*. That was corrected during the spike to
*"leaves nothing behind, proved by teardown"*. **Still wrong**, and the stage's own evidence says so:
`kill -9` skips teardown, and the scavenger deliberately **spares** a database for six hours so that
it cannot delete one a live run is using. Sol reproduced the sparing directly —
`chooseScavengeVictims` on a zero-second-old database returns `dropped: []`, spared against a
21,600-second threshold.

So what the kill proved is **confinement, not cleanup**, and those are different claims:

> An ordinary failed suite drops its private database at teardown; a killed run leaves only its
> private database, never rows in the development ledger, and a later run scavenges that database
> once it is stale.

That is the criterion. **Three drafts to state one fact correctly**, all three sounding fine — and
each was checked by somebody looking straight at the evidence that contradicted it. Worth noting
because the same shape has now appeared in this plan at every scale: the redirect, the freeze, and
now the criterion the freeze was measured against.

##### The witness was not re-run after C, deliberately

Both files C touched have stopped reaching `ai-calls-fs`, so
`tests/store-migration-witness.json` now **over-reports** the filesystem store's run-time reach by
two. That is the safe direction and the guard cannot fire on it: § *leaves no file that the import
graph can reach and nothing accounts for* goes red when the witness **lacks** a record an entry
claims, never when it holds one nobody needs any more.

**Deferred to after D**, where 22 files change at once when the fixture loader moves — one 25-minute
run instead of two. The registry entry for `cost-store-under-test.test.ts` says in its own docstring
that it survives only because the witness still lists the file, so nobody reading it later mistakes
the staleness for a measurement.

**91 is therefore no longer the live number**; it is 89, un-remeasured. Do not quote it as a
measurement until the run after D. § *The treadmill* has the standing rule about hand-editing that
file, which still applies: nobody edits it to make a guard green.

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

#### D's target cohort, frozen 2026-09-05 before any edit

Measured from `tests/store-migration-witness.json` (2026-09-04, less C's two departures), crossed
with `TEST_LANES`. **This is the measurement that says D is the critical path**, and it is much
bigger than the costing above.

**Where the filesystem store's run-time reach actually is**, by instrumented module — a file counts
once per module:

| module | files | method-level |
| --- | --- | --- |
| `artifacts-fs` | **75** | `createFsArtifactStore` **56**, `fsLocations` 29, `pathFor` 3, the `fsArtifacts.*` methods 1–3 each |
| `copy-artefacts` | 39 | `copyArtefacts` 39, `readParts` 1 |
| `data-root` | 31 | `dataRoot` 31, `chooseDataRoot` 1, `findRepoRoot` 1 |
| `ai-calls-fs` | 27 → **2**, after C | — |
| `fs` | 9 | — |
| `jobs-fs` | 7 | — |
| `uploads-fs` | 5 | — |
| `realtime-sessions-fs` | 1 | — |

**`createFsArtifactStore` at 56 is the single biggest lever in the whole plan**, and **only 14 test
files name it**. The other ~42 inherit it from one line in
[`tests/helpers/load-article.ts`](../../tests/helpers/load-article.ts), through `scratchArticleInPg`.
One import in one helper is most of what keeps the filesystem store alive at run time.

| what D's landing does to a file | files |
| --- | --- |
| **leaves the filesystem store entirely** — reaches only `copy-artefacts` / `artifacts-fs` / `data-root` | **24** |
| **reduces** its reach — the loader chain plus `ai-calls-fs` (14) or `fs` (1) | 15 |
| unaffected by the loader — reaches `artifacts-fs`/`data-root` by another route | 36 |

**Stage B roughly doubled this stage's value, and nobody planned that.** The inventory above costed
`fixture-loader` at *"12, the largest"* and said *"Stage D decides all twelve at once"*. It is 24
outright and 39 in part, because 22 of stage B's 26 conversions were built on `scratchArticleInPg`.
§ *The witness was re-run* recorded that as stage B's failure to shrink anything; this is the other
side of the same fact, and it is a gain.

**The `contextPaths` mechanism is real and is not D's.** `runStep` in `src/jobs.ts` calls
`contextPaths(job.slug)` unconditionally under either store, which is why `fsLocations` and
`dataRoot` appear on pure-Postgres suites. But **only 4 files reach the store exclusively through
it** — `billing-settlement`, `pg-session-exact-base`, `pipeline-slug-claim-files`,
`store-session-isolation` — so it is a cheap fix with a small blast radius, and it belongs with the
hinge rather than with the loader. It must land before G can delete `artifacts-fs.ts`.

##### The reader axis, which is what C got wrong

Applying the rule stage C paid for: a witness of writes cannot see a reader. **12 files assert on
`loaded.copied`**, the set of steps the loader reports having copied — `chat-library-exclusion`,
`chat-route`, `comment-referee-mark`, `corpus-materialise`, `helpers-load-article`,
`hierarchy-structure-eval`, `referee-routes-postgres`, `remember-route`, `routes`,
`store-block-roles-pg`, `store-parity`, and `tests/helpers/scratch-article.ts` itself.

**That return value is the contract, and a replacement reader must produce it identically.** It is
also the thing `copyArtefacts` was given a return value *for* — *"a silent no-op over an article the
source store has never heard of is exactly the shape this repo keeps being caught by"*.

#### Landed, 2026-09-05 — the loader, and six of the fourteen direct namers

**The lever went in as designed.** The *source* half of `copyArtefacts` is
[`tests/helpers/fixture-artefacts.ts`](../../tests/helpers/fixture-artefacts.ts), a reader over the
committed `data/` + `output/` tree; the *destination* is still `pgArtifactsIn`, so every byte a
fixture puts into the database goes through the production write path with every guard it has. The
new file carries the `(step, kind) → path` table, and its header says out loud that this is a copy
that becomes the original when stage G deletes `PATHS`.

**One deviation from the brief, and it is the enabling change.** `copyArtefacts`'s `from` parameter
is now `ArtifactSource` — `Pick<ArtifactStore, "read" | "stampFor">`, declared beside `ArtifactReads`
in [`src/store/artifacts.ts`](../../src/store/artifacts.ts). Behaviour is untouched and
`ArtifactStore` is still assignable, so `tests/artefact-copy.test.ts` drives filesystem-to-filesystem
through the identical signature. The alternative — a reader pretending to be a whole `ArtifactStore`
with seven throwing stubs for methods the copy never calls — would have put dead code behind a lie
the type system was in a position to refuse.

**`loaded.copied` is unchanged, proved at the seam rather than sampled through the suites.** A probe
drove the old `createFsArtifactStore` and the new reader over all five corpus articles and compared
everything: the `copied` list is identical for each — 3, 8, 8, 4 and 9 steps, **32 in all** — and so
are all **52 artefacts** and all **32 stamps**, byte for byte as JSON. Zero differences. None of the
files that assert on that value had to change.

**And that probe missed a real break, which is the more useful half of this paragraph.** It compares
the two sources over *the corpus as it is*, and the corpus's largest artefact is 154 KB — so it could
not see that the new reader had no size ceiling and copied artefacts the old one refused. The
docstring it was written alongside declared exactly that blind spot ("a fixture article no suite
loads") and nobody, including its author, followed the sentence to its consequence. See § *the
cross-family review refused* below, F1.

**And the list of twelve above is nine.** Re-counted 2026-09-05: `corpus-materialise`'s `copied` is a
different function's (`["data/", "output/"]`), `hierarchy-structure-eval` asserts on
`copiedHeadings`, and `scratch-article.ts` passes the value through as `ScratchArticle.copied`
rather than asserting on it. Three false positives from grepping a common word. The nine are
`chat-library-exclusion`, `chat-route`, `comment-referee-mark`, `helpers-load-article`,
`referee-routes-postgres`, `remember-route`, `routes`, `store-block-roles-pg`, `store-parity`, and
they are named in
[`fixture-artefacts.ts`](../../tests/helpers/fixture-artefacts.ts) so the correction sits next to the
table it protects. It does not weaken the conclusion — the probe compared every artefact, not the
nine assertions.

**Measured reach, before and after** (`--files` on the ad-hoc witness against the 2026-09-04 JSON):

| file | before | after |
| --- | --- | --- |
| `store-block-roles-pg` | `artifacts-fs`, `copy-artefacts` | `copy-artefacts` |
| `comment-referee-mark` | `artifacts-fs`, `copy-artefacts` | `copy-artefacts` |
| `chat-route` | `ai-calls-fs`, `artifacts-fs`, `copy-artefacts` | `copy-artefacts` |
| `remember-route` | `ai-calls-fs`, `artifacts-fs`, `copy-artefacts` | `copy-artefacts` |
| `late-step-on-a-cold-instance` | `artifacts-fs` | **nothing at all** |
| `artefact-copy` (the control) | `artifacts-fs`, `copy-artefacts` | unchanged, as it must be |

`copy-artefacts` stays, on all of them, and that is not a shortfall: the loader drives `copyArtefacts`
and always will. That module is on the instrumented list because it lived beside the adapters, not
because a fixture loader is condemned; where it ends up is stage G's call.

**The clone in `scratchArticleInPg` stays, and the number is fresh.** Ten runs of `writes`,
2026-09-05: clone min 24.2 / median 31.3 / max 62.5 ms against a whole seed of min 255.0 / median
283.1 / max 443.6 ms — **11.1% at the median**, within noise of the 2026-09-01 figure the docstring
already carried. `mutate` needs a writable copy anyway, and telling the reader a slug instead would
mean writing it back into `meta.json` — making the fixture reader a *transformer* of what it reads,
which is the exact property its safety argument rests on. The docstring now says all three.

**The fourteen direct namers, decided one at a time and counted 6 / 2 / 2 / 4.**

| what happened | files |
| --- | --- |
| **converted** onto the new fake | `illustrated-step-registration`, `job-failure`, `late-step-on-a-cold-instance`, `quiz-step-registration`, `stage-stamp-agreement`, `tweets` |
| **re-classified** — the verdict was wrong, and the case belongs to the adapter | `block-roles`, `stage2c-raw-bytes` |
| **left, and why is below** | `blocks-baseline`, `glossary-ideas-baseline` |
| already `filesystem-adapter-behaviour` or `database-integration`, untouched by design | `artefact-copy`, `pipeline-artifact-store`, `store-session`, `store-pg-session` |

The six moved onto a new
[`tests/helpers/memory-artefacts.ts`](../../tests/helpers/memory-artefacts.ts) — an in-memory
`ArtifactStore` that applies the same `SHAPE` and `BASELINE` rules and **does not reproduce the
filesystem's aliasing**, because a fake of the thing being deleted would keep a filesystem-shaped
assumption alive in ten suites after the filesystem was gone.

`store-pg-session` was read as well as classified: its one `createFsArtifactStore()` is the **control**
in case 6 — *the disk really does say done* — which is what stops "the preflight read the draft"
being consistent with the file never having been written. It needs a filesystem store for exactly as
long as there is one, and its premise disappears with the adapter. The registry's existing reason
already said so.

**The two re-classifications are worth knowing**, because both look like `store-agnostic-fake` from
outside and are not:

- `block-roles`'s one store case is a **serialisation round trip**. An in-memory fake would make it
  `toEqual` against the object it just put in — a case that cannot fail, which is worse than the
  reach it removes. `store-block-roles-pg` carries the same claim through Postgres.
- `stage2c-raw-bytes`'s one store case asserts that the file `writeRawFiles` writes is the file
  `PATHS.fetch.raw` reads. A fake with no paths cannot hold that. It dies in G with the
  `SPIDERYARN_STORE=files` CLI path it documents.

**Two are not done, and the two reasons are different — said apart, because "not done" hides which
of them is a judgement and which is a stopping point.**

- **`blocks-baseline` has a real blocker.** One of its seven filesystem cases is *refuses when stage
  4's copy is over the size this store can read* — the 32 MiB ceiling in `DECODERS`, which Postgres
  has no equivalent of and an in-memory fake cannot have without copying the table. Converting the
  other six would leave the import in place and free nothing, so the honest unit of work is stage G's
  per-assertion inventory, or moving that one case to
  [`pipeline-artifact-store.test.ts`](../../tests/pipeline-artifact-store.test.ts) where the
  adapter's own surface already lives.
- **`glossary-ideas-baseline` has no blocker** — checked, rather than assumed by analogy: its
  filesystem arm writes only shape and parse manipulations, every one of which `plant` reproduces,
  and it has no ceiling case. It is unconverted because this stage stopped, not because anything
  stands in the way. About fifteen `writeFile` sites, and its `articleIn(dir)` reads the article off
  the same directory, so the fixture tree stays either way.

They are the last two `store-agnostic-fake` rows still naming `createFsArtifactStore`.

**And the `.insert(articles)` consolidation should not happen — measured, not assumed.** Thirty test
files call it (`grep -rn "\.insert(articles)" tests/`, 2026-09-05). Grepped for any mention of
`artifacts-fs`, `data-root`, `copy-artefacts`, `fsArtifacts` or `dataRoot()` in all thirty, the
**only** hit is `store-artefacts-pg.test.ts` importing `PATHS` — which is the read-only blind spot
already recorded in the registry with `evidence: "static-only"`, and has nothing to do with its
insert. Everything else in the mention count is a `writeFile` or a `data-root` fixture path in prose.
**So none of the thirty keeps a file inside the filesystem store's reach**: they are direct row
inserts into Postgres, which is where they already belong, and routing them through a helper is pure
tidying with a real downside — the plan's own warning that many are deliberate oddities whose whole
purpose is the unusual row they construct. Fixing the loader at source is what removed the value the
older D text saw here. **Recommendation: drop it from this plan rather than defer it.**

#### D is done, 2026-09-05, and the witness was re-run

`tests/helpers/fixture-artefacts.ts` is the loader's source now — `read` and `stampFor` over the
committed fixture tree, no writes at all. `copyArtefacts`'s `from` narrowed from `ArtifactStore` to a
new `ArtifactSource = Pick<ArtifactStore, "read" | "stampFor">`, so **a source that cannot write can
be a source**; the destination is `pgArtifactsIn`, untouched. Six files that named
`createFsArtifactStore` as a cheap fake moved to `tests/helpers/memory-artefacts.ts`.

**The full witness re-run, 2026-09-05T02:10Z**, 669 files, one unresolved:

| module | before (09-04) | after | |
| --- | ---: | ---: | --- |
| `artifacts-fs` | 75 | **37** | **−38**, and this is the stage's whole point |
| `ai-calls-fs` | 27 | **4** | −23, stage C plus D's fakes |
| `copy-artefacts` | 39 | 39 | ±0 — **see below** |
| `data-root` | 31 | 31 | ±0 |
| `fs` / `jobs-fs` / `uploads-fs` / `realtime-sessions-fs` | 9 / 7 / 5 / 1 | unchanged | |

##### The headline count is 84 and it is the wrong number to read

`touchesFilesystemStore` went **91 → 84**, which understates the stage by a factor of five, because
**31 files now reach `copy-artefacts` and nothing else**. `src/store/copy-artefacts.ts` is on the
instrumented list *because it lived beside the adapters*, not because it is condemned: it is the
cross-store copier the fixture loader drives, it writes through the production path, and it survives
the deletion. Counting it as filesystem-store reach inflates every total in this plan.

**Files touching a genuinely condemned adapter: 91 → 53.** That is C and D together, and it is the
number to quote.

##### The freeze mis-framed this, for the third time in three stages

§ *D's target cohort* predicted *"24 files leave the filesystem store entirely"*. Seven did. The other
17 left `artifacts-fs` and kept `copy-artefacts`, because **the loader still calls `copyArtefacts` and
always will** — that is what puts the fixture into Postgres through the production write path.

The freeze's error was in its own table: it called `copy-artefacts` part of *"the loader chain"* files
would leave, when it is the part they keep. Same shape as stage C's:

| stage | the predicate I used | what it actually predicted |
| --- | --- | --- |
| C | sets the flag to `postgres` | where rows **go**, not which assertions look for them |
| D | reaches only the loader chain | leaving `artifacts-fs`, not leaving the **store** |

**Both were true statements answering a question the stage was not asking.** Neither was an incomplete
search — the scans were exhaustive. The lesson that generalises, for E, F and G: **name the predicate
in the same sentence as the prediction**, because *"24 files leave the store"* and *"24 files stop
calling `createFsArtifactStore`"* look like the same claim and are not.

##### Seven registry entries deleted, on B3's precedent

The guard went red the moment the new witness landed — seven `STORE_MIGRATION` entries claiming
`dynamic` evidence the witness no longer has. **That is the correct failure**, and the fix is the one
B3 established: an entry says what work a file still needs and dies when the work is done, while
`STORE_CONVERSIONS` keeps the evidence. All seven are in `ranAndTouchedNothing`, so the completeness
check still accounts for them. `STORE_MIGRATION` is 106 → 99, counted rather than carried forward.

##### The cross-family review refused, and the two P1s were both in the new helpers

Not in the conversion, not in the loader, not in `copyArtefacts` — in the two files written to replace
`createFsArtifactStore`. **Both were reproduced by the reviewer with real runs, and both were then
reproduced here before being fixed**, which is the only reason the fixes can be believed.

**F1 — the fixture reader had no size ceiling.** `createFsArtifactStore` enforces 4, 16 or 32 MiB per
kind and answers `null` above it; the replacement read whatever was there. Reproduced with a 33 MiB
shared `output/<slug>.html`: old copied `["hierarchy"]` and refused `extract` and `blocks` as
half-present, new copied `["extract", "blocks", "hierarchy"]`.

The review's fix was to copy `DECODERS` into the helper. **Rejected, and the reasoning is the useful
part.** The per-kind spread exists to keep a *two-sided* contract — `write` refuses what `read` could
not read back, so a step cannot report done and then be permanently not-done. A reader over a
committed fixture has no write side and no step to re-run, so there is no contract to keep; what
survives is one requirement, *this source must not accept what the old one refused*. So: **one bound,
at 4 MiB — the tightest value in the old table — and a throw rather than a `null`.** At the table's
*maximum* a 4-to-32 MiB window would remain for `raw`, `meta`, `assets`, `sketch` and `illustrated` in
which the new reader silently accepts what the old refused; at the minimum that window is empty by
construction. The cost is the other direction and is deliberate: a 4-to-32 MiB fixture of a
higher-ceilinged kind is now refused where the old store accepted it — **loudly**, naming the file and
both numbers, one constant to change. Corpus headroom is ~27×.

**F2 — the memory fake handed back its own object.** Neither real store can: the filesystem parses
bytes, Postgres decodes JSONB. It now detaches on the way in (`plant`, `write`) and out (`read`,
`readBaseline`) through a **JSON round trip rather than `structuredClone`**, because the round trip is
what both real stores actually do — `structuredClone` would keep `undefined` fields and `Date`s that
neither can carry. `has` deliberately does not detach: it never hands a value out.

**The half that mattered was not the purity.** Two converted controls did *read, edit a block, `plant`
it back, assert*, and the edit alone was already moving the article. Measured: with the aliasing in
place, **deleting the `plant` line from both files left all 28 cases green.** With the detach in,
deleting it reddens `quiz-step-registration`'s. `illustrated-step-registration`'s stayed green even
then, for a reason worth recording: its assertion is `true`, and an article that never moved answers
`true` as well — no mutation of the `plant` can redden an assertion whose expected value does not
depend on it. It has a positive control now, asking the store what it holds; with that, deleting the
`plant` reddens one case in each file.

**F3 — a reclassification reported but never applied.** `stage2c-raw-bytes`'s prose and this plan both
said `filesystem-adapter-behaviour`; the executable `category` was still `store-agnostic-fake`. Fixed,
with a note on the entry. **The registry's guard cannot catch this** — it checks that entries exist and
carry a reason, never that a reason and its category agree — and that is worth knowing before trusting
a verdict you have only read about. `block-roles` did take its intended value.

**F4 — the `LAYOUT` coverage claim was too broad.** The nine `copied` assertions guard **seventeen of
the table's eighteen rows**; `illustrated/illustrated` is populated by no corpus article, so a wrong
path there is invisible to all nine. Measured across all five articles. The claim is corrected in the
helper, along with the two ways to close it and what each costs — neither built, and the reason is
that a synthetic `LAYOUT`-vs-`PATHS` parity assertion would make whichever file holds it *call into
`artifacts-fs`*, adding a registry entry and a stage-G file at the moment the stage is removing them.

**Both P1s were invisible to every suite that uses these helpers, and that is the finding under the
findings.** The corpus is 27× under any ceiling, and every caller of the memory store happened to write
back through the reference it read. A helper's own properties need a test of the helper:
[`tests/helpers-store-fakes.test.ts`](../../tests/helpers-store-fakes.test.ts) is that test, six cases,
and each half was watched red before being watched green.

##### D's review: two rounds, both refused, six findings, all six real

| round | ID | sev | finding | disposition |
| --- | --- | --- | --- | --- |
| 1 | F1 | **P1** est. | the fixture reader lost the store's size ceilings, so it copies a 32 MiB artefact the old source refuses | fixed — **not with Sol's patch**, see below |
| 1 | F2 | **P1** est. | the in-memory fake hands back the same object reference; neither real store can | fixed, and it had left two controls unable to fail |
| 1 | F3 | P3 est. | `stage2c-raw-bytes`'s reclassification was in the prose and not in the executable value | applied |
| 1 | F4 | P3 est. | the `LAYOUT` coverage claim was too broad — no `illustrated.json` in the corpus | corrected, 17 of 18 rows populated |
| 2 | G1 | **P1** est. | three Illustrated negative controls accept the untouched store | fixed, each watched red by deletion |
| 2 | G2 | **P1** est. | two Tweets cases return `false` before reaching the condition they claim to test | fixed; **both predate the conversion** |
| 2 | G3 | P2 reasoned | the open handle closes the rename race, not an in-place rewrite | closed anyway, both checks kept |

**F1's fix is deliberately not the one that was offered**, and the reasoning is worth keeping. Sol's
patch copied the per-kind 4/16/32 MiB table into the helper. But that spread exists to keep a
**two-sided** contract — `write` refuses what `read` could not read back, so a step cannot report done
and then be permanently not-done. **A reader over a committed fixture has no write side**, so there is
no contract to keep; all that survives is *this source must not accept what the old one refused*.

So: **one bound at 4 MiB — the tightest value in the old table** — and a loud throw. At the table's
*maximum* a 4–32 MiB window would remain in which the new reader silently accepts what the old
refused, which is F1 again one size down. At the minimum that window is empty by construction, and
the cost is the opposite error: a 4–32 MiB fixture of a higher-ceilinged kind is refused where the old
store accepted it — **loudly, naming the file and both numbers**. Corpus headroom is ~27×.
**Copying less of `artifacts-fs`'s knowledge is the point**, because § *`LAYOUT` is a copy that is
about to become the original* is the argument the whole design rests on.

**Settled after two rounds.** The cadence allows one narrowly scoped check on a P1 established at
round two; G1–G3 did not get a third review round, and the reason is that each fix was verified by the
strongest evidence available for the property in question — **delete the setup line, watch the case go
red, restore** — with the failure text recorded in each file. A reasoned third opinion does not outrank
a control watched failing. G2's provenance was additionally checked against the history by hand rather
than taken on report.

##### The one thing E, F and G should take from stage D

**Three times now, a case has been satisfied by its own setup not happening.** Round 1's arm A: with
the memory fake aliasing, deleting the `store.plant` line from both converted controls left all 28
cases green. Round 2's G1: the Illustrated block's three negative controls each expect `false`, and
`beforeEach`'s Sketch is *already* not current, so deleting any of the three `writeSketch` lines
changed nothing. Round 2's G2: two Tweets cases omitted the tree and metadata the stamp is computed
from, so `stepIsDone` returned `false` before reaching either condition they name.

They are one shape: **the value the case expects is also the value an untouched store produces.** A
negative control is where it lives, because "not current", "not done" and "refused" are what you get
from a store that was never set up — so the setup can fail silently and the assertion still passes.
The tell is never in the assertion; it is that nothing connects the setup to it.

**Two consequences a conversion stage has to act on.**

*A suite going green after conversion proves nothing about whether its setup still matters.* Green is
what a suite looks like when the conversion worked, and also when the conversion quietly stopped the
setup reaching anything — the store moved, the writes went somewhere the reader no longer looks, and
every `false` still arrives. Stage D's own conversions were green from the first run and carried five
such cases through it, two of them **older than the conversion** (the Tweets pair had the same hole
against the filesystem store, one leaning on test order through a shared directory and one on a fresh
directory that never had a tree). So this is not only a conversion hazard: converting is when you are
holding the file, which makes it when to look.

*Find them by deleting a line, not by reading one.* Every one of the five was found that way and none
by inspection, including by people who had just written the file. The rule that generalises: **for
each case, delete its setup and watch — if it still passes, it is testing the empty store.** The
repair is a precondition assertion that discriminates: read back the one field that differs from the
untouched state (`sourceHash`, `profileHash`, `toBeNull()`), or assert the thing the answer depends on
is computable at all (`stamp(...)` is not null). Then delete the setup again and watch it go red.
[silent-success.md](../reusable/silent-success.md) is the general form; this is its per-case
instrument.

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

#### Landed, 2026-09-05

Five `main()`s deleted (`fetch`, `extract`, `blocks`, `hierarchy`, `labels`), one script written, and
`npm run pdf` split in two. `npm run cycles` stayed clean. Every command below was run against the
local Postgres and its result read back out of the database rather than off the command's own
output.

| Command | Ran | Printed |
|---|---|---|
| `npm run ingest -- <url>` | `paulgraham.com/vb.html`, an article not on the shelf | five steps `done`, `41 blocks, 41 new ids (0 kept)`, article `vb-spya-vu3xen` |
| `npm run ingest -- <url>` again | the same address, now on the shelf | all five `skipped`, same article — an address already there is adopted |
| `npm run ingest -- <url> --force` | the same address again | five steps `done` on **the same article**, `41 blocks, 0 new ids (41 kept)` — the refresh, and the ids through a whole re-ingest |
| `npm run ingest -- <file.pdf>` | a hand-built 1-page PDF | five steps `done`; upload record read back as **`verified`**, slug `stage-e-one-page-spya-qt9ev9`, stored hash equal to the claimed one |
| `npm run extract -- <slug>` | a corpus clone | `skipped   already done`; with `--force`, `done   Writes and Write-Nots` |
| `npm run blocks -- <slug> --force` | twice, then unforced | `19 blocks, 0 new ids (19 kept)` twice, then `skipped   already done` |
| `npm run hierarchy -- <slug> --force` | the same clone | `13 sections over 19 blocks` |
| `npm run eval:pdf-read -- <file.pdf>` | the same 1-page PDF | the chunk plan and the per-chunk recall table, `mean recall 1 over 1 of 1 page(s)`, `Spent: $0.0005` |

**The block-id contract survives, and the count is over every revision of the article rather than
over the runs**: seven revisions of the scratch clone after the seed and six commands, **one distinct
id set**, by `count(distinct array_agg(block_id order by block_id))` grouped by revision.

**A skip still publishes a revision.** `skipped   already done` is what the step says and the job
still settles, opens a draft and publishes it — an identical one. That is the queue's behaviour and
not the CLI's, and it is now said out loud in `setup-dev.md`, because *"a re-run without `--force`
does nothing"* is not quite what happens.

**`withLedger("cli", …)` really was double-scoping.** Every model call from these runs landed as
`scope_kind = 'job_step'` with a job id and a slug, and none as `cli` — read out of `ai_calls` after
the fact. `tests/paid-cli-ledger.test.ts` is down to one file, `src/pdf-read.ts`, with the reason
written into it rather than the entries quietly deleted.

**The unknown-slug fix.** `npm run blocks -- typoo-no-such-article` exits 1 with a sentence, and
`select count(*)` on `articles` and `jobs` for that slug is 0 in both. The check moved into `enqueue`
and now asks only `articleExists`, which is owner-scoped — so it no longer consults `slugIsTaken`,
the one deliberately unfiltered global lookup, and "nobody has it" and "somebody else's" became
indistinguishable by construction rather than by treatment.
`tests/enqueue-owns-the-article.test.ts`'s third case reversed; it was **watched red on the new code
before being rewritten** (*"Error: No such article. ❯ Module.enqueue src/jobs.ts:2864"*).

**`enqueue` took `pump: false`** and the `VERCEL=1` lie went from `evals/cost/`. Asserted
behaviourally in a new `tests/enqueue-drives-what-it-queues.test.ts` — queue a `fetch` step on a
seeded article, look two seconds later — with a positive control that pins *what* the pump did
(`done`, step `skipped`) so a day when that stops being a free skip fails loudly.

**Three mutations worth recording, because two of them were controls that lied.**

1. *Drop `blocksArtefact` from the blocks step* → `tests/sanitize-stale-artefact.test.ts` red,
   `expected undefined to be 5`. That file used to run `npx tsx src/blocks.ts` in a subprocess; with
   that `main()` gone it runs `STEPS.blocks.run` instead, which is one layer closer to the claim.
2. *Delete the tail from `src/pdf-read.ts`* → `paid-cli-ledger` red on both the list check and the
   file's own mutation control.
3. *Move `scripts/stage.ts`'s `loadEnvLocal()` below its dynamic imports* → **green**. *Below the
   argument check* → **green**. Only removing it **and** `src/store/live.ts`'s top-level call turned
   `stage2c-raw-bytes`'s env-order case red. So that case proves the *effect* — the file is applied
   before the command prints anything — and not which line did it, and the note is now in the test so
   nobody cites it as cover for the script's ordering.

**Two things this did not do.** `npm run eval:pdf-read` still writes its ledger rows to
`data/_ai-calls.jsonl`, because it sets no `SPIDERYARN_STORE` — pre-existing, unchanged deliberately
(the decision above was that the quality tool keeps its behaviour), and stage F's hinge fixes it.
And `AGENTS.md`/`CLAUDE.md` still says *"two stages of seven"* cache on a content hash; the count is
now stated properly in `architecture.md` § Conventions (**ten of the fourteen in `STEP_ORDER`**, by
the predicate *the step declares a `stamp()` that `stepIsDone` compares*), and the rules file is
Greg's to edit.

##### Retracted: the step-plan rule is not Stage E's, and it is not untested <a id="stage-e-unrunnable-untested"></a>

**This section claimed, on 2026-09-05, that `unrunnableStepPlan`'s refusal at `enqueue` had no test,
and that a broken `evals/deepen/ --dry-run` was the measured cost of the hole. Every load-bearing
part of that was wrong, and the anchor is kept so links to it still land.**

- **It is not Stage E's rule.** A `-S` search of the history over `src/jobs.ts` returns `aa941484`
  alone -- stage A of
  [260904e](260904e-extraction-repair-evals-and-llm-post-processing.md), 03:00, which added the
  predicate *and* its `enqueue` call. Stage E (`cbb903d0`, 06:14) is a same-morning sibling that also
  tightened `enqueue`'s refusals, which is how the misattribution survived three agents.
- **The door is tested.** `tests/jobs.test.ts` "refuses a blocks-only job at the door rather than
  stranding the article" drives `enqueue` and expects a 400, about 980 lines below the pure-function
  block. 260904e says so in its own text -- *"The pure rule and its wiring are asserted separately in
  `tests/jobs.test.ts`, the second because a guard nothing calls is the shape of half the bugs in
  this repo"* -- and it is true.
- **The dry run was not evidence of anything but its own bug.** It asked for
  `["fetch","extract","blocks"]`; the queue refuses that, correctly and by design. The fault was
  entirely in the caller.

**How three agents got it wrong is the part worth keeping.** The search that "established" the gap
was a grep across `tests/` that *excluded `tests/jobs.test.ts`* -- the file being annotated, on the
assumption that the block already read was all it had to say. The wiring test does not name
`unrunnableStepPlan` in its title, so nothing else surfaced it. A grep that excludes the file you are
writing about cannot return the thing that would change your mind, and the confidence that follows
from a clean result is unearned. Retracted by the agent that wrote it, 2026-09-05.

What survives is the *other* class, which is real and is written up in
[260905b](../postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md): a report
computed over the collection the failure emptied, printing `Findings: none` and a clean bill over a
run in which nothing happened.

##### What Sol's review of the built code changed, and the one thing it overturned

Five findings, four fixed in `scripts/stage.ts` and one that is a decision for Greg. Every one was
re-measured rather than taken on the review's word.

**The one that overturns a decision this plan made.** *"Re-labelling becomes `npm run hierarchy --
<slug> --force`; the extra structure call is the honest price"* — the sentence that justified
retiring `npm run labels` — **is false**, and going through the queue is what made it false. The old
CLI passed `nullCheckpointStore()` and always paid; a queue run gets the article's own `checkpoints`
rows, and `force` is a flag on the *step* (run rather than skip) and means nothing to a checkpoint.
Measured: two consecutive `npm run hierarchy -- stage-e-scratch --force` on an unchanged article
bought **two model calls and then none**, printing `13 sections over 19 blocks` both times, with the
`hierarchy-structure` and `hierarchy-labels` rows sitting there in between.

So: **the stage CLIs gained a resume they never had** (good, and the opposite of what this plan and
the first draft of `scripts/stage.ts` said), and **changing a label prompt and re-running has no
command** (a real loss, and not one the `labels` decision priced in). Making `force` clear a
checkpoint would change what a reader's Refresh does too, so it is a queue-wide product call rather
than something a CLI should work round — left for Greg, and written down in
`docs/project/setup-dev.md`, `architecture.md` § Conventions, `src/store/checkpoints.ts` and
`src/labels.ts` rather than left as a surprise.

**Four fixed here.**

1. **`scripts/stage.ts fetch <slug> --force` was still the fetch-only job.** Deleting `npm run fetch`
   from `package.json` removed the *name*; `oneStage` took any `StepName`. It now refuses `fetch`
   with the sentence, so the rule lives in the code rather than in an npm script. Verified.
2. **`npm run ingest -- <url>` could not re-fetch.** An address already on the shelf is adopted, so
   every step skipped and *"re-fetching cascades"* was a claim nothing could reach — the landed run
   above had used an address that was **not** on the shelf, which is exactly how the gap survived.
   `--force` now forces `fetch` and `cascadeForce` takes the rest. Measured, above. `--force` stays
   refused for a *file*, where it really is meaningless.
3. **A failing `noteSlug` stranded the job.** The route can throw there because its `enqueue` starts a
   pump; this one carries `pump: false` and is the only driver, so a throw between `enqueue` and
   `drive` left a queued job nothing would ever advance. It is a warning now — and the slug is
   written again by `settleUpload(…, "verified")`.
4. **The file path minted before it looked.** An empty file or a `.txt` got an upload record and bytes
   in Storage before the pipeline refused it. `looksLikePdf` — the same function `acquireUpload` uses
   — and a positive-size check now run first. Verified: three refusals, no new `uploads` rows.

**And one hardening the review asked for:** `drive` no longer waits on `busy` for ever. An older
abandoned job queued with `pump: false` holds the article's line and nothing drives it, so the loop
gives up after ten minutes and says what to look at.

**What the review agreed was right**, having checked it: the `enqueue` refusal breaks no production
caller and its privacy claim now holds by construction; the `pump` closure reaches every exit
including both `handBackToARetry` paths; `pump: false` is correct for the cost eval; the five seeded
suites are not weakened, and seeding only two of `tests/jobs.test.ts`'s four slugs is right. Its one
remaining reservation is that `tests/blocks-baseline.test.ts` § *the step* is narrower than the
subprocess test it replaced — it plants the first run's blocks by hand rather than committing them —
which is true, and the Postgres arm of that same file still covers the commit-and-read seam.

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

#### F is built — 2026-09-05

**27 comparison sites removed, and the predicate matters**: occurrences of
`STORE === "…"` or `STORE !== "…"` in *executable* positions under `src/` and `vite.config.ts`,
counted off the diff (`git diff -U0 -- src/ vite.config.ts | grep '^-' | grep -E 'STORE\s*[=!]==\s*"(files|postgres)"'`
is 28, of which one is a line of prose). The plan's estimate was 19; it counted comparisons and this
counts the same thing, so the estimate was simply low. `STORE` and `StoreName` are gone with them, and
so is `storeFromEnv`.

**The tombstone is `refuseTheStoreFlag` in `src/store/live.ts`**, called
once at module load, returning `void`: unset, `""` and `postgres` pass in silence; `files` and every
other value throw *"the filesystem store was removed on 2026-09-05; there is one store; unset this"*.
`tests/store-selection.test.ts` asserts the **date** rather than the wording, because the date is the
part somebody holding a deployment needs.

##### The safety net was dead on arrival, and its own tests were green

**This is the most instructive thing the job produced and it must not be summarised as "added a
missing import".** Read it before stage G.

The hinge removed the last `STORE === "postgres"` comparison from `src/store/index.ts`. That
comparison was also **the last `import` of `src/store/live.ts`** — the module the tombstone lives in.
The tombstone throws at module load, and a module nothing loads throws nothing. So the commit that
existed to make `SPIDERYARN_STORE=files` refuse **took the refusal out of the program**, and left
behind a build that boots clean on exactly the environment Vercel Preview and Production have right
now, logs *"serving article reads from Postgres"*, and serves Postgres under the other store's name.
The one failure the flag was kept alive for.

Measured, not argued — a child with `NODE_ENV=production`, coherent dummy credentials, `VITEST`
unset and `SPIDERYARN_STORE=files`, importing `src/store/index.ts`:

```
{"level":"info", …,"component":"store","msg":"serving article reads from Postgres"}
EXIT=0
```

**Three things about how it was found and how it hid, and each generalises.**

1. **It hid behind its own tests.** `store-selection.test.ts` and `one-store-only.test.ts` both
   `import { refuseTheStoreFlag }` and call it. Loading a module by hand and asking whether the
   function works cannot see whether anything else loads it — the check shares an assumption with the
   bug, and the assumption is *that the guard is reachable at all*. Textbook
   [silent-success.md](../reusable/silent-success.md), arriving inside the one piece of code written
   to stop that family. Two green tests over a guard that was not in the program.
2. **It was found by running the import, not by reading it.** A cross-family review built a
   production-shaped process and imported the module. Nothing in the diff looks wrong: every line
   deleted was a dead comparison, and the surviving file is correct in isolation. The compiler had
   nothing to say either — an unused import is *removed*, never demanded.
3. **The tell was available and nobody looked for it.** `grep -rn 'store/live.js' src/ scripts/
   evals/ api/` returns **one** line, and it is `src/routes.ts` importing `./live.js` — which is
   `src/live.ts`, the live-conversation module, a different file with the same basename. A near-miss
   that reads as confirmation. *"Which files import this?"* is the question a deletion should always
   ask, and it is not the question *"does anything still reference the symbol I removed?"*.

**The class**, named, because stage G deletes eight more modules: **removing the last consumer of a
symbol removes the module, and a module whose value is a side effect loses that side effect
silently.** It is not specific to flags. Anything that registers, validates or refuses at import —
a boot check, a schema registration, a signal handler — is deleted by deleting the last thing that
imported it for its *value*. Stage G should ask, of every module it stops referencing, whether the
module did anything at load time.

**The regression matters more than the fix.**
`tests/store-flag-refused-at-boot.test.ts` (deleted by stage I, 2026-09-06) imports
**the module a server imports, in a child process, and requires the child to die**, with the sentence
and the date in its output and *without* the "serving article reads" line — because printing that
means the refusal came too late to be one. It was **watched red before the fix**, and it carries a
positive control (the same child with the flag unset must exit 0), since *"the child died"* is
otherwise satisfied by a wrong path or a missing credential — plus a second control that the child is
in a *deployment's* environment and not the runner's, because the blob boot check is off under
`VITEST` and the flag is refused before it either way, so nothing else in the file would notice.

`tests/store-selection.test.ts` keeps the *behaviour* and says in its header that it cannot see the
wiring. Neither file replaces the other, and that division is the lesson: **a rule and its
reachability are two claims, and a test that calls the function can only make the first.**

##### The second half: the fix looked complete because the reported symptom went away

**The same story, one level up, and it is the half worth reading twice.** The first fix put
`import "./live.js"` in `src/store/index.ts` — the reader wiring hub, and the obvious front door. It
closed the reported instance and **not the class**. Measured the next round,
production-shaped, `SPIDERYARN_STORE=files`:

```
src/store/index.js  -> exit 1  "the filesystem store was removed"
src/jobs.js         -> exit 0  BYPASSED_THE_TOMBSTONE
src/store/pg.js     -> exit 0  BYPASSED_THE_TOMBSTONE
src/db/client.js    -> exit 0  BYPASSED_THE_TOMBSTONE
src/upload-records.js -> exit 0  BYPASSED_THE_TOMBSTONE
src/store/ai-calls.js -> exit 0  BYPASSED_THE_TOMBSTONE

SPIDERYARN_STORE=files … tsx evals/cost/run.ts --list  -> exit 0, printed the corpus
SPIDERYARN_STORE=files … tsx scripts/stage.ts blocks … -> exit 0
```

Not toy paths: `scripts/stage.ts` runs pipeline steps against a reader's real articles and
`evals/cost/run.ts` spends money. And the reason the hub was not enough is written down in this plan
already, three times over: `src/jobs.ts`, `src/upload-records.ts` and `src/store/ai-calls.ts` each
bind their Postgres adapter **outside** `store/index.ts` *specifically to avoid an import cycle*. The
architecture that made the hub the obvious place is the same architecture that made it insufficient.

**The rule, and it is what stage G should take:** a side-effecting import belongs at the **narrowest
boundary everything must cross**, not at the most obvious front door. *A front door is whichever door
you happened to walk through.*

Here that boundary is [`src/db/client.ts`](../../src/db/client.ts), and the claim was checked rather
than assumed — `getDb` is exported from exactly one place, `new Pool` / `pg` /
`drizzle-orm/node-postgres` appear in exactly one file, and every module under `src/` that reaches
the database imports `getDb` from it. **That claim is now a test too**
(`one-store-only.test.ts` § *db/client.ts is the only place a Postgres connection is built*), because
a second connection built anywhere else would put the tombstone back to guarding one path of several
— which is precisely how this looked finished the first time.

`store-flag-refused-at-boot.test.ts` asserts the refusal for **six independent roots** and for
`evals/cost/run.ts --list` as a typed command. All six went red before the move and green after; the
`store/index.ts` case was green throughout, which is the whole point of the other five.

##### And the file could erase what the shell asked for

Second finding from the same review, reachable the moment the first was fixed. `live.ts` called
`loadEnvLocal()` and then read `process.env.SPIDERYARN_STORE` — but `.env.local` is applied **over**
an inherited value (`src/env.ts` § the precedence rule, which is right and stays). Measured:
inherited `files` with a `.env.local` saying `postgres` gave
`{"requested":"files","validated":"postgres","threw":false}`, and `src/env.ts`'s own "overrode"
warning is suppressed under `NODE_ENV=test`. An operator who typed the thing this whole stage exists
to refuse was silently overruled by a file.

`refuseTheStoreFlag` now takes **both** values — `{ inherited, applied }` — and checks the shell
first, so the message names the source the person has to change (*"in the shell environment"* vs
*"in `.env.local`"*). `src/env.ts` exports `inheritedEnv(name)` for the snapshot it already kept. In
production there is no `.env.local` at all, so the two values are one string and it costs nothing.

The case is proved by composing the two real functions — `applyEnvFile` produces the override, the
refusal is handed its answer — rather than by a hand-made pair, and deliberately **not** by editing
this repo's `.env.local`, which is a real developer's file.

##### The sharper invariant held, and a grep enforces it

[`tests/one-store-only.test.ts`](../../tests/one-store-only.test.ts) is new and is the stage's static
guard. It reads `src/`, `scripts/`, `evals/`, `tests/`, `api/` and four root files with comments
stripped, and asserts three absences and two presences — plus a control that it read >600 files at
all, because emptiness is this guard's entire output.

**Its first version did not scan what it claimed to**, which the review caught: the extension test
was `/\.tsx?$/`, so **`api/index.js` — the production shim Vercel actually invokes — was not read at
all**, nor any `.mts` under `evals/`. A guard reporting clean about the one file whose
misconfiguration reaches readers. The reader regex was one shape wide, too: it missed
`process.env["SPIDERYARN_STORE"]` and `const { SPIDERYARN_STORE } = process.env`, which are the two
spellings a rewrite reaches for.

It is now `/\.[cm]?[jt]sx?$/` and four reader shapes, the anti-empty control names `api/index.js` and
`evals/extraction/probe.mts` **by name**, and the exemptions are an allowlist with a reason each,
policed for staleness the way `LANES_BEYOND_THE_SCAN` polices its own.

| the mutation | what went red |
| --- | --- |
| a `process.env.SPIDERYARN_STORE` read appended to `tests/arc.test.ts` | *is read by src/store/live.ts and by nothing else* |
| a `STORE === "postgres"` comparison appended to it | the same |
| `const when = reachable ? describe : describe.skip` appended | *has no /reachable\s*\?\s*describe…/* |
| `describe.skipIf(!reachable)` appended | *has no /describe\.skipIf…/* |
| `it.skipIf(!reachable)` appended | *has no /it\.skipIf…/* |
| `reachable: boolean` put back on `PgReady` | *cannot be given a boolean to gate on* |
| `process.env["SPIDERYARN_STORE"]` appended to **`api/index.js`** | *is read by … and by nothing else* → `[ "api/index.js" ]` |
| `const { SPIDERYARN_STORE } = process.env` appended to `api/index.js` | the same |
| `process.env.SPIDERYARN_STORE` appended to `evals/extraction/probe.mts` | the same → `[ "evals/extraction/probe.mts" ]` |

All nine watched failing before the guard was believed, and the four names on the deletions in
`scripts/` the plan called out — `db-seed-dev`'s `storeVerdict`, `ai-cost`'s `--owners` refusal,
`stage.ts`'s die, `share-local-articles`' refusal — are gone in this commit rather than in I.

##### The database is required, and the five criteria were proved by run

1. **One failure, before collection.** `tests/setup/private-db-global.ts` no longer asks
   `postgresRequired()`; an unreachable stack throws. `DATABASE_URL='postgresql://…@127.0.0.1:1/postgres'
   npx vitest run --project private-postgres tests/store-comments.test.ts` gives `EXIT=1`, exactly one
   `Unhandled Error`, and **the diagnostic names the deliberately bad target** — *"expected exactly one
   Docker container publishing port 1 to 5432, found 0"*. Zero skips in the output.
2. **The alias is gone**, from 103 files, along with `describe.skipIf(!reachable)` and
   `it.skipIf(!reachable)`. `pgReady` throws instead of returning `{ reachable }`, so the boolean the
   pattern needs does not exist.
3. **The guard above**, with its nine mutations.
4. **The positive run** — see the lanes below.
5. **Stage B's mutation evidence is untouched**: nothing in this commit edits a `**Mutation.**`
   header, and `tests/store-migration-registry.test.ts`'s arrears check is green.

**The shell-`DATABASE_URL` trap the plan warns about does not bite here, and it is worth knowing
why.** `.env.local` beats the shell for most of this repo, but the private lane's factory asks
`resolveTargetUrl({ shellWins: true })` ([`scripts/db-test-create.ts`](../../scripts/db-test-create.ts)
§ `baseUrl`), so a value on the command line does reach it. That makes the control one command and
needs no stopping of the shared Supabase.

##### `contextPaths` and `outputs(ctx)`: measured, and both belong to G

The plan asked for this to be measured rather than assumed. It was, two ways.

**Statically**, `outputs(ctx)` has exactly one caller in `src/`: `articleMetadata` in
`src/api.ts`, which is the **filesystem** `ArticleReader`. After the hinge
`src/store/index.ts` binds `pgArticleReader.articleMetadata`, so no route reaches it; the only
importers of `src/api.js` left are `src/store/fs.ts` (the adapter itself), `src/store/pg.ts` (which
takes `describeArticle` and `titleFor` only) and tests. `stepIsDone` and `assertProduced` stopped
reading `outputs` in 2026-08-26 — both go through `store.read` and `step.produces`.

**By experiment**, because a static argument about a required field is the kind that is wrong.
`contextPaths(job.slug)` in `runStep` was replaced with
`{ dir: "/dev/null/POISONED-CTX-DIR", htmlFile: "/dev/null/POISONED-CTX.html" }` and eight suites run:
`pg-session-real-step`, `jobs-walk`, `article-cache-call-site`, `claim-session-postgres`,
`acquire-extract-blocks-end-to-end`, `step-failure-seam`, `jobs-commit-path`,
`retry-keeps-the-checkpoints` — **50 tests, all green**. Nothing in the run path reads either field.

So: **`outputs` is read only by the filesystem adapter and goes with it in G**, and `contextPaths` in
`runStep` goes with `StepContext.dir` / `htmlFile`, which is a contract change and therefore H's or
G's rather than the hinge's. `tests/jobs-fs-adapter.test.ts`'s surviving block is the one that dies
with those two fields, and its header says so.

##### The suites the flag was quietly deciding for, which is the stage's real cost

Nine files were reaching a filesystem adapter **because the flag was unset**, not because they asked
for one. Every one of them had to be dealt with here, since this commit removes the route:

- **Deleted**, subject and test in one commit, as stage G's pairing rule asks:
  `tests/claim-session-files.test.ts` and `tests/pipeline-slug-claim-files.test.ts` (the registry
  already said both go with the `STORE !== "postgres"` lines they guard), and
  `tests/billing-admission-files.test.ts` (whose `filesIt` would have skipped for ever). **One of
  those three deletions lost a claim** — see § *Three more the review found* — and the registry
  entry that licensed it did not and could not say so.
- **Converted to Postgres**: `tests/store-wiring.test.ts` (the substrate really was interchangeable,
  as its registry entry claimed — an article row instead of a copied `example/` directory),
  `tests/request-spend.test.ts` (its child wrote a JSONL ledger through `fsCostStore`; it reads
  `spideryarn.ai_calls` now, and the child reaches the private database because
  `SPIDERYARN_ENV_PINNED` is inherited), `tests/uploads-api.test.ts` and
  `tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts` (`fsJobStore`/`fsUploadStore` →
  the Postgres pair), and `tests/upload-acquire.test.ts` (whose owner uuid now needs a real
  `auth.users` row, because a directory has no foreign keys).
- **Cases deleted with the refusal they were about**: the filesystem 501s in
  `tests/feedback-store.test.ts` and `tests/admin-feedback-store.test.ts`, and two runner-driven
  cases in `tests/jobs-fs-adapter.test.ts` — the second of which is a **real loss**, enumerated in
  that file's header: `writeOnce`'s temp-file-then-rename has no Postgres counterpart and should not
  have one, and the interrupted marker *seen through the real runner* is covered nowhere until
  `tests/jobs.test.ts` § *running a job* grows it.
- **Re-expressed, twice, and the first attempt was wrong**: `tests/public-dispatch.test.ts`'s five
  dispatch cases read a 501 from the filesystem store as *"the handler ran"*. The first replacement
  was a 500 from the poisoned unit-lane database — which is **not a witness at all**, because
  `handleApi` gives any unexpected throw a 500. They now spy on the route's own `read`, and assert
  both that it ran and what it was handed. See § *Three more the review found*.

##### One weakening, and it is deliberate: the blob-store boot check

`postgresBlobStore(...)` at the top of `src/store/index.ts` refuses when `DATABASE_URL` and
`SUPABASE_URL` name different Supabase projects. It sat under `if (STORE === "postgres")`, which was
false in the unit lane — and with the flag gone it ran on every import, so **around thirty unit-lane
files stopped collecting at all**, on a message about Supabase ports. The lane poisons those two
variables to two *different* loopback ports on purpose
([`tests/helpers/unit-lane-poison.ts`](../../tests/helpers/unit-lane-poison.ts) says why each), which
is exactly the shape the check refuses.

It is now `if (!process.env.VITEST && process.env.NODE_ENV !== "test")`. **Both halves are
load-bearing**, and the `NODE_ENV`-only version was written first and measured wrong: four suites
spawn a child with `NODE_ENV=development` deliberately, because `src/log.ts` is silent under `test`
and the child's stdout is their evidence — those children inherit the poison and nine cases died on
the port message. `VITEST=true` does survive into a child (measured).

What it costs is that **nothing under the runner executes that line any more**. `tests/blobs.test.ts`
owns both refusals directly, and `tests/one-store-only.test.ts` asserts the line and its exact
condition still exist, because a check nobody runs is a check somebody deletes.

**The review built a production-shaped process with a mismatched project pair and the check refused
correctly**, so switching it off under the runner is a decision rather than a hole. Cleared.

##### Three more the review found, and the shape of two of them is the running theme

**A witness that had become a constant.** The five re-expressed `public-dispatch` cases read a **500**
as *"the public handler ran"* — a status that used to be a **501** only the reader could produce.
`handleApi` maps *any* unexpected throw in that namespace to 500 with `handled: true`, so all five
passed **with the reader never running**: replace `route.read(...)` in `servePublicApi` with
`throw new Error("anything")` and every one stays green. Re-expressed once more, and this time on the
reader itself: `PUBLIC_ROUTES` is the array the dispatcher walks, so the route's own `read` is spied
on, made to reject with a sentinel string nothing else can produce, and asserted to have been
**called with the right argument** — which is what separates *the pattern matched* from *the pattern
matched too loosely and passed `example?at=spya-k3m9qt&zoom=2`*, a distinction no status can make.
Watched red: with the reader replaced by a bare throw, all five fail.

That is the second finding in this stage whose whole content is *the check had stopped being able to
fail*, and the first is the tombstone above. **Stage G inherits both.** A stage that deletes an
adapter will be deleting the thing that made half these suites' answers distinguishable from
nothing, and the question to ask of every case left standing is not *"is it green"* but *"what is
still capable of making it red"*.

**`npm run live:spike` was reading the filesystem store**, at `/session` and `/tool`, through
`loadArticle` from `src/api.ts` — while its vocabulary and its tools went to Postgres seams. A slug
that exists only in the database could not start a live conversation, and a stale `data/<slug>/` of
the same name fed the model filesystem prose while its tools answered from the Postgres article: two
sources of truth inside one conversation, with nothing to say so. Invisible while the flag chose the
default; the hinge made it the last reader in the tree still pointing at `data/`. Now
`src/store/index.js`.

**A claim was lost with a deleted suite, and only one of the two deletions was safe.**
`tests/pipeline-slug-claim-files.test.ts` and `tests/claim-session-files.test.ts` both went in this
commit on the registry's own instruction. But the first uniquely asserted that **an uploaded article
exists even though `urlForSlug` returns `undefined`** — the disagreement the left join in
`ownedArticle` exists to produce — and the surviving Postgres half seeds only `finalUrl: URL`.
Production is right today; nothing protected it. Restored as one case in
`tests/pipeline-slug-claim.test.ts`, asserting **both answers together**, and the mutation is the
proof it was really missing: `articleExists` derived from the URL
(`return (await ownedArticle(slug))?.url != null`) reddens **only the new case** and leaves the other
six green.

The general form, for stage G: *"the registry says this file's subject dies here"* licenses the
deletion and says nothing about whether **every claim in it** has a home. `port or enumerate` is
already the rule; what this adds is that a suite named for one store can carry a claim that is about
neither.

##### And two more of the same shape, found in the round after that

**The reader spy still could not catch an over-broad route.** `readerRan` proves a canonical path
matches and supplies the right argument; it says nothing about non-canonical paths *failing* to
match. Measured: delete the trailing `$` from `publicRoute()` in
[`src/public/route-names.ts`](../../src/public/route-names.ts) and **all 26 cases stay green** while
`/api/public/article/example/extra` reaches the article reader with `"example"`. The collection route
had suffix cases from the day it arrived; the slug route had none, so its anchor was pinned by
nothing. Three near misses are in the unknown-path 404 table now, and the `$` mutation reddens it.

**The leading `^` is still pinned by nothing, and that is said in the file rather than implied.**
Removing it also leaves all 26 green — because `isPublicNamespace` is a `startsWith` on
`/api/public/`, so a path with anything in front never reaches the dispatcher at all. The first
version of that comment claimed the case covered both anchors; it was corrected after the mutation
disagreed with it, which is the same lesson one turn smaller.

**The allowlist staleness check was self-validating.** `one-store-only.test.ts` accepted an exemption
whenever the stripped source merely *contained* the string `SPIDERYARN_STORE` — a weaker predicate
than the one that makes an exemption necessary, and one the check's **own source satisfies**, so its
own entry could never be reported stale. An exemption must now match the same `READS_THE_FLAG`
shapes; watched red by doctoring a copy of `store-selection.test.ts` to keep a plain mention and no
reader shape. The file's self-exemption is gone with it: it is **skipped from the scan** by `SELF`,
which is a different statement from *"allowed to read the flag"*, and conflating the two is what
produced the hole. The one-file blind spot that leaves is now written on the constant rather than
hidden in the list.

**That is five in this stage** — the tombstone that was never loaded, the tombstone loaded on one
path of several, the 500 that any throw produces, the route anchor nothing pinned, and the exemption
that vouched for itself. They are one shape: **the check had stopped being able to fail, and nothing
about its output said so.** Every one was found by *running* something rather than reading it, and
four of the five were green at the moment somebody would have called the work finished. Stage G
deletes eight modules and the suites that watch them; the question to ask of every case left standing
is not *"is it green"* but *"what is still capable of making it red"*.

##### Round three: one accepted, one overruled, and a sensor better than either

**Accepted: the guard's claim was wider than its scan.** The new assertion said *"`db/client.ts` is
the only place a Postgres connection is built"* while filtering to `src/`, so it could not establish
that. Five scripts build their own — `db-migrate.ts`, `db-check.ts`, `db-corpus-readiness.ts`,
`db-repair-migration-ledger.ts` and `deploy.ts` — **by design**: they are operator tools addressed by
their own `Target:` line
([database.md](../project/database.md#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like)),
not stores a reader is served through, so nothing there was ever the flag's to decide. The case is
now *"…the only place **under `src/`** a Postgres connection is built"*, and the assertion says on
itself that a claim broader than the thing it scans is the same failure this stage has now hit five
times over. Sixth of the shape, and the cheapest to fix: nothing was wrong with the code, only with
the sentence describing it.

**Overruled: the tombstone does not go on Storage, the model gateway, or the migration and deploy
scripts.** Written out in full because the reasoning is the point, not the conclusion —
coordinator, 2026-09-05:

> **Sol still objects that the class is not closed; overruled.** The objection is that with
> `SPIDERYARN_STORE=files` a Supabase Storage PUT and a paid OpenRouter call both still proceed
> without crossing the tombstone. Both facts are true. Neither is the harm this tombstone exists to
> prevent.
>
> The tombstone's sentence is *"silently ignoring `files` would do the opposite of what the operator
> asked."* **That only means anything on a path where `files` used to ask for something.** Before the
> hinge, with Supabase credentials present, `supabaseBlobs().putIfAbsent()` performed exactly the
> Storage POST it performs today — `src/store/blobs.ts` § *Why selection does not read
> `SPIDERYARN_STORE`* says so and says why. `openRouterJson` made exactly the same paid call;
> `src/ai-spend.ts` is an in-memory `AsyncLocalStorage` ledger that imports nothing from `store/`, so
> the dictation evals never touched a store under either value. **On those paths the flag was inert
> env noise before and is inert env noise now.** Nobody who sets `files` is worse off there than
> somebody who unsets it — which is the test the objection has to pass and cannot.
>
> The class the tombstone closes is **code that acts on the flag**, and that class is already closed
> exhaustively rather than door by door: `tests/one-store-only.test.ts` § *is read by
> `src/store/live.ts` and by nothing else* scans `src`, `scripts`, `evals`, `tests`, `api`,
> `vite.config.ts`, `package.json` and `api/index.js`. If nothing but the tombstone reads the flag,
> no path can serve the wrong store; the only remaining job is that the tombstone be **loaded**
> wherever a store could be served, which `db/client.ts` achieves. The objection redefines the class
> as *any outbound I/O while a stale variable is set* — an unbounded invariant the repo holds for no
> other variable.
>
> **And it would cost two things.** `src/store/live.ts` is deliberately a **leaf** — its header
> explains the import cycle that shape avoids — so importing it from the model gateway and the
> Storage adapter adds edges for one deployment that stage I then deletes. Worse,
> `scripts/store-migration-candidates.ts` treats *"imports `src/store/live.ts`"* as the signal that a
> module **does store selection**, so adding that import to `ai-call.ts` would make the migration
> tooling misreport the AI gateway as a store-selecting module.
>
> Same reasoning declines `db:migrate` and `deploy`: `files` never stopped a migration — a laptop on
> the filesystem store ran `db:migrate` against local Postgres routinely — and the script's target has
> always been its `DATABASE_URL`, not the store. Adding a refusal there makes the tool you reach for
> in an incident fail for a reason unrelated to the incident.
>
> One residual was checked rather than waved away: could a Storage POST land before the refusal,
> orphaning an object? The only caller of `putIfAbsent` outside the adapters is `scripts/stage.ts`,
> which top-level `await import`s `db/client.js` well before it, so the refusal fires first — and the
> bucket is content-addressed and create-only, so an orphan would be harmless anyway.

That quote names the guard case as *"is read by `src/store/live.ts` and by nothing else"*. It is now
called *"…and nowhere the list above does not name"*, for the reason the next section gives: the
allowlist stopped being empty, and a title that says *nothing else* while the code permits three
files is the sixth instance again in miniature. The quote is left as it was written.

##### The sensor that retires the tombstone, which is worth more than the argument

The tombstone is a **proxy**. The real condition is *"the variable is still set in Vercel Preview and
Production, and only Greg can remove it"* — and until now nothing watched that, so stage I waited on
somebody remembering to run `vercel env ls production`. That is how a one-line chore becomes a stage
that never starts.

[`src/vercel-health.ts`](../../src/vercel-health.ts) now carries `RETIRED`, the mirror of `EXPECTED`:
`EXPECTED` says *absence may be a problem*, `RETIRED` says *presence is*. A deployment that still has
`SPIDERYARN_STORE` reports it in a `retired` field naming the variable, the `vercel env rm` command
and stage I of this plan. `scripts/deploy-checks.ts` § `retiredNotes` turns that into a printed line
in `npm run deploy`'s post-deploy verify — **the machine that has the Vercel credential is the one
that sees the nag**, which no health page an agent can curl would achieve.

Three design decisions, each of which the obvious version gets wrong:

- **Reported, never warned about.** `warnings` is not a list, it is a verdict: `src/vercel-health.ts`
  computes `ok = !failed && warnings.length === 0` and answers **503**, and
  `scripts/deploy-checks.ts` § `judgeHealth` turns every warning into a deploy-blocking problem. The
  tidy-looking version of this feature would have made production unhealthy and blocked every deploy
  over a variable that decides nothing. **A red that is not a fault is a red people learn to force
  past** — and this one would have had to be forced past on every deploy until Greg happened to be
  free. `tests/deploy-checks.test.ts` § *is not a deploy-blocking problem* pins it.
- **Absent is silent, and that is what makes it a sensor.** The field is omitted entirely rather than
  reported empty — the convention `schema` and `migrations` already follow — so the day the variable
  goes, the line goes, and **its disappearance is the signal that stage I can start**. A nag that
  outlives the thing it nags about is furniture. Watched red: report the field unconditionally and
  `tests/health.test.ts` § *says nothing at all once it is gone* fails while the other 34 cases in
  that file stay green. A blank value counts as gone, because `value()` trims.
- **It is a second reader of the flag, so it is in the allowlist by name.** `RETIRED` is a record
  keyed by the variable — `{ SPIDERYARN_STORE: "…" }` — specifically so that
  `one-store-only.test.ts`'s `SPIDERYARN_STORE\s*[:=]` shape **sees** it and reports the file; the
  exemption then grants it in writing, with the reason. Written the obvious way, as
  `name: "SPIDERYARN_STORE"`, it falls through all four shapes and the guard stays green over a new
  reader — the seventh instance of the running shape, avoided by making the code visible to the check
  rather than by widening the check. The widening was tried and rejected on measurement: a
  quoted-literal shape catches four files, and one of them
  ([`tests/store-migration-registry.ts:613`](../../tests/store-migration-registry.ts)) is naming the
  flag inside an English sentence. A regex cannot tell a lookup key from prose, and pretending it can
  is the failure this stage is a catalogue of.

Mutation evidence, all three targets watched red before being fixed green: drop the `retired` field
(2 red in `health.test.ts`), report it unconditionally (2 red, the two absence cases), add a spurious
name to `RETIRED` (5 red), stub out `retiredNotes` and move the reporting into `judgeHealth` (2 red in
`deploy-checks.test.ts`).

##### And an eighth, found while checking the fourth criterion held

Criterion 4 asks for a positive run with **no database-related skips**. The full run has 36 skipped
tests in 8 files; reading them found the skip guard's own name doing what piece 1 had just been
corrected for. The `describe` was called *"no suite decides for itself whether the database is
required"*, and its three regexes all key on the identifier `reachable` — so two files that write
`x ? describe : describe.skip` against something database-shaped were outside a claim that sounded
like it covered them:

- **`tests/db-test-create.test.ts`** (14 of the 36) gates on the opt-in
  `SPIDERYARN_TEST_DB_FACTORY=1`, because those cases create and drop real databases on the cluster
  every agent on this box shares. It writes a line to stderr saying which reason applied, so it is
  loud rather than silent — the property that matters. Its probe does also fold in reachability, so
  an opted-in machine with no container skips quietly; that residual belongs to the factory.
- **`tests/migration-reconciliations.test.ts`** (0 skipped in this run) gates on `isLocalDatabaseUrl`
  because it asserts things about *the schema this laptop actually has*; pointed at production it
  would be asking the wrong database. Its first case asserts the connection happened, so an empty
  block cannot read as a verified one.

The other 22 skips are `gjd-remote*` platform gates — macOS-only and GNU-only — and are not about the
database at all. **Widening the regex to the structural form was measured and rejected** precisely
because it catches those: a guard scanning wider than its claim is the same fault as one claiming
wider than it scans. The name is now *"no suite gates itself on `reachable`, the alias 103 of them
shared"*, and what it does not cover is written on the guard rather than left in a skip count.

**That makes eight in this stage**, and the last three were all the cheap half of the shape: the
sentence, not the code. Nothing was broken in any of them; each one just promised something its code
could not fail on, and the fix each time was to say the true thing.

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

#### G's cohort, frozen before any edit — 42 files, and the manifest's predicate sees 29 of them

**The prediction, with its predicate in the same sentence** — the rule stages C and D each paid
for once, and which this freeze exists to obey:

> Stage G's cohort is **42 test files**, under the predicate *"has an `import` line naming a
> condemned module or `src/api.js`, or calls `contextPaths(`, or reaches the filesystem store by
> no import at all"*. Of those I predict **8 die**, **~25 are edited to drop a filesystem arm or
> a single case**, and **~5 must have assertions ported** — because the predicate that governs a
> file's **fate** is *whether the condemned module is its subject*, which is a different question
> from the one that governs its **membership**.

Two predicates, and keeping them apart is the whole of this freeze. Membership is about imports;
fate is about assertions. Stage A's manifest used the first to answer the second, and that is
where its three errors come from.

The count, by how a file gets in (`scripts/` scratch: `g-cohort2.py`, run 2026-09-05):

| | files | |
|---|---|---|
| A — imports a condemned `src/store/*` module | 29 | what stage A's manifest can see |
| B — imports `src/api.ts` | +6 | invisible to A |
| C — calls `contextPaths()`, neither of the above | +4 | invisible to A |
| D — reaches by no import at all | +3 | invisible to **both** witnesses |
| **total** | **42** | |

**The manifest's predicate sees 29 of 42.** The thirteen it misses are
`api`, `billing-settlement`, `jobs-commit-path`, `library`, `metadata-visibility-fs`,
`pg-session-exact-base`, `public-imports`, `sanitize-stale-artefact`, `shelf`, `slug`,
`store-artefact-manifest`, `store-carry-forward`, `store-session-isolation`.

##### The third blind spot: the filesystem store has a room outside `src/store/`

`src/api.ts` **is** the filesystem article reader — it reads `blocks.json` and `tree.json` off
disk (`api.ts:217` `loadArticle`, through `candidateDirs`/`readJson`), and `src/store/fs.ts:113`
assembles sixteen of its exports into `fsArticleReader`. It is instrumented by **nothing**:
`CONDEMNED` (`vitest.witness.config.ts:44`), `TARGETS`
(`scripts/store-migration-candidates.ts:57`) and `INSTRUMENTED`
(`scripts/store-migration-witness.ts:94`) are the same eight `src/store/*.ts` modules, and
`src/api.ts` is on none of them.

So a test that calls `loadArticle` off `src/api.ts` executes the filesystem reader and **records
nothing** — and the hole check at `store-migration-registry.test.ts:606` unions
`ranAndTouchedNothing` into `accounted`, so the witness's silence is read as a clean bill.
Measured against the committed witness:

```
tests/library.test.ts                 ranAndTouchedNothing: True   registry entry: False
tests/sanitize-stale-artefact.test.ts ranAndTouchedNothing: True   registry entry: False
tests/api.test.ts                     touched:              True   registry entry: True
```

`api.test.ts` was caught only by accident: it calls `articleMetadata`, which at `api.ts:1121`
constructs `createFsArtifactStore` — an instrumented module, reached through a different door.
The other two call `loadArticle`/`listArticles`, which never enter `src/store/` at all.

`KNOWN_BLIND_SPOTS` (`store-migration-witness.ts:110`) records two, and this is neither. The two
it knows are about *how* the instrument watches — a read rather than a call, a second module id.
**This one is about where it looks**: the scope was defined as a directory, and the condemned
implementation had a room outside it. A guard whose scope is drawn from the same assumption as
the thing it guards agrees with the bug — [silent-success.md](../reusable/silent-success.md), and
the fourth time this job has hit it.

Naming the class, because it is not the one already written down: **the instrument's scope was a
directory, and the condemned thing was a behaviour.** Every one of `fs.ts`'s sixteen imports from
`../api.js` was visible in plain source for the whole job.

##### Stage A's manifest is wrong on three files, all over-condemning

Over-condemning is the direction that loses coverage silently, because a deleted assertion leaves
nothing behind to go red.

- `tests/pipeline-artifact-store.test.ts` — filed `filesystem-adapter-behaviour`, reason *"Every
  claim is about `PATHS`, `pathFor` and `has()` parsing"*. It has **14 `describe` blocks and 54
  cases**, among them `sameStamp`, `metaRawSha256`, glossary currency through the stamp, and a
  14-case block driving a hand-rolled `ArtifactReads` fake. **~18 cases survive**; four die.
- `tests/stage2c-raw-bytes.test.ts` — filed `filesystem-adapter-behaviour`. **One** of ~30 cases
  uses the condemned import; the rest are `fsBlobs`/`writeRaw`, and `blobs-fs.ts` is out of scope.
- `tests/store-realtime-sessions.test.ts` — the entry says *"Its Postgres half currently always
  skips"*, inherited from the file's own header. **It cannot skip.** Stage F rewrote this file's
  readiness handling (46 in, 54 out, `1481e196`), and `grep` now finds `skip` in it only inside
  two comments; `describe(name, …)` at `:88` has no `skipIf`. The header contradicts itself
  besides — the `beforeAll` at `:218` records *"All seven failed the first time they were allowed
  to execute"*, which is a suite that ran. The header, the registry entry and the truth are three
  different things, and the first two agree only because one copied the other.

I wrote all three at stage A. They are one error, not three: a file classified by **what it
imports** rather than by **what it asserts** — and an import list cannot see an assertion.

##### Applied literally, G's own brief deletes coverage

Stage G's brief says *"Each group deletes its filesystem-adapter behaviour tests from stage A's
manifest in the same commit as its subject"*, and starts the groups with **uploads**.
`tests/store-uploads-parity.test.ts` is the **only file in the tree that exercises `pgUploadStore`
as a store contract** — the others (`upload-acquire`, `an-upload-is-queued-only-once-its-bytes-arrive`)
are route-level. Its eleven cases reach Postgres through a `stores` array with two entries.
Deleting the file to remove one entry loses all eleven: one-of-two-claims-wins, the three failure
reasons, evidence through settle, an illegal transition, newest-first. **The correct edit is four
lines.** The same shape holds for `store-jobs-parity` (52 Postgres cases behind the same framing),
`store-reader-parity`, `store-realtime-sessions`, `store-ai-calls` and `source-store`.

##### The plan's third stage-G instruction describes work stage B already did

> **Job teardown is 11 files, not the appendix's eight.** They become permanent no-ops —
> `readdir(...).catch(() => [])` over a directory that will never exist. **Replace each with a
> database postcondition querying for leaked test identifiers; do not delete them.**

**There is no such teardown.** `grep -rn "catch(() => \[\])" tests/ src/ scripts/` returns two hits
on this tree: a *comment* at `tests/store-artefact-manifest.test.ts:78` recording that this used to
be there three times, and one unrelated line in `scripts/live-spike.ts`. Stage B converted them;
`tests/jobs.test.ts:61` records its own conversion in prose.

Where the 11 came from: the plan review said *"the scan finds 11 files **referring to** job
directories or helpers"*, and the plan restated that as *"job teardown is 11 files"*. Counted three
ways today — teardowns that actually walk a jobs directory: **1**; files doing any filesystem job
cleanup in a hook: **4**; files merely mentioning `data/_jobs` or `JOBS_DIR`: **~21**, nearly all
header prose recording that the sweep was already converted. None of the four becomes a silent
no-op, because all four are suites whose subject *is* `jobs-fs` and which die with it.

**This is the C-and-D freeze error again, and this time it happened between two documents rather
than inside one head**: a measurement taken with one predicate ("refers to") was reported with a
narrower one ("does teardown in"), and nothing in between asked whether they were the same set.
That is why this freeze states its predicate in the same sentence as its number.

##### What would falsify this freeze

Not "the suite is green". Each group's commit must show, for the files it touches, either a ported
assertion running green in its new home, or an explicit line in the plan saying what was dropped
and why. **A file deleted with no such line is the failure mode**, and no gate can see it.

#### G1–G3 landed — the symbols, the callerless three, and the queue, 2026-09-05

**G1 — two symbols left `fs.ts` before it could go.** `CHAT_SWEPT` and `requireTail` moved to
[`src/chat.ts`](../../src/chat.ts), which already owned `ChatConflict` and every other operation on
`ChatThread[]`, on the precedent of `COMMENT_SWEPT` in `src/comments.ts`. The registry had predicted
this exact move and named these exact two symbols — worth recording beside the three files the same
manifest got wrong, because it is the same document being right in advance about a thing it could
see and wrong about a thing it could not. `SEARCH_SWEPT` needed no move: `pg-searches.ts` already
carried a byte-identical private copy.

**Changing `CHAT_SWEPT`'s value reddens no test, and that is correct.** Found by trying it. The
sentence appears nowhere under `tests/`, and every comparison imports the constant, so the expected
value and the produced value move together — this job's dominant class in a new place. It is
deliberate: [`docs/project/copy.md`](../project/copy.md) says tests match on the code, not the
prose, because *"a test that pins a sentence quietly makes the sentence permanent"*. Recorded rather
than fixed; the obvious fix would have broken a documented rule. What was watched red instead:
flipping `requireTail`'s comparison reddened all three cases in `store-chat-tail-guard`.

**G2 — `uploads-fs.ts`, `ai-calls-fs.ts`, `realtime-sessions-fs.ts`**, 765 lines with no importer
outside tests since the hinge. `tests/store-fs-write-chains.test.ts` went with them: both its cases
were about a module-scope lock in two modules that no longer exist, and a transaction replaces that.

The suites were **edited, not deleted** — uploads 22 → 11, realtime-sessions 14 → 7, ai-calls
25 → 15, every Postgres case surviving. Two assertions were about to die with no home anywhere and
were rewritten against Postgres in place: `pgCostStore.read`'s half-open range predicate, which
`npm run cost` depends on, and `forJob`, whose only real-store test in the tree was the filesystem
one. Both watched red (`lt` → `lte`, and a `.limit(1)`) before being put back.

**G3 — `src/store/jobs-fs.ts`**, 1092 lines, the largest single adapter. `store-jobs-parity` went
113 → 60 with all 53 Postgres loop cases intact; `jobs-fs-load`, `two-servers-one-queue`,
`job-files-on-disk` and `tests/helpers/job-files.ts` died with their subject.
`tests/jobs-fs-adapter.test.ts` was **split**: its `sweepStopped` block went with the adapter, and
its `what a step counts as done` block became `tests/step-context-paths.test.ts` with
`memoryArtefacts()` in place of `fsArtifacts`, carrying forward the rule its old header stated —
*whoever removes `StepContext.dir`/`htmlFile` deletes this block, not whoever deletes the job
store*. That is a later group.

Two properties ceased to exist rather than moving, which is a different thing from being dropped:
`jobs-fs-load`'s *"gives an ownerless record to this installation"* (`jobs.owner_id` is `not null`,
so an ownerless record cannot exist) and all four of `two-servers-one-queue` (its hazard was a
module-scope fence with two copies of the module; `claimIn`'s single conditional `update` abolishes
it). `tests/slug.test.ts` lost the three lines that read `jobs-fs.ts` **as source text** — the
outbound half of a two-directional invariant, deliberately not relocated, because `pg-jobs.ts` has
no `path.join` and no directory for a slug to escape into.

**Two gates go red purely because a file was deleted, and both look unrelated.** The plan already
named `tests/slug.test.ts`. The other is `tests/doc-links.test.ts` — 17 dead links across 11 docs
from G3 and 56 across 33 files from G4. It is a gate, not prose, so "sweep the prose at the end of
the stage" does not cover it; each group fixes its own, converting a link to a plain code span
where the file has gone. The record still says what it said, and only the clickable path goes.

**And a gate that was red for none of these reasons.** `tests/no-provider-calls-guard.test.ts` asks
`git ls-files --cached` which source files exist and then reads their bytes off the disk. Those two
disagree for exactly as long as a deletion is uncommitted, so every group would have hit an `ENOENT`
whose message said nothing about provider calls. Fixed once: a listed path the tree lacks is
skipped, which is safe in the direction that matters, and the guard's existing "git listed fewer
than fifty files" floor is what stops the filter swallowing everything. The inverse of
[260831d](../postmortems/260831d-every-gate-reads-the-working-tree.md) — that one read the working
tree when it wanted the commit; this read the index when it wanted the working tree.

#### G4 landed — `src/store/fs.ts` and `src/api.ts`, 2026-09-05

`src/api.ts` **was** the filesystem article reader, and `fs.ts` was sixteen of its exports wrapped
in a value. Both are gone. `describeArticle` and `titleFor` — the only two things in `api.ts` that
were not about directories — moved to [`src/library-scalars.ts`](../../src/library-scalars.ts),
which is the file that exists *because* `describeArticle` needed a derivation neither store could
own. `src/store/pg.ts` lost its `../api.js` import and gained two names on the
`../library-scalars.js` import it already had.

`assertOwnArticle` was deleted rather than moved: its only consumer was `fsAssertWritableGlossary`,
which has had none since `src/store/index.ts` stopped supplying `assertWritable` on 2026-09-05.
`readRaw` in [`src/fetch.ts`](../../src/fetch.ts) went with it — `loadSource` in `api.ts` was its
last caller, and its own docstring named `articleMetadata`, which had never called it.

**What was ported, and where it now lives**

| from | to | the claim |
|---|---|---|
| `store-comments-parity`, step 4 | `store-comments.test.ts` | a create under a stored id with the placement **absent** must still refuse — `refuses a re-score` sends a *different* number, this sends none |
| `store-comments-parity`, negative placement | `store-comments.test.ts` § `carries the referee's own placement` | `start` is still `12` — the valence did not reach the anchor |
| `library.test.ts` § `describeArticle` | unchanged file, now the whole of it | eight pure cases, moved with the function |
| `sanitize-stale-artefact` § `READERS` | same list | `src/store/public-reader.ts` replaced `api.ts` on it — a third reader of stored html that nothing had ever asked about |

**What was dropped, named rather than waved away**

- **`store-parity`'s whole-`Article` and whole-`LibraryEntry` deep equalities**, its block-order
  equality and its two `toStrictEqual` absent-versus-undefined checks. A comparison needs two stores.
  The block-order claim is pinned at the SQL level in `tests/store-block-reads.test.ts`; the other
  two have no home and cannot have one.
- **`store-parity`'s monotonic `opens`/`lastOpenedAt` assertion**, which existed only to replace an
  equality inside a comparison that is gone.
- **`sanitize-stale-artefact`'s behavioural sanitiser test.** It wrote a stamp-less `blocks.json`
  and read it back through the one reader that needed no database — `src/api.ts`. What is left for
  the surviving readers is that file's source read (a *call*, not a mention), which it had already
  accepted for `pg.ts` and for the same reason. It cannot see a call whose result is thrown away.
- **`store-carry-forward`'s filesystem half of `reports the three as not done`.** It asked the
  step's own `stamp` and so got `assets` right for free, which is what `pg.ts`'s hand-written
  `isCurrent` switch was being checked against. The Postgres half still fails if `case "assets"` is
  deleted; the second opinion is not replaceable.
- **`shelf.test.ts`'s five `listArticles`/`articleMetadata` cases.** Every one has a counterpart in
  `tests/store-shelf-pg.test.ts` § *the shelf's writes*.
- **`api.test.ts` entire (18 cases).** Its subject was `candidateDirs`. The one claim with no
  Postgres home is `loadGlossary` reporting a list written by an older prompt as **outdated but not
  stale**: `pg.ts` spells it `glossary.version !== PROMPT_VERSION` at nine sites and nothing drives
  any of them through the read. Recorded here rather than fixed, because writing it needs a fixture
  with a stale artefact row.

**Three modules are now dead in `src/` and belong to a later group**, all of them reached only by
`fs.ts`: `src/shelf.ts` (every export but `MAX_TITLE_CHARS`), `searchLibrary` in
`src/library-search.ts` (`fold`/`parseQuery` survive, via `chat-tools.ts`), and the file-writing
half of `src/referee-criteria-store.ts` (`withCriterion` and `CRITERION_SWEPT` survive, via
`pg-referee-criteria.ts`). Their tests were left in place, minus the arms that reached the deleted
reader, so that deleting the modules goes red rather than quiet.

**The seam guard was the one thing this group left red**, deliberately and correctly — it is a
decision, not a fix. `tests/store-seams-have-two-implementations.test.ts` demanded two
implementations of every seam, and eleven seams lost their filesystem side in one commit.

**Settled: the guard is narrowed, not extended and not deleted.** It now asserts *every seam has a
Postgres implementation*. The postmortem that commissioned it asked for "two" because
`SPIDERYARN_STORE` unset meant `files`, so a seam with no Postgres side was exercised by every test
and every local run in the one configuration that was not deployed. **That reason is gone; the
outage it guards is not** — a seam with no Postgres implementation is still a 501 for every reader,
and still looks exactly like a seam that works.

The narrowed guard is **strictly stronger** than what it replaces, which is what settles it against
simply keeping the old one alive with exceptions. Every entry in `SEAM_ASYMMETRIES` excused a
missing *files* side, so nothing that passed before fails now; and the door the map left open —
declaring away a missing **Postgres** side, the direction its own type called *"a production outage
with a date on it"* — is shut. `SEAM_ASYMMETRIES` and its type are deleted from
`src/store/live.ts`, with a note in their place saying why they are not
coming back. The `notMigrated` check survives untouched: a `pgFooStore` whose every method refuses
is the same 501 by a longer route.

Watched red before being believed: making `sideOf` stop recognising the `pg` prefix reddened three
cases and named the seams. Nine tests became five; the four that went existed only to police the
map. [`docs/project/database.md`](../project/database.md) § the seam rule was rewritten to match,
because it described the retired mechanism as current.

#### G5 landed — the last three modules, and the paths that outlived them, 2026-09-05

`src/store/artifacts-fs.ts` (738 lines), `src/store/data-root.ts` (219) and `src/job-scope.ts` (59)
are gone, and with them four things in `src/pipeline.ts` that had no caller left in `src/`:
`PipelineStep.outputs(ctx): string[]` and its fifteen implementations, `StepContext.dir`,
`StepContext.htmlFile`, `contextPaths(slug)` and `blocksPathFor`. `src/jobs.ts` no longer computes a
directory per step of every job, and no longer opens a job scope.

**The load-bearing claim was proved before anything was deleted, not after.** The group's whole
premise is that nothing consumes the value of `contextPaths`. So it was made to return
`/nonexistent/g5-poison` and ten pipeline, job and session suites were run against it —
`acquire-extract-blocks-end-to-end`, `jobs-commit-path`, `store-pg-session`, `pg-session-exact-base`,
`claim-session-postgres`, `upload-acquire`, `store-session-isolation`, `a-claim-that-lost-its-draft`,
`a-long-pdf-is-refused-before-it-is-stored`, `billing-settlement`. **86 tests, all green.** That is a
stronger statement than the greps that preceded it, because it covers the paths nothing names.

The docstring at `pipeline.ts:672` claiming `assertProduced` iterates `outputs` was stale and is
corrected: it has iterated `produces` through the store since 2026-08-26.

**`runInJob` went too, and the accident that produced it is kept.** `src/job-scope.ts`'s own header
said it existed for `dataRoot()` "and nothing else yet", which stayed true for its whole life. The
wrapper had been written on 2026-08-30 with nothing calling it, so every deployed import failed at
step one in 16ms; the case that stopped that happening twice —
`tests/jobs-walk.test.ts` § *puts the job id in scope for the steps it runs* — is deleted with the
mechanism and a tombstone left where it stood. Its mutation is the sixth of that file's seven, and
the header now says six have a case to be red in.

##### The four judgement calls, and what was decided

**1. `assertScratchUntouched` — re-expressed, all eleven call sites kept.**
[`store-migration-registry.ts`](../../tests/store-migration-registry.ts) had said in advance that
these assertions are load-bearing and must be re-expressed rather than dropped, and it was right.
The old form pointed `SPIDERYARN_DATA_ROOT` at a `mkdtemp` root per claim and asserted `readdir`
came back `[]`. The new form is `assertNothingOnDisk(slug)`: `data/<slug>/` and
`output/<slug>.html` under the **repository root** must not exist. It is stronger in one direction —
the temp root only ever proved that nothing was written *to the root it had pinned*, while the
repository root is where the deleted `dataRoot()` resolved on a laptop and where a rebuilt
`path.resolve(import.meta.dirname, "..", "..")` lands, which is the exact bug `data-root.ts` was
written against. It is weaker in another: a store rooted somewhere else entirely would escape it,
and nothing reads an override any more, so there is no third place for it to be.

**Watched red on purpose.** `data/claim-session-pg-ingest/arc.json` was planted by hand and case 1
failed with `the ingest wrote the article to a disk: expected [ Array(1) ] to deeply equal []`; the
directory was removed and it went green again. 11 of 11 in the file.

**2. `store-pg-session` § *decides what to skip from the draft, not from the files on disk* —
deleted, and the deletion is the point.** Its control was
`expect(await onDisk.has(slug, "arc", ["arc"])).toBe(true)` through a `createFsArtifactStore`, and
its own comment refused the case without one: *"a test where the files were not actually there would
pass with `session.reads` swapped for anything at all"*. There is no store that can read a directory
now, so there is **no control**, and keeping the case would leave exactly the vacuous test its own
comment forbids — it would pass against a system with no disk concept, which is the system we have.
Its surviving halves have homes: *not skipped when the draft lacks the artefact* is case 7's first
request, and *the run phase reads the draft* is case 1's `seen.sawArc` asserted positively.

**A third case of the same shape was found that the brief did not name**:
`tests/tweets.test.ts` § *reads the store, not the directory the context happens to name*, which
wrote a current `tweets.json` and `blocks.json` to a real directory, pointed `ctx.dir` at it, and
asserted `stepIsDone` still said *not done*. Same reasoning, same verdict, same tombstone. With it
went that file's `tempArticleDir()` and `ctxAt(dir)`, which is now `ctxFor()`.

**3. `store-artefacts-pg` § *cover the same (step, kind) pairs* — deleted, and nothing real is
lost.** It held `keysOf(STORAGE)` against `keysOf(PATHS)`: two *derived* maps. Its sibling holds
`STORAGE` against `STEPS[step].produces`, which is where a step actually declares what it makes —
strictly the better oracle, and it catches one thing the pair could not (a `PATHS` entry no step
produces was invisible to a comparison of the two).

**4. `store-artefact-manifest` — repointed at the committed corpus, deliberately.** Two of its five
tests read the gitignored `data/`, on the argument that a laptop's own runs are where a brand-new
artefact filename first appears — a *discovery canary*, and it caught `assets.json` and
`quotes.json` that way. That argument died with the filesystem store: **nothing writes an article
into `data/` any more**, so what is there is whatever `npm run worktree:setup` last copied out of
the corpus, and the verdict would have passed or failed on whether somebody had run that script.
That is [260902c](../postmortems/260902c-a-test-whose-evidence-was-one-laptop.md) from the other
direction — there the evidence was one laptop's file, here it would be one laptop's absence. All
three scans read the commit now. **What it costs, said plainly:** a new artefact is noticed when
somebody commits an example of it rather than when a laptop first writes one, which is one step
later; the file's header already instructs that commit, and there is no earlier moment left. 5 of 5.

##### What died with no home, named rather than waved away

- **`tests/data-root.test.ts` entire, 11 cases.** Every one was `chooseDataRoot`, `findRepoRoot`,
  `dataRoot` or `fsLocations`. Its registry entry predicted this exactly — *"its `/var` and
  warm-`/tmp` arguments have nowhere to go once no path is computed at all"*. The one worth naming
  is *refuses an id that could climb out of the scratch directory*: `segment()` refused `..`,
  `a/b`, `""` and `.` as a job id, and it was the **only** guard on a job id in the repository.
  Checked before letting it go: **no job id is concatenated into a path anywhere in `src/`**, so
  the property has ceased to exist rather than lost its coverage. Slugs are a different question and
  `assertSlug` still answers it.
- **`tests/step-context-paths.test.ts` entire, 4 cases — a file that lived one day.** G3 created it
  because `jobs-fs-adapter`'s header asked that whoever deletes the job store must not also delete
  that block; this group is the "whoever removes `StepContext.dir`" its own header named. Its three
  path assertions died with `outputs`. **Its one portable claim went where it said it would**:
  *a step must declare every artefact it writes* is
  `tests/store-artefacts-pg.test.ts` § *has both of extract's and all three of hierarchy's*, and the
  counts are the point — deleting `labels` from `hierarchy.produces` **and** from `STORAGE` leaves
  the map assertion green while `hierarchy` calls itself finished with a tree and no labels. Its
  fourth case went with it as § *is not done when the store holds nothing*.
- **`blocks-baseline` § *refuses when stage 4's copy is over the size this store can read*.** A
  decoder ceiling is a property of reading bytes off a disk; Postgres has no equivalent. The
  store-agnostic half — *unusable is not absent* — survives in the neighbouring case, driven by
  `plant`.
- **`stage2c-raw-bytes` § *writes a raw.json the filesystem artefact store reads back as the
  manifest*.** It held two constants in two modules against each other and one of them is gone.
  Named in advance by the registry as the one thing in that file that dies with the adapter.
- **`block-roles` § *survives the filesystem artefact store, field for field*.** Converted to
  `memoryArtefacts()` first, then reverted and deleted: the registry entry written earlier the same
  day argues that a memory fake makes it `toEqual` against the object it just put in, so the case
  **cannot fail**. A case that cannot fail is worse than the reach it removes. The claim lives in
  `tests/store-block-roles-pg.test.ts`, through the store production actually writes.
- **`artefact-copy` § *copies nothing the reader owns* is weaker than it was**, and this is the one
  weakening. It asserted four reader-state files were absent from the destination *directory*; there
  is no directory and no way to ask a store for a file it was never given a name for. It is now
  *has no kind for anything the reader owns* — no step's `produces` names any of the five — which is
  the only way the old case could have gone red, but a narrower guard.
- **`pipeline-artifact-store` § *has a path for every kind any step declares, and no orphans*,
  § *keeps the two blocks.json files apart* and § *puts each kind where the table says the real file
  is*.** All three are `PATHS`/`pathFor` against literal paths — the independent half of a round trip
  whose other half is now a `Map`.
- **`pipeline-artifact-store` § *reads null and says nothing about what the file contained*.**
  Nothing decodes text into an artefact any more. Its control — that V8 really does quote the input
  in a `JSON.parse` message — moved into the surviving `parseJsonFrom` case, which was otherwise
  assertable-vacuously.
- **The decoder's size ceiling, as a rule.** `DECODERS` gave each kind 4, 16 or 32 MiB and refused
  what `read` could not read back; Postgres has none, and `whyUnusable` is shape only. The only
  bound left in the repository is `MAX_BYTES` in `tests/helpers/fixture-artefacts.ts`, which guards
  the fixture reader and says out loud that it is not the pipeline's ceiling.

##### The finding worth more than the deletions

**Two `blocks` cases would have asserted the opposite of the truth if they had been ported
mechanically**, and only measuring caught it. `not done once a re-extraction has wiped the ids out
of the HTML` and `not done when the HTML carries only some of the ids` were **pure filesystem
aliasing**: on disk, `extract/extractedHtml` and `blocks/stampedHtml` were one `output/<slug>.html`,
so wiping the ids clobbered both, and `blocksMatchTheirHtml` went red. Under two columns it does
not. `blocksMatchTheirHtml` re-derives with the stored blocks as the baseline, and `splitIntoBlocks`
**matches an id-free document against that baseline and carries the old ids over** — measured
2026-09-05: `["spya-aaaaaa","spya-bbbbbb"]` back, and a byte-identical document. Ported unchanged,
both cases would have gone green while asserting a falsehood about
[block-ids.md](../project/block-ids.md)'s one contract. One was deleted; the other is
*not done once stage 3's document has lost an id its blocks name*, which asks the two-column
question honestly and keeps the block's unique claim that **`extract` is still done**.

**A second `260902c` was found in the same file.** `pipeline-artifact-store` was reading its
round-trip fixtures out of the gitignored `data/writes/…` rather than the committed corpus, and one
block wrote into the real repository's `data/raw-shape/` through `fsLocations("raw-shape")`. Both
are gone: the fixtures come through `requireFixture` now, and nothing in the file touches a disk.

##### One assertion that was never there

`tests/a-claim-that-lost-its-draft.test.ts` carried *"one scratch root for the file: no step here
writes to a disk, and this proves it"* over a `mkdtemp` that **nothing ever read back** — no
`readdir`, no assertion, in any case. It proved nothing, and it cited the file that did. Recorded in
place rather than quietly dropped: a comment claiming an assertion that is not there is this job's
dominant failure, and it was sitting inside a file about a lost draft.

##### The counts

| file | before → after | |
|---|---|---|
| `claim-session-postgres` | 11 → 11 | the eleven assertions re-expressed, not dropped |
| `pipeline-artifact-store` | 75 → 67 | the plan predicted "~18 survive of 54"; it was counting `it()` **sites**, three of which are loops of 7, 11 and 6 |
| `source-store` | 20 → 14 | the filesystem arm; every one has a Postgres counterpart |
| `store-session` | 18 → 18 | |
| `artefact-copy` | 18 → 19 | one row *gained*: `output/writes.html` was both `extract/extractedHtml` and `blocks/stampedHtml`, so a copy that dropped either left the file there |
| `glossary-ideas-baseline` | 33 → 33 | |
| `blocks-baseline` | 25 → 24 | |
| `stage2c-raw-bytes` | 24 → 23 | |
| `block-roles` | 24 → 23 | |
| `store-pg-session` | 18 → 17 | |
| `tweets` | 32 → 31 | |
| `jobs-walk` | 10 → 9 | |
| `store-artefacts-pg` | 71 → 72 | two ported in, one derived-map comparison out |
| `data-root` | 14 → **0** | deleted |
| `step-context-paths` | 4 → **0** | deleted |
| `acquire-extract-blocks-end-to-end`, `upload-acquire`, `a-long-pdf…`, `jobs-commit-path`, `store-session-isolation`, `pg-session-exact-base`, `billing-settlement`, `job-failure`, `sanitize-stale-artefact`, `late-step-on-a-cold-instance`, `a-claim-that-lost-its-draft`, `empty-blocks-keep-their-ids`, `stage-stamp-agreement`, the three step-registrations, `article-cache-call-site`, both `all-skipped-*`, `glossary-delete-then-rebuild`, `retry-is-only-for-a-failed-job`, `store-artefact-manifest` | unchanged | context fields and dead scaffolding removed, no case touched |

**Green, run individually:** the five job/session suites 43 of 43; eighteen more 265 of 265;
`claim-session-postgres` 11 of 11; the five gates 27 of 27 plus `one-store-only`, `public-imports`
and `store-seams-have-two-implementations`. `npx tsx scripts/typecheck.ts` is clean on `tsconfig.json`
and on every file this group touched.

##### The instrument now watches nothing condemned

`CONDEMNED` (vitest.witness.config.ts), `TARGETS` (scripts/store-migration-candidates.ts) and
`INSTRUMENTED` (scripts/store-migration-witness.ts) are down to `copy-artefacts` alone — which
**survives**, since stage D gave it a store-agnostic `ArtifactSource`. So there is nothing left for
the witness to witness, which is the state `tsconfig.json` predicted in prose. It is kept rather
than retired here so stage H has a working instrument, and goes with the tombstone in stage I.
`tests/data-root.test.ts` left `POSITIVE_CONTROLS`, `artefact-copy` kept the two sites that name the
module it controls, and the read-only blind spot (`store-artefacts-pg` reading `PATHS`) is retired
by the disappearance of the import rather than by the class being solved — `KNOWN_BLIND_SPOTS` still
records the class.

**Two floors in `store-migration-registry.test.ts` fell from 100 to 20**, and the number is measured
rather than argued: 42 files reach `copy-artefacts`, 41 through `tests/helpers/load-article.ts` and
one directly, none type-only. They are controls against a walk that parsed nothing, and that is
still what they defend.

##### And the gate that goes red for none of these reasons

`tests/doc-links.test.ts` again — **42 dead links across 25 files**, all of them
`](../../src/store/artifacts-fs.ts)` or `data-root.ts`. Each is now a plain code span with its
sentence intact, which is the convention G3 set.

#### G6 landed — the reader-state modules' filesystem halves, 2026-09-05

Nine mixed modules, each holding pure domain logic the Postgres store calls *and* a file-reading
half that `src/store/fs.ts` was the only thing wiring in. **1,968 lines of `src/` went; every module
but one is still there**, because deleting the files would have taken `withCriterion`, `withRun`,
`withTurn`, `CommentIdTaken` and the rest with them.

| module | lines | what went | what stayed |
|---|---|---|---|
| `src/comments.ts` | 759 → 207 | every writer, the queue, the temp-and-rename | the vocabulary (`NewComment`, `MarkPatch`, `AnswerPatch`, both refusals, `COMMENT_SWEPT`) and `loadComments` |
| `src/chat.ts` | 898 → 726 | `save`, `update`, `renameThread`, `deleteThread`, `beginTurn`, `finishTurn`, `retryTurn` | every `with*` decision, `requireTail`, `titleFrom`, `ChatConflict`, `CHAT_SWEPT`, `loadThreads` |
| `src/searches.ts` | 564 → 268 | `beginRun`, `finishRun`, `deleteRun`, `recolourRun`, `readSearches`, `currentSourceHash`, `withColour` | `MAX_RUNS`, `withRun`, the colour rules, `loadRuns` |
| `src/profile.ts` | 492 → 276 | the whole store section, and `SPIDERYARN_READER_FILE` with it | render, normalise, hash, `profileIsStale`, `PROFILE_RULES` |
| `src/glossary-lookups.ts` | 167 → 109 | `saveLookup` and the read/write split behind it | `LookupsByTerm`, `loadLookups` |
| `src/referee-claims-store.ts` | 177 → **deleted** | all of it | `CLAIMS_SWEPT` moved to `src/store/pg-referee-claims.ts`, on `SEARCH_SWEPT`'s precedent |
| `src/referee-criteria-store.ts` | 303 → 131 | every writer, and `withColour` — `pg-referee-criteria.ts` never imported it | `withCriterion`, `CRITERION_SWEPT` |
| `src/shelf.ts` | 238 → 93 | `patchShelf`, `setArchived`, `setTitle`, `recordOpen` | `MAX_TITLE_CHARS`, `loadShelf` |
| `src/library-search.ts` | 291 → 111 | `searchLibrary` and the `data/` walk | `parseQuery`, `fold` — no imports left at all |

##### The freeze was wrong about three things, and the third is the one that matters

1. **`MAX_TITLE_CHARS` is not dead.** G4 recorded `src/shelf.ts` as "every export but
   `MAX_TITLE_CHARS`" — correct — and the brief written from it inverted the exception.
   `src/store/pg-shelf.ts:26` imports it and states the cap from it.
2. **`searchLibrary` had a caller.** `evals/embedding-retrieval.ts:910` reached it through a
   **string-built dynamic import**, which is invisible to an import-statement grep and was the one
   thing keeping the `data/` walk alive. It is repaired rather than deleted — see below.
3. **The five filesystem *readers* are not dead, and cannot go in this group.**
   `tests/helpers/seed-reader-state.ts` reads a fixture's `shelf.json`, `comments.json`,
   `chat.json`, `searches.json` and `glossary-lookups.json` through `loadShelf`, `loadComments`,
   `loadThreads`, `loadRuns` and `loadLookups` to seed the columns Postgres keeps, and four live
   suites stand on it: `store-parity`, `store-roundtrip`, `chat-anchor` and
   `helpers-seed-reader-state`. So each of those five modules keeps a `ROOT`, a `fileFor` and one
   read, and each now says in its own header that it is a fixture reader rather than a store.

**Removing those five is its own piece of work.** The seeder's docstring names the reason: each of
the five modules holds its own root at module scope and none of them can be told where to look,
which is why `store-parity` and `store-roundtrip` read a developer's `data/` rather than the
committed corpus. Its proposed fix — `dataRoot()` in `src/store/data-root.ts` — is **no longer
available**: that module was deleted in the same day's work, and the seeder's docstring is stale
about it. What is left is the shape `tests/helpers/load-article.ts` already uses: take a `root` and
default it. The cheapest version is to move the five reads into the seeder itself, which is their
only consumer and which is honest about being a fixture reader; the modules then lose their last
import of `node:fs`. Doing it here would have been a change to fixture semantics for four Postgres
suites, in the same commit as nine deletions.

##### The eval's literal baseline was measuring the wrong corpus

`evals/embedding-retrieval.ts` compares each embedding arm against "what the search we already ship
would have found". It called `searchLibrary`, which walked the developer's own `data/` plus
`example/` — while every arm is scored over `tests/fixtures/data-root/data/` plus `example/`. **The
baseline and the arms were reading different corpora**, and on a fresh clone the baseline searched
`example/` alone. It is now the same AND-scan written out over the `passages` the eval already
loaded, importing `parseQuery` and `fold` from `src/library-search.ts` — the two parts of that
module that were never about files. Repointing it at `pgLibrarySearch` was rejected: that stems, ORs
and drops stop words, which is not the floor this column is asking about. **The number moves**, and
`evals/results/embedding-retrieval-2026-08-26.md` is not comparable with a later run.

##### `tests/parse-json.test.ts` again — and the rule it should have carried the first time

It drives four store loaders that log a parse failure and rethrow, and its claim is about what
reaches a **log line**, so it needs a caller that logs. Its fourth driver changed twice in one day:
`src/api.ts`'s `loadArticle` → `loadClaimsRun` (G4) → `loadShelf` (here), because `loadClaimsRun`
was deleted hours after it was chosen. The file now says, in its own header, that a later group
deleting a driver must repoint the scenario at another live caller that logs — not drop the case,
and not demote it to a unit test of `parseJsonFrom`. 59 cases, unchanged in number.

##### What was ported, and where it now lives

| from | to | the claim |
|---|---|---|
| `shelf.test.ts` ×7 | `store-shelf-pg` § *the shelf's writes* | the title cap, blank-clears-the-title, and all four `purpose` rules — stored, cleared on blank, line endings settled, cap refused, absent key left alone — plus `lastOpenedAt`. `pg-shelf.ts` re-states every one of them and **nothing was driving any of them** |
| `searches.test.ts` ×2 | `store-searches-pg` | a stored failure read back still answers `worthRetrying` correctly — the round trip that stops a decorated error string turning every permanent failure back into a Retry button |
| `comments.test.ts` ×1 | `store-comments` | a **malformed** client id is re-minted. The neighbouring case only sends an *absent* id, which the same line satisfies with the `isSpideryarnId` check deleted |
| `referee-criteria-store.test.ts` ×1 | its own Postgres block | clearing a colour removes the key rather than storing `null` — `exactOptionalPropertyTypes` makes those different values on the wire |
| `library-search.test.ts` → rewritten | itself | `parseQuery` and `fold` had **no direct test anywhere**: the three `fold` cases in `library-hits.test.ts` are the *client's* copy in `src/web/library-hits.ts`. Nine cases now cover the folding, the phrase quoting and the length-non-preservation hazard |

##### What was dropped, named rather than waved away

- **`shelf.test.ts`'s *"survives a re-extraction, like the title"***. On disk the hazard was exact —
  stage 2 rewrites `meta.json` on every run, so a title stored there is silently undone weeks later.
  In Postgres the override is a column on `articles` and an extraction writes a *revision*, so the
  accident cannot be spelled. The nearest live guard is `store-shelf-pg` § *renames, and the reading
  view agrees with the card*. A full equivalent has to publish a second revision and nothing in that
  suite builds one.
- **`searches.test.ts`'s four `currentSourceHash` cases** — fingerprinting the `example/` fixture
  under its own slug and no other, ignoring a directory that is not a whole article, `readSearches`
  handing the panel a list and a hash in one read, and a retried run being re-answered against
  today's article. All four are about a candidate-directory walk that no longer exists.
- **`comments.test.ts`'s *"patches one comment without disturbing the others"***. In SQL the `WHERE`
  on the id is the whole of it.
- **`glossary-lookups.test.ts`'s *"refuses to write over a file it could not read"*** and *"leaves no
  temp file behind"*, and every suite's *"does not lose a write when two happen at once"*. These
  were properties of a whole-file rewrite behind a per-process queue; SQL abolishes the hazard
  rather than re-homing the claim, and each surviving suite says so where the case used to be.

`comment-sweep`'s whole filesystem block went with **all four of its claims already covered** on the
Postgres side, which is the one clean deletion in the group.

##### Counts

`shelf` 14 → 4, `glossary-lookups` 8 → 4, `library-search` 13 → 9, `searches` 37 → 13,
`comments` 23 → 7, `comment-sweep` 15 → 11, `referee-criteria-store` 13 → 11.
`store-shelf-pg` 23 → 30, `store-searches-pg` 25 → 27, `store-comments` 22 → 23.
`profile` and `chat` were untouched — every case in both was already about the domain half, which is
the measurement that says the split this group made was the split those files already had.

**Watched red before being believed**, four times: swapping `loadShelf`'s `parseJsonFrom` for a bare
`JSON.parse` reddened two cases in `parse-json` with `ZQSHELFAAA` quoted twice over, in the message
*and* in the stack — the doubling that file exists to name; `MIN_TERM` 2 → 1 reddened the
one-character-terms case; dropping the purpose cap and the `normaliseProfileText` call in
`pg-shelf.ts` reddened exactly the two ported cases that assert them; and deleting `isSpideryarnId`
from `pg-comments.ts`'s id guard reddened only the newly-ported malformed-id case, which is what
says it was a real gap rather than a duplicate.

**One thing worth knowing for stage H.** `knip` reports `loadThreads` as an unused export and is
right in spirit: it is the one of the five readers whose only consumer is a test *helper* rather than
a `.test.ts`. That is the shape the other four will take when their own suites stop importing them.

#### Stage G's review — one round, three findings, all accepted, 2026-09-05

Prompt: [`260903f-stage-g-code-review-prompt.md`](260903f-stage-g-code-review-prompt.md).
Answer: [`260903f-stage-g-code-review-sol.md`](260903f-stage-g-code-review-sol.md). Candidate named
as four SHAs rather than a range, because `dev` is shared and a merge-base range that evening
covered twenty-seven other agents' commits.

**No P0 or P1.** Sol independently confirmed the three *ceased to exist* claims, found no third form
of string-built import, and checked that each reader-state split kept the half Postgres uses. Three
findings, and none was overruled.

##### F1 (P2) — the narrowed seam guard could not see a seam with **no** implementation

`seams()` is implementations ∩ contracts, so a contract wired through a selector in
`src/store/index.ts` with no adapter at all never enters `SEAMS`, and the Postgres check cannot look
at what is not there. Sol proved it by mutation — a planted `ReviewMissingStore` with a selector and
no adapter passed all five tests — and **I reproduced it before fixing it**, which is the rule.

**This falsifies a claim in the commit message.** I wrote that the narrowing was *strictly
stronger*. It is strictly stronger **for the seams it discovers**, and that qualifier is doing more
work than I gave it credit for: with two stores the Claims outage arrived as *has a filesystem side,
missing Postgres*, which is discoverable; with one store the same outage arrives as *contract,
selector, nothing*, which is not. The old guard had the identical hole and it did not matter, because
a half-built seam still had a half to be found by. **Removing the other store is what opened it** —
the hazard was created by the change, not merely uncovered by it, and that is the kind of thing a
cross-family reviewer is for.

The fix derives a second candidate set from the **selectors**:
`export const commentStore: CommentStore = guarded(…)` says *the app calls this contract*, which is
the claim that matters, and a data shape never has a selector — so it closes the hole without
flagging `RawSource`, `SweepOptions` and `Turn`, which is why the set was built from implementations
in the first place. Still derived, never listed. A floor case asserts the selector scan found more
than eight, because an empty list is what a parser that has stopped matching produces and it would
satisfy the new check silently.

##### F2 (P2) — a suite was deleted with nothing recording what went with it

`tests/store-reader-state-parity.test.ts` went in `86a4ef7c` and **the plan does not name it**. That
is exactly the failure this stage's own freeze defines — *"a file deleted with no such line is the
failure mode, and no gate can see it"* — committed by the person who wrote the sentence. It is worth
recording plainly rather than fixing quietly: the rule was written down, the mechanism to enforce it
was a human reading a diff, and the human was me.

It held three sequential walks. The comparison in them died with the second store; the **sequence**
did not, and none of the 61 cases in `store-chat-pg` and `store-searches-pg` walks a state machine —
they test each transition from a fresh state, which cannot see state leaking between them.

Two are ported, one is not. The chat walk (begin → finish → begin → retry → edit → rename) and the
search walk (begin → finish → fail → retry → finish → delete) are now single cases in the surviving
Postgres suites, each comparison replaced by an assertion about what the store should actually hold
at that step. The glossary walk is not ported, checked rather than assumed:
`tests/store-lookups-pg.test.ts:70` and `:95` already cover both halves of it.

**The port recovered coverage rather than performing it, and the evidence is that each break
reddened only the new case.** Deleting `error: null` from `pg-chat.ts` § `retry` failed *"the failed
attempt's error survived the retry"* and nothing else; dropping `eq(searchRuns.id, runId)` from
`pg-searches.ts` § `remove` failed the new case and nothing else. Both properties were genuinely
uncovered before.

##### F3 (P3 as filed, and under-graded) — docs describing the deleted backend as live

Sol filed three stale doc passages as non-behavioural. Two are.
**`example/README.md` was not**: it promised that *"a fresh clone that has never run the pipeline
still has the committed `example/` fixture to open"*, and that was `src/api.ts` falling back to
`example/` on a read. There is no filesystem reader, so **a documented developer affordance changed**
— which is a fact about the product, not a citation. The replacement exists and is now what the docs
say: `npm run setup` runs `db:seed-dev`, which loads the committed corpus into Postgres.

Losing that fallback is the point rather than a casualty. A reader who asked for a slug and was
served the fixture's text under their own address is the bug the old note in that README describes;
narrowing it to one slug was the 2026-08-30 fix, and it is now structurally impossible.

`docs/project/library.md` § the seam table was the sharpest of the rest — it named the deleted file
as **"the Postgres seam"**, which would have sent the next reader to a file that does not exist to
learn about the store that does.

### H — tighten the contracts the filesystem store was weakening

`attempt` becomes required in comments, search and referee. **Chat needs the return type split
first**, because `appendSpoken` legitimately has no attempt.

### I — retire the tombstone

**A separate, post-deployment stage**, once Greg has removed the variable from Preview and
Production. The first draft said "keep it about a week" and also declared completion only when the
identifier is gone; those cannot both be true in one stage.

**What tells us I can start is the sensor stage F added, not a calendar.** While the variable is
still set on a deployment, `/api/health` carries a `retired` field naming it and `npm run deploy`
prints a *"still to remove"* line on the machine that holds the Vercel credential (§ *The sensor that
retires the tombstone*). That line is what tells somebody **to go and look**, and no agent on this
box needs a Vercel credential to read it.

**It is not what confirms the removal, and this section said it was.** The field's disappearance
cannot be the gate: it is baked at build time, so it can only go quiet after a redeploy, and that
redeploy carries stage I, which deletes the field. The gate is the `vercel env rm` results
themselves — see the header, and F2 of the round-one review. Stage I then deletes `RETIRED` and `retiredNotes` along with the tombstone,
and the guard's exemption for `src/vercel-health.ts` with them; the staleness case in
`one-store-only.test.ts` reddens if an exemption is left behind, so that cleanup cannot be forgotten
quietly.

Final grep must cover `src/`, `tests/`, `scripts/`, **`evals/`, `vite.config.ts`, `package.json`,
`.env.example` and `AGENTS.md`** — not only the source paths.

#### I landed — 2026-09-06

Commit `219c4bc1`. 44 files, 1297 insertions, 1274 deletions; three files deleted
(`src/store/live.ts`, `tests/store-selection.test.ts`, `tests/store-flag-refused-at-boot.test.ts`).

**What went.** The tombstone validator and its two suites; the sensor stage F added — `RETIRED`,
`retiredStillSet()` and the `retired` field in `src/vercel-health.ts`, `retiredNotes()` in
`scripts/deploy-checks.ts`, and the *"still to remove"* line in `scripts/deploy.ts`; the
`src/vercel-health.ts` exemption in the guard's allowlist, which is now empty; the exported
`inheritedEnv()` in `src/env.ts`, whose only caller was the tombstone; and a whole reporting
dimension in `scripts/store-migration-candidates.ts` — `FLAG_LEAF`, `flagReaders`, the
`flag-selection-only` bucket, `livePath`, `reachingFlagLeaf` — which the deleted file left
permanently zero while still naming it.

**`src/store/live.ts` went too, which the first draft of the stage did not plan.** It was to survive
holding `notMigratedError` / `notMigrated`, the 501 for a write with no Postgres implementation. GPT
Sol's answer to the question was to delete it: both exports had zero callers, every refusal it stood
behind now has a Postgres implementation, and an orphan whose header calls itself *"the one way to
refuse"* misleads more than an absence does. Verified by grep before deleting — every remaining
mention of the name in the tree is prose.

##### The one real regression, and it was invisible to the whole suite

**Deleting the tombstone deleted an import-time `.env.local` load that nothing had noticed was
load-bearing.** `src/db/client.ts` opened with `import "../store/live.js"`, and that module called
`loadEnvLocal()` as it evaluated. `src/store/index.ts` checks Supabase credentials in its **module
body**, and ESM evaluates every static import before the importing module's own statements — so an
entry point that imports the store statically and calls `loadEnvLocal()` afterwards is calling it
too late. `scripts/live-spike.ts`, `evals/deepen/run.ts` and `evals/cost/interactions.ts` all died
at boot with *"the store is Postgres, but there is no Supabase Storage configured"*.

GPT Sol found it and reproduced it; it was then reproduced here independently before anything was
touched. **The fix is one statement at module scope in `src/db/client.ts`** — `loadEnvLocal();` —
and the reasoning for putting it there rather than beside the check that needs it is the same
reasoning that put the tombstone's import there during stage F: `src/jobs.ts`,
`src/upload-records.ts` and `src/store/ai-calls.ts` all reach Postgres without crossing the wiring
hub, so the hub is one door of several and `src/db/client.ts` is the boundary all of them cross.
**The rule outlived the thing it was invented for**: a side-effecting import belongs at the narrowest
boundary everything must cross, not at the most obvious front door — a front door is whichever door
you happened to walk through.

**Why no test saw it.** The unit lane sets `VITEST`, and `VITEST` is exactly what makes
`src/store/index.ts` skip the credential check. The lane that would run the guard is the lane that
cannot execute the failure. So the guard added in `tests/one-store-only.test.ts` is a **source-shape
assertion**: `src/db/client.ts` must contain `loadEnvLocal();` at column zero — anchored there
deliberately, because the lazy call inside `databaseUrl()` is indented and runs far too late to
help. Both new assertions were mutation-tested: removing the module-scope call turned the guard red
*and* reproduced the real boot failure, and planting a bogus allowlist entry turned the emptiness
assertion red.

##### The confirmation criterion this document had was circular

**This is worth recording as a mistake rather than a correction.** The header said for about an hour
that what would confirm the removal was *"the first production deploy after the removal coming back
with no `retired` field"*. The next production deploy contains stage I, which deletes the field
unconditionally — so its absence would have proved nothing whatever about the deployed environment.
A check that reports success no matter what the world is doing is
[silent-success.md](../reusable/silent-success.md) wearing this plan's own colours, and it was
written by the person who had just finished building the sensor and understood exactly how it
worked. GPT Sol caught it (F2). The evidence is the two `vercel env rm` results themselves. **The
sensor's job was to say when to look, and it did that; nothing that deletes itself in the same
commit can confirm its own retirement.**

##### `appears` was the wrong word, and the criterion now says `read`

The stage's own completion test said the identifier *appears* nowhere in the searched paths. It
appears in perhaps seventy comments that correctly explain, in the past tense, what it used to
decide, and deleting those would be rewriting history to satisfy a grep. **What must not exist is an
executable read**, and `tests/one-store-only.test.ts` is what asserts it, over four reader shapes
with an allowlist that is now empty. Sol's F3 is what forced the distinction.

##### Stage I's review — two rounds, both refused, five findings

Prompts and verdicts:
[round one](260903f-stage-i-review-prompt.md) / [its answer](260903f-stage-i-review-sol.md),
[round two](260903f-stage-i-round-two-review-prompt.md) /
[its answer](260903f-stage-i-round-two-review-sol.md).

| | | grade | outcome |
|---|---|---|---|
| F1 | tombstone deletion removed import-time `.env.local` loading | P1 | fixed, guarded twice, mutation-tested |
| F2 | the plan's confirmation criterion was circular | P2 | struck out in three places — the header, § I, and `deployment.md` |
| F3 | present-tense claims about the tombstone are now false | P3 | swept, ~14 sites |
| F4 | deleting `src/store/live.ts` broke ten documentation links and reddened `npm test` | P1 | unlinked; `doc-links` back to 14/14 |
| F5 | the guard does not scan `.env.example` or `AGENTS.md`, which the plan claims it does | P2 | both added to the collector |

**Both rounds refused, and the second refusal is the one worth keeping.** Round one found the
regression; round two found that the change fixing it had reddened `npm test` in a way neither the
author nor the implementer had run. F4 was not subtle — a whole test failing outright — and it was
still missed, because the work had been checked by running the tests that were *about* it. **The
gate is the suite, not the suite's relevant-looking subset.**

**Sol's two answers to the questions put to it**, both taken:

- *Keep the narrow `notMigrated` tripwire; do not generalise it.* An "every method only throws" AST
  rule would be brittle while implying broader semantic coverage than it can deliver.
- *A child-process outcome test is possible and preferable* to the source-shape assertion guarding
  F1, and **column zero does not prove module scope**. Both were built.

##### What now guards F1, and the thing that was measured rather than assumed

Two checks, and neither replaces the other. `tests/one-store-only.test.ts` parses
`src/db/client.ts` and asserts `loadEnvLocal()` is a statement of `Program.body` — a claim about the
source, which fails fast and names the line. It carries its own discriminator control: there is a
*second* `loadEnvLocal()` inside `databaseUrl()`, so a predicate that could not tell scope apart
would count two and pass with the module-scope line deleted.

[`tests/store-boots-without-inherited-credentials.test.ts`](../../tests/store-boots-without-inherited-credentials.test.ts)
is the outcome: a `tsx` child with `NODE_ENV=production`, no `VITEST`, and the Supabase credentials
deleted from its environment, which must import the store and print a marker. **With a negative
control that must die** — otherwise a boot check quietly switched off looks exactly like a working
fix, which is this stage's own subject arriving a second time.

**And then a control on that control, because the obvious way to withhold a credential does not
work.** The first attempt set the three names to `""`, and the child booted anyway.
`applyEnvFile` skips a name only when its current value differs from the snapshot `INHERITED` took
at its own module load — and a child's snapshot is taken *after* it inherits, so an empty string it
was born with reads as *"the shell said so"* and `.env.local` wins. The negative control uses
`SPIDERYARN_ENV_PINNED` instead, which is a string in the environment rather than a comparison
against a snapshot and therefore survives `spawn`. The empty-string run is kept as a fourth case,
so that if the precedence rule ever changes it is *that* which goes red, rather than the negative
control silently starting to pass for the wrong reason.

**One cost, recorded because it is a change to the landing contract**: this is the only test in the
repo that requires `.env.local` to exist on disk, and it fails loudly rather than skipping when it
does not. That is deliberate — a skip here is a green tick over the thing the test exists to prove —
but it means `npm test` now needs the file on any box, not just a database.

##### One check in the tree is now a tripwire rather than a guard

`callsNotMigrated` in `tests/store-seams-have-two-implementations.test.ts` matches a call to an
identifier literally spelled `notMigrated` inside a `pg*Store` initializer. Nothing defines that name
any more, so it cannot fire on today's source; it can only fire if somebody revives the helper *and*
keeps the spelling. It is kept, because that is a real if narrow scenario and the file's own header
points at git history for the shape — but the file now says so in as many words, so it is never
again read as evidence that no seam refuses. **The load-bearing case is its neighbour**,
`"has a Postgres implementation for every seam"`, which is structural rather than name-based.

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

## Tripped over here, and where each one went

Not part of deleting the store. Found while running this job's gates over and over, which is the
only reason they were seen at all — an intermittent needs a lot of runs before it is more than a
rumour. **Recorded here because chat is not memory**: both of these were flagged in conversation
first, and a grep of this file for either would have come back empty, which is the same failure
stage G's review called F2.

### The gate that fails with no failing test — `nuqs` after jsdom teardown

Seen three times during this job: the `unit` project reports every test passing and the process
still exits non-zero, on an unhandled `ReferenceError: location is not defined` attributed to
`tests/conversation-band-send-new.test.tsx`. **Zero failing tests and a red gate is the worst
diagnostic shape there is** — there is nothing to open.

The file arrived whole in `748f1161` (2026-08-28), so the defect had been in the tree nine days.
Reproduced, root-caused and fixed on 2026-09-06 — **and it was two files, not one**: measuring what
was still queued when each jsdom file ended found a second, `tests/glossary-band-selection.test.tsx`,
that had never been seen to fail. Everything is in
[260906c-a-url-write-outlived-the-page-that-asked-for-it.md](../postmortems/260906c-a-url-write-outlived-the-page-that-asked-for-it.md),
and the rule it produced is in [testing.md](../project/testing.md).

The other item flagged in the same breath — `tests/a-claim-that-lost-its-draft.test.ts` claiming
*"no step here writes to a disk, and this proves it"* over a `mkdtemp` nothing read back — **was
already fixed in stage G** and recorded in place at the top of that file. It was listed as
outstanding here in error.

## What "done" looks like

`SPIDERYARN_STORE` is **read** nowhere in `src/`, `tests/`, `scripts/`, `evals/`,
`vite.config.ts`, `package.json`, `.env.example` or `AGENTS.md` — `tests/one-store-only.test.ts`
is what asserts it, over four reader shapes with an empty allowlist. **Read, not *appears***, and
that was sharpened on 2026-09-06 after Sol's F3 pointed out the two are not the same claim: the
name still appears in perhaps seventy comments that correctly explain, in the past tense, what it
used to decide. Deleting those would be rewriting history to satisfy a grep, which is the opposite
of what they are for. What must not exist is an executable read.

**`.env.example` and `AGENTS.md` were in that list before the test read either of them**, from
stage F until 2026-09-06 — a criterion naming files no check opened, which is the same sentence
promising more than its code can fail on that this stage kept tripping over. Sol'"'"'s F5 found it and
both were added to the collector, read raw rather than comment-stripped. The sentence above is now
true rather than aspirational.

Also: `grep -rn 'STORE ===' src/ vite.config.ts` is empty;
there is one `ArtifactStore` implementation; the stage CLIs still run standalone, against Postgres;
and **`npm test` fails loudly on a machine with no database, with somebody having watched it do so**.
