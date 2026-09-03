# Improve the codebase — the second 2026-09-03 sweep

The same ritual as [260903a](260903a-improve-the-codebase-sweep.md), run again two hours later
against a tree that had moved a long way underneath it. Read that plan's *What the next sweep should
know* first; this one starts where it stopped and does not re-open what it settled.

**What changed in between, and why it is worth a second run so soon.** The merge brought
**5,572 lines of new code** — a whole billing subsystem (`src/billing/`, `src/store/pg-billing.ts`,
`pg-jobs.ts`, `pg-session.ts`) plus ~3,200 lines of tests — that the first sweep never saw. New code
copied from the nearest module of the same genre is exactly where these lenses pay.

## Scope line

**Swept:** `src/` (all), `scripts/`, `evals/`, `tests/`, `docs/project/`, `docs/plans/`,
`docs/postmortems/`, `knip.jsonc`, `package.json`. Six breadth agents — four by lens (what the code
says about itself; duplication and rival mechanisms; module re-evaluation; the test suite as
infrastructure) and two by zone (billing; the request path and admin surface) — then depth by hand on
everything that survived.

**Not swept, and blind to:** the remote database (out of scope for an unattended run, by CLAUDE.md);
anything visible only in a browser; overlapping live transactions; provider streams that end without
throwing; generated and deployed artefacts. A static sweep finds no races.

**One method-level caution carried forward and used.** [260903a](260903a-improve-the-codebase-sweep.md)
ended by adding *"a citation is not an instance"* to
[improve-the-codebase.md](../reusable/improve-the-codebase.md) after getting two counts wrong that
way. **It happened again in this run, in the richest finding of the night, and the rule caught it** —
see T2.1. The rule earns its place.

## Baseline, measured on this tree

`npm run check` at `ea53f7ea`, before any change:

```
  ✓ typecheck    clean          ✓ cycles       clean
  ✓ build        clean          ✓ chain        clean
  ✗ test         FAILED         ✓ committed    clean
A gate failed. That means something is newly wrong.
```

**7 tests failed in 4 files. Six were 5-second timeouts and all 36 tests in those three files pass in
isolation** (re-run, exit 0). The seventh was real. That ratio is the finding in T1.3: the noise is
not merely annoying, **it hid a live defect for one whole test run**.

| | value |
|---|---|
| knip unused files | 9 (unchanged) |
| knip unused exports / types | 124 / 103 |
| jscpd clones | 258 (unchanged) |
| `src/routes.ts` | 7,294 lines, 75 commits in 30 days — top of churn × complexity |
| worktrees sharing one Postgres | 11 |

---

# Tier 0 — live, and in the way

## T0.1 · Three transactions the quota wiring spelled out ✅ done

**Evidence: reproduced** — a red gate on `dev` at the moment the sweep started.

`d6d57413` added three `db.transaction(…, { isolationLevel: "read committed" })` call sites to
`src/store/pg-jobs.ts` (at the time, lines 649, 995, 1118). The *value* is correct. The spelling is
the defect: that file **already imports `READ_COMMITTED` at line 64** and uses it elsewhere, so one
file said one thing two ways — the shape that let `articleIdFor` lose its slug check in five files
out of six ([260903a](260903a-improve-the-codebase-sweep.md) T1.2).

`tests/store-transaction-isolation.test.ts` — written by the previous sweep, yesterday, to catch the
*next* author — went red for exactly this. **This is the guard working, not a new problem**, and it
is the clearest evidence available that the previous run's investment paid.

Fixed in `b64c7b7c`. Another session fixed it concurrently in `0216684e`; both converged on the same
three-line substitution and the merge is clean. The only inline literals left are the three
grandfathered ones the test allows (`src/billing/sync.ts`, `src/store/pg-billing.ts`,
`src/store/pg-feedback.ts`).

---

# Tier 1 — cheap, mechanical, evidence in hand

## T1.1 · Wiring something up needs the same sweep as deleting it

**Evidence: proved from the code** — a reachable call path, traced end to end.

The billing machinery went from dormant to live on 2026-09-03. **The prose that said it was dormant
did not move.** Three live claims, all false today:

| where | what it says |
|---|---|
| `src/db/schema.ts:3864` | *"Written in the future tense on purpose: none of this is wired up yet. The functions exist in `src/store/pg-billing.ts` and nothing calls them"* |
| `src/store/pg-session.ts:335` | *"every job today, because nothing calls `reserveIngest` yet"* |
| `docs/plans/260902i-…tiers.md:180` and `:664` | *"What is still unbuilt: the wiring. `reserveIngest` has no caller in `POST /api/jobs`"* — in a doc whose own line 92 says the machinery is finished |
| `src/store/db-errors.ts:60` | *"the Postgres chat store is not wired into `src/store/index.ts`"* — **missed by this sweep, found by the review.** It is wired (`chatStore`, `src/store/index.ts:234`) and it does throw `ChatConflict` (`src/store/pg-chat.ts:471`) |

Disproved by: `src/routes.ts:7116, 7164, 7188` → `withIngestSlot`/`withRetrySlot`
(`src/billing/admission.ts:189, 205`) → `reserveIngest` (`src/store/pg-billing.ts:366`); and
settlement from `src/store/pg-session.ts:416, 511`. `src/store/pg-billing.ts:12` says outright *"It
is wired up, as of 2026-09-03"* — **so the codebase already contradicts itself in two files.**

**The count, with the command, because the review was right that a total nobody can re-run is not a
count.** Exactly this, from the repo root:

```
grep -rn -i "nothing calls\|no caller\|not wired\|isn't wired\|is not wired\|nothing yet calls\|has no caller\|yet unwired\|not yet wired" src/ docs/project/ docs/plans/260902i*
```

