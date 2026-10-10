---
reports: spya-hrfj6q
ending: shipped
comment: The Referee error was a stored failure from 5 September, before the 28 September fix; a retry works now. The same overflow was live in Search on long papers, and that is fixed.
---
# Referee: "the answer was longer than there was room for" — a five-week-old failure, and Search one notch from the same one

`spya-hrfj6q` (#540), filed as a problem by Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-09 23:59 UTC, from Referee on
`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz`, build `5f6d3d5f`. Sentry
`SPIDERYARN-READING2-GN`. Overseer queue item `qi-75r4ct5p`, session
`fbgn-referee-criteria-overflow`. This session has no Sentry sign-in and did not write the Sentry
status; the next feedback sweep does.

> The answer was longer than there was room for, so it arrived incomplete and could not be used.
> Trying again sometimes gets one that fits. [ai-overflowed-no-ask]
>
> — the message Referee showed Greg, reported verbatim, 2026-10-09

## What it was

**The error on screen was from 5 September, and its cause was fixed on 28 September.** The
article's one Referee criterion was run on 2026-09-05, when Criteria's allowance was a flat 4,000
tokens and the model's thinking counted against it. That run spent 2,359 tokens thinking and was
cut off at exactly 4,000 (production `ai_calls`). The failure was stored on the criterion and shown
again every time the mode opened. No Referee model call was made on 2026-10-09.

Plan [260928c](../plans/260928c-referee-claims-fail-on-long-pieces.md) fixed that class for
Criteria and Claims on 2026-09-28. On today's code, four criteria over the same 152,000-word paper
all succeeded, using at most a quarter of the allowance. The row's **Try again** re-runs it under
the new budget.

## What shipped

The brief asked whether other modes share the path. A sweep of every model job's production
peak against its ceiling found one that really did: **Search**. On the same paper it failed two
runs in five with the sibling message `[ai-overflowed]`, after thinking for ~2,450 tokens, and the
reader waited 27 s for the failure. It now names an effort (`medium`), and its allowance is written
as room for the answer plus room for thinking. At `medium`, every run answered in 8–10 s with the
first passage at about 2 s. The one cost: on the broadest query it found 11–12 passages where the
old setting, when it did not fail, found 19.

Also: the PDF front-matter pass got room for thinking (it fails soft, to a worse title). The
warning that names "the thinking ate the allowance" now fires for non-streamed calls too, so
Debate and the PDF passes are covered. Debate was checked and left alone: its near-ceiling figures
were totals across web-search rounds, not one answer.

Plan, measurements and the two GPT Sol reviews:
[261010f](../plans/261010f-a-stale-referee-criterion-overflow-and-the-calls-one-notch-from-it.md).

## Left for later

- Hidden text's 60-second deadline does not grow with the allowance it is given. That is a timeout,
  not an overflow, and it is a queue item of its own.
- Whether a stored Referee error should say *when* it happened is a question for Greg.
