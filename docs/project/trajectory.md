# Trajectory — skim a paper at increasing depth

A mode for going round a piece more than once, a little deeper each time: a handful of stops the
first time round, about a dozen the second, a larger share of the piece the third. The stops need
not come in the paper's order — the results first, say, and then a quick tour of the methods.

**Status (2026-09-28): being built**, behind the experimental switch — the plan is
[260928a](../plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md). This doc is the
vision; the plan is the build.

## What shipped

v1, behind the experimental switch and for the article's owner only
([experimental-features.md](experimental-features.md)):

- **The step**, `trajectory` ([`src/trajectory.ts`](../../src/trajectory.ts)): one small model call
  over the stored Quotes — their words, section paths and priorities, never the rest of the prose —
  that orders them into a route and gives each a depth and a short role line. It refuses without
  Quotes; the band asks for both in one job when there are none.
- **The band** ([`TrajectoryPanel.tsx`](../../src/web/TrajectoryPanel.tsx),
  [`modes/trajectory/TrajectoryMode.tsx`](../../src/web/modes/trajectory/TrajectoryMode.tsx)): a
  pinned head with `‹ Stop k of N ›` and **Gist · More · Most** (only the depths that add stops),
  then the stops with their section paths, the role shown on the current row only, and a shallower
  pass's stops dimmed.
- **In the prose**: the current stop's quote is ringed and barred, scrolled near the top on every
  step, and followed by a **Next stop ›** door — *Go round again — More ›* at the end of a pass.
  On a narrow window the band steps aside once a stop is chosen, and the door carries the walk.
- **Keys and address**: ← / → step the stops while the mode is open
  ([keyboard.md](keyboard.md) § ← / → in Trajectory); `?depth=` pushes and `?stop=`
  replaces ([url-state.md](url-state.md)). The rules for where a step or a depth change lands are
  one pure module, [`trajectory-route.ts`](../../src/web/trajectory-route.ts).

v2, the scrapbook, is the next stage of the plan.

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
  replace it — and it is why the mode's own generated text is one short line per stop naming *what
  the passage does* ("the headline result", "how they measured it"), never what it found.
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
piece beside Quotes, Ideas and the summaries — *"maybe it's a trajectory through quotes"*. So it is
one: **the stops are the article's Quotes**, the lines Quotes mode already chose, checked and marked in
the prose. What Trajectory adds is only an **order** and a **depth** for each quote, and a short role
line. If a piece has no Quotes yet, opening Trajectory makes them first. The design that was
considered and dropped — a fresh selection of passages from the whole article — and why, are in the
plan's *The versions not built*.

The cost of that choice is **coverage**: the route can only stop where Quotes stopped, and a methods
paragraph is rarely quotable. When that shows, the fix is to Quotes, so that the one shared set gets
better for every mode that reads it.

## Version one

- A **Trajectory** button in the mode bar, behind the experimental switch.
- Opening it for the first time makes one small model call that puts the article's Quotes in a route
  and gives each a depth, written once and stored. If there are no Quotes yet, they are made first.
- The band shows **Stop 3 of 5**, a **‹ ›** pair, and a three-step depth control, **Gist · More ·
  Most**, with the number of stops on each. Below it are the stops of the current depth, each with
  the section it is in; the current one also shows its role line, stops from an earlier pass are
  dimmed, and pressing one goes to it.
- The current stop's passage is marked in the prose and scrolled to near the top, with a **Next
  stop ›** door after it — on an iPad your thumb is in the prose, not the band. At the end of a pass
  the door offers to go round again, one depth deeper.
