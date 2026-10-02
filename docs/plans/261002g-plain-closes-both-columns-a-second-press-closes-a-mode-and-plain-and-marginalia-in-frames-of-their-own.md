# Plain closes both columns, a second press closes a mode, and Plain and Marginalia get frames of their own

**Status: built, 2026-10-02.** Three changes to the bottom bar's mode switch (`DockModes` in
[`src/web/Dock.tsx`](../../src/web/Dock.tsx)), from two of Greg's reports. GPT Sol reviewed the
plan ([261002g-plan-review-sol.md](261002g-plan-review-sol.md)); § What the review changed says
what moved.

## What the review changed

- **The command bar does not toggle** (Sol P1-2). A command names a destination; choosing the mode
  you are in leaves you there, and the same row on the metadata page navigates. So `Dock` makes two
  callbacks from `useActivateMode`: `activateMode` for the command bar (opens, as before) and
  `pressMode` for the bar's buttons (toggles). `onMode` carries a third argument, `toggle`, and
  `modePress` closes only when it is true. Plain closes both columns from either door.
- **Retry after a failure is close, then reopen** (Sol P1-1). Pressing the mode you are in used to
  be the retry for a failed artefact read (Ideas, Quotes and Timeline draw no button in that state)
  and the reset for a broken band's boundary. It now closes; the press that reopens is a fresh press
  on a fresh mount, which re-reads and resets. Taken knowingly rather than adding a retry button to
  each error state; the tests that held the old route
  (`modes-that-start-themselves`, `a-broken-mode-leaves-the-article-readable`) now hold the new one,
  and assert that the closing press posts no job.
- **Radio semantics kept** (Sol P1-3, declined). Sol is right that activating a checked radio
  conventionally leaves it checked. Here the press checks Plain instead, so the group still has
  exactly one checked radio and a screen reader announces the change. Remodelling the bar as
  `aria-pressed` toggle buttons touches some twenty test files and the keyboard contract
  (`arrows-belong-to-the-article`); it is the follow-up if a screen-reader user finds it confusing.
- **Coarse-pointer weight from the count** (Sol P2-1): `.dock-modes` grows by `--dock-mode-count`
  rather than a fixed eight.
- **No job, not only no token** (Sol P2-2): the integration test counts POSTs as well.

The code review ([261002g-code-review-sol.md](261002g-code-review-sol.md)) fixed two more in place:
choosing Marginalia from the command bar while it is on no longer turns it off, and a press that
changes nothing (Plain with nothing open, a command naming the mode you are in, a band brought back
from stepping aside) no longer pushes an empty history entry, which made Back take two presses. It
raised the radio semantics again as P1. That stays deferred, and is put to Greg in the feedback note.

## What Greg asked for

> If I click the "Plain" mode, it should close both left-hand and right-hand column modes.
>
> And if I click a mode that's already active, it should deactivate that mode.
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-96, spya-e47u5f)

> In the Reading view bottom-bar, move the Plain and Marginalia modes into their own icon-groups.
>
> — Greg, 2026-10-02 (spya-ba8kqp)

## Where things stand

- The left-hand column is the **band** (`?mode=`, one of the radios); the right-hand column is
  **Marginalia** (`?margin=1`, a toggle beside the radios since 261001i).
- Pressing **Plain** sets `?mode=` to plain and leaves `?margin=1` alone, so the notes stay.
- Pressing the **band you are already in** re-shows its name (the herald) and, if the band had
  stepped aside on a narrow window (`bandAway`), brings it back. It never closes it.
- **Marginalia** is already a toggle (`marginaliaPress`), so the second half of Greg's first report
  is already true for it and only the bands need it.
- The bar is **one hairline frame** around all the modes, with a hairline between runs of related
  modes (`groupStarts`, 260929c). Plain and Marginalia are already runs of their own (`exit`,
  `margin`), so today they are separated from their neighbours by a line, inside one frame.

## What changes

### 1. Plain closes both columns

