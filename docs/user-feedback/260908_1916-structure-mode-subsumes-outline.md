# Structure mode subsumes Outline

**[SPIDERYARN-READING2-2S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2S)** · report
`spya-ava6u7` · 2026-09-08 19:16 UTC · build `cec18ed8` · **Ending: shipped.** Landed on `dev`
2026-09-10; not deployed. Built in one job with
[2Q](260908_1744-outline-rows-wrap-instead-of-truncating.md), which also shipped.

## What Greg said

> I like the 2-column version of Structure mode.
>
> But the 1-column version of Structure mode shows the top-level sections in the top half, and then
> the lower-level underneath that, which is very confusing. For the 1-column version of Structure,
> we should just use Outline mode - that's a better 1-column experience.
>
> So, in other words, if the page is wide, show the current Structure 2-column mode. If it's
> narrower, show the current Outline mode. And get rid of Outline mode altogether (because it will
> have been subsumed by Structure mode).

Reading `arxiv-2512-spya-uxu036` in Outline mode, at `spya-t560n7`.

## What we did

Exactly that. [260910g](../plans/260910g-structure-mode-subsumes-outline.md) has the design, the
browser measurements and the two GPT Sol reviews.

- **Structure has two faces.** Where the mode band is wide enough for its two columns it draws them,
  unchanged; where it is not — which is exactly where it used to stack them, the layout Greg found
  confusing — it draws Outline's nested list. The switch is the same width the stacking was: a 389px
  band at the default text size (388 on a phone, where the band has no border). So a 390px phone
  gets the list and a 430px one the columns.
- **Outline is gone from the bar.** Structure took its place, straight after Hierarchy, and came out
  from behind the Experimental Features switch — Outline was on every reader's bar, so leaving
  Structure hidden would have taken the list away from everyone who had not ticked the switch.
- **Old links still work.** `?mode=outline` opens Structure (tab title and Dock agree), and so does
  the old `?mode=hierarchy&text=0`. Typing "outline" in the command bar finds Structure.
- Hierarchy is unchanged.

## Worth knowing

- **The marketing screenshot still says "Outline."** The landing page's hero and the features page's
  showcase are `outline.png`, which is still an accurate picture (it is the narrow face now), but the
  showcase's title word names the retired mode. Deferred to the next re-shoot, since retitling it
  without a new picture would caption an Outline screenshot "Structure".
- The list's code keeps its old names (`OutlinePanel`, `outline.ts`, `.outln-*`); renaming them would
  be churn nobody sees.
