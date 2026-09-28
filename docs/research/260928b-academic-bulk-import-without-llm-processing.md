# Bulk import for academics, without paying for the model

Status as of 2026-09-28: **not built; questions for Greg.** Greg asked whether a reader with a big
library of papers could upload PDFs, or a bibliography export (BibTeX, Zotero, Papers, ReadCube),
and browse them on the shelf with the new facet filters without us paying a model to process every
one. He said to build it if there is a clean way and to write it up if not. This is the write-up:
the code says there is no clean *flag* to add, because today an article cannot exist on the shelf
until a paid step has run for it. A separate, bibliography-only kind of shelf row would be clean
enough, but it is a new feature with its own table and its own limits, not a switch. Nothing in
`src/` changed for this document.

> Potential future idea: for academics with big libraries of papers, maybe we'd allow them to
> somehow upload the PDFs (without yet triggering the expensive LLM processing?) and/or a
> bibliography (e.g. BibTex, or Zotero/Papers/ReadCube dump) so that they could benefit from this
> browsing interface without having to LLM-process thousands of articles. But this might complicate
> things substantially, and raises lots of questions... I guess the storage space for the PDFs and
> basic metadata is cheap for us, it's just the LLM-processing that's expensive. If you can see a
> clean way to do this without incurring much complexity (e.g. flags for whether the LLM-processing
> has happened yet) then proceed autonomously. If it raises questions/complexity, just write this up
> somewhere with some thinking/questions/proposals/concerns, and we'll pick it up another time.
>
> — Greg, 2026-09-28

## What it is for, and how it connects to facets

The facet-terms feature ([../plans/260928a-shelf-facet-terms.md](../plans/260928a-shelf-facet-terms.md),
being written in parallel) lets a reader narrow the shelf by keywords and keyphrases picked out of
each article's text by ordinary counting, with no model involved. It needs clean text for each item,
and nothing else. So in principle it works for anything we hold text for, processed or not.

An academic's shelf is where that would pay off most. Someone with 2,000 papers in Zotero gets little
from a shelf that holds the twelve they have ingested so far. If the other 1,988 were on the shelf as
lightweight entries, the facets would let them browse the whole collection, and they would pay for
the full reading view (a slot, as today) only for the papers they actually open to read.

## Background, in plain words

- **Ingest**: turning a URL or an uploaded file into an article. It is a list of steps, `STEP_ORDER`
  in [`src/step-order.ts`](../../src/step-order.ts). A plain Add runs `DEFAULT_INGEST_STEPS` in
  [`src/pipeline.ts`](../../src/pipeline.ts): `fetch`, `extract`, `blocks`, `hierarchy`, `assets`.
- **Slot**: one successful new ingest, counted against the tier's quota (Free 3 for life, Reader
  20 a month, Researcher 150 a month). It exists as a limit on model spend, not as an invoice
  ([../project/billing.md](../project/billing.md)).
- **Revision**: one extraction of an article, stored in `article_revisions`. An article appears on
  the shelf only once a revision has been **published**, meaning `articles.current_revision_id`
  points at it.
- **Text layer**: the text a born-digital PDF already carries, which pdf.js can read for free. A
  scanned PDF has none. Our code calls the free read of it **pass 0**.
- **Stub**: the name used below for a shelf entry that has not been through the paid steps.

## What exists today, and the facts that decide it

Checked against the tree on 2026-09-28.

| step | calls a model? | notes |
|---|---|---|
| `fetch` | no | also verifies an upload's bytes and counts a PDF's pages |
| `extract`, web page | no | Readability |
| `extract`, PDF | **yes** | a model transcribes the pages, checked against the text layer ([../project/content-extraction.md](../project/content-extraction.md)). A second, small model call reads the front matter ([`src/pdf-frontmatter.ts`](../../src/pdf-frontmatter.ts)) |
| `blocks` | no | sanitise, split, mint stable ids |
| `hierarchy` | **yes** | the tree and its gists. The one paid step *every* article pays for |
| `labels`, `arc`, the modes | yes | already on demand, not part of a plain Add |
| `assets` | no | "the one stage that calls no model" ([../project/architecture.md](../project/architecture.md)) |

