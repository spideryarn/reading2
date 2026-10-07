# On a phone, a link in a band closes the band

Status: **built**, on `dev` 2026-09-29, not deployed. Follow-on to
[260929f](260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md), whose browser check
found it.

> close the panel on link tap on phone for all modes
>
> — Greg, 2026-09-29 (relayed by the Overseer, answering 260929f's "left for Greg")

## The problem

On a phone the mode's band covers the whole article (`band-covers`,
[narrow-windows.md](../project/narrow-windows.md)). Tapping a passage link inside the band — a
`BlockRef`, a Structure or Summary row, a Quotes row, a search hit — scrolls the prose that is
*underneath* the band and flashes it, and the reader sees nothing happen. Every mode does this;
Tweets' new per-post links made it obvious. The Overseer's brief: do it once in shared code, and keep
a clear way back into the mode.

## What already exists

**Trajectory already does exactly this, for itself.** `bandAway` in
[`Reader.tsx`](../../src/web/reader/Reader.tsx) is component state that hides a covering band
without closing the mode (`.reader.band-covers.band-away .mode-band { display: none }`,
narrow-window.css § a band that has stepped aside). The band stays mounted, so nothing in it is
lost; the flash is already held until the prose is uncovered (`flushPendingFlash`); a Dock press on
the mode brings it back; and Trajectory's door in the prose offers *All stops*
([260928a](260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md) F4).

**Every band's jump already funnels through one function**: Reader's `jumpTo`, handed to each band as
`onJump` inside `modeBand()`. The same `jumpTo` also goes to things that are not bands (the spine,
the table, the chat dialog, the hover card), so the change cannot live inside `jumpTo` itself.

## The change

1. **`bandJump` in Reader** — `jumpTo`, then, if a band is open and covering (`fit.modeW === 0`),
   `setBandAway(true)`. Passed to bands only, in place of `jumpTo`, inside `modeBand()`. One
   function, every mode.
2. **A way back: a "↩ back to ⟨Mode⟩" pill** while the band has stepped aside, in the slot the
   existing *back to ⟨section⟩* chip uses (`ReturnChip`, same classes, same place above the Dock).
   Pressing it clears `bandAway`: the band returns over the prose exactly as it was left. While it
   shows, the section chip does not — pressing that would go back in history with the band still
   hidden, and two pills saying "back" to different places is one too many. A small × hides the pill
   (the Dock's mode button still brings the band back).
3. **Browser Back also brings the band back.** A band jump pushes `?at=`; the reader's instinct after
   tapping a link is Back. A `popstate` while the band is away clears `bandAway`, so Back returns
   them to the band they came from (and to the previous position underneath it).
4. **Trajectory** keeps its door and its own step-aside calls; it simply gets the pill too, as one
   rule for every mode.

**Why step aside rather than `?mode=plain`** (the literal reading of "close the panel"): closing the
mode unmounts the band (`ModeBoundary key={mode}`), and Chat's unsent draft, the Quiz's typed answer
and position, and Search's typed query live only in component memory. Stepping aside looks the same
to the reader — the band is gone and the paragraph is there — and loses nothing. It also adds no
history entry of its own.

**Simpler option passed over:** close the band with no way back but the Dock. Greg asked for a clear
way back, and the Dock's mode buttons do not say that the band is merely hidden.

## Assumptions

1. "Phone" means *the band covers the prose* (`fit.modeW === 0`), not a user-agent or a fixed width —
   the one fact the rest of the page already keys on. A narrow desktop window gets the same.
2. Diagram's arrow-key stepping also jumps; on a covering band it would step aside on the first
   press. Phones have no arrow keys, so this is accepted rather than special-cased.
3. `bandAway` stays component state, not URL state (a reload opens the band), as Trajectory's did.

## GPT Sol's plan review, and what changed

[260929g-…-plan-review-sol.md](260929g-on-a-phone-a-band-link-closes-the-band-plan-review-sol.md),
*revise before build*; all six taken:

1. **Trajectory keeps raw `jumpTo`** — it jumps from its mode-opening effect, so `bandJump` would
   have opened its band and hidden it at once. It already steps aside on a stop (`onAway`).
2. **Focus**: the focused band control is recorded, the pill takes focus (`preventScroll`) when the
   band goes, and focus returns to the control when it comes back.
3. **Diagram gets `onFollow`** for its step buttons and arrow keys (raw `jumpTo`); only explicit
   presses use `onJump`/`bandJump`. Assumption 2 above is withdrawn.
4. **No `popstate` rule** — change 3 above is dropped. While the band is away the reader can push
   entries of their own, and Back should undo those. The pill is the way back.
5. **The herald is not drawn while the band is away.**
6. **No × on the pill**, so the way back is always on screen; the pill keeps the `.return-chip`
   class the Dock strip's spacing reads.

## As built

- **GPT Sol's code review**
  ([…-code-review-sol.md](260929g-on-a-phone-a-band-link-closes-the-band-code-review-sol.md)) fixed
  two focus defects itself, each red-first: Trajectory's own `onAway` path skipped the focus
  handoff (now shared, `rememberBandFocus`), and focus was restored on `bandAway` rather than on the
  band actually being hidden, so widening the window lost it. It found no in-band jump that fires
  from a mount or a restore other than Trajectory's.
- **Browser check** at 390×844 and 1440×900 (Sonnet, Playwright, "How to Do Great Work"; shots in
  `260929g-shots/`, deleted from the tree on 2026-10-07 by `7e597a72c` and kept in git history): Summary, Structure, Search and a Diagram node each stepped the
  band aside with the paragraph flashing and "↩ back to ⟨mode⟩" showing; the pill and the Dock
  button each brought the band back as it was — Summary's scroll position and Search's unsent query
  kept; Trajectory stayed open on opening; Diagram's step buttons did not hide it; nothing hid at
  1440. Tweets, Quotes and FAQ were not exercised (nothing generated on that article; they share the
  same `bandJump` and the whole-App test covers the rule).
- **Noticed, not changed:** once the band is back, the *back to ⟨section⟩* chip from the jump shows
  again — that is the existing jump-origin chip doing its job. The pill shares its translucent
  look over the prose.

## Stages

One stage: the code, tests (a band jump steps aside only while covering, and never on a desktop
width; not for non-band jumps; the pill appears, reopens, hides the section chip; Back reopens),
the docs that describe the covering band (narrow-windows.md, touch.md), GPT Sol plan and code
reviews, a browser check at 390px across several modes, push, debrief.
