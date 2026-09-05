# A button in Quotes mode to find more

**[SPIDERYARN-READING2-27](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-27)** · reported
2026-09-05 20:52 UTC · *already built — and the "more" part shipped ninety minutes before he asked*

## What Greg said

> Add a button in Quotes mode to find more

## The button is there, and he knows it is there

`Foot` in [`QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx) renders **Choose them again**
unconditionally whenever a list exists — not only when it is stale — and it calls `regenerate`, the
forced twin of `ensure`, which re-runs the whole quotes step. Its own doc comment says what it is
for: *"for the button offered beside a list that is current, where an unforced run would skip."*

And this is not the ordinary discoverability miss. **Yesterday he read that exact panel foot** and
asked us to delete the `claude-sonnet-5 · quotes/3` line printed above it. He has seen the button.

## So what he meant was *more*, not *again*

That is the whole report, and it was answered earlier the same evening, in
[260905g](../plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md): `MAX_QUOTES`
16 → **32**, and the suggestion from one per 600 words (4–16) to one per 300 (**8–32**). A 4,000-word
piece now asks for ~14 rather than ~7.

He filed this at 20:52 from production build `6f563997`, which did not have that change.
**It deployed forty-five minutes later**, at 21:37 UTC, in `6eecb377` — so it is live now.
`PROMPT_VERSION` went to `quotes/3` with it, so **every existing list now wears the quiet banner** —
*"These were chosen by an earlier version of the prompt"* — with **Choose them again** directly
beneath it. Pressing it returns roughly double.

[quotes.md § What is still open](../project/quotes.md#what-is-still-open) records that the doubling
happened *"because … Greg asked for 'many more'"*. This report is that same ask arriving through a
second channel, from a machine that had not yet received the answer.

## Two things not done, and why

**The label was not changed to "Find more".** It would be a lie on any article already at the target,
and a version of it conditional on the `outdated` banner is only honest by accident — it works today
because *this* prompt bump happened to be the count, and the next bump makes it wrong again. Keying
it to word count is real plumbing in exchange for softening one re-file.

**Append was not built.** [quotes.md § It replaces. It does not append.](../project/quotes.md)
records that as a decision, on the reasoning that a piece has a dozen quotable lines rather than an
encyclopaedia, and nothing about a 32 cap changes it. Append also needs back the forbidden-list
machinery that was deliberately removed.

## The thing that would make this wrong

**If he files it a third time after the deploy, on an article already at `quotes/3`.** Then "more"
means *beyond what the prompt asks for*, and the right build is a count control — "find more" as a
re-run with a raised target, still replacing rather than appending, ids inherited for the lines that
recur. That is a real dial and it keeps the design decision. Build it on the second filing, not this
one.
