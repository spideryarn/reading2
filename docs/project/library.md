# The library

The homepage: every article you have run through the pipeline, on one shelf, each one a click away
from the reading view.

> what I'd like to do is to have a homepage that enables us to browse past documents, and then if I
> click on one of the documents, it takes us to this interface that we've been building using a slug
> of the URL … So it might be `/read/[slug]/`.
>
> And for now, I guess, let's stick with JSON for storage, although I imagine we'll switch to a
> database soon, probably Postgres, I guess. So maybe design with that in mind.
>
> — Greg, 2026-08-25

Two things follow from that, and they are the whole design. **The slug moves from a query parameter
into the path**, so an article has an address rather than a setting. And **the storage stays JSON on
disk but is shaped like rows**, so the day it becomes Postgres is a change to one file.

## The routes

| Path | Page |
|---|---|
| `/` | the library — [`src/web/Library.tsx`](../../src/web/Library.tsx) |
| `/read/<slug>` | the reading view — [web-client.md](web-client.md) |
| `/read/<slug>/metadata` | everything we know about the article — [metadata-page.md](../plans/metadata-page.md) |
| `/read/<slug>/tweets` | the article as a numbered thread — [tweet-thread-page.md](../plans/tweet-thread-page.md) |

The shelf's own API surface grew on 2026-08-26: `GET /api/library` (now taking `?archived=1`),
`GET /api/library/search?q=`, `PATCH /api/library/:slug` and `POST /api/library/:slug/open`.
`/api/library/search` is matched **before** the `:slug` pattern, because `search` is a valid slug
shape and the specific pattern has to win — otherwise the search box would read as a request to
rename an article called "search".

**This said "the two routes" until 2026-08-25.** The last two arrived together, and they are one
route with three views rather than three routes: same article, same fetch, same bottom bar, so
`Route` carries a `view` and `ArticlePage` branches on it
([`App.tsx`](../../src/web/App.tsx)). The article payload is fetched above that branch, so stepping
out to the metadata page and back costs nothing.

Everything *else* stays in the query string. The division is worth stating as a rule, because it is
the thing that decides where any future piece of state goes:

**The path says which article, and which of its pages. The query string says how you are looking at
it.**

So `/read/noema-mythology-of-conscious-ai?cols=0,1&at=spya-tgnssb` is one link that carries both, and
[url-state.md](url-state.md) still owns the second half of it. Old `/?slug=x` links are rewritten to
`/read/x` before React mounts, keeping every parameter they arrived with — see
[`main.tsx`](../../src/web/main.tsx), which also sends the two superseded spellings of the article's
details, `?about=1` and `?panel=about`, to `/read/<slug>/metadata`.

The query string travels between the three views, so leaving the article to look at its metadata and
coming back returns you to the paragraph you left. `?panel=` is the exception — it names a drawer,
and a drawer left open across a navigation is not a place you were. That rule is `carriedSearch` in
[`router.ts`](../../src/web/router.ts), and it is one function so that nothing else has to remember
it. The one place `?panel=` is put *back* is the bottom bar's Questions button off the reading view,
where the navigation is for the drawer.

Anything that is not one of those paths is the library, including nonsense — an unrecognised third
segment as much as an unrecognised first one. There is no 404 page on purpose: a mistyped address
lands you on the shelf, which is both a useful place to be and self-explanatory.

**A real path needs a server that knows it.** In development Vite's SPA fallback serves `index.html`
for `/read/anything`, so nothing had to be configured. `npm run build` produces a single
`dist/index.html`, and whatever eventually serves it must do the same — otherwise reloading an
article, or opening a pasted link, is a 404 from the static host rather than anything this code can
answer. That is the one cost of moving the slug out of the query string, and it is worth stating
before somebody meets it as a deployment mystery.

### Fifty lines of router, not React Router

