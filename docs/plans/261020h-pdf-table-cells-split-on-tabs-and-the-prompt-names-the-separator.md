# A PDF's table cells split on tabs, and the prompt names the separator

Report `spya-xn4597` (#660, `SPIDERYARN-READING2-MS`), from Greg (admin, `feedback-reporter.ts`
exit 0), 2026-10-19 21:56 UTC. Overseer queue item `qi-akgxffbb`.

> The user Adrian just imported an article about sentience in animals, and a lot of the figures
> didn't seem to import. You have permission to read the production database to have a look and try
> and figure out why. You don't need to re-import that article, but ideally let's try and improve
> things so that going forwards it would have worked.
>
> — Greg, 2026-10-19

## What happened to Adrian's article

Production, read only (`begin read only … rollback`; the PDF and five figure objects read from the
bucket with GET). The article is `review-of-the-evidence-of-sentience-in-cephalopo-spya-fd0ger`,
imported 2026-10-19 19:36 UTC on build `8e1fd75a`: the LSE report *Review of the Evidence of
Sentience in Cephalopod Molluscs and Decapod Crustaceans* (Birch et al., 2021), 109 pages, printed
to PDF from Firefox through macOS Quartz (14.6 MB; the LSE's own file is 4.0 MB).

What the document holds that is a picture or a picture-like thing, page by page (every page
rendered and the captions found by a pdf.js survey):

| what | page | in the article |
|---|---|---|
| Figures 1–5 (photos, a plate, two key figures) | 14, 15, 41, 47, 85 | **all five stored and served** — the five `/api/asset/…` requests answered 200 at 19:41:17 |
| Table 1 and Table 3 (colour-coded VH/H/M/L grids) | 12, 43 | cells shown, **header row one cell short**, so every criterion sits one column left of its letters |
| Table 2 and Table 5 (the same grids) | 24, 81 | **each row is one cell**: the model separated cells with tabs, and the renderer splits on `\|` only |
| Table 4 (fishing gear) | 61 | fine |
| cover photograph (hermit crab) | 2 | `failed`, `uncaptioned` — the import ran before 261019j was deployed |
| foreword portrait | 6 | the transcription gave it no record, so there is no marker to recover |

So the figures did import. What looks like missing figures to a reader is the report's central
graphic — the colour grid of confidence levels, printed four times — arriving as two misaligned
tables and two collapsed into a column of run-together text, with the cover photo gone.

### The class, across production

Of 421 `tabledata` records in production's stored PDF transcriptions (9 articles with tables):

- 44 records in 4 articles separate cells with **tabs** and no `|`. Each renders as one cell per row.
- 318 records in 2 articles (an arXiv paper with 304, an economics paper with 14) separate cells with
  **runs of spaces** — `GDP, pct. above the no-AI path 6.4 8.3 9.1 10.0 …`. Nothing after the fact can
  split these reliably: a space is also inside a cell.

At the time, the prompt named no separator. `tableRows` said: *"The prompt does not name a separator,
and on the eval corpus the model writes `a | b` unprompted"*. It mostly did, and a third of the
articles that had tables showed that "mostly" was not enough.

## What we will do

*Revised after GPT Sol's plan review ([261020h-plan-review-sol.md](261020h-plan-review-sol.md),
verdict REWORK; each finding and what was done with it is under § The plan review, below).*

**Stage 1 — the parser.** In `tableRows` (`src/pdf-read.ts`), a line with a tab is split on tabs,
keeping an empty first, middle or last cell; a line without one is split on `|` as before, for every
chunk read before Stage 2. A blank row is skipped; a dash-only row is kept, because `---` can be a
printed missing-data marker and the parser cannot tell it from invented Markdown. No stored record
mixes tab and bar separators, so preferring tabs changes nothing already in production.

**Stage 2 — the prompt names the separator: a tab.** Rule 7 now says: one tab between cells, a
newline between rows, one row or several to a record; these tabs and newlines are structure, not
copied text (or rules 1 and 2 would forbid them); an empty cell is nothing between two tabs, the blank
corner over row labels included; a wrapped cell is one cell; never spaces or `|`, never an unprinted
`---` row. A tab rather than `|` because a PDF prints no tab, so the separator can never be the
author's own character, where `|` is in prose and in TeX such as `\(P(A | B)\)` (Sol, finding 4).
This is what fixes the space-separated case and the missing corner, which no parser can.

It changes `promptFingerprint`, so a re-extraction of an existing PDF re-reads every chunk rather than
replaying the cache — the fingerprint's intended behaviour, and re-extraction is rare.
`PROMPT_VERSION` goes to `pdf-v5`, so `meta.method` says which prompt read an article.

