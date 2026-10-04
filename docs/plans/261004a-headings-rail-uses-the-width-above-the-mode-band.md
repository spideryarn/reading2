# The headings rail uses the width above the mode band

Report `spya-ft2cgg` (SPIDERYARN-READING2-BM), from Greg, filed 2026-10-03 from an iPad in
landscape. Queue item `qi-53x37gaw`. Proven an admin's with `feedback-reporter.ts --report-id`
(exit 0) by the sweep that relayed it. It builds on
[261003n](261003n-where-am-i-rail-on-two-or-three-lines-on-a-phone-in-portrait-and-a-phone-portrait-doc.md)
(`spya-ub4jnc`), which is on `dev` and merged here.

> I like the horizontal rail that we have now that shows at the top where we are in the document,
> with kind of heading breadcrumbs hierarchically. Great. The only thing is, when I've got it on
> landscape on an iPad with three columns, i.e., you know, the summary on the left and marginalia on
> the right, the headings rail spans the whole width of the screen, but the bit showing the headings
> actually only spans the middle column, and so it's wasting space either side that could be used to
> show more of the headings so they don't get so truncated.
>
> — Greg, 2026-10-03 (`spya-ft2cgg`)

## What is there now, measured

"The rail" is the headings breadcrumb, `nav.crumbs`, in the controls bar `.controls`
(`src/web/HeadingsCrumbs.tsx`, `src/web/styles/crumbs.css`; the bar is `shell.css` § `.controls`).

Measured on local dev, article `article-spya-uzf7vk`, `?mode=summary&margin=1&summary=fuller`,
scrolled into section 7.2 (a Sonnet subagent with Playwright; shot
[261004a-shot-before-1180.png](261004a-shot-before-1180.png)):

```
1180 wide (iPad landscape)
x: 0  12                348                            892                1180
   │sp│   (empty, 336px)  │  breadcrumb, 784px of text room (24px padding each side)  │   y 0–44
   │  │   Summary band    │  prose                        │  marginalia        │   y 44–
```

| window | band (`--mode-w`) | bar box | room for crumbs | the current crumb wants | cut by |
|---|---|---|---|---|---|
| 1180 | 336 | 348–1180 | 784 | 892 | 123px, and the ancestor is an 11px stub |
| 1366 | 448 | 460–1366 | 858 | 892 | 49px |
| 1024 | 288 | 300–1024 | 676 | 892 | 231px |

So **the right is already used**: the bar runs over the marginalia to the window's edge. **The
waste is all on the left**: the strip above the band, as wide as the band, holds nothing but page
background. Greg's "either side" is half right, and the half that is right is the bigger one.

**Why the bar starts right of the band.** `.controls` has
`left: spine + --mode-w` and `width: --page-w − spine − --mode-w`, and `.reader`'s padding-left
puts it there in flow. The band is `position: fixed` with `top: --bar-bottom` (44px), *whatever the
scroll position*. The bar is sticky, in flow **under the masthead**. So at the top of the article
the bar sits at y ≈ the masthead's height, level with the band, and a bar that started at the spine
would have its left 336px behind the band (band z-index 44, bar 40). Only once the masthead has
scrolled away and the bar is stuck at y 0 is it above the band, and from then on the strip is free.

## What to build

**While the bar is stuck at the top and holds the breadcrumb, it starts at the spine.** Before it
sticks, it stays where it is today.

```
at the top of the article (masthead on screen): as today
   │sp│  Summary band  │ Title of the article (masthead)            │
   │  │                │ part › section                             │   bar under the masthead

scrolled (bar stuck): the bar takes the strip above the band
   │sp│ part › the whole section title, 336px more room                         │
   │  │  Summary band  │  prose                      │  marginalia   │
```

Two parts.

