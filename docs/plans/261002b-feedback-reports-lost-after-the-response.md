# Feedback reports lost after the response

Up: [feedback.md](../project/feedback.md) · [feedback-reports.md](../project/feedback-reports.md) ·
postmortem [261002b](../postmortems/261002b-a-pipeline-whose-only-consumer-reads-the-lossy-copy.md)

Raised by the Overseer, 2026-10-02 ~00:50: of Greg's 2026-10-01 reports, 13 were never dispatched
by the three-hourly sweep, and only a handful had `mirrored_at` set. Find out whether mirroring
fails, or `mirrored_at` is not written when it succeeds, and make it so a report cannot be silently
lost to the sweep.

## What the evidence says

All read-only: production `spideryarn.feedback` inside `begin read only … rollback`, Sentry via the
MCP, Vercel runtime logs via the MCP.

**Both, and they have one cause.** Vercel suspends a function instance once its response has been
sent. `fileFeedback` (src/routes.ts) answers the reader and *then* awaits `mirrorFeedback`, and
`handler` (src/vercel.ts) awaits `flushMonitoring` after that. None of it runs until some later
request happens to wake the same instance.

- **Mirrored rows are a minority, and always have been.** Since 2026-09-02, 44 of 322 rows
  have `mirrored_at` (14%). Every row has `mirror_attempted_at`. 2026-10-01: 13 of 85.
- **`spya-r2auqd`, delivered but never marked.** The row was filed at 19:56:26.355 and Sentry's
  `SPIDERYARN-READING2-9P` first saw it at 19:56:26.370, so the request left before the freeze. The
  log lines after `feedback report accepted` arrive bundled with an unrelated `GET /api/jobs` at
  19:56:30, which is the next request to wake the instance. The 201's own line says `ms: 3724`, and
  the warning says `feedback report was not acknowledged by sentry`, `status: null`. On waking,
  the overdue two-second timer and Sentry's reply are both ready, and the timer won.
- **`spya-c77zuq`, never delivered.** It was filed at 18:00:57 on a cold start. Its `not
  acknowledged` warning is stamped 18:08:26, and its 201 line 18:13:26 with `ms: 749609`. That is
  twelve and a half minutes of a request that the reader saw finish at once. The outbound request
  to Sentry died while the instance was frozen. All 13 of the Overseer's list are absent from Sentry
  (`report_id:[…]` search, with `spya-gxyhcc` as the control that does match).
- **24 of the other 28 unmirrored rows from 15:58–20:03 are in Sentry.** So `mirrored_at is null`
  does not mean "Sentry lacks it". The sweep, reading Sentry, did see those 24. The 13 it missed
  are the ones the freeze killed before they left.
- **The rows that did get marked** show `mirrored_at` 30–250 ms after the attempt. That is what
  an acknowledgement looks like when the instance stays awake, for instance because another
  request is in flight on it (Fluid compute runs several at once).

`src/vercel.ts`'s comment says "awaiting keeps the invocation alive until the buffer drains". That
is the assumption that was false. Awaiting keeps the *handler's promise* pending. It does not keep
the instance awake once the response is complete. So the same freeze can hit **every** Sentry
event raised during a request: they are sent by the flush, after the response. That is wider than
feedback, and the same one-line fix covers it.

