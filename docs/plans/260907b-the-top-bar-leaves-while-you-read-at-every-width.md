# The top bar leaves while you read, at every width

**Status: done and on `dev`, 2026-09-07.** All three stages built, both review rounds answered, and
the worktree removed.

- `cb8ffccf` — stages 1–3
- `b86b6726` — the round-two fixes (F6–F10)
- merged to `dev` as `b12a8fa1`, off `70040b0b`. Worktree `hierarchy-column-controls`, branch
  `worktree-hierarchy-column-controls`, both gone.

`npm run check` green on the merged tree as pushed — **797 files, 14,758 tests** — `npm run
typecheck` clean, four mutations red then restored, and **two** browser passes at five widths
(§ stage 3, and § round two for the focus case the second review found). The pre-review numbers this
line used to carry, 786 files and 14,329 tests, were from before the merge with `dev`'s `App.tsx`
split.

**Nothing is left of this plan.** The two things it deliberately did not do are at the bottom, and
neither is a loose end: one is a claim it corrected rather than a behaviour it changed, and the
other is a pre-existing defect in `dockOffset()` written up rather than folded in.

The controls bar already gets out of the way while you read forwards — but only on a phone. This
makes it do that on a laptop too.

## What Greg asked for

Verbatim, 2026-09-07:

> The Hierarchy mode has a top bar. Can we make it so that it's invisible most of the time except
> when we scroll (a bit like we already do on mobile to save real estate)? Or alternatively, can you
> find a way to not need those three Parts/Sections/Paragraphs buttons, e.g. add them somehow as
> buttons to the column(s) that are already shown, e.g. a + (or similar icon to indicate Show) to the
> left or right of the current column to reveal the coarser or more granular column, and a - (or
> similar icon to indicate Hide) to hide the current one, and I suppose if you hide all the columns
> then that is effectively asking to be dropped back to Plain mode).

Two options, and **Greg picked the first**, 2026-09-07, having been shown the costs below and a
third that neither of us had named. That choice is the plan.

## The choice, and what was passed over

The three pills are the only thing left in Hierarchy's top bar, so *any* of the three options ends
with `.controls` empty in every mode — at which point
[260905g](260905g-move-the-wordmark-and-feedback-button-into-the-dock.md) stage 3, unblocked since
the wordmark and the Feedback button moved into the Dock on 2026-09-06, would delete the bar
outright. All three were put to Greg on that footing.

| | What it is | Why not |
|---|---|---|
| **A — chosen** | extend the existing `data-bars="hidden"` behaviour to every width | the two costs below, which Greg saw and accepted |
| B — Greg's own second idea | `+`/`−` in the columns themselves | Fable: `+` reads as "expand this node" to a file-tree habit; the *paragraph labels are not ready yet* sentence loses its home, and that is the ordinary state of every newly-added article; a `+` only ever names the neighbours of what is already open |
| D — Fable's recommendation | the pills move into the Dock | the Dock is thirteen modes plus Home, Feedback, Commands and Experimental, and is already on **rung 1** of its four-rung fit ladder at 1440px ([`dock-fit.ts`](../../src/web/dock-fit.ts)). Three more pills would cost the mode labels a rung at 1280–1440, which is the band that rung was added for on 2026-09-06 |

**Neither B nor D is dead.** Both end with no top bar at all, where A ends with a bar that is absent
while you read forwards and present the moment you turn round. If A turns out to feel like chrome
that moved rather than chrome that got out of the way, D is the smaller of the two follow-ups and
this plan changes nothing that would be in its way.

### The two costs Greg accepted

Stated here so that the next reader knows they were priced rather than missed:

1. **44px is 11% of a 390px phone and 5% of a 900px laptop.** The rule exists because of the
   *stack* rather than the bar: the three bars together were 124px of a 390px viewport, nearly a
   third ([`scroll.ts` § `watchBarVisibility`](../../src/web/scroll.ts)). GPT Sol F5.
2. **A laptop is where the fisheye panels exist**, and they are the thing that moves. Every
   `.ctx-panel` is `position: fixed` with its `top` set from a measured rect, and every gist cell is
   sticky at `--bar-bottom`. Hiding the bar slides all of them 44px. Stage 1 exists because the
   *panels* do not currently slide at all — see below — and that is a defect rather than a taste
   question.

