# Bottom bar groups: Skim and More join Structure and Summary, Comments joins Marginalia

*Status as of 2026-10-08: planned.*

Up: [plans.md](../project/plans.md). Reports `spya-wm5gu2` (SPIDERYARN-READING2-EM) and
`spya-mcs4gb` (SPIDERYARN-READING2-EQ), both from Greg as admin; Overseer queue item `qi-ecakhf63`.
Follows [261007c](261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md),
which made the More button.

## Goal

Greg, 2026-10-08, verbatim:

> In the bottom bar, move the skim mode icon into the same group after structure and summary.

> On the bottom bar, I'm glad we've got the three dots that hide the extra modes. I wonder if we
> could put those, right now they're sort of out on their own. I'm wondering if we could put those
> perhaps just after the skim mode, just after structure and summary as part of that group, rather
> than out on their own. And also, I wonder if we could put the comments icon inside a group with
> marginalia, perhaps after marginalia.

A "group" here is what the bar draws: a hairline frame (`.dock-frame`) and, inside the bands' frame,
a thin line between runs of related modes (`ModeGroup`, `groupStarts`).

```
before  [Plain] [Structure Summary | Skim | Search Chat Learn] [⋯ More] [Marginalia]  ⚡  Comments Metadata …
after   [Plain] [Structure Summary Skim ⋯More | Search Chat Learn] [Marginalia Comments]  ⚡  Metadata …

switch on, before  [Plain] [Structure Summary Diagram | Skim | Citations Referee Debate | Search Chat Learn] [⋯] [Marginalia]
switch on, after   [Plain] [Structure Summary Diagram Skim ⋯ | Citations Referee Debate | Search Chat Learn] [Marginalia Comments]

a gathered mode open (Glossary), after
                   [Plain] [Structure Summary Skim ⋯ | Glossary | Search Chat Learn] [Marginalia Comments]
```

## Decisions

**D1. Skim joins the `shape` run.** One field on its `MODES_UI` row. Its row stays where it is in the
table, so with the switch on it comes after Diagram — still "after structure and summary", and no
other row moves. The `guides` run keeps the five gathered modes, which are drawn only while one is
open (261007c D3); then it is a run of one, after More, with its line.

**D2. More moves inside the bands' frame, straight after the last drawn `shape` row.** Its own frame
goes. It carries no `dock-group-start`, so no line separates it from Skim; the first button after it
gets the line (it begins a different run, so `groupStarts` already says so).

