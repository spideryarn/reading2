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
[`Library.tsx`](../../src/web/Library.tsx), and `useStepJob` for the tweets panel. `App.tsx` returns
`<Library />` or `<Reader />`, never both. `drive()`'s loop is `while (alive())` and `alive` goes
false on unmount.

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

Each of these stands alone and the list is ordered by value, so we can stop after any of them.

### Move the driver to the shell

- [ ] A failing test first: mount the reading view with a `queued` job in the list and assert
      `/advance` is still called. It should go red.
- [ ] Hoist the driving half of `useJobs` out of `Library`/`AddPage` and into the authenticated app
      shell, so any Spideryarn page keeps imports moving. The *poll* can stay where the cards are;
      it is `drive` that must not be tied to a route.
- [ ] Keep `driving` (module-scope `Set`) as the thing that stops two mounts racing — it already
      does that job and does not need to change.

This is Sol's "if only one piece is built", and it is also mine. It fixes state 4 outright and
shortens states 1 and 2 to "as long as the reader is anywhere in the app".

### Make Stop mean what it says

- [ ] `requestCancel`'s single `UPDATE` grows one branch: `running` with an **expired** lease goes
      straight to `cancelled`, in the same statement, compared against `now()`. An expired lease is
      precisely the proof that nobody holds the job, which is the same proof `failExpired` already
      acts on — so this adds no new safety assumption.
- [ ] `failExpired` should settle a row carrying `cancelling=true` as **cancelled**, not `error` /
      INTERRUPTED. Today it sets `cancelling: false` and `error: INTERRUPTED.message`
      unconditionally, so a reader who pressed Stop is told the job was interrupted.
- [ ] **No "Force stop" before the lease expires.** A live claim may genuinely be working, and
      clearing it is how you get two writers. The copy carries the wait instead: "Stopping after the
      current step…", not an indefinite disabled "Stopping…".

### Reconcile where the reader already is

- [ ] `failExpired()` has exactly one caller — `advanceJob` — which is the endpoint that only fires
      when somebody is already watching. Have `GET /api/jobs` reconcile too, **scoped to that owner
      and only when there is an expired candidate**, rather than firing an empty global `UPDATE`
      every second. Sol was specific about that; the naive version is a write on every poll.

### Say the time

- [ ] `JobStep.startedAt` is already on the record and nothing displays it. A running step should
      read `Building the hierarchy · 2m 14s · 18 KB received`, with a measured "this often takes a
      few minutes" where `data/_ai-calls.jsonl` gives us one, and nothing where it does not.
- [ ] Distinct copy for distinct states, because they are currently one spinner: *Waiting to
      continue* (queued), *This is taking longer than usual — you can stop it* (past a measured
      threshold), *Stopping after the current step…* (cancelling).
- [ ] **No determinate progress bar.** Response size and provider latency are both unknown, so a
      percentage would be invented — [silent-success.md](../reusable/silent-success.md) with a
      number on it.

### Point the 409 at the job it is talking about

- [ ] `That article already has a job running. Wait for it, or stop it first.` names no job and
      offers no way to reach one, and it says *running* when the job may be idle in `queued`. Return
      the active job's id with the 409 and let the client show that card, with its Stop button.

### Say the browser dependency out loud

- [ ] Sol's point, and it is a product-honesty one: until there is a real background runner, the add
      page should say *"Keep a Spideryarn tab open while this imports. If you close them all, it will
      continue when you return."* Calling this a queue without saying that over-promises.

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
