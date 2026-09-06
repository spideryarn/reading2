# URL state

Everything about *how you are looking at an article* lives in the query string — and, since
2026-08-26, everything about how you are looking at **the shelf** does too
([§ The library's own five](#the-librarys-own-five)). Nothing the reader
can change lives in `useState`, and nothing lives in `localStorage` — with one exception since
2026-09-05, which is about *which address you arrive at* rather than about where state lives while
you are here: [§ Reopening an article where you left it](#reopening-an-article-where-you-left-it).
Which article you are looking at is the **path** — see
[§ Which article is the path](#which-article-is-the-path).

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
| `cols` | which gist columns are on. **Absent means automatic** — fit to the window ([granularity-zoom.md § fitting](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)). Present means the reader chose, and the window must not overrule them. **A `0` is dropped in silence** since 2026-09-05: there is no L0 column any more, and an old link is not an error (`offerableGists`, [layout.ts](../../src/web/layout.ts)). | push | `?cols=1,2`, or `?cols=none` |
| `text` | `1` reading mode, `0` outline mode. **Nothing writes it and `0` does not survive arrival, since 2026-09-05** — an incoming `?mode=hierarchy&text=0` is rewritten to `?mode=outline` and the pair is dropped whatever the mode, because the pill that could put the prose back has gone; see below | push | `?text=0` |
| `spine` | whether the bird's-eye rail is on screen. **Absent means on**, in every mode ([granularity-zoom.md § the spine](granularity-zoom.md#the-spine-a-birds-eye-rail)); `0` is the only thing that takes it away. **Read-only since 2026-09-05** — see below | push | `?spine=0` |
| `at` | the section in view, as its first block's id | **replace**, debounced | `?at=spya-tgnssb` |
| `note` | the explanation dialog that is open, as its comment id — [comments.md](comments.md) | **replace** | `?note=spya-k6fpme` |
| `panel` | which drawer panel is open, or absent for a shut drawer — [260825c-bottom-bar.md](../plans/260825c-bottom-bar.md) | **replace** | `?panel=questions` |
| `mode` | which **mode** owns the band between the spine and the prose, absent for `plain` — the article on its own, and the default since 2026-08-31 — [260826a-chat-mode.md](../plans/260826a-chat-mode.md) | push | `?mode=chat` |
| `thread` | which conversation is open — **`mode` decides how it is drawn** | **replace** | `?thread=spya-k3m9qt` |
| `term` | which glossary term is selected, absent for a list nobody has picked from — [glossary.md](glossary.md) | **replace** | `?term=spya-h4r2wd` |
| `idea` | which idea is selected, absent for a list nobody has picked from — [ideas.md](ideas.md). Mirrors `term` above in every respect, including the reason it replaces rather than pushes | **replace** | `?idea=spya-k3m9qt` |
| `quote` | which quote is selected, absent for a list nobody has picked from — [quotes.md](quotes.md). Mirrors `term` and `idea` above in every respect | **replace** | `?quote=spya-k3m9qt` |
| `rank` | how the quote list is ordered, absent for `document` — which is the **default**, on Greg's own instruction, unlike the glossary's `sort` below | push | `?rank=prioritised` |
| `bar` | the bar the quotes' prioritised order hides under — `max(importance, striking)`, where the glossary's `gate` is a product. **Absent means nobody has touched it**, which the panel reads as `QUOTE_BAR_DEFAULT` ([`QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx)) | **replace**, debounced | `?bar=0.55` |
| `sort` | how the glossary list is ordered, absent for `prioritised` | push | `?sort=document` |
| `gate` | the bar the glossary's prioritised order hides under — `difficulty × centrality` — **absent means nobody has touched it**, which the panel reads as `PRIORITY_GATE` ([`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx)) | **replace**, debounced | `?gate=0.45` |
| `match` | which matcher search mode is using: the letters you typed, or what they mean (default `meaning`) — [search.md](search.md) | push | `?match=words` |
| `find` | the literal text being matched, in words mode | **replace**, debounced | `?find=wet+hardware` |
| `run` | which saved meaning-search is showing, absent for the list of them | **replace** | `?run=spya-p7w2dn` |
| `order` | how the results list is stacked: `document`, `confidence` or `prioritised` | push | `?order=confidence` |
| `conf` | the bar the search results' `prioritised` order hides under, 0–100, in the unit the rows print. No default: absent means untouched | replace, debounced | `?conf=65` |
| `deep` | how far down the tree summary mode goes: `0` the article, `1` the parts, `2` the sections | push | `?deep=2` |
| `diagram` | which of the five pictures diagram mode is drawing, absent for the default `sketch` — [diagram.md](diagram.md) | push | `?diagram=trail` |
| `dx` | on `drift` only: what sideways means — `lanes` (the default) or `spread` | **replace** | `?dx=spread` |
| `dhue` | on `drift` and `trail`: what a dot's colour means — `section` (the default), `progress` or `topic` | **replace** | `?dhue=progress` |
| `referee` | which of Referee's four sub-modes is open: `criteria` (the default), `claims`, `mirror` or `candidates` — [referee-mode.md](referee-mode.md) | push | `?referee=mirror` |
| `remember` | which half of Remember is open: `recall` (the default) or `quiz` — [remember-mode.md](remember-mode.md). **Switching to Quiz clears `?thread=` in the same navigation**, and a pasted URL carrying both keeps Quiz and drops the thread with a *replace* — a conversation selected and invisible is the state this defines away | push | `?remember=quiz` |

**`referee` and `remember` are `diagram`'s shape, deliberately** — *which thing, within this mode* —
so all three push, and all three land an unrecognised value on the default rather than on an error
page. [`src/web/params.ts`](../../src/web/params.ts) says why beside each parser.

**`dx` and `dhue` replace where `diagram` pushes**, and the split is the one this
file draws everywhere: `?diagram=` is a *different picture* and Back should undo
it, where the other two are ways of looking at one picture — a reader flicking
between lanes and spread to compare them should not have to press Back eight
times to leave. Same call `?gate=` makes on either side of the same
line.

**Diagram mode's one exception, and it is deliberate**: which sections the
reader has *collapsed* is not in the URL at all. Node ids are positional and a
re-run of `npm run hierarchy` renumbers them ([block-ids.md](block-ids.md)), so a
pasted link would open the wrong sections on an article that had been
re-ingested. `dx` and `dhue` are safe for exactly the reason that one is not —
they are stable words rather than ids, so no amount of re-ingesting can make
them quietly wrong.

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
[260826y-library-sorting.md](../plans/260826y-library-sorting.md).

**Two superseded spellings, both still working.** `?about=1` was the masthead's details disclosure
and `?panel=about` was the drawer panel that replaced it. Both are gone: the article's details are a
page now, `/read/<slug>/metadata` ([260825e-metadata-page.md](../plans/260825e-metadata-page.md)). Old links carrying
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
reader's question.

**And then the toggle went again, on 2026-09-05, and the parameter stayed.** Greg: *"we don't need
the 'Spine' button (let's just default to always showing it)"* — so the rail is on wherever nobody
has said otherwise, outline mode included, and nothing on screen writes `?spine=` or `?text=` any
more ([260905d](../plans/260905d-declutter-the-reading-view-top-bars.md)). Both are still honoured
on arrival: `?spine=0` still hides the rail.

**`?text=0` does not survive arrival, since stage 3 of that plan.** It was the one address the
reader could not leave: the `Text` pill was the only way back to the prose and it went with the bar.
So `settleAddress` rewrites it (`liftStrandedText` in [router.ts](../../src/web/router.ts)) —
**`?mode=hierarchy&text=0` → `?mode=outline`, and the `text` pair is dropped whatever the mode was.**

Three things about that rule are not the obvious ones, and each is why it is written as it is:

- **It is the Hierarchy spelling that strands anybody**, not a bare `?text=0`. `inMode` is
  `mode !== "hierarchy"` and `proseVisible` is `modeBand || showText`, so a mode band shows the
  article whatever `?text=` says — `?mode=glossary&text=0` has always been a no-op.
- **The pair is dropped anyway, in every mode**, and that is defusing rather than tidying: leave
  `text=0` on a Plain address and the reader walks into the stranded state the moment they press
  Hierarchy on the Dock, because the parameter is still in the URL.
- **Outline, not Plain** — arbitrated by Fable, 2026-09-05. Neither restores the no-prose state, so
  "honour what they asked for" cannot decide it. What does is that the reader who saved that link was
  looking at a bar that said **OUTLINE**: the old `reading`/`outline` chip flipped whenever `text=0`
  was on, and this file's neighbour calls the compact table "outline mode" throughout.

The **server predicts the same rewrite** — `readMode` in [read-address.ts](../../src/read-address.ts)
— or the tab would read Hierarchy and be replaced a second later
([page-titles.md](page-titles.md)). It is also out of `REMEMBERED` in
[last-view.ts](../../src/web/last-view.ts): a restore runs after the rewrite, so a stored `text=0`
would walk straight past it.

Deleting the parameters outright would save little — `fitView` still needs a three-state answer, and App.tsx puts
`?spine=` back to *absent* when Search or Ideas opens for a reader who had hidden the rail — and it
is a URL-contract change, which is a different kind of change from taking a button off a bar. So
this is now a parameter with no writer, which is a fair description of a **link format**.

`cols=none` exists because the empty list would otherwise serialize to an empty string, which is
indistinguishable from the parameter being absent — and absent means *automatic*, which is the
opposite of "the reader turned every column off".


### One conversation id, two ways of drawing it <a id="one-thread-id"></a>

`?thread=` names the open conversation and **`mode` says where it is drawn**:

| `?thread=` | `mode=chat` | what you see |
|---|---|---|
| set | yes | the conversation in the band, full width |
| set | no | the same conversation floating over the article |
| unset | either | no conversation open |

So "open in full chat" from the floating panel is `setMode("chat")` and nothing else — the id is
already right — and leaving chat mode puts the panel back where the reader left it, for free.

A second parameter was drafted for the floating panel and rejected in review: it would have carried
nothing `mode` does not already carry, and two ids that can disagree is a bug waiting to be written.
See [260826ab-chat-as-gateway.md](../plans/260826ab-chat-as-gateway.md).

**The passage a *new* conversation is about is not in the URL.** Before the reader sends anything
there is no conversation to link to, and the quote is the article's words sitting in their selection
— which [logging.md](logging.md) keeps out of logs, and this keeps out of browser history and out of
any link they share. It lives in component state and is lost on reload, which costs one re-selection.

## Which article is the path

`?slug=` is gone. An article is `/read/<slug>`, and the parameters above describe how you are looking
at it. One rule divides them:

**The path says which article. The query string says how you are looking at it.**

That arrived with the library ([library.md](library.md)) on 2026-08-25, and it is the reason an
article now has an address rather than a setting. `/` is the shelf; **an address nobody minted is
the 404 page**, since 2026-09-03 — it was the shelf until then, on the reasoning that a mistyped
link lands somewhere useful, which is true and silent
([library.md](library.md#an-address-nobody-minted)).

**A mode is a parameter, not a segment.** `?mode=chat`, `?mode=glossary` and `?mode=search` replace
the middle band between the spine and the prose ([260826a-chat-mode.md](../plans/260826a-chat-mode.md),
[glossary.md](glossary.md), [search.md](search.md)).

**The default is `plain` since 2026-08-31**, and it was `hierarchy` before that. Plain is the
article and nothing else — no band, and no gist columns either — so a bare `/read/<slug>` opens the
prose, and `?mode=hierarchy` is what asks for the gist columns
([plain-mode-and-the-way-out.md](../plans/plain-mode-and-the-way-out.md)). Two consequences:
`?mode=hierarchy` now appears in copied URLs where nothing appeared before, since `withMode` in
[`Dock.tsx`](../../src/web/Dock.tsx) omits whichever mode is the default; and **every link written
before that day that said nothing about a mode now opens Plain rather than the hierarchy.** So does
every `?mode=toc` link, from before the 2026-08-29 rename, which used to survive on the
unrecognised-value rule landing it on a default that happened to be the view it named. Greg, asked:

> Can we tidy up/get rid of `toc` altogether. I'm not worried about breaking urls — we're in alpha
> and have no users yet.
>
> — Greg, 2026-08-31

What is left of that rule is still true and still worth having: **an unrecognised mode lands on the
default**, so a link from a future version degrades to the article rather than to an error page.

Modes push history, because a mode is where you are rather than a glance. Each
carries its own parameters — `?thread=` for the open conversation, `?term=` for the selected glossary
term, `?run=` for the saved search being shown, all `replace` because stepping between them is
browsing. `?sort=` orders the glossary and `?order=` orders the search results; both push, because
reordering a list is a deliberate act on the view.

**`?sort=`'s default changed on 2026-08-26**, which is worth stating because a default is what an
absent parameter *means*. It was `document`; it is now `prioritised`, so a bare `/read/<slug>` in
glossary mode hides what is below the threshold, and `?sort=document` is the one you now have to ask for. Old
links are unaffected — they all say what they want — and a glossary whose scores cannot support
prioritising falls back to `document` in the panel without touching the URL. See
[glossary.md § Prioritised, which is now the default](glossary.md#prioritised-which-is-now-the-default).

**`?gate=`, `?bar=` and `?conf=` are deliberately left without parser defaults**, which is the same
call `?cols=` makes and for a related reason. Each carries the threshold its mode hides under, and
the panel — not the parser — resolves an absent one to its own starting constant. Giving them
defaults here would put those constants in two files each and, worse, make *the reader set it to the
starting value* indistinguishable from *the reader set nothing* — a distinction that matters because
the whole condition on the glossary's scores is about the difference between a judgment somebody
asked for and one that simply arrived
([glossary.md § The threshold, and whose it is](glossary.md#the-threshold-and-whose-it-is)). All
three replace rather than push, and are debounced, for the reason `?at=` and `?find=` are: a range
input writes on every pixel of a drag, and Back should undo the decision that got you here rather
than the drag.

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

The exception is **a deliberate jump**, which pushes. That is a scroll, but you flung yourself
across the article and may well want it undone. Clicking a gist is the original case; choosing a
question out of the comments drawer is another, added 2026-09-06
([comments.md § Opening a question is a jump](comments.md#opening-is-a-jump)) — and the dialog's
Prev/Next deliberately are *not*, because stepping through twenty questions must not cost twenty
presses of Back. The override is per-call in `App.tsx`, not in the parser.

#### The pushed entry says where you came from

Since 2026-09-06 a jump does not only push: it also **rewrites the entry it is leaving** so that
`?at=` names where the reader was actually standing, and puts a stamp on `history.state` naming that
same place. That is what lets [`ReturnChip.tsx`](../../src/web/ReturnChip.tsx) offer *↩ back to
&lt;section&gt;* on a home-screen PWA, where there is no browser Back to press —
[260906g](../plans/260906g-back-to-where-you-jumped-from.md).

Three things about it are worth knowing before you touch anything near here:

- **The origin is measured, not read.** `?at=` is the wrong thing to stamp, in three separate ways:
  it is absent at the top, it deliberately holds a stale fine block while the reader moves inside one
  section (§ The unit is a section), and a jump's `throttle(0)` *cancels* the write queued behind the
  300ms debounce rather than flushing it. `measureOrigin` ([`keynav.ts`](../../src/web/keynav.ts))
  asks the layout instead.
- **Both writes belong to `watchHistoryWrites`** ([`router.ts`](../../src/web/router.ts)), not to the
  caller, and that is not a stylistic choice: nuqs keeps pending updates in a `Map` keyed by
  parameter name, so two `setAt` calls in one tick are not a transaction — the second overwrites the
  first, one push lands, and the predecessor rewrite silently never happens.
- **A push strips the stamp unless a jump armed it.** nuqs hands `pushState` the *current* entry's
  state verbatim, so without the strip a `cols` or `mode` toggle after a jump would inherit that
  jump's origin and the chip would promise a return it cannot make.

Nothing about it rides along in a shared link: the record lives on `history.state`, per entry, which
is why it is not a `?from=` parameter. The stamp is not a parameter and so is not in § The
parameters; the one place it is written down is
[`jump-history.ts`](../../src/web/jump-history.ts).

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

`?at=` always holds a **block id**. Ordinary scrolling writes the id of the **first block of the
section the reader is in** — depth `leafDepth - 1`, which is what `columnLabel` already calls
"Sections". A deliberate jump may name a finer block, and the spy preserves it while the reader
stays inside that block's section; that is the paragraph below on what the spy writes. Three things
follow from the unit the spy works in:

- **The update rate collapses.** The example article is 139 blocks but 36 sections, so most scrolling
  writes nothing at all.
- **The URL means something.** "The section that starts here" survives the article being re-extracted
  at a different length. A pixel offset would be a lie the moment anything reflowed — and it reflows
  constantly here, because toggling a granularity column changes every row height.
- **It is a block id**, so it obeys [the one contract](block-ids.md). Position is a block id, never an
  offset and never a selector.

Stated plainly, the cost: after ordinary scrolling, reopening a link puts you at the top of the
section you were in, not on the paragraph you were on. Within a section that is a few paragraphs of
backtracking. A URL last written by a jump to a finer block reopens on that block.

**A section is what the *scroll spy* writes, not a limit on what `?at=` may hold.** A deliberate jump
is allowed to leave a finer block there, and one routinely does: the diagram panel's ↑ / ↓ buttons
step by paragraph on Drift and Trail ([diagram.md § the step bar](diagram.md#the-step-bar-and-the-key-that-was-firing-twice)).
The spy's rule is therefore **"is the reader still inside the section the address already names?"**,
not "does the address equal the section I just measured" — those are the same question only while
every value in the address is a section, and the day one was not, the spy wrote the section's first
block over the paragraph when the queued position write landed. The mark moved and sprang back, and
the next press, computing from the top of the section again, moved nothing at all.

Since 2026-08-31 that panel **measures** the reader's row off the page rather than reading it out of
`?at=`, so the address is no longer the input to its next press — but the rule above stays, because
the address is still what a paragraph-fine jump leaves behind and springing back over it would still
move the mark.

The other half of that rule is that **a jump of ours in flight writes nothing.** `glide`
([`scroll.ts`](../../src/web/scroll.ts)) animates by calling `window.scrollTo` on every frame, so a
long jump fires exactly the scroll events a hand would; without the guard the spy names every section
the page flies *over* and lands holding the destination's section rather than the block the jump was
aimed at. This is not the "was that scroll mine or theirs?" guess the rest of the app refuses to
make — `glideTarget()` is the animation's own handle, and the reader taking over with a wheel or a
finger clears it. It is checked **before** the top-of-the-article branch, or a jump passing near the
top clears the address on its way past.

Both rules are `positionToWrite` in [`position.ts`](../../src/web/position.ts) — pure, so each clause
can be watched failing, which is how they were checked
([`tests/reading-position.test.ts`](../../tests/reading-position.test.ts)). GPT Sol found the glide
half of it in review of the first fix, 2026-08-30. The whole story, including the two commits between
which the assumption stopped being true and why it stayed invisible for five days, is
[260830b-the-spy-wrote-a-section-over-the-paragraph.md](../postmortems/260830b-the-spy-wrote-a-section-over-the-paragraph.md).

**It is emphatically not a node id.** Node ids (`n0003`) are handed out sequentially when the tree is
generated and are regenerated whenever `tree.json` is rebuilt, so a URL holding one would silently
point somewhere else after the next run. Block ids are minted once and preserved. The distinction is
easy to lose because the section *is* a node — hence the id of its first **block**.

## Reopening an article where you left it

> If I close and then reopen an article, it should ideally return me to the position/state/view that
> I was in. It's fine for this to be local to the device/browser, or whatever is simplest
>
> — Greg, 2026-09-05

Everything above is why that was nearly free. The state was already in one string; the only missing
piece was something to keep a copy of it and put it back. So: **the query string is copied into
`localStorage` under the slug as the reader moves, and put back when they open that article at an
address that says nothing.** [`src/web/last-view.ts`](../../src/web/last-view.ts), pinned in
[`tests/last-view.test.ts`](../../tests/last-view.test.ts), wired into `ArticlePage`
([`App.tsx`](../../src/web/App.tsx)). Per-device, no server, no schema — which is what he said was
fine.

**This does not make `localStorage` a second source of truth**, which is what the rule at the top of
this file is protecting. What is stored is a copy of an address the reader has already left, read
exactly once — in a layout effect, before anything paints — to decide which address they arrive at.
After that the URL is the only writer, exactly as before, and the two can never disagree because
only one of them is ever consulted.

**The link always wins.** A restore happens only when the incoming address carries **none** of the
article's parameters — not merely none of the remembered ones. So a shared `?at=`, `?note=` or
`?find=` beats this browser's memory outright, which it has to: getting that backwards would mean a
link you sent somebody opened somewhere else on their machine.

Some things are deliberately **not** put back, and the reason is one sentence — a dialog, a drawer,
an open conversation and a search are things the reader **did**, not places they **were**:
`?note=`, `?panel=`, `?thread=`, and search mode's whole matcher (`?match=`, `?find=`, `?run=`,
`?runs=`, `?order=`, `?conf=`).

**And three values of `?mode=` are remembered as *no mode*: `chat`, `diagram` and `remember`.** Each
of those starts something merely by being arrived in — Diagram POSTs `/api/similar` or
`/api/projection` for three of its five pictures, which costs a model call; Remember and Chat both
open a conversation. Their subordinate parameters are still remembered, so pressing Diagram or
Remember later returns the reader to the picture or the half they had chosen. The list is
`NEEDS_AN_EXPLICIT_PRESS` in [`last-view.ts`](../../src/web/last-view.ts), with the evidence for
each beside it. Two of the three were found by a cross-family review after a survey had reported all
thirteen modes inert — so **check the mode's own hook before adding one back**, and note that a
`?mode=` a reader *sent* in a link is untouched either way: this is only about what is replayed
unasked.

**A parameter this file gains later is neither remembered nor recognised**, and the second half of
that is the one that bites: a link carrying only the new parameter would look like a bare address
and be written over. `tests/last-view.test.ts` scans the client for `useQueryState` keys and fails on
one that neither list has heard of, so the thirty-sixth parameter is a decision rather than an
omission.

Deferred, and named in
[260905d](../plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md):
anything cross-device, pruning old entries, remembering the matcher, remembering which of the
article's three pages you were on, and any visible "start from the top" affordance.

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
It was recorded as open in [260825e-metadata-page.md](../plans/260825e-metadata-page.md) and is fixed now.

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
