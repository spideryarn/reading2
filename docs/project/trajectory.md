# Trajectory — skim a paper at increasing depth

A mode for going round a piece more than once, a little deeper each time: a handful of stops the
first time round, about a dozen the second, a larger share of the piece the third. The stops need
not come in the paper's order — the results first, say, and then a quick tour of the methods.

**Status (2026-09-28): being built**, behind the experimental switch — the plan is
[260928a](../plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md). This doc is the
vision; the plan is the build.

## What Greg asked for

Dictated on 2026-09-28 and lightly transcribed from speech, so it keeps the repeats and false starts
of talking — including one paragraph said twice. It is kept whole on purpose: this is the idea as he
had it, before anyone tidied it.

> Okay, this is a bit less well specified as an idea. I want to create a new mode. I don't know whether to call it spiral mode or trajectory mode. Let's go with trajectory mode for now.
>
> And the idea is that it would help me skim a paper efficiently at multiple levels of granularity. So the first time I run it, maybe it would only show me a few sections. I don't know, at most a handful. If I read those, it would give me a gist of the most important ideas.
>
> And then maybe I could dial it up to be like, okay, I want to go round again, but this time in a bit more detail. Show me more. And so it would perhaps take me through, I don't know, a dozen blocks. And then maybe there's a third level of granularity that takes me through a bigger proportion of the paper.
>
> And so I don't know what this would look like. Maybe it's a mode with sort of forward and back. buttons and a slider for granularity. It would maybe I can also use left and right to trigger the forward and backward buttons to jump to the next sections. Now importantly, I think it's okay for the trajectory mode to show me stuff that is not in the order it's presented in the paper.
>
> So it may be that you start with, I don't know, the conclusions. So you start with the results. And then a quick tour through the methods or something. I don't know, it might vary from paper to paper.
>
> I think that's the key idea. So in the ideal world, it would take into account the information that the user has provided in their profile. And then it might vary from paper to paper. I think that's the key idea.
>
> So in the ideal world, it would take into account the information that the user has provided in their profile. Profile and or in the metadata for the paper about their intentions and that that would guide what the trajectory should be if that's been provided. So if I've said, look, what I'm most interested in is understanding how this paper differs from, you know, some other paper or is new in the literature, then that might, you know, and I'm already an expert in this field, that might change the trajectory that you choose to display.
>
> It might also mean that you need to do some web searching, though that would complicate it. I know we have tools for doing that in the chat, so we could reuse those. Maybe that's a version two. I think it would be nice to reuse as much of the existing machinery as we have.
>
> So we've got the quotes and a bunch of metadata that effectively highlight bits of the paper. That would be an obvious place to start in terms of like those are presumably relevant and central and, you know, maybe it's a trajectory through quotes so that we don't have multiple metadata annotations of the paper that are all kind of similar.
>
> So let's try and have one reusable set of highlights that we think are most important. We also reuse the glossary and the summaries. And so actually, I think this is another thing that I dream of is that, you know, this might be eventually not just a way of jumping through sections, but also gathering extra metadata and snippets and stuff.
>
> And so we've got to see the results that we've generated that together create a kind of scrapbook, miscellaneous set of materials that really help the user to skim through the paper as effectively as possible in increasing depth. But again, maybe that's overcomplicating things for now. Anyway, so I'd like you to capture pretty much all of these thoughts verbatim somewhere in a vision document for the trajectory mode.
>
> And for now, use the engineering manager to proceed autonomously to build at least a version one and maybe even a version two if you feel confident delegating this to a new agent. I think gather all your questions in that document. But for now, just proceed autonomously and do your best job.
>
> I won't be able to answer any more questions for now.
>
> — Greg, 2026-09-28

## The core idea, as we read it

**One route through the piece, walked at three depths.** The first pass is the gist: about five
passages, chosen so that reading only those tells you what the piece found and why it matters. The
second pass walks the same route with more stops on it — about a dozen — and the third walks it
again with enough stops to cover a real share of the piece. You read the passages themselves, in the
article; the mode only chooses where to stand and in what order.

Three things follow from Greg's words and they shape everything below:

- **It is still reading.** A stop is a passage of the article, drawn in the prose where it sits,
  not a summary of it. That is [vision.md](vision.md)'s whole argument — augment the reading, do not
  replace it — and it is why the mode's own generated text is one short line per stop saying *why
  stop here*, never what the passage says.
- **The order is the mode's, not the paper's.** A paper is written in the order it was done;
  somebody skimming wants it in the order that makes sense fastest. So the route can start at the
  results and loop back to the methods, and it can differ from paper to paper.
- **Going round again keeps what you already read.** The second pass contains the first pass's
  stops, in the same order, with more between them; the third contains the second. That is what
  makes it a spiral rather than three unrelated lists — you never lose your place when you turn the
  depth up, because the stop you are on is still there.

**Who is reading changes the route.** When the reader has said who they are
([reader-profile.md](reader-profile.md) — *About you*) or why they are reading this piece (the
article's *Why you're reading this one*), the route is chosen for that: an expert reading to see
what is new goes to the contribution and the comparison with earlier work first, and skips the
textbook background. With neither, the default is a first-time reader who wants the main point
first.

**One set of highlights, not another.** Greg does not want a fourth near-identical annotation of the
piece beside Quotes, Ideas and the summaries. How that is honoured in v1, and the version we did not
build, is in the plan's *Reuse* section; the short answer is that the trajectory stores **only an
ordering over passages of the article** — block ids, a depth, and one short line each — and borrows
everything it shows from what is already there: the section names from the hierarchy, the quote
marks already drawn in the prose.

## Version one

- A **Trajectory** button in the mode bar, behind the experimental switch.
- Opening it for the first time makes one model call over the piece that chooses the stops and their
  order, written once and stored, like Ideas and FAQ.
- The band shows **Stop 3 of 5**, a **‹ ›** pair, and a three-step **depth** control (1 · 2 · 3,
  with the number of stops on each). Below, the stops of the current depth, each with the section it
  is in and its one line; the current one is highlighted, and pressing one goes to it.
- The current stop's passage is marked in the prose and the article scrolls to it.
- **← and →** step to the previous and next stop while Trajectory is open (↑ and ↓ stay the
  article's, [keyboard.md](keyboard.md)).
- The reader's profile and the article's *why you're reading this* shape the route when they exist.

## Version two, and later

Candidates, from Greg's own words:

1. **The scrapbook** — gathered beside each stop, what the app already knows about that passage: the
   quotes inside it, the glossary terms it introduces, the one-sentence gist of the section it sits
   in. No new model call; everything is already addressed by block id. This is the v2 we build if v1
   is solid, because it serves the core idea — skimming in increasing depth — with nothing but
   reuse.
2. **Where it sits in the literature** — a web search for how this paper differs from earlier work,
   reusing chat's web tools ([chat-tools.md](chat-tools.md)), feeding the route for a reader who has
   said that is what they want. Harder: it costs a search per paper, the results are not in the
   article, and [Debate](../plans/260905f-debate-mode-what-the-web-says-about-this-piece.md) already
   goes to the web for what others say about a piece — the two would want to share rather than
   duplicate.
3. **Quotes as the stops** — see the plan's *Reuse* section for why v1 does not do this, and what
   would change our mind.

## Questions for Greg

Each of these was decided by default so the work could go on. Every one is cheap to change.

*Filled in as the build goes; see the plan's Progress section for the order things happened.*

---

Up: [reading-view-overview.md](reading-view-overview.md)
