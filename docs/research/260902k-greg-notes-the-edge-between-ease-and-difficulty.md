# Greg's notes: the edge between ease and difficulty

Dictated notes Greg made in an earlier session and handed over on 2026-09-03, while the website
copy was being written, with: *"please store/excerpt them and/or update existing docs and
incorporate if helpful."* Stored here in full because the phrasing carries the intent, and
excerpted into [positioning.md](../project/positioning.md), the
[interview guide](260902k-spideryarn-reading-interview-guide.md) and, subject to approval,
[vision.md](../project/vision.md).

They answer the question the brief left open: **what is the principle that holds the line between
augmenting and automating?** His answer, in one sentence from the notes: *"what will help the human
to best form their own rich updated internal representations?"* And the shape of the product that
follows: a model of what the reader knows and struggles with, built as far as possible from what
they do rather than what they are asked, and a set of modes that stop being six panels and become
one tutor.

## The notes, verbatim

> So, we're trying to break new ground here. Frontier models that are smarter than humans didn't
> exist 1 year ago, but they pretty much do exist now. And so the question is, how can we augment a
> human intellectual, a scientist or policymaker? How can we, well, I mean, perhaps in the future we
> just defer all the stuff to the AIs, but I don't think we're there yet. And so in that interim
> period, the question is, how can we best enable a human to learn, think, remember, decide,
> critique, all the verbs that you can think of that relate to, you know, reading and thinking.
>
> Anyway, so I guess the brief is to try and search the web for articles that can shed some light on
> what sort of UI and affordances and approach and support we should provide that strikes this
> balance between sort of replacing and automating on 1 end of the spectrum and the other end, which
> I guess is something like augmented. And it's always going to be tempting to move towards
> automation. And that's always going to be easier for the human, easier indeed for the product
> designer, and tempting. I guess we want to hold some kind of line. I don't know if there's a
> principle that we can define.
>
> The best one I have in my mind is: what will help the human to best form their own rich updated
> internal representations? Because I think that's the goal here. At some level, we're trying to
> make sure that the human understands and changes and learns and grows and makes decisions and,
> see, you know, has intuitions and sees analogies and has insights and ideas, and we want to
> support that. But, you know, I've heard the analogy being that, um, you know, you can, um, go to
> the gym or you can buy a forklift truck to lift the weights. But if you buy the forklift truck
> that lifts the weights, then you atrophy.
>
> So, you know, by analogy, what is it that we're asking of the user? What are we providing to them
> that will help them grow and build and exercise and strengthen them? And I think they have to do
> the work; that's the reality. If you do too much of the work for them, they don't learn or
> internalize or change. And if I had 1 guiding hunch, it's that we want to be at a kind of edge
> between ease and difficulty where things are difficult enough that they have to work, but not so
> difficult that they give up or fail. Put another way, maybe it's the same as being in a state of
> flow where things are challenging enough to be interesting, but not too challenging that they're
> feasible. And it relates to my PhD work on where it doesn't matter.
>
> But I think our goal is to make things easier where we can, but not too easy. And I suppose
> perhaps that requires input from the user about where they are. Or better still, if we can
> passively, implicitly sort of estimate or build a model of where they are and what they know,
> then we can update the UI based on what they're struggling with. And so our goal should be to
> gather information from the user that will help us update that model. We ask them in a crude way
> in a text box in the profile, and in their user profile and the article profile, so, you know,
> "Who are you? What are you trying to get from this article? What's your background?"
>
> I suppose we could use the time they spend on different paragraphs as an indication, or what they
> comment on, or what they select. But all those require active clicks, I guess. Or some of those
> do, anyway. We could look at what they read in the glossary; that would be a great example of the
> kind of thing that provides us information about what they don't already know. So that would be,
> ah, it's interesting, that would be 1 of those things where, A, the glossary needs to be visible
> at all times so that they can click on it. Obviously, then we need to log what they click on and
> blah blah blah. But the glossary would be an example of something where we choose to proactively
> provide it, ubiquitously, because the user's interactions with it provide us with really valuable
> information. And then low friction, low cognitive overload, low effort from the user.
>
> Perhaps we could look for other modes that provide information and also gather, help us update
> our model of what the user knows and what they're struggling with. Maybe they're not modes, maybe
> they're UI models. Maybe there's a question mark on each paragraph. For example, the bassist
> says, "Hey, I'm struggling here." And that would be a really useful signal to us. So in other
> words, we're trying to assert that there's a boundary between what they already know, and it's
> therefore sort of boring and easy, and not helpful in adding to their knowledge, and what they
> don't know, and might be what they might be struggling with or is tricky or they need help with.
>
> And we're constantly trying to build a model of that. And we're constantly... and I mean, we could
> build a base model that just indicates which paragraphs are hard and which are easy, knowing
> nothing about them. Actually, that could be really useful. So there could be a mode for just
> challenging this or something. Maybe not a mode, maybe a data structure. And then we'd use that to
> inform a whole bunch of other stuff, and we'd update it based on what we know about them.
>
> So ideally, as much happens as possible just proactively in the background without them having to
> make much effort. So as they're scrolling through the text, maybe we develop this notion of a
> glossary to more of a Virgil and a system, a tutor, that as they're going along says, "Ah, I had a
> feeling you might struggle with this. Here's something that may not be obvious, or that the
> argument misses out, or that you might not have the background for," or whatever. So the ideas,
> data structure, already kind of touched on this, but in a crude way. And ultimately, what we're
> trying to do is sort of bind all this stuff together so they aren't six modes, that they are a
> sort of rich augmented interface for reading a text that dynamically combines across these modes
> or something like that.
>
> — Greg, dictated before 2026-09-03

