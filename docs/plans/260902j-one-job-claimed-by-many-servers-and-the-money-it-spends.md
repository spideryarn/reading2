# One job, several copies of the server, and the money it spends

**Status: written 2026-09-02.** Greg asked for this after reading `data/_ai-calls.jsonl` and finding
one hierarchy job that made eleven paid model calls totalling $5.43. The first draft of this plan had
the mechanism one level too high — *"several server processes over one `data/`"* — and was corrected
before anything was built; § *The mechanism* is the version with an experiment behind it.

## The job

> one hierarchy job made 11 paid model calls totalling $5.43 — every call `outcome: "ok"`, every one
> with identical `reportedInputTokens: 20023` … ~30× the happy-path cost of the step.
>
> — Greg, 2026-09-02

The brief called it a *truncation retry cost storm*. **It is not a retry, and it is not about
truncation.** Both are what the ledger looks like from a distance; neither survives the diagnosis.

## The diagnosis

### What the ledger actually says

Grouped by `jobId` and by the `job` field — which separates the one structure call from the label
batches — the duplicated **structure** calls are:

| job | slug | structure calls | on those calls | whole job | how they came back |
|---|---|---|---|---|---|
| `spya-v2f7b3` | read (08:29) | **6** | $0.30 | $0.39 | **all six fine** |
| `spya-p38nga` | towards-a-theory-of-bugs (14:05) | 10 | $4.81 | $5.05 | 6 at the ceiling, 3 below it, 1 `error` |
| `spya-zf0bgj` | towards-a-theory-of-bugs (17:48) | 11 | **$5.43** | $5.57 | 6 at the ceiling, 5 below it |
| `spya-gv99gh` | towards-a-theory-of-bugs (17:53) | 2 | $0.82 | $0.82 | 1 at the ceiling, 1 below |
| `spya-ug2qtq` | towards-a-theory-of-bugs (13:51) | **1** | $0.32 | $0.32 | one call, 269s, no storm |

Greg's $5.43 is `spya-zf0bgj`'s eleven structure calls to the cent, so that is the job he was
looking at. $11.83 in one afternoon on one article, against $0.32 for the run that behaved.

Three rows of that table kill the original framing.

**"Every call hit `max_tokens`" is false.** Outputs of 32,913 / 26,856 / 25,748 / 47,605 / 21,830
tokens are well under the 52,225 ceiling.

**The `read` row settles it.** `read` is a tiny article — 1,867 input tokens, ~50 seconds a call —
and all six of its structure calls came back `ok` with a usable tree. **The storm happens on success
as well as on failure**, and on a successful ingest nobody looks at the bill.

**`spya-ug2qtq` is the control.** Same article, same afternoon, one call. Whatever causes the storm is
intermittent, and the burst/quiet pattern is the clue.

The calls **overlap in wall clock**: `spya-zf0bgj`'s eleven started 17:48:10 → 17:53:23 and the first
did not finish until 17:53:27. A serial retry chain cannot produce that. Neither can the Anthropic
SDK, constructed with `maxRetries: 0` in [`src/messages-stream.ts`](../../src/messages-stream.ts) —
*"one record, one call"* — nor [`src/hierarchy.ts`](../../src/hierarchy.ts), which has no loop around
its single `streamMessage`.

`runId` is minted once per `collectSpend()` ([`src/ai-spend.ts`](../../src/ai-spend.ts)) and
`collectSpend` wraps a step exactly once (`runStep`, [`src/jobs.ts`](../../src/jobs.ts)) — which the
`labels` rows sharing their parent's `runId` independently confirm. Every one of these calls carries
a **distinct `runId`**, so each is a separate, *granted* `claim()` on the same job.

### The mechanism

**Every save to a file the server imports restarts the dev server, in the same process, with a fresh
copy of every server module — and does not stop the step that is running.**

*A file the server imports*, not every file under `src/`: the trigger is membership of the bundled
config graph, so `src/web/**` and anything else only the client reaches gets ordinary HMR and no
restart. The 175 files that do trigger it are the whole of the API.

Run on this box on 2026-09-02, `npx vite --port 5721`, then `touch src/hierarchy.ts`:

```
2:12:58 PM [vite]   VITE v8.2.2  ready in 5829 ms
2:13:11 PM [vite] src/hierarchy.ts changed, restarting server...
2:13:13 PM [vite] server restarted.
```

The chain, each link checked in the code:

