# "Back to X" vanished whenever you looked at where it had taken you

**[SPIDERYARN-READING2-41](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-41)** · reported
2026-09-12 12:27 UTC · kind: suggestion · from an admin (Greg) · *shipped*

This is the **second** of the two things in report 41. The first — an indicator of where you have
spent time reading, in the spine and the gutter — is its own queue entry and its own session, and
nothing here touches it.

Build `d358f773`, article `temporal-context-reinstatement-spya-dhqkf9`.

## What the reader said

> One of the ways it would help is just seeing how far through the article I've read because I'm
> still having issues where, you know, if I switch from portrait to landscape or if I click on
> things, it takes me to other bits of the article and I sort of lose my place.
>
> And we have a kind of back to X thing. But I don't know if I always, I mean, perhaps we can also
> separately look into whether that's always showing up. So ideally we want things across modes to
> use reusable machinery so that if we build something like that back to X when you click on an
> entry in a mode, that should be true across citations and quotes and ideas and search and
> everything else that has that similar kind of ability to jump us around the article.
>
> So then the back to would work robustly and universally.

## What we found

**The reusable machinery you asked for is already there.** Every mode already sends the reader
through one and the same piece of code when it jumps them somewhere — citations, quotes, ideas,
glossary, search, the timeline, the spine, chat's citation chips, and the article's own internal
links all go through it. There was nothing cross-mode to build. So the question became the other one
you asked: *why doesn't it always show up?*

Two reasons, and neither was about any particular mode.

**1. Looking at where the jump took you destroyed the way back.** The little chip lived on the one
history entry the jump created, and *any* later step — changing mode, toggling a gist column,
changing a sort order — threw it away. That was deliberate once, and it made sense while the chip
could only ever go back one step. But on a phone the mode panel **covers** the whole article, so
after you tap a citation you cannot see where you landed until you press Plain — and pressing Plain
was exactly the step that destroyed the chip. It was being taken away at the precise moment you
needed it.

**2. Turning the phone lost your place, and the app wrote the loss down.** A rotation keeps your
scroll position in pixels while the text re-flows to a new width, so the pixel you were looking at is
now a different paragraph. Nothing put you back — and worse, the part of the app that notices a
re-flow responded by recording where the re-flow had left you, overwriting the only record of where
you had been.

## What we did

**Shipped on `dev`.**

**The way back now lives until you leave the article.** It survives changing mode, changing columns,
changing a sort — anything that is still this article — and one press takes you home however many of
those you did in between. It still goes away when you press the ×, and it still goes away when you
open a different article. Repeated presses walk back through several jumps in the order you made
them, which is the "history list" idea you floated, without a list.

**Turning the phone now keeps your place.** On any change of layout the app puts you back at the
section the address says you were in, rather than letting the re-flow decide. The same applies to
turning a gist column on or off, which used to walk you down the article a little each time.

## What we did not build

**The history list behind a button in the bottom bar** — your own larger idea. It is named in the
plan and deliberately left: the browser will not let JavaScript read its own history stack, so a list
means keeping a second stack of our own, with rules about what to remember and for how long. That is
the parallel history the earlier plan decided against. Pressing the chip repeatedly already walks the
chain. Worth revisiting if you find yourself wanting to *see* where it will take you before pressing.

**The reading-heat indicator** — the first half of this report, and a separate piece of work.

[The plan](../plans/260916a-back-to-where-you-were-survives-a-mode-change.md), and
[GPT Sol's review of it](../plans/260916a-plan-review-sol.md), which changed three things about the
design before any of it was written.
