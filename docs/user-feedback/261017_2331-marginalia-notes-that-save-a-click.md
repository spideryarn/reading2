---
reports: spya-w99qsz
ending: shipped
comment: Shipped: the margin says where a quote or allusion comes from (marked AI memory, unchecked), and a cited work opens to what its abstract says. Queued: does it say what they claim, Explanations, Sources widened, debate in the margin.
---
# Marginalia: notes that save a click

`spya-w99qsz` (#596, suggestion, Sentry SPIDERYARN-READING2-JJ), from Greg (admin;
`feedback-reporter.ts` on the production row, no addenda). Filed 2026-10-17 23:31 UTC, build
`614e42c5`, on `rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`. Queue item
`qi-djrqnhdm`. This session ran on a pool account with no Sentry sign-in and did not write the
Sentry status; the next sweep does.

> Probably the most useful thing is to situate the article in the outside world, in references that
> it makes and references made to it. I'm thinking especially of the annotations mode, because as
> I'm reading this, most often I want to know a bit more about the quotes or the citations or the
> allusions or whatever, and indeed a bit about what people think of the claims being made. I'm not
> sure how this should be instantiated, but I guess in some ways maybe it's the sources mode or
> something should feed into the annotations mode. And I guess what I'm trying to get at is the
> annotations should be the useful stuff, the stuff that saves the user a click, the things that
> they would have looked up. So it could be a combination of, you know, oh, where does that come
> from, or why did they choose that quote, or what's that citation say, and does it really say what
> they say it says? And then also, this is confusing and I want to understand this more, or
> whatever. Those are the two primary things I think I want the annotations mode to do. And
> actually it strikes me for a while that the glossary could be not just individual words, could be
> phrases or ideas. Maybe that's a thing to come back to. But let's start with just enhancing the
> annotations mode with stuff that the user might find useful, and you figure out how to represent
> it or how to fit it in with the modes we have. So maybe we need a separate explanations mode, kind
> of like the glossary. And then the annotations mode could draw on explanations mode. And we could
> broaden sources to include not just, like, explicit citations, but quotes or mentions or
> allusions or whatever.

**Ending: shipped** on `dev`, simplest version first. Plan
[261018i](../plans/261018i-marginalia-notes-that-save-a-click.md), which has the measurement and
both GPT Sol reviews.

- **"What's that citation say."** The margin's *Cites* line, opened, now shows the short checked
  note written from the cited work's abstract, the same one Sources shows, with *From the abstract*.
- **"Where does that come from."** Marginalia's existing call may now add up to two to four
  *Origin* notes. Each sits beside a passage that quotes, alludes to or names something the piece
  leaves bare, and says where it comes from. They come from the model's memory, so each says *AI
  memory, unchecked* on the note, keeping 261018h's article / memory / web distinction. Measured on
  six articles: no wrong attribution in 35 notes, and a blind judge found 10 of the 14 shipped notes
  useful and none harmful.
- **"This is confusing"** is what Marginalia's existing *Note* kind does; it is unchanged.
- **"Why did they choose that quote"**: not built, on purpose. Origin notes never say why the
  author chose something, because that is a guess at the author's intent presented as fact. The
  plan has this decision.

Queued, as proposals (plan § What is deferred):

- `qi-am9ern9p`: does the citation say what the article claims (the citing sentence checked
  against the abstract).
- `qi-y8s68xd9`: an Explanations mode, a glossary of phrases and ideas. This needs you: a new
  mode, or Glossary widened?
- `qi-3mmccm5n`: Sources broadened to quotes, mentions and allusions.
- `qi-k3a48hvn`: what people think of the claims, in the margin.
- `qi-b6gnkcya`: origin notes checked against the web.
