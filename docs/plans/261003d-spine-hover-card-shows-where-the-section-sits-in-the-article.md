# The spine's hover card shows where the section sits in the article

Feedback `spya-d896sz` (SPIDERYARN-READING2-5C), Overseer queue item `qi-jcgdpz6d`. The rest of that
report shipped with [260929f](260929f-trajectory-snippets-in-place-sparkline-and-where-card.md);
this is the one part it deferred.

> Yeah, actually, it might be nice to have a reusable tooltip for the structure mode fish eye that
> actually would be useful when hovering over the spine to show, okay, this is where I am right now
> relative to the wider course hierarchy.
>
> — Greg, 2026-09-29

## Where things stand

- `whereRows` ([where.ts](../../src/web/where.ts)) and `WhereCard`
  ([WhereCard.tsx](../../src/web/WhereCard.tsx)) exist, and Skim's position marks use them.
  `whereRows` is already generic over the node shape and takes a **path of node ids**, which is
  what Sol's F1 on 260929f asked for: a band is a node, not a block.
- The spine's band card ([Spine.tsx § BandCard](../../src/web/Spine.tsx)) says, top to bottom: a
  crumb (*THE PART · 2 of 3*), the band's title, its gist, up to five sub-section labels, and a
  footer (*379 words · 3% in · you are here*).
- 260929f deferred the spine because of Sol's F2: the card has **no height cap and cannot scroll**,
  and Skim's limits (every top-level section up to eight, two neighbours either side) would add 15–25
  lines to it. So the spine needs a shorter version.

## What changes

The crumb line and the title line become **one short fisheye of the outline**, and the band's gist
and sub-sections open *inside it*, under the band's own row — the shape of Structure mode's
fisheye: the focus expanded, its context collapsed to one line each.

```
  … 2 more                                   ← top level, faint
  Phrenology Defined
  The Practical Case for Phrenology          ← the band's part, on the path
    Phrenology's Uses                        ← the band's siblings
  ▸ Physiology's Role in Health              ← the band: bold, where the title was
      Understanding physiological laws is…   ← its gist, as now
      • Human machinery requires…            ← its sub-sections, as now
      • Feeble vitality and bad food…
    Moral Reform
  Objections Answered
  … 4 more
  379 words · 3% in · you are here           ← the footer, unchanged
```

