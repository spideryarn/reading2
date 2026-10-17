# Threshold sliders jump between the values that change the count

Report #588 (`spya-t80rep`, SPIDERYARN-READING2-J9), Greg's, filed 2026-10-17. Queue item
`qi-krmaq39d`.

> For the UI threshold slides (e.g. Search, Glossary, etc), could we somehow subtly indicate where
> changing the threshold will change the number of results? And perhaps even jump between those
> steps. Because changing the threshold value when it has no effect on the number that pass the
> filter isn't that helpful. I'd rather that, as I slide it, it jumps to the values that will affect
> the number of results shown. And/or little visual ticks on the slider that show where within the
> spectrum such thresholds are.
>
> — Greg, 2026-10-17

## What is there today

Six bands have a threshold slider ([261007a K5](261007a-ui-sweep-k5-threshold-slider-and-order-row-one-class-set.md)).

| Band | Component | Track | Moves by |
|---|---|---|---|
| Glossary `?gate=` | `ThresholdSlider` | 0 … top score, linear | 0.01 |
| Citations `?citebar=` | `ThresholdSlider` | 0 … top score, linear | 0.01 |
| FAQ `?faqbar=` | `ThresholdSlider` | 0 … top score, linear | 0.01 |
| Search `?conf=` | `ConfSlider` (SearchPanel) | fixed 0 … 100, linear | 1 |
| Quotes `?bar=` | `BarSlider` (QuotesPanel) | **index into the real scores** (`barStops`) | one stop |
| Reception/Claims `?bears=` | `StopBar` | index into named levels | one level |

So Quotes already jumps (it has since 260903c), and Reception's levels are words, not a spectrum.
The four linear ones are where most of a drag changes nothing: a glossary of 30 terms has at most 30
positions out of 100 that do anything.

## What changes

**One shared range input, `StopRange`, used by all five numeric sliders.** It takes the track
(`min`, `max`, `step`), the value, and **the stops**: the threshold values at which the visible set
changes. It does two things the native input does not:

1. **It jumps.** A drag or a tap lands on the nearest stop. An arrow key, PageUp/PageDown or
   Home/End moves to the next stop that changes the list, not by 0.01.
2. **It draws a tick under the track at each stop**, at its true position on the linear track, so
   the reader sees where on the spectrum the results are bunched. Quiet: a short faint mark, the
   app's `--ink-faint`. `aria-hidden` — the spoken value already says the count.

It stays a native `<input type="range">`, so dragging, touch and the screen reader's own value
announcement are unchanged; what is added is an `onKeyDown` and a snap in `onChange`.

### Where the stops are

With an inclusive bar (`survivesThreshold`: `score >= t`), the list shown at `t` is "everything
scoring at least `t`". It changes only as `t` crosses a score. Every `t` in `(sᵢ₋₁, sᵢ]` shows the
same list, so **the stops are the distinct scores themselves**, and each stop is the canonical value
for its list: at stop `sᵢ` the printed threshold equals the lowest visible score. Glossary, FAQ and
Citations floor each score to the 0.01 grid first (`floorToGateStep`, as `thresholdTop` does — an
item always survives its own floored score, and the URL is written on that grid). Search's
confidences are integers already; floored to be safe. Quotes keeps `barStops`.

One shared function in `threshold.ts`, `thresholdStops(items, scoreOf, round)`: sorted, distinct,
unscored items skipped (they survive every bar and so create no stop).

**No synthetic stop at 0** (a score that is genuinely 0 is one). At 0 and at the lowest score the list is the same. The left end of the track below
the lowest score is therefore inert; a drag there lands on the lowest stop.

### The keys, exactly