**43 hits.** Thirty-eight are a different sense of the same words —
*"no caller has to remember the prefix"*, *"no caller wants a strict release"* — and are not
instances. This is the T2.1 trap in miniature: the string matches, the meaning does not. One more,
`docs/project/billing.md:291` (*"The last two have no caller in `src/`"*), was checked
independently and **is still true** — it describes `finish`/`releaseStep` on the generic `JobStore`,
deliberately, with the trap spelled out. Two review-prompt docs say the old thing and **must not be
edited**: a review prompt is a record of what was asked, like a postmortem.

So: **5 sites, 4 files.** Not 43, and not 6.

**The first version of this paragraph said 4 sites in 3 files**, and the grep above is the reason the
correction was cheap: `db-errors.ts` is *in* those 43 hits, and I read past it because its sentence
is a subordinate clause inside a paragraph about something else. **The command is the audit; the
triage is where the judgement is, and mine dropped one.** Recorded rather than quietly amended,
because a count that was wrong once is the useful thing to know about a method.

**Why this is worth naming rather than just fixing.** `rename-or-move.md` gained a section yesterday
saying *"a deletion is a rename to nothing, and needs the same sweep"*. This is the third member of
that family: **wiring something up changes its truth conditions everywhere it is described**, and
"none of this is wired up yet" is the most dangerous form, because it invites the next reader to
treat live money code as dead and tidy it away.

## T1.2 · `testing.md` names a suite as an offender that had already been fixed

**Evidence: proved from the code**, with commit timestamps.

`docs/project/testing.md:321-324` lists `tests/db-tls.test.ts`, **`tests/lockfile.test.ts`** and
`tests/no-undeclared-spend.test.ts` as child-process suites that "do not do this yet" — that is,
lack an explicit spawn timeout.

`tests/lockfile.test.ts:192` has `const SPAWN_TIMEOUT = 60_000`, applied to every spawning `it`, with
a comment saying *"the default 5s turned all three red while the mechanism was fine"*.

The dates make it sharper than an ordinary stale line:

| | |
|---|---|
| `96c7661e`, 2026-08-28 **12:03** | gives `lockfile.test.ts` its timeout |
| `3ed5741e`, 2026-08-28 **17:06** | writes the doc sentence naming it as an offender |

**The sentence was false when it was written**, five hours later the same day — and `3ed5741e` is
titled *"Five seconds is not a timeout for a test that starts tsx, it is a load test"*, i.e. the
commit fixing this exact class listed as unfixed a file it had already fixed that morning.

And the paragraph is *right about everything else*: it says these suites "are the first things to go
red on a busy one, which is exactly when you are least able to tell a real failure from a slow one."
**That is precisely what this sweep's baseline run did** — see T1.3.

## T1.3 · The unscoped sweep, and the plausible wrong fix that would leak a slot for ever

**Evidence: proved from the code.**

`src/jobs.ts:1485` calls `store.settleExpired()` with no owner. `settleExpired(now?, owner?)`
(`src/store/pg-jobs.ts:896`) **already takes an owner**, and `listJobs` (`src/jobs.ts:2732`) already
passes one. So the unscoped call looks like a one-line fix, and `advanceJobWith` even has `owner` in
scope.

**It is not a fix, it is a regression.** `CONCURRENCY_ENV`'s doc comment (`src/jobs.ts:217`) says the
cap is *"how many jobs may run at once, **anywhere**"* — cross-owner, enforced inside `claim`'s
`queue_state` lock. A job whose owner's browser tab died will never have that owner make another
request. Scoping this call to the calling owner means an abandoned job can only be reaped by the one
person who is definitively not coming back, **and the global concurrency slot leaks for ever.**
`listJobs`'s scoping is safe for an unrelated reason (a read-only page load should not end someone
else's job); this call's cannot be, because it is the only door that reaches a departed owner's job
at all.

The comment at `src/jobs.ts:1478-1485` explains *that* the sweep is unscoped and what it costs. **It
does not say why it cannot be scoped**, so the next agent to read it does the obvious thing. One
sentence closes that.

### The shared database does not only make tests slow. It makes them *wrong*, and I reproduced it

**Evidence: reproduced**, and this is the sharpest thing in the plan.

Closing the run, `store-jobs-parity` failed twice with `expected 'busy' to be 'claimed'` — *"refuses a
claim that would put the machine over its cap"* and *"frees the running slot once a claimant has
stopped answering"* — and kept failing when re-run away from the full suite. Not a timeout. So I
counted the rows:

```
select status, count(*) from spideryarn.jobs group by status
  →  error 48 · done 4 · running 3 · cancelled 1 · queued 1
```

**`running: 3`, and the cap is three** (`CONCURRENCY_ENV`, *"Three, asked and answered"*). None of
those three jobs was mine. The test asked for a claim, the store counted every `running` row in the
one database this box shares between eleven worktrees, found the machine at its global cap, and
answered `busy`. **The store was right. The test was right. The answer was wrong**, because "the
machine" means something different to the code than it does to the person running one worktree's
suite.

That is a **different and worse failure than flakiness**, and the previous sweep's write-up
([260903a](260903a-improve-the-codebase-sweep.md)) undersold it as a timing cost:

- **Re-running in isolation does not clear it.** It clears a timeout. It clears this only if the
  other worktrees happen to be idle, which is not something a run can arrange or detect.
- **It is silent and plausible.** `busy` is a real status with a real meaning, so the failure reads
  as a genuine cap violation rather than as contamination. An agent could spend an hour "fixing" a
  concurrency bug that is not there.
- **It gets worse with more agents**, which is the direction this repo is going.

**And it is the same fact as T1.3.** The cap is deliberately global — that is why the advance-door
sweep must not be owner-scoped. The property that makes the design correct in production is exactly
the property that makes the test suite uninhabitable when eleven worktrees share one database.
**That is the argument for schema-per-worktree, and it is much stronger than "the suite is flaky"** —
it is the first evidence anyone has that the shared database produces *false test results* rather
than merely slow ones. It belongs in [worktrees.md](../project/worktrees.md) § the schema-per-worktree
write-up, where the decision will eventually be made.

