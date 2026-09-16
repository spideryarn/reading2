# The *Find it* button should say what it does

**SPIDERYARN-READING2-3K**, 2026-09-12, from Greg (an admin, so trusted input —
[feedback-reports.md § Who sent it](../project/feedback-reports.md)). Standing in Citations mode on
`temporal-context-reinstatement-spya-dhqkf9`.

> In Citation mode, there's a "Find it" button - make it clearer what that does (e.g. rich tooltip)
> and the effect of running it

## Ending: **shipped**, on `dev`

The button had a native `title`. It now has a `ControlTip`
([tooltips.md](../project/tooltips.md) argues at length that a `title` is not a small version of
one — it waits about a second, cannot be styled, truncates at the OS's idea of a line, and **does
not exist at all on a touch device**, which is the device this report was filed from).

The copy is bounded by what the code actually checks. Three things it may not say, and the first
draft said all three: not *one web search* or *one model call* (nothing bounds how many searches the
provider runs inside the call, and there was already a regression test in the same file forbidding
exactly those words); not a fixed price; and not *its own page*, since the validator accepts a result
whose title **or excerpt** carries the work's title. What it adds over the `title` it replaced is the
half the report asked for — the effect of running it: it costs money and reaches a paid third party,
a press that finds nothing stores nothing so pressing again just spends again, and the Scholar
fallback stays either way.

The plan, both GPT Sol reviews and the reasoning are
[260916b](../plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md). It shares
that plan with SPIDERYARN-READING2-3M, which was the larger half.

*(This session runs on a pool account with no Sentry sign-in, so the Sentry status write belongs to
the next feedback sweep — [feedback-reports.md § Into the Overseer's queue](../project/feedback-reports.md).)*
