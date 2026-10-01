---
reports: spya-xunuum, spya-f28vqj, spya-tw6zxw, spya-puyb6d, spya-qgh5ta
ending: shipped
---
# Five small ones: tooltips on Reply, the topic bars and *Topics*; plain glossary labels; one Metadata section

Five of Greg's own reports from the Feedback dialog (he is admin), sent between 2026-09-05 and
2026-09-30. None had a note, so his Earlier tab showed them as not shipped; none had been built
(checked against `git log origin/dev`, `docs/plans/`, this directory and `gjd-remote ls` on
2026-10-01). None reached Sentry (`mirrored_at` is null on all five), so there is no Sentry issue to
resolve. The time in the file name is when this session picked them up. Text read from production,
read-only.

`spya-xunuum`, 2026-09-29, Remember mode:

> In Remember mode, add a tooltip (e.g. on "Reply") to explain the dropdown with the various
> response types.

`spya-f28vqj`, 2026-09-29, the shelf's topics, More detail:

> In the faceted-text-search pills for filtering the Homepage Shelf, there are these coloured bars in
> the "more detail" view. It took me a while to figure out that they're probably a count/proportion
> of matches.
>
> Firstly, anything like that that's hard for the user to guess/intuit should always have a tooltip
> (make a note in `design.md` or similar).
>
> Secondly, if we have the bar we can remove the "N of M on the shelf".
>
> Thirdly, make the bars a little narrower or take up less space.
>
> And also: add rich tooltips (see `tooltips.md`) to the paper-links that are matched for each
> faceted-text-search-pill. In fact, better still, maybe create a reusable component for
> paper-tooltips that we use anywhere there's a link to a paper that shows title, authors, metadata
> (e.g. when added, when last opened, faceted-text-search-pills, and maybe some kind of preview or
> summary).

`spya-tw6zxw`, 2026-09-29, the shelf:

> For the faceted-article-pills on the Homepage Shelf:
>
> - It says "Topics" at the beginning of the row. Add a tooltip explaining how they're selected and
>   ordered. Or alternatively, make the ordering much more self-explanatory, because it's very
>   confusing right now (and then maybe we wouldn't even need "Topics" or the explanatory tooltip.
>
> - And get rid of the "Sort" text at the beginning of the row above. I think it'll be obvious
>   enough to the user already.

`spya-puyb6d`, 2026-09-05, the glossary, dictated:

> I tried check the web within a glossary entry and it seemed to work, it took a minute and then it
> came back and it added some section called asked not checked. I didn't understand what asked not
> checked means. Um and then the sentence the section itself seemed a bit confusing. Uh I couldn't
> tell well, I mean I I don't know if there's anything you can do about the prompt to make it a bit
> clearer. Um and I was expecting the stuff from the web to come with sort of citations and links to
> other articles, which would open in a new tab.

`spya-qgh5ta`, 2026-09-30, Metadata:

> And in Metadata mode, perhaps also amalgamate "What we did to it" and "Re-run AI processing"

**Ending: Shipped**, in part for two of them, with the rest named below. On `dev`, not deployed.

What we did:

- **Reply** has a card listing the four kinds of answer in a line each. Its last line says that a
  direct question, or "just tell me", always gets a plain answer, whichever kind is picked.
- **Topics, More detail**: the bars have a card saying what they measure. The *N of M on the shelf*
  text is gone, and the chip's own card still gives both numbers. The bars are narrower, 3rem
  instead of 4rem. Your rule that anything hard to guess gets a tooltip is now written down, quoted,
  in `docs/project/tooltips.md` § When something needs one.
- **Topics**: the word has a card saying how topics are picked and why they come in that order.
  *Sort* is gone from the screen. Screen readers still announce it as the group's name.
- **Glossary**: *checked* / *asked, not checked* now read *from a web search* / *no web search —
  from the model's own knowledge*. The card beside the label says the same thing in a sentence.
- **Metadata**: *What we did to it* has moved into the re-run section, below the re-run rows. The
  section is now called **AI processing**. *Technical details* keeps only the identifiers and the
  fingerprint. If reading the stages fails, the section opens and shows the error, as before.

Not built, and sent to the Overseer as follow-ups:

- **Rich cards on the articles linked from More detail**, and a reusable card for any link to an
  article anywhere in the app (from `spya-f28vqj`). That is a new component with its own data
  question, not a tooltip.
- **Making *Check the web* always search, or renaming it** (from `spya-puyb6d`). The model decides
  whether to search, which is why you got an answer with no sources. Even a search can come back
  citing nothing. My recommendation is to always search; it costs a search per press, so it is
  your call. Making the answer's own wording clearer means changing a prompt that comments share,
  so it needs an eval.

The plan, with the review: [261001j](../plans/261001j-five-small-feedback-tooltips-and-labels.md).
