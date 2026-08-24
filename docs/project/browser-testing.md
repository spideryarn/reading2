# Testing it in a browser

The reading view has no DOM tests and won't for a while — see
[testing.md § What we test, and what we don't](testing.md#what-we-test-and-what-we-dont). Until it
does, **looking at it in a browser is the test harness for stage 6**, and that makes it worth
writing down what to look at and where the eye lies to you.

This doc is the how. What the client *is*: [web-client.md](web-client.md). Why the feature exists:
[granularity-zoom.md](granularity-zoom.md).

## Before anything, check the server is actually up

```bash
npm run dev                                    # http://localhost:5273 (vite.config.ts)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5273/
```

Don't take another agent's word for it, or your own from ten minutes ago. On 2026-08-24 a session
was told the server was running on 5273 and it wasn't — nothing was listening, and `npm run dev`
had to be started fresh. A refused connection and a blank page look nothing alike in a terminal and
almost identical in a screenshot.

## The URLs and widths worth checking

The view has two modes and the second is easy to forget:

| URL | What you're looking at |
|---|---|
| `/` | reading mode: `Article L0 │ Parts L1 │ Sections L2 │ Text verbatim` |
| `/?text=0` | **outline mode** — rows collapse to natural height and the same table becomes a whole-article ToC. A leaf column of navLabels appears *here and only here*, styled by `.nav-label`. Check accents separately; it is visually a different page |
| `/#spya-k6fpme` | deep link, opens scrolled to that block — [block-ids.md](block-ids.md) |
| `/?slug=<slug>` | a different article; defaults to `example` |

**Widths.** At the default three gist columns the table is 1120px wide. Anything under that
overflows horizontally and the pinned end columns start overlapping the middle ones — which is the
design, not a fault: the pinned columns sit *on top* and the drop shadow is there to say "more to
scroll". 1000×900 is a good window for exercising it; a full-width window hides the whole class of
bug. Below the `td.text` minimum of 34rem the prose measure clamps rather than breaking.

## Do not judge colour from a screenshot

This is the one that matters. Of the three display bugs found on 2026-08-24, **two were invisible
by eye and fell straight out of computed values**. A dark palette is very good at hiding a wrong
colour: everything is low-contrast already, so "a bit murky" is indistinguishable from "correct".

Measure instead:

```js
getComputedStyle(el).getPropertyValue('--tint')     // '' means it never arrived
getComputedStyle(el, '::before').backgroundColor    // what the bar actually paints
getComputedStyle(document.documentElement).getPropertyValue('--highlight-wash')
el.getBoundingClientRect()                          // for anything sticky, always
```

Read the *resolved* value, not the declaration. Both traps below declare correctly and resolve
wrong.

## Three traps this codebase has actually hit

Each of these looked right in review and was wrong on the page.

1. **A custom property set on `<col>` never reaches `<td>`.** `<col>` is not a DOM ancestor of a
   cell — a cell's parent is `<tr>` — and custom properties inherit through the DOM tree. Only a
   fixed list (background, border, width, visibility) crosses from column to cell, by a special
   table mechanism that is not inheritance. So `--tint` on `<col class="col-depth-1">` resolves fine
   *on the col* and is empty on every cell. Symptom: every depth bar fell back to `--rule-strong`
   grey and the whole tint system was dead while looking, in the stylesheet, entirely correct.

2. **`color-mix(in oklch, …)` with an achromatic colour drags the hue to 0°.**
   `color-mix(in oklch, #DB8A45 20%, oklch(0.145 0 0))` gives hue **11.7°**, not 58.6° — a
   desaturated pink where an orange was intended. The page colour specifies hue `0` *explicitly*,
   and a present component gets interpolated. Mixing with the `white` keyword doesn't suffer this,
   because converting an achromatic colour to a polar space leaves its hue **missing**, and a
   missing component is carried over from the other colour rather than mixed. Two mixes one line
   apart, one broken and one not, for that reason alone.
   Fix by mixing `in oklab` — same lightness, same chroma, hue preserved — or by writing the
   achromatic colour with `none` for its hue.

3. **`position: sticky` is confined to its containing block, so a 100vw bar in a 100vw parent has
   zero range.** `.controls` is `width: 100vw` with `left: 0`, inside a body that is also the
   viewport width, while the table beneath it is wider. There is nowhere to slide, so the bar
   scrolls away with the document and article text draws over the toolbar strip. The column pins in
   the same stylesheet work because *their* containing block is the table, which is wider than the
   viewport — the identical declaration, a different containing block, the opposite outcome.
   `getBoundingClientRect()` catches it in one call: a bar at `[-97, 903]` in a 1000px viewport is
   not pinned, whatever `position` says.

`styles.css` also carries three structural constraints that look arbitrary until you've hit the
failure — `border-collapse: separate`, no `overflow-x` wrapper around the table, and the two-axis
sticky bars that follow. They're commented in place; read them before you tidy them.

## Driving it from an agent

Claude-in-Chrome drives a real, visible Chrome. `resize_window` then `navigate`, and batch the
steps — a `navigate` may reset the window size, so resize *after* it if the width matters.
`javascript_tool` is worth more than another screenshot most of the time: one call can dump every
computed token, class and rect at once, and see § "Do not judge colour from a screenshot" for why
that's not just a speed argument.

**A caveat inherited, not reproduced:** a session working headless reported that a script-scrolled
page screenshots as entirely blank even with correct DOM and layout — suspect the compositor before
the CSS. Six screenshots through a visible Chrome, including after both script and wheel scrolling,
were all correct, so treat this as headless-only until someone sees it otherwise.