**Measured before it landed**, per [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change):
production's own reader on seven table-bearing chunks of six production PDFs, old prompt twice and new
prompt twice, scored against hand-checked cell grids rather than width screens (Sol, finding 6).
[261020b](../investigations/261020b-pdf-table-separator-named-in-the-prompt-measured.md) has the
method and the numbers. In short: the old prompt's separator varied call to call (bars 9, tabs 4,
spaces 1 in 14 reads, the same chunk differing between runs) and the old parser drew one-cell rows on
4 of them; the new prompt used tabs on all 14 reads, wrote the blank corner every time, and left the
prose where it was.

**The block ids are unaffected.** A table's block text is its cells with a space at each boundary and
whitespace collapsed (`extractText` in `src/blocks.ts`), so a row drawn as one cell and the same row
drawn as nine have the same text; a test now says so (Sol, finding 5). Only the html changes. A
re-extraction under the new prompt is a new model reading, and can change ids for the ordinary reason
any re-read can.

## Not doing, and why

- **A picture of every table beside its cells.** It would bring back the colour, which on this
  report carries the same information as the letters (the caption spells out the key). It is a real
  product choice — every table stored twice, a second thing to show — so it goes to Greg as a
  question rather than being built.
- **The foreword portrait.** The transcription never recorded it; nothing downstream can find a
  figure the transcript missed (the same limit as Rovelli p34 in
  [261019a](../investigations/261019a-uncaptioned-pdf-figures-located-on-rovelli.md)).
- **The cover photo.** [261019j](261019j-uncaptioned-pdf-figures-located-by-their-neighbours.md),
  now deployed, was built for uncaptioned figures. A spike ran this tree's `collectPdfFigures` with
  the real locator over the article's stored html and the PDF (6 locator calls): the five captioned
  figures still store, and the cover still does not. The locator pointed at the right box, but the
  Quartz print cut the photo into two abutting image paints, so `judgeLocatedBox` refuses it as
  `assembly`, and the composite route that renders a model's box is caption-only. Loosening that is a
  change to a safety rule in the locator, so it is queued as its own proposal, `qi-r6f9s4f9`, rather
  than folded in here.
- **The header-corner guess.** Stage 1 first put an empty cell in front of a first row one short of
  rows that agreed on a width. Withdrawn on Sol's finding 1: a short first row does not prove which
  cell is missing, and a spanning header or a sparse continuation would be shifted silently. The
  prompt now asks for the corner, and the measurement shows it written every time.
- **Re-importing Adrian's article.** Greg said not to; it is a production write. A re-extraction
  after the deploy would bring back all five tables with their cells aligned; the colour would still
  be gone, which the letters and the caption's key already carry.

The simpler option passed over: Stage 1 alone. It fixes every tab-separated table at no model cost,
but it leaves the space-separated tables broken and the corner missing, and the prompt silent on the
one thing the parser depends on — which the measurement shows is a coin toss per call.

## The plan review

GPT Sol, read-only, [261020h-plan-review-sol.md](261020h-plan-review-sol.md), verdict REWORK.

1. *Blocker — the corner guess is not narrow enough.* Agreed; withdrawn (above).
2. *Tabs at the line's edges are trimmed away.* Agreed; a tab line is no longer trimmed of tabs, and
   tests cover a leading, middle and trailing empty cell, a bar inside a tab row, and an uncertain
   tab row.
3. *"One record per row" is broader than needed.* Agreed; the rule allows one row or several.
4. *`|` is ambiguous; prefer tabs, forbid markdown rows.* Agreed, and the deciding argument: the
   prompt names a tab and the parser prefers it. Rule 7 forbids invented `---` rows. The proposed
   parser-side skip was withdrawn in code review: a printed `---` missing-data row has the same
   shape, so dropping it would silently discard the author's data.
5. *Say what happens to ids and caches.* Done above, with a test.
6. *Width screens reward the wrong thing; score against checked grids.* Done:
   [261020b](../investigations/261020b-pdf-table-separator-named-in-the-prompt-measured.md).
7. *Update the `pdf-v4` assertion and the stale comments.* Done: `tests/pdf-tex.test.ts`, the
   `tableRows` and `SYSTEM` docblocks, `tests/pdf-tables.test.ts`'s header and
   [content-extraction.md](../project/content-extraction.md).

## Results

Both stages built; the measurement is above and in 261020b. Adrian's own stored records, re-rendered
with the new parser (no model call): Tables 2 and 5 go from one cell per row to nine cells per row.
All four grids keep their missing corner (a header of eight over rows of nine), since only a re-read
under the new prompt writes it; the measurement's re-reads of Tables 2 and 5 have it.
The postmortem is [261020a](../postmortems/261020a-a-table-parser-relied-on-a-separator-the-prompt-never-named.md).