("the bassist says" is the dictation's rendering of something like "the reader says"; left as
dictated.)

## What is in here, pulled apart

Each of these is a thing a doc or a feature could own. None is decided by this file.

1. **The principle.** *What will help the human best form their own rich updated internal
   representations?* This is the sentence [open-questions.md § Q6](../project/open-questions.md#q6)
   was missing: it is both the tiebreak and the thing a success measure would have to measure.
   Candidate home: [vision.md § Intent](../project/vision.md#intent).
2. **The forklift.** The gym versus the forklift truck: *"if you buy the forklift truck that lifts
   the weights, then you atrophy."* The 2025 vision doc's atrophy risk, now with its image. The
   strongest line the site does not yet use.
3. **The edge.** *"difficult enough that they have to work, but not so difficult that they give up
   or fail"* — flow, and his PhD. Makes "make things easier where we can, but not too easy" a
   design rule with a direction: **easier on the parts that are not the point.** Matches
   [vision.md § Principles 3](../project/vision.md#principles), effort in the right places.
4. **A model of the reader.** Where they are and what they know, built passively where possible.
   Today's crude version is the two text boxes of
   [reader-profile.md](../project/reader-profile.md). The signals he lists: time on a paragraph,
   what they comment on or select, **what they open in the glossary** — the one he singles out,
   because it is low-effort for the reader and tells us exactly what they did not know.
5. **The glossary as instrument.** Ubiquitous and always visible *because* its use is information.
   Already true of the underlines ([glossary.md](../project/glossary.md)); the logging is not built.
6. **A "?" on each paragraph.** The reader says "I'm struggling here". This is the **confusion
   signal** already listed in [vision.md § Where this goes](../project/vision.md#where-this-goes-after-granularity-zoom)
   — *"the highest-value input we can get"* — with the reason it is high-value now written down.
7. **A difficulty map before knowing anything about the reader.** Which paragraphs are hard, as a
   data structure rather than a mode, that other modes read from. Not built. The original app had a
   document-level difficulty badge, deliberately not borrowed
   ([original-version/borrow-list.md](../project/original-version/borrow-list.md)); this is the
   per-paragraph version with a consumer, which is a different thing.
8. **Virgil.** The glossary grows into a tutor that says, as you scroll, *"I had a feeling you might
   struggle with this."* Proactive, in the background, low effort.
9. **Not six modes.** The end state is *"a rich augmented interface for reading a text that
   dynamically combines across these modes"*. Worth holding against
   [reading-view-overview.md](../project/reading-view-overview.md)'s "band the modes take turns
   in", which is the current shape and is the simpler-first version of this.

---

Up: [positioning.md](../project/positioning.md)
