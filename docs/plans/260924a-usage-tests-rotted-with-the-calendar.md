# Three usage tests rotted with the calendar

Queue item `qi-cw6rzavq`, authorised by Greg on 2026-09-24:

> Yes, go, fix the tests.

Dev's full check on `3ddb24dc` (2026-09-23) was red on four test files. This plan covers three:

- `tests/overseer-daemon-usage-pass.test.ts` — "`keep-stored` still carries the DISCARDED fresh
  report"
- `tests/overseer-store-usage.test.ts` — "an incomplete scan does NOT displace the report already on
  the checkpoint"
- `tests/fleet-usage-history-wiring.test.ts` — "an incomplete scan still records its CACHE reading"

The fourth, `tests/overseer-standing-jobs.test.ts`, is red on purpose (a pinned doc was edited, and
re-pinning it is Greg's call). It is not touched here.

## The cause

All three tests do the same thing: they store a **complete** usage report, then feed the daemon an
**incomplete** one, and expect `chooseUsage` (`tools/overseer/usage-carry.ts`) to say `keep-stored`.
But `chooseUsage` has an age bound: a stored report older than `LONGEST_ACTIVE_WINDOW_MS` — seven
days — is thrown away, because every rate-limit window in it has expired.

The fixtures have fixed dates (`collectedAt` of 2026-09-08 and 2026-09-09), and the daemon under
test read the **real** clock. So from about 2026-09-15 the stored report was more than seven days
old, `chooseUsage` correctly said `take-fresh`, and the tests went red. The code was doing what it
should; the tests had an expiry date.

## Why this is the cause, and not a hidden code regression

- **Nothing changed.** `tools/overseer/usage-carry.ts` has one commit (`0bbeb54f`, 2026-09-08, the
  one that created it). None of the three test files has changed since 2026-09-10.
- **Moving the clock moves the result, and nothing else does.** With the fix in place (the daemon's
  clock injected), setting each test's starting instant to **eight** days after its fixtures turns
  exactly these three tests red again, with the same messages as dev's run. Setting it to **six**
  days after turns all 25 tests in the three files green. The line between them is the seven-day
  bound.
- `tests/overseer-usage-carry.test.ts`, which tests `chooseUsage` directly, was never red: it already
  passes a fixed `NOW`.

## The fix

Give the daemon in these tests a clock that starts at the fixtures' own moment, rather than at
today.

- A new helper, `tests/helpers/fixture-clock.ts`: `clockFrom(iso)` returns a `now()` that starts at
  `iso` and then moves forward in real time. It moves rather than stands still because the daemon
  also uses `now()` to time its ticks and passes, and a frozen clock would change more than we mean
  to.
- `runOverseer` already accepts `now`. Each of the three files gets a `FIXTURE_NOW` constant just
  after its latest fixture date, and **every** `runOverseer` call in those files passes
  `now: clockFrom(FIXTURE_NOW)` — not only the three failing ones, so none of the others can start
  depending on the date later.

No production code changes.

## The simpler option passed over

Change the fixture dates to "now minus a minute". That fixes it too, but the tests then say nothing
fixed about when they ran, and a failure can't be reproduced by reading the file. Injecting the clock
keeps the literal dates, which the assertions also compare against.

## Checks

- The three files alone: red before (3 failed / 22 passed), green after (25 passed).
- The +8 days / +6 days check above.
- `npm run typecheck`.
- One full suite via `scripts/readiness-run.ts test`. The expected result is only the standing-jobs
  red.

## Reviews

- **GPT Sol on the plan** (read-only): the diagnosis holds — `chooseUsage` gets only the injected
  `now()`, and store restore and checkpoint timestamps do not read the wall clock on this path. One
  low finding, applied: pass the same clock to `makeUsageRetention` so a history record's
  `recordedAt` is on the fixture timeline too.
- **GPT Sol on the code** (fixing): approved. It moved `overseer-daemon-usage-pass`'s `FIXTURE_NOW`
  to 2026-09-10T06:01Z, after that file's per-account fixtures (still within seven days of every
  fixture), and corrected the helper's comment to say 2026-09-08 and 09. It re-ran the +8 / +6 day
  check and got the same result.
