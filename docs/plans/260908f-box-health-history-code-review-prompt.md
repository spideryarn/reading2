# Review the built code — box health history

You reviewed the PLAN for this earlier today and gave the verdict *"rethink the absence model, then
build with the named changes. Do not build this plan as-is."* This is the code that came out of that.
**Weight this review above the plan-stage one**: a plan review cannot find a `PATCH` that writes one
field and then rejects the request.

Your earlier review is at `docs/plans/260908f-box-health-history-plan-review-sol.md`. What was done
about each of your eleven findings — including the two I declined and why — is in the plan doc under
**"What the plan review changed"**. Please check that section against the code: **if I claimed to fix
something and did not, that is the most valuable thing you can find.**

## The diff

`/tmp/claude-1000/-home-greg-code-spideryarn2/fa02b1be-bbe4-4359-8d88-801562f7b24c/scratchpad/hh-code.diff`
— one commit, 19 files. Read it with the files in the tree, which have since merged `origin/dev`.

New:
- `tools/fleet/health-history.ts` — the store
- `tools/fleet/health-wiring.ts` — the composition (your finding 5)
- `tools/fleet/routes-health-history.ts` — `GET /api/health/history`
- `tools/fleet/seed-health-history.ts` — a script that fills a store with a day containing every state
- `tools/fleet/web/src/history-series.ts` — samples to something drawable (pure)
- `tools/fleet/web/src/health-history-client.ts` — the four-arm reader
- `tools/fleet/web/src/HealthHistory.tsx` — the SVG
- four test files

Modified: `tools/fleet/server.ts`, `tools/fleet/refresh.ts`, `tools/fleet/web/src/HealthPanel.tsx`,
`tests/fleet-refresh.test.ts`.

## Context you need

An internal fleet dashboard on a Hetzner box running ~30 Claude Code sessions in tmux. Greg reads it
from a phone. It has a "Box health" mode; this adds 24h of history under it.

The house rule: four features in this same tool were built, tested, routed, shipped and DEAD — every
part had tests and none of the joins did. A postmortem written this morning names sixteen instances,
ten of them lossy joins where a producer said the careful thing and a consumer collapsed it.

**The feature is the absences, not the lines.** Four kinds of nothing, which must never merge:
a value; a reading whose command failed (violet, never zero); the collector itself throwing (its own
arm); and no sample at all (the line breaks, hatched). A break is never labelled with a cause.

## What I verified in a real browser at 390px

Not claims — I looked at each of these on the running server:

- a four-hour break: hatched, line broken, sentence "1 break totalling 4.0 h with nothing recorded —
  the longest was 4.0 h, ending 04:53 AM"
- a `collector-failed` turn: violet band across every series
- one reading unknown while the others read fine: violet on that series only
- the before-the-record boundary at the left, with its own rule and legend entry
- the retention-failure banner, forced with `chmod 400` on a live store: "Nothing is being written to
  the history. EACCES … Any break after that is this, not the box."
- real samples appended by the live loop into the same store the page was reading

Looking at it found three things no test did, all now fixed and documented: an axis fitted to the
window's peak that painted a normal day entirely red; "before the record starts" and "no reading to
take" sharing one grey; and ~200 sub-pixel `<rect>`s per chart.

## What I most want attacked

1. **Did I actually fix findings 1, 3, 4, 5, 6, 7, 8, 9 and 11, or only write that I did?** Check the
   code, not the prose.

2. **Finding 1's declined half.** I did not move health collection to its own loop. Argument: it is
   another workstream's file mid-wave, and it does not change what the chart may *claim*, which is the
   part that was wrong. Is there a case where the coupled cadence makes the chart WRONG rather than
   merely coarse?

3. **The poison narrowing.** Only a throw from `writeAll` poisons; a throw from `openSync` does not,
   because nothing could have been written. Is that reasoning sound for every error `openSync` can
   raise? Is there a partial-write path I have left un-poisoned?

4. **The gap arithmetic** in `plotHistory`, and `gapAfterMs`. Off-by-one, ordering, the interaction
   between the predecessor gap, the hole gaps, the ongoing gap, and `isGapStart`. Can two of those
   produce a duplicate or a missing break? What happens when `holes` and a real gap overlap?

5. **`collapseVerdict`.** It buckets ~1,200 samples into 360 columns taking the worst. Can a sample
   fall in no column, or be attributed to the wrong one? What about a band whose `toMs` precedes the
   window, or a zero-width band?

6. **The lock.** I import `tools/overseer/lock.ts` rather than copying it, and `close()` is
   idempotent because a double close threw `EBADF` from a cleanup path. Is the degrade-don't-refuse
   path right — the store reads while locked out, and every append silently sets `failure`?

7. **Anything that would produce a confident, plausible, WRONG picture on the page.** That is the
   failure mode that matters; a crash is cheap by comparison.

8. Anything I have over-built. The plan is long and so is the code.

## Output

A numbered list, most severe first. For each: what breaks, the concrete scenario, and what to do
instead. Say plainly where a decision is fine — I need to know what NOT to change as much as what to.
Finish with a verdict: ship it, ship with named changes, or do not ship.
