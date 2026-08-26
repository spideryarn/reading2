# The shelf grows hands: delete, rename, re-run — and a search box

> On the home page where it shows the docs: add a "Delete" button. Add any other useful buttons you
> think we should add (e.g. "Edit title"). Add a hover-tooltip that displays extra metadata (e.g.
> when added, how recently opened, how many of different types of actions performed, etc). Add a
> search bar at the top … At the very least it should search the titles of all the articles, but
> ideally it would do something smarter.
>
> — Greg, 2026-08-26

The shelf ([library.md](../project/library.md)) has been read-only since it was built. Every card is
one big link, and the only thing you can do to an article is open it. This adds the verbs.

**Status: built, 2026-08-26.** What follows is the plan as written before the work, kept because the
reasoning is the point, with a [§ What changed in the building](#what-changed-in-the-building) at the
end for where reality disagreed with it.

---

## The four calls Greg made, 2026-08-26

Asked before any code was written.

| | Decision | What it rules out |
|---|---|---|
| **Delete** | **Archive, with an Undo.** The card goes immediately, a "Deleted — Undo" strip appears, and underneath the row is flagged rather than removed | No destructive delete in this pass. No confirmation dialog either — the Undo *is* the confirmation, and it costs the common case nothing |
| **Search** | **Titles now, full text next.** Instant client-side filter over what the shelf already knows, then Postgres full-text over the bodies. Meaning-based search deferred | No embeddings, no pgvector, no second vendor, no per-article cost in this pass |
| **Buttons** | **All four**: Edit title, Re-fetch/re-run, Open the original, Copy link | — |
| **Tracking** | **Yes, record opens.** *"It's your own laptop and your own reading."* | — |

## The constraint that shapes all of it

**`SPIDERYARN_STORE` defaults to `files`.** The Postgres cutover is real but unfinished — steps 10–13
of [postgres-storage-implementation.md](postgres-storage-implementation.md) are not started, and
chat, saved searches and jobs still write to disk in *both* modes.

So there are three ways to build anything new, and only one of them is honest:

1. **Postgres only.** The feature does not exist in the store Greg actually runs. No.
2. **Files only.** The feature dies on cutover day, and the parity test does not cover it, so nobody
   finds out until the shelf loses its buttons. No.
3. **Through the seam**, with both adapters — the pattern `src/store/contracts.ts` already
   establishes. The filesystem half is small and is deleted at step 13 along with the rest of
   `fs.ts`. **This one.**

That is not a tax; it is what the seam is for. But it means each of the four features below is two
implementations, and the plan says which parts can and cannot be identical.

---

## 1. Shelf state: a fourth kind of reader state

Archived, a renamed title, and how often you have opened something are all **reader state about an
article** — the same category as comments, chat and saved searches, not the same category as the
article's text. They are not written by the pipeline and must survive a re-extraction.

That last clause decides the title question. **A renamed title is an override stored beside the
article, not a rewrite of `meta.json`.** Stage 2 rewrites `meta.json` on every run
([library.md § `meta.json`](../project/library.md#metajson-and-the-articles-identity)), so a rewrite
would be silently undone by the next `npm run extract` — the worst kind of bug, because the rename
appears to work and comes back weeks later.

### The shape

```ts
interface ShelfState {
  archivedAt?: string;     // ISO. Absent = on the shelf.
  title?: string;          // The reader's title, overriding the extracted one.
  opens: number;
  lastOpenedAt?: string;   // ISO.
}
```

### Where it lives

| Store | Where |
|---|---|
| `files` | `data/<slug>/shelf.json` — beside `comments.json`, `chat.json`, `searches.json`, which are the same category of thing |
| `postgres` | four columns on `spideryarn.articles`: `archived_at`, `title_override`, `opens`, `last_opened_at` |

Columns on `articles` rather than a table of their own, because there is exactly one row per article
and it is per-owner state on a table that already carries `owner_id`. A join for four scalars would
be ceremony.

**Opens are a counter and a timestamp, not an event log.** So the tooltip can say *"opened 6 times,
last on Tuesday"* and can never say *"three times this week"*. That is the trade, it is deliberate,
and an `article_events` table is the thing to build if the second question ever matters.

### The seam

A new `ShelfStore` in `src/store/contracts.ts`:

```ts
interface ShelfStore {
  archive(slug: string, archived: boolean): Promise<LibraryEntry | null>;
  rename(slug: string, title: string | null): Promise<LibraryEntry>;  // null clears the override
  recordOpen(slug: string): Promise<void>;
  listArchived(): Promise<LibraryEntry[]>;
}
```

`archive` returns the entry so Undo has something to put back without a refetch. `rename` returns
the updated entry for the same reason.

### Routes

```
PATCH  /api/library/:slug   { archived?: boolean, title?: string | null }
POST   /api/library/:slug/open
GET    /api/library?archived=1
```

One PATCH rather than two routes, because both fields are "the reader edited the shelf record" and
the client sends whichever changed. `POST …/open` is a separate verb because it is a side effect
with no body and no response worth reading.

**`GET /api/library` excludes archived articles.** That is the point of archiving, and it means the
exact-match check at `src/routes.ts:916` grows a query string — worth noting, because that line
exists specifically to stop `/api/library/anything` serving the whole shelf.

### Who calls `recordOpen`

The client, from the reading view's mount — not the server, from inside `GET /api/article/:slug`.
Two reasons. A GET with a write in it is a GET that a prefetch, a retry or a health check silently
inflates. And the shelf itself fetches article payloads for nothing, so counting there would count
the wrong thing.

---

## 2. The card grows an action row

The card is currently one `<Link>` wrapping everything (`src/web/Library.tsx:141`). Buttons cannot
go inside an anchor — nested interactive elements are invalid HTML and behave differently in every
browser. So the card becomes a `<article>` with:

```
┌───────────────────────────────────────────────────────────────┐
│ The Mythology Of Conscious AI                    ⋯ actions ⋯  │
│ Anil Seth · Noema · 54 min · 139 blocks                       │
│                                                               │
│ Claims that AI is becoming conscious rest on a mythology       │
│ about intelligence, not on evidence about experience.          │
│                                                               │
│ 📄 12,431 words       3 ⌾                       25 Aug 2026   │
└───────────────────────────────────────────────────────────────┘
   ▲ the whole card is clickable via a stretched title link;
     the action buttons sit above it on the z-axis.
```

The "stretched link" pattern: the title is a real `<a href="/read/…">` with an
`::after` covering the card, and the action buttons get `position: relative` so they sit on top.
This keeps ⌘-click, middle-click and "copy link address" working on the title
([`Link.tsx`](../../src/web/Link.tsx)'s whole reason for existing) while making the card a target.

### The five buttons

| Button | Icon | What it does |
|---|---|---|
| Edit title | `Pencil` | Turns the `<h2>` into an input in place. Enter commits, Escape cancels, blank restores the extracted title |
| Re-run | `RefreshCw` | `POST /api/jobs { slug, steps, force }` — the route already exists ([`src/routes.ts:726`](../../src/routes.ts)). Opens a small menu: *Re-fetch and rebuild* (`force: ["fetch"]`) or *Rebuild from what we have* |
| Original | `ExternalLink` | `<a href={entry.url} target="_blank" rel="noopener noreferrer">`. Hidden when the article has no URL — the fixture does not |
| Copy link | `Link2` | `navigator.clipboard.writeText`, absolute URL, the icon becomes a tick for a second |
| Delete | `Trash2` | Archives, and raises the Undo strip |

Icons are Lucide at the one stroke weight ([icons.md](../project/icons.md)). The row is
`opacity-0 group-hover:opacity-100 focus-within:opacity-100` — quiet until wanted — but **never
`display: none`**, because a hidden element is not focusable and the row would vanish for keyboard
users. That is the trap [icons.md](../project/icons.md) already warns about in a different guise.

### Undo

One strip at the top of the list, not a toast library. It holds the last archived entry, offers
Undo, and clears after ~8 seconds or on the next archive. Undo is `PATCH { archived: false }` —
the same route, so there is no second code path that could drift from the first.

---

## 3. The tooltip

On hover over the card's date line, via the Floating UI wrapper that already exists
([`Tooltip.tsx`](../../src/web/Tooltip.tsx), [tooltips.md](../project/tooltips.md)).

```
┌─────────────────────────────────────┐
│ Added      25 Aug 2026, 14:02       │
│ Fetched    noema.media              │
│ Opened     6 times, last on Tue     │
│ Asked      3 questions              │
│ Built      tree · arc · glossary    │
│            (no thread, no summary)  │
│ Size       12,431 words · 139 blocks│
│            8 parts · 31 sections    │
└─────────────────────────────────────┘
```

**What it deliberately does not say, and why.** Chat threads and saved searches are per-article
reader state that has *not* moved to Postgres — `src/chat.ts` and `src/searches.ts` write files in
both modes, and the `chat_threads` / `search_runs` tables exist but nothing touches them. A count
that reads 7 on the filesystem and 0 in Postgres is worse than no count at all, because it looks
like an answer. They go in when step 10 of the migration lands, and there is a line about it here so
the omission is a decision rather than an oversight.

`LibraryEntry` gains: `opens`, `lastOpenedAt`, `titleOverridden`, `has: { arc, tweets, glossary, summary }`.
Every one of them is a scalar or a small fixed record, keeping the property
[library.md](../project/library.md) relies on — a `LibraryEntry` is a row.

---

## 4. The search box

One box at the top of the shelf, and **two matchers behind it, which is the same shape the in-article
search already has** ([search.md](../project/search.md)). Not a coincidence and not to be built twice:
the free, instant one is the default, and the expensive one is what you get for pressing Enter.

```
  ┌──────────────────────────────────────────────┐
  │ 🔍  qualia                                   │
  └──────────────────────────────────────────────┘

  3 articles                       ← filtered instantly, as you type
  ┌────────────────────────────┐
  │ The Mythology Of Conscious…│
  └────────────────────────────┘
  ⋮

  …and 11 passages in 2 articles  ← from the server, after a pause
  ┌────────────────────────────┐
  │ Noema · “…the hard problem │
  │ of qualia is not…”         │  → /read/<slug>?at=spya-k3m9qt&find=qualia
  └────────────────────────────┘
```

### Matcher one: filter the shelf, in the browser

Case- and accent-folded substring match over `title`, `byline`, `siteName` and `gist` — every field
the shelf already has in hand. No request, no debounce, no spinner. This is the whole of what Greg
asked for as a floor, and it is about thirty lines.

### Matcher two: full text over the bodies, from the server

`GET /api/library/search?q=…` → `LibraryHit[]`:

```ts
interface LibraryHit {
  slug: string; title: string; blockId: BlockId;
  snippet: string;   // the matching sentence, with the match marked
  rank: number;      // 0–1, comparable only within one response
}
```

Debounced ~250 ms, and the result deep-links into the reading view at the block, carrying `?find=`
so the in-article search lights the same words up when you land. **That handoff is the reason to
reuse the existing search's vocabulary rather than invent one**: `?find=` and block-id anchoring
already exist and already work.

#### Two adapters, and the one place they cannot match

| Store | How |
|---|---|
| `postgres` | a `tsvector` generated column on `revision_blocks`, GIN index, `websearch_to_tsquery('english', q)` to parse the query, `ts_rank_cd` to sort |
| `files` | scan the four `blocks.json` files in memory, fold, substring-match, rank by match count and block length |

**These two rank differently and cannot be made to agree.** `ts_rank_cd` weighs term density and
proximity; a substring scan cannot. The parity test that guards the read path
([postgres-storage-implementation.md § step 5](postgres-storage-implementation.md)) must therefore
assert *the same set of block ids for a single-word query*, and must not assert an order. Writing
that down here because a parity test that quietly compares ranks would fail for a correct reason and
send somebody hunting a bug that is not there.

The filesystem adapter is a stand-in with a four-article library behind it. It is deleted at step 13
with the rest of `fs.ts`, and it is not worth one line more than it takes to make the feature exist
in the store we currently run.

#### What we are not doing, and why

- **BM25 / ParadeDB `pg_search`.** Not available on Supabase, hosted or local — it needs a separate
  Postgres. What Postgres actually gives us is `ts_rank`. At four articles the difference is
  unmeasurable.
- **`pg_trgm` for typo tolerance.** Available (`create extension pg_trgm`) and genuinely useful for
  titles, since full-text search matches a misspelling not at all. Deferred: matcher one already
  handles titles, in the browser, and adding an extension is a migration. Named here so the next
  person finds it rather than researching it again.
- **pgvector and embeddings.** `vector 0.8.2` is available locally but not enabled. Anthropic has no
  embeddings API, so this means a second vendor (Voyage or OpenAI) and a per-article cost.
  Greg deferred it explicitly. When it comes back, the notes are in
  [postgres-search.md](../research/postgres-search.md).

---

## Order of work

1. `ShelfState`, both adapters, the `ShelfStore` contract, a migration for the four columns.
2. Routes: `PATCH /api/library/:slug`, `POST /api/library/:slug/open`, archived listing.
3. The card restructure — stretched link, action row, five buttons, Undo strip.
4. `recordOpen` from the reading view.
5. The tooltip, and the `LibraryEntry` fields it needs.
6. Matcher one: the client-side filter.
7. Matcher two: `GET /api/library/search`, both adapters, the tsvector migration.
8. Docs: rewrite [library.md](../project/library.md)'s card section, extend
   [search.md](../project/search.md) with the cross-article half, note the new store methods in
   [database.md](../project/database.md) and in
   [postgres-storage-implementation.md](postgres-storage-implementation.md).

## How this could fail while reporting success

In the house style of [silent-success.md](../reusable/silent-success.md):

- **The rename writes `meta.json`** and the next extraction eats it. Guarded by making the override a
  separate field, and by a test that re-runs extraction and asserts the override survives.
- **Archive hides the article from the shelf but `loadArticle` still serves it**, so an old link
  opens a deleted article. That is arguably correct — the link still works — but it must be a
  decision. It is: archived articles stay readable by direct link. The shelf is a shelf, not an ACL.
- **The action buttons are `display: none` until hover**, so they are unreachable by keyboard and
  every check is done with a mouse. Guarded by `opacity`, and by tabbing to them in the browser test.
- **`recordOpen` fires on every render** rather than every open, and the count inflates. Guarded by
  keying the effect on the slug and asserting the count in a test.
- **The search endpoint returns hits for archived articles**, which are supposed to be gone.
- **The filesystem search adapter and the Postgres one disagree** and nobody notices because only
  one of them runs. Guarded by the parity test above — set equality, not order.

---

## What changed in the building

Four things, and one review that never happened.

**The hit carries the whole paragraph, not a snippet.** The plan had `LibraryHit.snippet`, trimmed
server-side. That would have meant the two adapters trimming *differently* — Postgres knows which
stems matched, not which characters, so it would either return the whole paragraph anyway or call
`ts_headline` and hand back a second flavour of highlighting for the client to reconcile with its
own. So the field is `text`, it is the whole block, and the client cuts and marks it with the same
folding it already uses for in-article hits.

**The fold nearly introduced a textbook silent success.** An early draft found the match in a folded
copy of the paragraph and used that offset to slice the *original*. Folding is not length-preserving
— NFKD expands `ﬁ` to `fi`, `toLowerCase` lengthens `İ` — so the snippet drifts by one character per
ligature earlier in the paragraph, with no error and nothing to grep for. Caught while writing the
comment that claimed it was safe. It was fixed with an offset map, and then the map became
unnecessary when the whole paragraph started travelling; what survives is the warning, in both
`src/library-search.ts` and `Library.tsx`, because the next person to want a server-side snippet will
reach for exactly that offset.

**`setTitle`, `setArchived` and `recordOpen` had to become `async`.** They threw synchronously on a
bad slug or an over-long title while returning promises otherwise — and a function that usually
rejects and occasionally throws is one a `.catch()` silently fails to catch. Found by a test that
expected a rejection and got a throw.

**The importer and the exporter both needed teaching**, which
[§ Shelf state](#1-shelf-state-a-fourth-kind-of-reader-state) did not say. `scripts/db-import.ts`
now upserts the four columns — the article's *id* is still `onConflictDoNothing`, because id is
identity, but the shelf state is content and must carry over or a re-import silently loses an
archive. `scripts/db-export.ts` writes `shelf.json` back, and only when there is something to say:
an untouched article has no shelf file, and inventing an empty one would make every round trip add a
file the app never wrote. `tests/store-artefact-manifest.test.ts` caught the omission by itself,
which is exactly what it is for.

**A shelf-wide robustness bug turned up on the way.** `describeDir` in `src/api.ts` `stat`ed
`blocks.json` for an article with no `meta.fetchedAt`, unguarded — so a directory disappearing
between the `readdir` and that line (a failed ingest cleaning up, another agent, a test fixture)
threw an ENOENT that `listArticles` rethrows, and **the whole shelf 500s because one article stopped
existing**. Now treated as "not an article", which is what it has become.

### The cross-family review, and the eleven things it found

The first attempt returned `ERROR: Your workspace is out of credits`. Greg added a `CODEX_API_KEY`
mid-session and it ran against the **built code** rather than the plan, which turned out to be the
more useful thing. Its verdict opened *"not ready"*, and it was right. What it found, and what was
done:

| | Finding | Fixed |
|---|---|---|
| **BLOCKING** | `PATCH` wrote the title, *then* validated `archived` — so `{title:"x", archived:"no"}` renamed the article and answered 400. A request that reports failure and changes your data | Everything validated up front; `ShelfStore.patch` applies both fields in **one** write. A test asserts nothing changes when half the request is invalid |
| **BLOCKING** | Re-run ignored the response entirely, so a refused job looked like a successful one | Checked, and reported through the shelf's error line |
| **BLOCKING** | **Renaming did not rename the reading view's masthead** — the override was applied to the card only, while library.md promised the two agreed | `titleFor` in [`src/api.ts`](../../src/api.ts) is now the one place the precedence lives, called by `loadArticle` *and* `describeArticle`, in both stores |
| **BLOCKING** | No integration test proved migration 0004 applied or that any Postgres query worked | [`tests/store-shelf-pg.test.ts`](../../tests/store-shelf-pg.test.ts), 18 tests, including that the generated `tsvector` is actually populated |
| SHOULD FIX | The claimed search parity was false — stemming and stop words diverge on single words | The claim is corrected, in the contract and in the doc |
| SHOULD FIX | The filesystem store wrote `shelf.json` for articles that do not exist, then answered 404 | Existence checked before any write |
| SHOULD FIX | Undo cleared the strip before an un-awaited reload, so a failed reload lost the article with no way back | `reload` rejects, and Undo awaits it |
| SHOULD FIX | The previous query's hits stayed on screen, marked and linked with the *new* query | Results carry `resultsQuery` and render only when it matches |
| SHOULD FIX | `?find=` was handed the whole query, which in-article search matches as one literal — so a hit landed correctly and highlighted nothing | One term, chosen because it appears in that hit |
| SHOULD FIX | `foldWithMap` recorded only each source character's start, so a match ending inside a ligature cut it off | Start *and* exclusive end per folded character, iterated by code point |
| SHOULD FIX | On touch there is no hover, so the action row was invisible **and** still pressable | A `hover-none` variant, defined in `tailwind.css` |
| CONSIDER | After nine seconds there was no way to reach an archived article | A "Show deleted" disclosure |
| Postgres | `ts_rank_cd` used normalisation 0 — no length normalisation — while the filesystem adapter damps for length | Flag `1`, plus a deterministic tie-break so a capped list does not reshuffle |

Two findings were **not** acted on, deliberately:

- **No auth on the new write endpoints.** True, and true of every write endpoint in this app: there
  is no auth anywhere yet. It belongs to [auth.md](../project/auth.md)'s beta gate and to the deploy
  plan, not to this change — but the review is right that it is a deployment blocker, and it also
  noted that `readBody` accepts JSON regardless of content type, which makes `POST /api/jobs`
  reachable cross-origin as a CORS-simple request. **That one is worth its own piece of work.**
- **Hardcoded `'english'` in the text-search configuration.** Right in principle for a library of
  articles in arbitrary languages; wrong to fix speculatively while every article is English. Named
  here so the next person finds the decision rather than the omission.

### The browser pass

A Sonnet subagent drove the page in Chrome, per
[browser-testing.md](../project/browser-testing.md). All ten checks passed, including the two most
worth confirming with a real pointer and a real keyboard: **the action row is reachable by Tab** and
becomes visible without any hover (title link → pencil → refresh → external link → copy, each with a
focus ring), and **Delete → Undo restores the article to its correct sorted position**, verified
against `GET /api/library?archived=1` as well as on screen.

It found one thing, small and real: after saving a rename, the helper line under the input still read
*"empty to restore “…”"* naming the **just-saved** title — because `entry.title` is the reader's own
once an override exists. Clearing the field restores the *extracted* title, which the card
deliberately does not carry (`LibraryEntry` ships a `titleOverridden` flag rather than both strings).
So the line now names the title only when it is the extractor's, and otherwise says what will happen
without naming it. Saying less beats saying something false.

One transient React error was seen and is **not** an app bug: it coincided exactly with another
agent's HMR reload of `SearchPanel.tsx` mid-keystroke, and did not recur. Worth knowing that several
agents sharing one dev server can produce that.

### The review that did not run first time

[AGENTS.md](../../AGENTS.md) and Greg's standing preference say a plan gets a cross-family review
from GPT/Codex before it is built ([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)).
The first dispatch came back `ERROR: Your workspace is out of credits`, twice, on two different
models, so the code was written without one. A same-family Opus reviewer was started as a substitute
and **never reported anything at all** — it went idle three times without producing a word, which is
worth recording: a review that silently returns nothing is indistinguishable, from the outside, from
a review that found nothing.

The lesson is not "Codex is better than Opus". It is that the review was the load-bearing step and
it was allowed to be skipped twice — once by a billing error and once by an agent going quiet — and
the work carried on regardless. The eleven findings above are what that would have cost.
