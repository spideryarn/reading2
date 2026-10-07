# The contents list and its search box, above the page on a narrow window

Up: [plans.md](../project/plans.md)

Feedback report `spya-vwf00u` (SPIDERYARN-READING2-EB), from Greg, filed 2026-10-06 as a suggestion
on a Metadata page. Queue item `qi-pmv7krdb`.

> In the metadata page, and maybe other places as well, perhaps the profile, we have a table of
> contents that's visible in the left-hand side if the page is wide enough. Actually, that table of
> contents is really nice. I think it even has a search bar as well. On something like a portrait
> iPhone, obviously it's not wide enough. So perhaps we should then put the search bar and table of
> contents above the actual contents of the page, like the metadata or the profile page, because I
> think that's a useful piece of functionality for helping people navigate.
>
> — Greg, 2026-10-06

## Where things stand

[`src/web/PageContents.tsx`](../../src/web/PageContents.tsx) is the one contents list, mounted on
Metadata and on `/profile`. It is a `<nav>` fixed in the left margin: a search box, and under it a
button per section. It is `tw:hidden tw:lg:flex`, so below 1024px wide (every phone, an iPad in
portrait) it is not drawn at all, and neither is the search box.

Nobody has built the narrow half. [261002a](261002a-metadata-contents-on-an-ipad-in-landscape.md)
named it and put it off *"until someone asks for it on portrait"*. This is that ask.

`/help` already answers the same question for its own, separate list
(`src/web/help/HelpPage.tsx` § `HelpContents`): below `lg` the search box sits above the sections,
and the list is folded under a line reading *Contents*, shut until pressed.

## What we will do

**Below 1024px, the same `<nav>` is drawn in the page's own column instead of being hidden**: the
search box, then a *Contents* button that opens the list. From 1024px up the list is where it
was and looks as it did, with two differences: on a touch screen the search box's type is 16px, so
iOS does not zoom into it, and the list comes after the page's title in tab order, not before.

```
  phone, list shut                 phone, Contents pressed
  ┌──────────────────────────┐     ┌──────────────────────────┐
  │ ← Back to the article    │     │ ← Back to the article    │
  │ The title of the piece   │     │ The title of the piece   │
  │ author · site · 12 min   │     │ author · site · 12 min   │
  │ [Archive] [Share]        │     │ [Archive] [Share]        │
  │ ┌──────────────────────┐ │     │ ┌──────────────────────┐ │
  │ │ Search this page     │ │     │ │ Search this page     │ │
  │ └──────────────────────┘ │     │ └──────────────────────┘ │
  │ Contents ›               │     │ Contents ⌄               │
  │                          │     │ │ In one sentence        │
  │ In one sentence          │     │ │ What it cost           │
  │ ┌──────────────────────┐ │     │ │ Run a mode again       │
  │ │ …                    │ │     │ │ …                      │
```

