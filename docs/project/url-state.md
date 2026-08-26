# URL state

Everything about *how you are looking at an article* lives in the query string — and, since
2026-08-26, everything about how you are looking at **the shelf** does too
([§ The library's own five](#the-librarys-own-five)). Nothing the reader
can change lives in `useState`, and nothing lives in `localStorage`. Which article you are looking at
is the **path** — see [§ Which article is the path](#which-article-is-the-path).

> Ideally, I would like to be able to remember the state. So if I, for example, scroll down to a
> particular place in the doc for example (or changed something else, etc etc), that should update
> the URL somehow.
>
> — Greg, 2026-08-25

> if I reload the page, I'd like it to return to the same location
>
> Or if I send someone a url

Those last two are not two features. They are one property — **the URL is always current** — looked
at from two sides. Reload reads the address bar; copy-paste reads the address bar. Neither needs any
storage, any server, or any code of its own, and the two can never disagree about where you were.

The code is [`src/web/params.ts`](../../src/web/params.ts) (what a link means) and
[`src/web/position.ts`](../../src/web/position.ts) (the section arithmetic behind `?at=`). Both are
pure and both are tested — [`tests/url-state.test.ts`](../../tests/url-state.test.ts).

## The parameters

| Param | Meaning | History | Example |
|---|---|---|---|
| `cols` | which gist columns are on. **Absent means automatic** — fit to the window ([granularity-zoom.md § fitting](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)). Present means the reader chose, and the window must not overrule them. | push | `?cols=0,1,2`, or `?cols=none` |
| `text` | `1` reading mode, `0` outline mode | push | `?text=0` |
| `spine` | whether the bird's-eye rail is on screen. **Absent means automatic** — off in outline mode, on wherever there is prose ([granularity-zoom.md § the spine](granularity-zoom.md#the-spine-a-birds-eye-rail)). Present means the reader chose, in either direction. | push | `?spine=0` |
| `at` | the section in view, as its first block's id | **replace**, debounced | `?at=spya-tgnssb` |
| `note` | the explanation dialog that is open, as its comment id — [comments.md](comments.md) | **replace** | `?note=spya-k6fpme` |
| `panel` | which drawer panel is open, or absent for a shut drawer — [bottom-bar.md](../plans/bottom-bar.md) | **replace** | `?panel=questions` |
| `mode` | which **mode** owns the band between the spine and the prose, absent for the table-of-contents columns that are the default — [chat-mode.md](../plans/chat-mode.md) | push | `?mode=chat` |
| `thread` | which conversation is open in chat mode, absent for the list of them | **replace** | `?thread=spya-k3m9qt` |
| `term` | which glossary term is selected, absent for a list nobody has picked from — [glossary.md](glossary.md) | **replace** | `?term=spya-h4r2wd` |
| `sort` | how the glossary list is ordered, absent for `prioritised` | push | `?sort=document` |
| `gate` | how high the prioritised order's bar is — `difficulty × centrality` — **absent means nobody has touched it**, which the panel reads as `0.30` | **replace**, debounced | `?gate=0.45` |
| `match` | which matcher search mode is using: the letters you typed, or what they mean (default `meaning`) — [search.md](search.md) | push | `?match=words` |
| `find` | the literal text being matched, in words mode | **replace**, debounced | `?find=wet+hardware` |
| `run` | which saved meaning-search is showing, absent for the list of them | **replace** | `?run=spya-p7w2dn` |
| `order` | how the results list is stacked: `document`, `confidence` or `prioritised` | push | `?order=confidence` |
| `conf` | the bar `prioritised` hides under, 0–100, in the unit the rows print. No default: absent means untouched | replace, debounced | `?conf=65` |
| `len` | which rung of the length ladder summary mode is showing, absent for `gist` — [summaries.md](summaries.md) | push | `?len=long` |
| `deep` | how far down the tree summary mode goes: `0` the article, `1` the parts, `2` the sections | push | `?deep=2` |

Those are all `/read/<slug>`. The five below are `/`.

### The library's own five

The homepage was the one page not keeping this rule: until 2026-08-26 its search box was `useState`
and its order was whatever the server had sent, so neither survived a reload and neither could be
sent to anybody. Now:

| Param | Meaning | History | Example |
|---|---|---|---|
| `q` | what is in the shelf's search box — [library.md § Finding an article](library.md#finding-an-article-and-finding-a-passage-in-one) | **replace**, debounced | `?q=seth` |
| `by` | which keys the shelf is ordered by, coarsest first: `added`, `opened`, `title`, `length`, `opens`, `questions` | push | `?by=length,title` |
| `dir` | `asc` or `desc`, paired with `by` by position. **May be shorter than `by`, or absent, and the rest fall back to each column's own natural end** — newest first for a date, longest first for a length, A-to-Z for a title | push | `?dir=desc,asc` |
| `view` | `cards` (the default) or `table` — the same list, painted the other way | push | `?view=table` |
| `show` | `all` (the default) or `unread`, which is "never opened" | push | `?show=unread` |

**A list rather than one value**, because a shift-click adds a second sort key, and a compound order
the URL cannot carry is an order you cannot reload into or send to anybody. One key is a list of one.

**`dir` is allowed to be shorter than `by`, or missing entirely.** A default of `desc` would be
right for every key except Title, where it means Z-to-A; so the gaps are filled from each column's
own `sortDescFirst`, read through `naturalDirections` in
[`lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx). That is what makes `?by=title` a link
somebody can type. The conversion both ways lives in
[`lib/table-sort.ts`](../../src/web/lib/table-sort.ts) and is tested there — an id the table does
not have is dropped rather than passed on, because an unknown column sorts by nothing while looking
like it sorted.

**They are not called `sort` and `order`, and that turns out to be load-bearing.** Those two names
are taken, by the glossary's ordering and the search results' ordering, both on `/read/<slug>`. An
ordinary link off the shelf is a bare path (`readHref`) and `carriedSearch` only runs between one
article's own views — but the superseded `/?slug=x` spelling is rewritten to `/read/x` **keeping
every other parameter it arrived with** ([`main.tsx`](../../src/web/main.tsx)), so
`/?slug=x&by=length` really does land on an article page carrying `by=length`. Distinct names are
what make that harmless. A cross-family review found the first version of this paragraph claiming
the boundary was sealed, 2026-08-26. Beyond that: a URL should be readable without knowing which
page it is for, and a table with two rows called `sort` is a table apologising for itself.

The reasoning, including the three sorting rules that fail silently, is in
[library-sorting.md](../plans/library-sorting.md).

**Two superseded spellings, both still working.** `?about=1` was the masthead's details disclosure
and `?panel=about` was the drawer panel that replaced it. Both are gone: the article's details are a
page now, `/read/<slug>/metadata` ([metadata-page.md](../plans/metadata-page.md)). Old links carrying
either spelling are rewritten to that page before React mounts, by
[`main.tsx`](../../src/web/main.tsx), keeping every other parameter they arrived with. `about=0` is
left alone — it meant the panel was shut, which is not a reason to send anybody anywhere.

**`?spine=` is what this file said would happen, and it is worth keeping the sentence.** Until
2026-08-26 the bird's-eye rail was deliberately *not* a parameter: its visibility was derived rather
than chosen — off in outline mode, ticks rather than labels when the labels would cost a gist column,
both decided by `fitView`
([granularity-zoom.md § fitting](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them))
— and nothing the reader set meant there was nothing to remember. This paragraph then said: *if it
ever gains a toggle it gains a param, and `parseAsBit` is already the right parser for it.* It gained
a toggle, and that is exactly what it cost.

Note which half of the old rule survived. The parameter says **on or off** and the derivation keeps
everything else: full-vs-narrow is still `fitView`'s, because how much room there is was never the
reader's question. And absent still means derived, which is why this one has no default — see
`?gate=` below for the same call made for the same reason.

`cols=none` exists because the empty list would otherwise serialize to an empty string, which is
indistinguishable from the parameter being absent — and absent means *automatic*, which is the
opposite of "the reader turned every column off".

## Which article is the path

`?slug=` is gone. An article is `/read/<slug>`, and the parameters above describe how you are looking
at it. One rule divides them:

**The path says which article. The query string says how you are looking at it.**

That arrived with the library ([library.md](library.md)) on 2026-08-25, and it is the reason an
article now has an address rather than a setting. `/` is the shelf; anything that is not
`/read/<slug>` is also the shelf, including nonsense, so a mistyped link lands somewhere useful
instead of on a 404.

**A mode is a parameter, not a segment.** `?mode=chat`, `?mode=glossary` and `?mode=search` replace
the middle band between the spine and the prose ([chat-mode.md](../plans/chat-mode.md),
[glossary.md](glossary.md), [search.md](search.md)); the default, `toc`, is the gist columns and
never appears in a URL. They push history, because a mode is where you are rather than a glance. Each
carries its own parameters — `?thread=` for the open conversation, `?term=` for the selected glossary
term, `?run=` for the saved search being shown, all `replace` because stepping between them is
browsing. `?sort=` orders the glossary and `?order=` orders the search results; both push, because
reordering a list is a deliberate act on the view.

**`?sort=`'s default changed on 2026-08-26**, which is worth stating because a default is what an
absent parameter *means*. It was `document`; it is now `prioritised`, so a bare `/read/<slug>` in
glossary mode is the two-group order, and `?sort=document` is the one you now have to ask for. Old
links are unaffected — they all say what they want — and a glossary whose scores cannot support
prioritising falls back to `document` in the panel without touching the URL. See
[glossary.md § Prioritised, which is now the default](glossary.md#prioritised-which-is-now-the-default).

**`?gate=` is the one parameter deliberately left without a default**, which is the same call `?cols=`
makes and for a related reason. It carries the threshold that order gates on, and the panel resolves
an absent one to `PRIORITY_GATE`. Giving it a default here would put that constant in two files and,
worse, make *the reader set it to 0.30* indistinguishable from *the reader set nothing* — a
distinction that matters because the whole condition on the glossary's scores is about the difference
between a judgment somebody asked for and one that simply arrived
([glossary.md § The threshold, and whose it is](glossary.md#the-threshold-and-whose-it-is)). It
replaces rather than pushes, and is debounced, for the reason `?at=` and `?find=` are: a range input
writes on every pixel of a drag, and Back should undo the decision that got you here rather than the
drag.

`?term=` is in the URL for a reason worth stating: **a selected term underlines every one of its
occurrences in the prose**, so "the article as I am currently looking at it" is not fully described
without it. Sending someone a link to a term sends them the underlines too. `?find=` and `?run=` are
there for exactly the same reason, and it is the same reason a fourth time: a search washes the
passages that match, so a URL without it shows you a different page from the one you were sent.

**Search mode has four parameters and every other mode has one or two**, which is worth explaining
rather than treating as sprawl: it holds two matchers rather than one feature. `match` says which
matcher, and then exactly one of `find` and `run` is the thing being matched. Its `?order=` is
deliberately not the glossary's `?sort=` — two modes' orderings have nothing in common but the word,
and `sort=difficulty` arriving in search mode would be a value with no meaning that something would
eventually have to guess at.

`match` **defaults to `meaning`** since 2026-08-26, and the one consequence worth writing down here
is a URL that carries `?find=` and no `?match=`. There is exactly one producer of those — the
library's passage deep-link — and it now says `match=words` out loud rather than relying on the
default to mean what it used to. Anywhere else, reaching words mode is something the reader did, and
doing it pushed the parameter. See [search.md § The URL](search.md#the-url).

**A third segment says which of the article's pages**, added the same day:
`/read/<slug>/metadata` and `/read/<slug>/tweets`. That does not bend the rule — those are still the
same article, and which page you are on is not something you would want to reset by changing a
parameter. An unknown third segment is the shelf too. The query string travels between all three, so
stepping out to the metadata page and back returns you to the paragraph you left; `?panel=` is the
one thing left behind, because a drawer is not a place you were. See `carriedSearch` in
[`router.ts`](../../src/web/router.ts) and
[library.md § The routes](library.md#the-routes).

**`/add/<a whole URL>` is the one path whose parameter is not ours**, added 2026-08-26:

> Add a url that I can use to add something directly, e.g. `/add/[my-full-url-here]` or
> `/?add=[my-full-url-here]` or similar
>
> — Greg, 2026-08-26

It bends the rule above rather than breaking it — the path still says *what*, the query string still
says *how you are looking at it* — but what it names is somebody else's address rather than one of
our slugs. Three spellings arrive and one reaches React:

| You type | What happens |
|---|---|
| `/add/https://example.com/x` | rewritten to the encoded form before React mounts |
| `/?add=https://example.com/x` | the same |
| `/add/https%3A%2F%2Fexample.com%2Fx` | what the app itself mints, and what the address bar ends up showing |

**The encoding is not tidiness.** A raw pasted URL with a query string — `/add/https://x.test/a?utm=1`
— has already been split by the browser into a pathname and a `location.search` by the time anything
looks at it, and from there `utm=1` is indistinguishable from one of the parameters in the table
above. Percent-encoding puts the whole address in one path segment, where nothing can take a bite out
of it. `addUrlFrom` in [`router.ts`](../../src/web/router.ts) is handed the whole location for
exactly that reason, and tells the two spellings apart on an exact test rather than a guess:
`encodeURIComponent` escapes both `:` and `/`, so an encoded segment can contain neither and every
URL worth adding contains both.

`/add` and `/add/` with nothing after them are the shelf, where the add box is — the same
"anything else is the shelf" rule as everywhere else on this page. See
[ingest-queue.md § The add page](ingest-queue.md#the-add-page) for what the page then does.

Old `/?slug=x` links keep working. [`main.tsx`](../../src/web/main.tsx) rewrites them to `/read/x`
before React mounts, carrying every other parameter across untouched — the same trick, and for the
same reason, as the `/#spya-…` rewrite below. It uses `replaceState`: the old address is not a page
the reader visited, it is a spelling they arrived in, and Back should not return them to it.

The routing is [`src/web/router.ts`](../../src/web/router.ts), fifty lines of our own rather than a
router library. [library.md § Fifty lines of router](library.md#fifty-lines-of-router-not-react-router)
has the argument, and the load-bearing half of it is about nuqs: told to, it patches
`history.pushState`, so calling `pushState` ourselves means nuqs sees our navigations exactly as it
sees its own. **Told to** is the operative part — `main.tsx` calls `enableHistorySync()`, and until
it did (2026-08-25) none of that was true and a debounced `?at=` write could land on the next
page's URL.

## Three decisions

### Position replaces history; deliberate acts push

> scrolling should replace rather than adding to history because we don't need the back button to
> change scrolling
>
> — Greg, 2026-08-25

So `at` is `history: 'replace'` — the address bar stays current without ever adding an entry. Back
then undoes the last thing you *did*: switched article, toggled a column, went to outline mode. It
never crawls you back up the page one screen at a time, and it always eventually leaves the page,
which a scroll-history would make miserable (browsers throttle rapid Back, so 200 entries is not
merely tedious).

The one exception is **clicking a gist to jump**, which pushes. That is a scroll, but it is a
deliberate act — you flung yourself across the article and may well want that undone. The override is
per-call in `App.tsx`, not in the parser.

### Debounced, not throttled

Greg's suggestion, and the right one. Mid-flick the URL is of no use to anybody, so there is nothing
to gain by keeping it live through the movement and something to lose: browsers rate-limit
`replaceState` (~50ms in Chrome, ~120ms in Safari) and warn when you push past it. Waiting for the
reader to settle also means the URL records where they **landed**, rather than every section they
flew over on the way. `POSITION_SETTLE_MS` is 300ms.

### The unit is a section, not a position

> store the section rather than the exact position?
>
> — Greg, 2026-08-25

`?at=` holds the id of the **first block of the section the reader is in** — depth `leafDepth - 1`,
which is what `columnLabel` already calls "Sections". Three things follow:

- **The update rate collapses.** The example article is 139 blocks but 36 sections, so most scrolling
  writes nothing at all.
- **The URL means something.** "The section that starts here" survives the article being re-extracted
  at a different length. A pixel offset would be a lie the moment anything reflowed — and it reflows
  constantly here, because toggling a granularity column changes every row height.
- **It is a block id**, so it obeys [the one contract](block-ids.md). Position is a block id, never an
  offset and never a selector.

Stated plainly, the cost: reopening a link puts you at the top of the section you were in, not on the
paragraph you were on. Within a section that is a few paragraphs of backtracking.

**It is emphatically not a node id.** Node ids (`n0003`) are handed out sequentially when the tree is
generated and are regenerated whenever `tree.json` is rebuilt, so a URL holding one would silently
point somewhere else after the next run. Block ids are minted once and preserved. The distinction is
easy to lose because the section *is* a node — hence the id of its first **block**.

## Why the query string and not the hash

Deep links used to be `/#spya-k6fpme`. They now arrive as `?at=spya-k6fpme`;
[`main.tsx`](../../src/web/main.tsx) rewrites the old form before React mounts, so old links keep
working.

The hash had to go for two reasons. Blocks carry their id in the HTML, so the browser scrolls to the
block *itself* on load — and then our own code scrolls again to offset it below the sticky bars, so
you watch it land twice. And a hash-based position beside query-string everything-else is two
unsynchronised state systems, with `hashchange` and `popstate` to reconcile. One query string, one
listener.

Related: [`main.tsx`](../../src/web/main.tsx) sets `history.scrollRestoration = 'manual'`. The
browser's own restore is both wrong and late — wrong because the offset it remembers was measured
against whichever columns happened to be open, and late because it lands after ours and therefore
wins.

## The library: nuqs

Chosen 2026-08-25 against
[third-party-library-selection.md](../reusable/third-party-library-selection.md). **nuqs 2.10.0**,
published five days before it was picked; ~4.5M downloads a week, 10.8k stars, commits the same week.
`useQueryState` is deliberately `useState`-shaped, parsers are composable and typed, and it has one
runtime dependency.

Two things decided it over the alternatives:

- **It does not require a router.** `nuqs/adapters/react` is the plain-SPA adapter: one
  `<NuqsAdapter>` in `main.tsx`, no route tree, no Vite config. Still true after the library added
  path routing, because [that router](library.md#fifty-lines-of-router-not-react-router) is fifty
  lines of `history.pushState` rather than a library — and nuqs patches `pushState`, so it stays in
  step with no adapter change. If a real router ever arrives we change that one import and every call
  site is untouched.
- **Rate-limiting and replace-vs-push are the API**, not something bolted on. Those are exactly the
  two decisions above, and they are one option each.

| Rejected | Why |
|---|---|
| **react-router v7** `useSearchParams` | Would mean adopting a router for state alone, and gives raw strings — no parsing, no defaults, no rate limiting. We'd hand-roll a parser layer on top and arrive back at nuqs. |
| **TanStack Router** | The strongest typed-search story of the lot, but it needs a full route tree. Real framework churn while the ideas are still moving; revisit if we ever get genuine multi-document routes. |
| **use-query-params** | The previous generation of this idea, and now inactive — last publish nine months ago. |
| **Hand-rolled `URLSearchParams` + `pushState`** | The four traps are all ones we'd hit: history spam from un-throttled writes, `push` where `replace` was meant, forgetting `popstate` so the UI drifts from the URL on Back, and re-parsing every render. Perhaps 150 lines to get right and then own. |

Gotcha worth knowing: `throttleMs` is deprecated as of nuqs 2.5.0. Use
`limitUrlUpdates: debounce(ms)` / `throttle(ms)`, which is what `params.ts` does.

## See also

- [library.md](library.md) — the homepage, and the path half of a link
- [web-client.md](web-client.md) — the reading view this is the state layer for
- [granularity-zoom.md](granularity-zoom.md) — what the columns and the spine actually do
- [block-ids.md](block-ids.md) — **read before touching anything that resolves an id**
- [browser-testing.md](browser-testing.md) — the URLs worth checking by hand
- [testing.md](testing.md) — what's pinned deterministically

## `note` replaces, even though opening a dialog is deliberate

Every other deliberate act pushes. `note` is the exception, and the reason is arithmetic rather than
principle: opening a panel and closing it again is *two* state changes, so pushing would put two
entries on the stack for one gesture and Back would walk the reader through panels they had already
finished with. Replacing keeps the paste-a-link property, which is the part that earns the parameter
its place.

A comment id is minted by the same `mintId` as a block id ([block-ids.md](block-ids.md)), so
`parseAsBlockId` validates it and a mangled `?note=` degrades to "no dialog" rather than to an
error — the same bargain as `?at=`.

### When `?note=` and `?at=` disagree, the note wins

Two parameters in one URL can both sound like a position. Until 2026-08-26 only one of them moved the
page: `?at=` restored the section, `?note=` opened the dialog, and nothing connected them. So
`/read/<slug>?note=<id>` **with no `?at=` beside it** opened an explanation of a paragraph that was
somewhere off screen, with no way to tell where. That is not an edge case — it is the ordinary shape
of a link somebody *sends*, because `?at=` is only in the URL if the sender happened to have scrolled.
It was recorded as open in [metadata-page.md](../plans/metadata-page.md) and is fixed now.

The rule, and the reason for it: **`?at=` is a byproduct and `?note=` is the point.** Position is
written by scrolling — debounced, replacing rather than pushing, saying where the sender's eye was
when the address bar last caught up. A `?note=` is only ever in a URL because somebody opened a
dialog. When the two point at different parts of the article, one of them is what the link is *about*.

Nothing is lost when they agree. If the note's passage sits inside the section `?at=` restored, the
passage is simply the finer of the two answers — and the code checks whether it is already on screen
before moving, so that case costs no movement at all. Same check `goToComment` makes for stepping
between comments, and for the same reason: two comments in one paragraph are the common case, and
jolting the page between them loses the reader their place for nothing.

Two things about *when*, both worth knowing before you touch it:

- **It waits for the fetch.** A pasted link carries a comment id; the block that comment is anchored
  to arrives over the wire. So the jump happens when the comments land, not when the URL is read.
- **It fires once, for the note the page opened with.** After that, moving between comments belongs
  to `goToComment`. Two things moving the page is two things to keep in agreement.

The rule itself is `arrivalTarget` in [`scroll.ts`](../../src/web/scroll.ts) — pure, and pinned in
[`tests/scroll.test.ts`](../../tests/scroll.test.ts). The wiring is one effect in
[`App.tsx`](../../src/web/App.tsx), beside `goToComment`.

We do **not** rewrite `?at=` to match. The scroll moves the page, the position tracker notices, and
the URL catches up 300ms later exactly as it does for a wheel — which is the same arrangement
`goToComment` and the arrow keys already rely on. One writer for `?at=`, and it is the page.
