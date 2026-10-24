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
pages and stores each beside page 1, in order; stage 2 extracts each page as it would alone and
joins them.

```
 stage 1 (fetch)                                              stage 2 (extract)
 ───────────────                                              ─────────────────
 fetch page 1 ─► readArticle(page 1) ─► page's own links ─┐
                                                          ▼
                              Haiku: continues? which ids?  (≈ $0.0005, ≈ 3 s)
                                   │ no ─────────────────────► store page 1   ─► as today
                                   │ yes: [L3, L7, L9]
                                   ▼
            fetch each, same site, through fetchDocument
                                   ▼
            page 1 stored as today; each further page its own   ─► readArticle on each page,
            stored object, listed in order in                        join the authored content,
            article_revision_parts                                   ids namespaced, notes merged
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
call (max $0.0017), median 2.1 s, p95 7.9 s. **What that number is and is not** (Sol F8, F11): it
scores the yes/no decision, not whether every page was picked, and it is the corpus the prompt was
fixed against. So the eval also scores the pages picked against gold, and a held-out set of pages
gathered after the prompt was frozen is run before this ships; both are in the investigation.

### Stage 1: following the pages

*Revised after GPT Sol's plan review
([261024p-plan-review-sol.md](261024p-plan-review-sol.md)); the first version stored all the pages as
one stitched document, and F1, F2 and F12 there are why it no longer does.*

In the `fetch` step, after `fetchByAddress`, only for a document that is **fetched HTML, not a paper
source and not converted** (an arXiv HTML page or a Europe PMC JATS is one document by
construction, and an upload has nothing to follow):

1. **`readArticle` on page 1**, the same call the eval measured (Sol F7). Stage 2 runs it again,
   which costs 3–6 s more on a 1–2 MB page; a single plain parse would have saved that and fed the
   judge an input nobody measured. A recognised bot check or no article: no call.
2. `pageLinks`, `judgeMultiPage` under `ctx.signal`.
3. If it continues, fetch the pages through the step's own `DocumentFetcher` (`fetchDocument`, so the
   scheme allow-list, the address guard and its DNS pinning, the redirect limit and the per-document
   byte cap all apply). **Each must still be the same site after redirects (`sameSite`: host with or
   without `www.`, same port, never https→http), and HTML.** A page that fails, redirects off-site,
   is not HTML, or duplicates one already held is **skipped**. **A shared budget of
   `MAX_PARTS_BYTES`** (30 MB across the continuation pages; one bucket object is capped at 50 MiB,
   and the largest page in the corpus is 2.2 MB) is reserved before each fetch, not checked after:
   each fetch is capped at what is left, so the total can never pass it (Sol F6).
4. **Each continuation page is stored as its own source object**, exactly as page 1 is — the same
   content-addressed `raw_sources` row and bucket object, its own `<head>`, its own CSS, its own
   address. A child table **`article_revision_parts`** (`revision_id`, `ordinal` from 1, `url` the
   final address, `raw_source_sha256` + `raw_source_kind` a foreign key onto `raw_sources`; primary
   key `(revision_id, ordinal)`) lists them in order; the manifest gains `parts: {url, storedSha256,
   sha256, bytes}[]` read from it. One additive migration.
5. The step's `detail`: `fetchDetail` plus *"4 pages"* (or *"3 of 4 pages"*).

**Why per-page objects, not one stitched document.** The revision's own `storedSha256` is still page
1, byte for byte, so **every reader of the raw source that does not know about parts reads page 1,
which is what it read before** — metadata (which runs Readability once over the whole document and
would otherwise pick one chapter: Sol F1), the PDF-only readers, `db:export`. Only the readers that
should see every page are taught to: stage 2's extract, and the prompt-injection scan of the source
(`scanArticleSource`), which scans each page as its own document with its own CSS (Sol F2) — a
stitched document lost each later page's `<style>` and lent page 1's to it. Nothing in a page can
forge a part: the parts exist only as rows we wrote.

Every path that copies or carries a revision's source (revision copying, `db:export`/import, forced
re-extraction) carries the parts too, with a test each (Sol F9).

### Stage 2: extracting each part

An Opus spike prototyped the join on superdark, Tom's Hardware and gradual-disempowerment and ran
stage 3's real `splitIntoBlocks` on the result. On superdark: 266,524 characters, 344 blocks, every
one of chapter I's 18 internal links retargeted inside its own part.

A sibling of `readArticle`, **`readParts(page1, parts)`**, returning `readArticle`'s own type, so that
`runExtract` changes by one line and `debugPage` not at all:

1. **`readArticle` on each page**, each with its own address as the base. Page 1 gives all the
   metadata — title, byline, authors, date, ids, excerpt, `opening`, `untitled`, `drawnTitle` —
   exactly as today; a `ChallengePage` or no article on page 1 refuses as today. A later page that
   Readability declines or that is a bot check is **dropped and logged**, not fatal. `textContent` is
   concatenated, `length` summed, `notes`, `callouts`, `removed` and `kept` summed per field.
2. **Join the authored content, with no heading of ours** (Sol F3: a heading we wrote would become an
   ordinary author heading in stage 3, in Structure and in the reading view, with nothing to say it
   is ours). The one exception is the page's **own** first `<h1>`: Readability drops the heading
   that matches the title it chose, so a chapter page whose `<h1>` is *"Chapter II. The Dark Stack"*
   loses it. When a later page's extracted content does not open with that heading's text, it is put
   back at the top of that page's content as an `<h2>` — Readability's own level for every `<h1>` it
   keeps — in the author's words.
3. **Namespace each later page's anchors** through one shared helper. Every `id`, `a[name]` and
   `map[name]` gets `p{k}-`, and every same-document reference — `href="#…"`, `xlink:href`,
   `usemap`, the ARIA id-lists, `for`, `headers`, `url(#…)` — is rewritten through the same map,
   *whether or not the page defines the target*, so a dead link stays dead instead of landing in page
   1. Measured: gradual-disempowerment had 7 duplicate ids and 3 footnote links landing on the
   previous page's footnote; namespaced, none. **Except note ids**: `NOTE_ID_PATTERN` (src/notes.ts)
   would reject a prefixed `spya-note-…` and stage 3 would silently drop the note's identity, so a
   note id that collides takes a `-2` suffix instead, consistently across `id`, `data-spya-note`,
   `data-spya-note-ref`, `data-spya-note-back` and the hrefs. Callout context ids (`mintContextId`)
   the same way.
4. **One notes region, moved whole** (Sol F4). Each page's notes — its `section[data-spya-notes]` and
   the authored heading that introduces it (*"Notes"*, *"References"*) when that heading is what
   stands immediately before it — move to the end of the article as one region under one heading.
   Measured on two gwern essays joined: with one container per page, `splitBlocks` in
   src/supplement.ts reports the notes *stranded* and drops the Notes node for the whole article,
   and the reading view draws the notes heading only once (src/web/notes-view.ts). The test runs
   through `splitBlocks` and Structure, not only the markers.
5. **No deduplication** (Sol F5). Tom's Hardware repeats a trust box, a newsletter box and an author
   bio on every page; that stays, because dropping blocks on equal text alone could drop a refrain
   or a repeated quotation, and repeated furniture is the lesser harm.
6. **The floor** (`TooLittleTextToRead`, `capabilityFloor`) is applied to the **joined** text: a
   541-character landing page followed by chapters is not too little.

Re-extraction reads the same stored pages and is deterministic; Refresh re-runs stage 1 and so asks
the model again.

## What it costs, and what it gives up

- **Every web import** pays one call, about $0.0005, and waits longer in `fetch`: a median 2.1 s
  for the call (p95 7.9 s, slowest 33.6 s on Wikipedia under four concurrent calls; one round-1
  call timed out at the then 15 s limit, hence 30 s), plus a `readArticle` on page 1, which is
  under a second on a normal page and 3–6 s on a 1–2 MB one. Greg's budget was under a cent. A
  followed article also waits for its pages to download and is read once per page in stage 2;
  those are the same costs a reader pasting each page would pay.
- **A followed article is still one slot.** A web page has always been one slot whatever its size,
  and 20 further pages is the bound. A PDF of the same 266,000 characters would be about three
  slots. *Not asked: one slot is what a long single page costs today, and changing it is a
  separate billing decision.*
- **The Medium shape.** "Same site" is the host (`www.` aside, same port, never down to http), so on a host where many authors
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
2. **Stage 1 follows the pages** — the fetch-step integration, each page stored as its own source
   object, `article_revision_parts` and its migration, the manifest's `parts`, revision copying and
   export/import, the source scan per page, tests with an injected fetcher and gateway.
3. **Stage 2 extracts each part** — per-page extraction, the join, id namespacing, the notes region,
   the floor on the joined text, tests on a trimmed three-part fixture; a real import of superdark
   against the local stack, read in a browser.
4. **Docs and the note** — fetching.md, content-extraction.md, security-risks.md (the Medium shape),
   the user-feedback note.

Each stage ends with its tests, a GPT Sol review of the code, and a commit.