## What is true today

- **The mechanism is entirely built and entirely gated.** `stepBar` (pure, unit-tested in
  [`tests/bar-visibility.test.ts`](../../tests/bar-visibility.test.ts)) decides; `watchBarVisibility`
  sets `data-bars="hidden"` on `<html>` and re-renders nothing; the stylesheet does the rest.
- **The gate is one media query asked twice** — `SMALL_DEVICE = "(max-height: 620px), (max-width: 731px)"`
  in [`scroll.ts:185`](../../src/web/scroll.ts) and the same string in
  [`narrow-window.css`](../../src/web/styles/narrow-window.css) § a small device.
  [`tests/spine-width.test.ts:219`](../../tests/spine-width.test.ts) asserts the two are
  byte-identical. The JS half exists so a laptop installs no scroll listener for an attribute
  nothing reads; that reason expires the moment something reads it at every width.
- **Two tokens switch together**: `--bar-bottom` falls to `var(--safe-top)` (what things pin
  *under* the bar read) and `--bar-hide` to `calc(-1 * (--bar-h + --safe-top))` (the bar's own
  travel). They are two facts that were one number until `--safe-top` entered
  ([`tokens.css`](../../src/web/styles/tokens.css) § `--bar-hide`).
- **`--dock-bottom: 0px` is on the same switch**, so on a phone the Dock leaves too.
- **Measured on the box, 2026-09-07**, `antikythera-mechanism-spya-zhxrzm` in Hierarchy: `.controls`
  is a flat **44px at every width**, never wraps, never overflows
  (`scrollWidth === clientWidth` at 1440, 1280, 900 and 390), and holds exactly the three pills. Two
  `.ctx-panel`s at 1440 and 1280, **one** at 900, **none** at 390. Every `thead th` measures `0`
  high. Plain mode's bar is the same 44px with no children at all.
- **A phone already has both the panels and the hiding bar, in landscape** — GPT Sol F4, and it
  corrects the first draft of this plan, which claimed a phone has no panels and that stage 1
  therefore changed nothing anybody can reach today. `SMALL_DEVICE`'s comma is an OR, so **844×390
  matches on `max-height: 620px`** while 844 is comfortably past the `GIST_MIN + PROSE_MIN + SPINE_W`
  = 732 needed to fit one gist column beside the prose
  ([`layout.ts`](../../src/web/layout.ts)). So stage 1 is a fix to a live path rather than
  preparation for one, and 844×390 belongs in every browser matrix below. `?cols=1` reaches the same
  state in portrait.

## Decisions

1. **The top bar only. The Dock stays where it is on a wide screen.** Greg asked about the top bar.
   The Dock is 40px, it names the mode, it is the way home and the way out of every mode, and on a
   phone it joined the switch because 124px of a 390px viewport was desperate. On a laptop it is
   not. `--dock-bottom: 0px` therefore **stays inside** the narrow query, with its own guards.
2. **The thresholds do not change.** `BAR_HIDE_AFTER = 24`, `BAR_KEEP_UNTIL = 160`. Simplest version
   first; if a laptop wants a longer push before the bar gives way, that is a number to change after
   somebody has read on one, not before.
3. **The `.mode-band` guard is hoisted as it stands, so the bar keeps still in the twelve band
   modes.** On a phone the reason was that the band covers the whole article and both exits left the
   screen at once. On a laptop neither is true — but the bar is *empty* in a band mode anyway, so
   dropping the guard would slide a band and every sticky gist to reclaim a blank strip. Reclaiming
   that strip properly is [260905g](260905g-move-the-wordmark-and-feedback-button-into-the-dock.md)
   stage 3's job, which deletes it rather than hiding it. **So the bar hides in Plain and in
   Hierarchy, and stands still wherever a band is anchored to it** — which is the coherent rule, not
   a compromise.
4. **The `:focus-within` guard is hoisted too, and it is not optional.** A keyboard reader tabbing
   along the pills scrolls the page as focus moves; without it the control they are on slides off
   the top mid-tab. That is exactly Hierarchy, which is exactly the mode this plan is about.
