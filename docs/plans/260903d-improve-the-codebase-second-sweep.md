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

Disproved by: `src/routes.ts:7116, 7164, 7188` → `withIngestSlot`/`withRetrySlot`
(`src/billing/admission.ts:189, 205`) → `reserveIngest` (`src/store/pg-billing.ts:366`); and
settlement from `src/store/pg-session.ts:416, 511`. `src/store/pg-billing.ts:12` says outright *"It
is wired up, as of 2026-09-03"* — **so the codebase already contradicts itself in two files.**

**The count, done properly.** Grepping the idiom (`nothing calls`, `no caller`, `not wired`, …)
returns **43 hits across `src/` and `docs/`**. Thirty-nine are a different sense of the same words —
*"no caller has to remember the prefix"*, *"no caller wants a strict release"* — and are not
instances. This is the T2.1 trap in miniature: the string matches, the meaning does not. One more,
`docs/project/billing.md:291` (*"The last two have no caller in `src/`"*), was checked
independently and **is still true** — it describes `finish`/`releaseStep` on the generic `JobStore`,
deliberately, with the trap spelled out. Two review-prompt docs say the old thing and **must not be
edited**: a review prompt is a record of what was asked, like a postmortem.

So: **4 sites, 3 files.** Not 43, and not 6.

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

**Evidence: reproduced from git history** — the strongest kind, a fix that already failed to reach a copy.

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

**Evidence: reproduced** (grep).

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

## T2.1 · Five of the six deferred registries were never a defect, and the sixth is

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

| registry | durable half | verdict |
|---|---|---|
| `answering` `:803` | `lease_expires_at` on the row, stamped by `beginAnswer` (`src/store/pg-comments.ts`) | **protected** |
| `streaming` `:1743` | `ChatStore.sweepPending(slug, opts: SweepOptions)` | **protected** |
| `searching` `:3323` | `SearchStore.sweepPending(slug, opts: SweepOptions)` | **protected** |
| `refereeing` `:3493` | `sweepPending(slug, opts: SweepOptions)` | **protected** |
| `pullingClaims` `:3734` | `sweepPending(slug, opts: SweepOptions)` | **protected** |
| **`turnOrder` `:1775`** | **none — a bare `Map<string, Promise<void>>`** | **the real one** |

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

**Proposed:** wrap `turnOrder` only, red test first (`tests/turn-order.test.ts` already exists and
`inTurnOrder` is already exported for it, so the seam is there). Record the other five as verified
clean so the next sweep does not re-nominate them — **the negative result is the more valuable half
of this item.**

## T2.2 · The module-scope meta-test — assessed, and not proposed

An agent proposed a grep-based meta-test flagging any mutated module-scope `Map`/`Set` in `src/`,
following the precedent of `tests/public-imports.test.ts`.

**Declined for now, on this sweep's own evidence.** T2.1 has just shown that *being* a mutated
module-scope `Map` does not make something a defect — five of six were correct by design. A test
built on that heuristic would flag all five, and the fix for a false positive would be an
escape-hatch comment on code that is already right. That is a check whose failures are usually noise,
and *"a check that always fails is a check nobody runs"*.

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

Neither lane opens a file the other names. 1a is prose only and cannot break a test; 1b is code and
runs `npm run check`.

### Stage 2 — `turnOrder`, on its own

T2.1. `src/routes.ts`, `tests/turn-order.test.ts`. Alone because `src/routes.ts` is the most
contended file in the tree and the change wants a red test first.

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
3. **`src/web/styles.css` at 12,830 lines.** Recommendation unchanged: leave it. One long file with
   one reason to change is just a long file.

New, and also Greg's:

4. **T3.3, the pool on reload** — wants a measurement, not an opinion.

### Not doing, and why

- **Wrapping the five protected `routes.ts` registries** — T2.1. They are correct as they are, and
  the proposed fix would have added a weaker second copy of a rule that already lives in the store.
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
- [ ] Plan reviewed by GPT Sol
- [ ] Stage 1a — the false prose
- [ ] Stage 1b — the small code fixes
- [ ] Stage 2 — `turnOrder`

## What the next sweep should know

**Two hours was enough to produce a Tier 0.** The guard the previous sweep installed went red on the
very next feature commit. If you are deciding whether it is too soon to run this again: it was not.

**The best finding this run was a rejection, and it took the longest to reach.** Five of six
nominated registries were already correct, and the way to know was to stop reading the comments that
cross-reference each other and read the contract they all point at
(`SweepOptions`, `src/store/contracts.ts:648`). The sweep doc's newest rule — *a citation is not an
instance* — was written yesterday after two miscounts and it earned its place within a day. **Expect
to need it. The cross-referencing comments are how you find the cluster and they will tell you the
cluster is uniform when it is not.**

**A deferral is a claim too, and it decays.** *"Deferred to the route split"* was reasonable when
written and false a day later, because nobody started the split. When you defer, name the plan and
check it exists; when you inherit a deferral, check it again.

**The test noise is not neutral.** The previous sweep called the shared-Postgres flakiness a cost in
time. This run found the sharper version: **six false failures and one real one arrived in the same
run**, and telling them apart took a second full pass. `testing.md` already predicted this in
writing — and was itself wrong about which suites still lacked timeouts (T1.2). The infrastructural
fix stays Tier 3 for the reason in T1.3, so what protects you meanwhile is re-running in isolation
before believing a red suite, and *not* the reverse — do not assume a red suite is noise.