- **← and →** step to the previous and next stop while Trajectory is open (↑ and ↓ stay the
  article's, [keyboard.md](keyboard.md)).
- The reader's profile and the article's *why you're reading this* shape the route when they exist.

## Version two: the scrapbook

> Re Trajectory:
> - Yes, Experimental only for now
> - And for v2, I'd say the scrapbook (that can draw on useful stuff from any other modes that you
>   think might be useful if they've already run) is more important than the web search. I'd also
>   encourage the agent to experiment with new UI or short generated snippets that might help tie
>   together the disparate elements. This scrapbook aspect is the thing I'm most excited to
>   experiment with.
>
> — Greg, 2026-09-28, answering two questions from this build

**The scrapbook is v2, and it is a real stage, not a maybe.** Beside each stop, gathered from
whatever the other modes have *already* produced for this article — quotes inside the passage, the
glossary terms it uses, the ideas it bears on, the gist of the section it sits in, timeline events,
citations, FAQ questions it answers, and so on. It does not start new runs of those modes by
default; it shows what is there. Everything in it is already addressed by block id, so gathering it
is a lookup.

Greg asks for experiment here: new UI, and **short generated snippets that tie the disparate pieces
together**. So v2 tries more than one shape and picks with evidence; what was tried, and what was
chosen, is written below when it lands.

## Decided

- **Behind the experimental switch, for now** — Greg, 2026-09-28, above.
- **v2 is the scrapbook, not web search** — Greg, 2026-09-28, above.

## Later

1. **Where it sits in the literature** — a web search for how this paper differs from earlier work,
   reusing chat's web tools ([chat-tools.md](chat-tools.md)), feeding the route for a reader who has
   said that is what they want. It costs a search per paper, the results are not in the article,
   and [Debate](../plans/260905f-debate-mode-what-the-web-says-about-this-piece.md) already goes to
   the web for what others say about a piece — the two would want to share rather than duplicate.
   Until then, a reader whose stated purpose is "how is this different from X" gets a route that
   leans on what the paper itself says about earlier work, and no more.
2. **Quotes as the stops** — see the plan's *Reuse* section for why v1 does not do this, and what
   would change our mind.

## Questions for Greg

Each of these was decided by default so the work could go on. Every one is cheap to change. More
are added as the build goes; the plan's Progress section has the order things happened in.

### 1. Should the stops be the Quotes, or a fresh choice of passages?

**Background.** A stop has to be *some* passage of the article. There were two ways to get them. The
first is to reuse the lines Quotes mode already picks — its "lines worth keeping", each checked
against the article and already marked in the prose. The second is a new model pass over the whole
article that picks its own passages for the route.

- **Quotes (built).** One set of highlights shared by both modes, as you asked. Trajectory only adds
  an order, a depth and a short role line, so its model call is small and cheap. The cost is
  coverage: the route can only stop where Quotes stopped, and a plain methods paragraph with nothing
  quotable in it cannot be a stop. A piece with no Quotes gets them made first, which is Quotes'
  usual cost plus a few seconds.
- **A fresh choice.** It could stop anywhere, including that methods paragraph. But it is a second,
  near-identical set of highlights beside Quotes, and it needs a call over the whole article.

**How to choose.** Use it on a few papers. If the route keeps skipping parts you wanted to see, say
so. The first fix to try is to make Quotes cover every major section, which improves both modes.
Only if that fails would a second set be worth it.

### 2. Is the role line helping, or is it a summary by the back door?

**Background.** Each stop gets one generated line, at most 80 characters. It names what the passage
*does* — "The headline result", "How they measured it", "What earlier work missed". It never says
what the passage found. It is shown in full only on the current stop, so the list never turns into
thirty lines you could read instead of the paper.

**Options.** Keep it as it is; drop it, and show only the section name; or show it on every row.
**Default taken:** keep it, current row only.

### 3. Three buttons, not a slider

You said "maybe … a slider". There are exactly three depths, so the control is three buttons —
**Gist · More · Most** — each showing how many stops it has. Three buttons are easier to hit on an
iPad than a slider's thumb, and they do the same job. If you want an actual slider, it is a small
change.

### 4. The route appears all at once, not streamed

The house rule is to stream anything a reader waits on. The ordering call is small (seconds), and
the route is only usable once it has been checked as a whole: half a route would be reordered under
you as the rest arrived. So the job shows its progress and the route appears complete. When Quotes
have to be made first, that wait is Quotes', and Quotes stream. Streaming stops one at a time is
possible later if the wait turns out to matter.

### 5. A route built before you wrote a profile goes out of date once you have one

Elsewhere in the app, an artefact made before you had a profile is left alone when you add one. A
route is the thing a profile most obviously should change, and it is cheap to rebuild (about two
cents), so Trajectory marks a route as out of date when the profile changes in either direction —
including "none → a profile" — and the band offers a rebuild. It does not rebuild by itself. Say if
either half surprises you.

### 6. Should Quotes be made to cover every part of the paper?

**Background.** Because the stops are the Quotes, the route can only go where Quotes went. On the
three test articles, the deepest pass (Most) covered 19–32% of a paper's words, not the "bigger
proportion" you described. One paper's biggest section, nearly half its words, had only four quotes,
and another had a whole section with none. Quotes picks lines worth *keeping*; a plain methods
paragraph rarely is one.

**Options.**

- **Leave Quotes alone** (default taken). Trajectory v1 goes where Quotes go, and Most is a partial
  tour.
- **Ask Quotes to cover every major section** — one sentence in its prompt. Both modes change: the
  Quotes list gets longer and more even, and some quotes will be less striking.
- **Let Trajectory add its own stops** where Quotes left a gap — back towards a second set of
  highlights, which is what you asked us to avoid.

**How to choose.** Try Most on a paper you know. If it skips the part you would have wanted, the
second option is the one to try, and it is a small change.

---

Up: [reading-view-overview.md](reading-view-overview.md)
