# A headings breadcrumb at the top of the reading view

Report `spya-m3pteb` (suggestion, 2026-09-29), from Greg, queue item `qi-n2fhp27k`:

> I sometimes feel as though I lose track of where I am. The structure mode helps a lot, but then I
> have to have it open. I'm wondering whether we could add a thin horizontal breadcrumb of some kind
> at the top of the reading view. Let's make it always present if experimental features are turned
> on, and invisible if not, because it is an experimental feature. And it could be multiple lines,
> with each line being, you know, one of the heading levels or something, as always, tooltips, etc.
> […] the trade-offs are that it's easy to see at a glance where I am, and that it doesn't take up
> too much space. And there are probably other objectives too, use your judgment.
>
> — Greg, 2026-09-29

## What others do (Sonnet's web research, 2026-10-02)

- **VS Code breadcrumbs** — one thin line, a clickable path down to the cursor's symbol.
- **VS Code sticky scroll** — the enclosing scopes stack as separate lines (up to 5 by default) at
  the top; the "headings merge into the bar" effect Greg remembers. One line per level, so the
  height changes with depth.
- **Wikipedia Vector 2022 sticky header** — one persistent bar naming only the current section.
  They tested a show-on-scroll-up variant and made it persistent.
- **Obsidian plugins** — all three shapes exist (stacked sticky headings, a breadcrumb strip, a
  margin TOC that highlights the path).
- **Docs sites (tocbot and friends)** — highlight the current heading in a side TOC; nothing at the
  top. That is what Structure already is here.

Libraries: tocbot (MIT, ~4 KB) builds its own TOC DOM from `<h*>` elements, which is the wrong
shape for a page whose sections are table rows we already measure. **Hand-rolled**, on the machinery
already here. Pitfalls named: measure against a reading line, not the top edge; set state only when
the answer changes; truncate ancestors before the leaf; `nav` + `aria-current`, and no live region
(it would announce on every scroll).

## What gets built (v1)

**One line, in the existing sticky controls bar, for a reader with Experimental features on.**

```
┌ spine ┬────────────────────────────────────────────────────────────┐
│       │ 2 The evidence  ›  2.3 What the trials found               │  ← .controls, 44px
│       ├────────────────────────────────────────────────────────────┤
│       │ …prose…                                                    │
```

- **The path** is the tree Structure draws (`buildSummaryTree`), walked from the root to the section
  under the focus line — part, then section, then any level between, down to `sectionDepth`, never
  a paragraph. Numbers and titles exactly as Structure shows them (`number`, `nodeLabel`), in their
  voice's face ([fonts.md](../project/fonts.md)). A pure function, `crumbPath`, so it is tested
  without a DOM.
- **Where the reader is** comes from `useColumnContext` — the same sampler, the same 40% focus line
  and the same fold rule as Structure's "you are here", so the bar and an open Structure band cannot
  disagree.
- **Each crumb is a button** that jumps to the first block of its node through the reader's
  `jumpTo`, and carries the rich tooltip (`Tooltip`): its number, title and gist. Native `title` is
  not used ([tooltips.md](../project/tooltips.md) § Prefer the rich card).
- **Space**: one line; ancestors shrink with an ellipsis before the current section does, and the
  full text is in each tooltip.
- **`<nav aria-label="Where you are">`** with an ordered list, the last crumb `aria-current="location"`,
  no `aria-live`.

### Why the controls bar, and the simpler option passed over

The bar already does everything a strip at the top needs and nothing new has to learn about it:
`stickyOffset()` measures its bottom, so every jump, `?at=` and arrow key clears it; `--bar-bottom`
moves the table head and the band below it; and since 2026-09-08 it is drawn only when it has
content (`showBar`). So the change is `showBar = owner === null || showCrumbs`, and the breadcrumb
is the content.

