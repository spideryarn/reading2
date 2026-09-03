# A success deleted in the same call that finished it, so no job is ever announced done

**Once the reader's retained history is saturated with failures** — that is the precondition, and
the title is only true after it. Fifty of them, and every success from then on is deleted at birth.

**Found:** 2026-09-03, pressing the glossary panel's *"Start again"* in a real browser while
verifying [260903e-glossary-delete-in-postgres.md](../plans/260903e-glossary-delete-in-postgres.md).
**Not caused by that work.** The glossary delete is what made it visible.

**Fixed** the same day, by the retention half rather than the client half —
[260903h-keep-a-fresh-success-out-of-the-retention-sweep.md](../plans/260903h-keep-a-fresh-success-out-of-the-retention-sweep.md).
The ranking below was wrong about which fix to reach for first, and the correction is at the foot.

## What the reader sees

Press a button that starts a job — *"Start again"*, *"Find the terms"*, *"Add"* — and the panel
never comes back. The work **succeeds**: the article gains its glossary, its ideas, its quotes, and
a page reload shows them. The tab you are looking at does not. It sits on the empty state, and
behind it the browser asks the server to advance a job that no longer exists, every eight seconds,
for as long as the tab is open, saying nothing.

It is worst on *Start again*, which is why it was found there: `reset` empties the panel before
starting the run, so the reader watches an empty box rather than a stale list.

## The real cause

**A retention rule written for one consumer became load-bearing for a different one, and nothing
said so.**

`trimFinished` runs after **every** ending ([`src/jobs.ts:1137`](../../src/jobs.ts)), keeping
`KEEP_FINISHED = 50` terminal jobs per owner. Its ordering is deliberate and documented in both
adapters — [`src/store/pg-jobs.ts:1130`](../../src/store/pg-jobs.ts),
[`src/store/jobs-fs.ts:700`](../../src/store/jobs-fs.ts):

> Successes before failures, so successes are what gets dropped … A reader who loses a failure loses
> the only account of what went wrong.

and in `KEEP_FINISHED`'s own comment:

> Failures are kept preferentially: they are the ones worth reading later, and the successes have an
> article on the shelf to speak for them.

That reasoning is sound **for a person scrolling their history**. It is false for the client, which
does not read history — it watches for a row to appear with `status = "done"` and treats that as the
signal to refresh (`recordCompletions`, [`src/web/jobEngine.ts:436`](../../src/web/jobEngine.ts)).

The preference is **absolute**, not weighted. So once an owner holds 50 failures, every success is
past the offset the moment it is written, and `trimFinished` deletes it *in the same call that
marked it done*. The row never exists in a pollable state. No completion event is ever emitted, for
any mode.

**The class: a rule whose justification is about one reader, silently depended on by another.**
Nothing in the retention code knows the client exists; nothing in the client knows retention exists.
Both are individually reasonable and the seam between them is unstated, so neither review would have
caught it.

## Why nothing failed

