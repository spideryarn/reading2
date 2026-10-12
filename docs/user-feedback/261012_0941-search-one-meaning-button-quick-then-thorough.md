---
reports: spya-sy4rn0
ending: shipped
comment: Search's toggle is now just words and meaning. A meaning search shows a quick answer in about a second and swaps in the thorough one by itself once you stop typing; old quick links still open it.
---
# Search: one meaning button, quick first and then thorough

A suggestion from Greg (an admin; `scripts/feedback-reporter.ts` exit 0 on the production row),
filed 2026-10-12 from an article's Search mode. Plan and reviews:
[261012e](../plans/261012e-search-meaning-is-quick-then-thorough-one-toggle.md).

> In search mode, it looks like we have something that checks for exact string match, and then a
> quick mode, and then a meaning mode, which is effectively the thorough version of quick. Let's
> collapse those latter two so that really you just have the string matching version and then the
> meaning version. And let's, as an experiment for the meaning version, maybe it does a quick
> version asap and then replaces it with a thorough version as soon after as it can.
>
> — Greg, 2026-10-12 09:41 UTC (`spya-sy4rn0`, #577)

**Ending: shipped**, on `dev`.

- **Two buttons: words · meaning.** *Meaning* is what *quick* was: it searches as you pause, shows
  the quick answer in about a second, and once that answer has settled for two seconds (at once
  after Enter or **find**) the thorough search starts by itself and takes its place. That second
  half already existed for *quick* since 2026-10-04; this change made it the meaning button.
- **Old links keep working.** `?match=quick` opens on meaning, and chat's *Open in Search* now
  writes `match=meaning`.
- **What it costs, as an experiment:** the default matcher now spends without a press. That is a
  quick search per pause, and a thorough search (about $0.06) per settled answer. Before, meaning
  spent nothing until **find**.
- **What went:** asking the thorough search with no quick one before it. The row's **thorough**
  button stays on a quick row, for when the automatic one fails.
- **Kept as it was:** the bottom bar's *Quick search* box, its ⚡ and `/`, and the command bar's
  *Quick search “X”* row. They now open the meaning button. Say if you want them renamed.
- **Not done:** chat's in-place searches still stop at the quick answer. The thorough search after
  them, and one search client shared with Search mode, did not fall out of this; they are still
  held as `qi-dhy8q2nq`.

Sentry: this session has no Sentry sign-in; the next feedback sweep marks it resolved.
