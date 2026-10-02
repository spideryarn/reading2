---
reports: spya-ra5fuz
ending: shipped
---
# Summary sentences light up while their passage is on screen, with a card and a jump

Greg's suggestion from the Feedback dialog, filed 2026-10-01 16:15 UTC from Summary at Brief on
`jco-2005-01-libre-spya-hk9cc7`. SPIDERYARN-READING2-8V. Admin, proved by
`scripts/feedback-reporter.ts --report-id spya-ra5fuz` (exit 0; the row, not the Sentry event).
Not built before: checked on 2026-10-02 against `git log origin/dev`, `docs/plans/`, this directory
and `gjd-remote ls`. The only claim was this session, `fbra5fuz-summary-follows-the-text`. It follows
8K (`spya-rqch7a`, [note](261001_1241-trajectory-cue-above-quote-and-on-screen-block-links-lit.md)),
which lit the block-link chips.

> In the Summary Brief/Simple/Fuller sub-modes:
> - In a previous Feedback suggestion I'd said that it would be nice if we could highlight the
>   block-links that are currently visible in the text on the screen. I think that's still a good
>   idea. I just thought of something that would be even cooler...
> - Could we highlight the phrases or sentences in the summary that's being displayed that relate to
>   the blocks on the screen? So in other words, if the summary text has a sentence that says
>   something like "... and we showed that group A did twice as well as group B", then we would
>   annotate that summary-sentence with the block-links in the text that relate to it. So e.g. if
>   there's a block that describes the methods and another block that describes the results for
>   that comparison between group A and group B, then when either of those blocks are visible on the
>   screen, that summary-sentence would be highlighted.
> - And indeed, perhaps I could hover over the summary-sentence and it would highlight, and I'd get
>   a rich tooltip (see tooltips.md) that shows the quotes/blocks from the article that relate to
>   it, and I could click on those.
> - We want to make this be really helpful for the user, but we also want to keep the complexity
>   down as much as we can, especially for v1. So if it's making things much more complex for a
>   given summary-sentence to relate to multiple blocks, then we could just say that each
>   summary-sentence can link to a *single* piece of the text that most relates to it. And it's
>   worth saying that not every summary-sentence needs to point to somewhere in the text.
> - If we wanted to be really fancy, we might use multiple colours so that if there are multiple
>   points being made at the same time in the text, you can see which summary-sentence relates to
>   which block on the screen. And actually for maximum points, we would be able to map, we would
>   highlight individual sentences in the text that relate to individual sentences in the summary.
>   I don't know, that might be overcomplicating it. But then the idea would be that if we say, you
>   know, whatever, group A did twice as well as group B in the summary, that instead of just
>   highlighting the block that relates to that, you would highlight the sentence where they say,
>   and we ran, you know, an ANOVA and found blah, blah, blah. (I suspect that would be messier and also
>   probably involve a lot more annotations. So maybe defer that and anything else that's too much
>   complexity for a v2.)

**Ending: Shipped** to `dev` in `28f99cdf1`, with GPT Sol's review fixes in `2a43de179`. The plan is
[261002e](../plans/261002e-summary-sentences-point-at-their-passage.md), and the measurement is
[261002o](../investigations/261002o-summary-sentences-that-name-their-passage.md).

What was built is his v1. The writer now gives each summary sentence at most one passage, always one
its paragraph already cites, or none. That sentence is drawn as a block link with the sentence as its
words. So it lights while the passage is on screen (8K's rule), shows the shared card on hover, and
jumps to the passage when pressed. Summaries written before this draw as they did; *Write it again*
gives them sentence links. Deferred as v2, as he suggested: several passages per sentence, colours
per pairing, and lighting the sentence in the article itself.
