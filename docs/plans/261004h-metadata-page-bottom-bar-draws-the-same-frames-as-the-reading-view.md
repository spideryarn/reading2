# 261004h: the Metadata page's bottom bar draws the same frames as the reading view

Report `spya-qerga4` (Sentry SPIDERYARN-READING2-CK), Greg, a suggestion, filed from
`/read/bitterlesson-spya-pbag4p`:

> Why does the bottom bar look different in metadata mode?
>
> — Greg, 2026-10-04

Overseer queue item `qi-dz2dajn4`. The bar is being decluttered elsewhere
(`fbtnqt2t-bottom-bar-order-and-help`, `fb-keys-and-metadata-icon`), so this plan moves and
removes no button.

## The answer to his question

The bar is one component, `Dock` (`src/web/Dock.tsx`), mounted by both pages. It draws the modes
in one of two ways, chosen by whether the page handed it a way to switch the middle column
(`mode` and `onMode`):

```
reading view   [Plain] [Summary Structure … Search] [Marginalia]   [ quick search ]  Comments 3  Metadata …
               └frame┘ └──────── one frame ───────┘ └──frame──┘

Metadata page   Plain  Summary Structure … Search  Marginalia                        Comments    Metadata …
               (no frames: separate links, a hairline between runs only)
```

- **Reading view: `DockModes`.** Buttons in hairline boxes (Plain; the modes that open a
  column; and Marginalia, which is drawn only with Experimental on), the open one filled. A
  press switches the column in place.
- **Metadata page: `DockModeLinks`.** The same list as loose links back to the article. No boxes,
  nothing filled.

Why it is like that: the Metadata page has no middle column, so a press there cannot switch
anything; it has to be a link that leaves the page. That is a real difference in what a press
*does*. It was never a reason for the row to *look* different. The links were written on
2026-08-25 as the cheap fallback, and the frames (one on 2026-08-25, three since 2026-10-02) were
only ever added to the reading view's half. `Dock.tsx` itself calls the links "the arm this bar
keeps forgetting": it has been left behind twice before (Plain's label, the tooltips).

More differences, each with a reason, and each staying as it is in this plan:

| On the Metadata page | Why |
|---|---|
| No mode is filled in | No mode is open there. The Metadata button carries the "you are here" mark instead. |
| No quick-search box (or its ⚡) | The box hands what you type to Search's column, and this page has none. See the open question. |
| Comments has no count and no chevron | The page does not fetch the comments (`Metadata.tsx`, by design: one request fewer), and there is no drawer to open: the button is a link back to the article. |
| More words on the buttons at the same window width | A consequence of the row above. Without the search box the row is about 150px shorter, so the bar's fit ladder keeps the words *Commands*, *Comments*, *Metadata* and *Experimental* where the reading view has dropped them (measured at 1440: reading view on rung 3, Metadata on rung 2). |
| Hover cards end "back in the article itself" | A press leaves the page, and the card says so. |

## What we build

`DockModeLinks` draws the reading view's structure: a `.dock-modes` row holding the same
non-empty `.dock-frame` boxes for the same `visibleModes` list (Plain; the column modes;
Marginalia when it is drawn), with the same `--dock-mode-count` and
`--dock-frame-count` values, and the hairlines between runs computed from the column modes only,
as `DockModes` does. Inside the boxes they are still links, with the same hrefs, tooltips and
`aria-label`s as today.

- **No `role="radiogroup"`, `role="radio"` or `aria-checked`.** They are links and none is
  selected; a screen reader should still hear a row of links. The frames are plain `div`s.
- **The loose-link class `dock-mode` goes**, with its three CSS selectors
  (`dock-fit.css`: the run hairline and both halves of rung 2). Inside `.dock-modes` the
  segment's own rules already match a link, because `DockLink` is a `.dock-btn`. One shape, one
  set of selectors, so the next change to the segment cannot miss this page a fourth time.
- `fitSignature`'s `shape` term stays. It still changes when the bar changes arm, and the arm
  still changes the width (a filled button keeps its word at rung 2).
- Tests: `tests/dock-fit.test.ts` asserts today that the Metadata bar has **no** `.dock-modes`
  and counts `.dock-mode` links; those flip to asserting the link count inside frames and that no
  radio role is drawn, and a new test renders both arms, Experimental off and on, and requires
  the same frames holding the same names, the same run lines and the same flex shares. The
  stylesheet test that required a `.dock-mode` selector at rung 2 now requires that none is left.
  `tests/dock-mode-tooltips.test.tsx` and `tests/dock-experimental-modes.test.tsx` found the
  links by that class and find them inside `.dock-modes` instead.
- The same arm draws a visitor's Metadata bar (`VisitorDock` in `PublicPages.tsx`), so the
  browser check includes a signed-out public Metadata page.
