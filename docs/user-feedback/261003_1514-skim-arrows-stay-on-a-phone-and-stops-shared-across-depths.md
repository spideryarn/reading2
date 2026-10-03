---
reports: spya-kudr63, spya-ms9d69
ending: shipped
---
# Skim: the arrows stay in Skim on a phone, and a stop may appear at more than one depth

Two reports from Greg, filed four minutes apart on 2026-10-03 from an iPhone in portrait, relayed
by the Overseer as an admin's reports (queue item `qi-fqe3q8je`). Both proven from the production
row with `feedback-reporter.ts --report-id` (exit 0); the Sentry events were not matched.
SPIDERYARN-READING2-B9 and -BA.

> We have special behavior for portrait on an iPhone because it's just not possible to show a mode
> and the text at the same time in a sort of meaningful way. So when the mode is visible, it's
> visible, and if you click somewhere, it takes you to the article. And that's okay. It's probably
> the best compromise. There's just one case where I think this doesn't work. So if I'm in skim
> mode, then those left and right arrows at the top, I would like to be able to press those and
> stay in skim mode. Whereas right now, if I click them, they open up the article text. Now, in
> fairness, there is a back to skim button that shows up, so it's not a terrible experience. But I
> think in this special case, the left and right buttons of skim mode should stay in skim mode. Now,
> the extra thing to bear in mind is if I click on the skim mode item, like if it's showing me a
> quote and I click on the quote, I think I do want to be taken to the article. If there's a way to
> do this that isn't horribly complicated and brittle, great, let's make this change so that the
> buttons stay in skim mode. If it's going to make everything horrendous, then I can live with it
> as it is.
>
> — Greg, 2026-10-03 (`spya-kudr63`)

> In skim mode, I'd given these instructions that we didn't want to reuse the same items between
> the different levels of granularity because it would be annoying to see something you've already
> read multiple times. At the same time, I just went through an experience where it made it sort of
> spread. There were like two points made that were related, and one of them showed up in one in
> the gist, and one of them showed up in the more detailed version. And I guess it was trying to
> avoid having, you know, them show up in multiple levels, but it was very disjointed. So I guess it
> is okay if they show up across multiple levels. It probably is better. But maybe we could indicate
> in the UI that either that I've already read them, you know, because I spent a long time looking
> at them in other mode, or that they show up in the other modes. So maybe there'd be, and again, if
> possible, we want to avoid text labels. So maybe it's some kind of subtle visual indicator that
> indicates which of the three it shows up for. A bit like we have a spark line at the top of skim
> mode to show the trajectory. And then I think it would be reasonable to expect that anything in a
> core—well, okay, it would be reasonable if many of or some of the stuff that showed up in the
> coarser skim levels also shows up in the finer skim levels, because it may be that someone goes
> straight to the finer skim level and they don't want to miss out on something just because it's
> already in a coarser one. At the same time, it may be that something that's a good summary point
> for the coarser actually can be broken up into a few. Different quotes for the more granular. So
> it's not a guarantee, but nor is it excluded that something in a coarser level shows up in a more
> detailed level. And the visual indicator is a way for me to see whether I've probably read it or
> not.
>
> — Greg, 2026-10-03 (`spya-ms9d69`)

## What we did

Plan, both GPT Sol reviews and the browser check:
[261003l](../plans/261003l-skim-arrows-stay-in-the-band-and-stops-shared-across-depths.md).
The measurement of the prompt change:
[261003e](../investigations/261003e-skim-again-carried-stops-eval.md).
What is built is in [skim.md](../project/skim.md).

- **The arrows stay in Skim** (`spya-kudr63`). On a window where Skim covers the article, ‹ ›
  and the Gist · More · Most buttons keep Skim up; pressing the quote still opens the article at
  that passage. It was not complicated: one line removed.
- **A stop may be walked at more than one depth** (`spya-ms9d69`). The route now says which
  earlier stops to meet again in a deeper pass, and is told to put related stops next to each
  other. A pass repeats at most half as many stops as it has new ones, rounded up.
- **Dots under each stop's number** say which passes it is in, one per pass, filled or hollow. No
  text on the row; the (i) in the band's corner and `/help` say what they mean.
- **Only routes planned from now on.** An existing route walks as before until it is planned again
  from Metadata's *AI processing*.

## What Greg should know

- **It is not shown to fix the walk he described.** Blind reads preferred the new More for somebody
  who *starts* at More in 12 of 12 pairs. For somebody coming from Gist — his case — it was
  preferred 8 to 2, and two runs of the *old* prompt differ by that much. It is not worse on
  anything measured.
- **About a quarter of More is repeated stops**, a fifth of Most; the most in any one walk was
  40%. Full nesting, which he found annoying on 2026-09-29, was 43%.
- **The dots are clear on a phone and very small on a desktop screen.**
- **The other mark he offered, "I have actually read this"**, from time spent, is not built. It is
  a question in the session's debrief, `[Q-read-mark]`, with `[Q-depth-buttons]`,
  `[Q-mark-every-row]` and `[Q-carry-cap]`.
