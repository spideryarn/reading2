# Baseline geometry for the mode band — before A5

The "before" half of a refactor (`260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md`)
that must not change any of the numbers below. Two modes (Search, Chat) × four viewport
conditions, measured with `getBoundingClientRect()` / `getComputedStyle()` in a real (headless)
Chrome, driven by Playwright per
[browser-testing-playwright.md](../project/browser-testing-playwright.md).

- **Base commit:** `6dacbd2e84ff0fd52df91c5464d0911541260dff` (branch `worktree-a5-mode-surface`)
- **Date:** 2026-09-06
- **Chrome:** 152.0.7977.75 (`/usr/bin/google-chrome-stable`, headless, driven via `playwright-core`)
- **Dev server:** started fresh inside this worktree, took port **5277** (5273–5276 were held by
  other agents' worktrees on this box)
- **Article:** `fowler-phrenology` — "Utility of phrenology : a lecture / by L.N. Fowler.", 8,717
  words, 9 parts, 40 sections; had an existing chat thread and an existing saved search from prior
  browser passes, both reused below
- **Signed in as:** `dev-admin@spideryarn.local`

## Method

- One Playwright script (`playwright-core` + `scripts/browser-sign-in.ts`'s `signIn`), one browser
  context, sequential navigations — `page.goto('/read/fowler-phrenology?mode=<search|chat>')` fresh
  for each of the 8 (mode × condition) cases, so state (matcher, conversation) never leaks between
  conditions.
- **Search**: switched the matcher to **words** (the `srch-mode[aria-checked="false"]` toggle) and
  typed `phrenology` into the query box. Words mode is instant and free — no model call. (The
  default matcher is **meaning**, which needs a paid "find" click; left untouched here.) This
  produced "45 passages" in every condition.
- **Chat**: waited ~1.2s for the thread list to load, then reused the article's one **existing**
  conversation ("About block dfqq59: Evidence-gathering test chat message.") by clicking it in the
  thread list — so `.chat-scroll` and `.chat-composer` are both mounted, per the brief. No new
  conversation was started and no model call was made.
- Condition **D** set `document.documentElement.style.fontSize = "24px"` after navigation and
  before measuring, then waited 300ms for reflow.
- All screenshots use `animations: "disabled"`.
- Screenshots (absolute paths, in the scratchpad, not the repo):
  - `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/mode-band-search-A_390x844.png`
  - `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/mode-band-search-B_844x390.png`
  - `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/mode-band-search-C_1280x720.png`
  - `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/mode-band-search-D_390x844_24px.png`
  - `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/mode-band-chat-A_390x844.png`
  - `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/mode-band-chat-B_844x390.png`
  - `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/mode-band-chat-C_1280x720.png`
  - `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/mode-band-chat-D_390x844_24px.png`
  - The measurement script itself:
    `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/measure-mode-band.ts`,
    and its raw JSON output:
    `/tmp/claude-1000/-home-greg-code-spideryarn2/76667309-a22a-477c-af3b-4f16d1ce0cf0/scratchpad/results.json`

`--mode-w` and `--spine-w` are set inline on **`.reader`**, not on `:root`
(`src/web/styles.css` line 298 and `src/web/App.tsx` ~line 2881), so reading them from
`document.documentElement` — as the brief asked — comes back as the **empty string** in every
condition below. I have recorded that empty reading faithfully in `cssVars`, and *also* read the
same two properties from `.reader` itself (`readerCssVars`), so the actual numbers are not lost.

## Shared per-condition facts

These four are identical for Search and Chat at the same viewport (the band's box, the reader's
fit, and the root tokens do not depend on which mode is open):

| Condition | window (innerW × innerH) | `.reader.band-covers`? | `--mode-w` (on `.reader`) | `--spine-w` (on `.reader`) | `--bar-bottom` | `--dock-bottom` | `--hint-h` | `--safe-bottom` |
|---|---|---|---|---|---|---|---|---|
| A 390×844 | 390 × 844 | **yes** | `0px` | `12px` | `calc(2.75rem + 0px)` | `calc(2.5rem + 0px)` | `0px` | `0px` |
| B 844×390 | 844 × 390 | no | `288px` | `12px` | `calc(2.75rem + 0px)` | `calc(2.5rem + 0px)` | `0px` | `0px` |
| C 1280×720 | 1280 × 720 | no | `400px` | `12px` | `calc(2.75rem + 0px)` | `calc(2.5rem + 0px)` | `0px` | `0px` |
| D 390×844, 24px root | 390 × 844 | **yes** | `0px` | `12px` | `calc(2.75rem + 0px)` | `calc(2.5rem + 0px)` | `0px` | `0px` |

`--bar-bottom` / `--dock-bottom` / `--hint-h` / `--safe-bottom` read as the same **unresolved**
text (a `calc()` with `rem` units, or a literal `0px`) in every condition — a custom property's
computed value is the substituted token list, not a length resolved against the current root font
size, so this is expected and not evidence that D's larger root font failed to take effect (it
plainly did: see the band heights below, and the `y` origin shifting from 44 to 66).

`--safe-bottom` and `--hint-h` are `0px` throughout, consistent with
[browser-testing-playwright.md § The insets are zero here](../project/browser-testing-playwright.md#the-insets-are-zero-here-and-a-phones-are-not) —
headless Chrome on this box has no notch, so `env(safe-area-inset-*)` is always the identity term.

## Search mode

### A — 390 x 844

| | x | y | width | height | bottom |
|---|---|---|---|---|---|
| **band** (`aside.mode-band.srch`) | 12 | 44 | 378 | 760 | 804 |

| # | className | x | y | width | height | `flex` | `min-height` | `overflow-y` | `max-height` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `srch-box` | 12 | 44 | 378 | 83.812 | `0 1 auto` | `auto` | `visible` | `none` |
| 2 | `srch-sort` | 12 | 127.812 | 378 | 34.359 | `0 1 auto` | `auto` | `visible` | `none` |
| 3 | `srch-legend` | 12 | 162.172 | 378 | 28.625 | `0 1 auto` | `auto` | `visible` | `none` |
| 4 | `srch-hits` | 12 | 190.797 | 378 | 613.203 | `1 1 0%` | `auto` | `auto` | `none` |

**Sum of children heights: 760 vs band height 760 -- fits exactly.** Last child bottom 804 vs band bottom 804 -- does not exceed it.

### B — 844 x 390

| | x | y | width | height | bottom |
|---|---|---|---|---|---|
| **band** (`aside.mode-band.srch`) | 12 | 44 | 288 | 306 | 350 |

| # | className | x | y | width | height | `flex` | `min-height` | `overflow-y` | `max-height` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `srch-box` | 12 | 44 | 287 | 83.812 | `0 1 auto` | `auto` | `visible` | `none` |
| 2 | `srch-sort` | 12 | 127.812 | 287 | 34.359 | `0 1 auto` | `auto` | `visible` | `none` |
| 3 | `srch-legend` | 12 | 162.172 | 287 | 28.625 | `0 1 auto` | `auto` | `visible` | `none` |
| 4 | `srch-hits` | 12 | 190.797 | 287 | 159.203 | `1 1 0%` | `auto` | `auto` | `none` |

**Sum of children heights: 306 vs band height 306 -- fits exactly.** Last child bottom 350 vs band bottom 350 -- does not exceed it.

### C — 1280 x 720

| | x | y | width | height | bottom |
|---|---|---|---|---|---|
| **band** (`aside.mode-band.srch`) | 12 | 44 | 400 | 636 | 680 |

| # | className | x | y | width | height | `flex` | `min-height` | `overflow-y` | `max-height` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `srch-box` | 12 | 44 | 399 | 83.812 | `0 1 auto` | `auto` | `visible` | `none` |
| 2 | `srch-sort` | 12 | 127.812 | 399 | 34.359 | `0 1 auto` | `auto` | `visible` | `none` |
| 3 | `srch-legend` | 12 | 162.172 | 399 | 28.625 | `0 1 auto` | `auto` | `visible` | `none` |
| 4 | `srch-hits` | 12 | 190.797 | 399 | 489.203 | `1 1 0%` | `auto` | `auto` | `none` |

**Sum of children heights: 636 vs band height 636 -- fits exactly.** Last child bottom 680 vs band bottom 680 -- does not exceed it.

### D — 390 x 844, root font-size 24px

| | x | y | width | height | bottom |
|---|---|---|---|---|---|
| **band** (`aside.mode-band.srch`) | 12 | 66 | 378 | 718 | 784 |

| # | className | x | y | width | height | `flex` | `min-height` | `overflow-y` | `max-height` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `srch-box` | 12 | 66 | 378 | 123.734 | `0 1 auto` | `auto` | `visible` | `none` |
| 2 | `srch-sort` | 12 | 189.734 | 378 | 51.062 | `0 1 auto` | `auto` | `visible` | `none` |
| 3 | `srch-legend` | 12 | 240.797 | 378 | 42.453 | `0 1 auto` | `auto` | `visible` | `none` |
| 4 | `srch-hits` | 12 | 283.25 | 378 | 500.75 | `1 1 0%` | `auto` | `auto` | `none` |

**Sum of children heights: 718 vs band height 718 -- fits exactly.** Last child bottom 784 vs band bottom 784 -- does not exceed it.

## Chat mode

Every case below is the **open-conversation** shape (an existing thread, opened): `.band-head`, `.chat-scroll`, an `sr-only` live-region paragraph, `.chat-composer`.

### A — 390 x 844

| | x | y | width | height | bottom |
|---|---|---|---|---|---|
| **band** (`aside.mode-band.chat`) | 12 | 44 | 378 | 760 | 804 |

| # | className | x | y | width | height | `flex` | `min-height` | `overflow-y` | `max-height` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `band-head` | 12 | 44 | 378 | 42.906 | `0 0 auto` | `auto` | `visible` | `none` |
| 2 | `chat-scroll` | 12 | 86.906 | 378 | 634.297 | `1 1 0%` | `0px` | `auto` | `none` |
| 3 | `sr-only` | 11 | 43 | 1 | 1 | `0 1 auto` | `0px` | `hidden` | `none` |
| 4 | `chat-composer` | 12 | 721.203 | 378 | 82.797 | `0 1 auto` | `auto` | `visible` | `none` |

**Sum of children heights: 761 vs band height 760 -- reads 761 against band height 760.** Last child bottom 804 vs band bottom 804 -- does not exceed it.

### B — 844 x 390

| | x | y | width | height | bottom |
|---|---|---|---|---|---|
| **band** (`aside.mode-band.chat`) | 12 | 44 | 288 | 306 | 350 |

| # | className | x | y | width | height | `flex` | `min-height` | `overflow-y` | `max-height` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `band-head` | 12 | 44 | 287 | 42.906 | `0 0 auto` | `auto` | `visible` | `none` |
| 2 | `chat-scroll` | 12 | 86.906 | 287 | 147.516 | `1 1 0%` | `0px` | `auto` | `none` |
| 3 | `sr-only` | 11 | 43 | 1 | 1 | `0 1 auto` | `0px` | `hidden` | `none` |
| 4 | `chat-composer` | 12 | 234.422 | 287 | 115.578 | `0 1 auto` | `auto` | `visible` | `none` |

**Sum of children heights: 307 vs band height 306 -- reads 307 against band height 306.** Last child bottom 350 vs band bottom 350 -- does not exceed it.

### C — 1280 x 720

| | x | y | width | height | bottom |
|---|---|---|---|---|---|
| **band** (`aside.mode-band.chat`) | 12 | 44 | 400 | 636 | 680 |

| # | className | x | y | width | height | `flex` | `min-height` | `overflow-y` | `max-height` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `band-head` | 12 | 44 | 399 | 42.906 | `0 0 auto` | `auto` | `visible` | `none` |
| 2 | `chat-scroll` | 12 | 86.906 | 399 | 510.297 | `1 1 0%` | `0px` | `auto` | `none` |
| 3 | `sr-only` | 11 | 43 | 1 | 1 | `0 1 auto` | `0px` | `hidden` | `none` |
| 4 | `chat-composer` | 12 | 597.203 | 399 | 82.797 | `0 1 auto` | `auto` | `visible` | `none` |

**Sum of children heights: 637 vs band height 636 -- reads 637 against band height 636.** Last child bottom 680 vs band bottom 680 -- does not exceed it.

### D — 390 x 844, root font-size 24px

| | x | y | width | height | bottom |
|---|---|---|---|---|---|
| **band** (`aside.mode-band.chat`) | 12 | 66 | 378 | 718 | 784 |

| # | className | x | y | width | height | `flex` | `min-height` | `overflow-y` | `max-height` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `band-head` | 12 | 66 | 378 | 63.812 | `0 0 auto` | `auto` | `visible` | `none` |
| 2 | `chat-scroll` | 12 | 129.812 | 378 | 450.266 | `1 1 0%` | `0px` | `auto` | `none` |
| 3 | `sr-only` | 11 | 65 | 1 | 1 | `0 1 auto` | `0px` | `hidden` | `none` |
| 4 | `chat-composer` | 12 | 580.078 | 378 | 203.922 | `0 1 auto` | `auto` | `visible` | `none` |

**Sum of children heights: 719 vs band height 718 -- reads 719 against band height 718.** Last child bottom 784 vs band bottom 784 -- does not exceed it.

## What looked wrong (or worth flagging for the "after" comparison)

- **The naive "sum of children" check over-counts by exactly 1px in every Chat case, and it is
  not a real overflow.** The band's fourth DOM child, an `sr-only` `<p>` (the chat live-region
  announcer), is positioned at `y ≈ band-top − 1px`, `height 1px` — i.e. **outside and above** the
  band's own content box, the classic visually-hidden pattern (`position: absolute`, 1×1px,
  clipped, pulled up by a `margin: -1px`). Because it is taken out of flow, it does not consume any
  of the band's flex space — the three real flex children (`band-head` + `chat-scroll` +
  `chat-composer`) sum to *exactly* the band height in all four Chat conditions — but a naive
  `sum(children.heights)` still counts its 1px, so the raw check as specified reads 761/307/637/719
  against band heights of 760/306/636/718. **`lastChildBottom` never exceeds `band.bottom`** in any
  of the eight cases, which is the sharper and correct check. Whoever writes the "after" comparison
  should either skip out-of-flow / visually-hidden children when summing, or compare against
  `lastChild.bottom` instead of a height sum — otherwise a refactor that changes nothing real will
  register as a 1px regression by this metric alone, and (the more important risk) a refactor that
  *removes* the `sr-only` element would make the "sum" check start passing while having changed
  nothing about the layout that matters.
