# A pipeline whose only consumer reads the lossy copy

Up: [postmortems.md](../project/postmortems.md) · plan
[261002b](../plans/261002b-feedback-reports-lost-after-the-response.md)

**What happened.** On 2026-10-01 Greg filed about 40 reports between 16:17 and 20:03 UTC. The
three-hourly feedback sweep never dispatched 13 of them, and the Overseer found them by hand. None of
the 13 is in Sentry. Each one's row is in production `feedback`, complete, with `mirror_attempted_at`
set and `mirrored_at` null. Over the table's whole life, only 44 of 322 rows (14%) ever recorded an
acknowledgement from Sentry.

## The root cause

Two faults, and only together do they lose a report.

**1. Vercel freezes an instance when the response ends, and our after-response work was simply
awaited.** `fileFeedback` answers the reader and then awaits `mirrorFeedback`. `handler` then awaits
`flushMonitoring`. The comment above that flush said *"awaiting keeps the invocation alive until the
buffer drains"*. It does not: it keeps a promise pending, and the platform does not wait for it. The
Vercel logs show it directly:

- `spya-c77zuq`: filed 18:00:57 on a cold start. The `not acknowledged` warning is stamped 18:08:26,
  and the request's own 201 line says `ms: 749609`. All of it surfaced in the log of an unrelated
  `GET /api/jobs` at 18:27, the request that finally woke the instance. The outbound request to
  Sentry did not survive the freeze.
- `spya-r2auqd`: Sentry received it 15 ms after the row was written, so the request left before the
  freeze. The instance was woken 4 s later by the next request. The two-second acknowledgement timer
  was overdue by then, and Node runs timers before I/O, so it won. The row says "not acknowledged"
  about a report Sentry has.

The 14% that did get marked were the lucky ones: another request happened to keep the instance
awake.

**2. The sweep's only input was Sentry, and Sentry was designed as the second destination.**
feedback.md says it plainly: *"The row is written first and it is the report … the Sentry item is a
mirror … best effort."* Then feedback-reports.md § Where the queue lives made the mirror the queue,
*"because it has a status field and the table does not"*. So the only consumer of the pipeline read
its lossy copy. Every loss in the mirror became a loss of the report, and nothing compared the two.

## The class

**A pipeline whose only consumer reads the lossy copy.** The authoritative store is written
reliably, a best-effort copy is made for convenience, and then the thing that acts reads only the
copy. The copy's failures are invisible by construction. A report missing from Sentry looks exactly
like a report never filed, and nobody counts what is not there.

Fault 1 is an instance of a second, smaller class: **work after the response on a platform that
freezes at the response.** It is invisible locally, where nothing freezes, and it is invisible in
tests, which run on a process that never suspends.

## Which commits introduced it

- `9168290a8` (2026-08-27, *Turn the monitoring on*) wrote the premise: the flush is awaited after
  the response, "rather than handed to `waitUntil`", on the stated belief that awaiting keeps the
  invocation alive.
- `c77a976e3` (2026-09-01, a batch commit carrying the feedback route) built the mirror on that
  premise: "started before the answer goes out, awaited after it".
- The queue-is-Sentry decision lives in feedback-reports.md from the first sweep (2026-09-04). It
  was reasonable when every mirror was believed to arrive.

**The measurement was already there.** `scripts/feedback-reporter.ts` (2026-10-01) records "31 of
231 rows … the acknowledgement mostly never arrives". It was written down as a fact about Sentry
and not chased. An 86% failure rate in a column built to find stranded reports is the alarm. It was
read as a property of the thing it measured.

## The fix

Shipped, and right for the long term:

1. **`handler` registers its own promise with the platform's `waitUntil`** (src/wait-until.ts,
   src/vercel.ts). That covers every after-response job at once: the mirror, its acknowledgement, the
   Sentry flush for every error event, and whatever a route adds next. It is read the way
   `@vercel/functions` reads it, without the package's 23 transitive dependencies. In production it
   logs a warning once per instance if the context is ever missing, so a moved symbol is loud rather
   than silent.
2. **The acknowledgement ceiling yields once (`setImmediate`) before it settles**, so a late wake
   with the reply already waiting records delivery.
3. **The sweep reads the table** (`scripts/feedback-unswept.ts`): every production row since a date
   that no note header and no queue item's `source` names, with `--show` to read one report's words.
   Sentry becomes a convenience again. A lost mirror costs a missing copy, not a lost report.

**Not done: retrying the mirror.** A retry cannot tell "Sentry never got it" from "Sentry got it and
we never heard". On 2026-10-01 there were 24 rows of the second kind. Sentry does not dedupe feedback
events, so a retry would file those twice.

## What would have caught it, ranked by ease against value

1. **Read the authoritative store, not the copy, wherever a consumer must not miss anything.** Done
   here for feedback (fix 3), and stated in feedback-reports.md § Where the queue lives. This one
   rule would have made fault 1 cost nothing.
2. **A failure rate in a column built to detect failures is a bug report, not a statistic.**
   `mirrored_at` existed to find stranded reports and said 86% were stranded. Treat a health column
   that is mostly red as an incident the first time anybody reads it. This is a habit, and
   [silent-success.md](../reusable/silent-success.md) is its home.
3. **Any work after `res.end` needs `waitUntil`.** This is now structural: the handler registers
   everything, so a route cannot forget. The comment in src/vercel.ts says why.
4. **Measure the mirror after each deploy:** `count(mirrored_at) / count(*)` for rows since the
   deploy. It is the only test of fix 1 that runs on Vercel. Proposed to the Overseer as a post-deploy
   check. **Rejected: a CI test against a real Vercel instance.** Deploys are only from `main`, and
   the freeze shows up in production data within an hour anyway.
5. **Rejected: an alert on every unacknowledged mirror.** The warning line already exists and
   nobody reads Vercel logs unprompted. The table-reading sweep is the reader.
