# Second review: the fixes for your ten findings

You reviewed this code earlier today and said **"do not ship"**, naming three blockers — the strict
client boundary, lock ordering/ownership, and a mutually exclusive coverage timeline — plus seven
more. Your review is at `docs/plans/260908f-box-health-history-code-review-sol.md`.

All ten are addressed. **This round is narrower and adversarial: did I actually fix them, or did I
write something that passes my own tests and still draws a wrong day?** A fix that moves a bug rather
than removing it is the thing to hunt.

## The diff

```
git diff 4167a7a0 HEAD
```
in `/home/greg/code/spideryarn2/.claude/worktrees/health-history`. Two commits: the swap-activity
mark, then the fixes for your review. Read the files in the tree.

## What I changed, by your numbering

1. **Client boundary.** `parseHistory` now refuses `schema !== 1` naming what it saw; refuses a
   missing/renamed `samples` array as "a payload this page cannot read" rather than an empty day;
   and turns each run of rejected samples into a positional hole bracketed by its neighbours,
   appended to the store's own `holes`. `tests/fleet-history-client.test.ts` is new and covers the
   three cases you verified by hand.
2. **Lock.** `takeLock` now runs BEFORE `truncateToLastLine`, and a locked-out opener repairs
   nothing. Every append re-checks `stillOurs` and, on failure, sets `lockedOutBy` and stops writing.
   The test was watched red by putting the old order back.
3. **Coverage.** A sample now covers `min(next sample, atMs + gapAfterMs(sample), toMs)` rather than
   running to the next sample — so an unknown followed by four hours of silence no longer paints
   them. Verdict bands use the same rule. `<Absences>` is drawn AFTER the unknown/absent rects, so
   the hatch is on top. `latestIsCurrent` gates the word "now".
4. **Predecessor.** The ongoing-gap check falls back to `view.predecessor` when the window has no
   samples, and the panel's empty-state branch requires no gaps, no unreadable lines and no rejected
   samples.
5. **Slack.** `gapAfterMs` is now `nextDueMs + clamp(nextDueMs * 1.5, 60s, 120s)` — capped, so a
   313s fleet backoff buys 7.2 minutes of blindness rather than 12.5. I still declined the separate
   health loop; it is a follow-up. **Tell me if the cap is the wrong shape.**
6. **Banner.** Now "There is no record after that time, so nothing here can tell you how the box has
   been since." `lockedOutBy` counts as trouble immediately.
7. **Record cap.** New `MAX_LINE_BYTES` (64 KiB) measured with `Buffer.byteLength`; rotation
   compares bytes with bytes; an oversized sample is a reported retention failure, not poisoning and
   not silence.
8. **`collapseVerdict`.** Bands are clipped to the window, zero/negative width skipped, columns
   half-open (`floor(start)` … `ceil(end) - 1`).
9. **IO wait.** `critical: Number.POSITIVE_INFINITY` — amber only, because the real rule needs
   `activelySwapping` too and a one-axis band cannot say it. The combination stays in the verdict
   strip.
10. **Polling.** A generation counter; only a strictly newer response may write.

Also new since your review: a `mark` on a series spec, drawing `activelySwapping` as a bar along the
bottom of the IO chart and totalling it in words. The brief asked for swap *activity* and I had drawn
only the percentage — my own lossy join.

## What I want attacked

1. **Each fix, against the failure it was supposed to remove.** Especially 3: is the coverage rule
   now airtight, or can some combination of an unknown reading, a hole, and a gap still paint or
   still bridge? Your phrase was "one normalized sequence of mutually exclusive coverage spans" and
   I did not build that — I clamped the spans instead. Is the clamp sufficient, or does the
   simpler-looking fix leave a case?
2. **Anything I broke.** These were surgical edits to code you had already read.
3. **The two I declined**: the separate health loop, and the shared classifier refactor. Still the
   right calls at this size?
4. **`latestIsCurrent`.** It uses `until` rather than `coversUntil` — I got that wrong once already,
   where a value followed by an unknown still counted as reaching the edge.
5. Anything still able to produce a confident, plausible, wrong picture.

## Verified in a browser at 390px after the fixes

The seeded day still renders: two breaks (one seeded, one real from a `chmod 400` test), the
before-the-record boundary, the violet unknown band, "swapping 1.8 h" with its bar, and the IO chart
now amber-only rather than red.

## Output

Numbered, most severe first, with the concrete scenario for each. Say plainly which fixes are
correct — I need to know what to leave alone. Finish with: ship it, ship with named changes, or do
not ship.
