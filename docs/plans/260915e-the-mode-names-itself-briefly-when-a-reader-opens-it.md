# The mode names itself, briefly, when a reader opens it

SPIDERYARN-READING2-3Q, from Greg on an iPad, 2026-09-12 (an admin, so trusted input). Build it.

> It's just occurred to me that in an effort to try and make things more compact and quick, we've
> actually got rid of all of the clues that would help a beginner reader understand what each mode
> is. So if I'm on an iPad and I click on a mode, there's no tooltip, there's no heading, there's no
> explanation. Now, I don't want it to be intrusive, but there has to be some kind of indicator. So
> it could be that it shows the mode name at the top of the mode column for a couple of seconds, or
> that you can scroll past it somehow. But the problem with scrolling past it is that, well, it
> interacts with other stuff in a confusing way that I don't know how the display would work. So the
> best idea I have for now.
>
> — Greg, 2026-09-12

## Why nothing names the mode on an iPad

Three decisions, each right on its own, that add up to nothing:

1. **The band's own title went on 2026-09-05** —
   [260905d § Stage 5](260905d-declutter-the-reading-view-top-bars.md): *"I think we can rely on the
   bottom bar to tell us what mode we're in"*. So Summary and Search have no head row at all;
   Glossary, Ideas, Timeline and Quotes keep a count; Chat's head is its thread's title.
2. **The Dock drops its labels whenever the row does not fit** (`dock-fit.ts`; the labelled row
   wants ~1416px), so an iPad at 834 or 1194px shows icons only — except Plain, which keeps its word.
3. **What the dropped label leaves behind is a hover card** (`ControlTip`: name, what, how) and an
   `aria-label`. A finger has no hover.

So on a touch screen the mode's name is on screen nowhere, and the sentence saying what the mode is
for is unreachable. On a desktop the name is one hover away, but the band still opens without saying
what it is.

## What we are building

**When the reader presses a mode, the top of its band shows the mode's name and its one-sentence
description for about three seconds, then fades.** Tap it to dismiss it early.

```
 spine │ ┌─ band ────────────────────────┐ │ prose
       │ │ Glossary                      │ │
       │ │ The terms this piece uses in  │ │   ← overlay, ~3s, then fades
       │ │ a non-obvious way, defined …  │ │
       │ ├───────────────────────────────┤ │
       │ │ 40 terms                      │ │   ← the band as it was, untouched
       │ │ …                             │ │
```

The product calls, Fable's (2026-09-15), and mine where noted:

- **Name *and* description.** Greg names three missing things — *"no tooltip, there's no heading,
  there's no explanation"*. The name is the heading; the explanation is `MODE_CATALOG[mode].description`,
  which already exists for exactly this and is the first line of the desktop hover card. Dropping the
  sentence later is a one-line change if it reads as intrusive.
- **On a press of a mode, never on arrival.** Precisely: a Dock mode button (click, Enter or Space)
  or a command-bar pick. Both reach `Reader`'s `onMode` through `useActivateMode`, and nothing else
  does — a pasted `?mode=`, Back/Forward and a reload change the mode without passing through it.
  **Deliberately excluded**, because they bypass `onMode` and the control already named where it
  goes: a glossary term's card (*in the glossary*, the second tap, `G`), *Ask in chat* and *Open in
  full chat*, and switching a conversation between Chat and Remember. `G` in particular focuses the
  row the card would cover. **Deferred**: the mode links on the Metadata and Tweets pages, which are
  real presses but navigate into the reader rather than calling it. That is the same *a mount is not a click*
  distinction `activation.ts` already draws for paid runs. The reader who just pressed is the one
  asking *what did I get?*; the reader reloading the page is not, and a name flashing on every
  refresh would be the intrusiveness Greg asked us to avoid. A press on the mode you are already in
  shows it again, which is harmless and is also a way to ask.
- **For everyone, not touch only.** The head is empty on a desktop too, and gating on `(hover: none)`
  would be a second behaviour for a device class iOS reports inconsistently
  ([touch.md](../project/touch.md)). One behaviour.
- **An overlay, not a row.** It lies over the top of the band and moves nothing, so it cannot
  interact with the band's scroller, its count row or its zero-slack fit (Search). That is the
  *"interacts with other stuff in a confusing way"* Greg was worried about with the scroll-past idea.
- **Three seconds** — visible at once, held about 2.5s, faded over 0.5s. Two seconds is short for a
  name and a sentence. Under `prefers-reduced-motion` it appears and disappears without the fade.
- **Plain and Hierarchy get nothing.** Neither has a band, so there is no *"top of the mode column"*;
  Plain keeps its word on the Dock anyway, and Hierarchy's change is the columns appearing. Deferred,
  below.
