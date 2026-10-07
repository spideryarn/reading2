# Diagram mode: the history moved out of the reference doc

Moved verbatim from [docs/project/diagram.md](../project/diagram.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

## There were eight, and five are gone

The five that went share one property: **each of them was a second way of
drawing something the reader could already get elsewhere.** Mindmap and Cluster
were both the containment tree with different geometry — which is the comparison
GPT Sol had already called for `tree` on the grounds that it was done and `tree`
had won. Arc drew the vocabulary edges that Force draws, on a line rather than
in a plane. And Tree, which outlasted them by three days, lost the same argument
to two things outside this mode: the outline panel and the gist columns (removed with Hierarchy mode on 2026-09-29), which
already showed the reader the contents page and do it better in a band this
narrow. Eight chips is also more than a 288px band can show without wrapping to
two rows, and a toggle you have to read twice is not a toggle you press.

## Why Force was the default, and why Sketch is now

### Force before the Sketch default on 2026-09-04

Force held the default until then, on the opposite argument:

**Nothing here is free any more.** The Tree was, and that was the whole of its
claim on the default slot: stage 4 had already written a gist onto every
internal node and the block ranges gave the sizes, so the band fetched nothing
at all until you pressed something else.

What is left is the next-best version of the same rule. So the reader who opens the mode still sees a picture
straight away; they just also, now, buy the dotted lines.

That is a real cost the old default did not have, and it is why the hover card
on each chip says where the picture comes from as well as what it shows. The
argument was right while Force was the picture everybody saw; it is not an
argument for keeping a default nobody can see.

## And then everything under the chips, 2026-08-30

**Sketch's scene row was a radiogroup with no arrow keys**, and its comment said
"one tab stop and arrows, like every other switcher here". The roving `tabIndex`
was there from the start and the handler was never written, so a keyboard reader
could reach the scene they were on and none of the others — a picture with more
parts and no way to get to them. It reads as deliberate *because* the roving
tabstop is there, which is the same mistake this panel made once with its tree
role.

## The chain fades outward from the reader, 2026-08-30

### Tests that claimed more than they proved

- **Two tests claimed more than they proved**, including one whose comment named
  a probe that would not have reddened. Both were corrected rather than deleted,
  and the reach rule gained a table of its boundary cases, because the test that
  was there would have passed with a constant reach of 4.

## Vocabulary

### The words that earned each vocabulary edge

An earlier version computed those words
and never showed them, which made the curves look more authoritative than they
are; GPT Sol's finding, and the most important one of the round.

### What a browser pass reported, and what was actually true

A Sonnet subagent checked the picture in Chrome on 2026-08-27 against a throwaway
preview page. Most of it confirmed the design — the arrowheads are visible and
all point down the page, the vermilion cross-reference reads as the brightest
line despite being the thinnest, the dotted line reads as dotted at 288px, and
nothing overlaps or clips at any of the three widths. Two findings were reported
as bugs and **neither was one**, which is worth recording because both were
reported with more confidence on the fourth telling than on the first.

**"Vocabulary links never render."** True of that page, and a property of the
fixture rather than of the code: `example/` is a 34-block extract with 10 drawn
sections, and it has **zero** vocabulary edges — too little distinct vocabulary
to clear `EDGE_FLOOR`. The real articles have 56, 11, 8 and 3. The agent's first
message hedged this correctly ("worth confirming whether that's just a fixture
gap") and its fourth called it a FAIL.

**"Hovering a bubble does not update the footer card."** It does.
[`tests/diagram-panel-hover.test.tsx`](../../tests/diagram-panel-hover.test.tsx)
mounts the real panel and hovers a real bubble, and the card moves off the
reading position onto the hovered node and shows the author's link text. The
same session reported the whole component crashing and unmounting, HMR refusing
to fast-refresh, and the preview growing toggle buttons mid-run — someone else
was editing the file underneath it, and the preview page was deleted while it
was still open.

## Interaction

### Node keyboard navigation

  (A tab stop per node was the first version. On a forty-section article that is
  forty presses of Tab to get past the panel, and a role describing a widget the
  code had not implemented. GPT Sol's finding, 2026-08-26.)

### Removed folding with the left and right arrow keys

⟨Sol⟩ caught the claim that
  ← and → still folded, which was written in the same change that made it false.

## The step bar, and the key that was firing twice

### The retained step target before 2026-10-05

Until that day the aim stood for a 600 ms timer (`CHAIN_MS`),
chosen in the first build because `glideTarget()` was thought to leave a gap after a smooth glide
too; it does not, and the timer could drop the aim with the glide still pending
([plan 261005h](261005h-three-robustness-bugs-unknown-wire-values-rootless-children-list-chain-timer.md)
§ Stage C).

#### The fallback was a bug factory, and it is gone

Worth keeping, because the bug is what argues for the design. While a picture
with no data was drawn as the Tree, the panel's SVG class and its per-node shape
branch had to come from *what was drawn* rather than from the chip that was lit.
They did not, and the result was Tree geometry wearing Drift's stylesheet: every
row erased by `.diag-drift .diag-box { fill: transparent }`, no dot, no chevron,
and labels at the browser's default size because no `.diag-drift .diag-label`
rule exists. Nothing threw, nothing logged, and the strip above it said the
right thing the whole time. GPT Sol, 2026-08-27 — and it had been live in the
previous round too, with `strata` where `tree` then was.

#### And then they sprang back, which was not the picture's fault at all

Greg, 2026-08-30:

> the up/down buttons … don't seem to work very reliably. I press them, something changes, and
> then sometimes it seems to revert back to the active node it was on.

Exactly right, and the cause was one line in a file this panel does not own. `?at=` holds a block id,
and the scroll spy that writes it is **section-granular**
([url-state.md § the unit is a section](../project/url-state.md#the-unit-is-a-section-not-a-position)) — it
compared what it had measured against *the value in the address*. That is
the same question only while every value in the address is a section — and a rung on Trail or Drift
is a **paragraph**. So a press put a paragraph there, the spy computed the enclosing section, found
the two different, and wrote the section's first block back over it when the queued position write
landed. The mark moved and reverted.

It looked like a scatter bug and mostly was one. On a normal three-deep tree Force's rungs and the
spy's sections are the same rows, so nothing sprang back there — but only by coincidence: Force is
capped at depth 2 and the spy uses `leafDepth - 1`, and on a *shallow* depth-2 tree Force's leaves
are paragraphs inside depth-1 sections and it springs back too. Two numbers that agree on the
common case and are not the same number. ⟨Sol⟩, correcting the first write-up of this.

The flicker is the half you can see. The half you can measure is worse: the address was now back at
the top of the section, so the *next* press computed its target from there and landed on the rung it
had just used. Four presses of ↓ in the reproduction land on the same row four times, and that is
what "don't work very reliably" was.

## Why the heading row and not the control row

The icon went on `.diag-opts` — the Sideways/Colour strip — first, on the
reasoning that a row already drawn costs nothing to add to. That was wrong, and
it is worth the paragraph because **two separate checks confirmed the absence of
the old wording rather than the truth of the new one**, and both passed.

The browser sweep that found it (2026-08-31) also shows why the checks missed it.
Drift was measured at its narrowest, where the chips already wrap and the icon
rides free; Trail at its widest, where there is only one chip group and
everything fits. The costly combination — Drift at the ideal width — was in
neither.

**Then measured, at last** — 2026-08-31, on a throwaway preview page since
deleted, 96 widths from 180px to 560px in 4px steps. The icon costs no height at any of them, in either
row: `.band-head` is 40.91px shown or hidden, at 288px and at 400px alike, and
`.diag-opts` is 53.77px at 288 and 29.78px at 400 either way — the difference
between those two being the chip groups wrapping on their own, which is what
tells you the icon has genuinely left that row. The heading stays on one line at
every width, and `scrollWidth === clientWidth` throughout, so the ellipsis never
engages: at the narrowest band it wants 57.77px and has 217.4px. The icon takes
24.99px of *width* from it and no height, and cannot raise the row because its
box is 16.19px against the h2's 22.32px line box. That last part is why the
arrangement is robust rather than lucky.

Worth stating which of the four this is: **the first whose claim survives a
sweep**, rather than holding at the widths somebody happened to look at. That is
the whole difference the thread was about.

Three routes to the same extra line, then, found one at a time by three
different people looking at the same claim. The claim is now a property of the
markup rather than a measurement that happened to hold, which is the difference
between fixing this and re-wording it —
[silent-success.md](../reusable/silent-success.md) applies to a *claim in a
comment* exactly as it applies to code. The test written to hold it down
demonstrated the point once more on its way in: it matched the word
`min-width: 0` in the rule's own explanatory comment, so deleting the
declaration left it green.