From value `v` (not necessarily on a stop — a default or a link's value often is not):

- **Right / Up / PageUp**: the list at `v` is "≥ the smallest stop at or above `v`" (call it `c`).
  The next list is at the smallest stop **strictly above `c`**. Going to `c` itself would change
  nothing, which is the whole complaint. None above: stay put.
- **Left / Down / PageDown**: the largest stop strictly below `v`. None: stay put.
- **Home / End**: the lowest / highest stop.
- No stops at all (an unscored list): the native step, untouched.

`preventDefault` on every one of those keys when there are stops, so the browser's 0.01 step never
runs alongside ours.

### Pointer

`onChange` receives the raw value; we hand the caller the **nearest** stop instead. Nearest, not
"in the direction of travel": a direction-based snap oscillates under a still finger (raw `v` just
past `sᵢ` → snap up to `sᵢ₊₁`; next event, still `v`, now reads as leftward → snap down to `sᵢ`).
The thumb visibly leaps between stops as the pointer passes midpoints, which is the jump Greg asked
for.

### Quotes moves onto the linear track

Its index track jumps already, but its stops are evenly spaced however the scores are, so ticks
under it would say nothing about the spectrum, and it would be the one numeric slider that looks
different (controls.md § Controls that do the same job look the same). It moves to `0 … top score`
with the same `StopRange`. `snapToStop` (for `?bar=` from a link) is unchanged; `barStops` is the
stop list.

### Search's fixed 0–100 stays

Sol's 2026-08-26 reason still holds: hits stream in, and a moving `max` remaps the pointer mid-drag.
With a fixed track a new hit only adds a tick. (An index track would shift the thumb as stops
arrived — another reason the linear track is the shared one.)

### Ticks: placement

A native thumb's centre travels from `thumb/2` to `width − thumb/2`, not from 0 to the width. The
tick row is inset by half a thumb on each side (`--gloss-gate-thumb`, set to the measured Chromium
width and checked in a screenshot against a stop the thumb sits on). Close enough in Safari and
Firefox, whose thumbs are within a few px; a tick a pixel or two off is not a defect worth styling
the thumb ourselves for (that means `appearance: none` and redrawing the whole control in three
engines).

## What it does not do

- **Reception/Claims `StopBar`** is untouched: its stops are words, already one per position.
- No change to any default, URL parameter, or what survives a bar. A link with `?gate=0.30` still
  opens at 0.30 even when there is no score there; the first key press or drag moves it onto a stop.
- No count beside each tick, no tooltip on hover. Greg said *subtly*.

## The simpler option passed over

**Ticks only, no snap** (a `<datalist>` on each input). Native, three lines. Passed over because
Chromium draws datalist ticks only on some platforms, Safari not at all in this form, and Greg's
first preference was the jump: *"I'd rather that, as I slide it, it jumps"*.

**Index tracks everywhere, like Quotes.** Jumps with zero key handling, but positions stop meaning
anything (the ticks would be evenly spaced, so "where within the spectrum" is lost), and Search's
streaming would move the thumb under the reader.

## Stages

1. `thresholdStops`, `stopAbove`, `stopBelow`, `nearestStop` in `threshold.ts`, with tests written
   first (the key rules above, including the off-stop default and the empty list).
2. `StopRange` component, ticks CSS; `ThresholdSlider`, `ConfSlider`, Quotes' `BarSlider` adopt it,
   each panel passing its stops. jsdom tests: arrow from an off-stop value skips the no-op stop,
   pointer change snaps to nearest, ticks count and positions. Update
   `threshold-slider-adopters` for the new attributes.
3. Browser check (Sonnet subagent, Playwright on the box): drag, keys, ticks aligned, narrow window,
   dark mode. GPT Sol code review. Docs: `controls.md`, `threshold.ts` header, quotes.md where it
   describes the index track.

## GPT Sol's plan review, and what was done with it

[The review](261017f-threshold-sliders-jump-between-the-values-that-change-the-count-plan-review-sol.md):
BUILD WITH FIXES.

- **P1, taken.** A change with no pointer on the control (TalkBack's swipe moves the native value by
  one step without a key event) is read as a direction and moves one stop that way; nearest-stop
  snapping would have put it straight back. Only a change with a pointer down snaps to nearest. A
  change to the value already held (Firefox fires one for a press on the thumb) is ignored. Real
  VoiceOver and TalkBack were not available on the box; see § Not verified.
- **P2, taken the other way.** Quotes keeps its raw stops with `step="any"` rather than flooring
  them to 0.01, which would have collapsed close scores and changed what the Quotes bar hides.
  The code review found that the old two-decimal `?bar=` could reload on a neighbouring raw stop;
  `barParam` now preserves the exact stop in the URL, while the displayed number stays at two
  decimals.
- **P3, taken.** "No *synthetic* stop at 0": a score that is genuinely 0 is a stop
  (`thresholdStops` keeps it; `tests/stop-range.test.tsx`).
- **P4, not taken; a limit that was already there.** A Search list with no confidences at all (a
  Words search, or an old result) has no stops, and `StopRange` falls back to the plain input, which
  can move nothing — exactly as before this change. Hiding the slider there is a separate change to
  when Search offers its prioritised order.
- **P5, taken.** `tests/glossary-band-selection.test.tsx` drags with a pointer and expects the
  snapped `?gate=`.
- **P6, partly.** `pointer-events: none` on the ticks. The browser check ran what the box has.
- **P7, taken.** The two stale Search comments are corrected.

## GPT Sol's code review

[The review](261017f-threshold-sliders-jump-between-the-values-that-change-the-count-code-review-sol.md):
SHIP AFTER MY FIXES. It fixed C1 (the pointer flag could stay set after a release outside the
input, so window-level release, cancel and blur now clear it, with mouse and touch fallbacks) and
C2 (`?bar=` rounded Quotes' raw stops to a hundredth, so two stops inside one hundredth could reload
onto the other; the URL now keeps the exact score, and `barToReveal` returns it). C3 was stale
comments. C4 is plan-review P4 again, the inert slider over a Search list with no confidences, and
is left as said there.

## The browser check

Sonnet, with Playwright against system Chrome and WebKit, on this worktree's own dev server and
the local database. Firefox is not installed on the box. All five sliders were checked, on desktop
in light and dark and at 390px with touch emulation. A tick sits within ±0.5px of the thumb's centre
at every stop, the ends included. A slow drag visits one state per stop, a tap between stops lands
on a tick, every arrow press changes the count, and the URL takes the snapped value. WebKit matched
Chromium's sequences.

**It found one bug, fixed here:** in a real glossary a stop changed nothing (`1@0.28, 1@0.30`),
because `0.4 × 0.7` is a hair under the `0.28` it prints as and the bar compared it exactly —
[261017b](../postmortems/261017b-an-exact-comparison-against-a-rounded-stop.md).

## Not verified

Real VoiceOver (iOS) and TalkBack (Android), and Firefox. The non-pointer path that TalkBack's swipe
takes is covered in jsdom (`tests/stop-range.test.tsx`), not on a device.