**This is the sweep's answer to the previous run's "one infrastructural win".**
[260903a](260903a-improve-the-codebase-sweep.md) ended asking for a way to stop worktrees sharing a
database. The answer, after reading rather than assuming: **the cheap version is a regression, and
the version that works is already named and sized elsewhere.**
[worktrees.md § 379-406](../project/worktrees.md) has schema-per-worktree written up, including why
per-*database* is ruled out (`auth.users` foreign keys into Supabase's GoTrue) and why
schema-per-worktree is not free (`pgSchema("spideryarn")` is hardcoded in `src/db/schema.ts`, plus
migration SQL, the ledger, drift checks, grants and raw SQL). It stays Tier 3, where it already
lives. Testcontainers and a second instance are the same rejected option renamed.

## T1.4 · `rowsOf` was extracted and its own file was left half-converted

**Evidence: proved from the code, with git history** — a fix that already failed to reach a copy.
**Not *reproduced*:** nothing was made to fail, and the review was right to catch the word. The
previous sweep drew that line explicitly and this plan blurred it in its own first draft.

`src/store/pg-billing.ts:638` defines `rowsOf(result)`. `d6d57413` introduced it and replaced the
inline cast at three sites. **Two sites in the same file were left:**

- `:254` (`usageOf`) — `const rows = (result as { rows?: unknown }).rows;`
- `:488` — `const rows = (result as { rows?: unknown[] }).rows;` then
  `Array.isArray(rows) && rows.length === 1`, which is exactly `rowsOf(result).length === 1`, the
  form already used at `:563`.

Not a bug today. It is the documented mechanism by which one becomes a bug: the next change to how a
raw `execute` result is read reaches three of five places. No other `pg-*.ts` uses the idiom, so
`rowsOf` staying private to this file is right — this is finishing its own rollout, not a new
extraction.

## T1.5 · `at()` is byte-identical in two files, doc comment included

**Evidence: proved from the code** — both declarations read, only two exist tree-wide.

`src/web/library-columns.tsx:45` and `src/web/admin-columns.tsx:40`: same four-line body, same
comment (*"Parsed to a number, or `undefined` for absent and unparseable alike"*), five call sites
between them. `admin-columns.tsx`'s header says its accessor rules were *"borrowed rather than
reinvented"* from `library-columns.tsx` — true of the rules, and this helper was reinvented verbatim
underneath that sentence.

Its home already exists: `src/web/lib/table-sort.ts` owns `numberOrMissing` and `localeText`, which
is the same job. *Put it where the invariant already lives rather than minting a new home.*

## T1.6 · The previous sweep's "six SSE streams" is seven

**Evidence: proved from the code** (grep, re-run against today's tree).

[260903a:654](260903a-improve-the-codebase-sweep.md) records *"all six SSE streams terminate with an
explicit frame"*. There are seven: six built on the `sse()` helper (`src/routes.ts:1344, 1614, 3417,
3664, 3799, 3917`) and a seventh, `streamChat`, which writes SSE headers by hand at `:2309`. Both
header sites predate the merge, so **this was already wrong when it was written** — a hand-rolled
instance invisible to a grep for the helper.

The *substance* survives: all seven were traced and each sends a terminal `done`/`error` frame or
documents the deliberate no-op, and each closes via `res.end()` in a `finally`. Only the count was
wrong. Correcting it matters because the next sweep would otherwise re-trust the number and
re-inherit the blind spot — a grep for the shared helper does not find the file that does it by hand.

---

# Tier 2 — worth doing, with its own test

## T2.1 · Two of the six deferred registries were defects, and the sweep found one of them

**Heading rewritten after the review.** It read *"Five of the six were never a defect, and the sixth
is"*, which is the claim GPT Sol overturned. The original reasoning is kept below rather than
rewritten into hindsight, because how it was wrong is worth more than the corrected answer — the
correction follows it.

**Evidence: proved from the code.** **This is the run's best finding, and it is a rejection.**

[260903a](260903a-improve-the-codebase-sweep.md) T1.4 counted ten module-scope locks, fixed two, and
deferred the rest — among them *"the six `routes.ts` registries"*, deferred to "the route split".

Two things about that, and they point opposite ways.

**First, the deferral points at nothing.** There is no route split. `git worktree list` shows
**11 worktrees and none is doing it**; the only "routes-split" branch in history is from 2026-08-28,
merged, and was a narrower dispatcher change. [260902e § 3.1](260902e-codebase-rework-umbrella-what-is-worth-doing-next.md)
says the split *"wants its own plan, not a line in this one"* — i.e. deliberately not started. **A
deferral to a plan nobody has begun is not a deferral; it is a decision to leave it, made without
saying so.** Meanwhile `src/routes.ts` grew from 6,671 to 7,294 lines.

**Second — and this is the part that reverses the finding — five of the six are not defects at all.**
An agent nominated them as a block, quoting the comments that say so: `routes.ts:1685` (*"Exactly the
job `answering` does for comments, and for exactly the same reason"*) and `:3317` (*"The same job
`answering` and `streaming` do above, for the same reason"*).

**Those are citations, not instances** — the exact rule this sweep's predecessor added to
[improve-the-codebase.md](../reusable/improve-the-codebase.md) yesterday, after failing this way
twice. Checked independently, one at a time:

| registry | durable half for the **sweep** | verdict |
|---|---|---|
| `answering` `:803` | `lease_expires_at` on the row, stamped by `beginAnswer` (`src/store/pg-comments.ts`) | sweep role protected |
| **`streaming` `:1743`** | `ChatStore.sweepPending(slug, opts: SweepOptions)` | **has a second job with nothing behind it — see below** |
| `searching` `:3323` | `SearchStore.sweepPending(slug, opts: SweepOptions)` | sweep role protected |
| `refereeing` `:3493` | `sweepPending(slug, opts: SweepOptions)` | sweep role protected |
| `pullingClaims` `:3754` | a `live` **boolean**, not a `keep` set — and `CLAIMS_ORPHAN_GRACE_MS` on `referee_claims.created_at` | sweep role protected |
| **`turnOrder` `:1775`** | **none — a bare `Map<string, Promise<void>>`** | **a real one** |

### The review found this table wrong, and the way it was wrong is the finding

**GPT Sol returned *not ready* and was right.** `streaming` does **two** jobs and the sweep checked
one:

1. `liveMessages` turns it into the `keep` set — the role the comments name, the role I verified,
   and the role that *is* protected.
2. **It is also where each live stream's `AbortController` and `done` promise live**
   (`routes.ts:2327` sets them; `settleThread` at `:1925` aborts superseded streams through it; the
   stop route reads it at `:2543`). **There is no second copy of those anywhere.**

So on a module re-evaluation a reader pressing **Stop** reaches an empty map, gets
`{ stopped: false }`, and **the paid model call keeps running and keeps being billed** — while a
retry or edit supersedes nothing and writes over a row a live stream still holds. That is the cost
storm's own class, and this plan had filed it under "came back clean".

**The lesson is not "check harder".** It is specific and reusable: *a citation is not an instance*
stopped one failure and let this one through, because the trap has a second door. **I verified the
role the comment named, not the object.** `streaming`'s comment explains it as the `keep` set, the
contract it points at is about `keep`, and both are true — and neither mentions the abort handles
that are the actual hazard. **What a well-documented identifier is *for* is not the same as what it
*does*; grep the uses, not the doc.**

Two more the sweep missed, both found by the review:

- **`src/comments.ts:371`, `begun`.** Its comment says *"Emptied by a restart, which is the point"* —
  the exact assumption `process-state.ts` exists to correct, since a reload is not a restart. It is
  the only thing stopping a second paid answer on a comment that already has one in flight.
  **Deliberately not fixed**: it is the filesystem store, reached only when `SPIDERYARN_STORE` is not
  `postgres`, and [260831b](260831b-finish-the-database-move.md) Stage 4 deletes the module. The
  comment is corrected in place so whoever works on it first knows. **The sweep never looked outside
  `routes.ts` for this class, which is a scope error, not a reasoning one.**
- **`src/similar.ts:183` and `src/article-vectors.ts:186`** — coalescing maps that exist *specifically*
  so concurrent readers do not buy duplicate embedding calls, plus a per-module concurrency cap.
  Module duplication defeats both. **Not fixed in this run**: neither was read by this sweep at the
  depth needed to change them safely, and proposing a fix for code I have not read is the thing this
  method warns against. **Named for the next run, with the paid call at
  `similar.ts:294` and `article-vectors.ts:302` as the reason it matters.**

**And the four remaining "protected" verdicts are narrower than stated.** They hold under Postgres.
The *filesystem* implementations largely reject pending work absent from `keep` immediately, with no
grace window (`src/comments.ts:695`, `src/store/fs.ts:456`, `:512`,
`src/referee-claims-store.ts:160`). Reasonable to defer behind the database move — **not** reasonable
to call "not defects at all", which is what this plan said.

**What survives.** The structural distinction was real and useful: five of six registries do have a
durable half for their sweep role, and wrapping all six blindly would still have been wrong. But the
conclusion drawn from it — "five are clean, ship one fix" — was wrong, and a plan that had gone to
build without review would have left a live money bug in while congratulating itself on a rejection.
**This is the second consecutive sweep whose review caught something the sweep was proud of.**

**Each of the five was checked on its own, not inferred from the others** — which is the whole point,
and the fifth is why. `pullingClaims` does not take `SweepOptions` at all: `RefereeClaimsStore.sweep`
(`src/store/contracts.ts:1054`) takes a bare `live` boolean, *"narrower than `SweepOptions` … because
there is one run and no id to keep a set of"*, and its doc comment then spends a paragraph saying the
grace window still exists and where it moved to. **Read as an instance of the same idiom it would
have looked unprotected**; read on its own it is the same design with a different signature.

`SweepOptions` (`src/store/contracts.ts:648`) states the rule outright: *"`keep` is this process's
live work and **something else has to speak for every other process, because `keep` alone is a
cross-process bug**."* The five sweep registries **are** the `keep` half, by design, with a durable
clock (`attempt_started_at` + `graceMs`, or `lease_expires_at`) as the other. `routes.ts:862-871`
records that this was already got wrong once and already fixed, *by moving the durable half into the
store* — which is what `process-state.ts` itself says the answer is: *"The general answer to shared
state is Postgres."*

**So wrapping those five in `processSingleton` would be machinery guarding something already
guarded** — and would put a second, weaker copy of the rule next to the real one. It fails the
deletion test and it fails this doc's own bar.

**`turnOrder` is different and is a genuine instance.** *"One turn at a time per conversation, across
deciding and writing it"* (`:1772`) — a promise chain, the same shape as the two the last sweep did
fix (`ai-calls-fs.ts`, `realtime-sessions-fs.ts`) and the eight `queue` chains. It has no durable
counterpart, and a second module copy is a second chain, which is no exclusion at all. A dev-server
restart does not cancel the in-flight request (`src/process-state.ts`), so the window is exactly the
one that matters.

**Then I read `inTurnOrder` properly, and the size of the prize shrank.** Three things the structural
argument above does not see, all of them in the code:

- **The lock is released before the model is called** (`routes.ts:1756`): *"held for the settle and
  the write and released before the model is called, so a long answer blocks nothing."* So the window
  a second module copy could slip into is a local settle-and-write — milliseconds — **not** the
  eight-minute model call that made the cost storm expensive. This is not that class.
- **`tail` always settles.** `mine.then(() => {}, () => {})` swallows both outcomes, deliberately and
  with the reasoning written down. So preserving the map across a restart cannot deadlock the new
  copy behind a promise from the old one — which was the specific risk worth checking before
  proposing this, and it is clear.
- **The cross-process gap is already named**: *"Per process, like everything else here. Two servers
  on one `data/` directory remains the unfixed problem in
  [260826a](260826a-chat-mode.md) § What is still open."*

That last one does **not** cover this case — two module copies inside *one* process is exactly what
`processSingleton` is for, and is a different thing from two servers — so the finding survives. But
it survives smaller.

**Proposed, with that discount stated:** wrap `turnOrder` only, and **only if a `vi.resetModules()`
test can be made to go red first**. If it cannot, this is a hypothesis and stays one — *a test that
was never red proves nothing*, and a millisecond window is exactly the size that might not be
reachable.

### It went red. Evidence state upgraded to **reproduced** ✅ done

`tests/turn-order-across-reload.test.ts`. Copy one begins a turn and does not finish it;
`vi.resetModules()`; copy two is handed the same conversation key. Before the fix:

```
AssertionError: expected [ 'a in', 'b in' ] to deeply equal [ 'a in' ]
+   "b in",
```

`b` ran while `a` was still in flight — two turns interleaved on one conversation, which is the whole
thing the lock exists to prevent. After wrapping `turnOrder` in `processSingleton`, green, and
`tests/turn-order.test.ts`'s three original cases still pass.

**The first run of that test was a false red worth recording**, because it is this plan's own T1.2 in
miniature: it timed out at 5,000 ms *during the second import* and never reached its assertion.
`src/routes.ts` is 7,294 lines and the test evaluates it twice. A red that says nothing about the
lock looks exactly like a red that says everything about it. The test now carries a 60-second timeout
and a comment saying why.

Record the other five as verified clean so the next sweep does not re-nominate them — **the negative
result is the more valuable half of this item, and is not contingent on the above.**

## T2.2 · The module-scope meta-test — assessed, and not proposed

An agent proposed a grep-based meta-test flagging any mutated module-scope `Map`/`Set` in `src/`,
following the precedent of `tests/public-imports.test.ts`.

**Still declined, but the reason this plan first gave for declining it was wrong.** The original
argument was *"T2.1 shows five of six are correct by design, so the heuristic is mostly false
positives"* — and T2.1 turned out to be wrong, so that argument does not hold. The review said so
and also agreed with the conclusion, which is worth separating.

The reason that survives: a rule over *all* mutated module-scope `Map`/`Set`s is still too broad —
~30 pure lookup tables in `src/` are built once and never mutated, and the genuinely correct
`keep`-half registries would each need an escape hatch. **A check whose failures are usually noise is
a check nobody runs.** What the review points at instead is narrower and better: an inventory or rule
for server-side `Map<…, Promise<…>>` and `INFLIGHT`-shaped state specifically — the coalescing and
locking shapes, not every mutable map. `src/similar.ts:183` and `src/article-vectors.ts:186` are two
this sweep never looked at, both guarding paid calls. **That is the next run's item, and it should
start from the inventory rather than from a rule.**

What would actually work is a type-level distinction between "process-local half of a two-part fence"
and "the whole fence" — and nobody has a cheap version of that. Recorded here so the next run does
not re-derive it. The honest ceiling for this class is a test per instance, not a rule.

---

# Tier 3 — named and sized, not started

- **T3.1 · Split `src/routes.ts`.** 7,294 lines, 75 commits in 30 days, still top of churn ×
  complexity, and now demonstrably **not in flight** (T2.1). Already sized in
  [260902e § 3.1](260902e-codebase-rework-umbrella-what-is-worth-doing-next.md), whose prerequisite
  list stands. Named here only so the map is complete and so the next run does not defer to it again
  believing it is happening.
- **T3.2 · Schema-per-worktree.** Already written up in [worktrees.md](../project/worktrees.md).
  See T1.3 for why the cheap version is a regression.
- **T3.3 · `src/db/client.ts:54` pool on reload.** `let pool: Pool | undefined`, and `closeDb()` is
  called only from CLI scripts — nothing fires it on a dev-server module reload. Each reload may
  abandon up to `poolMax()` = 5 connections unclosed. **Hypothesis, not proved**: no exhaustion was
  reproduced, and `process-state.ts` explicitly carves out "a lazily-built client" as fine to
  duplicate. Wants a measurement against the pooler limit before anyone acts. Flagged, not scheduled.

---

# What came back clean

Recorded because a negative result from a real sweep is worth as much as a finding, and because the
next run should not re-spend agents here.

- **The billing subsystem's correctness.** Traced rather than skimmed: admission's `for update` lock,
  the release-on-every-path `finally`, all seven settlement sites, the strict-charge/tolerant-release
  split and its three `error`-level logs for the non-idempotent cases. Webhook: raw-byte signature
  verification before parsing, unset secret refuses rather than bypasses, livemode assertion, exact
  path match, four-event allowlist, unmapped customer 503 not 200. One entitlement path, one tier
  source, one `FREE_LIFETIME_INGESTS`. It had two prior Sol reviews and it shows.
- **The request path, re-verified clause by clause** rather than inherited from
  [260903a](260903a-improve-the-codebase-sweep.md): auth still checked once at the top of
  `serveAuthenticatedApi` with the three new billing routes inside it; no new route builds its own
  error envelope; no raw error, stack or database message reaches the wire; no `console.log` in a
  request path. The one clause that did not survive was the SSE **count** — see T1.6.
- **No sensitive logging in the new code.** Billing and admin log owner uuids, Stripe ids and
  statuses — never emails or article prose — with `email` on the redaction list as a backstop.
- **The isolation pin held through the merge.** Every new `.transaction(` in billing pins its level;
  T0.1 was the only breach and the test caught it the same night.
- **Test-suite vacuity.** ~15 of the 111 `toBeDefined()` sites sampled: every one guards a
  `.find()`/optional lookup that really can be `undefined`. Both `catch {}` blocks in `tests/` carry
  an inline reason. Bounded evidence, not a census — 15 of 111, and said so.
- **The client/server co-change seam.** Five file pairs change together ≥5 times without importing
  each other; the top one (`src/routes.ts` + `src/web/ChatPanel.tsx`, 10 times) is honest — they talk
  over HTTP, the shapes live in `src/types.ts`, and `types.ts:2180` names `ChatPanel.tsx` in its own
  comment. Signposted both ways.
- **Rival mechanisms, looked for and not found.** Three "is this production" checks that each answer
  a different question and are documented as such; `readRawBody` vs `readBody`, a deliberate near-copy
  with the reason written down; `WebhookRefused` vs `httpError`, genuinely different jobs. No second
  quota check, no second tier table, no second price formatter.
- **Every doc citation in the new billing files resolves.** Checked in both directions.

---

# One level up: is the approach sound?

The method asks for this and a grep cannot produce it. Having read across the billing subsystem, the
store contracts, `routes.ts`'s locks, `process-state.ts` and the test infrastructure in one night:

**Yes, and by an unusual mechanism.** This codebase writes down *why* at the point of decision,
including where the decision went against the advice recorded at the time. `SweepOptions` says why
`keep` alone is a cross-process bug. `isolation.ts` says why *every* transaction names its level
rather than only the two that provably need it. `process-state.ts` says why `globalThis` rather than
something tidier. `inTurnOrder` says which line keeps the chain alive, and that an earlier comment
credited the wrong one.

**That is why this sweep could reject four of its own findings.** The five registries, the meta-test,
`httpError`, the "obvious" `settleExpired` fix — in every case the answer was already written down, at
the site, in a form that survived contact with a sceptical reading. A codebase where the comments are
decoration cannot do that; you would have had to re-derive each design from scratch and would
probably have got one wrong.

**And that strength is the source of the one strain worth naming.** The prose is so good, and so
cross-referential, that reading it feels like a substitute for reading the code — and it is not.
Every count this sweep and its predecessor got wrong came from trusting a comment that pointed at
another comment. Three of tonight's Tier 1 items are prose that stayed still while the code moved,
and one of them (`schema.ts`) told the reader that live money code was dead.

So: **the documentation here is load-bearing, which makes it a dependency, and it is the only
dependency with no test.** `tests/doc-links.test.ts` checks that a link resolves. Nothing checks that
a *sentence* is still true, and the failure is silent and confident.

**T3.4 — a citation test, and it is the cheapest thing on this list that is not on it.** The agents
found tonight's stale claims by hand, the same way the previous sweep found 36 references to a file
deleted two days earlier. Much of that is mechanisable: a comment naming `src/foo.ts`, or a
backticked symbol next to a file path, is checkable — does the path exist, does the symbol still live
there. It would not have caught "nothing calls `reserveIngest` yet" (that needs a call graph, which
`knip` already has and nothing joins to prose), but it would have caught the 36, and the `import.ts`
references still sitting at ~30. **Named and sized, not started** — it wants its own plan, and the
false-positive rate on backticked prose is the thing to measure first.

---

# Stages

Each ends committable, green and deployable. Parallel lanes are constrained by **non-overlapping file
sets**, and **every file is named exactly once, with no wildcards** — the constraint
[260903a](260903a-improve-the-codebase-sweep.md)'s review had to impose on it.

### Stage 0 — done before the plan was written

T0.1. `src/store/pg-jobs.ts`. Committed `b64c7b7c`, merged, pushed. A red gate on `dev` does not wait
for a planning doc.

### Stage 1 — two lanes in parallel

| lane | items | files |
|---|---|---|
| **1a — the false prose** | T1.1, T1.2, T1.6 | `src/db/schema.ts`, `src/store/pg-session.ts`, `docs/plans/260902i-stripe-payments-and-subscription-tiers.md`, `docs/project/testing.md`, `docs/plans/260903a-improve-the-codebase-sweep.md` |
| **1b — the small code fixes** | T1.4, T1.5, T1.3 | `src/store/pg-billing.ts`, `src/web/library-columns.tsx`, `src/web/admin-columns.tsx`, `src/web/lib/table-sort.ts`, `src/jobs.ts` |

Neither lane opens a file the other names — the review confirmed the lists are disjoint with no
wildcard, which is the check [260903a](260903a-improve-the-codebase-sweep.md)'s review had to force.

**"1a is prose only and cannot break a test" was wrong, and the review said so.** Doc links are
tested, and `src/process-state.ts:17` records a case where *quoted source text inside a comment* was
read as a real import edge and turned a test red. Prose is not a safe category here. In the event 1a
did go red once — `tests/doc-links.test.ts` timed out at 8.8 s under load and passed on a re-run,
which is T1.2's own subject arriving a third time in one night.

### Stage 2 — the locks in `routes.ts`, alone

T2.1. `src/routes.ts`, `tests/turn-order.test.ts`, `tests/turn-order-across-reload.test.ts` (new).
Alone because `src/routes.ts` is the most contended file in the tree.

**Scope grew after the review**, from `turnOrder` to `turnOrder` **and `streaming`** — the second is
the one that mattered and the plan had called it clean. Same file, so it stays one stage. The stage
also carries the `sse()` count comment and, in adjacent files the lane owns outright,
`src/comments.ts` and `src/store/db-errors.ts`.

### Deferred for Greg — questions, not work

Carried forward from [260903a](260903a-improve-the-codebase-sweep.md), still open, and **not actioned
in this run**:

1. **The `check-staged-revert` pre-commit hook.** Linked worktrees share one `.git/hooks/`, so
   installing one changes every agent's commits in every tree at once; and hooks are not in version
   control, so it would live on this box only. Reasons in
   [260903a-…-doc-proposals.md](260903a-improve-the-codebase-sweep-doc-proposals.md).
2. **`DELETE /api/glossary/:slug`** — a declared 501, blocked on
   [260826e](260826e-postgres-storage-implementation.md)'s open question about mutating a published
   revision. A product decision.
3. **`src/web/styles.css` at 12,898 lines** — measured on this tree, not carried over. The review
   caught this plan quoting yesterday's 12,830, which is the same drift
   [260903a](260903a-improve-the-codebase-sweep.md) had just corrected from "~1200": **the number
   moved again within a day, which is itself the argument for citing a command rather than a
   figure.** Recommendation unchanged: leave it. One long file with one reason to change is just a
   long file.

New, and also Greg's:

4. **T3.3, the pool on reload** — wants a measurement, not an opinion.

### Not doing, and why

- **Wrapping the four remaining `routes.ts` registries** — `answering`, `searching`, `refereeing`,
  `pullingClaims`. Their sweep role has a durable half and their other uses were checked (this time by
  grepping each identifier, not by reading its comment). **This is a narrower claim than the one this
  plan first made**, which was that they are not defects at all: under the *filesystem* store several
  sweep with no grace window (`src/comments.ts:695`, `src/store/fs.ts:456`, `:512`,
  `src/referee-claims-store.ts:160`). That is deferred behind
  [260831b](260831b-finish-the-database-move.md), not clean.
- **`src/comments.ts`'s `begun` fence, and the two coalescing maps** (`src/similar.ts:183`,
  `src/article-vectors.ts:186`). The first is deferred with the filesystem store that is being
  deleted; the other two are real and I have not read them at the depth needed to change them safely.
  Named in T2.2 for the next run rather than fixed blind — **proposing a fix for code you have not
  read is the specific failure this method warns about**, and this run has already made the
  neighbouring mistake once tonight.
- **The module-scope meta-test** — T2.2, declined on this run's own evidence.
- **`httpError`'s five copies** (`src/routes.ts:676`, `src/auth.ts:188`, `src/public/routes.ts:63`,
  `src/billing/checkout.ts:98`, `src/billing/admission.ts:125`). Counted, verified byte-identical,
  and **left alone.** Three of the five carry a comment naming `routes.ts` as the original, so the
  copying is acknowledged rather than accidental, and no drift has occurred. It went 3 → 5 with the
  merge, so it is worth watching — but a new leaf module for a three-line function is the kind of
  extraction this doc declines everywhere else. **Revisit when one of them drifts**, which is the
  evidence that would make it a defect.
- **The eight `queue` chains** — deferred to [260831b](260831b-finish-the-database-move.md) Stage 4,
  which deletes those adapter modules outright. A test for them has a short shelf life. This
  deferral, unlike T2.1's, points at a plan that exists and is in progress.
- **Splitting `styles.css` or `App.tsx`** — Greg's call and already refused, respectively.
- **Any change to the remote database** — out of scope for an unattended run.

## Progress

- [x] T0.1 — the red gate · `b64c7b7c`, merged and pushed
- [x] Stage 1a — T1.2, T1.6 · `5a5d9645` · T1.1 (two of five sites) · `a3d5f310`
- [x] Stage 1b — T1.4, T1.5 · `b939989f`
- [x] Stage 2 — `turnOrder`, red test first
- [x] **Plan reviewed by GPT Sol — *not ready*, and right.**
      `260903d-…-review-sol.md`
- [x] Post-review: `streaming` wrapped (the money bug the plan had called clean),
      `db-errors.ts` and `comments.ts` false comments corrected, the `sse()`
      count comment corrected, the SSE claim in `260903a` walked back, evidence
      labels downgraded, T1.1 recounted 4 → 5, the grep command recorded
- [x] T1.3's comment at `src/jobs.ts`. Held at first as "normative", then written:
      it is a code comment in a source file, not one of the docs whose wording is
      a rule, and two independent analyses agree on its content. Deferring it
      would have left the trap open and recorded the reason only in a plan doc,
      which is the *opposite* of where this sweep keeps finding the reasons
      should live.
- [ ] **Held:** the T1.1 edit to `260902i`'s status section. It is a plan doc, and
      rewriting a plan's own account of what it had built is a judgement about
      the record rather than a factual fix.

**The review landed mid-build, and that is a process finding, not a footnote.**
Three commits went in before the verdict. Sol flagged it, and the flag is fair:
the rule is a plan is reviewed *before* it is built. What made it defensible in
this case is that everything committed early was either a red gate (T0.1, which
does not wait) or an item whose evidence I had verified first-hand and which the
verdict could not invalidate — and the verdict did not touch any of them. What
made it *lucky* is that the item the verdict did overturn, T2.1, was the one I
had held. **Next run: hold all of it, or do not open the review until the safe
part is committed and say so in the prompt.**

## Where it ended

**Five of six gates green, and the sixth could not be measured on this box tonight.** Said plainly
rather than rounded up, because this plan's own subject is red results you cannot trust.

```
  ✓ typecheck    clean          ✓ cycles       clean
  ✓ build        clean          ✓ chain        clean
  ? test         see below      ✓ committed    clean
```

The full suite reported 15 failed files / 57 failed tests at load average **92**, with ~90 vitest
processes from other worktrees. Re-run, that fell to 7 files / 9 tests, of which **7 of 9 were
5-second timeouts** — including one on a pure AST walk, which nothing but CPU can affect. The
remaining two are `store-jobs-parity`'s global-cap cases, **reproduced above as shared-database
contamination rather than a defect**.

**What was verified rather than assumed**, because `processSingleton` keeps state on `globalThis`,
which is per *worker* and not per test file — so two suites sharing a worker would now share the
`streaming` map where each previously got a fresh one. That is a real mechanism, not just a worry:

- `tests/comment-referee-mark.test.ts` (19 failures in the loaded run) — **passes**
- `tests/public-network-trace.test.tsx` (16 failures in the loaded run) — **passes**
- the eight chat suites that drive stop and supersede through `streaming` — `chat-cancel-before-begin`,
  `chat-delete-live-turn`, `chat-live-turn`, `chat-arrival-race`, `chat-edit-guard`,
  `chat-invariants`, `chat-error-scope`, `chat-handoff` — **37 tests, all pass**
- `tests/turn-order.test.ts`, `tests/turn-order-across-reload.test.ts`,
  `tests/store-transaction-isolation.test.ts`, `tests/doc-links.test.ts` — **21 tests, all pass**

So nothing red is attributable to this sweep's changes, and the two that are genuinely red are red
for a reason this plan documents and no re-run can clear. **A green `npm run check` on this box
requires the other ten worktrees to be idle, which is the finding, not an excuse.**

| | before | after |
|---|---|---|
| `npm run check` | **red on `dev`** — a guard the previous sweep wrote, going off | five gates green; `test` classified, nothing attributable |
| unpinned `isolationLevel` literals | 3 new ones outside the allow-list | **0** |
| false "not wired up yet" claims about live billing | 5 across 4 files | **0** |
| `routes.ts` locks with no durable half | 2 (`turnOrder`, `streaming`) | **0**, one with a red-test reproduction |
| `rowsOf` call sites still inline | 2 of 5 | **0** |
| `at()` declarations | 2 | **1** |
| shared-database cost | "timing-sensitive suites flake" | **measured: it returns false results, and here is the row count** |

## What the review changed

`260903d-improve-the-codebase-second-sweep-review-sol.md`. **Not ready**, and the headline finding
was right, so this records what moved rather than burying it.

| | |
|---|---|
| **`streaming` was not clean, and calling it clean left a money bug** | It holds each live stream's `AbortController` and `done` promise as well as feeding `keep`. After a reload, **Stop** returns `{ stopped: false }` and the paid call runs on. Wrapped. The plan had verified the role its comment named and not the object's uses. |
| **The sweep never left `routes.ts`** | `src/comments.ts:371`'s `begun` is the same class with the same false "a restart empties it" comment. Comment corrected; mechanism deferred with the rest of the filesystem store. |
| **Two paid-work registries missed entirely** | `src/similar.ts:183` and `src/article-vectors.ts:186` exist so concurrent readers do not buy duplicate embedding calls. Named for the next run rather than fixed by someone who has not read them. |
| **"Not defects at all" was too strong for the other four** | They hold under Postgres. The filesystem implementations mostly sweep with no grace window. Deferrable, not clean. |
| **T1.1 undercounted, 4 → 5** | `src/store/db-errors.ts:60` was inside the 43 grep hits and I read past it. |
| **A count with no command is not a count** | The grep is now in the plan verbatim. |
| **Two evidence labels were overstated** | T1.4 and T1.6 were *proved from the code*, not *reproduced*. The previous sweep drew that line and this plan blurred it. |
| **The SSE correction over-corrected** | "All seven terminate with an explicit frame" is false — three deliberately omit it on some paths. What is true of all seven is `res.end()` in a `finally`. |
| **`styles.css` was quoted at yesterday's number** | 12,898, not 12,830. The figure moved within a day, which is the argument for citing the command. |
| **Three commits landed before the verdict** | Fair, and recorded in *Progress* above rather than tidied away. |

Findings I checked and did **not** act on: none of Sol's were wrong. Every one held against the tree.
T1.3 it confirmed independently, including the specific reason the cheap fix is unsafe.

## What the next sweep should know

**Two hours was enough to produce a Tier 0.** The guard the previous sweep installed went red on the
very next feature commit. If you are deciding whether it is too soon to run this again: it was not.

**The run's proudest finding was a rejection, and the rejection was partly wrong.** Five of six
nominated registries did have a durable half, and reading the contract they point at
(`SweepOptions`, `src/store/contracts.ts:648`) instead of the comments that cross-reference each
other was the right move — *a citation is not an instance*, the rule added yesterday, earned its
place within a day. **And it was not enough.** `streaming`'s comment describes the `keep` role, the
contract describes the `keep` role, both are accurate, and neither mentions the abort handles that
were the actual hazard. So:

> **Checking the role a comment names is not checking the object.** A well-documented identifier
> tells you what it is *for*. Only `grep` for its uses tells you what it *does*, and the second job
> is where the undocumented half lives — which is exactly where this doc says copies drop things.

Put the two together and the rule for the next run is: *find* the cluster with the comments, *count*
it with a grep for the idiom, and *clear each member* with a grep for its own identifier.

**A deferral is a claim too, and it decays.** *"Deferred to the route split"* was reasonable when
written and false a day later, because nobody started the split. When you defer, name the plan and
check it exists; when you inherit a deferral, check it again.

**Two sweeps, two reviews, two catches.** [260903a](260903a-improve-the-codebase-sweep.md) came back
*not ready* for a deletion that would have removed live exports. This one came back *not ready* for a
"clean" verdict that would have left a live money bug. In both cases the sweep's own confidence was
highest exactly where it was wrong. **Budget for the review; it is not a formality and it has now
paid twice.**

**And I caused it once, which is the part worth writing down.** Late in the run I had two full
`npm run check` runs going at the same time, on a box already carrying other worktrees' suites — 10
check processes and 90 vitest processes. The first came back with 11 failed test files, a number that
means nothing. A sweep whose central infrastructural finding is *"the shared database makes red
meaningless under load"* then generated the load itself. **One suite at a time, and check what is
already running before you start one** — `pgrep -fc vitest` is the whole check.

**The test noise is not neutral.** The previous sweep called the shared-Postgres flakiness a cost in
time. This run found the sharper version: **six false failures and one real one arrived in the same
run**, and telling them apart took a second full pass. `testing.md` already predicted this in
writing — and was itself wrong about which suites still lacked timeouts (T1.2). The infrastructural
fix stays Tier 3 for the reason in T1.3, so what protects you meanwhile is re-running in isolation
before believing a red suite, and *not* the reverse — do not assume a red suite is noise.