**1. PDF text extraction is a model call, but a free text extractor is already in the code.** Stage 2
for a PDF is a model reading the pages. The scorer that checks it, however, starts from `pass0` in
[`src/pdf.ts`](../../src/pdf.ts), which is pdf.js reading the text layer page by page, with repeated
running headers and footers already identified (`Pass0.furniture`). That costs no model money, and
it is good enough for keyword counting, though not for reading: it comes out as lines, not
paragraphs. It takes 3.7 to 6.9 seconds of server time for a 144-page paper (measured 2026-09-04,
recorded above `countPdfPages` in `src/pdf.ts`), and it gives nothing for a scanned PDF.

**2. The shelf cannot hold an article without a tree, and the tree is paid for.** This is the decisive
fact. `publishRevision` refuses a revision with no tree or no blocks (`"it has no tree"`,
[`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)). `onTheShelf()` in
[`src/store/pg.ts`](../../src/store/pg.ts) takes a null `current_revision_id` to mean *a first ingest
that failed*, and `listArticles` drops it. The tree comes from `hierarchy`, which is a model call. So
"an article with a not-yet-processed flag" is not one new column. It would be a third state for an
article, alongside published and failed, and at least 16 non-test files in `src/` read
`currentRevisionId` (`grep -rln currentRevisionId src --include=*.ts | grep -v test`, 2026-09-28):
the shelf, the public shelf, the public reader, export, find-article, the glossary store, the
pipeline itself. Every one would have to learn what a stub is.

**3. Most of the cost of an ingest is the tree, not the PDF.** A 14-page PDF costs $0.31 to ingest,
of which extraction is $0.05
([../../evals/results/cost-per-article-2026-09-03.md](../../evals/results/cost-per-article-2026-09-03.md)).
So skipping extraction alone saves little. The money is saved only by skipping `hierarchy`, which is
what makes the reading view work. At that rate, 1,000 papers ingested in full would cost roughly $300.

**4. Today the slot quota is also what limits storage.** `POST /api/uploads` refuses at the door when
the reader has no slots left ([../project/billing.md](../project/billing.md), the table under *Which
requests spend a slot*). [../project/security.md](../project/security.md) names the upload endpoint as
"an open storage quota and an open wallet", bounded by the page cap and the object cap. A way to
upload that does not spend a slot removes the first of those bounds, so it has to come with a limit
of its own.

**5. Uploads go from the browser, one file at a time, and the tab must stay open.** The bytes go
straight from the browser to Supabase Storage on a signed grant, and closing the tab loses an upload
in flight ([../project/ingest-queue.md](../project/ingest-queue.md#uploading-a-pdf)). Jobs are also
driven from the open tab ([ingest-queue.md § The browser is the worker](../project/ingest-queue.md#the-browser-is-the-worker)).
A thousand PDFs is a thousand grants and a thousand PUTs from one tab. That is possible, but it is
not what the current picker, `uploadEngine` or the upload record were designed for.

**6. The reading view copes with missing optional steps, but not with a missing tree.** A missing arc
falls back to the root gist, and missing labels say *"Paragraph labels are still arriving"*. Both
assume there is a tree. There is no reading view for "we have the PDF but have not read it".

## The options

### (A) Bibliography-only entries

The reader uploads a BibTeX, RIS or CSL-JSON file (Zotero exports all three; Papers and ReadCube
export BibTeX and RIS). Each entry becomes a row holding title, authors, year, venue, abstract, DOI
and URL. There is no article body and no PDF.

- **Schema**: a new table of its own, say `library_entries(owner_id, title, authors, year, doi, url,
  abstract, source_format, imported_at, article_id null)`, **not** extra rows in `articles`. That keeps
  every one of the 16 readers in fact 2 unchanged. `article_id` is filled in when the entry is
  promoted to a real article, so an entry and its article are one card, not two.
- **Facets**: from title and abstract. That is thinner than full text, but it is the author's own
  summary of what the paper is about, which is roughly what a facet should pick up.
- **Promotion**: "Read this" is an ordinary `POST /api/jobs {url}` using the entry's DOI or arXiv
  URL, so it is an ordinary ingest that spends an ordinary slot. No new billing path at all. When the
  URL is paywalled the fetch fails, as it does today, and the reader uploads the PDF instead, again
  through today's upload path.
- **Slots**: an entry spends none, because it costs no model money. It needs its own cap instead
  (entries per account, and a size limit on the imported file), because storage stops being bounded
  by slots (fact 4).
- **Reading view**: none. The card opens a small detail panel (metadata, abstract, a *Read this*
  button), not `/read/<slug>`.
- **Libraries**: `citation-js` (reads BibTeX, RIS and CSL-JSON through plugins),
  `@retorquere/bibtex-parser` (the BibTeX parser Better BibTeX for Zotero uses). CSL-JSON is plain
  JSON. Names only; not evaluated.
- **Privacy**: a bibliography is a detailed record of what somebody reads, so it goes in
  [../project/privacy.md](../project/privacy.md), in export, and in account deletion. Entries must
  never reach the public shelf.
- **What it costs**: one table, one parser, one import route, a card variant, a detail panel, and a
  cap. What it gives up: no full text, so no passage search and thinner facets. Nothing for the
  reader who has a folder of PDFs and no reference manager.

### (B) PDF upload, text layer only, full processing on demand

The reader uploads many PDFs. We store them and run pass 0 to get their text for facets. A PDF gets
the model extraction and a tree only when the reader opens it, and it costs a slot then.

- **Schema**: the same separate table as (A), with an `object_key` for the stored PDF and a text
  column (or a table of per-page text) holding the pass 0 output. It cannot go through
  `revision_blocks`, because blocks hang off a revision and a revision cannot be published without a
  tree (fact 2). So the facets would read two sources, the published blocks and the stub text, and
  that is the braid "prefer simple" warns against.
- **Promotion**: an ingest whose `fetch` step already has its bytes. The code nearly supports this
  already, since an upload record's canonical object is `sha256/<hash>.pdf`, but a slot spent long
  after the upload, on an upload record that has been sitting `verified` for months, is a new state
  for `upload-records.ts` and `billing/admission.ts` to handle.
- **Slots and storage**: the upload no longer spends a slot, so a free account could store thousands
  of PDFs at up to 50 MB each (`MAX_UPLOAD_BYTES`, [`src/uploads.ts`](../../src/uploads.ts)). This
  needs a per-account byte cap, a sweep of abandoned staging objects (not built:
  [ingest-queue.md § Abandoned uploads are not swept](../project/ingest-queue.md#abandoned-uploads-are-not-swept-and-nothing-sweeps-them)),
  and a decision on whether free accounts get it at all.
- **Server time**: pass 0 is free of model money but not of Vercel time (fact 1). A thousand papers is
  on the order of an hour of function time, run through the job queue with the tab open.
- **Title and authors**: without the front-matter model call, the title comes from the PDF's
  metadata, which is often a filename in disguise (`Pass0.metaTitle`'s own comment), or from the
  first large line on page 1. Titles will be worse than an ingested article's.
- **Privacy**: thousands of copyrighted papers in our storage, and cross-reader deduplication by
  content hash reveals whether *somebody else* uploaded the same file (security.md, the paragraph
  cited in fact 4). With one reader this does not matter. With many academics sharing a field, it
  starts to.
- **What it costs**: everything in (A) except the parser, plus bulk upload, the text store, a second
  source for facets, a storage cap, a sweep, a promotion path through billing, and scan handling.
  What it gives up: nothing on the reader's side. It is the full version of the idea, and it is
  several plans.

### (B′) The tempting shortcut: a free tree

We could make "processed" cheap instead of optional by building a flat tree without a model, so that
a stub passes `publishRevision` and every existing reader of `currentRevisionId` just works.
**Rejected**: the tree *is* the granularity-zoom structure, and a fake one would show readers a
zoom with nothing to zoom into and gists that are not gists. Pass 0 text is lines, not paragraphs,
so the blocks would be poor as well. It would also make "has this been read by the model?" a question
about what is inside a tree, not a column anyone could query.

### (C) Do nothing yet

Facets ship for ingested articles only. What it costs: an academic gets facets over the papers they
have paid for, which on Reader is at most 20 a month. What it gives: no new state, no new storage
exposure, and time to see whether anyone uses facets on a shelf of 20 before we build for a shelf of
2,000.

## Is it clean? Testing the judgement

Greg's test was "flags for whether the LLM-processing has happened yet". **A flag on `articles` is not
clean**, for reason 2: an article's existence on the shelf is defined as having a published revision
with a tree, and the tree is the paid step. A flag means a third article state that 16 files would
have to learn, including the public paths where a mistake leaks.

**A separate entries table (A) is clean in shape.** It touches no existing article code, promotion
reuses the URL ingest unchanged, and billing needs no new path. But it is not small: a table, a
migration, a parser dependency, an import route with its own cap, a new card variant on a shelf with
[a lot of rules already](../project/library.md), a detail panel, export and deletion. That is a plan
with stages and two reviews, not something to do on the side of the facets work. So the orchestrator's
judgement stands: not now.

## Questions for Greg

1. **Who is this for first?** A reader with a reference manager (they have a `.bib` file, so option A
   serves them) or a reader with a folder of PDFs and no metadata (only option B serves them)? A
   serves the first cheaply; B is several times the work.
2. **Would title and abstract be enough to browse by?** If facets over abstracts feel useful, A is
   enough. If you would only want this with full text, it is B or nothing.
3. **Should free accounts get bulk import?** An entry costs us no model money, but storage and rows
   are no longer bounded by slots. Options: Researcher tier only; every tier with a cap (for example
   5,000 entries, or 2 GB of PDFs); or free with a small cap as a taste of the paid tiers.
4. **When a reader opens a stub, should it spend a slot without asking?** Or should it say "this will
   use 1 of your 17 remaining articles" first? Today Add always spends one, and nobody is asked.
5. **Where does a stub open?** A small detail panel with a *Read this* button (simplest), or the
   reading view in a stripped-down state (much more work, fact 6)?
6. **Scanned PDFs** have no text layer, so under B they would have no facets. Acceptable, or a reason
   to prefer A?
7. **Re-import**: when the same `.bib` is uploaded again next month, match entries by DOI and update
   them, or add duplicates? (Matching by DOI is easy; entries with no DOI are the hard part.)
8. **Does this wait for evidence that facets are used?** C, then A, is the cautious order.

## Recommendation

**Do not build it now** (option C). Ship facets over ingested articles, and see whether readers use
them.

**The smallest first step worth doing later is A, bibliography-only entries, in their own table.**
It saves the most model money, since nothing is processed at all. It needs no new billing path,
because promoting an entry is today's URL ingest. It leaves every existing reader of `articles`
untouched. And it serves the academics most likely to have thousands of papers, because those are
the ones with a reference manager. B can be added on top later (a PDF attached to an entry) if A is
used and readers ask for full text, and the separate table gives it somewhere to go.

Before building A, the facet plan should keep its text source behind one function ("give me the text
to count, per shelf item"), so that entries can feed it later without a second path through the
facet code. That is a small request to
[../plans/260928a-shelf-facet-terms.md](../plans/260928a-shelf-facet-terms.md), and the only part of
this document that bears on work happening now.

## Sources, 2026-09-28

- The shelf rule: `onTheShelf()` and its comment, [`src/store/pg.ts`](../../src/store/pg.ts); the
  refusal, `"it has no tree"` in [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts).
- Steps and defaults: [`src/step-order.ts`](../../src/step-order.ts), `DEFAULT_INGEST_STEPS` in
  [`src/pipeline.ts`](../../src/pipeline.ts).
- The PDF path and pass 0: [../project/content-extraction.md](../project/content-extraction.md),
  [`src/pdf.ts`](../../src/pdf.ts), [../plans/260826c-pdf-ingestion.md](../plans/260826c-pdf-ingestion.md).
- Costs: [../../evals/results/cost-per-article-2026-09-03.md](../../evals/results/cost-per-article-2026-09-03.md)
  (measured 2026-09-03; one 14-page PDF, so the $300 figure above is an extrapolation, not a
  measurement).
- Slots and uploads: [../project/billing.md](../project/billing.md),
  [../project/ingest-queue.md](../project/ingest-queue.md), [../project/security.md](../project/security.md).
- Library names in option A are from memory and were not checked against npm today.
