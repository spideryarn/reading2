---
reports: spya-f37ug4
ending: shipped
comment: The digest's planner was asked for "up to 16" questions and wrote one; the code needs three. It now asks for 8–16. Not yet re-run live (the box's AI key resets 1 November); that check is queued.
---
# The Sources digest stopped at its plan: the prompt never said how few was too few

`spya-f37ug4` (#745, problem), from Greg (admin; `feedback-reporter.ts` exit 0 on the production
row). Filed 2026-10-31 09:27 UTC from
`/read/arxiv-2308-08708-spya-xax6v4?…&mode=sources&sources=digest`, build 5aab73ec. Sentry event
`0166e8a9483a4940ad525b7d875d8c06`. No screenshot; diagnostics yes. Addenda: none (read again
2026-10-31 before this note).

His words: the failure message itself,

> The plan for the digest did not come back with enough usable questions to search, so none was
> sent. Try again: another go plans afresh. [jb-digest-plan]

## What was wrong

The model answered normally (Sonnet 5.5, `outcome: ok`, 4.4 s, $0.23, production's own key, so
**not** a budget or limit error). It wrote **one** lead, and that lead passed every check. The code
refuses a plan of fewer than three leads. The prompt only ever said "WRITE UP TO 16 LEADS", so it
never told the model there was a floor. Evidence: the job row, `ai_calls` and the step-failure log line, all
read-only, in the plan.

## What was done

- The planner now asks for **8–16 leads** (`ASKED_MIN_LEADS`), and says what to do with a piece
  that cites little. A load-time check and a test keep the number asked for at or above the number
  refused. The schema now refuses empty lists. Prompt version `sources-digest/3`.
- The failure message is plainer: *"The AI service did not return enough questions to search for
  this digest, so no searches were run. Try again: each try starts afresh. [jb-digest-plan]"*. The
  threshold of 3 stays.
- A rule in prompting-guide.md: every floor the code enforces on a model's list is stated in the
  prompt.

Plan [261031b](../plans/261031b-sources-digest-planner-asks-for-a-floor-of-leads.md), with GPT Sol's
plan review; postmortem
[261031b](../postmortems/261031b-a-validator-floor-the-prompt-never-states.md).

## Deferred, queued

- **Running it live** to confirm the planner now writes 8 or more leads: the box's OpenRouter key is
  over its limit until 1 November. Folded into the existing measurement item `qi-dykn3xjh`, which now
  says to check `leadsWritten` first, on this paper among others.

Needs a deploy to reach production; the Overseer deploys.