**Passed over: a separate fixed strip** of its own (thinner, say 28px). It would need `scroll.ts`,
the `--bar-bottom` ladder in shell.css and the table head all taught about a second piece of chrome
— the code whose comments are mostly a list of the times that went wrong. **Passed over too: a
thinner bar** by overriding `--bar-h` when it holds only the breadcrumb, because the dock and the
feedback button read `--bar-h` from the root for their own heights. 44px is the cost of reusing it;
named here so Greg decides it.

### Two rules the bar needs

1. **It does not slide away while you read.** The bar normally hides on a forward scroll
   (shell.css § the bar that leaves while you read). Greg asked for *always present*, and a position
   you can see only when scrolling back is not at-a-glance. So the breadcrumb joins the existing
   guard, `:root:has(BAR):has(BAR:focus-within, …)`, as `BAR > .crumbs`; the guard's specificity
   is unchanged (its most specific argument is still `.controls:focus-within`).
2. **Not where a band covers the prose.** On a narrow window an open mode takes the whole screen
   (`band-covers`, `fit.modeW === 0`); there is no prose under the bar to be "in", and the guard would
   pin 44px over the band. `showCrumbs = experimental.on && !(bandOpen && fit.modeW === 0)`. Side by
   side, the bar sits over the prose column only, as a visitor's already does.

Signed-out readers never have the switch on (experimental-features.md § The four rules), so a
visitor's bar is unchanged. A signed-in non-owner with the switch on gets the chip and the crumbs.

## Deferred, with a queue entry

- **One line per heading level (VS Code sticky scroll).** Greg floated it; the research is against
  it as a default — the height changes with depth, which is a jolt every time a section starts, and
  it eats the reading area on a phone. A tap-to-expand of the single line into the stacked path is
  the cheap way to get both, later, if the line proves too terse.
- **A thinner bar** than 44px (above).

## Docs

- [experimental-features.md](../project/experimental-features.md) § What is behind it today — a
  paragraph for the breadcrumb.
- [reading-view-overview.md](../project/reading-view-overview.md) — a line saying the bar now holds
  the breadcrumb for the switch's readers. No new project doc: one paragraph in each of those two is
  the whole of it.

## Tests

- `crumbPath`: part › section on a normal tree; the apparatus as one crumb; a row before the first
  section; a deeper tree stops at `sectionDepth`.
- The component: renders nothing with the switch off; renders the path and `aria-current` with it
  on; a press calls `onJump` with the node's first block id.

## Reviews

**GPT Sol, plan review** (`--sandbox review`, 2026-10-02): sound direction, no P0, three P1s.

1. **The bar's arrival is a layout change `layoutKey` did not carry.** The switch loads after the
   article and can be pressed mid-read; 44px in flow moves every row without resizing the table, so
   the `?at=` tracker, Structure's sampler and `OnScreenLinksStyle` would go on measuring the old
   positions. **Taken**: `showBar` is now the key's last field.
2. **`bandOpen && fit.modeW === 0` is also true when the band has stepped aside** (`bandAway`), with
   the prose on screen. **Taken as a documented v1 exception**: drawing the bar the instant a band
   link is followed would push the prose 44px in the middle of the jump. Reader.tsx § `showCrumbs`
   says so.
3. **Two samplers while Structure is open**, not "the same sampler". **Declined, with the reason in
   HeadingsCrumbs.tsx**: Structure owns its hooks by design (its sampler left Reader on 2026-09-10),
   the second costs one rect scan only for a reader with the switch on and Structure open, and the
   two read the same rects in the same frame with no writes between.

P2s taken: the comments and docs that said only a visitor has a bar (shell.css, PublicChrome.tsx,
narrow-windows.md) now say otherwise; a tree with nothing to name draws no bar rather than 44px of
blank; and the row above the first section shows the first section, as Structure's "you are here"
does. The wiring test (`tests/headings-crumbs-wiring.test.tsx`) covers owner-off, owner-on and a
press; the band and scroll cases are the browser check below.