- **It never takes a tap.** For three seconds it covers the band's first row — a count, Chat's thread
  title and delete, Remember's sub-mode switch, and **Search's box, which is focused on mount**. So
  the card is `pointer-events: none` and any press inside the band clears it: the tap reaches the
  control *and* ends the card. The first draft had the card catch the tap and dismiss itself, which
  would have eaten the first press at exactly the control the reader came for; GPT Sol's review
  changed it. Safe because nothing in a first row acts on one tap irreversibly — Chat's delete asks
  twice (`ArmedDelete`).

## Where it goes — mine, and not what Fable suggested

Fable suggested hanging it on `ModeSurface`, the shared `<aside class="mode-band">` every band renders
through. **It goes in `Reader` instead, as a fixed-position sibling of the band.** Three reasons:

- `ModeSurface`'s header makes *"it adds no DOM"* a hard constraint, with
  `tests/mode-surface-changes-no-markup.test.tsx` behind it, because band CSS is written against
  child position and several rules are child combinators.
- The fact that decides whether to show — *the reader just pressed this* — lives in `Reader`'s
  `onMode`. Getting it into `ModeSurface` needs a context provider, which is a second moving part.
- One band is not a `ModeSurface` at all: `FeatureBoundary`'s fallback keeps a raw `<aside>`
  deliberately. (The first draft said the visitor band did too; it does not — Sol.)

The cost: the overlay has to sit where the band sits, which means repeating the band's geometry —
`left: calc(var(--spine-w) + var(--safe-left))`, `top: var(--bar-bottom)`, `width: var(--mode-w)` —
and the full-width override under `.reader.band-covers`. Those are custom properties, so it is the
same *inputs* rather than a copy of the arithmetic, and each rule says where its twin is. **The whole
contract**, which Sol asked to have written down: the same `top` transition the band has (shell.css's
list of things that follow a sliding bar), and `z-index: 46` — above the band (44), below dialogs
(70), the drawer and scrim (92/95) and the Dock (96).

**State:** `{ mode, nonce } | null` in `Reader`, set in `onMode`. Not in the URL, and that is the rule
applying rather than an exception to it: [url-state.md](../project/url-state.md) is for view state a
link or a reload should reproduce, and this is the one thing a reload must *not* reproduce.

**It shows only while `bandOpen` and `herald.mode === mode`.** `bandOpen` is `Reader`'s existing name
for *is there a panel in the middle band* — false for exactly Plain and Hierarchy — so no second list
of band-less modes is written. And a press whose mode is no longer on screen is **cleared**, not just
hidden, so Back within the three seconds ends it and a quick Forward does not resurrect it (Sol). The
card — not the component — is keyed on the nonce, so a second press restarts the timer and the fade
instead of inheriting the first one's.

**Accessibility:** a `role="status"` region, visually hidden, always mounted and empty when idle — a
live region inserted already holding its text is not reliably announced — and filled with **the
sentence only**, because the Dock's radio has just announced the name. The visible card is
`aria-hidden`, being the same two things again (Sol).

## Tests, written first

1. **The unit** (`tests/mode-herald.test.tsx`, jsdom, fake timers): given a press it shows
   `MODE_LABEL` and the catalog description; gone after the timeout; a click dismisses it; nothing for
   `plain` and `hierarchy`; nothing with no press.
2. **The wiring**, which is the half unit tests cannot see
   ([mutate the composition root](../reusable/silent-success.md)): mount the real `App` at an
   article, as `tests/a-broken-mode-leaves-the-article-readable.test.tsx` does. Pressing the Dock's
   Glossary button shows the herald; opening the page at `?mode=glossary` shows none. Red first
   against today's code.

## Reviews

- **Plan, GPT Sol, 2026-09-15** — six findings, all applied above: which presses count, Back then
  Forward, keying the card rather than the region, taps passing through, the CSS contract, and
  announcing only the sentence.
- **Code, GPT Sol, 2026-09-16** — one P1, fixed by the reviewer with a test: keyboard input inside
  the band did not clear the card, so a reader who opened Search and typed straight away wrote into a
  box hidden under it for three seconds. A `keydown` in the band now clears it as a `pointerdown` does.
  Its sandbox could not reach Postgres, so the full suite was run here instead.

## Deferred

- **Hierarchy**, which has no band to put it on.
- **Only the first N times** — needs storage, a counter and an argument about N. Decide from use.
- **Dock hover cards reachable by touch** (long-press) — a larger question about every tooltip.
- **A persistent label** — the thing the 2026-09-05 declutter took away; only if this fails.

## Docs

`reading-view-overview.md` gets a line in *True across the whole view*; `touch.md` a sentence where it
explains that a finger has no hover; `260905d` a pointer forward from Stage 5.
