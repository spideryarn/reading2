# Trajectory: icons for navigation, the question first, a route sparkline, "where am I"

SPIDERYARN-READING2-5C (`spya-d896sz`), 2026-09-29, a suggestion from an admin (Greg), in
Trajectory. The time in this note's name is when the Overseer relayed it (about 14:35 UTC, a minute
after 59 so the two sort apart); this pool-account session cannot read Sentry's First Seen, so the
sweep should rename the note if they differ.

> In the trajectory, we have included these collapsed glossary entries, which is great. I love them. And if I click on one, it shows me more information in place, which is also great. And I'd like to be doing that for various kinds of snippets in the trajectory, as we've said separately. The thing I wanted to note is it says in the glossary as a piece of text. I'd rather that was an icon with a tooltip, because I'm trying to avoid adding more text than we need, because there's already so much text on the page. Icons should always have tooltips, and for navigation, I'm suggesting that where we can, we use icons + tooltips rather than text labels. And add this as a note to our design document going forwards.
>
> I also noticed something else in the trajectory mode. There's something a little bit strange underneath quotes. It seems to ask a question. Is that from the summary, or where does that come from? See if you can have a look at some screenshots. And there's just something about the placement of it that doesn't quite follow. It's like it shows the quote and then asks the question that it relates to. I kind of like the idea of situating the quote in terms of the question for which it's an answer. But if so, maybe the question should go first and add a tooltip so that it provides extra information to say something like, This is a generated summary, and which section it comes from.
>
> And in general, if we can try and help the user situate themselves when using trajectory mode in the, where they are in the article. So that could be partly breadcrumbs showing where in the hierarchy, although that takes up a lot of space and might be just extra noise. Maybe it's all hidden in tooltips. So if I hover, I get a sense of where I am in the wider article structure, like a mini tooltip showing the... Yeah, actually, it might be nice to have a reusable tooltip for the structure mode fish eye that actually would be useful when hovering over the spine to show, okay, this is where I am right now relative to the wider course hierarchy. So we could perhaps add that here when hovering on elements in the trajectory mode or hovering over the little vertical line indicator for how far through the article.
>
> One other related idea. At the very top of the trajectory mode, it says step n of m. Perhaps to the right of that, we could have a kind of sparkline that shows how we are going to move through the position of the document, how each step moves up and down in the document, or something like that, just to show what path the trajectory is going to take us on. In fact, if there were little sort of dots along the way, that would give us a clear indication of how many steps and how far through the steps we are. And so then maybe we wouldn't actually need step 11 of 18. You could just have that sparkline with a tooltip that would give you the number. And then that would mean that we could move the sort of three levels of detail up onto that same row to take up less vertical space.

**Ending: Shipped**, with one part waiting on Greg — on `dev`. The next feedback sweep does the
Sentry status write.

- **Icons**: *In the glossary ›* is the Glossary icon with a tooltip; Ideas and FAQ open the same way.
- **The design note** is in [icons.md § Navigation](../project/icons.md#navigation-an-icon-with-a-tooltip-not-a-text-label).
  **Waiting on Greg:** the one-line version for design-css-overview.md, which is a rule doc, is
  proposed in the session's debrief rather than committed.
- **The question** was the FAQ's, not Summary's. It now comes first, above the stop, with a tooltip
  saying it is a question the FAQ wrote, paired by the model with a passage in this paragraph, and
  naming the section.
- **Where am I**: hovering (or tapping) a row's vertical position line shows a small outline of the
  article with that stop's section marked. It is one component, built so the spine can use it; **the
  spine does not yet**, because its hover cards need a shorter version first.
- **Sparkline**: the head's "Stop k of N" is a line of dots, one per stop at its height in the
  article, with the number in its tooltip; the depth buttons share its row where the band is wide
  enough.

Plan: [260929f](../plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md).
