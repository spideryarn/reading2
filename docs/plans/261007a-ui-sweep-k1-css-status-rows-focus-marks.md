# UI sweep K1: a leaking error style, focus marks, undefined tokens, small cascade defects

**Status: being built, 2026-10-07.** One cluster of
[the UI sweep umbrella](261007a-ui-sweep-umbrella.md#k1-css-a-leaking-error-style-focus-marks-undefined-tokens-small-cascade-defects),
which is the plan and was reviewed by GPT Sol before anything was built. This doc records what
landed, what was measured, what in the umbrella turned out false, and what was left.

Three commits: status rows; focus marks; the rest. One GPT Sol code review over all three.

## How it was measured

One script, run against a dev server started from this worktree, before any edit and again after:
headless system Chrome through Playwright, signed in as the seeded administrator, both themes, at
1440, 820, 600 and 390 wide (390 once with a finger and once with a mouse). It reads computed
styles; it presses nothing that runs a model.

- **Contrast** is WCAG 2 contrast between two colours as Chrome paints them: each colour is drawn
  to a one-pixel canvas and read back as sRGB bytes, so an `oklch()` outside the sRGB gamut is
  measured as the clipped colour a reader on an ordinary screen sees. Opacity is composited over
  the surface before the ratio is taken.
- **The two status rows** are the markup `ChatPanel.tsx` and `Dock.tsx` emit, injected (the chat
  row into the real Chat band, the dock row into `<body>`), because a real failed tool or a failed
  question needs a model call.
- **A focus mark** is read after a real `Tab`: the script focuses the control only to find its place
  in the order, then a real `Shift+Tab` leaves it and a real `Tab` returns, and the element must
  match `:focus-visible`.

The script and its raw output are kept beside this doc:
[the script](261007a-ui-sweep-k1-measure.ts.txt), [its helpers](261007a-ui-sweep-k1-measure-lib.ts.txt),
[before](261007a-ui-sweep-k1-measure-before.json) and [after](261007a-ui-sweep-k1-measure-after.json).
The script grew while the work went on, so the *before* file lacks three things the *after* file
has: the headings at 390, the live and `aria-disabled` hover, and Metadata's box. The hover's
before was taken in a later run, ahead of its edit, and is quoted below. The other two have no
before of their own: the same rules were measured before at 1440.

## 1. Status rows

### The `.error` leak

`shell.css` had `.loading, .error { padding: 3rem; color: var(--ink-soft); font-family:
var(--font-mono); font-size: 13px; white-space: pre-wrap }`. Re-found by content; the four bare
emitters are as the umbrella lists them (`pre.error` in `ArticlePage.tsx`, `div.loading` in
`LogoLoader.tsx`, `li.chat-tool.error` in `ChatPanel.tsx`, `span.dock-question-state.${status}` in
`Dock.tsx`), and a grep for `classList` and template-built class names found no fifth.

The rule is now `.loading, pre.error`. Measured, the same in both themes except the colours:

| | Before | After |
|---|---|---|
| **Failed chat tool row** (`li.chat-tool.error`) | padding 48px on all four sides; Geist Mono 13px; `pre-wrap`; `--ink-soft`; 543 by 114.8px | padding 0; Geist (the UI face) 13.28px; `normal`; `--ink-faint`; 543 by 19.3px, which is exactly what an ordinary `li.chat-tool` measures |
| Its detail (`.chat-tool-detail`) | inherits Mono 13px and `pre-wrap`; raw orange `rgb(219, 138, 69)` at opacity 0.7 | Geist 13.28px, `normal`; `--danger` at opacity 1 |
| **Failed dock question line** (`span.dock-question-state.error`) | padding 48px on all four sides; `pre-wrap`; 11.84px Geist (its own rule already won the face and size); raw orange; 112.6px tall | padding 0; `normal`; 11.84px Geist; `--danger`; 16.6px tall, the same as an ordinary line |
| `pre.error`, `div.loading` | padding 48px, Mono 13px, `pre-wrap`, `--ink-soft` | unchanged |

So besides the padding the chat row loses the mono face, the 13px size and `pre-wrap`, **and its
label goes from `--ink-soft` to `--ink-faint`**: the leak's `color` had been making a failed row's
label brighter than its neighbours'. The dock line loses the padding and `pre-wrap` only.

### `--danger`

Defined nowhere before; `var(--danger, var(--highlight))` drew the word in the brand orange. The
candidates were `oklch(L 0.2 27.325)`, the hue and chroma of `--destructive`, for every L from 0.40
to 0.85 in steps of 0.01, measured against the resolved `--page`, `--panel` and `--surface-raised`
in each theme.

| | `--page` | `--panel` | `--surface-raised` |
|---|---:|---:|---:|
| Dark, before: raw orange, chat detail at 0.7 | 4.03 | 3.91 | 3.52 |
| Dark, before: raw orange, dock line | 7.29 | 6.78 | 5.72 |
| Dark, `--destructive` `oklch(0.65 …)` at full opacity | 5.58 | 5.19 | **4.37** |
| Dark, the lowest L that passes all three, 0.66 | 5.80 | 5.39 | 4.54 |
| **Dark, chosen: `oklch(0.7 0.2 27.325)`** | **6.65** | **6.19** | **5.22** |
| Light, before: raw orange, chat detail at 0.7 | 1.92 | 1.84 | 1.97 |
| Light, before: raw orange, dock line | 2.60 | 2.43 | 2.72 |
| Light, `--destructive` `oklch(0.55 …)` at full opacity | 5.16 | 4.81 | 5.39 |
| Light, the highest L that passes all three, 0.56 | 4.94 | 4.60 | 5.15 |
| **Light, chosen: `oklch(0.52 0.2 27.325)`** | **5.83** | **5.44** | **6.09** |

Each is a few steps inside the bar and not on it: 0.66 passes Dark by 0.04, which a different
screen or a rounding would lose. Dark's value is outside sRGB and Chrome paints it as
`rgb(255, 96, 85)`; that clipped colour is what was measured.

In light, the failure was the worse one: a failed row's word was the brand orange on white, 2.6:1
at best.

`.chat-tool.error .chat-tool-detail` now sets `opacity: 1`; the ordinary `.chat-tool-detail` keeps
its 0.7. `--destructive` is not changed. `/design` lists `--danger` beside `--destructive` under
*States*. `tests/appearance-palette.test.ts` gained three pairs, `--danger` on each surface at
4.5:1, checked in both themes.

Red, then green: with the two rows reading `var(--danger)` and the token not yet defined,
`tests/css-tokens.test.ts` failed twice ("defined in no stylesheet") and the three new palette
pairs failed in both themes ("--danger is not defined"); all pass with the token in both blocks.

### `--ink-faintest`, the dead fallbacks, the false comment

- `--ink-faintest` (two uses: `.dock-btn.soon`, `.diag-opt-label`) is defined nowhere, so its
  fallback `--ink-faint` is what has always rendered. Both now say `--ink-faint`. Computed colour
  before and after: `oklch(0.63 0 0)` dark, `oklch(0.48 0 0)` light.
- The six `var(--destructive, oklch(0.65 0.2 25))` fallbacks (three in `search.css`, two in
  `mode-band.css`, one in `dock.css`) are bare `var(--destructive)`. Computed before and after on
  four of them: `oklch(0.65 0.2 27.325)` dark, `oklch(0.55 0.2 27.325)` light. The comment in
  `dock.css` that explained the habit now says when it went.
- `diagram-sketch.css` said `--destructive` is something "this stylesheet references six times and
  defines nowhere". Both halves are false (it is defined in `styles/tokens.css`, and that sheet
  does not reference it at all); the sentence is gone and the reason it gave for the grey stays.

