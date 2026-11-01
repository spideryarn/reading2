# Referee Hidden text: the deadline comes from the ceiling

Queue item `qi-zymqjvd3`, authorised by Greg on 2026-10-10. Found by GPT Sol as F5 of
[261010f](261010f-a-stale-referee-criterion-overflow-and-the-calls-one-notch-from-it.md) and left
there as follow-up work, because it is a timeout and not an overflow.

## The bug

Hidden text's *Ask Opus about these* ([src/referee-hidden-check.ts](../../src/referee-hidden-check.ts))
sends a `max_tokens` that grows with the rows it sends — `outputTokensFor(rows)`, 2,048 + 300 a
row — under a deadline that does not: a flat 60 s. Those are two limits on one stream, and sizing
them separately is the class [token-budget.ts § `deadlineFor`](../../src/token-budget.ts) was
written for (plan 260928c, F1). At the most rows one call can carry, the ceiling is ~35,000 tokens
and `deadlineFor` of it is ~7½ minutes, so the 60 s clock can kill a run that is still writing a
perfectly good answer, and the referee is told it timed out.

## How big a call gets, measured

**The input budget, not the scan, sets the most rows a call can carry.** These are examples, not
a bound: short `invisible-characters` rows admit **116** (36,848 tokens, `deadlineFor` 485 s), and
Sol found short `hidden` rows admitting **118** (37,448 tokens, 493 s). Either is well inside
Vercel's 800 s `maxDuration`, which covers the whole request.

**Production has never run this check.** `spideryarn.ai_calls` has no `referee-hidden-check` call
and `spideryarn.referee_hidden_checks` is empty (read on 2026-11-01, in `begin read only`). So
there is no real large scan to time, and the measurement is synthetic:
[scripts/spikes/261101b-hidden-check-timing.ts](../../scripts/spikes/261101b-hidden-check-timing.ts),
one call, Opus 5.5 at `medium`.

| rows sent | input tokens | output tokens | first text | whole run | cost |
|---|---|---|---|---|---|
| 108 (of 400; the budget stopped it) | 32,080 | 5,912 | 3.3 s | **41.3 s** | $0.25 |

So the worst case already uses **69% of the 60 s clock** with almost no thinking (text arrived at
3.3 s). A run that thinks more at `medium`, writes longer reasons, or meets a slower upstream is a
few seconds from the line, and its full allowance (34,448 tokens) could not arrive in 60 s at any
speed we have measured. The input comment's "about 15k tokens, under ten cents" was also wrong by
half: fenced rows tokenise at about one token per two characters, so the full budget is ~32k
tokens and ~25 cents. Corrected at the constant.

## What we do

**Derive the deadline from the ceiling, per call, never below the old 60 s:**
`hiddenCheckTimeoutFor(sent) = max(60 s, deadlineFor(outputTokensFor(sent.length)))`,
the way Search (`SEARCH_TIMEOUT_MS`) and Criteria (`CRITERION_TIMEOUT_MS`) already do. It differs
from theirs only in being computed per call, because this ceiling depends on how many rows went.
The stall clock (30 s with nothing arriving) is unchanged and is still what catches a hung stream;
the deadline only ever fires on a stream still moving. The browser has a 60 s **stall** clock
(`useHiddenCheck.ts`, `sse.ts`), not a total one, and the route's SSE heartbeats keep it alive, so
it needs no change.

**The floor (Sol's plan review, 1).** Without it a small call's deadline would get *shorter* —
two rows is 2,648 tokens, 35 s. `deadlineFor` has no startup allowance, its rate was measured on
Sonnet rather than Opus, and keep-alive comments reset the stall clock without any answer
arriving. Nothing measured fails at 35 s, but nothing is gained by shortening it either.

**The simpler option passed over: cap the rows to what 60 s serves.** At `deadlineFor`'s 95
tokens a second, 60 s serves ~4,500 tokens, which is about eight rows. The rest would come back
"not checked", on exactly the page that most needs the check. Capping trades a correct answer for
a shorter wait; deriving costs nothing, because the deadline is a ceiling on a stream that is
still streaming. (Progress `delta` frames come only with answer text, so a long think shows no
count; heartbeats keep the connection open meanwhile.)

## The test

Red first: a run over 400 rows (the budget sends ~116), with `fetch` stubbed by a stream that
stays open and `AbortSignal.timeout` replaced by controllers the test fires. It asserts exactly one
clock is armed, at `hiddenCheckTimeoutFor(sent)` and at least `deadlineFor` of the `max_tokens` on
the wire, and that firing *that* clock is what aborts the request and ends the run with the
took-too-long message. Sol's review (2) asked for the firing, so the test proves the clock that
governs the request rather than one that was merely made. With the old 60 s it fails
(`[60000]` vs `[485000]`). A second case pins the 60 s floor at two rows.

## Reviews

- Plan: GPT Sol, read-only — [261101b-plan-review-sol.md](261101b-plan-review-sol.md). GO, with
  four findings, all taken: the floor (1), the stronger test (2), the client's stall clock and the
  progress claim (3), the row count as an example (4).
