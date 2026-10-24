# A duplicate check before slow work is not a concurrency guard

Nothing reached a reader: review of commit `9966db02df90` found that two action events arriving
together could both capture the same source and open separate receiving tabs. The check for an
existing tab ran before capture, but the record it checked was written only after capture and tab
creation.

## The class: check-then-act across an interleaving

This was not a missing duplicate check. It was a check whose protected fact did not exist until
after slow asynchronous work. A second invocation could cross the same gap. The same shape appears
whenever “is one running?” and “mark one running” are separated by an `await`.

The introducing commit was `9966db02df90`, which built the extension handoff. Its sequential
second-press test passed because the first invocation had already written the record.

## Why nothing went red

The test covered press, await completion, press again. It did not hold the first capture open while
delivering a second action event, so it shared the implementation's serial assumption.

## What would have caught it, ranked by ease against value

1. **A barrier-based concurrent test** — delivered two presses before either completed and failed
   with two captures. Added in `tests/extension-handoff.test.ts`.
2. **Make ownership precede slow work** — serialising presses per store closes the gap and keeps the
   existing opened-tab record as the durable duplicate decision. Done.
3. **A database uniqueness scheme for source addresses** — rejected: IndexedDB is local and a
   short in-worker queue expresses the actual event boundary with less machinery.

## The long-term fix

The shipped fix is also the long-term one: a per-store promise tail serialises action events, and
the existing source record makes later presses focus the first receiver. The test controls the
interleaving rather than merely calling the function twice.

## The thing I would tell myself

I would ask where the “already running” fact is written, then put a second event immediately before
that line. A duplicate check is evidence only for the interval it makes indivisible.

---

Up: [postmortems.md](../project/postmortems.md)
