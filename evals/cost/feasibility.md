# Stage 2 — no-spend feasibility: orchestration, attribution, fixtures

For [260902g-estimate-article-ingestion-and-mode-generation-costs.md](../../docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md).
No money was spent. Every claim below is backed by a run whose output is pasted at the end.

**Headline: all three couplings dissolve without a single line of production code changing.**
The seams already exist — `withSpendAttribution`, `AdvanceParts.steps`, and `enqueue`'s
`VERCEL` pump switch — and the eval runner is a caller of them, not a new mechanism.

---

## Decision 1 — attribution: overlay `scopeKind: "eval"` inside each step's `run`

**Chosen: option (a), an explicit eval-attribution seam — but the seam already exists and needs
no agreement with the cost-tracking agents.**

### The evidence

- `runStep` opens its own collector with a literal `scopeKind: "job_step"` —
  [`src/jobs.ts:586-599`](../../src/jobs.ts). Nested collectors shadow
  ([`src/ai-spend.ts:632-637`](../../src/ai-spend.ts)), so an eval-scoped
  `collectSpend` wrapped round the queue records nothing. Confirmed.
- `scope.attribution.scopeKind` is read **at row-write time**, not at collector-open time —
  [`src/ai-spend.ts:785`](../../src/ai-spend.ts).
- `withSpendAttribution(patch, fn)` re-enters the **same box** with a patched attribution
  ([`src/ai-spend.ts:564-574`](../../src/ai-spend.ts)), and its parameter is
  `Partial<SpendAttribution>` — which includes `scopeKind`
  ([`src/ai-spend.ts:284-303`](../../src/ai-spend.ts)).

So: if the eval runner hands the queue a step registry whose every `run` is wrapped in
`withSpendAttribution({ scopeKind: "eval" }, …)`, every model call made inside a step inherits
`scopeKind: "eval"` while keeping `ownerId`, `articleSlug`, `jobId` and `stepName` from
`runStep`'s own attribution. One box, one `runId`, one report to `runStep` — nothing else changes.

```ts
const evalSteps = Object.fromEntries(
  Object.entries(STEPS).map(([name, step]) => [
    name,
    { ...step, run: (...a) => withSpendAttribution({ scopeKind: "eval" }, () => step.run(...a)) },
  ]),
);
```

### The acceptance criterion is met with no reporting change

Product is `request | job_step` and Eval is its own pocket — `partitionByScope` in
`src/cost-report.ts`. Rows carrying `scopeKind: "eval"` are outside the Product bucket by that
function's existing behaviour. **Nothing in the cost-tracking machinery needs to change**, which
is why this beats every alternative.

⟨This paragraph cited `scripts/ai-cost.ts:423` and `rows.filter((r) => r.scopeKind !== "eval")`.
That was the code, and the negative form was the F2 defect — it also swept dev-CLI spend into
Product. The conclusion here was unaffected, but the line number had drifted and the definition has
moved into a tested function. Corrected 2026-09-07.⟩

Proved, not asserted — see the transcript: the control arm (no overlay) lands in
`Product spend`, the eval arm in `Eval spend`, from the same fixture, the same step and the same
fabricated cost.

### Rejected

