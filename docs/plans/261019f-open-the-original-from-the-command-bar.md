# Open the original from the command bar

Report `spya-r6a5s5` (#610, SPIDERYARN-READING2-K1), Greg, 2026-10-18, on an uploaded book:

> I want a way to be able to open the original from the command bar. I tried typing original into
> the command bar and didn't find anything.

## What exists

- The **masthead** links a web article's address (`OriginLine` in `src/web/Masthead.tsx`).
- The **Metadata page** links it too, and for an uploaded file it offers **View the original**
  (`SourceLink`, `src/web/SourceLink.tsx`): an authenticated fetch of `GET /api/source/:slug` handed
  to a tab opened synchronously on the click, because a plain link cannot carry the bearer token.
- The **command bar** has no row for either. `original` matches nothing.

## What we will do

One typed-only action row, **Open the original**, built beside Export and Archive
(`article-commands.ts` for the words, `CommandBar.tsx` § `metadataRows` for what Enter does).

What "the original" is, decided once in `SourceLink.tsx` as `originalOf(meta, owner)`:

| The article | The row | Enter does |
|---|---|---|
| has a web address (`webSource`) | *Open the original* — "The page it was made from, at `<host>`, in a new tab." | `window.open(url, "_blank", "noopener,noreferrer")` |
| an uploaded PDF (`meta.source === "pdf"`), owner | *Open the original* — "The PDF you uploaded, in a new tab." | the same fetch `SourceLink` does, moved into a function both call |
| anything else | no row | — |

Then the pages that mount the Dock (the reading view and the Metadata page) hand `original` in
beside `shelfRow`, through the Dock to `CommandBarArticle.original`.

- **Words**: the label carries `original`; aliases `view the original`, `original page`,
  `original pdf`, `original file`, `publisher`, `source page`, `source url`, `where it came from`.
  Not bare `source`, which is a prefix of the **Sources** mode and must stay its.
- **`opensOnly: false`**, so a row the model picks from a sentence is drawn and waits for an Enter
  rather than running after an `await`. A tab opened after an await is blocked by the browser, and
  the symptom is nothing happening. The typed Enter calls `run()` synchronously inside the key
  handler, so the popup is allowed.
- **A failed PDF fetch** closes the blank tab and keeps the bar open with `SourceLink`'s own
  sentence (`Couldn't open the original. … [source-open]`).
- The catalogue (`src/command-pick-catalogue.generated.json`) is regenerated with the row, so the
  model can name it.

### A bug fixed on the way

The Metadata page offers **View the original** for an uploaded HTML file
(`meta.source === "pdf" || convertedFormatFromName(filename) === null` — an `.html` name is not a
converted format). The route serves only PDFs (`sendSource` → `readPdf`, which refuses anything
else because HTML from our origin is stored XSS), so that button can only answer 404. `originalOf`
uses `meta.source === "pdf"`, the rule the route enforces and `hasOriginalPdf` already states, and
the Metadata page uses `originalOf` too, so the bar and the page cannot disagree.

## Deliberately not

- **"Saved from" pages** (an uploaded HTML file's own claim about where it came from). The app
  words that as *Saved from `<host>`*, never as the original, because we never fetched it. A row
  for it can come later, under its own name, if anyone asks.
- **⌘-click / a real link**: the rows are `div`s by design (CommandBar.tsx § activate).
- **A visitor**: the bar is mounted only for the owner today. The rule still withholds the PDF arm
  from a non-owner, so the day that changes it stays right.

## Simpler option passed over

Only the web arm (a `<a href>` the row opens) — half the size, but Greg's report was on an uploaded
book, where that row would not exist, which is the case he hit.

## What the plan review changed

GPT Sol, read-only ([review](261019f-open-the-original-plan-review-sol.md)):

- **F1, the actual cause of the report**: `original` *did* match something — the **Plain** mode,
  which carried it as a nickname (added by 261004k). Greg typed it meaning the publisher's page and
  got a row that shuts the band. The nickname is removed from Plain; it is this row's word now.
- **F2**: a double press on Stop presses Enter from an effect when the words arrive, possibly after
  the browser's activation has expired. The row asks `navigator.userActivation.isActive` first, and
  without a gesture opens nothing and says *"Choose it again to open the original in a new tab."* — no key named, since a finger has none
- **F3**: one fixed description for both kinds and no host — *"The web page or the PDF this article
  was made from, in a new tab."* — because the command-pick catalogue holds one entry per
  (id, label), and words that moved with the article would be frozen there as one article's.
- **F4**: fewer, literal aliases — `view the original`, `view original`, `open original`,
  `original page`, `original pdf`, `source page`.
- **F6** confirmed the Metadata bug.

## Tests

- The row appears for each case and not otherwise, and `original` ranks it first
  (`tests/command-bar.test.tsx` style).
- Enter on the web row calls `window.open` with the address and `noopener`.
- The Metadata page no longer offers *View the original* for an uploaded HTML file
  (written red first).
