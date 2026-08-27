# Changing a saved search's colour

**Built 2026-08-27.** Greg's ask, in full:

> In Search mode, I'd like to be able to change the colour for a given row. Use Sonnet to search for
> a good colour-palette-picker (see [docs/reusable/third-party-library-selection.md](../reusable/third-party-library-selection.md)).
> Then use Claude-in-Chrome to check it's working.
>
> — Greg, 2026-08-27

Until today every saved search's hue was derived: hash the run's id, take a slot in the eight-hue
categorical palette, probe past whatever was taken. Nothing was stored, and
[hit-colours.ts](../../src/web/hit-colours.ts) said in as many words why nothing should be. This is
the change that reverses that, and the doc is mostly about which part of the old argument survived.

Code: [`src/web/hit-colours.ts`](../../src/web/hit-colours.ts) (the assignment),
[`src/web/SearchPanel.tsx`](../../src/web/SearchPanel.tsx) § `ColourPicker` (the control),
[`src/web/useSearch.ts`](../../src/web/useSearch.ts) § `recolour` (the write),
[`src/searches.ts`](../../src/searches.ts) § `withColour` (the rule both stores share),
[`src/store/pg-searches.ts`](../../src/store/pg-searches.ts),
[`drizzle/0016_search_colour.sql`](../../drizzle/0016_search_colour.sql), and `§ The colour picker`
at the end of [`src/web/styles.css`](../../src/web/styles.css).

```
 ┌──────────────────────────┐
 │ ☑ arguments against sub… │          ┌───────────────┐
 │   12 passages            │◀─────────│ ■ ■ ■ ■       │  eight hues, 4×2
 │              🎨  ↺   🗑   │          │ ■ ■ ■ ■       │
 ├──────────────────────────┤          │  Automatic    │  ← the ninth choice
 │ ☐ anywhere he gives num… │          └───────────────┘
 │   4 passages             │
 └──────────────────────────┘
        ▲
        the row already says its colour twice — the box and the left edge —
        so the picker's trigger is an icon rather than a third coloured thing
```

## The old argument, and which third of it changed

[hit-colours.ts](../../src/web/hit-colours.ts) rejected storing a colour on 2026-08-26:

> Storing the colour on the run means a schema change, a migration, and a server that has an opinion
> about the palette — for a value that is derived.

Three objections. The first two were real and have simply been paid: there is a column, there is a
migration, and both are small. **The third one was never an objection to the field.** It was an
objection to storing a value *nobody had an opinion about* — and a colour the reader picked is not
derived from anything.

The seam it was really protecting is intact, and that is the part worth checking rather than
assuming:

| | Knows the slot number | Knows the hue |
|---|---|---|
| Postgres / `searches.json` | yes | **no** |
| `src/routes.ts`, `src/searches.ts` | yes | **no** |
| `hit-colours.ts`, `SearchPanel.tsx` | yes | **no** |
| `styles/colourscales.css` | yes | yes |

Nothing in TypeScript ever holds `#4477aa`. A swatch is `var(--cat-${i}-rgb)` and a choice is the
number `i`. A palette change is still one edit in one stylesheet.

**The paragraph in hit-colours.ts is deliberately left standing.** It is still the right answer to
the question it was asked. A run with no `colour` is assigned exactly as it describes, and still
moves when the search above it is deleted.

## Why the check on the column is looser than the palette

There are eight hues; the column allows sixty-four. That is not slack, it follows from the table
above: the database does not know what a slot *is*, so a bound at 8 would be the schema holding an
opinion it has no way to keep current.

The two ways of being wrong are not symmetrical, which is the whole argument:

- **Too loose.** A reader on some future nine-hue build stores a 9; today's `assignSlots` ignores it
  and the row falls back to its automatic hue. Visible, harmless, self-correcting.
- **Too tight.** The palette grows, and every choice past the old end is refused by a constraint
  nobody thought to migrate. That looks like a broken button, and the reader has no way to tell why.