[`src/web/router.ts`](../../src/web/router.ts) is `parseRoute`, `readHref`, `carriedSearch`,
`navigate` and a `useSyncExternalStore` hook. Two routes and one parameter did not seem worth a
provider, a route table and a second history abstraction — and the second one is the real argument,
not the size.
**nuqs can be told to watch `history.pushState`**, so calling `pushState` ourselves means nuqs sees
our navigations exactly as it sees its own. Two libraries both owning navigation is an arrangement
that works until the day it doesn't.

**That is opt-in, and for a while nobody had opted in.** This paragraph used to state the patching
as a property of nuqs. It is not: in nuqs 2.10 it takes a call to `enableHistorySync()`, and until
[`main.tsx`](../../src/web/main.tsx) made one, every `useQueryState` went on serving the previous
page's query string after one of our navigations, and nothing cancelled the debounced `?at=` queue
when the reading view unmounted. Caught by a cross-model review on 2026-08-25, and written up in
[metadata-page.md § What the plan got wrong](../plans/metadata-page.md#found-by-the-cross-model-review).
The argument for hand-rolling the router depends on that one call; if it goes, this section goes
with it.

That sentence used to end *"revisit when a third route arrives with nested layouts"*, and one
arrived on 2026-08-25 — the metadata page shares the article fetch and the bottom bar with the
reading view, which is a nested layout by any reading. It was weighed rather than waved through: the
shell is one branch in `ArticlePage` and one alternation in the regex, still far less than a router
would cost. **The next person to add a route should re-read that argument rather than assume the
question stays settled** — the thing to watch for is a view needing sub-routes of its own, or a
fourth segment. Until then it is still the boring choice, per [AGENTS.md](../../AGENTS.md).

[`Link.tsx`](../../src/web/Link.tsx) keeps ⌘-click, middle-click and "copy link address" working by
rendering a real `href` and only intercepting the plain left-click.

## What you can do to a card

The shelf was read-only until 2026-08-26. Every card was one big link, and the only thing you could
do to an article was open it. Then Greg asked for the verbs:

> On the home page where it shows the docs: add a "Delete" button. Add any other useful buttons you
> think we should add (e.g. "Edit title"). Add a hover-tooltip that displays extra metadata … Add a
> search bar at the top.
>
> — Greg, 2026-08-26

Five buttons, revealed on hover and on focus: **Edit title**, **Re-fetch and rebuild**, **Open the
original**, **Copy link**, **Delete**. Re-run is not new machinery — it is
`POST /api/jobs { slug, force: ["fetch"] }`, the route the add box already uses; without the `force`
the queue skips every step whose artefact is on disk, which is every step.

The plan, the decisions and what was deliberately left out are in
[library-shelf-actions-and-search.md](../plans/library-shelf-actions-and-search.md).

### The card is no longer one big link

A button inside an anchor is invalid HTML and behaves differently in every browser, so the card is
now an `<article>`, the **title** is the link, and the link's `::after` is stretched over the whole
card to keep the card clickable. The action buttons get `position: relative` so they sit above that
pseudo-element. The property being protected is the one [`Link.tsx`](../../src/web/Link.tsx) exists
for: ⌘-click, middle-click and "copy link address" still work, because the title really is an
`<a href>`.

The action row is hidden with `opacity`, **never `display: none`**. A hidden element is not
focusable, so hiding the row until hover would delete it outright for anyone navigating by keyboard —
and every check anybody ran with a mouse would look fine.

### Delete means archive, and Undo is the confirmation

> Archive, with an Undo — the card disappears from the shelf straight away … Underneath, the row is
> flagged hidden rather than removed, so nothing is destroyed.
>
> — Greg's choice, 2026-08-26

So there is **no confirmation dialog**: the Undo strip is the confirmation, and it costs the common
case nothing. `GET /api/library?archived=1` is the other half of the shelf.

A **Show deleted** disclosure at the foot of the shelf is the other way back, and it is not
optional decoration: without it Delete is permanent from the interface the moment the nine-second
Undo strip goes, which would make "nothing is destroyed" true of the database and false of the
product. It does not fetch until opened.

**An archived article is still readable by direct link.** Only the shelf filters. That is a decision
rather than an oversight — the shelf is a shelf, not an access control list, and a link that stops
working is a worse surprise than a card that is out of sight. The library *search* is the exception:
an archived article is out of the index entirely, because a hit that opens an article you deleted
reads as a ghost.

### A renamed title is an override, not an edit

Stage 2 rewrites `meta.json` on every run (see [below](#metajson-and-the-articles-identity)). A
renamed title stored there would work perfectly and be silently undone by the next
`npm run extract` — a bug that reports success, waits weeks, and then looks like the rename never
happened. So the reader's title lives in shelf state and `describeArticle` prefers it, which is why
a renamed article is called the same thing on the card, in the masthead and in the search results.
`tests/shelf.test.ts` re-runs the rewrite and asserts the override survives.

### Shelf state: a fourth kind of reader state

Archived, renamed, and how often you have opened something are all *reader state about an article* —
the same category as comments, chat and saved searches, and not the same category as the article's
text.

| Store | Where |
|---|---|
| `files` | `data/<slug>/shelf.json` — [`src/shelf.ts`](../../src/shelf.ts) |
| `postgres` | four columns on `spideryarn.articles`: `archived_at`, `title_override`, `opens`, `last_opened_at` |

Columns on `articles` and **not** on `article_revisions`, which is the load-bearing part: a revision
is one extraction, and re-extracting must not un-archive an article, forget its title or reset the
count. Reader state outlives revisions — the same rule `block_identities` exists to enforce for block
ids ([block-ids.md](block-ids.md)).

Opens are a counter and a timestamp, deliberately **not** an event log. The tooltip can say "opened
6 times, last on Tuesday" and can never say "three times this week". If that second question ever
matters, the answer is a table of events, not another column.

`POST /api/library/:slug/open` is called by the **client**, from the reading view's mount — not by
the server from inside `GET /api/article/:slug`. A GET that writes is a GET that a prefetch, a retry
or a health check inflates without anybody deciding to.

### The tooltip

Hovering the date line gives everything the card has no room for: when it was added, where from, how
often you have opened it, how many questions you have asked, which optional stages have produced
something, and the size in words, blocks, parts and sections.

**What it deliberately does not say.** Chat threads and saved searches are per-article reader state
that has *not* moved to Postgres — [`src/chat.ts`](../../src/chat.ts) and
[`src/searches.ts`](../../src/searches.ts) write files in both modes, and the `chat_threads` /
`search_runs` tables exist but nothing touches them. A count that reads 7 on the filesystem and 0 in
Postgres is worse than no count at all, because it looks like an answer. They go in when step 10 of
[postgres-storage-implementation.md](../plans/postgres-storage-implementation.md) lands.

## Finding an article, and finding a passage in one

One box at the top of the shelf, **two matchers behind it** — which is the same shape the in-article
search already has ([search.md](search.md)), deliberately rather than coincidentally.

1. **The cards, filtered in the browser.** Case- and accent-folded substring match over `title`,
   `byline`, `siteName` and `gist` — exactly the four fields a card renders, because matching
   something invisible looks like a bug from the outside. Free, instant, no request.
2. **The passages, from the server.** `GET /api/library/search?q=…`, debounced, returning
   `LibraryHit[]`. A result deep-links to `/read/<slug>?at=<blockId>&find=<query>&match=words`, so
   the in-article search lights the same words up when you land — reusing the existing vocabulary
   rather than inventing a third one is what makes that handoff work. `match=words` is said out loud
   rather than left to the default, because on 2026-08-26 that default became `meaning`
   ([search.md § the URL](search.md#match-defaults-to-meaning-and-used-to-default-to-words)); this is
   the one link in the app that produces a bare `?find=`, so it is the one that had to say so.

| Store | How |
|---|---|
| `postgres` | a generated `tsvector` column on `revision_blocks`, GIN index, `websearch_to_tsquery` to parse, `ts_rank_cd` to sort — [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) |
| `files` | scan every `blocks.json` in memory, fold, substring-match, rank by count damped by length — [`src/library-search.ts`](../../src/library-search.ts) |

**The two do not agree, and it is worth being precise about how far that goes**, because the first
version of this paragraph got it wrong. It said they agreed on the *set* of block ids for a
single-word query. They do not: Postgres matches English lexemes, so `writes` finds "writing" and
"write-nots" while `the` finds nothing at all (a stop word); the filesystem scan matches substrings,
so it finds `the` inside "theory" and misses every inflection. Single words were exactly the case the
old claim called safe. A cross-family review caught it, 2026-08-26.

What they *do* share, and what a test may hold them to: an exact word that appears verbatim, is not a
stop word, and has no inflections in the corpus is found by both, in the same blocks. Ranking is
never comparable — `ts_rank_cd` with normalisation flag 1 on one side, a count damped by paragraph
length on the other. The divergence is written down rather than papered over, because a hand-built
near-copy of `websearch_to_tsquery` would be worse than an obviously simpler thing that admits what
it is.

The hit carries **the whole paragraph**, not a snippet, and the client cuts it. Trimming on the
server would mean the two adapters trimming differently — Postgres knows which *stems* matched, not
which characters, so it would either return the whole thing anyway or call `ts_headline` and hand
back a second flavour of highlighting to reconcile with the client's own. One highlighter.

What was considered and deferred, with the research behind it in
[postgres-search.md](../research/postgres-search.md): **BM25** (`pg_search`/ParadeDB is not available
on Supabase at all, hosted or local — what you actually get is `ts_rank`), **`pg_trgm`** for
typo-tolerant titles (available, useful, but matcher one already handles titles in the browser), and
**pgvector + embeddings** for meaning-based search — `vector 0.8.2` is available locally but not
enabled, Anthropic has no embeddings API so it means a second vendor, and Greg deferred it
explicitly.

## What a card says, and why

A card is a **decision aid**, not a summary. You are choosing what to read next, and what decides it
is what the piece says and how long it will take you.

```
┌──────────────────────────────────────────────┐
│ The Mythology Of Conscious AI                │
│ Anil Seth · Noema · 54 min · 139 blocks      │
│                                              │
│ Claims that AI is becoming conscious rest    │
│ on a mythology about intelligence, not on    │
│ evidence about experience.                   │
│ 📄 12,431 words        3 ⌾        25 Aug 2026│
└──────────────────────────────────────────────┘
```

The blurb is **the tree root's `gist`** — one sentence about the whole article, from the same pass
that fills the L0 column ([granularity-zoom.md](granularity-zoom.md)). That is this product's own
idea turned on its own library, and it costs nothing, because the sentence already exists.

Note what is deliberately *not* a fallback for it: **the first arc entry**. An arc sentence says
where the argument stands at the end of part one ([granularity-zoom.md § The arc](granularity-zoom.md#the-arc)),
so using it here would put a sentence about the opening where the reader expects a sentence about the
article — and it would look completely right. The fallbacks are `summary` and then Readability's
`excerpt`, both of which at least mean the whole thing; failing those, no blurb at all.

The reading time comes from [`src/reading-time.ts`](../../src/reading-time.ts), which exists so that
the card and the masthead cannot drift. They run on opposite sides of the wire, so nothing would ever
have told us the card said 47 minutes and the masthead 54 — see
[silent-success.md](../reusable/silent-success.md).

## Adding an article: the box submits now

Paste a URL, press Add, and the five stages tick over while you watch. The article appears on the
shelf the moment the last one finishes — no reload, and no "it'll show up eventually".

**This section used to describe a stub.** It said the box printed four commands for you to run
yourself, and that *"running the pipeline from a request handler means background jobs, progress,
partial failure and a retry path — real work, and not what the experiment is about yet"*. That was
true and it was the right call for a day. Greg asked for the real thing on 2026-08-25, and it kept
the shape the stub promised: the input stayed, and the command list became the progress list.

The queue, the choice of p-queue over the Redis- and Postgres-backed alternatives, what
"idempotent" does and does not mean yet, and why it polls rather than streaming, are all in
**[ingest-queue.md](ingest-queue.md)**.

Two things stayed the same and are worth repeating here. The slug is derived with **the same
function the extractor uses** — [`src/ingest.ts`](../../src/ingest.ts) — so the name on screen is
the name you get, rather than approximately the name you get. And the box is still honest about
failure: a stage that goes wrong stops the job, says which stage and why, and offers a Retry that
skips whatever already worked.

`pipelineCommands` is gone. It existed to print those four commands, and a list of shell commands
that nothing executes drifts from the pipeline silently. The stages are documented in
[setup-dev.md § The pipeline stages](setup-dev.md#the-pipeline-stages), which is where they belong,
and they still run by hand.

## `meta.json`, and the article's identity

The shelf needs a title, a byline, a source and a date, and until now nothing wrote them down —
`data/<slug>/` held blocks, a tree and an arc, and the reading view derived a title from the first
`<h1>`. So stage 2 now writes [`data/<slug>/meta.json`](architecture.md#storage) on every run,
which is where it was always meant to be
([architecture.md § Stage ownership](architecture.md#stage-ownership)):

```json
{ "slug": "…", "title": "…", "byline": "…", "siteName": "…",
  "lang": "en", "url": "https://…", "fetchedAt": "2026-08-25T…", "excerpt": "…" }
```

Two details worth knowing, both in [`src/extract.ts`](../../src/extract.ts):

- **The slug comes from the output filename, not from the URL.** Stage 3 names its blocks file after
  the HTML file and stage 4 names the data directory after *that* ([`src/toc.ts`](../../src/toc.ts)),
  so the basename is what the rest of the pipeline will call this article. Deriving it from the URL a
  second time would be right for `npm run extract <url>` and wrong the moment anyone passed an
  explicit filename — and the only symptom would be an article with no byline.
- **It is rewritten every run**, because re-extracting is how you refresh a page and the fetch date
  should follow.

An article whose `meta.json` predates this still lists: the title falls back to the first `<h1>` and
the date to the mtime of `blocks.json`. It just has no byline and no source link. Re-run
`npm run extract` to fix that.

## When this becomes Postgres

See [database.md](database.md) for the store as a whole, and
[postgres-migration.md](../plans/postgres-migration.md) for the schema and the risks.

[`src/api.ts`](../../src/api.ts) is the seam, and it is the only file that knows there are
directories. Above it the client sees two types, both already shaped as rows:

- `Article` — one article in full, `GET /api/article/:slug`
- `LibraryEntry` — one shelf record, `GET /api/library` ([`src/types.ts`](../../src/types.ts))

Every field of `LibraryEntry` is a scalar a column could hold. Nothing in it is a path, a directory
name that means something, or a nested artefact. So the migration is:

| Today | Then |
|---|---|
| `listArticles()` walks `data/*/`, reads three JSON files per directory | one `SELECT` over an `articles` table |
| counts (`words`, `blocks`, `parts`, `sections`) derived per request | columns, written once at ingest |
| `addedAt` from `meta.fetchedAt`, falling back to file mtime | a `fetched_at` column, no fallback |
| `comments` counted by reading `comments.json` | `SELECT count(*)` or a denormalised column |
| the `example/` fixture, always listed, flagged `fixture: true` | a seed row, or dropped entirely |

The one thing that must survive the move unchanged is **block ids** — they are the join key for
everything a reader has ever pointed at, and they are minted once and preserved. Read
[block-ids.md](block-ids.md) before designing any schema that stores them.

Two things that are *not* ready for a database and should not be dragged in with it: `blocks.json`
is a source artefact rather than a cache ([architecture.md § Storage](architecture.md#storage)), and
the derived tree is regenerated wholesale, so its node ids must never become foreign keys.

## Where the code is

| File | What it does |
|---|---|
| [`src/web/Library.tsx`](../../src/web/Library.tsx) | the homepage: the cards |
| [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx), [`src/web/useJobs.ts`](../../src/web/useJobs.ts) | the add box and the progress list — [ingest-queue.md](ingest-queue.md) |
| [`src/web/router.ts`](../../src/web/router.ts) | `/` vs `/read/<slug>`, and `navigate` |
| [`src/web/Link.tsx`](../../src/web/Link.tsx) | an `<a>` that routes in-page and still behaves like an `<a>` |
| [`src/ingest.ts`](../../src/ingest.ts) | `slugFromUrl`, `isSlug` — shared by the extractor, the add box and the server |
| [`src/api.ts`](../../src/api.ts) | `listArticles()`, `describeArticle()` — **the Postgres seam** |
| [`src/shelf.ts`](../../src/shelf.ts) | archived, renamed, opened — `data/<slug>/shelf.json` |
| [`src/library-search.ts`](../../src/library-search.ts) | searching every article at once, filesystem half |
| [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) | the same two things, in SQL |
| [`src/web/useShelf.ts`](../../src/web/useShelf.ts) | the shelf and its verbs, client side, including Undo |
| [`src/web/useLibrarySearch.ts`](../../src/web/useLibrarySearch.ts) | the debounced half of the box, and dropping late responses |
| [`src/reading-time.ts`](../../src/reading-time.ts) | `~54 min`, said once for both the card and the masthead |
| [`src/routes.ts`](../../src/routes.ts) | `GET /api/library`, and the six job routes |
| [`src/extract.ts`](../../src/extract.ts) | stage 2, now writing `meta.json` |
| [`tests/library.test.ts`](../../tests/library.test.ts), [`tests/router.test.ts`](../../tests/router.test.ts), [`tests/ingest.test.ts`](../../tests/ingest.test.ts) | the shelf, the routes, the slugs |
| [`tests/shelf.test.ts`](../../tests/shelf.test.ts), [`tests/library-search.test.ts`](../../tests/library-search.test.ts) | archive, rename, opens — and the search that must survive a re-extraction |

Styling is Tailwind utilities, not a block in [`styles.css`](../../src/web/styles.css). That is the
rule rather than a preference: this page is chrome, and chrome is what shadcn and Tailwind were
adopted for ([web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components)).
The reading view stays hand-written, because its geometry is not something utilities can say. Every
class needs the `tw:` prefix — unprefixed names silently do nothing.

## The fixture is always on the shelf

`example/` is listed under the slug `example`, flagged, and sorted below the real articles. A fresh
clone has no `data/` at all, and an empty homepage reads as a broken app rather than an empty shelf.

Note it is listed under its **directory name** and not under the slug inside its own `meta.json` —
that one names the full Noema article the fixture is an excerpt of, and listing it there would
collide with the real thing. `loadArticle("example")` resolves by falling through
([`src/api.ts`](../../src/api.ts)), so the slug that lists is the slug that opens.

## See also

- [url-state.md](url-state.md) — the query string half of a link, and why position replaces history
- [web-client.md](web-client.md) — the page the cards lead to
- [architecture.md](architecture.md) — the pipeline that fills the shelf, and the storage layout
- [ingest-queue.md](ingest-queue.md) — what happens after you press Add
- [setup-dev.md](setup-dev.md) — the same stages, run by hand
- [content-extraction.md](content-extraction.md) — stage 2, which writes `meta.json`
