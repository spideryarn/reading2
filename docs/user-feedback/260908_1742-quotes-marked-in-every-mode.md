# Quotes marked in every mode

**[SPIDERYARN-READING2-2P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2P)** · reported
2026-09-08 17:42 UTC · *shipped, and half of it already existed*

## What Greg said

> Always show the quotes (highlighted with a border around them), if there are any that have been
> generated. Always show them in the text view, even if we're not in quotes mode.

Reading `temporal-context-reinstatement-spya-dhqkf9`, at `spya-vrjcg4`.

## The border already existed; "always" did not

Two of the three clauses had shipped in the previous eight days, and checking that before building
anything is most of what made this small.

- **The border** is [260907c](../plans/260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md),
  the day before — Greg's own third option over his earlier "yellow highlighter pen", with stroke
  weight carrying priority. *Search fills, quotes outline.*
- **"the quotes", plural, rather than the selected one** is
  [report 1Z](260905_1754-quotes-marked-in-the-prose.md).
- **"even if we're not in quotes mode" is the new part**, and it is one sentence that turned out to
  be an architectural change rather than a flag.

## What it took, and what it did not

The marks were **published** by the band, through `usePassageLifecycle`, so they lived exactly as
long as quotes mode was on screen. Everything they are made of — the artefact, `?quote=`, `?rank=`,
`?bar=`, the blocks — is state `Reader` already holds, so there was nothing for the band to tell it.
`useQuoteMarks` computes them instead, and the publication protocol went with them: two `useState`s,
two setters, and the `derived` arm of the shared lifecycle, whose only caller this was.

The opening fetch split in two the way the glossary's did in 2026-08-27, and for the identical
reason — *"always underlined… even outside Glossary mode"*, Greg, 2026-08-26. That precedent is what
stopped the first draft of the plan, which hoisted the whole hook and would have put the job engine
on its idle cadence for every reader of every article.

**Not built:** any switch to turn the marks off. See below.

[260908i](../plans/260908i-quotes-marked-in-the-prose-in-every-mode.md) has the design, the option
passed over, and the cross-family review that changed it twice.

## Two things the review found that the request did not mention

Both are consequences of the feature rather than opinions about it, so both were fixed or recorded
here rather than left for Greg.

- **A quote had become a dead zone for the tap that selects a paragraph.**
  `NOT_A_BLOCK_SELECTION` excludes every `<mark>`, because a tap on one always means something else
  — except a quote, which nothing acts on. With up to 32 of them on the page in Plain, the best
  sentences in the piece would have been the only ones a finger could not select, and selecting is
  how a finger reaches the gutter and therefore how a reader annotates. Fixed: the exclusion now
  says *a quote and nothing else*. The plan had recorded "nothing clicks a quote mark" as a reason
  there was nothing to worry about — true, and the wrong conclusion.
- **Two known rendering defects stopped being unreachable.** 260907c recorded a 2px step where a
  search hit crosses a quote (the wash's `padding-bottom` makes that fragment taller) and a
  Chrome-only observation about `box-decoration-break`, both dismissed as *"not reachable in the
  reading view — one mode's marks at a time"*. This change is what makes them reachable. Not fixed:
  260907c weighed the two cheap fixes and found each worse than the defect, and inventing a third
  from geometry rather than measurement is what that page refused to do. The stale "not reachable"
  caveats on `/design`, in `annotations.css` and in 260907c now say so.

## The one thing left for Greg, and it is about density

**There is no off-switch, deliberately** — "always show" is the request, and a checkbox nobody asked
for would weaken it. But the default `?rank=` is `document`, where `rankQuotes` returns the *whole*
list and the `?bar=` slider does nothing at all. So a reader who has never touched the controls meets
**every** quote — up to `MAX_QUOTES` = 32 — outlined in Plain, and the only way to turn them down is
to open quotes mode, choose Prioritised and raise the bar.

That is a real awkwardness and it is a product call rather than a bug. If it wants relief, the
smallest honest version is to make the existing rank/bar control reachable from the text view, not to
invent a second independent visibility setting.

## Evidence

`tests/quotes-marked-in-every-mode.test.ts` (new) states the contract in both directions, and **the
negative half is the half that earns its keep**: the quotes reach the phrase marks in every mode and
the paragraph bar, the spine rail and the ring in none. An implementation that merged once upstream
of all four passes every assertion about `data-quote` and silently repaints the article's paragraph
bars at full confidence. Seven of its nine cases were verified red against the pre-change
`proseFound`.

`tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx` mounts the whole app at a real
address and now carries the new contract in its `agree()` helper. The assertion added last is the
sharpest: the second article has no quotes, so a mark there would be *the first article's quote drawn
on a piece that does not contain it* — which is what a marks layer outliving the **article** rather
than the **mode** would do, and the whole risk of having moved them.

The touch fix and the visitor's marks were each mutation-checked — the blanket `"mark"` exclusion and
an owner-only quotes read, put back one at a time, each turned exactly one new test red.
