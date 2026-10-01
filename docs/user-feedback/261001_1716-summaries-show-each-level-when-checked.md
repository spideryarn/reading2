---
reports: none
ending: declined
---

# Show each summary level as soon as it has passed its check

Not from a reader. The Overseer dispatched it on 2026-10-01 after plan 261001j's streaming section,
and there is no Sentry id. The time in the file name is when this session received the brief.

> that would be nice, but not if it adds too much complexity
>
> — Greg, 2026-10-01, on whether summaries should appear sooner

**Ending: awaiting Greg. Not built**, as the brief said to do if the plan showed it needed a new
transport, a new storage shape, or more than a few hundred lines. Plan and GPT Sol's review:
[261001o](../plans/261001o-summaries-show-each-level-when-checked.md). Sol agreed it should stop.

In short: a Simple press is a queued job, and a step's result is committed only when the step ends,
so a level that has passed its check has no way to reach the browser early. The one route inside the
budget is to stream the job's `advance` call, about 250–400 lines. But only the tab that claims the job
receives that stream, and that tab may not be the one showing the panel. Every route that works in
whichever tab the reader is looking at needs a job field, a partial artefact or a new channel, and
the cheapest of those is about 550–700 lines. Recommendation: keep the press as built, unless Greg
accepts the one-tab trade-off.

**Greg chose A, 2026-10-01** ("Q-summaries-sooner A"): keep the press as built. Not built.