- **(c) attribute by run-prefixed slug over ordinary `job_step` rows** — cheapest, evaluated first
  as instructed, and it fails the acceptance criterion exactly as Sol's round 2 said: those rows
  are Product spend at `scripts/ai-cost.ts:423`. We keep the run-prefixed slug anyway (it is how a
  run's articles are found and cleaned up), but it is not the attribution mechanism.
- **(b) an eval coordinator doing session begin/run/commit itself** — over-built, and worse than
  over-built: it would be a second implementation of the thing being measured, so any cost it
  reported would be the cost of the eval's copy of the pipeline rather than of the pipeline.
- **Editing `runStep` to compute its `scopeKind`** (from an `AsyncLocalStorage` eval marker, or
  from a dedicated eval owner id). Works, and was the plan until `withSpendAttribution` turned out
  to be enough. Costs a new production module plus a branch in the queue, for nothing extra.
- **Asking the cost-tracking agents to exclude eval owners/slugs from Product** — a change to
  `scripts/ai-cost.ts`, which we are read-only towards, to buy something `ScopeKind` already buys.

### The one residual risk, and how the runner must detect it

The overlay covers calls made **inside** `step.run`. A model call made elsewhere inside
`runStep`'s collector — in `session.commit`, or a postcondition — would still be `job_step`.
I checked: the ingest commit path buys nothing (embeddings are bought on the request path,
`src/article-vectors.ts` via `src/routes.ts`, not in a step). But that is true *today*.

So the runner must, after every job, read `costStore.forJob(jobId)`
([`src/store/ai-calls-pg.ts:206`](../../src/store/ai-calls-pg.ts) — note
`forJob` exists, so the plan's "no `forRun`, read a window and filter" is unnecessary) and
**refuse to continue if any row is not `scopeKind: "eval"`**. The dry pass's control arm is what a
leak looks like, so this check has been seen to fail.

---

## Decision 2 — fixture ingress: replace stage 1 through `AdvanceParts.steps`

**Chosen: a fixture `fetch` step supplied through the existing narrow seam.** No production change,
no SSRF guard weakened, no store internals touched.

### The evidence

- `fetchDocument` takes HTTP(S) only and refuses loopback, `localhost`, `*.localhost`, and the
  10/127/172.16-31/192.168 ranges — [`src/fetch.ts:825-960`](../../src/fetch.ts).
- The fetch step's product is a `RawManifest`, and `writeRaw(doc)` is an **exported** function that
  puts the bytes in the content-addressed `sources` bucket and returns the manifest —
  [`src/fetch.ts:246`](../../src/fetch.ts). Everything after stage 1 reads
  that manifest and cannot tell where the bytes came from
  ([`src/pipeline.ts:1315-1324`](../../src/pipeline.ts) says so explicitly
  about the upload half).
- `advanceJobWith(id, { session, steps })` lets a caller supply the step registry —
  [`src/jobs.ts:1319`](../../src/jobs.ts), and `advanceJob` is literally
  `advanceJobWith(id, PRODUCTION)` ([`src/jobs.ts:1142`](../../src/jobs.ts)).

So the runner drives `advanceJobWith(id, { session: claimSession, steps: { ...evalSteps, fetch: fixtureFetch } })`.
Stage 1 — the one step that costs nothing and the one the eval wants held byte-constant — is the
only thing replaced. Extract, blocks, hierarchy, labels and assets are production `STEPS`, run
through the production `claimSession`, the production commit and the production ledger.

The dry pass proves the substitution is real end to end: `fetch` reported `19 KB (fixture)` and
`extract` came back with the fixture's real title, `Tufte CSS`, and `blocks` produced `70 blocks,
70 new ids`.

### Rejected

- **A tiny local static server on a non-loopback interface.** The box's LAN address is in a private
  range and is blocked by the same guard; only the box's *public* IP would pass, which means
  serving fixtures publicly for the run and does not work on Greg's Mac at all.
- **A fixture-input seam in the pipeline** (`file:`/`fixture:` scheme, or an env switch on the
  fetch step). That is an SSRF-guard bypass living in production code so that an eval can run —
  precisely the thing to keep out of `src/`.
- **Seeding the `raw` artefact directly and letting `fetch` skip.** `stepIsDone` would answer yes
  ([`src/pipeline.ts:877-890`](../../src/pipeline.ts)) and the blob store is
  content-addressed, so it would work — but writing the artefact needs an `articles` row and a
  draft revision first, and those are created *by the job* inside `lockOrCreateArticle`
  ([`src/store/pg-revisions.ts:432`](../../src/store/pg-revisions.ts)). An
  eval reaching in there is an eval reaching into another stage's storage internals.
- **The upload path.** It is a genuine production ingress for constant bytes, and the PDF fixture
  can legitimately use it — but `acquireUpload` refuses anything that is not `%PDF-`
  ([`src/pipeline.ts:1239`](../../src/pipeline.ts)), so it cannot carry the
  two HTML fixtures, and it needs an `uploads` row plus a staged Storage object. Not worth two
  ingress mechanisms; use the fixture step for all three.

### What this costs, stated rather than hidden

Stage 1 is not measured. It costs no model call, so the money is unaffected; what is lost is
real-world fetch latency, which the report should say it excludes.

### A note that belongs in `src/jobs.ts`

`AdvanceParts`' doc comment says the seam is for a different *storage backend* and is "not an
injection framework". The cost eval is a second legitimate caller, and the comment should say so —
a one-line doc edit, no code change.

---

## Decision 3 — shared-state safety

### The in-process pump is the trap, and it is not in the plan

`enqueue` ends with `pump(job.id, owner)` ([`src/jobs.ts:2155`](../../src/jobs.ts)),
and `pump` calls `advanceJob` — the **PRODUCTION** registry
([`src/jobs.ts:1035-1043`](../../src/jobs.ts)). It starts synchronously
inside `enqueue`, so it claims the job before the caller can, and the whole job then runs with
production's `fetch` (which goes to the network) and with no eval overlay.

I hit this on the first run of the dry pass: the fixture step never executed and the job died in
production's `requireUrl`. **This is the thing that would have silently produced a corpus of
network-fetched, Product-attributed articles.**

The fix is the existing idiom, `VERCEL` set across the `enqueue` call and nothing else —
`tests/claim-session-postgres.test.ts:780-794`, whose comment says it is there "only to stop
`enqueue`'s pump". Unset immediately afterwards so the steps themselves run with the ordinary
`dataRoot()`.

```ts
process.env.VERCEL = "1";
try { job = await enqueue({ slug, url, steps }); } finally { delete process.env.VERCEL; }
await drive(job.id, { session: claimSession, steps: evalRegistry });
```

### The rest of the checklist

| Requirement | How | Verified |
|---|---|---|
| Local-target assertion | parse `DATABASE_URL`, refuse any host but `127.0.0.1`/`localhost`/`::1`; refuse unless `STORE === "postgres"` (`src/store/live.ts`) | in the dry pass; prints a `Target:` line like the `db-*` scripts |
| Collision-proof slugs | `evalcost-<runTag>-<fixture>` **plus** a unique per-run `url`; `enqueue` then routes through `freeSlug` → `slugWithShortId` ([`src/jobs.ts:2326`](../../src/jobs.ts)) and appends a `spya-…` short id. A repeated URL would *adopt* an existing article, so the URL must carry the run tag too | slugs came back as `evalcost-dpmtk754xz-eval-spya-w3y3w5` |
| Record every created id | the runner keeps `{ slug, jobId }` per draw; `articles.slug` is unique so the article id is one query | yes |
| Cleanup deletes exactly those | `DELETE FROM spideryarn.articles WHERE id IN (…)` then the jobs by slug prefix | articles 33 → 31 for two created; `ai_calls` count unchanged |
| Ledger history retained | `ai_calls.article_id` is `on delete set null`, `article_slug` is kept beside it as the historical fact ([`src/db/schema.ts:2017-2035`](../../src/db/schema.ts)) | **checked against the live database**, not the ORM: `ai_calls_article_id_articles_id_fk` has `confdeltype=n` (SET NULL); the owner FK has `confdeltype=r` (RESTRICT) |
| Dedicated eval owner | **not done — see the coordination points.** Runs as the dev owner today; slug prefix + `scopeKind` do the isolating | — |

### A free dry pass cannot publish, and that is correct

The dry pass ran `fetch, extract, blocks` and the job ended `error` with *"Refusing to publish …:
it has no tree"*. Publication requires a `hierarchy` tree, and hierarchy is the step that costs
money. So a no-spend pass proves everything up to publication and cannot prove publication. A real
(paid) run includes hierarchy and publishes normally. Worth knowing before somebody reads a red
job status as a broken harness.

---

## Coordination points — for Greg or the cost-tracking / auth agents

1. **The local dev database cannot write to `ai_calls` at all right now, and `npm run cost` cannot
   read it.** Migration `drizzle/20260902141103_byok_upstream_nanos.sql` is unapplied here, so
   every insert and every `select()` fails with `42703: column "byok_upstream_nanos" does not
   exist` — including `runStep`'s own end-of-job `jobSpend`, which logs *"could not read what this
   job cost"* on every job. And `npm run db:migrate` **refuses to apply it**:

   ```
   Target: postgresql://postgres@127.0.0.1:54362/postgres
   ✗ the journal and this database's migration ledger do not reconcile
     • 1 ledger row(s) belong to no migration in this journal: 1788351034981 — and 1
       migration(s) are still pending …
   ```

   That orphan row is somebody else's (`drizzle/20260902122542_auth_users_token_defaults.sql` was
   applied and the file has since gone from the tree). **I did not touch it** — deciding what that
   row did is the job of whoever wrote it. Until it is resolved, no paid run can record anything.
   This is a hard gate on this stage's successor, and it is *in addition to* the plan's existing
   "has the cost-tracking plan landed" gate.

2. **Dedicated eval owner.** The plan asks for one; creating it means a third entry in
   `SEEDED_ACCOUNTS` (`scripts/seed-accounts.ts:218`), and that file is being edited by the
   auth-seeding agent right now. It is a nice-to-have rather than a blocker: the acceptance
   criterion is satisfied by `scopeKind`, not by owner, and `By owner` in `npm run cost` would be
   the only thing it improves. Ask for it; do not hand-insert a row into `auth.users`.

3. **Nothing else needs agreeing with the cost-tracking agents.** No change to `src/ai-spend.ts`,
   `src/store/ai-calls*.ts`, `src/db/schema.ts` or `scripts/ai-cost.ts` is required by this design.

---

## What a competent implementer builds from this

`evals/cost/run.ts`, modelled on `evals/hierarchy-structure/run.ts`:

1. `loadEnvLocal()`; assert local `DATABASE_URL` and `STORE === "postgres"`; print `Target:`.
2. Wrap everything in `withLedger("eval", …)` (`src/cli-ledger.ts:86`) so any call the runner makes
   *outside* a job step is eval-scoped too.
3. `runAsOwner(evalOwner, …)`.
4. Per draw: build `steps = evalOverlay({ ...STEPS, fetch: fixtureFetch(file) })`; `enqueue` with
   `VERCEL` set across that one call, a run-tagged slug **and** a run-tagged URL; then loop
   `advanceJobWith(job.id, { session: claimSession, steps })` until `done`.
5. Read back with `costStore.forJob(job.id)`. **Assert every row is `scopeKind: "eval"`** and abort
   the run if not. Assert every step expected to pay has non-zero spend (a `$0` cold step is a
   harness failure). Total with `totalRows()` (`src/store/ai-calls.ts:115`), never a naive SQL sum.
6. Record `{ slug, articleId, jobId }` per draw to a results file as it goes, so a crash still
   leaves a cleanup manifest.
7. Cleanup: delete those article ids and those jobs. Leave the ledger rows — that is the point.

A **pre-flight** should be the dry pass itself, kept: one job with the fixture fetch step and a
stubbed paid step, asserting the eval scope round-trips, run before any money moves. That is the
check that has been seen to fail (the control arm), so it is evidence rather than decoration.

---

## Transcripts

### (i) and (ii) — rows land attributable, and stay out of Product

`NODE_ENV=test SPIDERYARN_STORE=postgres npx tsx dry-pass.mts fs` — artefacts in Postgres, ledger
redirected to the test-only file by `selected()` (`src/store/ai-calls.ts:73`), so nothing real was
written. The "model call" is a fabricated `SpendRecord` at $0.0123; no wire, no money.

```
Target: postgresql://postgres:***@127.0.0.1:54362/postgres
Ledger: data/_ai-calls.test.jsonl
Store:  postgres   NODE_ENV=test   mode=fs
A. control — production registry + fixture fetch, NO eval overlay
B. eval    — same, with scopeKind: "eval" overlaid on every step
--- ledger rows for this run, read back by jobId ---
  [control] scope=job_step  step=fetch     job=spya-sf6hks slug=evalcost-dpmtk754xz-control-spya-scnzqm model=DRY-PASS/fake-model credits=12345678
  [eval]    scope=eval      step=fetch     job=spya-btdx27 slug=evalcost-dpmtk754xz-eval-spya-w3y3w5    model=DRY-PASS/fake-model credits=12345678
```

`NODE_ENV=test npm run cost -- --since 2026-09-02`:

```
AI spend — 2026-09-02T00:00:00.000Z → now
Ledger: data/_ai-calls.test.jsonl

Product spend:  $0.0123 over 1010 call(s)
  credits consumed   $0.0123
  1009 call(s) reported no cost, so the figure above is short by an unknown amount.

Eval spend:  $0.0123 over 1 call(s)
  credits consumed   $0.0123

All recorded:  $0.0247 over 1011 call(s)
…
By article
  evalcost-dpmtk754xz-control-spya-scnzqm     $0.0123      1 call(s)
  evalcost-dpmtk754xz-eval-spya-w3y3w5        $0.0123      1 call(s)
…
By scope
  job_step     $0.0123      1 call(s)
  eval         $0.0123      1 call(s)
  request      $0.0000   1009 call(s)  1009 unpriced
```

The control arm is the mutation: without the overlay the identical row is Product spend. With it,
Eval spend. (The other 1009 rows are the test suite's own historical fixture rows in that file.)

### The pipeline really ran, on the fixture's bytes

The job row afterwards:

```json
{ "id": "spya-btdx27", "status": "error",
  "error": "Refusing to publish \"evalcost-dpmtk754xz-eval-spya-w3y3w5\": it has no tree",
  "steps": [
   { "name": "fetch",   "detail": "19 KB (fixture)",              "status": "done" },
   { "name": "extract", "detail": "Tufte CSS",                    "status": "done" },
   { "name": "blocks",  "detail": "70 blocks, 70 new ids (0 kept)","status": "error",
     "error": "Refusing to publish …: it has no tree" }
  ] }
```

`Tufte CSS` is the fixture's own title, read by the real extractor from the bytes the fixture step
stored. The publication refusal is the free-pass limitation described above, not a design fault.

### (iii) — cleanup removes exactly what was created; ledger history survives

`SPIDERYARN_STORE=postgres npx tsx dry-pass.mts pg`:

```
--- cleanup ---
  articles created: evalcost-dpmtk7448r-control-spya-g67aqw=56701647  evalcost-dpmtk7448r-eval-spya-bujdxh=7c78ec28
  ai_calls FK ai_calls_article_id_articles_id_fk: confdeltype=n
  ai_calls FK ai_calls_owner_id_users_id_fk: confdeltype=r
  articles 29 -> 27 (expected -2);  ai_calls 4929 -> 4929 (expected unchanged)
```

`confdeltype=n` is `ON DELETE SET NULL`, read from `pg_constraint` on the live database rather than
from `src/db/schema.ts`. The **row-level** demonstration (delete the article, watch `article_id`
go null while the row and its `article_slug` remain) could not be run, because no row can be
inserted into `ai_calls` on this database until the migration in coordination point 1 is applied —
Drizzle names every column of the table on an insert. That is the one claim in this document
resting on the catalogue plus the schema comment rather than on a round trip.

Final state: `evalcost-%` articles remaining: **0**; `evalcost-%` jobs remaining: **0** (6
articles and 12 jobs left by earlier iterations were deleted too). Two fabricated
`DRY-PASS/fake-model` rows remain in `data/_ai-calls.test.jsonl` — the test-only ledger the
cost-tracking plan is about to purge — and nothing was written to the real ledger anywhere. The
fixture's bytes are also in `data/_blobs` under their sha, which is what content addressing is
for: the next run of the same fixture deduplicates onto them.

Scripts: `scratchpad/dry-pass.mts`, `scratchpad/cleanup.mts` (throwaway, not committed).
