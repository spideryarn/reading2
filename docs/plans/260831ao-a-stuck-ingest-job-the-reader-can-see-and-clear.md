# A stuck ingest job the reader can see and clear

> I'm wondering what a user would do if this happened to them in production? We had talked about a
> progress bar for showing the things in queue, with a way to cancel things. Presumably that would
> help with this kind of thing? And/or cancel anything that takes longer than some period (e.g. an
> hour)? Any better ideas?
>
> — Greg, 2026-08-31

**Nothing here is built.** This is the design, the reasoning, and GPT Sol's answer folded in —
[the consultation prompt](260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear-prompt.md),
[Sol's reply](260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear-sol.md).

## Goal

A reader should never be looking at an import that will not finish and cannot be cleared, and should
never be looking at one that *is* fine and cannot tell.

## The thing that reframes the question

**In production the reader's browser tab is the worker.** `pump` in
[`src/jobs.ts`](../../src/jobs.ts) opens with `if (process.env.VERCEL) return`, and
[`src/web/useJobs.ts`](../../src/web/useJobs.ts) is what calls `POST /api/jobs/:id/advance` in a
loop. There is no cron in `vercel.json` and `api/` is one function.

So a wedged job is not a queue that needs draining. It is a job whose only engine has walked away.
Once you see it that way, a queue panel with a Stop button is the wrong first answer — it manages a
queue that has no manager, when the missing thing is a driver.

## The states we can actually reach, and what the reader sees

| # | State | What happens now | Reachable how |
|---|---|---|---|
| 1 | `queued`, nobody driving | Sits still. **Self-heals** the moment the reader opens the shelf or an add page — the first poll drives every `queued`/`running` job it sees | Close the tab between steps |
| 2 | `running`, claimant dead, lease live | Frozen row, no error, no elapsed time, for up to **12.67 min** (`LEASE_MS`). Then the next `/advance` sweeps it to `error` with a Retry | Instance killed mid-step: deploy, OOM, eviction |
| 3 | Stop pressed on state 2 | `cancelling=true` is written and nobody ever reads it. Button says "Stopping…", disabled, same 12.67 min — then reports **interrupted**, not cancelled | Reader tries to fix state 2 |
| 4 | Any of the above, and the reader is reading | **The import stops.** See below | Ordinary navigation |

### State 4 is the one nobody had noticed, and it is not an edge case

`useJobs` is mounted in exactly three places — [`AddPage.tsx`](../../src/web/AddPage.tsx),
[`Library.tsx`](../../src/web/Library.tsx), and `useStepJob` for the tweets panel. `drive()`'s loop
is `while (alive())` and `alive` goes false on unmount.

And the unmount is not conditional. **`App()` is a chain of early returns, so it returns a different
root per route and there is no persistent shell component at all** — every route change unmounts
everything, which is why no amount of moving the hook between page components fixes this. Fable's
correction; the first draft of this plan said "`App.tsx` returns `<Library />` or `<Reader />`",
which is true and understates it.

**So: paste a URL, then click into an article to read while you wait, and the import stops.** It
resumes when you go back to the shelf. Same for `/profile`, `/design`, `/admin`. This is not a crash
path; it is what a reader does.

Two things follow. It is the largest single cause of "my import is stuck" we have, and it is invisible
in testing, because a developer watching an ingest is by definition on the page that drives it.

## Answers to the two ideas in the question

**A queue panel** — no, and Sol agrees. It duplicates `JobCard`, adds a second place where status and
actions can disagree, and makes queue management a feature of a reading app. The add page and the
shelf box are already the surfaces. What is missing is that the driver is tied to them.

**An hour-long auto-cancel** — no, and this is the clearest "don't". The pipeline's measured worst
case is ~520s of real work; the lease is 12.67 minutes and **already is the timeout**. An hour is not
extra safety, it is a second, weaker account of liveness that can disagree with the first. In Sol's
words: meaningless for `queued`, which may simply be waiting for the reader; far too late for
`running`, whose claimant is already invalid after 12.67 minutes. The database lease, compared
against database time, is the correctness clock. Elapsed time is a *display* clock and must never
decide ownership.

## What to do, in order

**Revised 2026-09-01 after Fable's review** ([the brief and the answer are quoted below](#fables-review)).
The plan was a list of six independent patches; Fable's argument is that one refactor makes three of
them fall out, and that the incremental version of stage one is *quietly incoherent* — a shell driver
has to **discover** jobs before it can drive them, so it needs its own poll, and we end up with two
pollers and two accounts of the same list. That is right, and the plan below is the refactor.

### Stage 1 — the job engine

The whole of the reader-visible bug, and both reviewers' "if you build only one".

**Shape.** `createJobEngine(deps)` for isolated tests, plus one exported module-scope `jobEngine` for
production — Sol's amendment, and it is what makes every test below writable without a component.
The engine owns the poll timer, the jobs snapshot, the visibility rules and the `drive()` loops.
`useJobs` becomes a `useSyncExternalStore` subscriber over the engine snapshot, plus the action
methods, which stay where they are — an action is a fetch and belongs with the card that fires it.

**Not a React provider.** Fable's conclusion, though Sol is right that Fable's *reason* was wrong:
React preserving a component at the same position and type is contractual, not accidental, and
`App` could grow one `<JobEngineProvider>` around an `<AuthenticatedRoutes>` without touching every
branch. The reason that survives is the one Sol gives: **the engine is an imperative tab-level
service, not React view state.** A provider whose only consumer is `useJobs` buys dependency
injection that the factory already buys.

- [ ] **Decide the shape first, then write the red test.** The original checkbox — "mount the
      reading view and assert `/advance` is still called" — proves the wrong thing: after the fix
      *nothing route-scoped* drives, so a reading-view test is green before and after.
- [ ] **`src/web/jobEngine.ts`**: factory + singleton. Snapshot carries at least `jobs`, `loaded`,
      poll failure, and per-job driver health.
- [ ] **Say who owns `error`.** Today it deliberately conflates poll and action failures, and
      `lastFailure` survives a successful poll. "Actions stay in the hook" does not answer what a
      successful *engine* poll does to a hook-local action error. Write the rule down before
      building: `error` is engine state meaning *is anything wrong right now*; `lastFailure` stays a
      per-subscriber ref meaning *why did the last thing I pressed fail*, cleared only by that
      subscriber's next successful action. `tests/refused-job-reason-survives.test.tsx` is the pin.

#### Completion is a cursor, not a set

The plan first said "a per-subscriber `announced` Set", copying today's code. **Sol showed that is
not sufficient**, and this is the one place the refactor can introduce a bug the current code does
not have: the engine can see a completion **between a subscriber's render and its subscription
effect**, and a Set seeded in the effect would baseline that real completion away as history.

- [ ] A **monotonic completion-event sequence** on the engine. Each subscriber captures the current
      sequence during its **first render**, then consumes events past that cursor. Events are kept
      only long enough to be consumed.
- [ ] The contract, in one sentence: *notify this subscriber once when a job transitions to `done`
      after that subscriber began observing; never announce a job already done when it arrived.*
- [ ] The pinning test arranges exactly this, and it is Sol's sequence:
      1. snapshot already contains done `A` and running `B`;
      2. subscriber 1 renders and captures its cursor;
      3. `B` becomes done **before** subscriber 1's effect is flushed;
      4. subscriber 1 gets `B` exactly once and never `A`;
      5. subscriber 2 mounts after `B` is done and gets neither;
      6. `C` goes running → done; both get `C` exactly once;
      7. an identical repeated snapshot emits nothing.
- [ ] This touches **every** `useStepJob` caller, not the four the stale comment in
      `useStepJob.ts` names: `useArc`, `useGlossary`, `useIdeas`, `useQuotes`, `useSketch`,
      `useTimeline`, `useQuiz` and `Tweets.tsx`, plus `Library`'s `reload`. Fix that comment while
      you are there — it is the same species of stale comment `useJobs.ts` already calls out about
      "six pollers".

#### When the engine polls, and the request budget

- [ ] **`start()` / `stop()` from a `useEffect` in `App.tsx` keyed on `user.id`** — not on a truthy
      user. `start()` must be idempotent.
- [ ] **A generation/epoch**, so a response in flight from before a `stop()` cannot write into a
      later session's snapshot. Clear snapshot, errors, completion history, timers and the
      visibility listener when identity changes. Public jobs omit `ownerId`, so the engine cannot
      work out for itself that its cached snapshot belongs to the previous reader.
- [ ] **Test React Strict Mode's start → stop → start with a deferred old poll.**
- [ ] **This changes the network shape for owners, deliberately, and one existing test asserts the
      old shape.** `tests/public-network-trace.test.tsx` pins that a signed-out visitor makes no
      `GET /api/jobs` and an owner *with a band open* does. The visitor half must stay true and is
      non-negotiable. The owner half changes, because the point of the engine is that it does not
      depend on which route is mounted. To keep that from becoming an unbounded idle poll on every
      reading view: **the engine polls at the active cadence while any job is active, and otherwise
      only while at least one subscriber is mounted; with neither, it sleeps until poked.** So an
      owner reading an article with nothing running costs one poll at session start and then
      nothing. Update the test to that rule and say in it that the change was intended.

#### 401 and sign-out

- [ ] **Stop only on the *final* 401.** `apiFetch` already refreshes and retries once, so a first
      401 is not news. Do not sign the reader out: pause every poll and drive loop, keep a visible
      authentication failure, and resume on a new session/token event, a reload, or an explicit
      successful recovery.
- [ ] **The engine cannot identify a 401 today.** `readJson` throws an ordinary `Error` carrying no
      status, and parsing prose for it is not acceptable. Inspect `Response.status` before
      `readJson`, or introduce a typed HTTP error — the latter is the long-term-best of the two and
      is small.
- [ ] **Sign-out is not Stop.** Stop scheduling, generation-fence anything in flight, clear the old
      reader's snapshot at once — and leave the durable job alone. The reader did not cancel it; it
      is reconciled when its owner returns. An `/advance` already admitted may finish.

#### Preserving what was a bug first

Each of these is asserted by a comment in `useJobs.ts` and each was a bug before it was a rule.

- [ ] Pausing the poll must not pause `drive`.
- [ ] **A hidden `poke` still makes exactly one reconciliation request.** Sol: this is the one most
      likely to be lost, because the conventional refactor puts `if (!visible()) return` at the top
      of the poll and silently eats it — **and the existing suite does not prove it.** New test:
      visible baseline poll → hide → fire an action that pokes → observe exactly one `GET
      /api/jobs` → advance well past `IDLE_MS` → observe no second poll → if that reconciliation
      found a job, observe `/advance` continuing while hidden.
- [ ] `visibilitychange` polls at once on return.
- [ ] `done` is the only thing that ends a drive loop; an error does not — it waits and retries
      inside the loop, because the thing that used to restart it was the thing that got paused.
- [ ] Two subscribers still produce one poll. Keep that test after the refactor.
- [ ] `sameJobs` still suppresses identical snapshots.
- [ ] **`drive`'s `alive()` parameter should go.** It exists to stop a loop when a *mount* ends, and
      after this there is no mount to end. Delete it deliberately rather than leaving it as a
      always-true vestige.
- [ ] **Tests that must be rewritten, not merely re-run**: `tests/idle-work.test.ts` and
      `tests/refused-job-reason-survives.test.tsx` both assume mounting `useJobs` starts a poller
      and assert exact poll counts. `tests/sketch-view-drawing.test.tsx` depends on the real drive
      loop under fake timers. The five files that `vi.mock` the whole hook are the safety net that
      proves the external contract survived — keep `useJobs(onFinished?) => UseJobs` unchanged.
- [ ] **A test with zero components mounted**: jobs advance with no React at all. That is the proof
      the engine is really route-independent, and it is only writable because of the factory.

### Stage 2 — Stop means what it says

- [ ] **Rename the contract.** `failExpired` will no longer always fail, so its name, its `JobStore`
      doc, its return type and the log in the advance path (`failed N job(s)`) all become false.
      `settleExpired`, returning typed outcomes — `{ id, status: "error" | "cancelled" }` — and
      neutral wording in the log.
- [ ] It settles a row carrying `cancelling=true` as **cancelled**, not `error` / INTERRUPTED. It is
      currently the odd one out: `releaseStepIn` already settles a live claimant's release on a
      `cancelling` job as cancelled, and the fs adapter's `sweepStopped` does the same on restart. So
      this makes three mechanisms agree rather than adding a fourth.
- [ ] `requestCancel` grows a branch: `running` with an **expired** lease goes straight to
      `cancelled`, in the same statement, compared against database time.
- [ ] **That branch must copy `settleExpired`'s field set, not `requestCancel`'s running branch** —
      Fable's catch. In particular it must null `draftRevisionId`: the running branch deliberately
      leaves the pointer alone because the claimant disposes of it, and going terminal while holding
      it means `sweepAbandonedDrafts` spares that draft for ever. That is the exact leak GPT Sol's
      2026-08-30 finding closed in `failExpired`. Also `attemptId`, `leaseExpiresAt`, `finishedAt`.
- [ ] **A cancelled settlement must also clear stale `error` and `failureKind`** — Sol. A job that
      failed a step, was retried, and is then cancelled would otherwise carry the old sentence.
- [ ] **A terminal job must not retain a step whose status is `running`.** Both current expiry paths
      allow it, so the card can show a spinner on a job that is over. Define how the active step
      settles, and assert that no terminal job contains a running step.
- [ ] The **fs adapter needs the matching branch** (checking its `attempts` map), or
      `tests/store-jobs-parity.test.ts` should be the thing that says so first. A hidden claimant on
      a laptop is rarer but real — two dev tabs.
- [ ] **Use database time.** The plan said "compared against `now()`" and the code does not: Postgres
      currently creates and compares lease times with the application's `Date.now()`. Since this work
      is already inside claim expiry, move production claim creation, expiry comparison and
      `finishedAt` to SQL `now()`, keeping injected dates for tests only.
- [ ] **No "Force stop" before the lease expires.** A live claim may genuinely be working, and
      clearing it is how you get two writers. The copy carries the wait.
- [ ] **No migration.** `cancelling`, `lease_expires_at` and `jobs_lease_idx` all exist. Said out
      loud so nobody goes looking.

### Stage 3 — reconcile where the reader already is

**Must follow stage 2**, and Sol is right that this is an ordering constraint rather than a
preference: land it first and a reader who pressed Stop gets passively reconciled to
`error`/INTERRUPTED before the cancellation fix exists.

- [ ] `settleExpired(now?, owner?)` — **the same method, owner-scoped**, not a sibling. An owner
      parameter keeps `tests/store-jobs-parity.test.ts` exercising one contract; the fs adapter's
      version is a filter on its `attempts` map.
- [ ] `listJobs()` in `src/jobs.ts` calls it **only if the list it just fetched contains a `running`
      job**, and re-lists if anything was settled. The candidate is "any running job", not "any
      expired lease", because the app-level `Job` cannot see leases and exporting them to sharpen
      the gate would violate the design.
- [ ] **Say the cost honestly rather than calling it free.** A zero-row indexed `UPDATE` takes no
      row locks and writes no WAL, but it is still a Vercel→Postgres round trip, a pool checkout, a
      parse and a plan. At one poll a second it roughly **doubles database round trips while a job
      is running**. Bounded to active periods, and worth it for passive reconciliation — but measure
      it and write the number down, do not assert "costs nothing" as the first draft did.
- [ ] **The list path needs the same id-bearing warning log** the advance path has, or the new
      common route to settling a dead claimant leaves no server-side account of it.
- [ ] **Do not make `list()` reconcile inside the adapter.** The `JobStore` thesis is transitions,
      not patches; a list that mutates would be the first read-that-writes and the parity tests are
      not shaped to catch its divergence.
- [ ] Keep the existing global call in the advance path — belt to this suspender.

### Stage 4 — one place that says what state a job is in

- [ ] `src/job-state.ts`, beside `src/job-failure.ts`, which is the established precedent: one place
      that decides what the card offers.
- [ ] **`displayJob(job, now)` — pure, with the clock injected.** `slow` is not derivable from a
      `Job` alone, and a mapper that reads the wall clock is a mapper nothing can test. Decide
      whether the threshold is global or per-step, and test a malformed and a future `startedAt`.
- [ ] It maps to a **display** state — `waiting | working | slow | stopping | interrupted | failed |
      stopped | done`. The constraint that makes it correct: **`Job` on the wire carries no lease.**
      `leaseExpiresAt` lives on the pg row and the fs `attempts` map and never reaches `publicJob`,
      so "running, lease expired" is invisible to the client until stage 3 reconciles it — a
      feature, not a gap. Do **not** take lease timestamps: that re-derives ownership in the browser,
      which this plan's own rule forbids.
- [ ] **`interrupted` is not derivable from `failureKind: "retry"`** — many failures are retryable.
      Name the exact classifier; the canonical `INTERRUPTED` identity is the candidate.
- [ ] It **calls** `jobWorthRetrying` rather than absorbing it — that function is also the server's
      spend gate in `retryJob` and must stay independently importable. (It moved from
      `AddArticle.tsx` to `src/job-failure.ts` in a peer's in-flight work; check before importing.)
- [ ] **Decide where transport health goes.** Consecutive advance failures are client state and are
      not on `Job` at all. Either `displayJob` accepts it as a second input, or stage 4 keeps
      transport health explicitly separate. Say which.

### Stage 5 — say the time, and say the dependency

- [ ] `JobStep.startedAt` is already on the record and nothing displays it. A running step should
      read `Building the hierarchy · 2m 14s · 18 KB received`, with a measured "this often takes a
      few minutes" where `data/_ai-calls.jsonl` gives us one and nothing where it does not.
- [ ] Distinct copy per state, driven by stage 4: *Waiting to continue*; *This is taking longer than
      usual — you can stop it*; *Stopping after the current step…*.
- [ ] **No determinate progress bar.** Response size and provider latency are both unknown, so a
      percentage would be invented — [silent-success.md](../reusable/silent-success.md) with a
      number on it.
- [ ] Say the browser dependency out loud on the add page: *"Keep a Spideryarn tab open while this
      imports. If you close them all, it will continue when you return."* Until there is a real
      background runner, calling this a queue without saying that over-promises.
- [ ] Per-job **advance-failure health** in the engine snapshot: an exact threshold, reset on
      success, cleanup when a job disappears or finishes, and the sentence *"Spideryarn can see this
      import but cannot continue it right now. It will keep trying."*

### Stage 6 — the 409 points at the job it is talking about

Split out of stage 5, because **Sol showed it is not the small change it looked like**. Returning an
id alone will not make the blocking job appear: the generic route handler emits only `{ error }`,
`readJson` discards structured failure fields, and `useStepJob` filters the job list down to jobs
writing the *requested* step — so a blocker whose steps do not include it cannot render in
`JobProgress` at all.

- [ ] Specify, before building: the structured 409 body, the typed client result, what `StepJob`
      exposes, and how `JobProgress` renders a blocker whose step list does not contain the step
      that was asked for.
- [ ] `enqueue` already has the blocking job in hand at the throw site, so the server half is cheap;
      the client half is the work.
- [ ] The message must also stop saying *running* when the job may be idle in `queued`.

## The simpler options passed over

- **A Vercel cron.** Genuinely boring — one entry in `vercel.json`, one route. Rejected for now, and
  Sol put the reason better than the "no infrastructure" reflex would have: *a cleanup-only cron
  turns dormant work into failed work while nobody is watching.* It repaints statuses; it does not
  finish an import. A cron becomes the honest answer the day the promise is "paste this and close the
  browser" — and on that day it should be a scheduler that **claims and advances**, not a sweeper.
- **`stale_after` on queued rows**, so `failExpired` can see them. Rejected: a queued job has no
  unsafe owner to evict, and failing it just before the returning browser could have continued it
  manufactures a failure. The remedy for abandoned-queued is rendezvous, not expiry.
- **Takeover instead of failure on an expired lease.** Still no. The lease proves the old attempt may
  not commit; it does not make partially-written artefacts transactional
  ([260827j-transactional-stage-runner.md](260827j-transactional-stage-runner.md), not built). And
  the gap is one click: completed steps skip in milliseconds, so Continue repeats only the
  interrupted step and does not silently re-pay for a model call.
- **Sweeping on every authenticated request.** Couples unrelated reads to ingest mutation and still
  does not guarantee useful traffic.

## The failure this design will still have

Sol named one we had not: **the driver can fail while the poll succeeds.** `drive()` catches an
`/advance` rejection, waits, and retries, silently and forever. If `GET /api/jobs` keeps working
while `/advance` returns 500 — a bug in one route, a step that throws on this article every time —
the card sits confidently at `queued`, no lease exists to catch it, and every status poll looks
healthy. That is [silent success](../reusable/silent-success.md) in the one loop built to prevent a
stalled ingest.

- [ ] Count consecutive advance failures in the client. Past a short threshold keep retrying but say
      so: *"Spideryarn can see this import but cannot continue it right now. It will keep trying."*
      Keep Stop live. Client state, not a durable job status — it is a communication failure, not an
      ownership one.

And one of mine: **"your tab went away" and "this article cannot be imported" both end as
INTERRUPTED with a Retry button.** They deserve different sentences, because only one of them is
worth pressing Retry on twice.

## References

- [ingest-queue.md](../project/ingest-queue.md) — the design, the library choice, and the two
  earlier cancel bugs this is downstream of. Update it when any of the above lands.
- [`src/jobs.ts`](../../src/jobs.ts) — `pump` (§ the `VERCEL` early return), `LEASE_MS`, `advanceJob`,
  `enqueue`'s 409.
- [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) — `failExpired`, `requestCancel`, `claim`.
- [`src/web/useJobs.ts`](../../src/web/useJobs.ts) — `drive`, the visibility gate, the `driving` set.
- [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx) — `JobCard` and the earlier-imports
  disclosure.
- [copy.md](../project/copy.md) — where the reader-facing sentences above belong.

## Fable's review

Asked on 2026-09-01 to pressure-test the incremental plan against Greg's "cleanest, long-term-best
way, which could include refactoring". Eight questions, and the four answers that changed this doc:

- **The incremental stage 1 was incoherent.** A shell driver must discover jobs before it can drive
  them, so "move only `drive`, leave the poll with the cards" ends in two pollers and two accounts of
  one list. Either the whole engine moves or nothing does.
- **A module-scope singleton, not a React provider**, with the reasons now in stage 1. The strongest
  of them: a provider's entire purpose would be never to unmount, and React only grants that by
  accident of reconciliation.
- **The client cannot see the lease**, so the "four states" idea had to become a display-state mapper
  or it would re-derive ownership in the browser — which this plan's own rule forbids.
- **The new cancel branch must null `draftRevisionId`**, which the first draft did not say, and
  which is the exact draft leak a GPT Sol finding closed in `failExpired` on 2026-08-30.

Two more it contributed: no migration is needed (said out loud so nobody looks), and every new test
must be written to fail **without** `VERCEL` set, because the local server-side `pump` hides the bug.

## Sol's review of the revised plan

2026-09-01, on the plan above rather than on the design questions. Verdict: *"ship the singleton
design, not the incremental driver move and not necessarily a provider"* — but it would not have
approved the plan unchanged, and the five things it called correctness rather than polish are now
in the stages:

1. **Completion must be a cursor, not a set.** A job can finish between a subscriber's render and
   its effect, and a Set seeded in the effect baselines that real completion away. This is a bug the
   refactor would have *introduced*.
2. **Session generation fencing**, keyed on `user.id`, because public jobs omit `ownerId` so the
   engine cannot tell that a cached snapshot belongs to the previous reader.
3. **Typed expiry outcomes and a rename.** `failExpired` stops always failing, so its name, its
   contract doc, its return type and its log all become false.
4. **Terminal jobs must not keep a running step**, and a cancelled settlement must clear stale
   `error` and `failureKind`.
5. **The 409 data path is a stage of its own**, not a checkbox — the route emits only `{ error }`,
   `readJson` drops structured fields, and `useStepJob` filters out exactly the job that is blocking.

It also corrected Fable on one point worth keeping: React preserving a component at the same
position and type is **contractual, not accidental**, so "a provider might unmount" was not a good
argument. The argument that survives is that the engine is an imperative tab-level service rather
than React view state.

And it refused the phrase "costs nothing" for the stage 3 poll, which the first draft had asserted
and nothing had measured.

## The state of the tree when this was planned

Several agents share this working directory. On 2026-09-01 at 07:45 the suite had **17 failures
across 11 files** before any of this work started — `store-parity`, `store-roundtrip`,
`store-session`, `store-shelf-reads`, `doc-links`, `migration-reconciliations`, `client-imports`,
`css-tokens`, `fixture-ids`, `pdf-bundle-trace`, `run-lock` — none of them in job or web code, and
all of them from other people's in-flight work. Recorded so the next person can tell this work's
breakage from the weather.
