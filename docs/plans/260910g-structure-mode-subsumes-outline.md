# Structure mode subsumes Outline

Two feedback reports from Greg, one job, because the second is about the view the first promotes.

> I like the 2-column version of Structure mode.
>
> But the 1-column version of Structure mode shows the top-level sections in the top half, and then
> the lower-level underneath that, which is very confusing. For the 1-column version of Structure,
> we should just use Outline mode - that's a better 1-column experience.
>
> So, in other words, if the page is wide, show the current Structure 2-column mode. If it's
> narrower, show the current Outline mode. And get rid of Outline mode altogether (because it will
> have been subsumed by Structure mode).
>
> — Greg, 2026-09-08, feedback SPIDERYARN-READING2-2S

> In outline mode, is there a way to show more of each line? It seems like it truncates each line
> after just a few words, and so it's really hard to tell what each one's about.
>
> — Greg, 2026-09-08, feedback SPIDERYARN-READING2-2Q

Notes: [260908_1916-structure-mode-subsumes-outline.md](../user-feedback/260908_1916-structure-mode-subsumes-outline.md),
[260908_1744-outline-rows-wrap-instead-of-truncating.md](../user-feedback/260908_1744-outline-rows-wrap-instead-of-truncating.md).
Ancestors: [260828aw](260828aw-outline-mode.md) (Outline),
[260907c](260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md) (Structure as a
third mode, built so this comparison could be made), and
[260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md), whose merge this partly is.

## What changes for a reader

```
 band ≥ 389px wide                         band < 389px wide
 ┌────────────────────────────────┐        ┌──────────────────────┐
 │ 1 Intro      │ 2 Methods        │        │ 1 Intro              │
 │ 2 Methods  ▌ │ 2.1 Design       │        │ 2 Methods            │
 │ 3 Results    │ 2.2 Sample  ◀    │        │   2.1 Design         │
 │ 4 Discussion │   gist sentence… │        │   2.2 Sample   ◀     │
 │              │ 2.3 Measures     │        │     gist sentence…   │
 └────────────────────────────────┘        │   2.3 Measures       │
   Structure's two columns (unchanged)     │ 3 Results            │
                                           │ 4 Discussion         │
                                           └──────────────────────┘
                                             Outline's nested list — now
                                             Structure's narrow face
```

- **One mode, Structure, two faces.** Where the band is wide enough for Structure's two columns it
  draws them, exactly as today. Where it is not — which is precisely where Structure used to stack
  its columns one above the other, the layout 2S calls confusing — it draws Outline's nested list
  instead. The threshold is the one Structure already had, so every window that showed two columns
  still does, and every window that showed the stacked pair now shows the list.
- **Outline leaves the Dock.** `outline` comes out of `MODES`.
- **Structure comes out from behind the experimental switch.** Outline was on every reader's bar;
  retiring it while Structure stayed hidden would take the nested list away from everybody who has
  not ticked the switch. "Subsumed by Structure mode" means the reader who had Outline now has
  Structure, so it moves into Outline's place in the bar, straight after Hierarchy.
- **`?mode=outline` keeps working**: it opens Structure. So do the old `?mode=hierarchy&text=0` links,
  which were rewritten to Outline and are now rewritten to Structure.
- **2Q: a row's title wraps rather than being cut at one line.** The list's rows were clamped to one
  line (`-webkit-line-clamp: 1`), and in a 300px band with a nested number gutter that is about
  thirty characters. Structure's own rows have never been clamped. The Outline face drops the clamp,
  so both faces show a title whole.

## How

### The switch between the faces — measured on the band, once

`StructureBand` (src/web/modes/structure/StructureMode.tsx) chooses the face. It watches the band's
own `<aside>` with a `ResizeObserver` and asks the question Structure's container query asked:
*would Structure's content box be at least 364px* (two 176px tracks and a 12px gutter)? That is
`structureFace(borderBoxWidth, borders, rootFontPx)` — the band's border-box width, less its actual
borders, less Structure's own `1.5rem` of padding at the actual root size. At a 16px root with the
1px border it switches at a 389px band, exactly where the columns used to stack.

- **Border-box, not the mounted face's content-box, and this is the one trap in the design.** The two
  faces pad the band differently (Structure 12+12px, Outline 12+8px), so reading the mounted face's
  content box would call a 387px band 362px under Structure (→ switch to Outline) and 366px under
  Outline (→ switch back): an oscillation. The border box and the borders are set by the layout and
  neither face changes them, and Structure's padding is subtracted whichever face is on screen, so
  the measurement does not depend on the answer.
