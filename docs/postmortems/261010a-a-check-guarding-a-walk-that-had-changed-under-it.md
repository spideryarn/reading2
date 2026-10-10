# A check guarding a walk that had changed under it

Up: [postmortems.md](../project/postmortems.md). Reports spya-nbmce7 and spya-q2w7yt (Greg,
2026-10-09); fix in plan
[261010g](../plans/261010g-skim-deeper-passes-always-longer-and-a-previous-stop-door.md). The mode
is [skim.md](../project/skim.md).

## What happened

Skim's Gist, More and Most are meant to get longer as they get deeper. Greg's route through
*Attention Is All You Need* walked **Gist 3, More 5, Most 4**. He re-ran it and it came out
5 / 10 / 13, and could not tell why. In production, 8 of 29 stored routes had a deeper pass no
longer than the one before it; in a fresh measurement of the old prompt, 6 of 12 runs did
([261010a](../investigations/261010a-skim-per-pass-targets-and-walked-growth.md)).

## The root cause

The only rule that a deeper pass is bigger is `growthFailure` (src/skim.ts, Sol F2, 2026-09-28). It
was written while the passes **nested**: More was Gist plus more stops, so "the passes grow" meant
"the cumulative counts at depth ≤ 1, ≤ 2, ≤ 3 grow", and that is what it checked.

Then the walk changed twice, both times on the client:

- **2cc6c6264** (260929e, 2026-09-29): each pass walks only its own stops. The commit says so in as
  many words: *"Client only: the stored route, the prompt and PROMPT_VERSION are unchanged."* The
  plan's own doc line kept the old reading: *"`visibleCounts` still counts that way."*
- **261003l** (2026-10-03): a pass may also walk earlier stops carried into it (`again`), capped at
  half its own.

After the first, cumulative growth only proves that each deeper depth has *at least one* stop of its
own; after the second, carried stops can make a shallower pass longer than a deeper one. The check
went on passing and the prompt's cumulative targets (`about 6 at depth 1 or 2`) went on asking for
More = Gist on short articles. Nothing was wrong with either line; the meaning of "a pass" moved out
from under both.

## The class

**A check guarding a walk that had changed under it**: an invariant stated in one representation
(stored depths, cumulative) and enforced there, while what the user experiences is computed from the
same data a different way somewhere else (passes walked, on the client). When the second
computation changes, the invariant still holds over the first and says nothing about the second.
It is a cousin of a check that shares an assumption with the code it checks
([silent-success.md](../reusable/silent-success.md)): here the check shared the *old* assumption,
and the code moved on.

## The fix that shipped, and the right one

Shipped: one definition of what a pass walks (`src/skim-passes.ts`, imported by the band and the
server); the growth rule judged on that (`passSizes`); per-pass targets in the prompt (`skim/12`);
and a repair (`growPasses`) that drops a carry or moves a low-priority stop one pass deeper before a
short route can be written. That is the right long-term shape too: the invariant is now stated over
the thing the reader sees, and the reader's view is computed by the same function.

Not done: the 8 stored routes keep their walk until planned again (the version stales them
silently).

## What would have caught it, ranked by ease against value

1. **One definition, imported by both the check and the view** — done here. Had `growthFailure`
   called the client's `passCount` from the start, 260929e would have turned it red the day the walk
   changed, on the existing fixtures.
2. **When a change says "client only: the stored data is unchanged", ask what on the server checks
   that data, and in which shape.** A habit, free. 260929e named `visibleCounts` and moved on.
3. A production sweep of stored routes against the walk after each Skim change — rejected as a
   standing job: one-off reads (as here) answer it when someone asks, and (1) removes the need.