`scripts/feedback-reporter.ts` had already noticed the symptom ("31 of 231 rows … the
acknowledgement mostly never arrives") and written it down as a fact about Sentry. That is the
class: the measurement was there, and the explanation stopped one step short.

## What we do

### 1. Keep the instance awake until the handler finishes: `waitUntil`

`handler` in src/vercel.ts hands its own promise to the platform's `waitUntil`, and still returns
it. That one registration covers everything awaited after the response: the feedback mirror, its
acknowledgement, the Sentry flush, and anything a future route adds to that promise chain. It is
better than handing only the mirror over, because the flush has exactly the same problem.

- **How we reach `waitUntil`: the way `@vercel/functions` does, without the package.** The
  package's `waitUntil` is five lines: it reads
  `globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil` and calls it. We do the
  same, in a small `src/wait-until.ts`. Installing the package was tried. It brought 23 packages
  into the lock (`@vercel/oidc` → `@vercel/cli-config`, `execa`, `jose`, …) for those five lines.
- **The risk of the hand-rolled read is that it fails silently**, if Vercel ever moved the symbol.
  So it is not allowed to: when `process.env.VERCEL` is set and no `waitUntil` is found, the
  handler logs `warn` "no vercel waitUntil", once per instance. Outside Vercel (dev server, tests)
  there is no context, and the handler is simply awaited as before.
- **Passed over: the `@vercel/functions` package itself**, for the dependency weight above. If the
  symbol ever moves, the warning says so, and switching to the package is one import.
- **Passed over: mirroring before the response.** The reader would wait for Sentry's round trip.
  On a consented report that also includes reading the article from storage, which can take up to
  ten seconds. The design already decided against that.
- **Passed over: `maxDuration`, or Fluid settings.** Neither changes when an instance is
  suspended.

### 2. A late wake cannot be mistaken for no acknowledgement

`mirrorFeedback` should not record "not acknowledged" just because the timer callback ran before
an already-arrived reply. With 1 in place this should not happen. But a wake-up race that silently
flips the answer is the bug we just found, so we close it as well. When the timer fires, it yields
once (`setImmediate`) before it settles. A reply already in the queue then wins. **It is smaller
than it sounds**: two lines, and a test that queues both.

### 3. The sweep reads the table, not only the copy

Sentry is a lossy copy. Even with 1, a Sentry outage, a rate limit or an oversized envelope drops a
report there while the row stands. So the sweep's source of truth has to be the row.

New: `npx tsx scripts/feedback-unswept.ts [--since 30d]`. It reads production `feedback`, read-only,
through the same `productionConnection` / `readEnvProd` path as `feedback-reporter.ts`, with the
same `Target:` line and the same `begin read only … rollback`. It lists every row since `--since`
whose id is named neither by a `docs/user-feedback/` note's `reports:` header (`readNotes` /
`parseNoteHeader` from `feedback-endings.ts`) nor in any Overseer queue item's `source`. An id shared
by several owners is always listed, because id-only coverage cannot say which row it meant. For each
one it prints the id, `created_at`, kind, whether an administrator filed it (`isAdmin`), whether Sentry has
it (`mirrored_at` / `sentry_event_id`, said as "Sentry: confirmed" or "Sentry: unconfirmed, search
`report_id:<id>`"), and the url and slug. **It does not print the body**: the sweep fetches the words
for a report it is about to act on, as now (`feedback-reporter.ts` for an admin, Sentry or the row
otherwise). Exit 0 = listed (possibly none), 2 = could not read production.

Over-reporting is safe: a row already queued under its Sentry short id, with no report id in the
text, shows up again, and the sweep's existing duplicate check catches it. Under-reporting is the
failure this exists to end, so the matching errs that way.

**Passed over: retrying the mirror** from a sweep or a cron job. A retry cannot tell "Sentry never
got it" from "Sentry got it and we never heard". 24 of 2026-10-01's rows are the second kind. Sentry
does not dedupe feedback events, so a retry would file those twice. And there is no scheduler to run
it ([cron-scheduler.md](../project/cron-scheduler.md)). With the table read directly, Sentry is no
longer load-bearing, so a lost mirror costs a missing copy, not a lost report.

**Passed over: alerting on a failed mirror.** The warning line exists already, and the new script
is the reader of the state it describes.

### 4. Proposed to the Overseer, not done here

- **The sweep prompt** (Overseer's scratchpad, not edited): run `feedback-unswept.ts` after reading
  the Sentry queue, and treat every row it lists as a report to classify and queue, the same as a
  Sentry issue. A row with no Sentry issue is queued under its report id, with the words from
  `feedback-reporter.ts` for an admin or the row for a reader. And always put the report id in
  `--source` beside the Sentry short id, so the next run's matching is exact.
- **Backfill of `mirrored_at`** for the 24-or-so delivered-but-unmarked rows: a production write,
  so for Greg. It is not needed for correctness once the sweep reads the table. It only makes
  `/admin/feedback`'s words honest. Recommended: don't. Leave history as it is, and say in
  feedback.md that rows before the fix's deploy under-report delivery.
- **After the deploy:** check that the mirrored share of new rows is near 100%. That is the only
  real test of 1, because nothing here can run a Vercel instance:

  ```sql
  select count(*), count(mirrored_at) from spideryarn.feedback where created_at > '<deploy time>'
  ```

### GPT Sol's plan review, and what changed

No P0s. Three P1s, all taken. Sol also confirmed the root cause and the `waitUntil` fix against
Vercel's runtime source: its Node launcher mounts a `(req, res)` export as an HTTP listener, and
installs the request context before user code loads.

- **Coverage reads structured fields only.** A queue item's free text can mention a report in
  passing, and the queue's own duplicate check only catches a reused queue id. So the script matches
  report ids in items' `source`, live and settled, and never in their text. The sweep writes the
  report id into `--source`.
- **A Sentry-absent reader's report had no way to be read**, because `feedback-reporter.ts` prints
  words for admins only. So now `--show <id>` prints one row's words, marked untrusted whoever filed
  it, and each listed line names that command.
- **A queue that is unreadable or has `problems` is exit 2**, not empty. A note whose header does
  not parse is named in the output, and the report it was for is listed again.
- **And one real bug, found from its P2:** call `context.waitUntil(promise)` as a method, as the
  package does. Detaching it loses `this`. The test's fake now needs its `this`.

The code review then closed three more ways this recovery path could lie: report ids are unique only
per owner, so a shared id is always listed as ambiguous; queue sources match exact id tokens rather
than six-character prefixes; and `--show` quotes every untrusted line and escapes terminal controls.
It also refuses calendar dates JavaScript would silently normalise, such as `2026-02-30`.

## Tests, red first

- `tests/vercel-wait-until.test.ts`: install a fake Vercel request context on `globalThis` and call
  `handler`. Assert that `waitUntil` received a promise, and that the promise does not settle until
  work done *after* `res.end` has finished. Red on today's handler, which registers nothing.
- `tests/feedback-mirror.test.ts`, one new case: the ack and the timer due in the same turn, with
  the reply queued first. Assert that `mirrored_at` is written. Red today.
- `tests/feedback-unswept.test.ts`: the pure coverage and `unswept(rows, coveredIds)` functions. A
  row named by a note is excluded. A row named in a queue item's `source` is excluded. A row named
  nowhere is listed. A mirrored row is still listed if nothing covers it (mirroring is not
  coverage). Plus parsing `--since`, the read-only transaction, exact source tokens, shared ids and
  the untrusted `--show` boundary. Red first on each bug the review found.

## Stages

1. This plan → GPT Sol (read-only).
2. Code + tests, red first → GPT Sol (workspace-write) → gates → commit.
3. Postmortem, the docs (feedback.md § Reading the reports, feedback-reports.md § Where the queue
   lives, the vercel.ts comment), push, message the Overseer.
