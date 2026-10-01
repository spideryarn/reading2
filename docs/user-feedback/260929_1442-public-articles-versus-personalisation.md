---
reports: spya-j5f7yv
ending: declined
---

# Public articles versus personalisation

Greg's own report, from production, `spya-j5f7yv`:

> So we have this idea of a public document where we do the expensive AI processing once, and then
> other people can read that document and view the fruits of that AI processing, but can't generate
> more of it. So they can't. So it's effectively free to serve the page once that one-off work is
> done. I really like this idea. At the same time, we have this idea that I can provide information
> either in my user profile or in the metadata for a given article that give information about my
> background and my interests or needs. So I might say that my background is in cognitive
> neuroscience, and then for a given article I might say that I'm trying to, I don't know, compare
> it to something else or learn about some particular principle, or that I don't know much about X
> and I'm trying to understand. And that those two pieces of information would then inform, you
> know, potentially the summary and the glossary and the ideas and everything else because, yeah,
> you can see why. These two things, having public documents and personalizing, are somewhat in
> tension because if it's personalized, then if I make it public, then it, you know, may not suit
> everybody. And so I think what I'm proposing is that perhaps we always do this, we always generate
> the stuff for those modes the same way, no matter what my background, but then we add some kind
> of, we do some extra processing afterwards that takes into account my background and my interests
> that personalize it. So, for example, maybe I might generate a glossary, and I always do that the
> same way, but then Then the post-processing personalization would flag some of those as being
> particularly relevant, or add a postscript that provides extra context that will be useful for
> me. And so I guess I'm imagining that this post-processing layer—well, I mean, I guess it could
> modify them, and then, you know, you'd have to somehow store it as an edit. I suppose I was
> imagining it'd be more like an addendum or overwriting certain value, yeah, an addendum, like an
> extra column or an extra piece of text or something. So you don't change what everyone sees. You
> don't change the version that everyone sees. You add extra information to it that contextualizes
> it or makes it more useful, or metadata that makes it more useful for this reader. I imagine there
> are a lot of ways to do this. I guess let's not try and make this be too complicated. Look for a
> way to do this simply first, at least for a v1, even if it isn't perfect.

**Ending: declined for now — someday maybe.** A design was written and Sol-reviewed: the seven
public artefacts written for nobody, and "for you" marks on the glossary as an owner-only layer. It
would have cost the owner the tailoring of their summaries and trajectory, so it went to Greg first,
and he chose to keep everything personalised:

> So I'm saying let's just optimise for the individual reader and add this somewhere as a 'someday
> maybe' set of improvements.
>
> — Greg, 2026-10-01

Nothing changed for readers. The make-public dialog still names the artefacts written for the
owner's profile. The design, his full answer, and the parked branch with the part that was built are
in [261001m](../plans/261001m-shared-mode-output-for-everyone-personalisation-as-an-addendum.md).
