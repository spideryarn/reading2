# Trajectory's (i) on the controls row; ‹ › cards that name their keys; the rule for every shortcut

Two suggestions from Greg (admin, trusted), 2026-09-30, both on Trajectory's pinned head, so one
session.

> Can we save vertical screen real estate by moving the (i) icon that's at the top of the Trajectory
> mode onto the same row as the other UI widgets like previous and next and gist and more
> sub-modes, etc.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-73)

> Add tooltips for the previous and next buttons in the trajectory mode, explaining what they are
> briefly and especially showing the keyboard shortcuts.
>
> And more generally, any time we have a keyboard shortcut, it should be mentioned in the relevant
> tooltip. So perhaps you could make a note of that in tooltips.md and the doc about keyboard
> shortcuts, and maybe even the docs about design or icons. Perhaps mention it in one with
> signposting to that as the single source of truth from the others.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-74)

Checked before building: nothing in `docs/plans/`, `docs/user-feedback/`, the last 200 commits or
`gjd-remote ls` covers either (the one matching session is this one).

## 1. The (i) on the controls row (73)

**Why it is on its own row today.** The (i) is already the last child of the head (`.traj-head`, a
wrapping flex row), pushed right with `margin-left: auto`. It has simply been *overflowing*. Measured
in a browser on 2026-09-30, on a local article with a five-stop Gist: the band is a fixed 400px
column at 1100 and 1440 wide, and the head inside it is 377px. The stepper is 138px, the depth
buttons 195px and the (i) 36px, and with the two 11px gaps that comes to about 390px. So the (i)
wraps onto a second row by itself (y 59–95 under a row at y 9–53), and that row is the 42px Greg
wants back. It fits only on a phone, where the band is 418px. Nothing sits above the controls; the
"top" Greg means is the band's top.

The sparkline makes it worse on longer routes: `sparkWidth` is `6px × stops`, clamped to 40–72px,
so a route of twelve or more stops adds up to 32px more.

**The change, in two parts:**

1. **Win back the width** so the common case is one row. The head's column gap goes from 0.7rem to
   0.4rem, and the depth buttons' side padding from 0.6rem to 0.45rem. That is about 24px, which
   puts the five-stop case at about 366px of 377. The (i) keeps its 36px house size (Sol, plan
   review F4: shrinking it was not needed by the arithmetic).
2. **When it still wraps, the (i) never rides alone.** The depth buttons and the (i) go into one
   non-wrapping group (`.traj-head-end`, pushed right). A row too narrow for everything then breaks
   between the stepper and that group: stepper on row 1, depths + (i) on row 2. That is the same
   height as a head whose depth buttons wrap today, and never an extra row for the (i). When there
   is only one depth, and so no depth buttons, the group holds only the (i), which then fits beside
   the stepper at any width.

**Simpler option passed over:** only part 1, the tightening. It fixes the measured case, but a
long route's sparkline brings the lone-(i) row straight back, which is exactly the report.
**Also passed over:** dropping the (i) and folding its two sentences into the sparkline's card.
That saves the most space, but Greg asked to move the (i), not to remove it, and the sparkline's
card is the stop count, a different thing.

## 2. ‹ › get cards that name their keys (74)