*The cost, named:* 261007c D6 (GPT Sol's PR-1 on that plan) put More outside `role="radiogroup"`
because a menu button inside one is announced as one of "what the middle column shows", and ARIA
allows only `radio` children in a radiogroup. Greg's ask puts it between two radios, so in DOM and
tab order it must sit between them. Options considered:

1. **More inside the radiogroup element** (chosen). Smallest change. A screen reader entering More
   hears the group's name and then "More, menu button"; the radios' position-in-set counts radios
   only, so "3 of 9" stays right. What More opens is a list of more answers to the group's question
   ("what the middle column shows"), so the name stays true of it. ARIA requires `radio` children
   of a radiogroup but does not say every descendant must be one (GPT Sol corrected this plan's first
   wording); the cost is that it is a mixed composite, not the textbook radio pattern.
2. **`aria-owns`** — a radiogroup element that owns the radios by id, with More outside it in the
   accessibility tree. Honest on paper; poor and inconsistent support in Safari/VoiceOver, which is
   the iPhone and iPad this bar is most used on, and the ids have to be kept in step by hand.
3. **Two radiogroups** either side of More: worse, since it would claim two independent choices.
4. **CSS `order`** to draw More between radios while keeping it outside in the DOM: visual order and
   focus order would disagree (WCAG 2.4.3).

5. **Make every mode an `aria-pressed` button in a plain `role="group"`** (GPT Sol's preference,
   PR-1): no mixed composite at all. Passed over here because it changes the semantics of the
   whole mode switch — the radiogroup that tells a screen reader *exactly one of these is on* —
   and some thirty tests and a measurement script that address modes as radios, for a request
   about where one button stands. Worth doing if the switch is ever reworked for its own sake.

Option 1, which Sol called acceptable as a pragmatic compromise.

**D3. Comments moves into Marginalia's frame, after Marginalia.** Both arms: the drawer trigger
(`DockTab`) on the reading view, and the link (`DockLink`) on Metadata and the visitor pages. Dock
renders the Comments element as before and hands it to `DockModes` / `DockModeLinks` as a node to
draw after the toggle in the same frame; if a bar has no Marginalia toggle, Comments gets the frame
alone. Marginalia's toggle is outside the radiogroup already, so no ARIA question here. Metadata
keeps the `TooltipGroup` it shared with Comments, now alone in it.

Consequences, each to be checked rather than assumed:
- inside `.dock-modes`, Comments drops its word on fit rung 2 with the modes rather than on rung 3;
  `--dock-mode-count` counts it (coarse pointer share);
- `fitSignature` must still change when the Comments chip's count changes (it already reads the count);
- the drawer's Escape / focus return, the coarse-pointer 44px floor, and the `.on` style inside a
  frame (fill rather than the top marker) apply to it as to its neighbours;
- Quick search (⚡) now stands after the Marginalia–Comments frame rather than before Comments.

**D4. The phone overflow (`qi-t22r9mt4`)** — at 390px the bar scrolls sideways and More was past
the right edge. More moving four buttons left should bring it on screen without scrolling; checked
in the browser at 390 and 360. If the bar still scrolls, that part of the queue item stays open: it
is not widened here.

**D5. `data-mode` marks the controls that are modes** (Sol's PR-3). Once More and Comments sit
inside `.dock-modes`, "a control in the mode segment" stops meaning "a mode". The radios,
Marginalia's toggle and the links arm's mode links carry `data-mode`; More and Comments do not.
Every test sweep that collected modes by `.dock-modes a.dock-btn` or `[aria-pressed]` selects by it
now (`MODE_ATTR` in `Dock.tsx`).

**D6. The rung-2 rule that gives the open mode its word back is scoped to `[data-mode]`** (Sol's
PR-2). Inside `.dock-modes`, Comments loses its word on rung 2 with the modes; it is `.on` while its
drawer is open, and the old `.dock-btn.on` selector would have given the word back without the fit
signature changing, widening the bar with nothing remeasuring it. `tests/dock-fit.test.ts` now fails
on any `.on … .dock-btn-label` rule without `[data-mode]`.

**Out of scope.** Which modes are gathered under More; the order inside the menu; any other run.

## GPT Sol's plan review

[Prompt](261008d-plan-review-prompt.md), [answer](261008d-plan-review-sol.md): build with fixes, no
P0. PR-1 is D2 above (option 1 kept, the plan's ARIA claim corrected). PR-2 is D6, PR-3 is D5.
PR-4 (the three width counts: segment, bands' frame and radiogroup, Marginalia's frame) and PR-5
(every gathered mode open, FAQ and Timeline with the switch on) are tests in
`tests/dock-groups.test.tsx`, `tests/dock-more.test.tsx` and
`tests/a-second-press-closes-the-mode.test.tsx`. PR-6's targets are updated: the help page's prose
and alt text, `reading-view-overview.md`, and the comments in `Dock.tsx` and `dock-fit.css`; the
`narrow-window.css` and `dock-fit.ts` comments it named were still true. A bar with no Marginalia
toggle (Comments alone in the frame) does not occur today — Marginalia is on every bar since
2026-10-05 — so it has code but no test.

## Stages

One stage: it is small and all in `Dock.tsx`.

- [ ] Tests first, seen failing: `tests/dock-mode-order.test.ts` (Skim in the shape run, line
      starts), `tests/dock-more.test.tsx` (More inside the bands' frame straight after Skim, no
      frame of its own, the next button carries the line; on both arms), a test that Comments is in
      Marginalia's frame after the toggle on both arms.
- [ ] `group: "shape"` on Skim; More placed in the bands' frame; Comments as a slot; `drawnCount`;
      comments in `Dock.tsx`, `dock-fit.css`, `narrow-window.css` that describe four frames / More
      after Learn / Comments among "the three that are not modes".
- [ ] Docs that describe the bar's order: sweep for them (reading-view-overview, narrow-windows,
      phone-and-touch, help pages, mode.md), and update the `ModeGroup` comment.
- [ ] Gates, browser check (1440, 390, 360; WebKit iPhone), GPT Sol code review, commit, push.
