# The top of the spine is under the wordmark on a phone

**Not fixed.** Greg's call, 2026-09-05: write it up, leave the fix to whoever owns mobile chrome
next. The reason it is worth the words is that the *class* is going to recur — see below — and that
the fix is now known and cheap.

Found while planning stage 4 of
[260905d](../plans/260905d-declutter-the-reading-view-top-bars.md), by measuring a hypothesis about
a change we had not made yet. It is nobody's regression from that work: it is live on `dev` and has
been since the mobile hide-on-scroll landed.

## What a reader gets

On a phone (≤731px wide, or ≤620px tall), in **Plain** mode, scrolled far enough that the bars have
slid away: **the top 44px of the spine is covered by the Spideryarn wordmark and cannot be
pressed.** The spine is the bird's-eye rail down the far left, and its bands are press targets — so
the first few percent of the article is unreachable by the one control whose whole job is jumping
around the piece.

Nothing looks broken. The rail is drawn full height; only its top is behind an opaque-enough link,
and a press there goes home instead.

## Measured, not reasoned

At 390×844 on `fowler-phrenology`, signed in, scrolled until `data-bars="hidden"`:

| | |
|---|---|
| `--bar-bottom` | drops from `calc(2.75rem + 0px)` to `0px` |
| `.spine` | `{top: 0, bottom: 844, left: 0, right: 12}` |
| `.logo-home` | `{top: 0, bottom: 44, left: 0, right: 41.6}` |
| overlap | 44px vertical × 12px horizontal — the full width of the rail, its whole top |
| `document.elementFromPoint(6, 10)` | `<a class="logo logo-home">` |

That last row is the finding. Everything above it is consistent with a rail that merely *looks*
close to the wordmark; `elementFromPoint` is what says the rail is not the thing you would hit.

The desktop control behaves: at 1440×900 the media query never matches, `--bar-bottom` never moves,
and the same point answers `.spine-hit`.

## The root cause, and it is not the spine

`--bar-bottom` is read as "the bottom of the controls bar". It is not. It is **the bottom of the top
chrome**, and the top chrome is three things, not one:

- `.controls`, the sticky bar — which does slide away on a small device
- `.logo-home`, fixed at `top: var(--safe-top); height: var(--bar-h); z-index: 60`
- `.fb-button`, its mirror in the other corner, same three numbers

`:root[data-bars="hidden"]` in [`styles.css`](../../src/web/styles.css) drops `--bar-bottom` to
`var(--safe-top)` so everything pinned beneath the bar can reclaim its 44px. **The two corner
controls take no part in that switch** — nothing in the stylesheet moves, hides or shrinks them on
`data-bars` — so the space they occupy is reclaimed by things that then draw underneath them.

It survived because the case that shows it is narrow. Any mode with a panel open is protected, and
protected *by accident of a different fix*: a rule added 2026-08-31,
`:root:has(.controls:focus-within, .mode-band)`, pins `--bar-bottom` back to full height whenever a
band exists — Greg had complained about losing the way out of Search mode. Its `:has()` specificity
(0,3,0) beats the hide rule's (0,2,0). So the collision only appears with **no band open**, which on
a phone means Plain mode, which is the mode with the least on screen and therefore the one nobody
inspects.

## The class it belongs to

**A token named after one of its consumers.** `--bar-bottom` is named for `.controls`, so every
later reader of it reasons about the controls bar and nothing else — and two other elements occupy
exactly that band of the screen without appearing anywhere in the name, the comment, or the rule
that moves it. The same shape as `--head-h` in the same file, which is a height that three unrelated
things position against.

This repo has met the class before from the other direction: `stickyOffset()` was a literal `84`
with a comment asking whoever changed `--bar-h` to remember this too
([`scroll.ts`](../../src/web/scroll.ts)), and the fix there was to **measure rather than agree a
number between two files**. The same instinct applies here and was not applied: a fixed element's
occupancy is a fact you can measure, and instead it is asserted by a token whose name says something
narrower than it means.

**What would have caught it**, ranked by value:

1. **A browser check that presses the top of the spine on a phone-sized viewport, scrolled.** The
   whole failure is `elementFromPoint`, and it takes one line. `docs/project/browser-testing.md`
   already lists the mobile bars among its cases; it checks that they hide, not what is underneath
   them afterwards. Cheapest and most direct.
2. **Naming the token for what it is** — the bottom of the *top chrome* — and listing its three
   occupants in the comment. Would not have caught this instance mechanically, but it is the change
   that stops the next one, and it is free.
3. A test asserting that every element pinned to `--bar-bottom` clears every element that is fixed
   in the same band. Real, and probably not worth it: it needs layout, so it needs a browser, and by
   then check 1 is simpler and answers the same question.

## The fix, when somebody wants it

The two corners join the hide, so that chrome leaves together — which is the design intent already
written down for the bars themselves, and the phrasing Greg used for what he liked about it ("the
nice way that we already hide/reveal those when scrolling on mobile"). Inside the existing
`@media (max-height: 620px), (max-width: 731px)` block:

```css
:root[data-bars="hidden"] .logo-home,
:root[data-bars="hidden"] .fb-button {
  transform: translateY(var(--bar-hide));
  transition: transform 180ms;
}
```

`--bar-hide` is the bar's own travel and is already the token for exactly this, so the existing
`:root:has(.mode-band)` guard brings the corners back with the bar and there is no new specificity
fight to have. Suggested by Fable, 2026-09-05, and checked against the tokens rather than taken on
trust.

**Note this may be overtaken.** [260905g](../plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md)
proposes moving both controls into the Dock, which dissolves the problem rather than fixing it —
there would be nothing left in the corner to hide. Whoever gets there first should read the other.