1. **One element, two placements.** The `<nav>` loses `tw:hidden`. Its fixed position, width,
   `max-height` and `z-index` become `lg:` classes; below `lg` it is an ordinary block with a
   top margin (a bottom one would collapse into the next section's). One input and one list, so there is no second copy of the query or of the
   entries.
2. **It moves inside each page's `<main>`**, to the place the narrow version belongs: on Metadata
   after the title, facts and Archive/Share row and before the first section; on `/profile` after
   the one-line introduction and before *Account*. At `lg` it is `position: fixed`, so where it
   sits in the markup does not move it. It is not a `[data-section]`, so the scan of `<main>` does
   not list it.
3. **A *Contents* button, drawn only below `lg`**, with `aria-expanded` and an `aria-controls`
   that names the list by a `useId` id (two of these pages can be mounted at once). It holds one
   boolean, `open`, false to begin with, and below `lg` the list is hidden while `open` is false.
   **While the search box holds a query the button is not drawn and the matches are shown
   directly**, as on Help, because a search whose results are folded away looks like a search that
   found nothing. Clearing the box puts the button back, as it was. So whenever the button exists,
   `aria-expanded` is true exactly when the list is shown.
4. **Pressing an entry does what it does today** (open the section, scroll, focus its heading,
   flash). The list stays as it was; the page has scrolled away from it.
5. **Rows a finger can hit, and a field iOS does not zoom into.** Below `lg` the entries are
   `text-sm` with `py-2`; from `lg` up they keep today's `text-xs`. The input carries
   `tw:any-pointer-coarse:text-base` at every width, the house fix for a Tailwind-sized field
   (`narrow-windows.md` § the utilities layer is out of reach). The app-wide 16px rule is in the
   `app` layer and loses to any `tw:text-*` utility, so today's `text-xs` box already zooms an iPad
   in landscape. Help's search box is `tw:text-sm` with the same gap, and gets the same class.
6. **The "you are here" mark is left on.** It costs nothing and is right when the reader scrolls
   back up.

The page does not get a sticky bar, a drawer or a floating button.

## Options passed over

- **The list open by default below `lg`**, which is the most literal reading of the report.
  Metadata has up to about fifteen sections; at a size a finger can press that is roughly 600px, so
  the first screen of the page on a phone would be the list and nothing else. Help made the same
  call for the same reason. One press on *Contents* gets it, and the search box is always there.
  **This is the one product choice in the plan**, and it is a default that one line changes if Greg
  would rather see the list.
- **A `<details>` element drawn beside a second copy of the list**, which is how Help does it. Help
  needed two copies because a stylesheet cannot hold a `<details>` open at `lg`. A button and a
  boolean do the same with one list.
- **Leaving the `<nav>` a sibling above `<main>`**, drawn in flow there. It would sit above the
  title and the back link, which is the wrong order to read a page in, and outside the column's
  padding.
- **A floating contents button and a drawer** (261002a's idea). A new control and an overlay, for
  something a block above the page does.

## Risks worth checking in a browser

- An ancestor of `<main>` with `transform`, `filter` or `contain` would make the fixed `<nav>`
  position against it instead of the window. The check is the measurement below: at 1024, 1280 and
  1440 the list must be exactly where it was (x 24 to 200, top 96).
- Tab order at `lg` changes slightly: the list is now reached after the page's title rather than
  before it.
- Metadata's `?section=` arrival and the command bar's rows use `useRevealOnArrival`, which this
  does not touch.

## Stages

One stage. It is one component and two mounts.

**Done looks like**

- Tests, red first, in a new `tests/page-contents-narrow.test.tsx` (jsdom applies no stylesheet, so
  these pin behaviour and the hidden-below-`lg` class, not layout): a *Contents* button with
  `aria-expanded="false"` whose `aria-controls` resolves to its own list; pressing it flips that
  and takes the narrow-hidden class off the list; with a query typed there is no *Contents* button
  and the list is not narrow-hidden; clearing the query brings the button back in the state it was
  left; Enter reveals the first match; two instances in one document have different list ids.
  And in the two page tests, placement by neighbours rather than by "somewhere in `<main>`": on
  Metadata the `<nav>` follows the Archive/Share row and precedes the first `[data-section]`; on
  `/profile` it follows the introductory paragraph and precedes *Account*.
- `tests/metadata-page-order.test.tsx` reads the entries as `nav[aria-label] button`, which would
  now count *Contents* as a section. Its query narrows to the list's buttons.
- Metadata's and Profile's existing tests pass.
- A browser check (Sonnet, Playwright) at 390×844, 820×1180, 1024×768, 1280×800 and 1440×900, on
  both pages, light and dark at 390, with a touch screen emulated at 390 and 820 and the search
  box's computed font size read there (16px or more): below 1024 the search box and *Contents* are in the column,
  above the first section, with no sideways scroll; the list opens; a pressed entry opens, scrolls
  to and flashes its section; a query shows matches without pressing *Contents*. From 1024 up the
  list's box is where it is on `dev` today, measured before and after.
- Docs: `reader-profile.md` § The page's six sections, `web-client.md`'s rows for `Metadata.tsx`
  and the shared code, `phone-and-touch.md`, and the comments in `PageContents.tsx`, `Metadata.tsx`
  and `ProfilePage.tsx` that say *hidden below `lg`*. `/help` if it describes the list.
- GPT Sol on this plan before building, and on the code before pushing.

## Plan review

GPT Sol, 2026-10-07 (`261007c-contents-list-narrow-plan-review-sol.md`): **do not build**, on two
established P1s, both right and both folded in above before anything was built.

- **F1 (P1)**: the first draft showed matches while leaving *Contents* reading `aria-expanded=false`.
  Now the button is not drawn while a query is typed (item 3).
- **F2 (P1)**: the first draft said the app-wide rule lifts this field to 16px. It does not reach a
  `tw:` utility. Now `tw:any-pointer-coarse:text-base` at the call site (item 5).
- **F3 (P2)**: `metadata-page-order.test.tsx`'s query. In *Done looks like*.
- **F4 (P2)**: the placement assertion was too weak. Now by neighbours.
- **F5 (P2)**: `aria-controls` needs a unique id. Now `useId`, and tested.

It agreed with shut by default, found no ancestor that would capture the fixed list, and found the
observers settle with the list inside `<main>`.

## What landed

Built as planned, in one stage (`43e261c58`), by an Opus subagent, tests red first. Two things
differ from the first draft: the gap is a top margin on the `<nav>` (a bottom one collapses into
the next section's), and the chevron follows the word *Contents*, as `PageSection.tsx`'s does.

**GPT Sol's code review, 2026-10-07** (`261007c-contents-list-narrow-code-review-sol.md`): **ship
with the fixes made.** F1, F3, F4 and F5 closed.

- **C1 (P1, fixed by the reviewer, red first)**: F2 was only half closed. `text-base` is `1rem`,
  which is under 16px for a reader whose root type is smaller. Both search boxes now carry
  `tw:any-pointer-coarse:text-[max(1rem,16px)]` and `leading-6`. Seven older fields (sign-in, set
  password, Add URL, the shelf's search, the title editor, two on the vouchers page) still carry
  the weaker `text-base`; that is outside this report and has its own queue entry.
- **C2, C3 (P3)**: this plan and `narrow-windows.md` said things C1 made untrue. Corrected.

**The browser check** (Sonnet, Playwright on the box; `/read/fowler-phrenology/metadata` and
`/profile`; 390, 820, 1024, 1280 and 1440 wide) passed every item. No console errors.

| window | list | list left..right, top | *Contents* button | search box type |
|---|---|---|---|---|
| 390×844 | in the column, above the first section | 24..351 | shown, shut | 14px; 16px on a touch screen |
| 820×1180 | in the column, above the first section | 42.5..762.5 | shown, shut | 14px; 16px on a touch screen |
| 1024×768 | fixed in the margin | 24..200, 96 | not drawn | 12px; 16px on a touch screen |
| 1280×800 | fixed in the margin | 24..200, 96 | not drawn | 12px |
| 1440×900 | fixed in the margin | 24..200, 96 | not drawn | 12px |

- Below 1024: no sideways scroll, shut or open. Pressing *Contents* shows the list; rows are 35px
  tall at 14px type. A pressed entry opens its section, brings its heading to 96px from the top
  where the page can scroll that far, and flashes it; nothing covers the heading. *cost* on
  Metadata and *dark mode* on Profile show their match with no *Contents* button, Enter goes to
  it, and Escape puts the button back, still shut.
- From 1024 up the list's box is the one 261002a and 261003n measured (24..200), and the page's
  text starts at 216 at 1024, clear of it. The same-day comparison against an unchanged dev server
  was not done, because none was running; the comparison is with those two plans' recorded figures.
- Help's search box is 16px on a touch screen at all three widths.
- Not checked: Escape after the list had been opened with *Contents* (the unit test covers the
  state coming back as it was left), and the dark Profile screenshots were taken but not looked at.

Shots: [phone, shut](261007c-shot-390-metadata-shut.png) ·
[phone, open](261007c-shot-390-metadata-open.png) ·
[Profile on a phone, open](261007c-shot-390-profile-open.png).

**Left as it is:** on a touch screen from 1024px up the search box's 16px type sits above 12px
entries. It fits (the placeholder is 124px in 158px) and it is what stops the zoom.