5. **`SMALL_DEVICE` leaves `scroll.ts` rather than being widened.** The listener becomes
   unconditional. The string stays in the stylesheet, where it still gates the dock half and the
   rest of § a small device, and `tests/spine-width.test.ts` keeps the half of its assertion that
   ties the CSS number to `GIST_MIN + PROSE_MIN + SPINE_W − 1`.
6. **The invisible `<th>` stops animating and the panels start.** See stage 1 — this is the
   substance of the change, not a detail of it.

## The plan review, and what it changed

GPT Sol, 2026-09-07, on this plan before any code was written
([prompt and answer](260907b-plan-review-prompt.md), [answer](260907b-plan-review-sol.md)). It
refused the plan on three established P1s and every one of them was right when checked against the
code:

| ID | | Where it landed |
|---|---|---|
| **F1** | P1 — a standing `transition: top` on `.ctx-panel` would make every panel lag the settling header through the first 150px of *ordinary* scrolling, and `place()` centres the list from the panel's interpolated position | stage 1, the ephemeral `data-bar-moving` scoping and the `place()` simplification |
| **F2** | P1 — `stickyOffset()` reads a bar mid-transition, and `scrollToBlock` fixes its destination from that one reading | stage 2 |
| **F3** | P1 — the `prefers-reduced-motion` list omits the overflow fade, which this plan would extend from phones to laptops | stage 1 |
| **F4** | P2 — a landscape phone at 844×390 matches the height half of `SMALL_DEVICE` *and* fits a gist panel, so the "no panels on a phone" claim was false and stage 1 fixes a live path | § what is true today, and every browser matrix |
| **F5** | P3 — 44px is 11% of a 390px viewport, not a third | § the two costs |

It also **cleared the thing I was most worried about**, which is worth recording because it is the
one that would have failed silently: the two `:has()` guards keep their (0,3,0) against the
attribute rule's (0,2,0) after the move to `shell.css`, and nothing later in the import order
redefines `--bar-bottom` or `--bar-hide` for the reading root. The later narrow `.controls` rules
touch padding and overflow only. Round two re-checked the cascade against the built code and found
no regression: every moved rule stays in `layer(app)`, the guards keep their specificity, and the
Dock stays gated.

### Round two, on the built code

Refused it on three more established P1s, all of which held up when checked:

| ID | | Where it landed |
|---|---|---|
| **F6** | P1 — the `:focus-within` guard moves the bar **while `data-bars` stays `"hidden"`**, so a keyboard reader tabbing into the pills got the bar back over panels that never re-measured, and tabbing out did it again in reverse | `scroll.ts` announces a move on `focusin`/`focusout` inside the bar (only while hidden — at rest the guard changes nothing); `useColumnContext` observes `data-bar-moving` as well as `data-bars` |
| **F7** | P1 — a hidden bar rests with its bottom edge at **0**, not at `--safe-top`, so `rect.bottom <= safeTop` called the first 47px of every reveal "hidden" and under-reserved. Invisible without a notch, where the two boundaries are the same number | `stickyDestination`'s boundary is `<= 0` |
| **F8** | P1 — **the one I got wrong.** `stickyOffset` is not only a destination: `readingLine()` (keynav.ts), the `?at=` tracker, `isBlockOnScreen` and `whereIsBlock` all ask where the reader *is*. A prediction moves the reading line by up to a bar's height mid-slide, so ↓ during one could skip a paragraph | the two questions are two functions — see below |
| F9 | P2 — `bar-motion.test.tsx` stubbed `matchMedia().matches` to `true`, so reintroducing the width gate under any name would still pass | the stub is `false`; every test now exercises the unconditional listener |
| F10 | P3 — five comments still described the removed gate | `App.tsx`, `tokens.css`, `column-context.css`, `bar-motion.test.tsx`, and 260905g's own table |

**`stickyOffset` and `stickyDestination` are now two functions, and F8 is why.** They return the
same number in every settled state — which is how one served both for months — and part company only
while the bar is travelling, which is new. `stickyOffset` measures; `stickyDestination` predicts, and
is called by exactly `scrollToBlock` and `scrollByScreen`, the two that compute a target once and
then glide to it.