- **Measured borders and root size, not a px constant** — GPT Sol's plan review, P1-1. The first
  draft had `TWO_COLUMN_BAND_MIN = 389`, which equals the old container query only at a 16px root
  (the padding is rem, so a 20px root needs 395px; layout.ts records that the root size is not
  locked) and only while the band has its border (`.band-covers` removes it, making the old
  threshold 388px).
- **The first frame draws the wide face, and a narrow band never paints it.** The layout effect
  measures *synchronously* before it registers the observer, so a narrow answer re-renders before
  paint; the observer is only for later changes. (This said the observer's first callback runs in
  the layout effect, which is not how `ResizeObserver` works — Sol's P2-5. The code was right and the
  sentence was not.) A root font-size change with no width change is not observed; rare, and the next
  resize corrects it.
- **Structure's stacked layout is then dead code and comes out**: the `@container` queries in
  structure-mode.css become a plain two-track grid, and the `tracks < 2` branch in `StructurePanel`'s
  measurement goes. One threshold, in one place, in JS. (The container query was there because JS
  could not see the band's real width through `fit.modeW`, which is 0 when the band covers the
  prose; measuring the element answers that too.)

The simpler option passed over: rendering both faces and hiding one with the container query. Both
panels measure hidden copies of themselves with `ResizeObserver`s, and a `display: none` subtree
reads every height as 0 — the panel that is hidden would keep choosing rungs against a band of
nothing, and each panel's measuring work would run twice. Choosing in JS mounts only the face on
screen.

### The Outline face gets what Outline had

`OutlinePanel` is unchanged in what it draws; it is now mounted only by `StructureBand`. Its inputs
move with it: the tree (`StructureBand` already builds the same `buildSummaryTree` at full depth),
the focus row (the same `useColumnContext` sampler, already in `StructureBand`), and three props from
`Reader` — `supplementOf`, the arc cells, and `paragraphLabelsReady`. `Reader`'s `outlineRoot` and
`outlineLive`, which were gated on `mode === "outline"`, go.

The panel's `aria-label` becomes "Structure" — a screen reader should hear the mode's name, not a
retired one. The component, its file, `outline.ts` and the `.outln` classes keep their names: they
are the nested-list face, and renaming 450 lines of component plus a stylesheet buys nothing the
reader sees (deferred, below).

### Retiring the word

`RETIRED_MODES = { outline: "structure" }` in src/modes.ts, and one function, `modeFromParam`, that
both `modeParam` (client) and `readMode` (server, for the tab title) call — so the tab and the view
cannot disagree about what `?mode=outline` means. The URL is not rewritten on arrival: the address
keeps `mode=outline` until the reader changes mode, which is harmless (it means Structure
everywhere), and a sixth `settleAddress` rewrite would be a second copy of the same decision.
`liftStrandedText` writes `mode=structure` instead of `mode=outline`.

The compiler lists the rest, which is new-mode.md read backwards: `MODE_LABEL`, `OWNER_MODE_NOTE`,
`MODE_CATALOG`, `MODES_UI`, `POLICY`, `MODE_TARGET`, `band()`, `selectPassages`, and in tests
`BAND_SAYS`, `SPENDS`, `DRAWS`, `GENERATES`, `SILENT`, plus the string-keyed tables the typecheck
cannot see (`visitor-gaps`, `page-title`, `BEHIND_THE_SWITCH`, `last-view`'s mode list, the
address-settling and public-read-rewrite targets, `mode-surface-changes-no-markup`'s band shape,
and — Sol's P1-4 — `shared-inventory.test.ts`, whose always-shared list and `WIRE_ROW` named Outline
as the owner of the arc and of `navLabelStatus`). The styles manifest keeps `outline-mode.css`
beside `structure-mode.css`, now as the two faces of one mode rather than a pair to delete together.

