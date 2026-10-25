# A fixed wait raced the address throttle

**What happened.** `tests/admin-vouchers-page.test.tsx` failed in two of the readiness loop's full
`npm run check` runs and passed in every other one, and alone:

| Run | Commit | Test | Assertion |
|---|---|---|---|
| 2026-10-23 03:31 UTC | `8eeaf400c` | sinks a voucher with no note, or a blank one, under either arrow | `expect(query().get("dir")).toBe("desc")` received `null` |
| 2026-10-24 23:16 UTC | `3cd4c22ee` | keeps the sort when the tab changes, and the tab when the sort does | `expect(query().get("tab")).toBe("given")` received `null` |

Both are the same shape: the second of two clicks in a row, then a read of `location.search` that
finds the parameter not yet written. The logs are under the runner checkout's
`logs/readiness-runs/` ([readiness.md](../project/readiness.md)). Neither run timed out: the file
took 11.7 s and 12.2 s, among the faster of the eleven full runs since it grew to 97 tests (the
others took 11.9–16.6 s).

## Root cause

nuqs does not write the address when the state changes. It queues the write and flushes it from a
`setTimeout`, **throttled to 50 ms after its previous flush** (`ThrottledQueue.flush` in
`node_modules/nuqs/dist/debounce-*.js`: `flushInMs = Math.max(0, timeMs - (performance.now() - lastFlushedAt))`).
A first click usually flushes at once. A second click inside 50 ms of the first one's flush is
written up to 50 ms late.

The test's `click()` waited a fixed amount, one `act()` plus ten 1 ms ticks, and then read the
address once. The wait is really "however long React takes to render the click", measured at
55–90 ms per click on the box. That is longer than the throttle almost every time, so the read
almost always came after the write. Faster rendering can let the read come first.
That fits the failures in relatively fast runs; the historical logs do not measure individual
clicks, so they do not establish that those clicks rendered faster. A slower render can hide
this race, so load alone does not explain it.

The rule was already written down. [testing.md § A nuqs write outlives the test that started
it](../project/testing.md#a-nuqs-write-outlives-the-test-that-started-it) says *"Poll for the value;
don't sleep past the throttle"*, and `tests/admin-author-gifts.test.tsx` already has an
`addressSettles` polling helper (with a short budget; see the sweep below). This file's
`?by=`/`?dir=` reads came with the sortable Given table in `3a60c45b3` (2026-10-21, plan 261021i stage 2), which used the same `click()` +
`query()` shape as the `/admin/users` tests rather than the polling helper next door.

**The class: *a fixed wait raced a throttle it did not know about*.** The wait works only because
something unrelated, here render time, happens to be longer than the throttle. Nothing ties the two
together, so the margin is invisible until a run where it is gone.

## Reproduction

The window is wall-clock time, so repeating the file does not hit it reliably: 24 runs, six at a
time, all green. Widening the window does. In jsdom, nuqs uses a 320 ms throttle when
`window.GestureEvent` exists (its Safari fallback branch; a recognised Safari 17+ user agent gets
120 ms), so setting that before nuqs loads keeps the same code path and makes the window six
times wider. With it, three tests in the file failed every time, at the reads above
and one more (`sorts from a header…`, `?dir=`). With the fix, all 97 passed under the same stressor,
and then 20/20 without it, five at a time.

## The fix

Address assertions now wait for a changed value that the click should have written:
`address(key, value)`, which is `vi.waitFor` around the read, as testing.md says. One flush writes
every key these synchronous setters queued: `setBy(..., throttle(0))` still joins the shared
throttle queue, and `setDir` joins it before its timer fires; `chooseTab` likewise queues both
`tab` and `gift`. Unchanged neighbouring keys can therefore be read plainly after a changed key
has reached the address.

Review caught one wait that could pass on an old value: the second Private note click may already
have written `dir=desc`, so waiting for that value after two Note to them clicks could return
before either reached the address. The test now waits for the first Note to them click
(`by=recipientNote`, with `dir` absent) before toggling it. With a known Private note descending
write and the widened window, an added check for `by=recipientNote` failed after the original
wait returned, receiving `note`; it passed after this change.

Row order needed no change: nuqs updates its React state at once, and only the address waits.

A queued write at the end of a test does not leak into the next one. Traced with the widened
window, it is cancelled by `afterEach`'s external `history.replaceState(null, "", "/")`:
`enableHistorySync()` patches that call, which resets and aborts the nuqs queues. Unmounting
alone does not cancel them. So this file's tests that end straight after a header click needed
no extra address wait.

This is also the right fix for the long term. A longer `settle()` would be the "fixed delay bakes
the current throttle into the file" that testing.md warns against.

## What would have caught it, ranked by ease against value

1. **Sweep the nuqs suites with the window widened.** Setting `window.GestureEvent` in the unit
   setup widens the race window and exposes candidates, including suites whose polling or fake
   timer budgets are shorter than the wider throttle. Done once for this postmortem; results
   below. Cheap, but each failure needs triage before calling it a sibling.
2. **A review question for any test that reads `location.search`: what waits for the write?**
   Free, and it would have caught `3a60c45b3`. Habit-only, so it will be missed sometimes.
3. **Run the unit lane with the wide throttle permanently**, as a setup default. Rejected for now:
   a 320 ms flush makes every nuqs suite slower, and it tests a timing the app never has on Chrome.
   Worth reconsidering as a weekly sweep if the sweep below keeps finding cases.
4. A lint rule for `location.search` after `await click(`. Rejected: the read is often several
   lines away, through a helper like `query()`, and a text match would be both noisy and easy to
   step round.

### The sweep

On 2026-10-25, the 112 test files that import `nuqs/adapters/react` were run in the unit project with
the 320 ms window, after this fix. **23 files, 49 tests, failed**, and the same 23 passed all 1,006
of their tests without it. Most failures read like this one, an address or the state it drives
still holding the old value (`expected null to be 'spya-…'`, `expected 'chat' to be 'learn'`):

> a-broken-mode-leaves-the-article-readable · admin-articles-page · admin-author-gifts ·
> admin-costs-page · admin-page · chat-draft-survives-a-mode-change · chat-lists-every-conversation ·
> comment-jump · dock-quick-search · every-mode-draws-its-surface · glossary-ask-adds-term-band ·
> jump-history · learn-own-thread · mode-herald-wiring · public-network-trace ·
> question-press-answer-does-not-loop · referee-criteria-panel · search-as-you-type ·
> search-parallel-finds · shelf-topics-detail · shelf-topics · skim-figures · skim-panel

**That is a list of files to look at, not a count of races.** A suite that already polls but gives
up within 320 ms (`addressSettles` in `admin-author-gifts` stops at 50 short ticks), or one that
drives nuqs with fake timers, can fail here while passing at 50 ms. None of them has been triaged; that
is follow-up work, and this file fixes only the one readiness caught. To repeat the sweep, add this
line at the end of `tests/setup/unit-no-database.ts` and run the files with
`SWEEP_WIDE_THROTTLE=1 npx vitest run --project unit <files>`:

```ts
if (process.env.SWEEP_WIDE_THROTTLE && typeof window !== "undefined") (window as unknown as { GestureEvent?: unknown }).GestureEvent = class {};
```