1. **A fact on the root: `data-bar-stuck`.** A zero-height sentinel `div` rendered directly before
   `.controls` (only when `showBar`), watched by one `IntersectionObserver`. When the sentinel's top
   is above the viewport's top the bar is stuck: set `document.documentElement.dataset.barStuck`;
   otherwise delete it; delete it on unmount. A small hook beside the bar's other watchers.
   - An attribute, not React state, for the reason `data-bars` is one: `Reader` should not
     re-render for it (performance.md).
   - An observer, not a rect read in `watchBarVisibility`'s scroll callback, whose body is
     deliberately "arithmetic on three numbers with no DOM read in it".
   - The root margin is `0px`, not `--safe-top`. In the installed app the bar sticks `--safe-top`
     below the edge, so the attribute arrives that many pixels late on the way down and early on
     the way up. Both are in the direction that is harmless: the bar is stuck and merely narrower
     than it could be. The harmful direction (wide while level with the band) cannot happen.
   - The sentinel is the full width of `.reader`, so a sideways scroll of a wide table does not
     take it out of the viewport and deafen the observer.
2. **One CSS rule**, in `crumbs.css`:

   ```css
   :root[data-bar-stuck] :where(.reader) > .controls:has(> .crumbs) {
     margin-left: calc(-1 * var(--mode-w));
     left: calc(var(--spine-w) + var(--safe-left));
     width: calc(var(--page-w) - var(--spine-w));
   }
   ```

   The negative margin is what moves it: `left` on a sticky element is a floor, not a position,
   and the bar's place in flow is after `.reader`'s `--mode-w` of padding. With no band open
   `--mode-w` is `0px` and the rule changes nothing; on a narrow window the band covers the prose,
   `--mode-w` is `0px` and the breadcrumb is not drawn. So it needs no media query.

Scoped to a bar that holds the breadcrumb: a visitor's chip-only bar stays put, because nothing in
it is short of room. A bar with both moves, chip and all.

The bar's height does not change, so nothing under it moves, `layoutKey` is untouched and no
scroll position is restored.

## What it costs, named

- **The breadcrumb jumps sideways once**, by the band's width, when the masthead scrolls off (and
  back when the reader returns to the very top). No transition in v1: the bar's existing
  `transition: transform` is about hiding, and a `left`/`width` transition would also fire every
  time a mode opens or its band is resized. If the jump reads as a glitch on the iPad, a transition
  scoped to the attribute's change is the follow-up; it is not built.
- One more attribute on `<html>` and one observer for the life of the reading view.

## Simpler options passed over

- **Always start the bar at the spine.** One CSS rule and no JS, but at the top of every article
  the path's first 336px is behind the band. That is the first thing a reader sees after opening a
  mode.
- **Raise the bar above the band (z-index).** Then at the top of the article the bar paints a 44px
  stripe across the band's content.
- **Move the bar above the masthead**, so it is always stuck. No attribute needed, but it changes
  the top of the page for every reader with a bar, band or no band, to fix a three-column case.
- **CSS `scroll-state(stuck: top)` container query.** The right primitive, and not in Safari, which
  is the browser the report came from.

## Stages

One stage; it is small.

