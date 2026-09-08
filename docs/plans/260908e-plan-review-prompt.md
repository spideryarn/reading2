# Review this plan before it is built

You are reviewing a plan for a small CSS fix in a TypeScript/React reading app. Be adversarial. I
want the case against it, not encouragement.

## What to read

- The plan: `docs/plans/260908e-the-dock-hides-on-scroll-in-a-mode-unless-the-band-is-the-whole-screen.md`
- The rules it changes: `src/web/styles/narrow-window.css`, § a small device (search for
  `--dock-bottom`) and § a band with no room (search for `band-covers`).
- `src/web/layout.ts` — `bandCoversProse`, `fitMode`, `MODE_PROSE_FLOOR`, `MODE_MIN`.
- `src/web/scroll.ts` — `stepBar` / `watchBarVisibility`, which write `data-bars` on `:root`.
- The sibling report's plan, which measured the same thing independently:
  `docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md`, § `-2F` is a
  different bug.
- `src/web/styles/dock.css` for how `--dock-bottom` is consumed, and `src/web/styles/mode-band.css`
  line ~47 where the band's own `bottom` reads it.

## The change, in one paragraph

A guard pins the bottom bar (the "dock") whenever `.mode-band` exists, so that a reader in a
full-screen mode panel on a phone always has the way out. Since 2026-09-06 a landscape iPhone shows
the article *beside* the band instead of under it, so the guard now pins the dock in a case where
the reader has the article right there and can scroll the dock back exactly as they do in plain
reading. The plan narrows the guard's `.mode-band` argument to
`.reader.band-covers .mode-band, .mode-band:focus-within`, and moves two other rules in the same
media query that key on the bare `.mode-band` to the same condition.

## The questions I actually want answered

1. **Is `.reader.band-covers .mode-band` true at exactly the moments the plan claims?**
   `.band-covers` is on `.reader` from `fit.modeW === 0` and is present on pages with no band at
   all. Is there a state where a band covers the article and this selector is false, or vice versa?
   Check `fitMode` for the `?spine=0` and outline cases especially.
2. **Specificity.** The guard is a single `:has()` with several arguments, deliberately, because
   `:has()` takes the specificity of its most specific argument and a two-selector spelling would
   tie with `:root[data-bars="hidden"]`. Does adding these arguments keep (0,3,0)? Does the
   `install-hint` rule keep the specificity its `:where()` was written to preserve?
3. **Is the reader ever stranded?** The plan's whole safety argument is that where the band does not
   cover the article, the document scrolls and scrolling up returns the dock. Find a configuration
   where that is false: a band that covers the article without `.band-covers`; a mode whose panel
   swallows the wheel/touch while the article is technically beside it; an article too short to
   scroll; the soft keyboard; `prefers-reduced-motion`; a mode opened by keyboard shortcut or by URL
   while `data-bars="hidden"`.
4. **The transition rule.** `:root:has(.mode-band) .dock { transition: none }` exists so the dock
   *arrives* rather than slides when a mode opens, and there is a measured 180ms window described in
   the file where the band is sized right and the bars have not arrived. If that rule is narrowed to
   the covering case, what happens in the side-by-side case — is a sliding dock right there, and is
   the 180ms window reintroduced anywhere?
5. **The install hint.** Is making its exclusion match the guard's band arguments correct, or does
   it want a different condition again?
6. **Is the diagnosis right?** The plan claims this is a proxy condition that came apart on
   2026-09-06 when `MODE_PROSE_FLOOR` split off from `PROSE_MIN`, not a change to the guard. Check
   that against the files. If the real cause is something else, say so — that is the most valuable
   thing you could tell me.
7. **Anything simpler.** The plan names two options it passed over (deleting the guard outright;
   dropping the `:focus-within` half). Is there a third that is better than what it chose?

State a verdict: build it, build it with changes (name them), or do not build it.