Two places deliberately keep the raw word (Sol's P2-6): the Feedback dialog records `location.href`
verbatim, so a report filed from an old link says `mode=outline` in its URL while its `mode` field
says `structure` — which is what the reader's address really was; and the Dock's loose links on the
metadata and tweets pages now read the carried mode through `modeFromParam` too.

`MODE_CATALOG.structure` gets Outline's aliases (`tree`, `map`) and `outline` itself, so a reader
who types the old name in the command bar lands on the mode that now holds it. Its `description`
and `how` are rewritten to be true of both faces, and Hierarchy's `how`, which names Outline, is
corrected.

### 2Q — the clamp

`.outln-text` loses its one-line clamp (both `-webkit-line-clamp` and `line-clamp`). The fit measures
real markup (`OutlinePanel` renders every rung hidden and takes the largest that fits), so a wrapped
title makes a rung taller and the fit simply chooses a lower rung when the band is short. What it
costs is detail — on a short band, a list whose titles wrap reaches fewer rungs (fewer gist
sentences, no paragraph rows). The trade Greg asked for, named.

**The clamp stays as the floor.** The first draft claimed "nothing overflows that did not before",
and Sol's P1-2 showed it false four lines later: rung 1 is "every part — if this will not fit,
nothing will", the fit keeps rung 1 when nothing fits, and a panel that does not scroll then drops
the last parts off its foot. So every rung is now measured twice, titles whole and titles clamped
(`.outln-list.clamp`); the best whole-title rung that fits wins, and only when none fits does the
panel fall back to the clamped set — which is exactly the list it drew before this change. The
choice is on the band as `data-outline-clamp` beside `data-outline-rung`. The cost is ten hidden
lists instead of five.

## Stages

1. **Code**: modes, catalog, Dock, tables, `StructureBand` choosing the face, dead stacked CSS out,
   the clamp. Tests updated; a new test for the face choice and for `?mode=outline` → Structure on
   both sides.
2. **Browser pass** at a wide, a mid (~1000px, `cols=1`) and a phone width: two columns where there
   is room, the list where there is not, no flicker at the threshold, titles whole.
3. **Docs sweep**: every doc that names Outline *mode* (not granularity-zoom's compact table, which
   is also called "outline mode" and is a different thing).
4. GPT Sol code review; fixes; `npm test`, `npm run typecheck`; land on dev.

## Browser evidence (stage 2)

Playwright against system Chrome on the box, this worktree's own dev server, `fowler-phrenology`
(9 parts) and `antikythera-mechanism-spya-zhxrzm` (10, the most on the local shelf), 2026-09-10:

- **The flip is where the arithmetic says.** Beside the prose: the list up to a 944px viewport
  (band 388), the columns from 945 (band 389). Covering the prose (phones, no border): the list up
  to 399 (band 387), the columns from 400 (band 388). So a 390px phone gets the list and a 430px one
  the columns.
- **No oscillation.** Held on each edge, the face switched once and stayed; toggled across each edge
  eight times, exactly nine switches, alternating, the final face right every time. No console
  errors. After a resize across the edge the old face can stay up for 100–350ms (box load ~13);
  the first frame on *mount* is the one the code promises.
- **Titles wrap** (`D-900x900.png`: two-line titles, no whole-title row cut), and short bands step
  down rungs with `data-outline-clamp="0"` — rung 2 at 360×500, rung 1 at 900×360.
- **`?mode=outline`**: the tab says Structure, the Dock checks Structure, the band is Structure's;
  the URL keeps `mode=outline`, as designed. `?mode=hierarchy&text=0` lands on `?mode=structure`.
- **The Dock**, switch off: Plain, Hierarchy, Structure, Summary, Glossary, Ideas, Quotes, Search,
  Diagram, Chat. No Outline.
- **The floor can still overflow, and it could before.** At 900×300 (a 260px band) the list falls
  back to the clamp (`clamp 1`, rung 1) and still needs 295px: the last part is clipped. That is the
  pre-change behaviour exactly — clamped rung 1 was Outline's floor, and "if this will not fit,
  nothing will" was always true of it — so this change neither causes nor fixes it. A band that
  short is a landscape phone with the keyboard up; named here rather than solved.

## Deferred, named

- **The marketing screenshots.** The landing page's hero and the features page's "Outline." showcase
  are both `outline.png`. The picture is still true of the product (it is the narrow face, and the
  copy describes a fisheye table of contents rather than a mode by name), so it stays until the
  next re-shoot; the showcase's title word is the one thing that names a retired mode, and changing
  it without the picture would caption an Outline screenshot "Structure".
- **Renaming `OutlinePanel`, `outline.ts` and `.outln-*`** to say "the list face of Structure". Pure
  churn today.
- **Structure's own stage 2/3 work** (the measured rung ladders on the wide face), which 260907c
  already deferred.