- The job **succeeds**, so no error is logged and Sentry stays empty.
- `advance` then 404s, and `drive` treats 404 as transient and retries forever
  ([`src/web/jobEngine.ts`](../../src/web/jobEngine.ts) `step`'s catch).
- The warning built for a stuck driver cannot fire: `stalled = job !== null && driverStalled(…)`
  in [`src/web/useStepJob.ts`](../../src/web/useStepJob.ts), and `job` is null **because the row is
  gone** — the guard is switched off by the very condition it should report.
- `pruneDriverFailures` drops the failure counter each poll, so the count never builds either.

Three independent safety nets, all disarmed by the same fact. This is
[silent-success.md](../reusable/silent-success.md) exactly: every check agrees because they share an
assumption — that a terminal job stays readable long enough to be seen.

## Which commit introduced it

`0d42a484`, 2026-08-27 — *"Run both job stores through one set of tests, and find the retention
wrong"*. That commit **fixed a real bug**: the first version dropped failures and kept old
successes, and a reader who loses a failure loses the only account of what went wrong. The fix was
right and the parity test that caught it was right. What it did not have was a floor for successes,
and no test could have caught that, because the invariant it breaks lives in another file that
nothing connects it to.

## Reproduced, both sides

**Server**, against the live local database, simulating the doomed-row query with one fresh `done`
row added to the dev owner's real 50 errors:

```
order by (status = 'done'), created_at desc, id desc offset 50
-> [{ "id": "spya-NEWDONE", "slug": "writes", "status": "done" }]
```

The brand-new success is the one and only row marked for deletion.

**Client**, a `useStepJob` probe driven by a fake engine:

```
control       [] -> [running] -> [done]  ->  refreshes === 1
what happens  [] -> [running] -> []      ->  refreshes === 0
```

## What would have caught it, ranked

1. **A test that a completed job is announced when the owner's history is already full.** Cheapest,
   and it is the missing sentence: today's parity tests assert *what trimFinished keeps*, never
   *that a success survives long enough to be seen*. One test, one fixture of 50 failures.
2. **Making the client's dependence explicit.** `recordCompletions` should say in a comment that it
   requires a terminal row to be pollable, and `trimFinished` should say that something depends on
   that. A stated seam is one a reviewer can check.
3. **Treating disappearance as an event rather than as nothing.** Any future reason for a row to
   vanish — retention, `forget`, a manual delete — produces this same silent stall.

## The fix, ranked by value

**1. Client: a vanished job is a completion, not a void.** *(Highest value, moderate risk.)*
`useStepJob`'s reconciliation effect currently waits for the row to reappear —
`const seen = queue.jobs.find(j => j.id === id); if (!seen) return;`. It should treat *"the id
`start` returned has left the list entirely"* as a completion: call `onFinished()` once, clear
`startedId`. And `drive` should stop looping on a 404 rather than retrying forever. This closes the
**whole class**, not this instance. It touches a path with eight callers and the "don't announce
history" invariant has to survive it, so it needs a test beside
`tests/job-engine-completions.test.tsx`.

**2. Server: a floor for successes rather than an absolute preference.** *(Lower risk, smaller
win.)* Keep the newest N `done` **alongside** the newest M failures, so neither starves the other.
Two adapters and the parity test.

**Deliberately not done in this run, and this is the reason:** the ordering being inverted is a
*decision somebody made on purpose*, with the reasoning written down in three places, after a bug
that went the other way. Quietly reversing it while finishing an unrelated feature is how the next
postmortem gets written. It wants Greg, or a reviewer, saying which way the trade should go —
[engineering-manager.md](../reusable/engineering-manager.md): *"Dropping something non-trivial wants
a reason from someone other than you."*

## The ranking above was wrong, and here is what was built

⟨Sol⟩, reviewing the built glossary work, 2026-09-03.

**Fix 1 does not close the whole class**, which is the one thing that made it fix 1. It changes
`useStepJob`, which the eight mode hooks use — but the shelf and Add do not: `Library.tsx` calls
`useJobs(reload)` directly, and this postmortem lists Add among the surfaces affected. So the
highest-value fix, as written, would have left the two surfaces it names untreated.

**The server fix protects every consumer**, because it works below all of them, and that reorders
the two. It is what was built, on 2026-09-03: the two kinds of terminal job now interleave, ranked
by when each *finished* rather than when it was queued, so a just-ended job is rank 1 of its kind
and cannot be swept by its own ending. Ranking by `created_at` — which is where that plan started —
would not have fixed it: jobs run three at a time and a job queued first routinely ends last.
[260903h](../plans/260903h-keep-a-fresh-success-out-of-the-retention-sweep.md) has the rule, the
trade it makes against `0d42a484`, and both red-first cases.

**One half of fix 1 was worth taking on its own**, and was: `drive` no longer retries a 404 from
`/advance` for ever. Measured at 76 requests in ten simulated minutes before, one after.

**The rest of fix 1 is recorded, not built.** Telling *"not yet"* from *"gone"* needs a poll-start
sequence number the engine does not have, and after the retention fix there is no known trigger
left. The hole remains and the design for closing it is in the plan; if it is ever built, it belongs
in the shared engine rather than in `useStepJob`, so that the shelf and Add are covered too.

## The thing that made it constant on this box

The dev owner (`dev-admin@spideryarn.local`) held **exactly 50 `error` jobs and zero `done`** — 42
of them under `test-*` slugs, written by the test suite between 00:54 and 08:11 that morning
against the **shared local Supabase**.

So the suite poisons the environment it shares with every developer and every worktree, and refills
it on the next `npm test`. In production this needs a reader with 50 genuine failures; here it is
the normal state. That is its own problem and belongs with the shared-database findings in
[worktrees.md](../project/worktrees.md) and [testing.md](../project/testing.md).