## 2. Focus marks

The umbrella's rule: keep each control's geometry and change only what makes the mark invisible.
Every row was measured after a real Tab, with the control matching `:focus-visible`. The ratio is
the mark's colour against the surface behind it.

| Control | Before | After | Geometry |
|---|---|---|---|
| `.prof-box-input` on /profile | 1px border, raw `--highlight`: 5.72 dark, **2.72 light** | 1px border, `--highlight-text`: 5.72 dark (the two tokens are the same colour there), **5.95 light** | unchanged; outline still off |
| `.outln-row.focused` (Structure's nested list, at 820 and 600 wide) | inset 2px shadow, raw `--highlight`: 5.81 dark, **2.19 light** | inset 2px shadow, `--highlight-text`: 5.81 dark, **4.81 light** | unchanged. The row carries `focused` with no keyboard focus in the list (measured: `document.activeElement` is elsewhere), so a mouse reader sees the new colour too, as the umbrella says |
| Marginalia: `.marg-idea`, `.marg-arc`, `.marg-relation`, `.marg-shut-button` | 2px outline, offset 2px, `--rule-strong`: **1.82 dark, 1.92 light** | same outline in `--highlight-text`: 7.29 dark, 5.70 light | unchanged |
| `.chat-card-shut` | 2px outline, offset −2px, `--rule-strong`: **1.43 dark, 2.01 light** | same outline in `--highlight-text`: 5.72 dark, 5.95 light | unchanged; still inset |
| Collapsible headings (`PageSection.tsx`), first and last on /profile and on `/read/fowler-phrenology/metadata` | outline `none`; the text turns `--highlight-text` and that is the whole mark | 2px outline, offset 2px, `--highlight-text` (7.29 dark, 5.70 light), and the text still turns | the button's box is unchanged (100 by 14px); **no ancestor clips the mark** on either page, at 1440 or at 390 |

Notes on what was and was not reached:

- **Marginalia has five such buttons, not four.** `.marg-shut-button` carried the identical rule
  and is fixed with the others. `.marg-question` shares one rule shape with them and is changed,
  but no fixture has a margin question, so it was not measured; the others were.
- **The marginalia offset stays at 2px.** At a 12px root the closest two of these buttons are 6px
  apart (8px at 16px). One mark is 4px deep (2px offset and 2px line), so a focused button's mark
  stops 2px short of its neighbour, and only one button is focused at a time, so two marks never
  meet. Measured on two articles, 21 and 27 buttons: no pair is closer than one mark.
- **`.chat-card-shut` was measured on injected markup** (the button `ChatDialog.tsx` emits, inside
  a `.chat-dialog`), reached by a real Tab: the real one needs a conversation with an answer.
- **`.prof-box-input` has two emitters**, `ProfileBox.tsx` (on /profile, Metadata, the profile
  panel and the purpose prompt) and the Add page's purpose box. Measured on /profile at 1440 and on
  Metadata's box at 390: the same 5.72 dark and 5.95 light. The Add page draws its box only while
  an import is running, which costs a model call, so it was not opened; it is the same class with
  no focus rule of its own.

A check was added, because the baseline is clean now and only now:
`tests/css-tokens.test.ts` § *no outline is drawn in a surface or hairline token*. It reuses that
file's own resolver. Seen red by putting `--rule-strong` back on `.chat-card-shut`.

## 3. The rest

| Item | Before | After |
|---|---|---|
| **Full-screen Sketch re-truncates the open chip.** `.sk-in-full .sk-scene { max-width: 20rem }` ties `.sk-scene.on` on specificity and comes later | open chip in full screen: `max-width: 320px`; a long title is cut at 320px | `.sk-in-full .sk-scene:not(.on)`: the open chip is `max-width: none` and a long title is whole (807px on the test string); a closed chip is still capped at 320px |
| **`.gloss-btn:hover` lights a disabled button** | a `disabled` button under a real pointer: border `--highlight`, text `--ink` | border and text as at rest. A live button still lights |
| **`.tooltip.tip-cite` and `.tip-hit` drop the viewport cap** | `max-width: 416px` in a 390px window | `min(26rem, calc(100vw - 1.75rem))`: 362px at 390 |
| **The no-zoom floor is `1rem`** | at a 12px root on a touch screen, `.srch-input` is 12px | `max(1rem, 16px)`: 16px at a 12px root, 16px at 16, 20px at 20 |
| `.quotes-hint`'s two `!important`s | `--ink-faint`, 13.44px | `.quotes-empty .quotes-hint`, no `!important`: the same `--ink-faint`, 13.44px |
| `feedback.css` mixes `in oklch` | pressed pill ground paints `rgba(222, 140, 66, 0.12)` | `in oklab`: paints the same `rgba(222, 140, 66, 0.12)` |

- **The Sketch chip on a real Sketch.** `fowler-phrenology` and `writes` have a stored Sketch.
  Opened full screen with *Enlarge* (not a model call) at 1440 and at 390: the open chip's
  computed `max-width` goes from `320px` to `none`. Its real title is 250px wide, so nothing was
  being cut on this fixture; the cut was shown on injected markup with a long title.
- **The tooltip at 390, on a real card.** A block link in FAQ mode on `vb-spya-vu3xen`, hovered at
  390 wide: before, the card was 375px wide, from 10px to 385px, which is the whole width the
  layout had (this Chrome draws a 15px scrollbar gutter), 5px from the right edge. After: 362px,
  from 10px to 372px. So **the umbrella's hypothesis of an overflow is false as "off screen"**: the
  floating layer already stops the card at the layout's width. What the bare `26rem` did is what
  the base rule's comment warns of, the card becoming the whole of a narrow window. On a phone,
  with no scrollbar gutter, that is edge to edge. `.tip-hit` is the card on a search hit. Two
  fixtures have saved searches, but none shows a hit until one is ticked, and a tick may run a
  search, so it was not pressed; that card was measured as bare markup only.
- **`.gloss-btn` and `aria-disabled`, which the umbrella does not name.** Citations' *Investigate*
  is turned off with `aria-disabled="true"` so it keeps its tooltip (`citations.css`), and it lit
  under the pointer in exactly the same way. The guard covers both spellings, as `.chat-icon`'s
  does. Measured before and after like the `disabled` case.
- **The no-zoom floor does not reach Tailwind-classed fields**, as the umbrella's § After the
  clusters already says: `tw:any-pointer-coarse:text-base` is `1rem` in the utilities layer, which
  outranks this rule. The comment beside the rule now says so. `tests/touch-controls.test.ts` asks
  for `max(1rem, 16px)` by name; seen red against `1rem`.
- **Three false comments**, each re-found and corrected to what is true: `src/web/styles/tokens.css`
  "the app is dark only" (the light washes are at the foot of the same file); `styles/tokens.css`
  "custom properties are unaffected by layering" (they cascade like any declaration, layers
  included); and "a THIRD" beside `--block-pad: calc(var(--rhythm) / 4)` (a quarter since
  2026-08-28, by the comment on `--block-pad` itself).

## What in the umbrella was false, or less than it said

- **"Marginalia's four buttons"**: five. `.marg-shut-button` has the same rule.
- **"At a 12px root two neighbours' marks can touch (6px gap, 8px of marks)"**: the 6px gap is
  right, but only one button is focused at a time, so the sum of two marks is never drawn. One
  mark is 4px. The offset is unchanged.
- **The tooltip "overflow" (marked H)**: not off screen; see above. The cap is restored because the
  measured card filled the layout's whole width.
- **`diagram-sketch.css` "references `--destructive` six times"** (the comment's own claim, which
  the umbrella repeats as the comment to remove): it references it nowhere.
- **`.prof-box-input`, `.outln-row.focused`, the headings in Dark**: no defect there. In Dark
  `--highlight` and `--highlight-text` are one colour (5.7:1 or better), so those three changes
  show only in Light.

## Left, and why

- **`design-css-overview.md` does not mention `--danger`.** It is an entry-point doc whose wording
  is a rule, so an edit needs Greg's approval one set at a time. The token's comment in
  `styles/tokens.css` is its home.
- **The ordinary chat tool detail is `--ink-faint` at opacity 0.7**: 3.2:1 on the band and 2.9:1
  on the raised dialog in Dark, 3.1 and 3.3 in Light. Measured in passing. The umbrella says to
  leave the ordinary detail's opacity alone, and it is the same question as "Faint text" in § For
  Greg, question 3.
- **`.marg-question` and `.tip-hit` on a real page**, and the Add page's purpose box: no fixture
  reaches them without pressing something that may run a model. Each shares a rule with something
  that was measured.
