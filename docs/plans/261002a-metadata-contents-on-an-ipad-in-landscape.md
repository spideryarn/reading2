# Metadata: the contents list on an iPad in landscape

Greg (admin), SPIDERYARN-READING2-9M (`spya-p6scuf`), 2026-10-01, filed as a suggestion:

> The table of contents for the metadata page is not visible on my iPad, even in landscape mode,
> even though there's quite a lot of space on either side.

Builds on plan 261001s (the search box and the reveal), which left the list's placement alone.

## Why it is hidden

`PageContents` (`src/web/PageContents.tsx`) is `tw:hidden tw:xl:flex`: it shows from 1280px up.
Its comment gives the arithmetic: the page is a centred 48rem column, so 1280px leaves 16rem each
side for an 11rem list at 1.5rem in, and one breakpoint down (`lg`, 1024px) leaves only 8rem —
the list would overlap the prose. An iPad in landscape is 1024px (iPad, iPad Pro 11" is 1194,
Air 1180, mini 1133), so every one of them falls in the gap. Greg is right that there is room; it
is just on the wrong side. Not a regression, so no postmortem: the breakpoint was deliberate.

## The change

From `lg` (1024px) up, show the list, and **push the page column right just far enough to clear
it** instead of hiding the list:

- `PageContents`: `tw:xl:flex tw:xl:flex-col` → `tw:lg:flex tw:lg:flex-col`. Nothing else moves.
- Metadata's `<main>`: at `lg` and up, `margin-left: max(12rem, (100% - 48rem) / 2)` (Tailwind
  arbitrary value), keeping `margin-right: auto`.
  - The list spans 1.5rem → 12.5rem. The column is border-box with 1.5rem padding, so its *text*
    starts at margin + 1.5rem; a 12rem margin puts the text at 13.5rem, a 1rem gap after the list.
  - `(100% - 48rem) / 2` is exactly what `mx-auto` gives a 48rem column, so from 1152px up the
    `max` picks it and the page is centred as today — continuous, no jump at a breakpoint. At
    1280px and up nothing changes at all.
  - Between 1024 and 1152 the column sits up to 4rem right of centre. At 1024px it spans 192–960,
    leaving 64px on the right (49px with a desktop scrollbar); the column keeps its full 48rem.
- **Safe areas** (Sol, plan review): the nav is fixed chrome, so it sits at
  `1.5rem + var(--safe-left)` (tokens.css § safe areas), and the margin floor becomes
  `12rem + var(--safe-left)` so the 1rem gap holds in the installed app and on a phone in landscape.
- Centring returns at 1152px of *containing-block* width plus twice the left inset (so 1152px
  whenever the inset is zero) — a classic scrollbar adds its own width on top, because `100%` is
  the width beside the scrollbar. The 4rem off-centre figure above likewise assumes no inset.
- Update the comment in `PageContents` that says one breakpoint down there is no room, and the one
  in Metadata.tsx that says the list is hidden below `xl`.

### Simpler option passed over

Just switch to `lg:` and narrow the list to fit 8rem of margin. Rejected: 8rem minus the 1.5rem
inset is 6.5rem, too narrow for the search box and for labels like *How well we read the PDF*,
and the list would still sit tight against the text.

### Also passed over

A contents button that opens the list as a drawer below `lg` (iPad portrait, phones). That is the
fuller answer for narrow windows, and it is a new control; deferred until someone asks for it on
portrait. Greg's report is about landscape, where the room exists.

## Checks

No unit test can see this: jsdom does no layout, and a test that the class string says `lg` would
pass whether or not the list overlaps. The check is a browser measurement (Playwright on the box,
Sonnet subagent), on a real article's metadata page at 1024×768, 1133×744, 1180×820, 1280×800 and
1440×900, plus 900×1200 (portrait) — first on the unchanged code to see it hidden (the red), then on
the change:

- the nav is visible at every width ≥ 1024 and hidden at 900;
- `nav.right + 8px <= first prose/heading text left` (no overlap) at each width;
- at ≥ 1152 the main column is centred (left margin = right margin, ±scrollbar);
- with `--safe-left` / `--safe-right` forced to 40px on `:root`, nav and text still do not overlap;
- the search box still works and a click still reveals and flashes (the 261001s behaviour).

Gates: `npm test`, `npm run typecheck`, lint on the two files.

## Review

Sol, plan review (`261002a-…-plan-review-sol.md`): revise — add the left safe inset to both the
nav and the margin floor (done), say the 1152px threshold is containing-block width (done), and
correct two comments that still said `.metadata-page` carries the button-font reset, which has been
app-wide since 2026-09-04 (done). It confirmed the Tailwind class compiles under 4.3.3 and that
nothing else on the page (Dock, toast) is aligned to the centred column.

Sol, code review (`261002a-…-code-review-sol.md`): approve, no runtime defect; it confirmed the
generated CSS puts `tw:lg:ml-[…]` after `tw:mx-auto`, so the left margin is overridden and the
right stays auto. It tightened the threshold wording in both source comments, and asked for the same
in this plan (done above).

## Result

Browser measurement (Playwright on the box), before and after, `/read/fowler-phrenology/metadata`:

| window | before: nav | after: nav L..R | after: text left | after: main gaps L / R |
|---|---|---|---|---|
| 900×1200 | hidden | hidden | 90 | 66 / 66 |
| 1024×768 | hidden | 24..200 | 216 | 192 / 64 |
| 1133×744 | hidden | 24..200 | 216 | 192 / 173 |
| 1180×820 | hidden | 24..200 | 230 | 206 / 206 |
| 1280×800 | 24..200 | 24..200 | 280 | 256 / 256 (unchanged) |
| 1440×900 | 24..200 | 24..200 | 360 | 336 / 336 (unchanged) |

With `--safe-left` / `--safe-right` forced to 40px at 1024: nav 64..240, text at 256, no overlap.
At 1024, search *cost* + Enter scrolled to *What it cost*, opened it and flashed it; a click on an
entry scrolled to its section.
