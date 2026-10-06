# UI sweep K1: a leaking error style, focus marks, undefined tokens, small cascade defects

**Status: being built, 2026-10-07.** One cluster of
[the UI sweep umbrella](261007a-ui-sweep-umbrella.md#k1--css-a-leaking-error-style-focus-marks-undefined-tokens-small-cascade-defects),
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