**One defect of the same class found and deliberately not fixed:** `dockOffset()` has F8's problem at
the other end — `scrollByScreen` reads it for a destination while it reports current coverage, so a
screenful step taken while the *bottom* bar is mid-slide is short by up to 52px. It is pre-existing,
unchanged by this plan, on a bar this plan explicitly leaves alone, and only reachable on a phone.
Recorded here rather than folded in, because fixing it changes screenful stepping on a surface with
no test coverage of the interaction and nobody asked for it.

**And one bug this review's own prompt found**, listed under stage 3 above: `transitionend` bubbles
out of the pills.

## Stage 1 — the fisheye panels keep step with the bar

**This is a real defect today and it lands on its own.** `narrow-window.css` already says so, in a
comment written on 2026-08-27 that predicted this exact plan:

> One thing it does **not** cover: the column-context panels are positioned by JS
> (useColumnContext.ts), which samples on scroll, so for up to 180ms after the bar moves a panel can
> sit up to 44px out of step. In practice the bar only ever moves *because* the reader is scrolling,
> so another sample is moments away; it is a transient, not a resting state. If it ever looks wrong,
> the fix is to re-sample on `transitionend` rather than to drop the slide.

"Another sample is moments away" is false in the one case that matters: the reader who **stops
scrolling** on the frame the bar gives way gets no further sample, and a panel is left stranded up
to 44px out of place until they scroll again. And per F4 above this is reachable today, on a
landscape phone.

Five changes. The first two are the mechanism; the last three are defects the first two would
otherwise widen.

