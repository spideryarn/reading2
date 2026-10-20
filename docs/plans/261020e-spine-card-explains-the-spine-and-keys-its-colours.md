# The spine's card explains the spine, and keys its colours

Two admin reports from Greg, filed a minute apart (overseer queue item `qi-cz29kr96`):

> In the tooltip for the Spine, also explain to the user what the Spine means/how it works/what all
> the colours etc connote.
>
> — Greg, 2026-10-19, `spya-ah5ws6`

> The search results should show up in the Spine (and stay up to date as you change the threshold).
> And perhaps any other modes that similarly should show up in the Spine.
>
> — Greg, 2026-10-19, `spya-u8stc4`

## What is already true (checked before planning)

A Sonnet browser pass on the box (Playwright, local dev, `scaling-hypothesis` and
`fowler-phrenology`, 2026-10-20) found:

- **Search results already paint into the spine**, one lane per search down its right edge
  ([search.md § The rail](../project/search.md#the-rail-and-the-shape-of-a-search), since
  2026-08-26). A words search for *scaling*: 65 passages in the list, 29 `.spine-match` marks (one
  per paragraph). The dock's quick-search box opens Search mode and paints too.
- **They already follow the threshold.** With the meaning search on *Prioritised*, the slider at
  30 / 69 / 88 / 92 gave "20 of 20" / "7 of 10" / "4 of 10" / "1 of 10" in the list and 20 / 7 / 4 /
  1 marks on the rail. That is by construction: `keepAbove` runs once in `SearchMode.tsx` and the
  rail, the prose and the list all read the result
  ([SearchMode.tsx § results](../../src/web/modes/search/SearchMode.tsx)).
- **What does not reach the spine:** a search started from a button inside a chat answer
  (`ChatSearchCard`; `selectPassages` answers nothing for `chat`); Ideas and Timeline until a row is
  pressed (then only that row's passages); Glossary terms; FAQ and Sources passages.
- **The card says nothing about the spine itself.** It names the section under the pointer, its
  place, words, matches and "% in". The legend exists only on `/help/spine`, which nothing on the
  spine links to.

So the search half is mostly already built; what Greg probably did not have is any way to tell the
marks are search matches, which is the first half of the request. The two halves meet in the key.

## What we build (simplest version)

**A key at the foot of every spine card**, under the footer and above the touch hint:

```
 ┌──────────────────────────────────────────┐
 │  (outline · gist · sub-sections · foot)  │
 │ ──────────────────────────────────────── │
 │ The spine is the whole article, top to   │
 │ bottom, to scale. Point to read a        │
 │ section; click to go there.              │
 │ ▮ you are here  ▭ on screen  ▮ quotes    │
 │ ▮▮ search matches  ◢ time spent reading  │
 └──────────────────────────────────────────┘
```

- **One sentence on what the spine is and how to use it**, always.
- **A chip for each kind of mark the rail is drawing right now, and only those** — a swatch in the
  mark's own colour token and two or three words. Always: *you are here* (`--depth-1`, the section
  fill) and *on screen* (the `--highlight` box). When present: *back matter* (faint parts), *time
  spent reading* (`--read-time`), *where you jumped from* (`--ink-faint`), *quotes*
  (`--quote-rgb`), and the lane marks, one swatch per lane in that lane's colour, labelled by the
  mode drawing them (*search matches* in Search; *this idea*, *this event*, *referee passages* in
  the others).
- Why only what is drawn: a full legend is nine rows on a card that cannot scroll (`SPINE_LIMITS`),
  most of them about marks that are not there. Keying what is on screen is shorter and is the
  question a reader is actually asking ("what is that purple?").
- The full legend stays on `/help/spine`; the key ends with *More in Help › Reading the spine* as
  plain text, because the spine's cards deliberately do not take the pointer (Tooltip.tsx), so a
  link in one could never be clicked.
- `/help/spine` gets a sentence saying the card carries the key.

Code: a pure `spineKeyItems(...)` and a `SpineKey` component in a new `src/web/spine-key.tsx`,
computed once in `Spine` from what it already has (`hereRing`, `quoteStrip`, `readPaths`, `from`,
`lanes`/`marks`, supplement bands) and handed to `BandCard`. The lane label comes from a new
`Spine` prop, `marksLabel`, which `Reader` derives from the mode with an exhaustive switch beside
`selectPassages` (reader/passages.ts), so a new passage-producing mode is a compile error until it
names its marks. Tests in `tests/spine-card.test.tsx`: the key lists what is drawn and nothing that
is not (search lanes appear only with matches, quotes only with quotes, one swatch per lane).

## Deferred, named, and asked

The rest of the second report is a product call, so it goes to Greg as a question
(`docs/user-feedback/questions/`) and a queue entry, not built here:

1. **Where were the search marks missing for you?** They show and follow the threshold in Search
   mode; if Greg was looking at a chat-started search, a phone (the spine is narrower or hidden), or
   something else, that names the fix.
2. **Which other modes should paint the rail by default**: chat search cards (needs a rule for
   several cards at once), Ideas and Timeline showing *every* row's passages before one is pressed
   (the prose marks only the pressed one today, so the rail would need its own source — the
   passages feed both), Glossary terms (a different currency, `termSelections`), FAQ and Sources
   passages.

## Simpler option passed over

A static, complete legend in every card (or a `title` attribute on the `<aside>`). Simpler, but
nine rows on an unscrollable card, mostly describing marks that are not on the rail; and a native
`title` cannot hold colours. The adaptive key costs one pure function.

## Trade-off named

In a window taller than 600px, the key is on every card, every time, so the card grows by about three
lines for a reader who already knows the spine. Kept small and faint like the footer. If it proves
noisy, the obvious next step is to show it only for the first few cards, or only while a mark the
reader has not seen is on the rail — deferred until somebody says it is noisy.

## Stages

1. Plan, GPT Sol plan review (read-only).
2. Build: `spine-key.tsx`, `Spine` + `BandCard` wiring, `marksLabel` in Reader/passages, CSS in
   `tooltip.css`, help page sentence, tests. Typecheck, spine tests, browser look (Sonnet). GPT Sol
   code review (workspace-write). Full `npm test`, push to `dev`.
3. Bookkeeping: user-feedback note, question file, queue entry for the deferred half, endings,
   queue item done.

## What landed, and what the reviews changed (2026-10-20)

Plan review: [-plan-review-sol.md](261020e-spine-card-explains-the-spine-and-keys-its-colours-plan-review-sol.md).
Taken:

- **F1 height.** The key is hidden in windows 600px tall or shorter (`tooltip.css § .tip-key`); the
  browser pass found the worst card ends inside the window at 1440×900 and 1280×700.
- **F2 accessibility.** The key is `aria-hidden` (the card is every band's description), and the
  band's accessible name now counts the lane in the open mode's words — it said "search matches"
  in Ideas. `railMarks(mode)` returns a `RailMarks` (`label`, `one`, `many`), as module constants
  so the memoised `Spine` is not redrawn per render.
- **F3 help page.** `/help/spine` said Quotes and Skim draw right-edge lanes (they draw the left
  quote strip, which it did not mention). Corrected, and it now says search marks follow the
  threshold.
- **F5 wording.** The sentence names the tinted bands (parts) and hairlines (sections); lanes come
  from the drawn `marks`, back matter only when its band has height.
- **F6.** The non-clickable "More in Help" line is gone.

Not taken: **F4** (fold the words into `selectPassages`' return). Real but small; the limitation is
written on `railMarks` instead. **The suggested gate→rail regression test**: the threshold path is
`keepAbove` in `useSearchMode` → `onFound` → `Reader` → `Spine`, and a test needs the whole search
hook mounted; the browser pass's counts (30/69/88/92 → 20/7/4/1) are the evidence, recorded above.

Browser pass on the built key (Sonnet, Playwright, both themes): swatches match the rail; the "on
screen" and back-matter swatches were too pale in light mode and are drawn a little stronger.

Code review ([-code-review-sol.md](261020e-spine-card-explains-the-spine-and-keys-its-colours-code-review-sol.md),
workspace-write): three findings, all fixed by the reviewer and read before commit — the card's
visible count still said "matches" in every mode (now `marksWords.one`/`.many`, as the button
does); tests added for each optional chip, the height cutoff, the swatch tokens and `railMarks`'
identity, each mutation-checked red; docs said "under 600px" where the rule is `max-height: 600px`.
The deferred half is queue item `qi-bp4ez3yc`, asked in
[q-je2p9y](../user-feedback/questions/q-je2p9y.md).