- Docs: the paragraph in `dock-fit.css` and `Dock.tsx` that says "two shapes"; a line in
  `docs/project/reading-view-overview.md` or `mode.md` only if one of them describes the loose
  links (checked while building).

**The simpler option passed over:** keep the `dock-mode` class and only add the wrappers. Fewer
lines changed, but it leaves two sets of selectors that must be kept in step, which is the
mechanism that made the two bars drift.

**Risk:** the row's width changes. Loose links each took the bar's 0.3rem gap; inside a frame
they touch, so the Metadata bar should get slightly narrower, not wider (GPT Sol). The ladder
measures, so it cannot overflow silently either way; the browser check looks at 1440, 1024
(touch) and 390.

## Open question for Greg: quick search on the Metadata page

Not built here; queued as its own entry.

On the reading view the bar has a search box (a ⚡ on touch screens and narrow windows). You type,
and after a pause Search's column opens beside the article with the results, your cursor still in
the box. The Metadata page has no column to open, so the box is left out, and that is the one
remaining visible difference between the two bars.

- **A. Leave it out (what this plan ships).** Costs nothing. The bars differ by one control.
- **B. Draw the ⚡ only, as a link.** Pressing it leaves the Metadata page and opens the article
  in Search, on its quick matcher, with the box focused. Small: one link. The bars then differ
  only where the reading view shows a full box rather than the ⚡ (a mouse on a wide window).
- **C. Draw the full box.** Typing a word and pausing would navigate to the article in Search
  mid-sentence. The words you typed would survive (they are kept per article), and Search's own
  box takes the cursor when it appears. What does not survive is the pending "they paused, now
  search" step, which the box cancels when it is removed from the page; it would have to be
  carried across the move to the article and dropped on any other departure. Moderate
  complexity, and leaving a page because you paused typing is a surprise.

**Recommendation: B.** It makes search reachable from the Metadata page for one link's worth of
code. Choose C only if you find yourself wanting to type a search while on the Metadata page;
choose A if the ⚡ would be one more thing in a bar you are trying to thin.

## Reviews

**Plan review, GPT Sol, read-only, 2026-10-04: BUILD WITH CHANGES**
([answer](261004h-metadata-page-bottom-bar-plan-review-sol.md)). No P0. All five findings taken,
each checked against the code:

- P1: the plan said "three frames" and "fourteen links" as constants. Marginalia is behind the
  Experimental switch, so the ordinary bar has two frames. Now "the same non-empty frames for the
  same visible list", tested with the switch off and on.
- P1: two more test files found the links by the removed class, and a visitor's Metadata bar is
  the same arm. Both added above.
- P2: the differences table missed the chevron and the hover cards' wording. Added, with the
  label difference the browser measured.
- P2: option C was described wrongly (the typed words and the focus do survive; the pending
  pause does not). Rewritten.
- P2: the width prediction was backwards. Corrected.

It confirmed the CSS approach (every rule under `.dock-modes` targets `.dock-btn`, not a button
or a radio), that nothing but tests keys on `.dock-mode`, and that plain `div` frames with no
role are right for links.

The code review is appended below when it has run.

**Code review, GPT Sol, fixing, 2026-10-04: SHIP AFTER FIXES APPLIED**
([answer](261004h-metadata-page-bottom-bar-code-review-sol.md)). No P0 or P1. Four P2s, all in
tests and comments, all fixed by the reviewer and read by me: the Metadata test did not reject
`aria-current` on a mode link; the visitor's dimmed modes could be dropped by the links arm
unnoticed; the both-arms test did not cover the reading view's nested radio wrapper or a carried
`?margin=1` with Experimental off; and several comments still said "loose links" or "three
frames" as a constant. No production behaviour changed in the review.

**Browser check, Sonnet, Playwright, 2026-10-04**, at 1440 (mouse), 1024 (touch) and 390
(touch), Experimental off and on, plus a signed-out visitor's public Metadata page. Frames match
between the two pages in count, buttons per frame, height, border, radius and the gap between
them; nothing is clipped; the focus ring is whole; tooltips open; each link lands on the article
in its mode. Where the bar has spare width the Metadata page's buttons are a few pixels wider,
because it has no search box and a shorter Comments button to share the row with.
Screenshots (Experimental on): `261004h-shot-1440-article.png`, `261004h-shot-1440-metadata.png`,
`261004h-shot-390-article.png`, `261004h-shot-390-metadata.png`.

**Not seen red before the fix, said plainly:** the tests were rewritten and the component changed
in the same sitting, so the new tests were first run green. Each was then shown able to fail by
mutation (`groupStarts(modes)` for `groupStarts(bands)` reds the both-arms test).

**Deferred:** the open question above is queue entry `qi-spzcrqnw`.