- **Search fits exactly, with zero slack, in all four conditions** — sum of children heights equals
  band height to the fraction of a pixel, in every condition, including the cramped 306px-tall band
  at 844×390. There is no headroom here; if the "after" surface adds even a hairline of padding to
  `.mode-band`, Search's `srch-hits` scroller (which is `flex: 1 1 0%`) will simply be 1px shorter
  to compensate — Search self-adjusts because its scroller is the flexible term. Chat's scroller
  (`chat-scroll`) is the same shape (`flex: 1 1 0%`), so it should behave the same way.
- **`--mode-w` and `--spine-w` are not on `document.documentElement`** — they are set inline on
  `.reader` (`src/web/App.tsx` ~2881, `src/web/styles.css` line 298 / `.reader.spine-on` /
  `.reader.spine-off`). Reading them off `documentElement` as literally asked returns `""` in every
  condition; I recorded that faithfully and also captured the real values from `.reader` (see the
  shared-facts table). Worth knowing before the "after" pass reuses this same check — it will read
  the same empty string unless the refactor happens to move these variables onto the root.
- **`--bar-bottom`, `--dock-bottom`, `--hint-h`, `--safe-bottom` on `documentElement` read as
  unresolved text** (`calc(2.75rem + 0px)`, `calc(2.5rem + 0px)`, `0px`, `0px`), identically across
  all four conditions including the 24px-root case. This is expected — a custom property's computed
  value is the substituted token list, not a resolved length — but it means these four numbers are
  **not useful on their own** for detecting a keyboard-inset regression; the band's actual
  `getBoundingClientRect()` (which *does* reflect the resolved rem) is the number that matters, and
  it is what changes correctly between A and D above (band top moves from y=44 to y=66, height from
  760 to 718).
- **`--safe-bottom` and `--hint-h` are `0px` throughout**, as documented — this box's headless
  Chrome has no notch, so this baseline says nothing about the `env(safe-area-inset-*)` path; see
  `docs/project/browser-testing-playwright.md` and the postmortem it cites
  (`docs/postmortems/260903f-the-mode-band-stopped-short-of-the-notch.md`) for why that specific
  path needs a different check (`scripts/safe-area-check.ts`), not this one.
- **Nothing else looked wrong.** All eight screenshots render the expected content (Search: 45
  "phrenology" passages, highlighted in the prose too; Chat: the existing "Evidence-gathering test
  chat message" conversation, with its composer and mic/live-mode controls all visible), `band-covers`
  flips true/false exactly where `--mode-w` on `.reader` goes to `0px` (A and D, the two 390px-wide
  conditions), and no child's bottom edge ever exceeds the band's bottom edge in any of the eight
  cases.
