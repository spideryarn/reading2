# Sorting the shelf

**Status: built, 2026-08-26.** The homepage now orders itself by six keys in
either direction, hides what you have already opened, and paints the same list
either as the rich cards it always had or as a dense table. All of it lives in
the URL.

> Make the set of docs on the homepage nicely sortable (e.g. by when added, when
> last opened, how many words, how many actions/interactions performed), as well
> as the search bar, adding, and any other actions or UI that would be useful …
> Maybe it's misleading to call this tabular, because I kind of like the rich
> cards that we have right now, so look for a best of all worlds.
>
> — Greg, 2026-08-26

The last sentence is the whole brief, and the answer to it is one line:

**One sort state, two renderers.**

The chips above the shelf drive the cards and the table identically. Switching
between them keeps your place in the order, because there is only one order.
Neither is a fallback for the other: the card is a *decision aid* — what the
piece says and how long it will take — and the table is a *comparison* — how
this article stands against the rest of the shelf. The card keeps the blurb; the
table gives it up and shows every column at once.

## What was built

| Piece | File | Reusable? |
|---|---|---|
| The chips, the dense table, and the three TanStack options that are decisions | [`src/web/lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) | **yes** |
| Sorting state ⇄ URL, the collator, `sinkLast` | [`src/web/lib/table-sort.ts`](../../src/web/lib/table-sort.ts) | **yes** |
| "3 days ago", and the clock that keeps it true | [`relative-time.ts`](../../src/web/relative-time.ts), [`useNow.ts`](../../src/web/useNow.ts) | **yes** |
| What the shelf can be sorted by, and how each column draws | [`src/web/library-columns.tsx`](../../src/web/library-columns.tsx) | no |
| Unread, and cards-or-table | [`src/web/ShelfControls.tsx`](../../src/web/ShelfControls.tsx) | no |
| The card, the five buttons, rename, the tooltip | [`src/web/ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) | no |
| The page: fetch, URL state, the narrowings | [`src/web/Library.tsx`](../../src/web/Library.tsx) | no |
| Five parameters | [`src/web/params.ts`](../../src/web/params.ts) § the library | no |
| The rules, against a real table | [`tests/library-sorting.test.ts`](../../tests/library-sorting.test.ts) | — |

