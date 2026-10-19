# A line number spliced into a block id cost the whole tree

**One malformed field in a sixty-node answer threw away the other fifty-nine, and the reader paid
for the retry loop.** The class: **an all-or-nothing parse over a long model answer whose faults are
local** — one bad value refuses the whole answer, so the failure rate grows with the answer's
length while each fault stays one boundary wide.

Reports: spya-c09nnb, spya-e2vxrw (Greg, 2026-10-19). Plan and evidence:
[261019l](../plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md).

## What the reader saw

A new reader imported a 648-block PDF at 19:36 UTC. The headings-first outline appeared at 19:40;
the full Structure never did. The step failed on arrival, and on two presses of Retry, at about
$0.58 each. Every mode that reads the structure — Quotes, Ideas, Simple, Tweets, Bibliography —
refused within 15 ms with "the structure of this article has not been built yet". A fourth attempt at
20:04 succeeded, and every one of those modes generated itself in the next three minutes. So Greg's
two reports, "why didn't it auto-generate highlighted-quotes" and "why didn't the Structure finish",
are one failure.

## The root cause

**The proximate fault is the model's.** The Structure prompt renders each block as
`[582] spya-xcf0dz <h1>: PART VI. EVIDENCE GAPS`. At effort `low` with a JSON schema, Sonnet does
no thinking at all, and when it copies a section's start out of that line it sometimes splices the
line number into the id: `spya-582xcf0dz`, `spya-582xcf`, `spya-582`. Four re-runs of the
production request produced a bad start in **four of four** answers, three of them at Part VI. In
production, 5 of 28 Structure jobs since 2026-10-03 needed the in-step re-ask.

**The root cause is ours.** `deriveStartRanges` (src/start-ranges.ts) refused the whole answer on the
first start it could not resolve. Every other fault in a starts-only answer is a local repair — a
start out of order drops one child, an outside start is clamped, a start one block after its heading
is snapped back — but an unresolvable start was a refusal, so one boundary out of sixty cost all
sixty. It refused even when the child was a **first child**, whose start the derivation discards in
favour of its parent's. The in-step re-ask (261001s) asked again with the same odds, and the reader
became the retry loop the re-ask was written to replace.

Why the refusal was written that way, which is the honest half: when every node carried an explicit
range, an endpoint that was not a block id was rare and loud, and "the precise error survives
instead of being buried by a tree built as though that child had never been proposed"
([structure-step.md](../project/structure-step.md)) was a fair trade. Two later changes moved the
odds without moving the trade: effort went to `low` on 2026-09-04 (`96f41ac8f`), and the JSON schema
on 2026-10-02 (`cc7b9cbd0`, 261001s stage 2), after which the model thinks not at all on this call.
261001s measured exactly that — *"at `low`, adapting to the schema, the model chose to skip thinking
altogether"* — and named it as a quality risk; what it did not measure was id-copying fidelity.

## The commit that introduced it

There is not one. The refusal is as old as the ranged builder and was carried into the shared kernel
by `3f09cf8bf` (261001s stage 1, 2026-10-02) unchanged. The odds changed under it in `96f41ac8f` and
`cc7b9cbd0`.

## The fix shipped, and the one that is right for the long term

**Shipped (261019l):** for the whole-document call only, an unresolvable start is never a refusal on
its own. A first child is not asked; a spliced line number resolves to the line it was copied from
when the rest of the string agrees with that line's id; a start whose `sourceHeading` names exactly
one heading between its neighbours resolves to it; anything else drops that one child into its
predecessor. More than one unrecoverable start in five still refuses. Recoveries are counted in
`recoveredStarts` on the step's log line.

**Right for the long term:** stop inviting the splice. The id and the line number should not sit
side by side in the line the model copies from, or the model should think on this call. Both are
prompt changes to every article's Structure, need the structure eval, and are queued separately. The
recovery should stay even then: it is what turns the next unforeseen local fault into a lost
boundary rather than a lost article.

## What would have caught the class, ranked by ease against value

1. **Treat every per-node fault in a long answer as a candidate for a per-node repair, and make
   refusal the exception that needs an argument.** A rule, and it would have caught this one at
   261001s, when the kernel was written. It belongs in
   [structure-step.md](../project/structure-step.md), which now says it.
2. **When a change makes a model think less, re-measure the answer's mechanical fidelity, not only
   its quality.** 261001s ran a quality panel; a count of answers that fail to parse or resolve over
   the same corpus would have shown the regression. Cheap, inside an eval that already runs.
3. **Alert on the re-ask rate.** `ai_calls` already says when a step needed two answers. A weekly
   figure in the cost analysis would have shown 5 in 28. Cheap; not built here.
4. Constrain `start` to an enum of block ids in the schema — rejected: grammar size on a
   1,000-block book, which is why `assertNoBlockIdEnums` exists.
