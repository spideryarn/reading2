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
| `/read/<slug>/metadata` | everything we know about the article — [260825e-metadata-page.md](../plans/260825e-metadata-page.md) |
| `/read/<slug>/tweets` | the article as a numbered thread — [260825g-tweet-thread-page.md](../plans/260825g-tweet-thread-page.md) |
| `/add/<a whole URL>` | queue that article and watch it — [ingest-queue.md § The add page](ingest-queue.md#the-add-page) |
| `/design` | every token, face and component variant on one page — [design-css-overview.md](design-css-overview.md) |

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

So `/read/noema-mythology-of-conscious-ai?cols=1,2&at=spya-tgnssb` is one link that carries both, and
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

### An address nobody minted

An address that is not one the app mints — not `/`, not `/read/<slug>` and its two views, and not
one of the standalone pages `parseRoute` names (`/login`, `/profile`, `/design`, `/privacy`,
`/features`, `/pricing`, `/admin`, `/add/`, `/auth/callback`) — is the **404 page**. An unrecognised
third segment as much as an unrecognised first one, so `/read/x/nonsense` and `/asdf` get the same
answer. [`router.ts`](../../src/web/router.ts) is the list, and it is the only one;
[`NotFoundPage.tsx`](../../src/web/NotFoundPage.tsx) is a heading, a sentence and a link home.

**It was the shelf until 2026-09-03**, and this paragraph said so: *"There is no 404 page on
purpose: a mistyped address lands you on the shelf, which is both a useful place to be and
self-explanatory."* Greg went to `/asdf`, got the homepage and asked where the 404 was, which
answers the second half. The shelf is useful and it is *silent*: a link that has rotted and a link
that was never right both look exactly like a link that worked.
[260903j-not-found-page.md](../plans/260903j-not-found-page.md) has the reversal, the addresses that
still fall through to the shelf (the root in its three spellings, and `/add` with nothing after it),
and why `/admin` for a non-administrator deliberately did not follow. `/add/<something that is not a
URL>` is neither: it stays an add route, and the add page says what is wrong with the address the
reader typed, which is a better answer than either of ours.

**The status code is still 200** for everything but `/read/:slug`, which the edge already answers
400 or 404 through the serverless function ([`src/public/page.ts`](../../src/public/page.ts)).
`vercel.json` rewrites the rest to a static file, and a static file cannot choose a status; the plan
says why we did not chase it.

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
[260825e-metadata-page.md § What the plan got wrong](../plans/260825e-metadata-page.md#found-by-the-cross-model-review).
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
original**, **Copy link**, **Archive**. Re-run is not new machinery — it is
`POST /api/jobs { slug, force: ["fetch"] }`, the route the add box already uses; without the `force`
the queue skips every step whose artefact is on disk, which is every step.

The plan, the decisions and what was deliberately left out are in
[260826k-library-shelf-actions-and-search.md](../plans/260826k-library-shelf-actions-and-search.md).

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

### Archive, and Undo is the confirmation

> Archive, with an Undo — the card disappears from the shelf straight away … Underneath, the row is
> flagged hidden rather than removed, so nothing is destroyed.
>
> — Greg's choice, 2026-08-26

So there is **no confirmation dialog**: the Undo strip is the confirmation, and it costs the common
case nothing. `GET /api/library?archived=1` is the other half of the shelf.

A **Show archived** disclosure at the foot of the shelf is the other way back, and it is not
optional decoration: without it Archive is permanent from the interface the moment the nine-second
Undo strip goes, which would make "nothing is destroyed" true of the database and false of the
product. It does not fetch until opened.

**An archived article is still readable by direct link.** Only the shelf filters. That is a decision
rather than an oversight — the shelf is a shelf, not an access control list, and a link that stops
working is a worse surprise than a card that is out of sight. The library *search* is the exception:
an archived article is out of the index entirely, because a hit that opens an article you archived
reads as a ghost.

**And archiving takes it out of the public listing too**, which is the one place the shelf rule bends.
[`publicLibraryQuery`](../../src/store/public-library.ts) asks for `visibility = 'public'`, a
published revision **and `archived_at is null`** — so an article its owner has shared *and* archived
is answered at its own link and named in no list. (That query is all there is today: `/read/public`
still renders a 404 in [`App.tsx`](../../src/web/App.tsx), and the showcase page that will use it is
[260904b](../plans/260904b-pricing-page-and-public-showcase.md).)

The clause went in on 2026-09-04, when GPT Sol asked which way the asymmetry ran. The first version
had no clause, on the rule above — visibility is a property of the work, archiving is a property of
one person's shelf — and the consequence is what settles it: without it an owner loses sight of the
article on their own shelf while strangers go on finding it, and since the payload carries no
`archived_at` at all, nothing on either end would ever show that it had. Listing is the half
archiving owns; the link is the half sharing owns, and `publicSlug` is deliberately left alone.

#### This section was called "Delete means archive", and that was the bug

Greg's choice above was made on 2026-08-26 and built the same day. **Every control that carried it
out was labelled "Delete", with a bin in it, until 2026-09-04** — the card, the table row, the
metadata page, the shelf's own "Show deleted" disclosure — and nothing a reader could see said the
act was reversible.

On 2026-09-04 Greg filed [SPIDERYARN-READING2-19](../plans/260904d-archive-articles-centre-the-text-and-a-done-key.md)
asking for exactly this feature: *"I want to be able to 'archive' an article, from Homepage shelf and
article Metadata. This should be easy to reverse, and by default the Homepage shelf shouldn't show
archived articles."* All of it already worked, and had for nine days. **He could not tell, because
the button was called Delete.**

So the fix was the word, and that is the lesson worth keeping: *a reader cannot tell a reversible
act from a destructive one by watching the row disappear — only the label says which it was.* The
label, the icon and the destructive red were three ways of saying the same wrong thing, so all three
moved: **Archive** on a box glyph, at the shelf's ordinary weight rather than in the colour this app
reserves for what cannot be undone. `tests/shelf-archive-label.test.tsx` pins the label to
`shelf.archive` in both renderers, and `tests/metadata-page-order.test.tsx` pins the section
heading, so it cannot drift back quietly.

Nothing under the interface changed: no schema change, no API change, no store change.
`archived_at`, `?archived=1` and `shelf.archive` were always the words in the database, on the wire
and in the client, so the rename **narrowed** the vocabulary rather than adding to it.

**Permanent deletion was deferred**, deliberately and in writing, though Greg's report raised it —
*"maybe there should also be a way to permanently delete"*. It gets its own plan: one production
database, real readers' articles, and a mis-tap that nothing can undo is a different kind of feature
from this one.

#### The same act on the article's own page, where the undo never expires

Since 2026-08-27 the [metadata page](../plans/260825e-metadata-page.md) has the third Archive — same
`PATCH /api/library/<slug>` with `{ archived }`, so there is one archive and not two that could
drift, and the button had been a dimmed placeholder there for exactly two days.

What is different is the confirmation, and the difference falls out of the paragraph above. A card
vanishing off the shelf needs a strip to catch it, because the reader is looking at a list the
article has just left. Archive on `/read/<slug>/metadata` leaves the reader looking at the article's
*own* page, which keeps working — so instead of a strip with a clock on it, the section simply says
`Archived 3 minutes ago` with **Put back** beside it, for as long as it is true. That is the stronger
promise of the two, and it is affordable only because this page is about one article. The state
comes from `ArticleMetadata.archivedAt`, off the same shelf read that already answers `purpose`, so
it costs no extra request. Both stores answer it, and there is a test per store —
[`tests/shelf.test.ts`](../../tests/shelf.test.ts) and
[`tests/store-shelf-pg.test.ts`](../../tests/store-shelf-pg.test.ts) — because one store answering
and the other not is the divergence a parity test cannot see: both answers typecheck.

There is no confirmation dialog there either, and the reason is sharper than on the shelf: a modal
asking you to confirm something that is undone by a button in the same place, for ever, teaches
people to click through modals.

### A renamed title is an override, not an edit

Stage 2 rewrites `meta.json` on every run (see [below](#metajson-and-the-articles-identity)). A
renamed title stored there would work perfectly and be silently undone by the next
a re-run of stage 2 — a bug that reports success, waits weeks, and then looks like the rename never
happened. So the reader's title lives in shelf state and `describeArticle` prefers it, which is why
a renamed article is called the same thing on the card, in the masthead and in the search results.
`tests/shelf.test.ts` re-runs the rewrite and asserts the override survives.

### The pencil is on three pages now, and it is one control

Greg, 2026-08-27:

> I think we have a button to edit the title of an article in the Home page. Can we add a similar
> button to the article page itself, and/or its Metadata.

So there are three places to rename an article: the shelf (card and table row), the reading view's
masthead, and the metadata page's own heading. **One implementation**, in
[`src/web/TitleEditor.tsx`](../../src/web/TitleEditor.tsx) — the editor, the request, and the
heading-with-a-pencil that wraps both.

That file exists because a rename has three outcomes and only one of them is the one you try:
`undefined` is *cancelled*, `null` is *clear it and go back to the extractor's title*, and a string
is that title. Copies of an `<input>` and a `PATCH` would look identical while getting one of the
other two wrong, and nobody would notice, because the happy path is the same in all three.

Two things are worth knowing about the two new sites:

- **The new title comes back from the server, not from the input.** Clearing the field sends
  `title: null`, and what the reader should then see is whatever the extractor last found — a string
  neither page has. So `useArticleRename` reports `entry.title` from the response, which is
  `titleFor`'s answer to "what is this article called now"
  ([`src/library-scalars.ts`](../../src/library-scalars.ts) — it lived in `src/api.ts` until that
  file went with the filesystem store on 2026-09-05).
- **The reading view cannot say whether the title on screen is the reader's own.** `GET
  /api/article/:slug` deliberately does not carry the superseded title — the same refusal
  `LibraryEntry` makes — so the editor's hint has a third state there: `undefined` for *we do not
  know*, which reads "empty to restore the extracted title" rather than naming a title that might be
  the reader's own.

The new title is layered over the fetched payload in `ArticlePage`
([`src/web/App.tsx`](../../src/web/App.tsx)) rather than written into it, which is the shape the
server already uses — `titleFor` picks at the moment of answering rather than editing `meta.json`.
It also keeps `setLoaded` under the rule that everything reaching it has been sanitised
([`tests/sanitize-client.test.ts`](../../tests/sanitize-client.test.ts)); a rename introduces no HTML
and would have had to be spelled as an exemption, and an exemption is how a guard stops meaning
anything.

The metadata page withholds the pencil on the fixture, for the same reason its Archive button is
withheld there: an address with no article of its own has no shelf row, so the PATCH would 404, and
pressing the button is how you would find out. It withholds it **until the metadata request lands**,
too — `provenance` is null both before the answer arrives and after it fails, so "not the fixture"
and "not yet told" were the same value, and the pencil appeared for a moment on every address.

### What a cross-family review found, and it was the slug

Three of the six findings were real and one of them was the only bug here that could damage
something. Worth writing down because none of them is visible from a browser:

- **The masthead renamed `meta.slug`, not the address.** They are usually the same. They come apart
  on exactly the addresses that matter: an unknown slug is answered with the committed fixture,
  *meta.json and all*, so `/read/anything` gets a `meta.slug` of `noema-mythology-of-conscious-ai`.
  Renaming through it PATCHed the real Noema article's shelf row while appearing to rename the thing
  on screen, and reverted on reload. The route slug is also the one `loadShelf` used to pick the
  title being drawn, so it was never the right one to send.
- **A rename can resolve after the reader has gone.** The pages that start one unmount with the
  article; `ArticlePage` does not. So the answer now carries the slug it is about, and the layered
  title is stored as a `{ slug, title }` pair — the same shape, and the same reason, as `loaded`.
- **Two writes in flight would land in arrival order.** Submit, reopen, submit again: the older
  answer applied last turns the newer title back into the older one, with both writes having
  succeeded. A sequence counter in the hook; only the latest may report.

Two more were about the keyboard rather than about data. Focus falls to `<body>` whenever an editor
replaces its own trigger, so the pencil is focused again when the editor closes — *unless focus has
already gone somewhere real*, because this editor commits on blur and a reader who clicked a link
must not be yanked back. And the hint under the input is the only place that says an empty field
restores the extracted title, so it is wired to the input with `aria-describedby`.

One finding is real and deliberately not fixed: **navigating away mid-edit loses what you typed**,
because saving hangs off the input's blur and an unmount does not fire one. That is the shelf
editor's behaviour too and always has been; committing on unmount would double-submit on the Escape
path, which is a worse trade for the same keystroke.

### Shelf state: a fourth kind of reader state

Archived, renamed, and how often you have opened something are all *reader state about an article* —
the same category as comments, chat and saved searches, and not the same category as the article's
text.

| Store | Where |
|---|---|
| `postgres` | four columns on `spideryarn.articles`: `archived_at`, `title_override`, `opens`, `last_opened_at` — [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) |

The filesystem half — `data/<slug>/shelf.json`, and the writes in `src/shelf.ts` — was deleted on
2026-09-05.

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

**What it deliberately does not say.** Chat threads and saved searches are per-article reader state,
and now live in Postgres like everything else — `chat_threads` via
[`src/store/pg-chat.ts`](../../src/store/pg-chat.ts), `search_runs` via
[`src/store/pg-searches.ts`](../../src/store/pg-searches.ts). The tooltip still doesn't show a count
for either; nobody has wired that read into it.

## Finding an article, and finding a passage in one

One box **directly above the list**, with **two matchers behind it** — which is the same shape the
in-article search already has ([search.md](search.md)), deliberately rather than coincidentally.

It sat at the very top of the page until 2026-09-03, above the box for *adding* an article and
separated from the list it filters by everything in between. Greg: *"Move the search bar so it's
just above the list of articles."* The order the page renders in is now **add box and its jobs →
errors and Undo → search → `ShelfControls` → the "n of m" count → the list**
([`Library.tsx`](../../src/web/Library.tsx)).

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

Until 2026-09-05 there was a second implementation, a filesystem scan of every `blocks.json` in
`src/library-search.ts`'s `searchLibrary`, deleted along with the rest of the filesystem store. It is
worth keeping why the two were never a matched pair, because the first version of this paragraph got
it wrong: it said they agreed on the *set* of block ids for a single-word query. They did not —
Postgres matches English lexemes, so `writes` found "writing" and "write-nots" while `the` found
nothing at all (a stop word); the filesystem scan matched substrings, so it found `the` inside
"theory" and missed every inflection. Single words were exactly the case the old claim called safe. A
cross-family review caught it, 2026-08-26. Postgres is now the only implementation, so there is
nothing left to diverge from.

**`excludeSlug` is not a matching rule.** It is a promise that a named article is absent from the
results, kept inside the query, before the cap. Nothing on this page uses it — the shelf's box
searches everything — but chat's `search_library` does, to leave out the article the reader has open,
and it had to become a store argument rather than a filter over the results for a reason worth
knowing about before you write the next one of these. Filtering afterwards means the cap is spent
first, so one loud article can empty the list and the caller reports finding nothing. The whole story
is in
[chat-tools.md § The reader's own article ate its own search results](chat-tools.md#the-readers-own-article-ate-its-own-search-results);
the contract is `LibrarySearchOptions` in [`src/store/contracts.ts`](../../src/store/contracts.ts).

The hit carries **the whole paragraph**, not a snippet, and the client cuts it. Trimming on the
server would mean reconciling two flavours of highlighting — Postgres knows which *stems* matched,
not which characters, so it would either return the whole thing anyway or call `ts_headline` and hand
back a second flavour to reconcile with the client's own. One highlighter.

What was considered and deferred, with the research behind it in
[260826e-postgres-search.md](../research/260826e-postgres-search.md): **BM25** (`pg_search`/ParadeDB is not available
on Supabase at all, hosted or local — what you actually get is `ts_rank`), **`pg_trgm`** for
typo-tolerant titles (available, useful, but matcher one already handles titles in the browser), and
**pgvector + embeddings** for meaning-based search — `vector 0.8.2` is available locally but not
enabled, Anthropic has no embeddings API so it means a second vendor, and Greg deferred it
explicitly.

## Sorting the shelf

> Make the set of docs on the homepage nicely sortable (e.g. by when added, when last opened, how
> many words, how many actions/interactions performed) … Maybe it's misleading to call this tabular,
> because I kind of like the rich cards that we have right now, so look for a best of all worlds.
>
> — Greg, 2026-08-26

The answer to the last sentence is one line, and it is the whole design:

**One sort state, two renderers.**

Six chips above the shelf — **Last opened**, **Added**, **Title**, **Length**, **Times opened**,
**Questions** — plus an **Unread** filter and a **cards / table** toggle. The chips drive both views
identically, so switching between them keeps your place in the order: there is only one order.
Clicking the key you are already on reverses it; clicking a key you are not on starts at *that key's*
natural end, so going from "newest first" to Title gives you A-to-Z rather than Z-to-A;
**shift-clicking adds a second key**, so you can ask for the longest article of each author. All of
it is in the URL — [url-state.md § The library's own five](url-state.md#the-librarys-own-five).

Dates are **relative** — "opened yesterday", "added 3 days ago" — up to about a month, after which
they hand back to a real date, because nobody counts in days at that range. The exact timestamp is
always one hover away in [the details tooltip](#the-tooltip). The clock is re-read once a minute so
a shelf left open does not quietly go stale — [`relative-time.ts`](../../src/web/relative-time.ts)
and [`useNow.ts`](../../src/web/useNow.ts).

The two views are not a real one and a decoration. **The card is a decision aid** — what the piece
says, how long it will take — and keeps the blurb. **The table is a comparison** — how this article
stands against the rest of the shelf — and gives the blurb up for six columns you can run your eye
down. Neither is a fallback for the other.

### The shelf's resting state

**Last opened, most recent first** — since 2026-08-27, on Greg's instruction. It was **Added**,
which is what a list of things that *arrived* wants; a shelf is not an inbox. What you are most
likely to want off it is the piece you were half-way through an hour ago, and under Added that sat
wherever it happened to have been fetched — for anything imported in a batch, nowhere near the top.

The chip row leads with whatever the default is, so Last opened is now leftmost. That rule did not
change; the default did. Both live in `DEFAULT_BY` and `CHIP_ORDER` in
[`library-columns.tsx`](../../src/web/library-columns.tsx), and the default writes **no parameters
at all** into the URL, so a bare `/` and `?by=opened` are the same shelf.

**An article you have never opened goes to the bottom**, in either direction. That is `sinkLast` in
[`Library.tsx`](../../src/web/Library.tsx) rather than a property of the comparator — a missing date
is not a small one, and ascending by Last opened must not fill the top of the shelf with everything
you have never read, which is a real thing to want and is what the Unread filter is for. It sounds
like it buries every new arrival and does not: adding an article takes you straight into it
([`AddPage.tsx`](../../src/web/AddPage.tsx) navigates to the reading view when the job finishes), so
by the time you next look at the shelf it has been opened.

It is a **single** key, not `opened` then `added`. The compound version orders the never-opened
block at the foot better and lights *two* chips on a shelf nobody has clicked, which reads as a sort
somebody else left behind.

Two of the six keys are Greg's "actions/interactions performed", and they are the only two we can
honestly count: opens and questions are the only reader interactions stored as numbers. Chat threads
and saved searches are deliberately not counted, for the same reason [the tooltip](#the-tooltip)
won't say them.

### The card says what it is sorted by

This is the "best of all worlds" half, and it is the bit a table library would not have given us. A
card sorted by something it does not show is a list in an order the reader cannot check — *why is
this one at the top?* has to be answerable from the card. So the date on the right of the meta line
becomes the sort key's own value: **Last opened** makes it "opened 25 Aug", **Questions** makes it
"3 questions". **Added** and **Length** change nothing, because the card already carries both.

That is `CARD_NOTES` in [`library-columns.tsx`](../../src/web/library-columns.tsx), and it is the
clearest reason a headless table was the right kind of library: TanStack owns the ordering and has
no opinion at all about how a row is drawn, so this feature survived the switch untouched. A
batteries-included grid would have made it a fight.

### Three rules a browser cannot check

The sort moved from the server into the client, and three things came with it that look right on
screen and are wrong. All three are now **configuration** rather than code, which is exactly why
[`tests/library-sorting.test.ts`](../../tests/library-sorting.test.ts) builds a real table and
asserts the order that comes out of it: a test that re-implemented the comparator would go on
passing while the config that actually runs was wrong.

- **The fixture stays at the foot of every sort, both directions.** The server has always kept it
  there. Sort by Length in the browser without carrying that rule over and a committed demo excerpt
  sits above the reader's own library. Done with `sinkLast` rather than TanStack's row pinning,
  because pinning is a *feature* — something a reader turns on for a row they care about — and
  spending its state on a rule about our data would leave it occupied the day anybody wants the
  real thing.
- **A missing value sorts last in *both* directions** — that one comparison is deliberately *not*
  multiplied by the direction. Ascending by "last opened" would otherwise fill the top of the shelf
  with everything you have never opened. That is a useful thing to want, and it is what the Unread
  chip is for; smuggling it into the low end of a sort makes it unavailable in the other direction
  and unexplained in both.
- **Every comparison ends in a total order.** TanStack's last-resort tiebreak is `rowA.index` —
  literally the order the data arrived in — so the array is sorted by slug before the table sees it.
  Done at the door rather than inside a `sortingFn`, because a tiebreak inside one gets multiplied
  by the descending inversion and would reverse with the arrow, which is not what a tiebreak is.

Two smaller ones, same file, and both are now properties of the *accessors*: an **unparseable** date
must come back as `undefined` rather than `NaN` (`sortUndefined` triggers on `=== undefined` and
nothing else, and `NaN` compares false in both directions — a sort that does nothing at all), and
**`0` is a value, not absent**, so `opens: 0` sorts at the low end rather than being banished to the
bottom with the unknowns.

### TanStack Table, headless — and where it stops

Researched per [third-party-library-selection.md](../reusable/third-party-library-selection.md),
hand-rolled first, then switched on 2026-08-26 at Greg's call: *"because I think we'll also want this
kind of thing in other places"*. So the seam is built for reuse —
[`src/web/lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) and
[`table-sort.ts`](../../src/web/lib/table-sort.ts) know nothing about the library, and a page that
wants sortable rows defines columns and gets the chips and the table.

**v8, not v9.** v9 went stable in early August 2026 with a breaking API, shadcn has not migrated its
own examples, and there is essentially no training data for it — so models write v8 and it silently
does not work.

**Headless means it owns the rules and none of the markup**, which is the split that made it worth
adopting: every `<th>`, `<td>` and chip is still ours, so the card that says what it is sorted by
survived the move unchanged. Three of its options are decisions rather than defaults, and are set
in `useSortedTable`: `sortUndefined: "last"` (its own default flips with the arrow),
`enableSortingRemoval: false` ("unsorted" has no meaning here), and `enableMultiSort`.

**Two things it does not do, and both were found by a test.** Its last-resort tiebreak is *the order
the data arrived in*, so the data is sorted by slug before it is handed over. And its built-in
`"text"` sort compares code points — it puts "Étude" after "zebra" and "Part 10" before "Part 2" —
so the title column keeps an `Intl.Collator`. Both looked like straight swaps.

The full comparison, the honest cost, and what is still deliberately hand-written are in
[260826y-library-sorting.md](../plans/260826y-library-sorting.md).

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

The date at bottom-right is the one thing on the card that moves: it says whatever the shelf is
currently sorted by — see [§ The card says what it is sorted by](#the-card-says-what-it-is-sorted-by).

The blurb is **the tree root's `gist`** — one sentence about the whole article, from the same pass
that writes every other gist ([granularity-zoom.md](granularity-zoom.md)); the L0 column it used to
fill is gone, the sentence is not. That is this product's own idea turned on its own library, and it
costs nothing, because the sentence already exists.

Note what is deliberately *not* a fallback for it: **the first arc entry**. An arc sentence says
where the argument stands at the end of part one ([granularity-zoom.md § The arc](granularity-zoom.md#the-arc)),
so using it here would put a sentence about the opening where the reader expects a sentence about the
article — and it would look completely right. The fallbacks are `summary` and then Readability's
`excerpt`, both of which at least mean the whole thing; failing those, no blurb at all.

The reading time comes from [`src/reading-time.ts`](../../src/reading-time.ts), which exists so that
the card and the masthead cannot drift. They run on opposite sides of the wire, so nothing would ever
have told us the card said 47 minutes and the masthead 54 — see
[silent-success.md](../reusable/silent-success.md).

### The Shared badge

An article anyone can read without signing in wears a small globe and the word **Shared**, on the
meta line of the card and in the title cell of the table — one component,
[`SharedBadge`](../../src/web/ShelfEntry.tsx), because a marker added to one of the shelf's two
renderers looks finished from wherever you were standing. Hovering it gives the owner's own sentence
from the sharing card, `SHARING_ON` in [`src/messages.ts`](../../src/messages.ts).

**A private article gets nothing at all.** The shelf is almost entirely private, so a chip on every
card would be decoration, and it would cost the shared one the only thing it has. `LibraryEntry`
carries `visibility` only when it is `"public"` for the same reason — and because the filesystem
store has no visibility column to answer with at all ([database.md](database.md)).

**And a third marker, at the top of the article itself** —
[`SharingMark`](../../src/web/Masthead.tsx), since 2026-09-04. A globe or a **lock** beside the
title, with a tooltip, linking to that article's metadata page where the switch is. It breaks the
no-private-twin rule above on purpose: one mark on one article is not a chip on every card, and the
question an owner asks there — *would the link I am about to paste work?* — is asked exactly as
often about a private article. Answering it by absence would be indistinguishable from a mark that
had not loaded. It reads `Article.visibility`, which the Postgres store fills and the filesystem
store cannot, and it draws **nothing** when nobody could say.
[260904b-sharing-mark-on-the-article-masthead.md](../plans/260904b-sharing-mark-on-the-article-masthead.md).

**A badge, not a filter.** There is deliberately no way to sort or narrow *this* shelf by it until
there is enough shared material for it to be worth anything — Greg's decision on
[260902j-public-read-only-access-audit-and-improvements.md](../plans/260902j-public-read-only-access-audit-and-improvements.md).
The visitor's side of the same fact is `ViewOnlyChip` in
[`src/web/PublicChrome.tsx`](../../src/web/PublicChrome.tsx), and it says something else: *you may
not change this*, where this says *anyone can read this without signing in*.

**And that decision still stands next to a page that does exactly what it says there is no way to
do**, which reads as a contradiction and is not — **they are two different shelves**, and this is
the paragraph that says so rather than leaving the next reader to work it out.
[public-shelf.md](public-shelf.md) is `/read/public`, and it lists *what anybody has shared*, to
anybody, signed in or not — Greg, 2026-09-04: *"create a `/read/public/` page that lists
Public-readable pages … to showcase what Spideryarn is capable of."* This shelf is *your articles*,
nearly all of them private, and narrowing it to the shared few would be a control that answers a
question its owner already knows the answer to. Nothing about the owner's shelf changed when that
page arrived: no filter, no sort, no chip on a private card. The two lists share no query, no DTO
and no card component, and none of the public ones is a widened `LibraryEntry` — there is no
`opens`, `lastOpenedAt`, `comments`, `titleOverridden`, `archivedAt` or `purpose` on the wire,
because every one of those is a fact about a *person's* relationship with a document rather than
about the document.

**What did change is the promise, and it is a promise this page makes.** Sharing used to mean
*reachable by anyone with the link*; since the listing shipped it also means *listed publicly*, so
the badge above, its hover sentence and the masthead's mark all say the wider thing —
`SHARING_ON` in [`src/messages.ts`](../../src/messages.ts) is the one string the three are built
from. The decision to widen it retroactively rather than grandfather anything is
[260904b-pricing-page-and-public-showcase.md](../plans/260904b-pricing-page-and-public-showcase.md)
§ 1, and it rests on there being one account holder.

The name `public` is reserved as an article slug, because `/read/public` would otherwise be an
address two things claim: `isReservedSlug` in [`src/ingest.ts`](../../src/ingest.ts), refused at
`lockOrCreateArticle`, which is the one line that brings an article address into existence.

**Nobody is signed in, so the shelf has three ceilings rather than one.** 200 rows, a `left()` cap on
every text column it returns (`PUBLIC_CARD_CHARS`) because nothing bounds a title or an `<h1>` and a
fetched document may be 32 MB, and a partial index on `(public_at desc nulls last, slug) where
visibility = 'public'` so the row cap bounds the database's work and not only the reply. All three
came out of GPT Sol's review of the built code, 2026-09-04; the argument for each is in
[`src/store/public-library.ts`](../../src/store/public-library.ts) and
[security-map.md](security-map.md#and-since-2026-09-04-there-is-a-second-ownerless-query-which-enumerates).

### Where the numbers on it come from, and why nobody derives them twice

Every number on the card — words, minutes, blocks, parts, sections — and the blurb are produced by
one function, [`deriveLibraryScalars`](../../src/library-scalars.ts). Both stores use it, at
different moments:

| | when it runs | what the shelf then reads |
|---|---|---|
| **filesystem** | at read, over the artefacts the directory walk just loaded | its return value |
| **Postgres** | at **publish**, inside the transaction that writes the blocks and the tree | the five columns it wrote |

`describeArticle` in `src/api.ts` *receives* those five and assembles the card.
It used to derive them itself, which made it a second implementation — and the two had **already
diverged once**, over the `excerpt` rung of the blurb's fallback, found in review rather than by a
test.

**On the Postgres side that was also the shelf's whole cost.** Deriving per request meant reading
every block row of every article — `text`, `html` and the generated `fts` vector — and running each
one through the jsdom sanitiser, on every homepage load, in order to add up some word counts. Six
articles on a laptop against a local Supabase:

```
                          before      after
  statements per call     13 (1+2N)   2
  row JSON per call       641 KB      4 KB
  wall clock (median)     558 ms      3 ms
```

The four ticks went the same way. `has.glossary` was `row.revision.glossary != null` on a JSONB
document the query had dragged across the wire; it is now `is not null`, evaluated in Postgres, and
the document stays on the server. So does the tree, which is 37 KB on one article and was read to
count two kinds of node.

The safety of reading columns instead of artefacts rests on one invariant, and it is **not** that a
published revision is immutable — a revision can be updated in place when the text has not changed.
It is that every writer sets the five columns in the same transaction as the blocks and tree they
describe. If a third writer ever touches `tree` or `revision_blocks` without recomputing them, the
shelf starts printing last week's numbers with nothing to say so. The importer used to be the second
writer and `tests/store-import-convergence.test.ts` pinned its half; both went on 2026-09-01
([260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § Stage 3), so
the pipeline is now the only writer and `deriveLibraryScalars`
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)) is the one place that sets them. The
whole thing is written up in
[260828c-library-read-latency.md](../plans/260828c-library-read-latency.md).

### The title fallback exists in four places, and that is on purpose

When no column holds a title, the card and the masthead show the article's own first `<h1>`, and the
slug is the last resort. [`headingTitleOf`](../../src/library-scalars.ts) is the rule, and three
callers share it. The fourth is a correlated subquery inside `listArticlesQuery`
([`src/store/pg.ts`](../../src/store/pg.ts)), because the shelf asks Postgres for **one row** rather
than reading every block to find it. The SQL and the TypeScript are pinned against each other in
[`tests/store-shelf-reads.test.ts`](../../tests/store-shelf-reads.test.ts), over the real corpus and
over a fixture with two headings deliberately stored out of order — without which, dropping
`order by ordinal` changes nothing and the test stays green.

## Adding an article: the box submits now

Paste a URL, press Add, and the five stages tick over while you watch. The article appears on the
shelf the moment the last one finishes — no reload, and no "it'll show up eventually".

**Since 2026-08-26 the watching happens somewhere else.** Add navigates to `/add/<the URL>`, which
queues the job and shows the same progress card this page does, then takes you to the article. Greg
asked for that address so an article could be handed to us from a bookmarklet or a shortcut, and
pointing the button at it means there is one thing that starts an ingest rather than two —
[ingest-queue.md § The add page](ingest-queue.md#the-add-page). The progress list below the box
stays, and its job is now the one it always covered: showing you the runs *this* page did not start,
from another tab, from an article page, or from the CLI.

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
the name you get, rather than approximately the name you get. (That function grew a normalising
step on 2026-08-26, so the box now accepts `example.com/an-essay` and adding an article you already
have lands you back on it instead of shelving a second copy —
[ingest-queue.md § Two URLs, one article](ingest-queue.md#two-urls-one-article).) And the box is still honest about
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

- **The slug is passed in, and used to be read off the output filename.** Stage 3 named its blocks
  file after the HTML file and stage 4 named the data directory after *that*, so the basename was
  what the rest of the pipeline would call this article — and deriving it from the URL a second time
  would have been right for `npm run extract <url>` and wrong the moment anyone passed an explicit
  filename, with an article that had no byline as the only symptom. There is no filename to read one
  off any more: `runExtract` takes the slug, and the command line that could pass one went on
  2026-09-05.
- **It is rewritten every run**, because re-extracting is how you refresh a page and the fetch date
  should follow.

An article whose `meta.json` predates this still lists: the title falls back to the first `<h1>` and
the date to the mtime of `blocks.json`. It just has no byline and no source link.
`npm run extract -- <slug> --force` fixes it.

## When this becomes Postgres

See [database.md](database.md) for the store as a whole, and
[260825f-postgres-migration.md](../plans/260825f-postgres-migration.md) for the schema and the risks.

`src/api.ts` is the seam, and it is the only file that knows there are
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
| [`src/web/Library.tsx`](../../src/web/Library.tsx) | the homepage: the fetch, the URL state, and the four narrowings that turn a list of articles into the list on screen |
| [`src/web/library-columns.tsx`](../../src/web/library-columns.tsx) | **what the shelf can be sorted by**, and how each column is drawn — the whole of what this page tells the table |
| [`src/web/lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) | **reusable**: the chips, the dense table, and the three TanStack options that are decisions |
| [`src/web/lib/table-sort.ts`](../../src/web/lib/table-sort.ts) | **reusable**: sorting state ⇄ URL, the collator, and `sinkLast` |
| [`src/web/ShelfControls.tsx`](../../src/web/ShelfControls.tsx) | the two controls that are the shelf's own: Unread, and cards-or-table |
| [`src/web/ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) | the card, the five buttons, rename-in-place, the details tooltip — shared by both views |
| [`src/web/TitleEditor.tsx`](../../src/web/TitleEditor.tsx) | **renaming, wherever the reader is** — the editor, the `PATCH`, and the heading-with-a-pencil the masthead and the metadata page both use |
| [`src/web/IconButton.tsx`](../../src/web/IconButton.tsx) | the 28px icon-only button every row of them agrees on |
| [`src/web/relative-time.ts`](../../src/web/relative-time.ts), [`src/web/useNow.ts`](../../src/web/useNow.ts) | "3 days ago", and the clock that keeps it true |
| [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx), [`src/web/useJobs.ts`](../../src/web/useJobs.ts) | the add box and the progress list — [ingest-queue.md](ingest-queue.md) |
| [`src/web/AddPage.tsx`](../../src/web/AddPage.tsx) | where Add takes you: `/add/<a whole URL>` — [ingest-queue.md § The add page](ingest-queue.md#the-add-page) |
| [`src/web/router.ts`](../../src/web/router.ts) | `/` vs `/read/<slug>`, and `navigate` |
| [`src/web/Link.tsx`](../../src/web/Link.tsx) | an `<a>` that routes in-page and still behaves like an `<a>` |
| [`src/ingest.ts`](../../src/ingest.ts) | `slugFromUrl`, `isSlug` — shared by the extractor, the add box and the server |
| `src/api.ts` | `listArticles()`, `describeArticle()` — **the Postgres seam** |
| [`src/library-scalars.ts`](../../src/library-scalars.ts) | **the two derivations every reader shares**: the card's five numbers and blurb, and the `<h1>` a missing title falls back to |
| [`src/shelf.ts`](../../src/shelf.ts) | `MAX_TITLE_CHARS`, and `loadShelf` for fixtures — the writes moved to Postgres |
| [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) | archived, renamed, opened, and searching every article at once — all of it, in SQL |
| [`src/web/useShelf.ts`](../../src/web/useShelf.ts) | the shelf and its verbs, client side, including Undo — and **which of the saved copy and the live answer wins** |
| [`src/web/lib/cached-shelf.ts`](../../src/web/lib/cached-shelf.ts) | reading the saved shelf back, and refusing to draw a body an older deployment wrote |
| [`src/web/useLibrarySearch.ts`](../../src/web/useLibrarySearch.ts) | the debounced half of the box, and dropping late responses |
| [`src/web/library-hits.ts`](../../src/web/library-hits.ts) | **the four parameters a hit's link must carry**, the browser's fold, and the query-term rule |
| [`src/reading-time.ts`](../../src/reading-time.ts) | `~54 min`, said once for both the card and the masthead |
| [`src/routes.ts`](../../src/routes.ts) | `GET /api/library`, and the six job routes |
| [`src/extract.ts`](../../src/extract.ts) | stage 2, now writing `meta.json` |
| [`tests/library.test.ts`](../../tests/library.test.ts), [`tests/router.test.ts`](../../tests/router.test.ts), [`tests/ingest.test.ts`](../../tests/ingest.test.ts) | the shelf, the routes, the slugs |
| [`tests/shelf.test.ts`](../../tests/shelf.test.ts), [`tests/library-search.test.ts`](../../tests/library-search.test.ts) | archive, rename, opens — and the search that must survive a re-extraction |
| [`tests/article-rename.test.tsx`](../../tests/article-rename.test.tsx) | the pencil on the article and on its metadata page, mounted — cancelled, cleared, unchanged, and a write that fails |
| [`tests/library-hits.test.ts`](../../tests/library-hits.test.ts), [`tests/store-shelf-pg.test.ts`](../../tests/store-shelf-pg.test.ts) | the link's parameters; and the Postgres half, which had never had a query run against it |
| [`tests/library-sorting.test.ts`](../../tests/library-sorting.test.ts) | the sorting rules, asserted against a **real TanStack table** rather than a stand-in |
| [`tests/shelf-cached-paint.test.tsx`](../../tests/shelf-cached-paint.test.tsx) | the race between the saved copy and the live answer, **both directions** — and one test that says out loud what it cannot prove |
| [`tests/store-shelf-reads.test.ts`](../../tests/store-shelf-reads.test.ts) | **how many questions the shelf asks, and about what** — two, whatever it holds, and neither about a block |
| [`tests/table-sort.test.ts`](../../tests/table-sort.test.ts), [`tests/relative-time.test.ts`](../../tests/relative-time.test.ts) | the URL round-trip and `sinkLast`; and where "days ago" stops helping |

Styling is Tailwind utilities, not a block in [`styles.css`](../../src/web/styles.css). That is the
rule rather than a preference: this page is chrome, and chrome is what shadcn and Tailwind were
adopted for ([web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components)).
The reading view stays hand-written, because its geometry is not something utilities can say. Every
class needs the `tw:` prefix — unprefixed names silently do nothing.

## A repeat visit draws the shelf before the server answers

Since 2026-09-03 the homepage paints the copy of the shelf it already has while it fetches the live
one. Greg named the thing this is for:

> it was the delay "Reading the shelf" for a logged-in user with fewer than a dozen articles that I
> noticed most.
>
> — Greg, 2026-09-03

That message is `useSlow(articles === null)` at 600ms, and the wait behind it is a serverless cold
start rather than anything the shelf does
([260903g](../plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md) § Stage 5 for the
contract, and § *It is the serverless cold start* for the measurement).

**No new machinery**: the copy is the one `apiFetch` has been saving since the offline work, read
back by [`src/web/lib/cached-shelf.ts`](../../src/web/lib/cached-shelf.ts) and validated there,
because a body written by an older deployment can be missing a field the card now draws. Which of
the two answers wins is [`useShelf`](../../src/web/useShelf.ts)'s `issued`/`settled` pair, and the
rules are in its docstring: the copy paints only while the network has not spoken since the read
began; an older live answer that lands after a newer one is dropped; a transport failure or a 5xx
keeps what is on screen and adds the error; a final 401 or a change of reader clears it; a request
that went out for the previous reader is dropped when it lands, or it would undo that clear a frame
later; nothing commits after unmount.

**Who the reader is now has to be decided twice, and both times up front.** The hook is told, by a
`readerId` prop from `SignedIn`, rather than asking `lastKnownUser()`. And a response's partition
belongs to **whoever's token the server is about to check**: `accessToken` in
[`lib/api.ts`](../../src/web/lib/api.ts) hands back a `Credential` — the token and the reader id out
of the same session object — so a second lookup cannot have moved on in between. Both halves matter
because a direct A→B sign-in calls `rememberUser(B)` and never `forgetUser(A)`: before this, a reply
that started as A's and arrived after the switch was filed under B, and reading the cache on every
repeat visit is what turned that from an offline oddity into A's titles on B's homepage. `App.tsx`
also keys `<Library>` by `user.id`, so an account switch builds a new hook rather than clearing an
old one a frame late.

Two things it does **not** do, both deliberate. It does not filter through `onlyWhatWeHave`: that is
right offline and wrong here, where the live answer is already in flight and an article whose prose
was evicted is still perfectly openable. And it does not promise the message never appears —
IndexedDB is asynchronous, and a blocked read can outlast 600ms.

The price is a moment of staleness: a rename or an archive patches the React list and not the saved
body, so the first paint can show an old title or a card the reader deleted, and counts and order can
jump when the live answer lands. Accepted rather than overlooked — renames are cosmetic and Archive
is a flag.

## Offline, the shelf lists only what it can open

A reader who has lost the network still gets a shelf: `apiFetch` saves every GET body to IndexedDB
and reads it back when the transport itself fails
([260827r-offline-reading.md](../plans/260827r-offline-reading.md)). But **a card that opens to an
error is worse than a card that is missing**, so the saved shelf is filtered through the prose we
actually still hold — `onlyWhatWeHave` in [`src/web/lib/api.ts`](../../src/web/lib/api.ts), asking
the cache rather than trusting a remembered flag, because eviction runs on its own schedule.

The filter keeps the route's `{ articles: [...] }` envelope, and that is the whole trap: it spent a
fortnight testing `Array.isArray(body)` against a payload that has never been an array, so it
returned the shelf untouched every single time and the test covering it had invented a third shape
— [260903e-offline-shelf-filter-never-ran.md](../postmortems/260903e-offline-shelf-filter-never-ran.md).

**Three deliberate limits, so nobody builds them by accident.** There is **no service worker and no
sync queue** — the fallback is for a failed *transport*, not a general offline mode, and nothing a
reader does offline is replayed when they return. The cache key is user-plus-URL, so one browser's
two readers never see each other's shelf; eviction is whole-article rather than per-response, so a
half-evicted article cannot half-open. And a remembered identity **never authorises a request**: what
is cached is what this reader already fetched, not permission to fetch more.
[260827r-offline-reading.md](../plans/260827r-offline-reading.md) has the reasoning.

## The fixture is always on the shelf

`example/` is listed under the slug `example`, flagged, and sorted below the real articles. A fresh
clone has no `data/` at all, and an empty homepage reads as a broken app rather than an empty shelf.

Note it is listed under its **directory name** and not under the slug inside its own `meta.json` —
that one names the full Noema article the fixture is an excerpt of, and listing it there would
collide with the real thing. `loadArticle("example")` resolves by falling through
(`src/api.ts`), so the slug that lists is the slug that opens.

## See also

- [url-state.md](url-state.md) — the query string half of a link, and why position replaces history
- [260826y-library-sorting.md](../plans/260826y-library-sorting.md) — the plan behind the sort, the chips and the table
- [web-client.md](web-client.md) — the page the cards lead to
- [architecture.md](architecture.md) — the pipeline that fills the shelf, and the storage layout
- [ingest-queue.md](ingest-queue.md) — what happens after you press Add
- [setup-dev.md](setup-dev.md) — the same stages, run by hand
- [content-extraction.md](content-extraction.md) — stage 2, which writes `meta.json`
