# Quotes: long enough to stand on their own

**[SPIDERYARN-READING2-3C](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3C)** · reported
2026-09-12 08:23 UTC · kind `suggestion` · sent from
`/read/entropy-24-00930-spya-bmvfyb?at=spya-mt5nt3&mode=summary&remember=quiz&deep=2`, build
`607b57a0`, an iPad

**Ending: shipped.** On `dev`, not deployed. The Sentry issue should be marked *resolved*. This
session has no Sentry sign-in, so the next feedback sweep sets that from this line.

## What Greg said

> Make a small tweak to the way quotes mode works to allow the quotations to be a lot bit longer. I
> mean, they could almost be an entire block if the whole block is really, really good. But right now
> I'm noticing there are quotes where it sort of captures the introductory bit, but not the rest. And
> so one couldn't read the quote on its own in isolation and get much from it. You'd have to click on
> the quote to get to the original block and read the rest of the block in order to see what the— to
> get, for the quote to sort of, in other words, the quote is not self-sufficient. It only has real
> meaning in the context of the wider block that it's part of. So that to me is an indication the
> quote needs to be longer.

## What we did

`quotes/6` — [260912e](../plans/260912e-quotes-long-enough-to-stand-on-their-own.md). A quote is
now a *passage* — one sentence, several, or the whole paragraph — and the prompt makes standing alone
the test, straight after what earns a quote; a quote can be up to 1,200 characters, up from 400.
Neither half works alone: 53 of the 69 paragraphs in the article he was reading were over the old
ceiling, and a first wording that only added a section left the quotes as short as before, with his
own example — the *"grand challenge"* opening line — chosen again word for word.

On that article, one pass before and three after: the median quote went from 148 characters (a sixth
of its paragraph) to 202–255, and a finding now arrives with its payoff rather than without it. Whole
paragraphs stay rare — one or two in 22.

**New lists only.** The list he was reading keeps its short quotes, and Find more cannot lengthen
them. Whether an outdated list should be offered a rewrite is left for him, in
[awaiting-approval.md](awaiting-approval.md)'s shipped-but-open table.