1. Failing tests first: (a) jsdom — the hook sets and clears `data-bar-stuck` from a stubbed
   `IntersectionObserver`'s entries, and clears it on unmount; (b) stylesheet — the rule above
   exists, needs both `[data-bar-stuck]` and `> .crumbs`, and is outside any media query (extend
   `tests/crumbs-narrow.test.ts`'s "only query" assertions rather than fight them). Watch both red.
2. Build it. `npm test`, `npm run typecheck`, lint on touched files.
3. Browser check (Sonnet subagent, Playwright), same article and URL, 1180×820, 1366×1024,
   1024×768, and 390×844 as the control that nothing changed on a phone:
   - scrolled: `.controls` left is 12, crumbs room is today's plus `--mode-w`, the 7.2 crumb is
     whole at 1180 and 1366;
   - at scroll 0: `.controls` left is `12 + --mode-w` and no part of it is under the band;
   - no band open: identical before and after;
   - scrolled sideways on a wide table: still pinned;
   - after shots into this folder.
4. GPT Sol code review, docs (`experimental-features.md` § the breadcrumb's paragraph, one
   sentence; `narrow-windows.md`'s `.controls` bullet if it claims the bar's left edge), the note
   in `docs/user-feedback/`, `feedback-endings.ts`, push to `dev`.

## Deferred

Nothing is deferred from the report. The transition above is a possible follow-up, not a promise.

## Questions for Greg

None blocking. One to look at on the iPad: whether the sideways jump as the title scrolls away is
noticeable enough to want a slide.

## Progress

- 2026-10-04: prior-work check clean (no plan, note, commit or session for `spya-ft2cgg`; the
  sibling's work is `ef45231a0`, merged). Measured. Plan written.
- 2026-10-04: GPT Sol's plan review, *approve with changes*
  ([review](261004a-headings-rail-uses-the-width-above-the-mode-band-plan-review-sol.md)). All four
  taken: the stylesheet test asserts all three declarations; a wiring test through the real
  `Reader` (watched red with `showBar` in place of `showCrumbs`); a `stopped` guard for an observer
  entry queued before teardown; and the sentinel is drawn on `showCrumbs`, not `showBar`, so a
  visitor's chip-only bar pays for nothing. Its fourth point changed the browser check, below.
- 2026-10-04: built (`c795b9e08`). GPT Sol's code review, *approve with changes*: no P0 or P1, two
  comments that claimed more than was shown, which it fixed
  ([review](261004a-headings-rail-uses-the-width-above-the-mode-band-code-review-sol.md)).
- 2026-10-04: the full suite on `73c06db36`: 1499 files passed, 5 failed, all five for a build a
  fresh worktree does not have (`api-dist/`, the fleet client). After `npm run build` and
  `npm run build:fleet` the five pass alone (112 tests). Merged `origin/dev`, then typecheck and the
  breadcrumb, stylesheet and doc-link tests again, green; the full suite was not re-run on the
  merge. Pushed to `dev`. Not deployed.

## What the browser showed afterwards

A Sonnet subagent with Playwright, same article and URL, real wheel scrolling. Shot:
[261004a-shot-after-1180.png](261004a-shot-after-1180.png).

| window | bar box, stuck | room for crumbs (was) | the 7.2 crumb, which wants 892 |
|---|---|---|---|
| 1180 | 12–1180 | 1120 (784) | whole (was cut by 123) |
| 1366 | 12–1366 | 1306 (858) | whole (was cut by 49) |
| 1024 | 12–1024 | 964 (676) | whole (was cut by 231) |

- **At the top of the article** the attribute is absent, the bar is where it was (348 / 460 / 300)
  and its box does not overlap the band's.
- **The flip**, in 1px wheel steps at 1180: at scrollY 290 the bar's top is 0.6 and its left 348;
  at 291 its top is 0 and its left 12. The same step both ways. No step had the bar wide while its
  top was above 0.
- **A deep link** (`&at=` into 7.2) arrives with the attribute set and the bar wide, with no scroll.
- **No band** (`?margin=1`): the bar is 12–1180 at the top and scrolled, as before.
- **A phone**, 390×844: the three-line bar measures exactly as before; with a mode over the prose
  there is no bar.
- No console errors from the page.

**One more number changed, because the first after-measurement asked for it.** With 1120px of room
for a crumb that wanted 892, the crumb was still cut by 6px (4 at 1366, 9 at 1024). The ancestors
shrank "a hundred times faster", but flex shares the shortfall in proportion to length times that
factor, so the current section still paid about 1% of it: an ellipsis and two letters. The factor is
now 1000000 (measured at 100000; GPT Sol's
[second code review](261004a-headings-rail-uses-the-width-above-the-mode-band-code-review-2-sol.md)
raised it tenfold, because WebKit rounds to 1/64px and 0.009px could still round up to an
ellipsis in Safari), the current crumb is whole at all three widths, and the ancestor takes what is left
(214px at 1180, 58px at 1024, where it reads only "7 Mos…"). Where the current crumb alone is wider
than the bar (800×600 with a band) it still ends in an ellipsis inside the bar. The narrow rules are
untouched by this: there the current crumb is out of the flex row.

**Sideways scrolling: not pinned, and it was not before.** GPT Sol's plan review said the planned
"wide table" check was vacuous, because the page does not scroll sideways (tables scroll inside
themselves). So the check injected page-level overflow instead. With `scrollX` 200 the bar's left
edge is at −188; with the old geometry forced back it is at 148. Both moved by exactly 200: the bar
has not been pinned sideways in either geometry, whether the wide element was put in `.reader` or
in `body`. `shell.css` § shell says the bars pin to the left; on today's page that is not so, and
since nothing makes the page scroll sideways nobody can see it. Left alone and written here.
