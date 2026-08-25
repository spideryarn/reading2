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
| [`src/reading-time.ts`](../../src/reading-time.ts) | `~54 min`, said once for both the card and the masthead |
| [`src/routes.ts`](../../src/routes.ts) | `GET /api/library`, and the six job routes |
| [`src/extract.ts`](../../src/extract.ts) | stage 2, now writing `meta.json` |
| [`tests/library.test.ts`](../../tests/library.test.ts), [`tests/router.test.ts`](../../tests/router.test.ts), [`tests/ingest.test.ts`](../../tests/ingest.test.ts) | the shelf, the routes, the slugs |

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
