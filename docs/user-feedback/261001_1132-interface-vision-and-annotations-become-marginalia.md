---
reports: spya-yaxvgt
ending: shipped
---
# A three-column interface vision, and Annotations becomes Marginalia

Report spya-yaxvgt (Sentry SPIDERYARN-READING2-8E), from Greg (admin, verified by
`feedback-reporter.ts`, exit 0), 2026-10-01, sent from Tweets on
`jco-2005-01-libre-spya-hk9cc7`.

> Right now we have a lot of different modes. We have modes for glossary and ideas and timeline and
> FAQ, God knows what else. And they each have their own interface. Now, maybe that makes sense, but
> in practice, I suspect I'm probably not going to want to actually scroll through the glossary,
> say. What I want is for the glossary to be there when I need it because I'm reading a word that I
> don't understand and I see the little dashed line or dotted line underneath the word and I hover
> and that's great. So I can imagine a world in which, you know, maybe those modes with their special
> mode columns still exist, but they're kind of not emphasized in the user interface and that most
> users won't ever need to use them. So, in other words, we are moving towards a three-column vision
> where the left-hand column is—well, let's start with the right-hand column. Three-column vision
> where the middle column is the text, and maybe that's all you want to see. And we annotate it
> heavily, see decorated HTML for a whole bunch of ideas that almost certainly aren't right, but they
> give you a sense of how you might try and really put as much information in a progressively
> disclosing way into the annotating the text so that the text is all you need. That's one vision.
> I'm not sure if it's right. A sort of variant on it might be that the right-hand— Column annotates
> blocks, so it kind of provides scribbles in the margin. That's at the moment the annotations mode,
> and that that might include all kinds of stuff like, you know, indicating when the article is
> rebutting a previous point, or drawing conclusions, or perhaps just explaining really difficult
> paragraphs, explain well the text, or highlighting when the author has made a claim that actually
> other people in the literature dispute, so pulling from the debate mode. You can imagine all of
> those different annotations adding that. And then on the left-hand side, we have the stuff that's
> not anchored to the text. So the obvious thing would be the structure or table of contents, maybe
> also summaries, tweet threads, stuff like that, that, yeah, is not anchored to particular blocks,
> doesn't scroll with the text, in other words, whereas the right-hand column does scroll with the
> text. Can you write this up as a kind of interface vision.md file? It's not definitely what we're
> going to do, but it's one direction of travel to explore. And then potentially a lot of the recent
> feedback reports provide further ideas and intents, so you could draw on them. flesh it out. And
> then if there are questions you want to ask me, yeah, ask me, or ideas or suggestions or concerns
> or trade-offs, we can discuss them. And so that's why I've said that ideally we want to be able to
> see both the left and right-hand columns visible at the same time sometimes, if the screen is wide
> enough. And this would simplify the interface because then, you know, maybe there is a way to see
> the glossary mode column with all of just the glossary entries, but that's unlikely to be something
> someone will want to do. Instead, the user will have a left-hand column with stuff like Structure
> and Summary, and a right-hand column with occasional default-collapsed block-level marginalia, and
> a heavily marked-up/decorated text.
>
> Actually, let's rename Annotations mode to Marginalia mode right now, in that spirit.

**Shipped**, both halves.

- **The vision** is written up, labelled not decided:
  [interface-vision.md](../project/interface-vision.md). The first three questions are queued with
  the Overseer for Greg (2026-10-01) and are listed in its § Open questions.
- **The rename** is on `dev` (`4849b82f5`, with GPT Sol's review fixes after it): Annotations is Marginalia everywhere a reader sees it, the mode word is
  `marginalia`, `?margin=1` stays the address, and old `?mode=annotations` links still open the
  column. The plan and its reviews:
  [261001n](../plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md).