Six sort keys: **Added**, **Last opened**, **Title**, **Length**, **Times
opened**, **Questions**. The last two are Greg's "how many actions/interactions
performed" — and they are the only two we can honestly count, because opens and
comments are the only reader interactions that are stored as numbers. Chat
threads and saved searches are *not* counted, for the reason the tooltip already
gives: they have not moved to Postgres, so a count would read 7 on the
filesystem and 0 in production ([library.md § The tooltip](../project/library.md#the-tooltip)).

## The five decisions worth writing down

### 1. TanStack Table v8 — after building it by hand first

Followed [third-party-library-selection.md](../reusable/third-party-library-selection.md).
The web research (2026-08-26) ranked **TanStack Table v8** first — headless, ~15
kB, 4+ years of pretraining data, and what shadcn's own data-table recipe wraps —
with v9 explicitly rejected for now: it went stable around early August 2026 with
a breaking API, so there is almost no Q&A or example corpus for it yet, and
shadcn has not finished migrating ([shadcn-ui/ui#11389](https://github.com/shadcn-ui/ui/issues/11389)).

**It was hand-rolled first, and shipped that way**, on the research's own
estimate: 60–120 lines, no dependency, and *"hand-rolling is not a compromise —
it's arguably the more boring choice"* at this scale. The measured sort
machinery came to **36 lines**; the other hundred that estimate covered were the
spec table and the controls, which no headless library was ever going to write.

Then Greg overrode it, and the reason is not about this page:

> Switch over to Tanstack (because I think we'll also want this kind of thing in
> other places)
>
> — Greg, 2026-08-26

That changes the arithmetic completely. Thirty-six lines of comparator is a bad
trade for a dependency **once**; it is a good trade if two or three more lists
want the same thing, because the second one costs nothing. So the code is
arranged around that: `lib/DataTable.tsx` and `lib/table-sort.ts` contain no
mention of the library, and a page that wants sortable rows writes column
definitions and gets the chips and the table.

AG Grid (~330 kB), MUI DataGrid (wrong ecosystem — we are Tailwind, not MUI) and
Mantine React Table (wrong ecosystem, canonical package semi-abandoned) were all
considered and are all wrong for this.

#### Why TanStack in the end

Headless is the property that mattered. It owns the sorting rules and **none of
the markup**, so every `<th>`, `<td>` and chip stayed ours — which is why the
card that says what it is sorted by survived the switch untouched. A batteries-
included grid would have made that feature a fight.

What we got that we did not have: **multi-column sort** (shift-click, and
shift-Enter from the keyboard, with no code of ours involved),
`sortUndefined: "last"` as a supported option rather than a hand-written branch,
and a toggle rule — which end a column starts at, what a second click means,
what shift does — that we deleted rather than maintain.

What it cost: **+17.5 kB gzipped** (172.9 → 190.4 kB), measured, against the
~15 kB the research predicted. And a second owner of state, which is the thing
[url-state.md](../project/url-state.md) rejected react-router over — handled by
running TanStack fully controlled, with nuqs as the only source of truth and
`onSortingChange` writing straight to the address bar.

#### The two things it does not do, both found by a test

**Its last-resort tiebreak is `rowA.index`** — the order the data arrived in. So
equal rows are only stably ordered if the incoming array is, and if it is not, a
reload quietly reshuffles the list. The data is therefore sorted by slug before
the table sees it. Done at the door and not inside a `sortingFn`, because a
tiebreak inside one gets multiplied by the descending inversion: it would
reverse with the arrow, which is not what a tiebreak is.

**Its built-in `"text"` sort compares code points.** It lower-cases and uses
`<`, so it puts "Étude" after "zebra" (É is above z in Unicode) and "Part 10"
before "Part 2". Both wrong in the ordinary sense of wrong, and both look like a
sort that is working. The hand-rolled version had used an `Intl.Collator`, and
`sortingFn: "text"` looked like a straight swap for it. The only thing that said
otherwise was an assertion carried over from the old test file — which is the
argument for porting tests before deleting the code they tested.

### 2. The card says what it is sorted by

A card sorted by something it does not show is a list in an order the reader
cannot check — *"why is this one at the top?"* has to be answerable from the
card. So the date on the right of the meta line becomes the sort key's own
value: **Last opened** turns it into "opened 25 Aug", **Questions** into "3
questions", **Times opened** into "opened 6 times". **Added** and **Length**
change nothing, because the card already carries both.

That is `CARD_NOTES` in `library-columns.tsx`, and it is why the sorts are a table
of data rather than a `Record<SortKey, comparator>`: the comparator is the
smallest thing a sort key needs to know about itself.

### 3. Three rules the browser cannot check, so a real table in a test does

The sort moved from the server into the client, and three things came with it
that look right in a browser and are wrong. They are now **configuration** —
`sortUndefined`, `sortDescFirst`, an accessor's return type — which is why
[`tests/library-sorting.test.ts`](../../tests/library-sorting.test.ts) builds an
actual `@tanstack/table-core` table over the real column definitions and asserts
the order that comes out. A test that re-implemented the comparator would go on
passing while the config that runs was wrong, which is the failure this repo
keeps writing up.

- **The fixture is pinned last, in every sort and both directions.** The server
  has always kept it at the foot of the shelf. Sort by Length in the browser
  without carrying that over and a committed demo excerpt sits above the
  reader's own library.
- **A missing value sorts last in *both* directions** — so this one comparison
  is deliberately not multiplied by the direction. Ascending by "last opened"
  would otherwise fill the top of the shelf with everything you have never
  opened. That is a useful thing to want, and it is what the Unread chip is
  for; smuggling it into the low end of a sort means it is unavailable in the
  other direction and unexplained in both.
- **Every comparison ends in a total order** — ties fall through to title and
  then slug. Without the last step, equal rows keep whatever order the server
  sent, so a reload can silently reshuffle the shelf.

Plus two smaller ones the tests also pin: an *unparseable* date is absent rather
than zero (`Date.parse("soon")` is `NaN`, and `NaN` in a subtraction makes every
comparison return `NaN` — a sort that does nothing at all), and `0` is a value
rather than absent (a falsy check would have put every unopened article below
every opened one in both directions).

### 4. Clicking a key you are not on starts at *its* natural end

Going from "newest first" to Title must not give you Z-to-A, because `desc` was
carried over from a key where it meant something else. **This is now
`sortDescFirst` on the column and TanStack's own toggle handler** — a
hand-written `nextSort` was the first thing the switch deleted, and the chips
and the headers now call the identical handler, so they cannot drift.

Each key still names its own two ends in its own words — "newest first",
"longest first", "A to Z" — because those strings are what the accessible names
say, and "ascending" tells you nothing about a date. They live in the column's
`meta`, which is TanStack's own mechanism for exactly this, typed by module
augmentation so a column that forgets its label is a compile error rather than a
chip with no words on it.

### 5. Everything is in the URL, including the search box

Five new parameters — `q`, `by`, `dir`, `view`, `show` — which is the rule the
app already ran on ([url-state.md](../project/url-state.md)) and which the
homepage was the one page not keeping. Until now the search box was `useState`
and the order was whatever the server sent, so neither survived a reload.

`by` and `dir` are **lists**, paired by position, because shift-click adds a
second sort key and a compound order the URL cannot carry is an order you cannot
reload into or send to anybody. `dir` may be shorter than `by` or absent
entirely, and the gaps fall back to each column's own `sortDescFirst` — which is
what lets `?by=title` on its own be a sensible link. A parser default of `desc`
would have made that one Z-to-A.

They are named `by`/`dir`/`view`/`show` rather than reusing `sort` and `order`,
which already mean the glossary's ordering and the search results' ordering on
`/read/<slug>`. Nothing carries a query string across that boundary, so the
collision would have been harmless — but a URL should be readable without
knowing which page it is for, and a doc table with two rows called `sort` is a
doc apologising for itself.

## What the interface borrows

The research surfaced three precedents, and two of them are load-bearing here:

- **Raindrop** ships four interchangeable views over one collection, switched by
  a small icon segmented control, with sort and filter shared across all of
  them. That is exactly "one sort state, two renderers", and it is the confirmed
  precedent for keeping the toggle small and the state above it.
- **Notion** treats table/list/gallery/board as views over one database — same
  architectural lesson: decouple *what data, sorted how* from *how it is
  painted*.
- **Linear** collapses sort, grouping, direction and column visibility into one
  "Display options" popover. That is the right answer at three times this many
  dimensions and is **what to reach for next**, not now: six chips fit on one
  line at this width, one click beats two, and the current order is readable
  without opening anything.

## Built in the second pass

Both of these were on the "deliberately left out" list an hour earlier, and both
arrived with the switch to TanStack — the first because the library makes it
nearly free, the second because Greg asked for it.

- **Multi-column sort.** Shift-click a chip or a header adds a second key; the
  chips then show an ordinal so a compound order can be read off the control.
  `?by=length,title&dir=desc,asc`. A plain click always collapses back to one
  key, which is what makes it safe to have — and is *not* what TanStack does on
  its own; see the file's own note in `lib/DataTable.tsx`.
- **Relative dates.** "opened yesterday", "added 3 days ago", up to about a
  month, after which they hand back to a real date. The clock is re-read once a
  minute so a shelf left open does not go stale, and the exact timestamp is
  still one hover away in the details tooltip — which was the objection when
  this was on the deferred list, and is answered rather than overruled.

## What is still deliberately left out

- **Saved views.** Notion's model, and a real feature — it needs somewhere to
  store them, which means the shelf-state tables. Not now.
- **Column visibility** in the table view. TanStack gives it away free, and it
  needs a popover we do not have; it is the first thing to reach for if the
  table grows more columns.
- **Filtering by what has been built** (`has.arc`, `has.glossary`, …). Available,
  and too niche to spend a chip on.
- **Sorting the archived list.** It is a disclosure with a handful of rows in it,
  and giving it its own controls would make a footnote look like a second shelf.
- **A count on the Unread chip.** It would have to be computed above the control
  and threaded down for a word nobody reads twice. The "3 of 12 articles" line
  under the chips says the same thing once, for whichever narrowing caused it.

## What the reviews found

Two passes, both on the built code: a cross-family review by **GPT Sol** (`gpt-5.6-sol`, high
effort) and a **browser pass** driving the real page. They found different things, which is the
argument for doing both — the review reads attributes and history semantics, the browser measures
pixels.

### The browser pass

**The action column fell off the end of the table, at a window with room to spare.** A table sizes
each column to its content, and a long title has a wide *minimum* — `truncate` does not shrink it,
because the text still counts towards min-content. So the total came out at 895px inside an 848px
shelf, and what overflowed was the last column, which is Delete and Copy. Nothing looked broken: the
table simply scrolled, and you had to scroll it before you could reach two of the five buttons.

The fix is three utility classes on one cell — `w-full max-w-0` on the title column and `w-0` on the
action column. `max-w-0` takes the title's minimum down to nothing so it stops forcing the table
wide, `w-full` makes it claim the leftover, and the `truncate` inside it finally has a width to
truncate against; `w-0` on the actions means "as narrow as the buttons are". **A first attempt used
`table-fixed` with a hand-written width per column, and was worse**: it clips a header rather than
the title the moment anybody renames one, and six magic numbers go stale the day a seventh column
arrives. Every other column now sizes to its own content, which is what a table is supposed to do.
The measurement is written into `COLUMNS`, because the next person to add a column will otherwise
reintroduce this.

Everything else passed: the six chips fit on one line at 1400px and wrap cleanly at 700px, the sort
and the URL agree, Back steps one sort at a time, the card's meta line follows the sort, the fixture
stays pinned last, the table scrolls inside its own box rather than pushing the page sideways, and
the hover-hidden action buttons appear on keyboard focus.

### The cross-family review

Eight findings, seven fixed and one already correct.

**Two the shelf actually got wrong.**

*The Unread chip did not reach the passage results.* Turn Unread on, search for a word that only an
article you have read contains, and the page said "No unopened article matches …" and then listed
passages from that very article. Two answers to one question, on one screen. The passages are now
narrowed by the same rule, and the ones removed are **counted rather than dropped** — "3 more
passages are in articles you have already opened" — because *it is in something you have already
read* is the useful half of that answer. The honest cost is written down where it happens: the
server caps the list before we see it, so filtering afterwards can empty a list that had matches. It
is acceptable here and not in chat's `search_library` because the reader can see the chip they
pressed and the line says how many were hidden.

*A push inside the search box's debounce window lost the search from history.* `?q=` is written on a
200ms debounce; a sort click landing inside that window pushed an entry without the query in it, and
the query then replaced itself into the *new* entry. One press of Back then undid the sort and the
search together. Every push now writes `q` in the same batch with the limit lifted.

**Three smaller ones.** Clicking the already-active view button pushed an identical history entry, so
Back needed an extra press. Whitespace-only searches serialised to `?q=%20` and read back as `null`,
so the box emptied itself on reload while the URL still carried something — the one thing this
page's URL state exists to prevent. And the fixture: a comment claimed Unread let it through, the
code did not, and the test that was supposed to prove it used a fixture with `opens: 0` so it would
have passed either way. The uniform rule won — once you have opened the fixture it is read — and the
comment and the test now say so.

**Three accessibility findings.** `aria-label` *replaces* a button's visible text, so the card's
details button announced as "Details of …" while showing the words "3 questions" — WCAG 2.5.3 Label
in Name, and it means somebody driving the page by voice cannot say what they can see. The
accessible name now starts with the visible text, in three places (the card, the table, the Unread
chip). And `aria-sort` was on all six headers, five of them `"none"`; WAI-ARIA wants it on one at a
time, so the other five carry no attribute at all. Both of those had a comment next to them arguing
for the wrong thing, which is the useful shape of the lesson: the comment was reasoning about the
attribute rather than about what a screen reader would say.

**One documentation error, and it made a decision load-bearing.** The plan said no query string
crosses between `/` and `/read/<slug>`, so the distinct parameter names were merely tidy. Not quite:
`main.tsx` rewrites the superseded `/?slug=x` spelling and **keeps every other parameter it arrived
with**, so `/?slug=x&by=length` really does land on an article page carrying `by=length`. Harmless
because the names are distinct — which is to say, the naming choice is doing real work rather than
being a preference.

**One thing checked and confirmed right:** `setBy` and `setDir` in one click handler are one history
entry, not two. nuqs queues every synchronous write until the next tick and flushes them as a single
URL update.

### What was and was not re-checked in a browser

The table's width fix was measured afterwards and passes: at a 1340px viewport the wrapper's
`clientWidth` and `scrollWidth` are both 846, all five action buttons sit inside it, the Article
column comes out at 315px and truncates with an ellipsis when a title is long enough to need it, and
at 700px the page has no horizontal scroll of its own. Exactly one `<th>` carries `aria-sort`, and
the details button's accessible name now begins with the date it shows.

The other three fixes — the passages obeying Unread, the no-op view click, and the whitespace-only
query — were **not** re-driven in a browser; a second pass ran out of session and the third was
scoped to the measurement. They are small and deterministic, and the first of them has the only
behaviour worth a second look: a search under Unread that has hits only in articles you have read.

## The review of the migration

A second cross-family review (`gpt-5.6-sol`, high effort) on the TanStack version. Eight findings,
all real, and three of them were the kind that only a reviewer reading the library's own source
would have caught. It is the strongest argument for this habit that has come up so far, because
**every one of the three was a case of the library doing something other than what its option name
says**, and the code around them looked right.

### `?by=title` sorted Z-to-A

The per-column fallback — an absent `dir` means "each key goes whichever way it naturally goes" —
never ran, because `libraryDirParam` had `.withDefault(["desc"])`, so the parameter was never absent.
The one link the fallback existed for was the one link it did not reach. `dir` now has no default at
all, and the shelf leaves it out of the URL itself when `isAllNatural` says it would add nothing.

The pure test passed throughout, because it called `sortingFromUrl(["title"], [], …)` directly and
the bug lived in what nuqs handed that function. Worth remembering: a unit test of a pure function
cannot see a wrong argument.

### A hostile `by` could reverse a column, or empty the sort

`sortingFromUrl` filtered unknown ids and *then* used the surviving array's index to read `dir` — so
`?by=nonsense,title&dir=desc,asc` gave Title the direction meant for the id that had been dropped.
Duplicate ids sorted by one column twice with contradictory instructions, and `?by=nonsense` left an
empty sort: no chip pressed, the list in whatever order the data arrived in, and the cards still
claiming to be sorted by Added. Now filtered inside the loop, deduplicated, and defaulted when
nothing valid remains.

### `sortUndefined: "last"` is not a comparator when both values are missing

The one worth the whole exercise. TanStack 8.21.3 implements it as
`return aUndefined ? 1 : -1` — and with *both* values undefined, `aUndefined` is true, so it answers
`1` for `(a, b)` and `1` for `(b, a)`. It also returns before the next sort key is consulted.

What that looks like: sort by Last opened, then Title, over three articles you have never opened.
They should come out alphabetically. They come out in whatever order the array was already in, and
nothing about the result looks wrong.

So `sortUndefined` is now off entirely. The columns sort missing values *low*, consistently, both
returning `0` when both are missing so the next key gets a turn; and the rows whose primary key is
missing are moved to the bottom afterwards with `sinkLast` — the same helper the fixture uses. That
gets all three properties at once: missing last whichever way the arrow points, later keys applied
inside the missing group, and a comparator that is actually a comparator. The test for it goes red
against the old configuration, which was checked rather than assumed.

### Four smaller ones

**A plain click did not always collapse a compound sort.** TanStack toggles the direction of the
*last* key rather than replacing, so a reader could sit in a two-key order with no obvious way back
to one. `toggleSort` now states the rule the docs claimed.

**`aria-sort` was on every sorted header** once a second key was possible — WAI-ARIA wants one at a
time. Only the primary carries it now. And the header buttons' accessible names started with
`meta.label` ("Times opened") while the header visibly said something shorter ("Opens"), which fails
Label-in-Name for the second time in this feature; the name is now built from the visible text.

**`naturalDirections` did not mirror TanStack's own rules** — it only recognised an explicit `id` and
treated a missing `sortDescFirst` as ascending, where TanStack derives ids from `accessorKey` and
picks descending for numeric data *by looking at the values*. The shelf's own columns happened to say
both explicitly, so nothing was broken; but this is a seam meant for reuse, and the next page to use
it would have had a link that looked fine and sorted the wrong way. `SortableColumn<T>` now requires
both at the type level.

**The chips lost their deliberate order.** They followed column order once TanStack owned the
columns, which put Title first; Added is the default sort and should be leftmost. `SortChips` takes
an order, and appends anything missing from it rather than dropping it.

### Checked and confirmed correct

Worth recording, because these were the parts most likely to be subtly wrong: running TanStack fully
controlled with nuqs as the only source of truth (nuqs updates its React state synchronously before
the URL flush, and React flushes each discrete click separately, so two fast clicks do not lose the
first); `sameList` making `clearOnDefault` work so the default sort writes no parameters at all;
sorting the data by slug establishing `row.index` as a real tiebreak; `useShelf`'s memo; and both
rename call sites after the state moved out of the card.
