# Show each summary level once it has passed its check — sized, and not built

**Status: stopped after the plan review, as the brief told it to.** No code was written. The answer
is that option 3 of [261001j](261001j-simple-press-cost-and-latency.md) (its section *Streaming — for Greg*)
**needs a new transport or a new storage shape**, and either one goes past what Greg said he would
accept:

> that would be nice, but not if it adds too much complexity
>
> — Greg, 2026-10-01, on showing summaries sooner

The brief set the line: *a new transport, a new storage shape, or more than a few hundred lines ⇒
stop and report the estimate*. Every route that works in whichever tab the reader is looking at
crosses at least one of those. The one route inside the budget (route 1) streams the levels to the
tab that happens to be running the job, which may not be the one showing the panel. So the
recommendation is **keep the press as built** (261001j's option 1), unless Greg accepts that
trade-off ("If Greg wants it anyway", below).

## What the work is for

A Simple press writes three levels (Brief, Simple, Fuller). Since 261001j it asks Fuller first, so
that one call writes the article's cache entry and the other two read it. The fidelity guard
(261001i) then checks each level and may have it rewritten once. The reader sees nothing until all
three are done: about 20 s, or 30–40 s when a level is rewritten.

Option 3 would show each level as soon as it has passed its check, the reader's chosen level first.
Simple would then appear at about 14 s instead of 20, and nothing shown would ever be taken back.

## Why it is not a modest change: the result has no way out of the step

The brief pictured it as *"the server emits each level as it passes, and the client renders whichever
have arrived"*. The server half is small: an `onLevel` callback in `generateSimpleSummary`
(src/simple-summary.ts), called where `writeLevel` returns. **The other half has no wire to travel
on.** Here is how a press reaches the reader today:

```
browser                                   server (one Vercel request, up to 800 s)
───────                                   ──────────────────────────────────────
POST /api/jobs {steps:["simple"]}  ──►    queues a job row
POST /api/jobs/:id/advance  ───────────►  runs the whole simple step
          … waits ~20 s …                   Fuller ─┬─ Brief, Simple ─ checks ─ retries
                                    ◄───────  one JSON answer: "done"
                                          the step's `parts` are committed only now
GET /api/jobs (polling)  ──────────────►  the job row: status, label — no artefact
GET /api/simple/:slug  ────────────────►  404 until the commit, then all three levels
```

There are three ways a level could get out early, and each is one of the things the brief ruled out:

1. **Stream the `advance` answer.** This is the nearest miss, and GPT Sol found it, not the first
   draft of this plan. The server already has an SSE writer (`sse()` in src/routes.ts) and the
   browser already has a framed-event reader (src/web/lib/sse.ts), so `advance` could send a
   `level` frame each time `writeLevel` returns, then its usual answer. Spend metering and the
   atomic commit stay where they are. Sol's estimate is **250–400 lines with tests**, which is
   inside the budget. **It fails on who receives the stream.** The store grants a job to exactly
   one claimant, and any other `advance` gets `busy` (src/jobs.ts § `claim`). Jobs are deliberately
   visible and driveable from any tab (src/web/useStepJob.ts § `job`), so the tab holding the
   stream can be one the reader is not looking at, and the visible panel then gets nothing early.
   Getting the levels to whichever tab is showing the panel needs them shared: persisted (route 2)
   or a subscription channel, which is a new transport.
2. **Write each passed level somewhere the client already polls** (new storage shape). There are two
   places. One is the job row, which would carry a reader's summary text beside its status. That
   also means writing to the row mid-step, which nothing does today: `report()` is in memory on
   purpose (src/jobs.ts). The other is a partial `simple` artefact: a row with fewer than three
   levels, which every reader of the artefact, the export and the public payload would then have to
   tolerate, and which the reopening path would have to know was never finished. In both,
   `GET /api/simple` and `GET /api/jobs` change meaning.
3. **A streaming route for the press beside the job** (new transport, plus a second way to run
   Simple). For example, `POST /api/simple/:slug/stream`, with SSE through the shared plumbing
   (`runStream`-style on the server, `readAnswerStream` in the browser). The job path cannot go:
   Metadata's re-run row and the queue still use it. So the route would have to copy, for itself,
   what a job gets for free: the slot and billing checks `POST /api/jobs` makes, the concurrency
   cap, the spend collector that meters the step, the stamp and the store commit, cancellation, and
   the abort when the reader leaves. The comments-style streaming plumbing does not help with most
   of that. It carries one call's words, not three levels' verdicts.

**Estimate for the cheapest correct one (3), with tests: about 550–700 lines** across about eight
files. It also adds a second way to run the same step, which the house rules argue against ("reuse
the machinery that's already here rather than adding a second way"). Route 1 is cheaper but is not
correct on its own (above).

| | server | client | tests | rules it breaks |
|---|---:|---:|---:|---|
| 1. stream `advance`, claimant tab only | 250–400 in all (Sol) | | | none, but the levels can reach the wrong tab; fixing that is 2 or a new channel |
| 2. levels in the job row | ~120 | ~120 | ~200 | new storage shape; reader text in the queue |
| 2b. partial artefact | ~100 | ~100 | ~250 (every reader of the artefact) | new storage shape |
| 3. streaming route | ~250 | ~180 | ~200 | new transport; a second runner |

These numbers are from reading the code, not from building it. They are counted against the
existing seams named above, and the range is wide.

## The four questions the brief asked to check, answered for the route that would be built (3)

- **One level fails after another has been shown.** The press is all or nothing: the first failure
  aborts the others, and nothing is stored (src/simple-summary.ts § "All or none"). Under option 3
  the level already shown would stay on screen for this visit, with the usual failure line and Try
  again where the others would be. It would be gone on reopening, because nothing was stored, so
  something shown *would* be taken back, one visit later. Avoiding that means storing a partial
  press, which is route 2b's storage shape.
- **The cached artefact and cost metering.** Unchanged under 1 and 2. Under 3 the metering would be
  re-done by hand in the route, which is exactly the kind of copy that drifts.
- **Reopening a stored summary.** Unaffected under 1, 3 and the job-row half of 2. Affected under 2b.
- **The reader's level first.** Not the 20-line change the first draft said. The chosen level
  lives only in the mounted panel (src/web/modes/summary/SummaryMode.tsx), `advance` carries only a
  job id, and `Job` records no level. A hint on the request would hold only when that tab wins the
  claim, so keeping the choice through another tab or a retry needs a job field: a new storage
  shape. **On its own it would also change nothing the reader sees**, because nothing is shown
  until all three levels are done. And it can make the press slower, because Fuller, the longest,
  would wait behind the stagger. 261001j measured the stagger at 3–7 s, but nobody has measured a
  chosen-level-first press, so how much slower is unknown.

## The simpler option passed over

Two near-misses, both above. Route 1, `advance` streamed to its claimant only, is in budget but
can stream to a tab the reader is not looking at. And shipping only a reader-chosen `FIRST_LEVEL`
buys the reader nothing until the levels can be shown early, and may lengthen the total wait.

## If Greg wants it anyway

Two ways in. **Cheapest:** route 1, accepting that a reader with the article open in two tabs may see
the levels early in only one of them. The other tab shows all three at the end, as it does today. That
is a product trade-off, and it is Greg's to make. **Correct in every tab:** route 3.
Route 3 leaves the job engine, the artefact's shape and the reopening path
alone, and confines the risk to one new route and the Simple panel. Its one real product question
is the failure case above: should a level that was shown then disappear on reopening, or be
stored? Storing it is route 2b.

## Reviews

- Plan: [261001o-summaries-show-each-level-when-checked-plan-review-sol.md](261001o-summaries-show-each-level-when-checked-plan-review-sol.md).
  Verdict: **agree it should stop**. Taken: P1, streaming `advance` reuses existing plumbing and is
  rejected for reaching only the claimant tab, not for being a new transport (route 1 rewritten,
  claims checked against src/jobs.ts § `claim` and src/web/useStepJob.ts); P1, the reader's level
  first needs a job field, not 20 lines; P2, the table aimed at the wrong cheapest route; P2, the
  "about a second" was not measured and is withdrawn.