The stepper's two arrows are bare icons with an `aria-label` and, on stop 1 only, a `title`
attribute — which [tooltips.md](../project/tooltips.md) calls a regression, and which
[icons.md § Navigation](../project/icons.md#navigation-an-icon-with-a-tooltip-not-a-text-label)'s
*"Every icon has a tooltip"* already forbids. Each gets a `ControlTip`, the Chat Send button's shape
(260929g Part C): a head, one sentence of what it does, and the key.

| Button | Head | What | How |
|---|---|---|---|
| ‹ on stops 2… | Previous stop | Back one stop along the route. | While reading, press ←. |
| ‹ on stop 1 | Back to stop 1 | Back to the first stop. | While reading, press ←. |
| › | Next stop | On to the next stop along the route. | While reading, press →. |

**The cards do not promise that the article scrolls** (Sol F1): a stop whose block has gone since
the route was planned is still stepped onto, and the step lands nowhere. That no-op is older than
this change and is deferred (below); the copy just does not claim what it cannot keep. **"Not while
typing"** (Sol F2): the keys go through keynav's guards, and hovering a button does not blur a
focused text box, so a bare *Or press ←* would sometimes be false.

**Hover and focus cards, one tap still steps** (Sol F3). These are uncontrolled tooltips, so on a
touch device the tap steps at once and the card is not readable there. That is deliberate: a phone
has no ← to learn about, and reveal-then-commit on the mode's main control would cost every step a
second tap. The rejection of `title` below stands on the other grounds (it waits a second, cannot be
styled, and five tests already forbid it).

**Placement** (Sol F5): the head's arrows `placement="bottom"`, the door's `placement="top"`, all
`keepSide` and `className="tip-soon"`, the row idiom in tooltips.md.

The `title` goes. The row gets one `TooltipGroup` so moving along it does not wait the open delay
at every button, as Diagram's chips do. The sparkline and the (i) keep their controlled cards
(tap-to-toggle); only the arrows are new.

**The door in the prose** — the *Next stop ›* button after the current stop's block — is the same
step and the same → key, and has no card at all. It gets the same card. Trivial, same rule, same
file.

**Not done, and why:**
- **› at the end of a pass stays natively `disabled`**, so its card cannot open there (a disabled
  button is no reliable tooltip trigger, tooltips.md § the shelf's action row). Changing it to
  `aria-disabled` is Chat Send's fix, but it adds a third card state ("the last stop of this pass")
  and a test rewrite for a button whose meaning at the end is plain. Deferred.
- **The door's *More detail ›* still carries a `title` attribute.** It has no key (→ at the end of a
  pass takes nothing), so the rule does not reach it; converting it is the tooltips.md rule, not
  this one. Deferred.
- **Stepping onto a missing stop does nothing** (Sol F1): buttons, keys and the door all target the
  adjacent stored stop, and a stale route can hold one whose block is gone. Skipping those, or
  disabling the button, is a change to `trajectory-route.ts`'s one rule, and wants its own plan.
- **No sweep of every other shortcut in the app** — out of scope per the brief. The rule is written
  down, and the known shortcuts already named on their cards are Chat Send (Enter, Shift+Enter) and
  Metadata (⌘Enter / Ctrl-Enter). A sweep is listed for the Overseer's queue in the note.

**Simpler option passed over:** keeping the `title` and adding the key to it (`title="Previous stop
(←)"`). One line each, but no touch device ever sees it, it waits a second, and tooltips.md has
five tests asserting `title`s are gone elsewhere for exactly that reason.

**A `keys` prop on `ControlTip`, passed over for now.** It would make "name the key" a slot to fill
rather than a sentence to remember, but there are only three cards with keys, and Chat Send's
precedent is a sentence in `how`. If the sweep finds more, that is the moment.

## 3. The rule, and where it lives

**tooltips.md is the single home**: a short section, *A control with a keyboard shortcut names it in
its card*, with Greg's words. Signposts, which need no approval (CLAUDE.md, Greg 2026-09-02):

- [keyboard.md](../project/keyboard.md) — a line at the top of the shortcuts list pointing at the
  rule, and the ← / → in Trajectory section says the buttons' cards name the keys.
- [icons.md](../project/icons.md) — a line under *Navigation* (an icon button with a shortcut says
  so in its card).
- **[design-css-overview.md](../project/design-css-overview.md) is not edited** — an entry point whose
  wording is a rule. The proposed one-line pointer goes in the feedback note for Greg.

## Tests

- `tests/trajectory-panel.test.tsx`: hovering each arrow opens exactly one card naming its key;
  focusing one does too; the stop-1 arrow's card says *Back to stop 1* and ←, and the card follows
  the label from stop 2 to stop 1; no `title` on either arrow; the door's *Next stop ›* names →.
  Written first, seen red (5 of 5, before any code).
- The (i)'s placement is layout, which jsdom cannot measure, so the evidence is a browser check: the
  same five-stop article at 1440 and 1100 wide, the (i)'s rect on the stepper's row; a route with
  a long (72px) sparkline, where the (i) must be on the depths' row and never alone; and a phone
  width (Sol F6). A
  unit test pins only the structure: the (i) and the depth buttons share one parent.

## Review

- Plan: GPT Sol, read-only — `260930h-plan-review-sol.md`.
- Code: GPT Sol — `260930h-code-review-sol.md`.

## What the browser showed (2026-09-30, after the change)

A Sonnet browser agent, on this worktree's own vite, local article
`the-mythology-of-conscious-ai-spya-rn5m0q` (Gist 5, More 7, Most 24):

- **1440 and 1100, Gist:** `.traj-head` 377×44, one row; the (i) at y 13 beside the depth buttons,
  on the arrows' row. Before: 377×86, the (i) alone at y 59.
- **Most (sparkline 72px):** the head wraps, stepper on row 1, depth buttons and the (i) together on
  row 2. Nothing alone.
- **390 wide:** wraps on both depths the same way, no horizontal overflow.
- **Cards:** ‹ on stop 1 reads *Back to stop 1 / Back to the first stop's passage. / Or press ← (not
  while typing in a box).*, below the button; › the same with →; Tab onto › opens its card; → with
  nothing focused steps the route.
- **Seen, not changed:** on a wrapped head, an arrow's card covers the depth row while it is open —
  transient, hover or focus only. And on a phone, pressing *Most* steps the band aside onto the
  stop, which is the narrow-window step-aside from 260928, not this change.

## The code review, and what was kept

GPT Sol, `--sandbox workspace-write`, which fixes as it goes (answer: `260930h-code-review-sol.md`,
a summary only; the diff was read directly). Kept:

- **"While reading, press ←."** in place of *Or press ← (not while typing in a box).* Shorter, and
  also true while the Dock drawer is open, which suspends the keys with the buttons still mounted
  behind it. The table above now shows it.
- **`enabled` on `StepTip`**, so Next's card closes when a step disables the button under a focused
  card. There is a test for it.
- **A tighter assertion** that the depths-and-(i) group is the head's last child.
- **tooltips.md** now names Commands' ⌘K / Ctrl-K as one of the cards that already say their key.

Reverted: *"…, if its passage is still available"* on every card. The cards promise only a step
along the route, and that stays true on a stale route, where the stop changes but the page does not
move. The hedge made every card longer to cover a rare case that the copy never claimed. Also fixed:
a relative link in the feedback note that pointed at a path that does not exist.
