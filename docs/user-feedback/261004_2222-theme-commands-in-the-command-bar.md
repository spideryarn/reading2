---
reports: spya-c5wdn7
ending: shipped
---
# Command bar: switch between Light, Dark and System

Greg (admin), 2026-10-04 22:22 UTC, a suggestion, on
`/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug?mode=structure&margin=1&at=spya-jgmhjv`.
Sentry SPIDERYARN-READING2-D8; provenance proved from the production row
(`feedback-reporter.ts` exited 0). Overseer queue qi-n2hfcag6.

> Add a command in the command bar to be able to switch between dark and light mode, and I guess
> system mode as well.

**Ending: Shipped**, on `dev`. Plan
[261005d](../plans/261005d-theme-commands-in-the-command-bar.md), with GPT Sol's review of the plan
(four findings, all taken) and of the code (no findings).

The command bar has three new rows: *Appearance: Dark*, *Appearance: Light* and *Appearance:
System*. They appear once something is typed. `theme`, `appearance` or `colour scheme` lists all
three; `dark mode`, `night mode`, `light mode`, `system` put theirs first. Enter changes the colours
at once and closes the bar.

It is the setting /profile already has, reached by a second door: the same choice, kept on the
device, so changing it in one place changes it in the other. The row for the choice in force has a
small `current` at its right-hand end. If the browser refuses to keep the choice (a private window),
the colours still change and the bar stays open to say it will last only until the page is closed.

Checked in a browser at desktop, iPad and phone widths, in both palettes.

Not built, and not asked for: the bar is drawn only on the reading view and the article's Metadata
page, for the article's owner, so there are no rows on the shelf, on /profile, or for a visitor
reading somebody else's article. That is a question about where the bar is, put to Greg in the
session's debrief, not a half of this report.