1. **The whole server is part of the Vite config graph.** `vite.config.ts` mounts the API with
   `await import("./src/routes.js")` inside `configureServer`. Vite's config bundler externalises
   only non-relative specifiers, so that dynamic import is **bundled into the config** — 175
   `configFileDependencies`, `src/routes.ts`, `src/jobs.ts`, `src/store/jobs-fs.ts` and
   `src/hierarchy.ts` among them.
2. **A change to any of them restarts the server** (`isConfigDependency` → `restartServerWithUrls`),
   which is what the transcript above shows. `devWatchIgnored`
   ([`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts)) ignores only `data/`, `docs/`,
   `evals/` and a peer's worktrees. `src/**` is watched.
3. **The restart re-evaluates the modules and keeps the process.** `loadConfigFromBundledFile` writes
   a uniquely named temp file and `import()`s it, so the module registry cannot dedupe it: a second,
   independent copy of `src/jobs.ts` and `src/store/jobs-fs.ts`, with new empty `index` and
   `attempts` Maps. `server.close()` destroys the open sockets; nothing cancels the in-flight
   `handleApi` promise, so the model call keeps going and keeps being billed.
4. **The new copy hands the job straight back out.** `ready()` → `loadFromDisk` → `sweepStopped` sees
   `status: "running"` on disk and rewrites it to `queued` with the step back to `pending`, on the
   premise *"this process has just started, so nothing on disk can have work happening against it."*
   The premise is false: the process did not start, only the module did. `claim` then passes, and
   `stepIsDone` says `hierarchy` is not done, because the artefact is not written yet.
5. **The browser supplies the next advance about eight seconds later.** Its `POST
   /api/jobs/:id/advance` was severed by the socket destroy; `jobEngine.step`'s catch waits
   `IDLE_MS = 8000` and re-POSTs ([`src/web/jobEngine.ts`](../../src/web/jobEngine.ts)). The observed
   gaps — 9.3, 5.6, 8.3, 8.0, 6.0, 9.0, 5.0, 61.0, 12.0 seconds — are that, with a second tab
   explaining the sub-8s ones and a lull in editing explaining the 61.
6. **Nothing stops the abandoned runs.** Each old copy's `fenced()` reads *its own* `index` and
   `attempts`, where the job is still `running` under its own still-live attempt, so it never raises
   `StaleAttemptError`. Each of the ten finished its call, was billed, and wrote a complete terminal
   job record over `data/_jobs/spya-p38nga.json`. Last writer wins — the file's `finishedAt`
   14:15:43.981 matches the run that started at 14:07:31.768, and so does its step `startedAt`.

The `AbortController` that could have stopped any of them is in the discarded copy's `aborts` map,
and the signal *is* wired all the way to the SDK's `fetch` — so a Stop pressed after a restart
reaches nothing either. That is a second, quieter bug with the same cause.

### What was ruled out

- **Two claims racing inside one module copy.** Impossible: `claim` is synchronous from `ownedBy` to
  `job.status = "running"` after its single `await ready()`.
- **Lease expiry.** `LEASE_MS` is 760,000 against claims 5–9 seconds apart.
- **The client disconnecting and aborting the walk.** The advance route wires nothing to
  `res.on("close")`; only `sse()` does.
- **Retry or Stop.** `retryJob` mints a *new* job id; `cancelJob` only sets a flag on a live claim.
- **In-step retries.** The `runId` accounting above rules them out, and there is no such loop.
- **Several OS processes over one `data/`** — possible in principle (there are three `vite` servers
  from this checkout in `ps aux` right now), but it would need ten of them each receiving an advance
  for this job id 5–9 seconds apart. It is the same root cause one level up, and the fix below covers
  the proven mechanism rather than the coincidence.

### (b) Which commit and which mode

**Files mode** — `SPIDERYARN_STORE` unset, which [`src/store/live.ts`](../../src/store/live.ts)
resolves to `"files"`. Still the default; still what every laptop and this box run.

The claim arrived with `c109658` (2026-08-27, *"Take the queue out of one process's memory, and put a
claim where the Map was"*), which put the fence in a module-scope Map. It replaced a `p-queue` whose
concurrency-1 promise was equally module-scope, so nothing regressed — the hole is as old as the
queue. What made it expensive was `ceec42f` (2026-08-30, *"One claim walks the whole job"*): after it,
a duplicate claimant runs the **whole ingest** rather than one step. Nothing since has touched it, and
`c42c940` says as much — *"the filesystem branch is untouched and is still what every laptop runs."*

### (c) Does the Postgres queue still permit it? No.

[`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) `claim` locks the `queue_state` singleton `for
update nowait`, counts running rows inside that lock, and `claimIn` then does one atomic statement:

```
update jobs set status = 'running', attempt_id = $attempt, lease_expires_at = …
 where id = $id and owner_id = $owner and status = 'queued' and cancelling = false
```

`status = 'queued'` is the fence and the database enforces it, so a fresh module copy is told `busy`.
`settleExpired` only ever moves a lapsed job to a **terminal** status, so a lease lapse cannot hand a
running job to a second claimant either.

The residue under Postgres is different and smaller: a restart abandons one still-billed call, and
the job is unclaimable until the 740-second deadline lapses. Real, and not this plan's.

### The class

**A safety property asserted in a comment and enforced by nothing** — *"One process. The index is
this process's memory"* — where the thing that falsifies it is not a race in the code but a fact
about how the code is run. It is silent by construction: duplicated work produces the *same right
answer*, so the only signal is a number in a ledger nobody reads.

### Why 2026-08-26's fix did not cover it

[260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md) fixed *what one truncation says
and whether Retry is offered*. Correct, and orthogonal: a `failureKind` that hides a button cannot
help when the duplication happens **before** anything fails and to calls that mostly succeed. Its
model — *"a retry is a new job"* — is true. These are not retries.

The truncation was fixed separately by Greg the same evening in `fb82dc8`, which took the structure
call to `effort: "medium"` because *"the reasoning did not overrun its reservation; it expanded to
fill the ceiling."* So this plan touches neither `effort`, `THINKING_HEADROOM`,
`estimateHierarchyTokens`, `truncationFailure`, nor `src/labels.ts`'s deliberate batch retry.

## What we are going to do

**Give the filesystem job store's state a lifetime of the process rather than of the module.** A
`processSingleton` helper anchored on `globalThis` under a `Symbol.for` key, and the store's `index`,
`attempts`, `keys`, `writes`, `forgotten`, `writeCounter` and `loaded` go through it. A second copy of
the module then shares the first copy's fence: `ready()` does not re-read the directory,
`sweepStopped` does not revive a job somebody is inside, and `claim` answers `busy`.

**And `aborts` in [`src/jobs.ts`](../../src/jobs.ts) with it**, so a Stop can reach a step that a
previous copy started. Same one-line mechanism, and it is the other half of the same bug: a Stop
pressed after a save reached an empty map and did nothing at all.

One small new module and two declarations rerouted through it — with one thing that is not
bookkeeping and has to be got right. **`writeCounter` and `loaded` are primitives**, so they stay
properties of the shared object and are read as `state.writeCounter` / `state.loaded`; destructuring
them the way the Maps are destructured would copy the value into each module copy and quietly restore
exactly the bug being fixed, with every test still green. GPT Sol flagged it before it could happen.

### Why this shape and not the others

- **Not "cap in-job attempts for this failure class."** There is no in-job retry to cap. The attempts
  are in different module copies and mostly succeed; a counter in one of them reads `1`.
- **Not "fail fast after the first truncation."** It already does — and `read` proves the storm needs
  no truncation at all.
- **Not "retry once at lower effort."** Nothing is retrying, and this would add a paid call to fix a
  bug about paid calls.
- **Not a lock file in `data/_jobs/`.** This plan's first draft proposed one, on the multi-process
  diagnosis. With the real mechanism it is strictly more machinery for the same result — a file
  format, a staleness rule, pid liveness, stale-lock recovery — and none of it is needed to fence two
  copies of a module inside one process. It would be the right answer to the *cross-process* hazard,
  which is real but is not what happened and whose proper answer is Postgres.
- **Not "abort the in-flight step when the server restarts."** It looks like the money-saver and it
  is the opposite. Once the fence holds, the abandoned run is not abandoned: it still holds the
  claim, its writes still pass the fence, and the ingest **completes normally** — a restart becomes a
  pause. Aborting would throw away a call that is about to be useful.
- **Not "refuse to boot a second server on one `data/`."** Fixes a different, unproven hazard, and
  takes a working setup away from every agent on the box. Greg's call, named here so it is his.
- **Not "make Postgres the default."** The right end state, already
  [the plan](260831b-finish-the-database-move.md), and not a thing to do inside a bug fix — but
  "the default configuration silently spends six times what it should" should not wait for it either.
- **Not section-by-section resume.** The brief rules it out and the root cause does not ask for it.

### What stays loud

Nothing here salvages a partial answer, softens a truncation, or hides a failure —
[silent-success.md](../reusable/silent-success.md) and 260826a's *"What was deliberately not done"*
both still hold. The only thing made quieter is a second copy's *claim*, which now says `busy`, which
is what it always meant to say.

## Stages

### Stage 1 — the failing test ✅

[`tests/two-servers-one-queue.test.ts`](../../tests/two-servers-one-queue.test.ts). `vi.resetModules()`
plus a fresh `import` is exactly what a Vite restart does to these modules — a second, independent
copy of the store's state over the same `data/_jobs/`. Enqueue and claim through the first copy; claim
through the second.

**Watched red 2026-09-02:** both duplicate-claim cases returned `claimed` where they must return
`busy`. The two cases that guard the other direction — the fence must let go on `releaseStep`, and a
lapsed lease must still be takeable — were green from the start and must stay green.

### Stage 2 — the fence ✅

[`src/process-state.ts`](../../src/process-state.ts), `QueueState` in
[`src/store/jobs-fs.ts`](../../src/store/jobs-fs.ts), and `aborts` in
[`src/jobs.ts`](../../src/jobs.ts).

**Both halves were watched red against the real code and then against a mutation, on 2026-09-02.**
The store half: three cases in `tests/two-servers-one-queue.test.ts` fail with the state private to
the module. The abort half: *"lets a Stop from a reloaded copy of this module reach the running
step"* in [`tests/jobs-walk.test.ts`](../../tests/jobs-walk.test.ts), added because the store test
cannot fail if `aborts` stays module-local — GPT Sol's finding, and it was right, the case goes red
in two seconds against `const aborts = new Map(...)`.

One thing the reds taught, worth keeping: the reloaded copy of `src/owner.ts` gets its **own
`AsyncLocalStorage`**, so a Stop driven through it must open its owner scope through the reloaded
copy too. The first draft of that test was red for that reason rather than for the one it names,
which is the shape of a test that proves nothing.

### Stage 3 — the docs and the postmortem

[260902c-the-truncation-retry-cost-storm.md](../postmortems/260902c-the-truncation-retry-cost-storm.md)
— the real cause, the class named, the commit it belongs to, why 260826a did not cover it, and what
would have caught it. A line in 260826a's *"What is still open"*, because that is where the next
person will look. A line in [ingest-queue.md](../project/ingest-queue.md) saying what the files
adapter now enforces and what it still cannot.

Done when `npm test` is green (`tests/doc-links.test.ts` included) and both Sol reviews have been read
and answered.

## What this does not fix, deliberately

- **The ledger cannot tell a wasted call from a useful one.** `outcome` in
  [`src/ai-spend.ts`](../../src/ai-spend.ts) is `"ok" | "error" | "aborted"` and means *the HTTP call
  completed* — so ten discarded responses are ten `"ok"` rows, and the six duplicate `read` calls are
  indistinguishable from one. A real gap, **not touched here**: other agents are working on cost
  tracking and this plan stays out of their files. It belongs to
  [260902g](260902g-estimate-article-ingestion-and-mode-generation-costs.md), and the postmortem
  records it so it is somebody's.
- **Nothing caps spend anywhere.** [ingest-queue.md](../project/ingest-queue.md) already says so. A
  duplicate-claim fence is not a spend cap and must not be read as one.
- **Every other module-scope cache in the server is still re-created on each restart.** That is
  usually harmless — a cache that starts empty is a cache — and it is only load-bearing where the
  state *is* a lock. The two places where it is are the two this plan moves. Anything else is a
  proposal rather than something to sweep in.
- **Several OS processes over one `data/` remain unfenced**, and the files adapter still says so.
  Evidence that they interfere: `spya-zf0bgj` and `spya-gv99gh` were both active on the same slug at
  once on 2026-08-30, which `activeForSlug` is supposed to make impossible, and `ps aux` today shows
  three `vite` servers from this checkout. **GPT Sol's P1, and it is fair:** this turns a possible
  eleven-call storm into a possible three-call one rather than establishing *one job, one claimant*
  for the default setup. Its recommendation, quoted so it is not softened:

  > make `npm run dev` use Postgres by default, or refuse multiple files-mode servers over one
  > checkout. Keep the process-global fix as a cheap hot-reload repair if files mode remains usable.

  **Left for Greg**, because both options change how every agent on this box works and neither is a
  bug fix. Not slipped in under a postmortem.
- **An expired lease does not prove nobody is still spending**, under either adapter. Abort is
  cooperative and `walkClaim` explicitly handles a step that ignores its signal, so after an expiry
  the job can be terminalised, the reader can press Retry, and the new job's calls overlap the old
  computation still unwinding. That is overlapping spend on one article under *different* job ids —
  a different bug from this one, and not fixed here. GPT Sol.
