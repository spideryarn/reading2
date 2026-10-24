# A multi-page article imports from its first page

Report **spya-qkyukr** (#676, admin, 2026-10-23). The measurement behind every number here is
[261024c](../investigations/261024c-multi-page-articles-readability-and-a-cheap-judge.md).

> I would like to be able to import this article just by feeding it the front page and trusting that
> the LLM will do the right thing. … I suspect that Haiku looking at it might be cheap enough to
> justify that for every single HTML page. … so long as it costs only, you know, I mean, ideally less
> than a cent, but a few cents would be fine, I'd conceivably be willing to just do this for every
> single HTML article, because it would be Great not to have to ask the user for input. … most users
> aren't going to really understand that, so it doesn't seem there's much point in asking the user.
>
> — Greg, 2026-10-23, report spya-qkyukr

## The problem

https://superdark.antikythera.org/ is a 2,246-character abstract linking three chapter pages of
120,000, 122,000 and 22,000 characters. Pasting it today gives an article of the abstract, and
nothing says anything is missing: Readability reads the page it is given, the 500-character floor
passes, and the shelf shows a complete-looking article. Mozilla's Readability has no multi-page
support (its issue #12 has been open since 2015; Arc90's original had `findNextPageLink`, and the
rewrite dropped it).

**Gluing the pages together does not work.** Measured: four pages' bodies concatenated into one
document and handed to `readArticle` came back with 119,978 characters — chapter I alone.
Readability picks one best container. Each page has to be extracted on its own and the results
joined.

## What we are building

Every fetched web page gets one cheap model call that answers *"is this page only part of its
piece, and if so which of its own links carry the rest?"* When it says yes, stage 1 fetches those
pages and stores them with page 1 as one document; stage 2 extracts each page as it would alone and
joins them, a heading per page.

```
 stage 1 (fetch)                                              stage 2 (extract)
 ───────────────                                              ─────────────────
 fetch page 1 ─► Readability(page 1) ─► page's own links ─┐
                                                          ▼
                              Haiku: continues? which ids?  (≈ $0.0005, ≈ 3 s)
                                   │ no ─────────────────────► store page 1   ─► as today
                                   │ yes: [L3, L7, L9]
                                   ▼
            fetch each, same site, through fetchDocument
                                   ▼
            one stored document: page 1 + each page's body,     ─► split by part, readArticle
            in order; manifest lists the parts' addresses            each, join with a heading
                                                                     per part, ids namespaced
```

### The judge (built, measured: `src/multi-page.ts`)

- **Input**: page 1's address and title, the first 1,200 and last 600 characters of Readability's
  text and its length, and the page's links to *other pages of the same site* — deduplicated, each
  under an id of ours (`L1`…), with its wording, `rel=next/prev`, whether Readability kept it in the
  article, and its nearest landmark (`nav.chapter-navigation`). At most 250 links.
- **Output**: `{continues, pages: [ids], reason}`, strict schema. An id not on the list refuses the
  whole answer. At most `MAX_CONTINUATION_PAGES` (20) further pages.
- **Model**: Haiku 5.5, as Greg named, job `multi-page`, the Anthropic-only route the other cheap
  page-reading jobs use, effort `low`.
- **No links, no call.** Any failure of the call (timeout, refusal, malformed answer) means the page
  is imported alone, exactly as today, with a warning in the log.

Measured on 32 real pages (the investigation has the tables): 46 of 48 scored decisions right with
the first prompt, whose one false follow (a blog's series index) went from 2 of 6 runs to 0 of 6
with two added sentences; then **72 of 72 with the final prompt over three runs**, median $0.0005 a
call (max $0.0017), median 2.1 s, p95 7.9 s.

### Stage 1: following the pages

In the `fetch` step, after `fetchByAddress`, only for a document that is **fetched HTML, not a paper
source and not converted** (an arXiv HTML page or a Europe PMC JATS is one document by
construction, and an upload has nothing to follow):

1. Readability on page 1 — **a single plain parse, not `readArticle`'s two arms**: measured,
   `readArticle` takes 3–6 s on a 1–2 MB page, and stage 2 runs it anyway. A recognised bot check
   (`isChallengePage`) or no article: no call.
2. `pageLinks`, `judgeMultiPage` under `ctx.signal`.
3. If it continues, fetch the pages in order through the step's own `DocumentFetcher`
   (`fetchDocument`, so the scheme allow-list, the address guard and its DNS pinning, the redirect
   limit and the byte cap all apply), at most 4 at a time. **Each must still be the same site after
   redirects, and HTML.** A page that fails, redirects off-site, is a PDF, or duplicates one already
   held is **skipped**, and the step's detail says how many of how many were read. Stop adding pages
   once their stored bytes together pass `MAX_STITCHED_BYTES` (to be set from the corpus; the
   largest page here is 2.2 MB).
4. Store one HTML document — page 1's own document with each later page's `<body>` appended in a
   marked section of ours (`data-spya-part`, registered in `src/reserved.ts`, after scrubbing every
   reserved attribute each page arrived with), carrying that page's own `<title>` text, which stage
   2 needs for the part's heading — through a new seam beside `writeConvertedRaw`. Stage 2 scrubs the
   part attribute from a single page too, so a page cannot forge one into the reading view. The
   manifest gains **`parts`: the continuation pages' final addresses, in order**, persisted as
   `article_revisions.raw_part_urls text[]` (one additive migration). `sha256`/`bytes` keep
   describing page 1 as it arrived, as for every fetched document; `storedSha256` is the document we
   built, so any change to any page changes it.
5. The step's `detail`: `fetchDetail` plus *"4 pages"* (or *"3 of 4 pages"*).

**Why one stored document and a column, not one object per page.** One object per page means a
child table keyed to `raw_sources`, a manifest that is a list, and every reader of the raw source
(`readRawBytes`, `GET /api/source/:slug`, `db:export`/import, the PDF-page re-count) learning
about lists. One document keeps every one of them working unchanged, and `/api/source` shows the
pages stacked, which is what was read. The column is what makes the split *trusted*: a publisher
can write `data-spya-part` into its own page, so stage 2 splits only when the manifest says there
are parts, and refuses a document whose sections do not match the list (our bug, not the reader's).

### Stage 2: extracting each part

An Opus spike prototyped this on superdark, Tom's Hardware and gradual-disempowerment and ran stage
3's real `splitIntoBlocks` on the result; what follows is its design, with the measurements. On
superdark: 266,524 characters, 344 blocks, three chapter headings, no repeated block, every one of
chapter I's 18 internal links retargeted inside its own part.

A sibling of `readArticle`, **`readParts(parts)`**, returning `readArticle`'s own type, so that
`runExtract` changes by one line and `debugPage` not at all:

1. **Split** the stored document by the manifest's `parts`: page 1's whole document, and for part
   *k* a document of a minimal head — its own `<title>`, which stage 1 keeps on the section — and
   that part's body, with its own address as the base.
2. **`readArticle` on each.** Page 1 gives all the metadata — title, byline, authors, date, ids,
   excerpt, `opening`, `untitled`, `drawnTitle` — exactly as today; a `ChallengePage` or no article
   on page 1 refuses as today. A later part that Readability declines or that is a bot check is
   **dropped and logged**, not fatal. `textContent` is concatenated (the title tidier reads it),
   `length` summed, `notes`, `callouts`, `removed` and `kept` summed per field.
3. **Join**: part 1's content with no heading of ours, then for each later part an **`<h1>`** of
   ours and its content. `h1` because Readability turns every `<h1>` it keeps into `<h2>`
   (Readability.js 828–832) and strips the one matching the title, so ours is always shallower than
   every author heading; nothing downstream special-cases an `h1` after block 0. Its words: the
   part's own raw `<title>` with the separator-segments it shares with page 1's `<title>` removed
   (*"CHAPTER II. THE DARK STACK"*; Tom's Hardware's raw titles give *"AMD Ryzen 9 9950X Gaming
   Performance"*, where Readability's title, from `og:title`, is the same on all five pages); if
   nothing is left, and the part's content does not open with a heading of its own, *"Page k"*;
   otherwise none. Marked with a reserved attribute of ours, scrubbed from every page on the way in
   (`prepareDocument`), so a page cannot forge one.
4. **Namespace each later part's anchors.** Every `id`, `a[name]` and `map[name]` gets `p{k}-`, and
   every same-document reference — `href="#…"`, `xlink:href`, `usemap`, the ARIA id-lists, `for`,
   `headers`, `url(#…)` — is rewritten through the same map, *whether or not the part defines the
   target*, so a dead link stays dead instead of landing in part 1. Measured: gradual-
   disempowerment had 7 duplicate ids and 3 footnote links landing on the previous page's
   footnote; namespaced, none. **Except note ids**: `NOTE_ID_PATTERN` (src/notes.ts) would reject a
   prefixed `spya-note-…` and stage 3 would silently drop the note's identity, so a note id that
   collides takes a `-2` suffix instead, consistently across `id`, `data-spya-note`,
   `data-spya-note-ref`, `data-spya-note-back` and the hrefs. Callout context ids
   (`mintContextId`) the same way.
5. **One notes container.** Every part's `section[data-spya-notes]` items are moved into one
   container at the end of the article. Measured on two gwern essays joined: with one container per
   part, `splitBlocks` in src/supplement.ts reports the notes *stranded* (they must be one run
   ending at the last block) and drops the Notes node for the whole article, and the reading view
   draws the notes heading only once (src/web/notes-view.ts). Merged: one region, 68 of 68 markers
   and back-links landing right.
6. **Repeated furniture**: a block of 60 or more characters whose text equals one already in an
   earlier part is dropped (Tom's Hardware repeats *"Why you can trust Tom's Hardware"*, a
   newsletter box and an author bio on every page — 12 blocks).
7. **The floor** (`TooLittleTextToRead`, `capabilityFloor`) is applied to the **joined** text: a
   541-character landing page followed by chapters is not too little.

Re-extraction reads the same stored document and is deterministic; Refresh re-runs stage 1 and
so asks the model again.

## What it costs, and what it gives up

- **Every web import** pays one call, about $0.0005, and waits longer in `fetch`: a median 2.1 s
  for the call (p95 7.9 s, slowest 33.6 s on Wikipedia under four concurrent calls; one round-1
  call timed out at the then 15 s limit, hence 30 s), plus one plain Readability parse, which is
  under a second on a normal page and a few seconds on a 2 MB one. Greg's budget was under a cent.
- **A followed article is still one slot.** A web page has always been one slot whatever its size,
  and 20 further pages is the bound. A PDF of the same 266,000 characters would be about three
  slots. *Not asked: one slot is what a long single page costs today, and changing it is a
  separate billing decision.*
- **The Medium shape.** "Same site" is the host, `www.` aside, so on a host where many authors
  publish under paths (`medium.com/@a`, `sites.google.com/view/a`) a hostile page could have
  somebody else's page on that host appended to itself. The reader asked for the hostile page;
  what is appended is public. Recorded as a risk, not built against.
- **Chains are not followed.** Only page 1's links are read. Where page 1 links to some of the
  pages and each later page links on to the next (thecompendium.ai links three of its many
  sections), the import is partial and says how many pages it read. A second call on the last page
  read would close it; not built until a reader meets it.
- **No model-written JavaScript.** Greg wondered whether the model might write extraction code. It
  will not run in this process: every page here was server-rendered, and running a stranger-steered
  script is a security change of a different order.

## The simpler options passed over

- **Ask the reader.** Greg's own second choice, and his own objection: *"most users aren't going to
  really understand that"*.
- **`rel=next` and pagination patterns only, no model.** Free and deterministic, and wrong both ways
  on this corpus: of the 9 pages that must be followed, 2 carry any `rel=next` (Tom's Hardware's
  `<link>`, superdark's one `<a>` among its chapter links), while 4 of the 15 that must not be
  followed carry one pointing at a *different* piece (Sphinx, WordPress, Hacker News's More).
  Kept only as a hint to the model.
- **A deterministic pre-filter to skip the call on most pages.** Would save $0.0005 and 3 s per
  import, and every rule tried misses a shape (a landing page with chapters reads like a blog
  front page). Not worth the misses at this price.
- **Glue the pages and let Readability choose.** Measured above: it keeps one chapter.

## Stages

1. **The judge and its eval** — `src/multi-page.ts`, job registration, `evals/multi-page/`, the
   investigation. *Done before this plan was reviewed; the numbers above are from it.*
2. **Stage 1 follows the pages** — the fetch-step integration, the stitched document, the manifest
   field and its migration, export/import, tests with an injected fetcher and gateway.
3. **Stage 2 extracts each part** — the split, per-part extraction, the join, id namespacing, the
   floor on the joined text, tests on a trimmed three-part fixture; a real import of superdark
   against the local stack, read in a browser.
4. **Docs and the note** — fetching.md, content-extraction.md, security-risks.md (the Medium shape),
   the user-feedback note.

Each stage ends with its tests, a GPT Sol review of the code, and a commit.
