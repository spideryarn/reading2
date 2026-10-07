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