**The shorter version is a limit, not a second function.** `whereRows` gains an optional
`limits = { all, near }` argument, defaulting to today's `WHERE_ALL` / `WHERE_NEAR`, so Skim is
untouched. The spine passes `{ all: 3, near: 1 }`: a level of three or fewer is drawn whole,
otherwise one neighbour either side and a *"… n more"* line. The outline is at most two levels deep
(the rail's hit targets are L2s, or an L1 with no children), so it adds **at most ten one-line rows**,
and in exchange loses the crumb and title lines.

**One node-based adapter**, `whereForBand(outline, path)` in where.ts, over the spine's
`OutlineEntry` shape: the path is `[part id, band id]` for an L2 and `[band id]` for a childless
L1. Titles come from `nodeLabel` (the title, else the nav label, with its voice), the same as the
band's own label. It never asks for an L2's children, because the path stops at the band.

**`WhereCard` gains two optional props**, both defaulting to today's behaviour:

- `detail` — rendered directly under the `here` row, indented to its depth, and allowed to wrap.
  The spine passes the gist and the sub-section list there.
- `current` — whether the marked row is the reader's location. Skim's is (`aria-current=
  "location"`, as now). The spine's is not: the marked row is the band the pointer is on, and only
  `hereHitId` knows where the reader is (Sol F1 on 260929f). The spine's footer keeps saying *you are
  here*, and the button keeps its `aria-current`.

**What goes:** the crumb's *2 of 3*. The neighbours and the *"… n more"* lines say the same thing
by showing it. `BandParent` stays, because `bandLabel`'s fallback (*Section 2 of 4*) and `ariaFor`
still use it. The `§` mark after a kept heading goes too: the author's face already says whose words
the title is ([fonts.md](../project/fonts.md)).

**CSS:** the `.where-*` rules move from `skim.css` to `tooltip.css`, since two surfaces now share
them; the spine card's `.tip-crumb` and `.tip-title` rules go if nothing else uses them.

## Assumptions (product calls taken the simple way)

1. The marked row is the **hovered** band, not the reader's position. Marking both — the band and
   *you are here* elsewhere in the outline — is deferred.
2. `{ all: 3, near: 1 }` is a guess at "short". The browser check at a short window decides it.
3. Touch is unchanged: the first tap opens this same card, the second goes there.

## The simpler options passed over

- **Keep the card as it is and add the outline at the top or bottom.** Fewest changes, but it
  names the band twice and the part twice, on a card Greg already finds dense.
- **Only the top level, no siblings.** Shorter still, but the crumb's *2 of 3* was the one thing
  the card had for "where in the part", and this would lose it without replacing it.
- **Skim's limits on the spine.** Sol's F2: too tall for a card that cannot scroll.

## Stages

1. This plan; GPT Sol plan review (read-only).
2. Build, tests first: `whereRows`' limits and `whereForBand` in `tests/where.test.ts`; the card's
   new shape in `tests/spine-card.test.tsx` (the crumb tests become outline tests). Gates, a browser
   check at 1280 wide and at a short window (Sonnet), GPT Sol code review with fixes. Docs:
   tooltips.md / granularity-zoom.md's spine section, wherever the card's contents are described.
   Feedback note, push to `dev`.

## Deferred

- Marking the reader's own section in the outline when it is not the hovered band.

## Progress

- 2026-10-03 — plan written.
- GPT Sol plan review ([prompt](261003d-spine-where-card-plan-review-prompt.md),
  [answer](261003d-spine-where-card-plan-review-sol.md)): *approve with changes*, all four taken,
  and they supersede the text above where the two disagree:
  **1 (P1) a budget, not a guess.** Ten outline rows plus gist, kids, footer and tap hint is ~19
  lines, too tall for a 400px window. So the spine's outline is **at most three rows a level**
  (previous, this, next), with no *"… n more"* rows: a trimmed level says *"3 of 8"* on its
  on-path row instead (`elided: "count"` in the limits; Skim keeps `"rows"`). The gist is clamped to
  three lines. The kids cap stays at five. Acceptance: the band's row, the footer and the tap hint all
  visible in a 400px-tall window.
  **2 (P1) `whereForBand(outline, bandId)`**: it finds the path itself, and an untitled child is
  *Section n of m*, from one shared label function that `bandLabel` also uses, not a second copy.
  **3 (P2)** the detail is its own `<li class="where-detail">` after the `here` row, so it can wrap.
  **4 (P2)** no `aria-current` on the card in either use: Skim draws a card for every row, not only
  the current one, so its mark was never "the reader's location" either.
- 2026-10-03 — built. `whereRows` takes `WhereLimits`; `SPINE_LIMITS`, `spineLabel` (shared with
  `bandLabel`) and `whereForBand` in where.ts; `WhereCard` takes `detail` and draws `of`;
  `BandCard` draws the outline, memoised per outline in `Spine` (`whereByBand`); `BandParent` lost
  its `voice`; the crumb and `§` CSS went, the `.where-*` rules moved to tooltip.css. The Help
  page's spine paragraph and granularity-zoom.md's spine section describe the new card. Tests first:
  where.test.ts and spine-card.test.tsx red before the code, green after; skim-panel.test.tsx's
  `aria-current` assertion became the opposite.
- Browser check (Sonnet, Playwright, `entropy-24-00930-spya-pywwkq`, 27 bands): every card bounded
  to three rows a level, marked row, gist under it, nothing clipped. At 1280×400 the card was 277px
  with a mouse and 302px with the touch hint, all on screen. Skim's where-card unchanged (*… n
  more* rows, no counts). Shots: [1280, mid](261003d-shot-1280-mid.png),
  [400 tall, touch](261003d-shot-400-touch.png), [Skim](261003d-shot-skim.png). Seen, not changed:
  a band's first sub-section bullet is often its part's heading (the first paragraph's nav label
  is the heading it starts at), so it repeats a row of the outline two lines up. That predates this
  change; the kids list is untouched.
- GPT Sol code review ([prompt](261003d-spine-where-card-code-review-prompt.md),
  [answer](261003d-spine-where-card-code-review-sol.md)): *approve after fixes*, six P2s, all fixed
  by the reviewer and read here: a long title no longer ellipsizes the count; the spine gist's
  margin no longer lost to `:first-child`; the voice and untitled-band tests tightened, with a
  top-level untitled case; Help says "a short gist"; the level-bounds helper extracted (lint
  complexity). Focused tests, typecheck and lint green after.