`MAX_STORED_COLOUR` in [`src/searches.ts`](../../src/searches.ts) is the same number for the same
reason. The one thing checked strictly is the *kind*: a float or a string reaches the browser as
`var(--cat-2.5-rgb)`, which is not an error anywhere and paints nothing at all —
[silent-success](../reusable/silent-success.md) with a colour on it.

## Sixteen hues, and why the automatic set stayed at eight

Greg, once the picker existed:

> And add more colours, arranged more naturally.
>
> — Greg, 2026-08-27

**Two numbers now, and the gap between them is the design.** `CATEGORICAL_SLOTS`
is 8 — what the hash hands out on its own — and `PALETTE_SLOTS` is 16, what the
picker offers. Growing one number instead of two would have been simpler and
wrong twice:

- **Every saved search would have changed colour.** The automatic slot is
  `hash32(id) % CATEGORICAL_SLOTS`; change the modulus and every run in every
  article lands somewhere else. Silently, once, to everybody — the exact thing
  hit-colours.ts exists to prevent.
- **The distinguishability argument would break where it matters.** Eight is the
  top of the range anyone claims is reliably distinguishable, and the automatic
  set is the hard case: nobody chose those hues, several are overlaid on one
  paragraph, and the reader is telling apart searches they never coloured. A hue
  somebody picked on purpose is a different question.

So a slot of 11 is a perfectly good stored colour that no automatic assignment
can ever produce. Everything that *paints* had to move to the bigger number —
`isPaletteSlot`, `annotate.ts`'s range guard, `TableView.tsx` — because a guard
still bounded at eight would have dropped every hand-picked colour in the second
half of the palette and drawn the paragraph as though the search had matched
nothing.

**One constant turned out to be two.** `TableView.tsx` capped the bar down the
left of a paragraph at `CATEGORICAL_SLOTS`, which was the right number for the
wrong reason: the cap is really *how many `td.text.has-hit[data-hues="N"]` rules
`styles.css` defines*, because that gradient's stops are written out per count.
It is now `BAR_HUES`, and it is pinned against the stylesheet by a test — set
`data-hues="9"` with eight rules and **no** rule matches, so the bar paints
nothing at all rather than losing its ninth stripe.

The new hues fill the gaps rather than extending the list: Okabe–Ito's seven
chromatic hues cluster three-in-the-warms with four gaps of 58–84°, and the
additions land so that fifteen chromatic hues sit 21–32° apart the whole way
round. Generated at the highest chroma sRGB will hold, capped so none shouts
louder than the originals, and every lightness checked against the page.
[colour-scales.md](../project/colour-scales.md) has the numbers and the honest
cost under dichromacy.

**"Arranged more naturally" is a checked property, not a hand-list.**
`PALETTE_BY_HUE` orders the grid and is an array of slot *numbers*, so the seam
holds — but it has to agree with a stylesheet it cannot see. So it is not
trusted: `tests/hit-colours.test.ts` reads `colourscales.css`, converts every
triplet to OKLCH and requires the array to be sorted by hue angle. Achromatic
slots sort last, which is where the neutral belongs; giving a colourless colour
a hue angle would have parked the grey in the middle of the spectrum.

## Two passes, not one

`assignSlots` now reserves every chosen slot **before** a single automatic run probes. One ordered
walk would have been shorter and wrong: an automatic run created *earlier* would probe into a slot a
later run was pinned to, and the reader's choice would then be pushed elsewhere — depending on the
hash, so right most of the time and wrong for no visible reason.

And **two chosen runs may share a hue**. If the reader pins two searches to the same colour, they get
it. That is an instruction, not a collision; a picker that quietly moved the second one would be the
panel arguing with the reader. It is also exactly what the one-pass version does by accident, which
is why `tests/hit-colours.test.ts` pins it.

## The library survey, and why the answer was "none"

Following [third-party-library-selection.md](../reusable/third-party-library-selection.md). Checked
2026-08-27:

| Package | Weekly downloads | Latest release | React 19 | Verdict |
|---|---|---|---|---|
| `react-colorful` | 5.92M | 5.8.0, 2026-07 | `>=16.8` | wrong problem |
| `react-aria-components` (`ColorSwatchPicker`) | 4.09M | 1.20.0, 2026-07 | explicit `^19` | right shape, wrong seam |
| `@uiw/react-color` | 162K | 2.10.3, 2026-05 | current | same problem, less adoption |
| `react-color` | 2.18M | 2.19.3, **2020-10** | — | unmaintained |

The selection criteria are about longevity and pretraining data, and by those `react-colorful` wins
easily — 5.9M downloads a week, zero dependencies, 4.8KB gzipped, actively released. **It is still
the wrong tool**, and the reason is the feature rather than the library: it is a picker for an
*arbitrary* colour, and an arbitrary colour is the one thing this control must not offer. The eight
hues were chosen *together* — Okabe–Ito, lifted for a near-black page, three of them moved because
the published values vanish on this background ([colour-scales.md](../project/colour-scales.md)). A
spectrum wheel invites a ninth colour nobody vetted, and the first thing anybody reaches for on a
black page is a dark one that will not be visible.

React Aria's `ColorSwatchPicker` *is* shaped right — a listbox of fixed swatches with real keyboard
semantics — and was rejected for a different reason: it takes a parsed `Color`, so the eight RGB
triplets would have to be mirrored out of `colourscales.css` into TypeScript. That is precisely the
seam the table at the top of this page describes, and a palette change would then mean editing two
files that cannot be checked against each other. It would also be a third UI-toolkit family for
eight `<button>`s, which is a trade this app has declined once already
([web-client.md](../project/web-client.md) § Tailwind and shadcn).

So: **Floating UI**, which is already a dependency for [`Tooltip.tsx`](../../src/web/Tooltip.tsx),
with `useClick` where the tooltip has `useHover`, plus `useDismiss`, `useRole` and
`FloatingFocusManager`. The picker is about forty lines and adds nothing to `package.json`.

No arrow-key roving focus, deliberately: the app has a global ↑/↓ listener
([keynav.ts](../../src/web/keynav.ts)) and the band has its own steppers, so a grid that claimed
those keys would be a third claimant on two of them. Tab reaches all nine cells, which is enough for
nine targets.

## The race worth knowing about

A meaning search takes 15–40 seconds and its row is on screen the whole time, so **recolouring a run
that is still running is an ordinary thing to do.** The `done` frame that arrives afterwards is a
snapshot of the row as the server finished writing it, and that can predate the `PATCH`. Left alone,
the frame paints the run back to the colour it had before the reader pressed anything — and it stays
wrong until a reload, while the disk is correct the whole time.

So `useSearch` keeps a `chosen` map of this tab's own picks and re-stamps every frame with it. A
choice from *another* tab arriving in a frame therefore loses, which is the right way round: the
reader is looking at this one. `tests/use-search.test.ts` has both halves, including `null` —
"automatic" is a choice that has to beat a stale frame too, not the absence of one.

## Slot 0 is a colour and `null` is a command

Written down because every obvious shape of check gets one of them wrong, and both failures are
quiet:

- `if (!colour)` refuses the **first hue in the palette** while accepting the other seven.
- `if (colour !== undefined)` lets a string or a float through to a custom-property name.

The route takes `null` as *put it back on automatic* and refuses `undefined`; `withColour` removes
the key rather than storing a null, so `searches.json` never grows a third state for a field that
has two. There is a test for each of those sentences.

## What it deliberately does not do

- **No colour for a literal (`words`) search.** There is no row to hang it on and nothing is saved —
  `?find=` is the whole of that search's state.
- **No renaming a hue.** "Colour 3" is the only name these have; naming them *blue*, *vermilion* and
  so on would be a second vocabulary that goes wrong the day a hue moves.
- **No per-article palette, and no new hues.** Eight is the top of the range the research is willing
  to call distinguishable ([colour-scales.md](../project/colour-scales.md) § How many is too many).

## What the cross-family review found

Seven findings, [written up in full](search-row-colour-code-review-sol.md), **all of them real and
all of them fixed.** Worth listing here because five are the kind that pass every test you would
think to write:

1. **A pin stopped being a pin once the palette filled.** The probe loop gives up at eight and
   restores its hashed first choice — which could be somebody's chosen slot. The reservation test
   used eight runs and could not see it. A ninth search must repeat an *automatic* hue, because the
   pin is the only colour here that was supposed to mean something.
2. **The filesystem store dropped the colour on a retry; Postgres kept it.** `withRun`'s reset
   rebuilds the run field by field — deliberately, so a failed attempt leaves nothing behind — and
   the colour was not in the list. The two stores disagreed, and neither test combined a retry with
   a colour.
3. **Two quick picks could persist in the wrong order.** Two independent `PATCH`es with nothing
   sequencing them: pick 2 then 4, let 4 land first, and the screen shows 4 while the store holds 2.
   Nothing looks wrong until a reload. Now one promise chain per run.
4. **`.srch-swatches` was already taken** — by the three-hue specimen strip in the results legend,
   a few hundred lines up the same file. The two silently merged: the legend picked up a border, a
   background and a drop shadow, the picker picked up the legend's `display` and gap, and both still
   rendered. A jsdom test cannot see this, and it is the one finding a browser pass would have
   caught immediately.
5. **The stores did not do what the contract said they did.** The contract claimed both check
   `isStorableColour`; in fact only the route did, so the importer could have written a `2.5` on
   files, and the same bad call answered as a 400 on one store and a database failure on the other.
6. **`aria-pressed` followed the drawn hue rather than the choice**, so a row on automatic announced
   a colour as pressed while "Automatic" — the thing actually selected — announced nothing. The
   panel now says both facts and marks them differently: a faint ring for *what this row is showing*
   and the strong one for *what you chose*.
7. **A bare JSON `null` body was a 500.** `null` is valid JSON, destructuring it throws, and the
   generic handler calls that a server fault. The same hole is latent in the other `PATCH` routes
   here.

It also corrected a comment: `modal={false}` means focus is **not** trapped, which is the behaviour
wanted and the opposite of what the docstring claimed.

## Checked

- `tests/hit-colours.test.ts` — the pin, the reservation, two searches sharing a hue, an
  out-of-range slot falling back rather than clamping. The reservation test was watched going red
  against a one-pass implementation.
- `tests/searches.test.ts`, `tests/store-searches-pg.test.ts` — both stores, including slot 0,
  clearing back to *absent*, recolouring a `pending` run without disturbing its attempt, and the
  database refusing a slot no palette will have.
- `tests/routes.test.ts` — the validation, all four shapes of it.
- `tests/use-search.test.ts` — the mid-stream race above, watched going red without the fix.
- `tests/search-colour-picker.test.tsx` — the panel mounted and the picker pressed: the popover
  opens, reports the slot pressed (including 0), sends `null` for Automatic, acts on the row whose
  trigger was pressed, marks both facts, closes on Escape, and asks for a palette reference rather
  than a colour. Its first draft failed six tests at once because **the panel lists newest first**
  and the fixture is oldest first — the picker was fine and the test had the order backwards, which
  is why rows are now addressed by the words on them.

**Not checked in a browser, and this is the one gap.** Greg asked for a Claude-in-Chrome pass and
the extension was not connected (`list_connected_browsers` returned `[]`), so there is no honest
way to claim it. Two things only a real browser can judge are therefore unverified: **where
Floating UI puts the panel** at the narrowest band (288px, hard against the left of the reading
column — `flip` should swing it, and nothing here proves it does), and **whether the two rings read
as two different things** at 1.35rem on a near-black ground.

There is a throwaway preview page for exactly that pass — `preview-colour.html` and
[`src/web/preview-colour.tsx`](../../src/web/preview-colour.tsx) — which mounts the real
`SearchPanel` with fixture runs, outside the auth gate and with no article, session or model call.
Open `http://localhost:<vite port>/preview-colour.html`. **Delete both files once the pass is
done**; they are not in the router and nothing links to them.
