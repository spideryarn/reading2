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

The whole of the reader-visible bug, and Fable's "if you build only one".

- [ ] **Decide the shape first, then write the red test.** The plan's original first checkbox —
      "mount the reading view and assert `/advance` is still called" — cannot be written before the
      shape is chosen, and would prove the wrong thing anyway: after the fix, *nothing route-scoped*
      drives, so a reading-view test is green before and after.
- [ ] **`src/web/jobEngine.ts`, a module-scope singleton — not a React context.** It owns the poll
      timer, the jobs snapshot, the visibility rules and the `drive()` loops. `useJobs` becomes a
      subscriber (`useSyncExternalStore` over the engine's snapshot) plus the action methods, which
      stay where they are — an action is a fetch, and it belongs with the card that fires it.

      Not a provider at the top of `App.tsx`, because the authed region is a chain of early returns
      rather than a wrapper, so a provider means restructuring every route branch into
      `<Shell>{page}</Shell>` — and the provider's whole purpose would be *never to unmount*, which
      React only grants by accident of reconciliation. A module-scope object has no unmount by
      construction. The codebase has already voted this way twice: `driving` is module-scope for
      exactly this reason, and the polling-over-SSE decision at the top of `useJobs.ts` is the same
      instinct — the client holds no connection state.
- [ ] **`start()` / `stop()`, called from the one place that knows the session.** The engine must not
      poll unconditionally: `GET /api/jobs` from a signed-out landing page is a 401 loop. A two-line
      `useEffect` keyed on `user` in `App.tsx`. `start()` must be **idempotent**, because that effect
      can re-run on remount.
- [ ] **Stop on sign-out, and treat a mid-poll 401 as stop-do-not-retry.** Fable's (ii): "the
      authenticated app shell" was doing load-bearing work in the old plan with no spec behind it.
- [ ] **A reset seam for the tests.** Today each `useJobs` mount gets a fresh poller; a singleton
      bleeds state between cases without one.
- [ ] **`onFinished` becomes an engine event with a per-subscriber baseline.** This is the real cost
      and the place the review should stare. Today each hook owns its `announced` ref and its
      first-poll baseline; with one engine, a late-mounting `useStepJob` consumer will replay
      historical `done`s unless each subscriber keeps its own. `src/web/useStepJob.ts` and the
      glossary/ideas/quotes surfaces all depend on this.
- [ ] **Preserve the visibility rules exactly**, and re-prove them: `drive` continues while hidden,
      the *poll* pauses, a hidden `poke` still makes one reconciliation request, `visibilitychange`
      polls at once. These are all reasoned out in comments at the top of `useJobs.ts` and each one
      was a bug first.
- [ ] **Tests that can actually go red.** Two, and the first is the honest one:
      - a plain unit test of the engine with **zero components mounted** — jobs advance with no
        React at all, which is itself the proof;
      - one jsdom test that mounts `App`, navigates library → read through the real router under
        fake timers, and asserts `/advance` keeps firing. If mounting `App` proves too expensive,
        say so here and move the navigation check to the browser pass — **decide, do not leave the
        checkbox ambiguous**.
      Both must be written to fail **without** `VERCEL` set, because locally `pump()` runs
      server-side and the browser's advances answer `busy`, so the driver move changes nothing
      observable on the filesystem adapter.
- [ ] It also collapses **one poll per tab** instead of one per `useStepJob` surface, which nothing
      had listed as a cost.

### Stage 2 — Stop means what it says

- [ ] `failExpired` should settle a row carrying `cancelling=true` as **cancelled**, not `error` /
      INTERRUPTED. It is currently the odd one out: `releaseStepIn` already settles a live
      claimant's release on a `cancelling` job as cancelled, and the fs adapter's `sweepStopped`
      already does the same on restart. So this makes three mechanisms agree rather than adding a
      fourth.
- [ ] `requestCancel` grows a branch: `running` with an **expired** lease goes straight to
      `cancelled`, in the same statement, compared against `now()`.
- [ ] **The hazard the first draft of this plan missed.** That new branch must copy **`failExpired`'s
      field set, not `requestCancel`'s running branch** — in particular it must null
      `draftRevisionId`. The running branch deliberately leaves the draft pointer alone because the
      claimant disposes of it; go straight to `cancelled` without nulling it and
      `sweepAbandonedDrafts` spares that draft for ever, which is the exact leak GPT Sol's
      2026-08-30 finding closed in `failExpired`. Also `attemptId`, `leaseExpiresAt`, `finishedAt`.
- [ ] The **fs adapter needs the matching branch** (checking its `attempts` map), or
      `tests/store-jobs-parity.test.ts` should be the thing that says so first. A hidden claimant on
      a laptop is rarer but real — two dev tabs.
- [ ] **No "Force stop" before the lease expires.** A live claim may genuinely be working, and
      clearing it is how you get two writers. The copy carries the wait: "Stopping after the current
      step…", not an indefinite disabled "Stopping…".
- [ ] **No migration.** `cancelling` and `lease_expires_at` both exist. Said out loud so nobody goes
      looking.

### Stage 3 — reconcile where the reader already is

- [ ] `failExpired(now?, owner?)` — **the same method, owner-scoped**, not a sibling. An owner
      parameter keeps `tests/store-jobs-parity.test.ts` exercising one contract; the fs adapter's
      version is a filter on its `attempts` map.
- [ ] `listJobs()` in `src/jobs.ts` calls it **only if the list it just fetched contains a `running`
      job**, and re-lists if anything was swept. The candidate test is "any running job", not "any
      expired lease", because the app-level `Job` cannot see leases — see stage 4. That costs one
      no-op owner-scoped `UPDATE` per second per reader *only while something is running*, which is
      nothing; an indexed `WHERE` matching zero rows is an index probe, not a WAL write.
- [ ] **Do not make `list()` reconcile inside the adapter.** The `JobStore` contract's thesis is
      transitions, not patches; a list that mutates would be the first read-that-writes, and the
      parity tests are not shaped to catch its divergence.
- [ ] Keep the existing global call in the advance path unchanged — belt to this suspender.

### Stage 4 — one place that says what state a job is in

- [ ] `src/job-state.ts`, beside `src/job-failure.ts`, which is the established precedent: one place
      that decides what the card offers, imported by the client.
- [ ] It maps `Job → { kind: "waiting" | "working" | "slow" | "stopping" | "interrupted" | "failed"
      | "stopped" | "done", … }`. A **display** state, and this is the constraint that makes it
      correct: **`Job` on the wire carries no lease.** `leaseExpiresAt` lives on the pg row and the
      fs `attempts` map and never reaches `publicJob`. So "running, lease expired" is invisible to
      the client until stage 3 reconciles it — which is a feature, not a gap. Do **not** build a
      four-state function that takes lease timestamps: that re-derives ownership on the client,
      which this plan's own rule forbids.
- [ ] It **calls** `jobWorthRetrying` rather than absorbing it — that function is also the server's
      spend gate in `retryJob` and must stay independently importable. (It moved from
      `AddArticle.tsx` to `src/job-failure.ts` in a peer's in-flight work; check before importing.)

### Stage 5 — say the time, and say the dependency

- [ ] `JobStep.startedAt` is already on the record and nothing displays it. A running step should
      read `Building the hierarchy · 2m 14s · 18 KB received`, with a measured "this often takes a
      few minutes" where `data/_ai-calls.jsonl` gives us one and nothing where it does not.
- [ ] Distinct copy for distinct states, driven by stage 4: *Waiting to continue*; *This is taking
      longer than usual — you can stop it*; *Stopping after the current step…*.
- [ ] **No determinate progress bar.** Response size and provider latency are both unknown, so a
      percentage would be invented — [silent-success.md](../reusable/silent-success.md) with a
      number on it.
- [ ] The 409 `That article already has a job running…` names no job, offers no way to reach one,
      and says *running* when the job may be idle in `queued`. Return the active job's id with it and
      let the client show that card, with its Stop button.
- [ ] Say the browser dependency out loud on the add page: *"Keep a Spideryarn tab open while this
      imports. If you close them all, it will continue when you return."* Until there is a real
      background runner, calling this a queue without saying that over-promises.
- [ ] Count consecutive advance failures in the engine and surface them — see [the failure this
      design will still have](#the-failure-this-design-will-still-have).

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