A press on Plain writes `?mode=` plain **and** clears `?margin=` in one push
(`setModeAndMargin`, the same two-key write Marginalia's swap already uses), so one Back restores
both. Pressing Plain while already in Plain with the notes on turns the notes off; with nothing open
it does nothing new.

The `ModeBoundary` "way out" of a crashed band (`onPlain`) keeps closing only the band: it is about
the band that broke, not a press on Plain.

### 2. A second press on the band you are in closes it

In `Reader`'s `onMode`: if `next === mode`, it is a band (not Plain), it is a whole-mode press
(`sub === undefined`), and the band is on screen (not `bandBack` — stepped aside on a narrow window),
the press goes to Plain, keeping `?margin=` as it is. Greg asked to deactivate *that* mode, not
everything.

**The stepped-aside case keeps today's behaviour**: the press brings the band back. The reader
cannot see the band, so "deactivate" has nothing to deactivate that they can see, and the pill
(`BandBackChip`) and this press agreeing is what 260929g set up.

**No paid token on a closing press.** `useActivateMode` arms an activation token before calling
`onMode`. A press on the mode you are in now arms nothing (`next === mode` on the reading view).
Without that, the mounted band could claim the fresh token and start a model run in the instant
before it is closed (activation.ts § claim). The cost: a press on the current mode no longer
doubles as "start generating" for a band opened by a pasted link — each such band has its own
Generate / Regenerate control, and the press now means close.

~~The command bar is the same door, so choosing the mode you are already in from Cmd-K closes it
too.~~ Reversed at review: the command bar opens, the bar's button toggles (§ What the review
changed).

Sub-mode presses (a command-bar row naming a sub-mode) are unchanged: they move to that sub-mode.

Keyboard and touch: no new keys. Enter/Space on a focused mode button and a tap both reach the same
`onClick`, so both toggle. ↑/↓/←/→ stay the article's (keyboard.md). The URL gains nothing new:
closing is a push to `?mode=` absent, as pressing Plain was (url-state.md).

### 3. Plain and Marginalia in frames of their own

The one frame becomes three: **[Plain] [the bands…] [Marginalia]**, each its own hairline box with a
small gap between. Semantics unchanged: Plain stays a `role="radio"` inside the same
`role="radiogroup"` as the bands (exactly one of them is still on); the radiogroup wrapper holds two
frames. Marginalia stays the `aria-pressed` toggle outside it.

The run lines (`dock-group-start`) inside the bands' frame stay; the two lines that used to separate
Plain and Marginalia from their neighbours are replaced by the frame edges, so the segment computes
`groupStarts` over the bands alone. The metadata page's loose links have no frame and keep their
lines as they are.

CSS: the frame rules (`border`, `radius`, `overflow: hidden`, never shrink) move from `.dock-modes`
to a `.dock-frame` class; `.dock-modes` becomes the unframed row holding them. On a coarse pointer
each frame grows by its button count, so the bar still spreads in proportion to what is in it.

## The simpler option passed over

Keep one frame and make the two run lines heavier. Cheaper, but Greg asked for groups of their own,
and the frame is what "a group" already means in this bar (the hairline box says *one of these*).

## Deferred

- The metadata page's loose links getting frames too.
- `aria-pressed` toggle buttons in place of the radiogroup (§ What the review changed).
- An explicit retry in the error states of Ideas, Quotes and Timeline.

## Checks

- Unit: Reader-level press outcomes are a pure function (`modePress` in a small module) tested for
  each case: Plain press, current band press, stepped-aside current band press, other band press.
- `tests/dock-mode-order.test.ts` updated: no line before `structure` or `marginalia`; frames tested
  by the DOM (three `.dock-frame`s, Plain alone in the first, Marginalia alone in the last).
- Activation: a press on the current mode arms nothing (test via `pendingActivation`).
- Browser (Sonnet subagent): wide and phone widths, press Plain with band + notes open, press the
  current band twice, look at the frames.
