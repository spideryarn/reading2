# The metadata page

**Built 2026-08-25**, the same day it was planned. The plan below is kept as written; where the code
disagrees with it, § What the plan got wrong at the bottom says so rather than the plan being edited
to look right afterwards.

Everything we know about an article, on a page of its own at
`/read/<slug>/metadata`. Borrowed from the original version's Metadata tab, and it takes over from
the `About` panel in the bottom bar — which is deleted in the same piece of work.

> The plan is to … borrow functionality for the bottom-bar from `docs/project/original-version/`.
> Start with these (because they each have the entire page to themselves, so we don't have to worry
> about how to interact with the existing layout):
>
> - The Metadata view (which maybe needs its own `/read/[slug]/metadata/` url so it can have the
>   page to itself.
>
> — Greg, 2026-08-25

Read this beside [tweet-thread-page.md](tweet-thread-page.md), which is the other half of the same
job and depends on the routing change below.

## Why a whole page

Two reasons, and the second is Greg's.

**The layout reason.** This view's hard problem is horizontal —
[bottom-bar.md § Why the bottom](bottom-bar.md#why-the-bottom) is entirely about that. A page of its
own has no such problem, because it is not beside anything. That is precisely why these two were
picked to go first.

**The panel was the wrong size for it.** Asked what should happen to the existing `About` drawer
panel once a full page exists, Greg, 2026-08-25:

> We can get rid of the panel, and move all its contents into the new page.

So this is not an addition alongside the panel. It is the panel, grown into the room it needed. The
`About` button in the bar stops opening a drawer and starts being a link (and is
relabelled `Metadata`, after the page rather than the panel).

## What the original had

`components/tools/MetadataPanel.tsx` in the old repo — 1,273 lines, the 8th tab of the left pane,
`Cmd/Ctrl+8`, and **a panel rather than a page**. Greg's "maybe needs its own url" is therefore a
change from the original rather than a copy of it, and the right one: the thing is a full screen of
facts and it was living in a column.

Its reference doc is `docs/reference/TOOL_METADATA_TAB.md` over there. Seven sections:

| Their section | What was in it | Ours |
|---|---|---|
| Document Information | title (editable), upload date, source URL, file type | **take** |
| Reading Intent | "Your Reading Purpose", free text the reader set | **not now** — see below |
| Document Statistics | Words · Read Time · Book Pages | **take**, minus book pages |
| Processing Status | had the glossary / AI headings / summaries been generated | **take, and improve** |
| Reading Difficulty | an LLM's grade-level verdict, plus Flesch scores | **deliberately not** |
| Access & Sharing | public/private toggle, owner's email | **drop** — no accounts here |
| Document Actions | Delete Document | **drop for now** |

### Reading Difficulty: the one we are deliberately not taking

Their panel showed an LLM's document-level verdict — a four-level "Academic Level" badge (*High
school or below* → *Post-doctoral/expert*), a confidence, and a collapsible list of assessment
factors. One model call at `temperature: 0.1` and 500 max tokens, cached permanently, and the only
tool in that whole repo whose caching its docs describe as finished.

**A doc/code mismatch worth flagging before anyone goes looking.** `TOOL_METADATA_TAB.md` also
documents a Flesch-Kincaid implementation in detail — the formula, a seven-band colour-coded score
table, the lot. None of it is in the shipped component. The panel renders only the LLM badge, whose
colour scale tops out at orange and never reaches the red that table describes. So the Flesch
material there is documentation of something that was superseded or never built, and anyone
borrowing from that page should read the component rather than the doc.

We are not building the verdict, and the reason is not the accuracy argument. It is that a document-level
verdict does the reader's judging for them, which is what [vision.md](../project/vision.md) is
against. The case is already written up in
[difficulty-and-reading-time.md](../project/original-version/difficulty-and-reading-time.md), along
with what we would build instead if we ever do: a **per-node, per-passage** signal anchored to block
ids, so the reader can see where the hard parts are and still decide for themselves.

An earlier draft of this plan said the page should say so out loud — *"one line under the statistics
saying we do not score difficulty, and why, is more useful than the absence"*. Cut on review, and
rightly: absence is sufficient, and a manifesto about a feature nobody asked for is not what a
reader opening a metadata page is there for. The reasoning belongs here and in
[difficulty-and-reading-time.md](../project/original-version/difficulty-and-reading-time.md), which
is where somebody wondering will look.

### Reading Intent: worth remembering, not worth building yet

*"What's your purpose for reading this document?"* — free text the reader typed, stored against
`(user_id, document_id)`. It is a genuinely good question to ask, and it is the sort of input
[vision.md](../project/vision.md) is actually interested in: the reader's own judgment, not a
substitute for it. But it is reader state, we have exactly one reader-state store today
(`comments.json`), and inventing a second one for a text field is the wrong order to do things in.
Noted, not built.

### One thing we are already ahead on

Their "Current Limitations" lists **LLM-extracted author, publication date and publisher** as never
built — their metadata panel had no byline field at all. Ours gets `byline` and `siteName` from
Readability for free, at extraction time, with no model call
([content-extraction.md](../project/content-extraction.md)). So the section their page most wanted
and never got is the section ours opens with.

### And one warning about how theirs was built

`MetadataPanel.tsx` is 1,274 lines: title editing, the privacy toggle, reading intent, difficulty
fetch-and-generate and the statistics arithmetic all in one component, with about ten separate
`useState`/`useEffect` blocks and the optimistic-update-with-revert pattern hand-rolled twice.
Its section header — a small gradient bar plus an uppercase label — is repeated seven times inline.

Ours should be a page that renders sections, with the arithmetic in
[`stats.ts`](../../src/web/stats.ts) where it already is and can be tested without a DOM. If a
section needs state, that section owns it.

## The routing change: a shared prerequisite

**This is the one piece of work both plans depend on, and it should land first, on its own.**
[tweet-thread-page.md](tweet-thread-page.md) needs it too and does not restate it.

Today [`src/web/router.ts`](../../src/web/router.ts) knows two routes, and its regex is exact:

```ts
const m = /^\/read\/([^/]+)\/?$/.exec(pathname);
```

It grows a third segment:

```ts
export type ArticleView = "article" | "metadata" | "tweets";

export type Route =
  | { kind: "library" }
  | { kind: "read"; slug: string; view: ArticleView };
```

Four things to get right, all of them cheap now and annoying later:

1. **An unknown third segment is the library, not a crash.** `parseRoute` already treats anything it
   does not recognise as the shelf, deliberately — keep that. `/read/foo/nonsense` lands on the
   library, exactly as `/nonsense` does.
2. **The trailing slash stays optional.** Greg wrote the route as `/read/[slug]/metadata/`; a link
   that gains or loses the slash must not stop working. The existing regex already handles this and
   the new one must too.
3. **One function owns the path shape.** `readHref(slug, search)` is already that function and has
   callers. Extend it rather than adding a second one that also knows the `/read/` prefix — two
   places spelling a URL is how a rename breaks half the links.
4. **The query string travels.** Leaving the article to look at its metadata and coming back must
   not lose the reader's place. `?at=`, `?cols=` and `?text=` should be carried across both ways, so
   "back to the article" returns you to the paragraph you left. `?panel=` is the exception — it
   describes a drawer that no longer exists on any of these pages.

`tests/router.test.ts` already exists and already covers `parseRoute`; the new cases belong beside
the old ones.

[library.md § The routes](../project/library.md#the-routes) documents the shape and was updated in
the same piece of work — that heading used to say *two* routes.

## The shell: what these three pages share

All three views under `/read/<slug>/` are the same article seen differently, and they should agree
about it. Concretely they share:

- **the fetch.** `GET /api/article/:slug`, sanitised at the doorway. All three need it — the
  metadata page needs `meta` and `tree`, the tweets page needs the title and the source URL.
  [`ArticlePage`](../../src/web/App.tsx) already does this, and the fetch must be lifted **above**
  the three-way branch with the `key={slug}` remount left where it is. Branch into three separately
  mounted pages that each call a shared hook and article → metadata → article refetches every single
  time.
- **the bottom bar.** [`Dock.tsx`](../../src/web/Dock.tsx) renders on all three, with the current
  page's button marked. This is what makes the pages feel like one thing rather than three. It also
  needs its own bottom clearance on the new pages: `padding-bottom: var(--dock-h)` is on `.reader`
  and `.reader` is not reusable, because it also applies the spine's left padding and the reading
  view's width rules.
- **not the comments.** An earlier draft of this section listed `useComments(slug)` among the shared
  things. It should not be: the hook fetches on mount, so a visit to the metadata page would buy a
  drawer nobody opened. Off the reading view the Questions button **navigates** — back to the
  article with `?panel=questions` — which is also where a question is worth opening, since clicking
  one scrolls to the passage it is about and these pages have no passages.

**On the size argument.** An earlier version of this plan said the article payload is ~150KB and
used that to keep provenance out of it, then had the metadata page download the whole payload anyway
for a title. Both halves cannot be right. Measured: 183 KiB for the noema article, 49.7 for the
fixture, 16.1 for `writes`. The shared fetch is cheap enough at these sizes and one shell is worth
more than one saved request — so the pages share it, and the argument is retired rather than left
standing while being contradicted. What stays out of that payload is the filesystem walk, and the
reason is not bytes: it is that "what is on disk right now" is answered by looking, so it does not
belong in a payload that is cached and reused.

The bar's buttons become a **mix of two kinds**, and the code should say so rather than pretend they
are uniform: `Home`, `Metadata` and `Tweets` navigate; `Questions` still opens a drawer.
`Dock.tsx`'s `DockTab` currently sets `aria-expanded`, which is the honest relationship for a
drawer and a lie for a link — a link that navigates should be a `<Link>` with `aria-current="page"`.

## What the page shows

Five sections. Nothing here is a new model call, and nothing here is generated: this is the page you
open when something looks wrong.

```
  +---------------------------------------------------------------+
  |  The Mythology of Conscious AI                                |
  |  Thomas Chalmers · noema.media · fetched 25 Aug 2026          |
  |  https://www.noemamag.com/the-mythology-of-conscious-ai       |
  +---------------------------------------------------------------+
  |  LENGTH                                                       |
  |  9,142 words · 40 min · 214 blocks                            |
  +---------------------------------------------------------------+
  |  SHAPE                                                        |
  |  6 parts · 31 sections · 214 blocks · 3 levels deep           |
  +---------------------------------------------------------------+
  |  WHAT WE DID TO IT                                            |
  |  ✓ fetch    data/<slug>/raw.html                              |
  |  ✓ extract  output/<slug>.html · data/<slug>/meta.json        |
  |  ✓ blocks   output/<slug>.blocks.json · output/<slug>.html    |
  |  ✓ toc      data/<slug>/tree.json · data/<slug>/blocks.json   |
  |                                          opus-5 · toc/1       |
  |  ✓ arc      data/<slug>/arc.json         opus-5 · arc/2       |
  |  - tweets   Writing the thread                    not run     |
  +---------------------------------------------------------------+
  |  YOUR READING                                                 |
  |  7 questions asked · last read at "The hard problem…"         |
  +---------------------------------------------------------------+
```

**"What we did to it" is the section worth building carefully.** It is the one thing this page can
say that nothing else in the app can.

> **This section originally said something stronger, and it was wrong.** It said: an article whose
> `tree.json` predates its `blocks.json` is showing gists for paragraphs that have moved, so *"if a
> later artefact is older than an earlier one, say so on the page, loudly"*. That check was built,
> and then cut. A **successful** toc run writes `tree.json` and then copies `blocks.json` beside it
> ([`src/toc.ts`](../../src/toc.ts)), so the comparison marks every correct run stale — and mtimes
> cannot prove provenance in any case: they record when a file was written, not what it was written
> *from*. A `touch`, a copy or a checkout reorders them.
>
> Caught by a cross-model review of this plan against the code, 2026-08-25. Left here rather than
> quietly deleted, because the reasoning that produced it still reads as sound and that is exactly
> what makes it worth keeping visible.

So the section says **which stages have run** — existence is reliable where mtimes are not — plus
the generator and version strings the tree and arc already carry. A stage counts as run only when
**all** of its outputs are present, which is `stepIsDone`'s rule in
[`src/pipeline.ts`](../../src/pipeline.ts), borrowed rather than restated.

A real staleness verdict needs artefacts that record what they consumed.
[`tweets.json`](tweet-thread-page.md) already does: it stores a `sourceHash` of the blocks it was
written from. When `tree.json` and `arc.json` carry the same, this page can answer the question
properly. Until then silence is the honest answer — **a confident wrong verdict is worse here than
none, because this is the page you open once you have stopped trusting the others.**

**A new endpoint, `GET /api/metadata/:slug`.** It goes in [`src/api.ts`](../../src/api.ts) next to
`loadArticle` and `listArticles`, because that file is
[the seam a database goes behind](../project/architecture.md#server-and-client) and a directory walk
is exactly the sort of thing that has to stay behind it.

Note where the files actually are, because the sketch above gets it wrong: there is no
`data/<slug>/article.html`. `extract` writes `output/<slug>.html` and `data/<slug>/meta.json`,
`blocks` writes `output/<slug>.blocks.json`, `toc` writes `data/<slug>/tree.json` and copies the
blocks beside it. A walk confined to `data/<slug>/` cannot produce those rows at all. **Read the
list off `STEPS[…].outputs(ctx)`** — one place knows, and a second copy would drift silently.

## Two things found while planning this

**1. `stats.ts` and `reading-time.ts` each define `WPM = 230`.**
[`src/reading-time.ts`](../../src/reading-time.ts) exists *specifically* so that the number is said
in one place — its own header explains that the library card and the masthead run on opposite sides
of the wire and a drift between them would never be reported. But
[`src/web/stats.ts`](../../src/web/stats.ts) declares its own `const WPM = 230` and its own
`Math.max(1, Math.round(...))`. The drift that module was created to prevent is already latent: two
copies of one number, agreeing today. `stats.ts` should import `readingMinutes`. Textbook
[silent success](../reusable/silent-success.md), found by reading rather than by anything failing.

**2. The borrow list says 238, not 230.**
[difficulty-and-reading-time.md § Reading time](../project/original-version/difficulty-and-reading-time.md#reading-time-the-good-one)
recommends adopting the original's 238 wpm *with its citation* (Brysbaert 2019) over our uncited 230,
and the metadata page is where that number is most visibly on display. Worth doing — but it belongs
to whoever owns `reading-time.ts`, not to this work. Fix (1), leave (2) to them, tell them.

## What it costs

Honestly: more than the bottom bar did, and the reason is the routing.

- **The router grows a dimension.** Two routes become two-plus-a-view, and `App.tsx` grows a
  three-way branch. Small, but it is the first time this app has had a page that is not the reading
  view or the shelf, and [router.ts](../../src/web/router.ts) says plainly when to stop:
  *"Revisit if a third route arrives with nested layouts."* This is a third route with a nested
  layout. The judgment here is that a shared shell component is still much less than React Router
  would cost — but the next person to add a route should re-read that paragraph rather than assume
  the question stays settled.
- **A new endpoint** — small, but it is the first one that walks the filesystem for something other
  than the library listing, which is why it validates the slug with `isSlug` before joining any
  path. An endpoint that enumerates files raises the stakes on an encoded `..` over one that merely
  fails to find something.
- **`Dock.tsx` loses a panel and gains a link kind.** Net: less code, but the removal touches
  `params.ts` (`PANELS` drops `"about"`), `main.tsx` (the `?about=1` rewrite now has to land on the
  page rather than the panel — a **second** legacy rewrite of the same parameter), and the drawer's
  `TITLES` map.
- **`?about=1` and `?panel=about` both have to keep working.** They are two spellings of one thing
  that have now both been superseded, and the redirect must send them to `/read/<slug>/metadata`.
  This is where the "one function owns the path shape" rule earns itself.

## What is still open

- **A pasted `?note=` does not scroll.** Found while checking the review's point about opening a
  question from a list. From the list it is fine — that list lives only on the reading view, and
  `goToComment` has the block id and scrolls with it. But a link arriving as
  `/read/<slug>?note=<id>` with no `?at=` opens the dialog for a passage that may be a long way off
  screen: `App.tsx` derives the open comment from `note` and nothing scrolls. Not fixed here,
  because it is inside the reading view rather than this work, and it wants deciding rather than
  patching — probably the dialog should scroll to its own anchor on mount.

- **Re-running a stage from this page.** The job queue already takes
  `POST /api/jobs { slug, steps, force }` and `cascadeForce` already handles the hard part, so a
  "regenerate the tree" button on the row that shows a stale `tree.json` is a genuinely small
  addition — and it is the obvious thing to want the moment the page tells you something is stale.
  Deliberately not in the first version: get the page right first.
- **Deleting an article.** Their page had it. Ours would be deleting a directory that contains the
  only copy of the block ids, and there is nothing to undo it with. Not without thinking about it
  properly.
- **Whether the masthead should link here.** It already shows title and byline, and a reader who
  wants more currently has nowhere to go from it.

## What the plan got wrong

Two rounds of this. The first came from building it; the second from a GPT-5.6 review of the plan
against the code, which caught things the build had not. Both are written down rather than edited
into the plan above, because a plan quietly corrected to look right teaches nobody anything.

### Found by the cross-model review

**1. The staleness verdict was wrong and is cut.** The big one, and it had already shipped. See the
block quote in § What the page shows: a successful `toc` run writes `tree.json` before it copies
`blocks.json`, so the comparison marked every correct run stale, and mtimes cannot prove provenance
in any case. The page now says which stages have run and stops.

**2. `nuqs` history sync was never enabled, and `router.ts` asserted that it was.** Not this page's
doing — a false comment that predates it — but this page's routing change rested on it, so it was
fixed first. `router.ts` claimed nuqs patches `history.pushState`, so our own `navigate()` is
indistinguishable from nuqs's own writes. In nuqs 2.10 that patching is opt-in via
`enableHistorySync()`, and nothing called it: the react adapter's `subscribe` listens only to nuqs's
internal emitter and `popstate`, so every `useQueryState` went on serving the *previous* page's
search after one of our navigations. The live hazard was `?at=`, which is debounced 300ms and whose
queue nothing cancelled on unmount — a scroll position could flush onto the URL of the page you had
just navigated to. [`main.tsx`](../../src/web/main.tsx) now calls it, and carries the reason
including the docstring that talks you out of it.

**3. The artefact mock-up named files that do not exist.** There is no `data/<slug>/article.html`.
Corrected above, and the code derives the list from `STEPS[…].outputs(ctx)` so it cannot happen
again.

**4. The comments must not be shared with the new pages.** Corrected in § The shell.

**5. `.reader` is not reusable for the new pages' bottom clearance.** It carries the spine's left
padding and the reading view's width rules. The metadata page states its own, against `--dock-h`.

**6. One rewrite pass for the legacy parameters, not two hops** — and `about=0` is stripped rather
than left behind, which this codebase had been claiming it did since the drawer landed.

**7. `isSlug` before any filesystem walk.** Covered in § What it costs.

**8. Unmatched `/api/*` used to fall through** to Vite's SPA fallback: `index.html`, status 200, and
a client reporting `Unexpected token '<'` from `r.json()` — a parse error blaming the client for a
route that does not exist. Fixed while adding an endpoint, since this is where you meet it.

**9. The ~150KB argument was doing two jobs at once.** Retired; see § The shell.

One piece of the review's advice was checked and needed no change. It asked that opening a question
from a list navigate with both `note=<id>` and `at=<blockId>`, because `?note=` alone opens a dialog
and nothing scrolls. True of a pasted link — see § What is still open — but not of the list, which
lives only on the reading view, where `goToComment` has the block id in hand and scrolls with it.

### Found by building it

**10. `stats.ts` had already been fixed.** The plan's finding (1) — two copies of `WPM = 230` — was
resolved by whoever owns [`stats.ts`](../../src/web/stats.ts) before this work started. It imports
`readingMinutes` now. Finding (2), the move to a cited 238, is still open and still belongs to
[`reading-time.ts`](../../src/reading-time.ts).

**11. An unknown slug falls through to the fixture, exactly as `loadArticle` does.** The obvious
reading is that the endpoint should 404 for a slug with nothing behind it. It must not: the reading
view serves `example/` for any unknown slug, so a 404 here would mean two pages at the same URL
disagreeing about which article exists. `ArticleMetadata.dir` says where the files came from.

**12. Tailwind's `calc()` needs its underscores.** `tw:pb-[calc(var(--dock-h)+2rem)]` compiles to
`calc(var(--dock-h)+2rem)`, which is invalid CSS — the browser drops the declaration and the last
line of the page sits under the bar, with nothing reported anywhere. `_+_` is the fix.

Two things not in the plan that had to happen anyway: `stats.ts` gained a `depth` field (the "3
levels deep" line had nowhere to come from), and the dead `.about` block was deleted from
[`styles.css`](../../src/web/styles.css) when the panel it styled went.

## A second pass over theirs, 2026-08-25

Greg, after the page was built:

> Have a look at the Metadata functionality. See if there's anything from the version we had in
> `docs/project/original-version/` that we should borrow, e.g. the new version seems to be missing
> some of the design polish and other functionality. (Though obviously it now needs to fit with the
> new version's dark-mode design). If there's some stuff that we'd like to add but we don't yet have
> the functionality (e.g. missing data), perhaps add design placeholders with a tooltip to say that
> these are not yet implemented.

So `components/tools/MetadataPanel.tsx` was read again — the component this time, not
`TOOL_METADATA_TAB.md`, for the reason § What the original had already gives — this time looking for
what *ours* had left behind rather than for what to avoid.

**The finding was not about facts. It was about legibility.** Our page had every number theirs had
and several it never got, and it presented them as five headings with a sentence under each. Their
page presented the same kind of material as *surfaces you can scan*, and at a glance theirs was
easier to read. That is the whole gap, and it is a real one on a page whose entire job is answering
a question quickly.

### What came across

**1. Cards instead of rules.** Their sections were bordered surfaces with divided rows. Ours were
prose under a horizontal rule, which reads as one continuous page rather than as five separate
answers. Same tokens as a library card ([`Library.tsx`](../../src/web/Library.tsx)), so the two
pages now look like one app.

**2. The counts became a grid of numbers.** *"9,142 words · 40 min · 214 blocks"* makes you parse a
sentence to find one number. Six stat cards — Words, Read time, Blocks, Parts, Sections, Levels —
each with the number big and the label small, is the thing you can read at a glance. `Length` and
`Shape` merged into one `At a glance` section on the way, because they were always the same question.

**3. A pill per stage, not a tick in a table column.** Theirs said `Generated` / `Not generated` as a
coloured pill, and it scans far better than a column of ticks. The four-column table went with it:
it needed `overflow-x: auto` to survive a narrow window, and a horizontal scrollbar hides the model
name, which is half of what the row is for. Rows that wrap do not.

**4. Tooltips that say what a number means.** Read time is the clearest case — ours is words ÷ 230
and the reader has no way to know that, so the tooltip says so, and says it by importing `WPM` from
[`reading-time.ts`](../../src/reading-time.ts) rather than typing `230` into a string where it could
drift from the arithmetic it describes. Dotted underline and `cursor-help`, the same convention
theirs used.

**5. A relative timestamp with the absolute one on hover.** *"fetched 3 days ago"* is what you want
to know; the exact stamp is what you want when the answer is surprising. Theirs used date-fns'
`formatDistanceToNow` for this one string; `Intl.RelativeTimeFormat` has been in the platform since
2018 and this app has no other use for a date library.

**6. Their loading rules, which are short and right.**
[design-system.md § Loading states](../project/original-version/design-system.md#loading-states)
says show nothing under a second and name the step. The page said `Looking…` immediately; it now
says *"Checking which files the pipeline wrote…"* and only after 600ms, which on localhost means it
almost never appears at all. A spinner that flashes for 200ms is worse than nothing — the flicker
reads as breakage.

### What was looked at and left there

- **Their gradient icon chips and white `shadow-sm` cards.** Lifted-white-on-grey is a light-mode
  idiom with no dark translation: depth here comes from `--card` being *lighter* than `--page`
  ([design-css-overview.md](../project/design-css-overview.md)), and a saturated gradient chip in
  every row would be louder than the numbers it is labelling. Flat raised chips instead.
- **The reading-difficulty badge.** Still declined, and for the reason in § Reading Difficulty
  above. Note that it is deliberately *not* in the new "Not built yet" section either — that section
  lists things we mean to build, and putting this there would promise it.
- **Book pages, per-file sizes, per-file mtimes.** Dropped in the first pass and staying dropped.
- **The privacy toggle, the owner email, and the editable title.** They describe an app with
  accounts, and an article whose title is stored rather than extracted.

### The placeholders, and the convention they follow

Three things this page should say and cannot yet, as dimmed rows with tooltips:
**Your reading purpose**, **Re-run a stage**, **Delete this article**. Each tooltip carries the
label, a `not built yet` flag, what the thing would be, and — set apart in italics — what the
previous version's attempt at it taught us.

**That shape is not new here.** It began as `SOON` in [`Dock.tsx`](../../src/web/Dock.tsx) and the
`.tip-soon` styles it already added to [`styles.css`](../../src/web/styles.css), reused rather than
reinvented, so a reader who has met a dimmed button in the bottom bar already knows what a dimmed
row on this page means. One convention for *"this is an intention, not an oversight"* is worth more
than two good ones.

**This page is the convention's only owner now.** The bar's own placeholders are gone — four were
built, and the last, `Reading time`, was answered by this page's own stat card
([bottom-bar.md](bottom-bar.md#the-dimmed-placeholders-are-gone), 2026-08-26). The shape did not
lose an argument; the bar did, on the narrower point that a row of buttons is a bad place to
advertise something you cannot press.

### One new fact, and where it had to come from

The plan's mock-up had **"7 questions asked"** and the built page did not, because § The shell
forbids this page from calling `useComments` — that hook fetches on mount, so a visit would buy a
drawer nobody opened. The resolution is that the *count* is not the comments: `GET /api/metadata/:slug`
is already walking this article's directory, so it now returns `comments` too and the page gets its
line for nothing. The number links back to the reading view with `?panel=questions`, which is where a
question is worth opening, since clicking one scrolls to the passage it is about.

## See also

- [tweet-thread-page.md](tweet-thread-page.md) — the other page, same routing change
- [bottom-bar.md](bottom-bar.md) — the bar this page's button lives in, and why the About panel
  existed at all
- [../project/original-version/difficulty-and-reading-time.md](../project/original-version/difficulty-and-reading-time.md)
  — the difficulty verdict we are not building, and the reading-time arithmetic we are
- [../project/library.md](../project/library.md) — the shelf, and the route table this extends
- [../project/architecture.md](../project/architecture.md) — storage layout, and the seam a database
  goes behind
- [../reusable/silent-success.md](../reusable/silent-success.md) — the pattern behind both of the
  problems found above