- **`:where(table.zoom > thead) > tr > th` leaves the `transition: top` list** (both of them — the
  ordinary one and the `prefers-reduced-motion` twin, which the file's own comment says must match).
  That entry has been animating an invisible element since the head gave up its height on
  2026-09-05 ([granularity-zoom.md § the header row](../project/granularity-zoom.md#the-header-row))
  — `height: 0`, no padding, no border, its label in an `.sr-only` span. Nobody can see it move.
  What they *can* see is the consequence: [`useColumnContext.ts`](../../src/web/useColumnContext.ts)
  derives every panel's `top` from `th.getBoundingClientRect().bottom`, so an animating `th` means
  the panels are chasing a number that is still travelling. **Snap the measuring stick and the
  measurement is settled on the first frame.**
- **`useColumnContext` re-samples when `data-bars` changes**, through a `MutationObserver` on
  `document.documentElement` calling the existing `schedule()`. This is what closes the stranding,
  and it must not be left to ordering luck: `apply()` in `scroll.ts` and `measure()` here are two
  separate `requestAnimationFrame` callbacks in the same frame, and if `measure` happens to run
  first it reads the pre-flip position and nothing runs again. A `MutationObserver` fires as a
  microtask after the attribute is written, so the sample lands one frame later whatever the
  order — 16ms, invisible, and correct rather than probable.

- **`.ctx-panel`'s slide is ephemeral, not standing** — GPT Sol F1, and the first draft of this plan
  got it wrong in a way that would have been worse than the defect it fixed. A panel's inline `top`
  changes for **two** reasons, and only one of them should be animated:

  | why `top` changes | when | wanted |
  |---|---|---|
  | the sticky head settles out from under the masthead | the first ~150px of scroll — `ColumnRect.top`'s own doc comment says so | **instant**, every frame |
  | the bar hides or returns | only past `BAR_KEEP_UNTIL = 160` | a 180ms slide, in step with `.spine` beside it |

  A standing `transition: top` would make every panel lag the header by 180ms through the whole of
  the first case. So the transition is scoped to `:root[data-bar-moving] .ctx-panel`, an attribute
  `watchBarVisibility` sets on the same line it flips `data-bars` and clears on `.controls`'s own
  `transitionend` — with a timeout backstop, because a transition that never starts (reduced motion,
  a background tab, a rule someone deletes) never ends either, and a latched attribute would leave
  the panels permanently animated. **The two cases cannot overlap**, which is what makes the scoping
  safe rather than approximate: the bar is forbidden from moving inside the first 160px and the head
  has finished settling by ~150px.

  The reduced-motion override must be written at **matching specificity** —
  `:root[data-bar-moving] .ctx-panel`, not a bare `.ctx-panel` — or (0,2,0) beats (0,1,0) and a
  reader who asked for less motion gets the slide anyway.

- **`place()` centres the list on where the panel is *going*, not where it is.** It reads
  `p.getBoundingClientRect().top` ([`ContextPanel.tsx`](../../src/web/ContextPanel.tsx) § place),
  which during a slide is an interpolated value, and `useLayoutEffect` re-runs it on `rect.top`
  changing — i.e. exactly once, at the start of the animation, against the old position. Nothing
  places the list again when the panel arrives, so the current entry finishes off the 40% focus line
  that [column-context.md](../project/column-context.md) documents.

  The fix is a **simplification rather than a second effect**: read `rect.top`, the prop the inline
  `top` is set from. The panel is `position: fixed` with no transform of its own, so the two are the
  same number in every settled state and differ only mid-animation — which is the bug. `place` takes
  `rect?.top` into its `useCallback` deps.

- **The overflow fade joins the reduced-motion list** — GPT Sol F3. It is `position: fixed` at
  `top: var(--bar-bottom)` and visibly occupies the trailing edge of an overflowing table
  ([`table.css`](../../src/web/styles/table.css) § overflow), it is in the `transition: top` list,
  and the `prefers-reduced-motion` block does not name it. A pre-existing omission that this plan
  would otherwise extend from phones to every laptop.

Files: [`narrow-window.css`](../../src/web/styles/narrow-window.css) § a small device and the
reduced-motion block, [`column-context.css`](../../src/web/styles/column-context.css),
[`useColumnContext.ts`](../../src/web/useColumnContext.ts),
[`ContextPanel.tsx`](../../src/web/ContextPanel.tsx), [`scroll.ts`](../../src/web/scroll.ts).

**Done when**, red-first in each case:

- a unit test mutates `data-bars` with **no scroll event at all** and asserts `useColumnContext`
  takes a fresh measurement — it must fail against today's code;
- a unit test poses a `rect.top` and a disagreeing live panel rect and asserts `place()` uses the
  former;
- `data-bar-moving` is asserted to be *cleared* by the backstop when no `transitionend` ever
  arrives, which is the failure that latches;
- the stylesheet tests see the reduced-motion override at matching specificity.

And a browser pass at **844×390** — the landscape phone, where a panel and a hiding bar already
coexist — showing every panel's `top` equal to its `<th>`'s `bottom` after the reader stops
scrolling mid-flip.

## Stage 2 — the bar leaves at every width

- [`scroll.ts`](../../src/web/scroll.ts): `watchBarVisibility` drops `matchMedia`, the `sync`/
  `listening` dance and `SMALL_DEVICE`, and simply attaches the listener. `show()` stays in the
  teardown. `stepBar` is untouched.
- **The hidden state and its two guards move out of the media query and into
  [`shell.css`](../../src/web/styles/shell.css)**, which is the file that owns `.controls`:
  - `:root[data-bars="hidden"] { --bar-bottom: var(--safe-top); --bar-hide: calc(…); }`
  - the transition list, as stage 1 leaves it
  - `:root:has(.controls:focus-within, .mode-band) { --bar-bottom: …; --bar-hide: 0px; }`
  - `:root:has(.mode-band) .controls { transition: none; }`
- **What stays behind in `narrow-window.css`** is the dock half and only that: `--dock-bottom: 0px`,
  the dock's own `:has()` guard (drawer, `:focus-within`, the three dialogs, `.mode-band`),
  `:root:has(.mode-band) .dock { transition: none; }`, and the `.install-hint` transform.

**And `stickyOffset()` stops reading a bar that is still travelling** — GPT Sol F2. The plan's first
draft called deep-link clearance "free" because the function measures the transformed rect, and that
is only true at rest. Today it returns

```ts
Math.max(safeTop, Math.min(rect.height + safeTop, rect.bottom))
```

— the bar's *current* coverage. `scrollToBlock` calls it **once** and hands the result to `glide()`
as a fixed destination, and `markOurScroll` stops the bar reacting to the jump but does not stop a
CSS transition already running. So a reader who scrolls up (starting the 180ms reveal) and clicks a
gist 90ms later gets a target placed under a bar that is on its way back to covering it.

The replacement asks **where the bar is going**, which is what every caller has always wanted — the
existing comment says so at length, about the top-of-the-article case:

```ts
// Fully out of the way: nothing to clear but the strip `.reader::before` paints.
if (rect.bottom <= safeTop) return safeTop;
// It is here, or it is on its way here. Either way it will be across the top when the jump lands.
return rect.height + safeTop;
```

Three things about that:

- **It agrees with today's expression in every settled state** — stuck (`rect.bottom` is exactly
  `rect.height + safeTop`), unstuck at the top of the article (the `min` already picked the
  prediction), fully hidden (the `max` already picked the floor) — and differs only mid-transition,
  which is the defect. So it is a narrowing, not a new policy.
- **It reads no attribute, and that is deliberate.** `data-bars="hidden"` is *not* the same question
  as "the bar is out of the way": the two `:has()` guards hold the bar down — `--bar-hide: 0px` —
  while the attribute is still set, so a reader in a band mode or tabbing the pills would have had
  every jump land under a bar that is plainly there. Measuring the rect is what makes the guards
  free.
- **Mid-*hide* it now over-reserves by up to 44px**, and that is the right way to be wrong: an
  over-reserved target lands a little lower than it needed to, an under-reserved one lands
  underneath the chrome. Today's code under-reserves.

**The specificity has to survive the move, and it is the one thing here that fails silently.** Both
guards win by being `(0,3,0)` against the attribute rule's `(0,2,0)` — `:has()` takes its most
specific argument — and the comments in `narrow-window.css` record GPT Sol catching a version that
won only by source order on 2026-08-28. `shell.css` is imported *second* and `narrow-window.css`
*near the end*, so a guard that had degraded to a tie would now lose rather than win, and the symptom
would be a bar that slides out from under a keyboard reader — invisible to every test we have. The
stage asserts the computed value, not the selector.

Files: [`scroll.ts`](../../src/web/scroll.ts), [`shell.css`](../../src/web/styles/shell.css),
[`narrow-window.css`](../../src/web/styles/narrow-window.css),
[`tests/spine-width.test.ts`](../../tests/spine-width.test.ts),
[`tests/mobile-chrome.test.ts`](../../tests/mobile-chrome.test.ts).

**Done when** the bar hides at 1440, 1280 and 900 as well as at 390; the Dock does **not** move at
1440; a band mode's bar stands still; `tests/spine-width.test.ts` still ties the CSS breakpoint to
the spine arithmetic; and a deep link lands clear of the bar **at rest and halfway through both the
hide and the reveal** — three cases, red-first against today's `stickyOffset`, which passes the
first and fails the third.

## Stage 3 — the browser pass, and the docs

A pass at 1440×900, 1280×800, 900×800, 390×844 **and 844×390** (the landscape phone, where a panel
and a hiding bar already coexist — F4), in Hierarchy and in Plain and in one band mode,
**measuring rather than eyeballing**:

- `.controls` rect before and after the flip
- each `.ctx-panel`'s `top` against its own `<th>`'s `bottom` — at rest, and **after the reader stops
  scrolling mid-flip**, which is the stranding case and the only one that needs the reader to stop
- **scrolling through 0–159px without `data-bars` changing**, asserting each panel's `top` tracks
  its `<th>` every frame rather than lagging — the case a standing transition would have broken
- after both the hide and the reveal have settled, the unclamped current entry still centred on the
  40% focus line
- `.dock` rect unchanged at 1440
- `data-ctx-lines` unchanged from the baseline above

### What the browser pass found, 2026-09-07

Playwright against system Chrome, dev server from this worktree on 5273 (ownership proved by
`grep -c BAR_MOVE_MAX_MS` on the served source), signed in, `antikythera-mechanism-spya-zhxrzm`.

| width | bar hides / returns | panel vs its `<th>`, at rest | panel vs `<th>`, hidden and still 600ms | 0–150px, every 30px | `data-bar-moving` gone after | `.dock` moved |
|---|---|---|---|---|---|---|
| 1440×900 | yes / yes | **0.00px** (2 panels) | **0.00px** | **0.00px** | yes | **no** |
| 1280×800 | yes / yes | **0.00px** (2) | **0.00px** | **0.00px** | yes | **no** |
| 900×800 | yes / yes | **0.00px** (1) | **0.00px** | **0.00px** | yes | — |
| 844×390 | yes / yes | **0.00px** (1) | **0.00px** | **0.00px** | yes | (hides, as before) |
| 390×844 | yes / yes | no panels at this width | — | — | yes | (hides, as before) |

A band mode (`?mode=summary`, 1440×900) sets `data-bars="hidden"` and `.controls` **does not move** —
`{top: 0, bottom: 44}` before and after — so decision 3's guard holds. Plain hides as intended
(`{top: 202.25}` → `{top: −44}`). The current entry stays on the focus line to within half a pixel
(−0.48 and −0.27). A deep link with the bar hidden lands at −0.078px against a bar bottom of 0 —
clear, and the sub-pixel is `scrollToBlock`'s own fractional rounding rather than anything here.

**A zero delta could equally mean the transition never runs**, so the pass traced every frame rather
than sampling the ends: `data-bar-moving` appears for **5 frames during a hide** (`.controls` top
0 → −43.3 → −44 across +182…+318ms) and 7 during a reveal, and mid-slide the panel deliberately does
*not* track its `<th>` — the head snaps, the panel glides, diverging by up to 10.4px in flight. That
is the design, and checking it was the only way to tell it from a no-op.

**And it weakened one of this plan's claims**, which is recorded rather than quietly fixed: see the
last bullet under § What this deliberately does not do.

### One bug the browser pass could not have found

**`transitionend` bubbles, and `.controls` is full of things that transition.** The first version of
`startMoving` listened for `transitionend` on the bar and took whatever arrived. The granularity
pills are shadcn `Toggle`s carrying `transition-[color,background-color,border-color]` over **120ms**
([`pill.ts`](../../src/web/pill.ts)) — so hovering or pressing one while the bar slides delivers
three of those to `.controls` **60ms before** the bar has finished its own 180ms travel. The
attribute would clear early and every panel would stop dead in the middle of the screen.

Nothing about it is visible without a pointer resting on a pill at the right moment, which is why no
browser pass would have caught it and why the fix is pinned by a unit test that dispatches a
bubbling `background-color` event and asserts the slide survives it. The listener now asks for
`e.target === bar && e.propertyName === "transform"` — both halves, because a descendant's
`transform` would pass the property test on its own.

Docs: [granularity-zoom.md](../project/granularity-zoom.md) § what the bar calls each column,
[touch.md](../project/touch.md) (the hide-on-scroll is no longer a touch fact),
[column-context.md](../project/column-context.md) (the panel's `top` now has a second thing that
moves it), [design-css-overview.md](../project/design-css-overview.md),
[performance.md](../project/performance.md) (a scroll listener on every machine now, which that doc
argued against), [reading-view-overview.md](../project/reading-view-overview.md), and a line in
[260905g](260905g-move-the-wordmark-and-feedback-button-into-the-dock.md) saying what stage 3 there
still buys once this has landed.

**Then mutate the finished code and check the suite notices** — red-first only tests the diff.

## What this deliberately does not do

- **It does not touch the pills.** They are still three toggles in the bar; the bar is just absent
  more of the time.
- **It does not do [260905g](260905g-move-the-wordmark-and-feedback-button-into-the-dock.md) stage
  3.** That is a different change with a different done-condition (`commentError` moves onto the
  Comments button), and it makes the bar *not exist* where this makes it *get out of the way*. The
  two compose; neither needs the other.
- **It does not move the Dock** — decision 1.
- **It does not close the one-frame overlap the browser pass found.** Stage 1 argues that the
  head-settling case and the bar-moving case cannot overlap, because `stepBar` will not hide the bar
  inside the first 160px. That is true of every gesture that arrives frame by frame, and **false of a
  single frame that jumps more than 160px from the top** — a scrollbar drag, a hard fling.
  `scrollTo(0, 400)` from y=0 hides the bar on the same frame the panel is still measured at its
  unsettled 244.5, so the panel glides the whole 244.5 → 0 rather than snapping to 44 and sliding.
  Left alone: the panel arrives in the right place either way, the overshoot is bounded by the
  masthead's height, `markOurScroll` already covers every jump the app itself starts, and the fix
  would be to teach `scroll.ts` whether another module's measurement had settled. **What was wrong
  was the claim, not the behaviour**, so the three places that made it now say what is actually
  true.
