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

Read this beside [260825g-tweet-thread-page.md](260825g-tweet-thread-page.md), which is the other half of the same
job and depends on the routing change below.

## Why a whole page

Two reasons, and the second is Greg's.

**The layout reason.** This view's hard problem is horizontal —
[260825c-bottom-bar.md § Why the bottom](260825c-bottom-bar.md#why-the-bottom) is entirely about that. A page of its
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
[260825g-tweet-thread-page.md](260825g-tweet-thread-page.md) needs it too and does not restate it.

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
[`tweets.json`](260825g-tweet-thread-page.md) already does: it stores a `sourceHash` of the blocks it was
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

- ~~**A pasted `?note=` does not scroll.**~~ **Fixed 2026-08-26.** Found while checking the review's
  point about opening a question from a list. From the list it was fine — that list lives only on the
  reading view, and `goToComment` has the block id and scrolls with it. But a link arriving as
  `/read/<slug>?note=<id>` with no `?at=` opened the dialog for a passage that could be a long way off
  screen: `App.tsx` derived the open comment from `note` and nothing scrolled.

  The guess above was right about the shape and wrong about the timing. "On mount" cannot work: the
  link carries a comment *id*, and the block that comment is anchored to arrives over the wire, so
  there is nothing to scroll to at mount. It fires when the comments land instead, and once only.
  The other half needed deciding rather than patching, exactly as this said: a URL can carry two
  things that sound like a position, and **the note wins** — `?at=` is written by scrolling, `?note=`
  is only there because somebody opened a dialog. See
  [url-state.md § When `?note=` and `?at=` disagree](../project/url-state.md#when-note-and-at-disagree-the-note-wins)
  and [comments.md § A pasted `?note=`](../project/comments.md#note-arrival). The rule is
  `arrivalTarget` in `src/web/scroll.ts`, pinned in `tests/scroll.test.ts`.

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
  accounts, and an article whose title is stored rather than extracted. *(Half of that stopped being
  true on 2026-08-26 — see § The one still worth taking, below.)*

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
([260825c-bottom-bar.md](260825c-bottom-bar.md#the-dimmed-placeholders-are-gone), 2026-08-26). The shape did not
lose an argument; the bar did, on the narrower point that a row of buttons is a bad place to
advertise something you cannot press.

### One new fact, and where it had to come from

The plan's mock-up had **"7 questions asked"** and the built page did not, because § The shell
forbids this page from calling `useComments` — that hook fetches on mount, so a visit would buy a
drawer nobody opened. The resolution is that the *count* is not the comments: `GET /api/metadata/:slug`
is already walking this article's directory, so it now returns `comments` too and the page gets its
line for nothing. The number links back to the reading view with `?panel=questions`, which is where a
question is worth opening, since clicking one scrolls to the passage it is about.

## A third pass, 2026-08-27: shut the long section, and say *when*

Greg:

> In the "Metadata" section, make "What we did to it" collapsible and default-collapsed and add
> extra metadata (e.g. exact date times), perhaps in tooltips.
>
> And look at the Metadata from `docs/project/original-version/` to see if there's anything else
> from there worth adding.

### The section that is shut when you arrive

`What we did to it` is nine rows of file paths, and it sits fourth of six. Most visits are not
asking what it answers, and while it was open it pushed everything about *this reader* — their
purpose, their questions, where they left off — below the fold. So it is `collapsible` and starts
shut, and [`Section`](../../src/web/Metadata.tsx) grew the two props that took: `collapsible`, and
an `aside` shown on the heading row whether the section is open or shut.

**The `aside` is the point.** Shutting a section must cost the reader the detail and not the
answer, so the heading carries the two facts the rows would otherwise have told them — how many
stages have run, and when any of them last wrote. `8 of 9 stages · last wrote 3 days ago`.

The open/shut state is **not** in the URL, which is worth saying out loud in a repo whose
[url-state.md](../project/url-state.md) puts every bit of view state in the address bar. A shut
section is the same kind of thing as an open drawer, and `carriedSearch` already strips `?panel=`
on every navigation on the grounds that a drawer you left open is not a place you were. Nothing
about a shut section is worth linking to.

### The timestamps, and a decision reversed

`StageState` gained two fields: `ranAt` (ISO) and `bytes`. On the filesystem they are `stat` over
the outputs that exist — newest mtime, sizes added up; in Postgres `ranAt` is
`revision_step_runs.finished_at` falling back to `started_at`, and `bytes` is `null`, because there
are no files and a row count wearing the word "bytes" would be a different measurement under the
same label. Each stage row shows `ran 3 days ago`, with the exact stamp — `dateStyle: "full"`,
`timeStyle: "long"`, so seconds and the timezone are both in it — and the size on hover.

**This reverses § What was looked at and left there, which said per-file sizes and mtimes were
"dropped in the first pass and staying dropped".** The reversal is narrower than it looks, and the
distinction is the whole reason it is safe: *what was wrong about mtimes was the verdict, never the
number*. `articleMetadata` still refuses to compare two timestamps, still has no staleness rule, and
the tooltip says in its second sentence that a copy or a fresh checkout resets the number — which is
exactly why every stage of the committed `example/` fixture reports the minute somebody cloned the
repo. A person reading "toc ran 3 days ago, arc ran in March" can draw the conclusion this page
still declines to draw for them. That is the difference between handing somebody a fact and handing
them a red banner.

`ranAt` is computed over the outputs that **exist**, whatever `stepIsDone` said about the set of
them, and the row says `last wrote` rather than `ran` in that case. A stage that owes three files
and wrote two is precisely the state this page gets opened to look at.

### And the one thing left from theirs that was worth taking

Their **Document Information** had a *file type* row. Ours never took it, and § What the original
had marked the section **take** without it, because for as long as this app existed the answer was
the same for every article: a web page.

That stopped being true on 2026-08-26, when [PDFs](260826c-pdf-ingestion.md) arrived and stage 2 became two
stages — Readability for a web page, a model reading the pages for a PDF
([content-extraction.md](../project/content-extraction.md)). So `CameFrom` renders, **for PDFs
only**, what that reading actually did: what it was made from and how many pages, the reader and
prompt version that transcribed it (`meta.method`), what fraction of the file's own text layer
turned up in the transcription and over how many pages, and the SHA-256 of the PDF as fetched so
that *"is this the same document?"* has an answer that does not depend on a filename.

A web page gets no section at all. One row saying "a web page", under a URL that already said so, is
a section that exists to say nothing.

[`Masthead.tsx`](../../src/web/Masthead.tsx) already tells the *reader* the shape of this in a
sentence, because they are entitled to know before they trust a line of it. This is the same fact
with the numbers attached, on the page you open when you want numbers. The scan case stays a
sentence rather than a number in both places: nothing checked it, and a `0%` would be a lie in the
other direction.

### What the cross-model review found in the built code

GPT Sol, on the diff, 2026-08-27. Four things were real and are fixed; two are recorded here rather
than fixed, and one of those is the interesting one.

**`ranAt` meant two different things.** The Postgres side fell back to `started_at` when
`finished_at` was null, which is what that column exists for elsewhere — a `running` row with no
timestamp cannot tell "still going" from "died an hour ago". But it made one field answer two
questions, and the filesystem has no way to report a run that started and wrote nothing. One field,
one meaning, or the single sentence the UI writes about it is false in one of the two stores. It is
`finished_at` only now. The tooltip's mtime caveat is likewise told **only where there are files**:
`finished_at` is a recorded fact about a run that no checkout can reset, and warning about it there
would teach the reader to distrust the number that deserves it less.

**A shut section was hiding the failure.** The metadata request's error message lives inside "What we
did to it", so collapsing it put the one thing a reader has to see behind a chevron. The section is
`collapsible={!provenanceError}` now: a failure makes it an ordinary open section with the error at
the top. Two things downstream of the same request were lying about it too, and both are fixed —
"Questions asked" said `Counting…` forever after the count had already failed, and the profile
preview said *"You haven't said anything about yourself yet"*, which is a claim about a person that
a failed request has no way to establish.

**The tooltip-only facts could not be reached by keyboard.** The exact stamp, the size, the full
fingerprint and the recall explanation are only in their tooltips, and their triggers were `<span>`s.
`Tooltip` already wires up `useFocus`, so the fix is a focusable trigger. Note that `Stat` and
`Fetched` above them have the same problem: they are older than the rule being noticed, and are left
alone so this stays one change.

**And it caught the zero denominator** — `97% of the words, on 3 of 0 pages`, from a `meta.json`
written before `pages` existed. The page count is printed only when there is one.

### The finding that is recorded rather than fixed: the two stores disagree about "run"

Sol's sharpest finding is that **this page already gives a staleness verdict on Postgres, and has
since before this change**. `StageState.done` is documented as "all of this stage's outputs are
present". On the filesystem that is what it is. In [`src/store/pg.ts`](../../src/store/pg.ts) it is
`status === 'done' && isCurrent(step)` — so an artefact that is present, complete and merely built
from older blocks reports **not run**, in a pill, on the page that exists to tell you what happened
to your article. That is a verdict, it is delivered in the wrong word, and the new heading line
counts it (`8 of 9 stages`).

It is not an oversight — the Postgres store argues for it at length, on the good grounds that
carrying "the column is non-null" across from the filesystem would carry a known bug across with it.
So the two halves are each defensible and the pair is not, and the fix is a third field rather than a
choice between the two: `present` (all outputs there) alongside `current` (built from what it would
be built from today), with this page showing the first and free to say something quieter about the
second. Left for whoever next opens the storage seam, because changing what `done` means is a change
to a contract three files read, not a change to this page.

### One placeholder that had gone stale

`Delete this article` said its lesson was that *"there is nothing here to undo it with"*. The shelf
grew exactly that on 2026-08-26 — Delete archives, and the Undo strip is the confirmation
([library.md](../project/library.md)) — so the row now says what is actually still missing, which is
the strip rather than the endpoint.

It was built a day later. See below.

### The one still worth taking: an editable title

§ What was looked at and left there dismissed the editable title along with the privacy toggle,
because both *"describe an app with accounts, and an article whose title is stored rather than
extracted"*. The second half of that reason expired on 2026-08-26, when the shelf grew a title
override that survives re-extraction ([library.md](../project/library.md)). Sol raised it, and it is
a fair candidate for exactly the reason this page exists: a wrong title is a thing you notice on the
page you open when the metadata looks wrong.

Not built here, and the reason is that it is not a small addition wearing a small hat.
[`TitleEditor`](../../src/web/ShelfEntry.tsx) takes a `LibraryEntry`, which this page does not have
and deliberately does not fetch, so taking it means either a second request or a new field on
`ArticleMetadata` — and then a decision about whether the `<h1>` becomes editable in place, which is
a design question rather than a plumbing one. Worth doing; worth doing on purpose.

## A fourth pass, 2026-08-27: Delete this article, and Put back

> Add "Delete this article" functionality, both to Metadata and Homepage. Ideally it would Archive,
> i.e. soft-delete, so it can be undone.
>
> — Greg, 2026-08-27

**The homepage half already existed** and needed nothing: Delete is on every card and on every table
row (both through `Actions` in [`ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx), so the two views
cannot disagree), it archives rather than erases, the Undo strip is the confirmation, and **Show
deleted** at the foot of the shelf is the way back once the strip has gone. All of that landed on
2026-08-26 and is written up in [library.md](../project/library.md#delete-means-archive-and-undo-is-the-confirmation).
So this pass is the metadata page's half, and the placeholder above is what it replaces.

### The reason the placeholder gave was right, and it is now answered

The dimmed row did not say the endpoint was missing — `PATCH /api/library/:slug` has taken
`{ archived }` since the day before. It said the *confirmation* was missing: the shelf's is a
nine-second strip, and **"a page you can navigate away from is a bad place to put the only chance to
change your mind"**.

Two things answer that, and the second is the interesting one.

1. The strip stopped being the only chance the same week, when **Show deleted** went in.
2. **This control does not use a strip at all.** An archived article stays readable by direct link —
   only the shelf filters — so a reader who deletes it from here is still looking at its page
   afterwards. The honest thing for that page to show is the state it is now in and the way out of
   it: `Deleted 3 minutes ago`, with **Put back** beside it, and no clock on either. *The undo here
   never expires*, which is a stronger promise than the shelf's rather than a weaker one, and it is
   affordable precisely because this page is about one article rather than thirty.

No confirmation dialog, for a reason that is sharper here than on the shelf: a modal asking you to
confirm something that is undone by a button in the same place, for ever, is a modal that teaches
people to click through modals.

### The one new field, and why it is on `ArticleMetadata` rather than fetched

A Delete button that cannot tell whether the article is *already* deleted is a button offering to do
a thing that has been done. So `ArticleMetadata` gained `archivedAt: string | null` — off the same
shelf read that already answers `purpose` and `comments`, in both stores, so it is a field on a
record in hand rather than a second request. Note it is `string | null` and not `LibraryEntry`'s
optional `archivedAt?`: on a card the field's *absence* is how "on the shelf" is said, but here the
question is always asked, so `null` is an answer rather than a gap.

The alternative was fetching the `LibraryEntry` — which is what the deferred **editable title**
(§ below) will need anyway. It was not taken here because a whole shelf entry to read one date is a
worse trade than one field, and because that decision belongs to whoever builds the title editor,
with the design question that comes with it.

### Four states, and the ones to get right are the ones that are not a date

`archivedAt` is `undefined` while the metadata request is in flight **and for ever if it fails**.
Neither shows a button at all — not even a disabled one, because a greyed-out *Delete* still says
the article is on the shelf, and the failed case must not say which way round things are: that is a
claim about the reader's library drawn from a request that established nothing. Same rule `AboutYou`
was rearranged around in the third pass, found by the same cross-model review; this time it was
written that way first.

The fourth state is a refusal rather than an ignorance, and Sol found it. An address with **no
article of its own** gets the fixture: `loadArticle` falls through to `example/` for an unknown slug
and `articleMetadata` deliberately follows it so the two pages describe the same thing. Its shelf
state is therefore empty, `archivedAt` is `null`, and the section offered a Delete whose `PATCH`
could only 404 — a button that can only fail, where pressing it is how you find out. The page
already derives this for its `fixture` chip; the section now uses the same derivation and says there
is nothing here to delete.

### The sentence that was false, and the shape of error it belongs to

The first version's error line said **"Nothing changed"**. It is the highest-severity thing the
review found, and it is a
[silent-success](../reusable/silent-success.md) in reverse — a loud failure over a write that
succeeded.

A failed request is not proof that nothing was written. `patchShelf` writes and *then* does a second
fallible read to answer `purpose` ([routes.ts](../../src/routes.ts)); both stores persist and then
rebuild the entry to return it; and a response can simply be lost on the way back. Every one of
those fails *after* the archive has happened. A page that then says nothing changed, and offers
Delete again, is telling the reader something it has no way to know — and the Delete they press next
is the one that looks like it did nothing.

So the catch asks rather than assumes: it re-reads `/api/metadata/<slug>` and shows whatever comes
back, and the line says **"Couldn't confirm that"**. If the re-read fails too, the state goes to
`undefined` — genuinely lost — and the button disappears with it. The error paragraph carries
`role="alert"`, because it arrives unrequested and contradicts what the reader just pressed.

### Two structural choices that look like style and are not

**One `<button>` element serves both states**, rather than a Delete button and a Put back button
behind a ternary. Press Delete with the keyboard and, with two elements, React unmounts the one you
are standing on — focus falls to `<body>`, the next Tab starts from the top of the page and a screen
reader loses its place, at the exact moment there is something worth hearing. Same element, changed
label and handler: the node survives and focus stays on it. The conditional siblings around it are
written `? … : null` at fixed positions for the same reason — React reconciles a fixed set of JSX
children by position and a `null` holds its slot, so inserting the "Deleted" line without one would
shift the button along by one and remount it after all.

**The relative date is `timeAgo` on a `useNow` clock**, not this file's own `ago`. Two reasons, both
Sol's. The clock, because this line is written the instant Delete is pressed: `ago` reads the time
once during render, so "Deleted just now" would still say *just now* an hour later on a page nothing
else re-renders. And `timeAgo`, because it returns `undefined` for a date it cannot parse rather
than handing `NaN` to `Intl.RelativeTimeFormat`, which throws — taking the page down instead of
printing a wrong time. `ago` itself was hardened the same way for its three other callers.

There is deliberately **no `key`** on the component: `App.tsx` already mounts the whole page as
`<Metadata key={slug}>`, so switching article remounts everything below it. An inner key was written
first, as insurance against state crossing between articles, and removed as redundant when the
review pointed at the outer one.

The date shown is the store's, never a locally-invented `new Date()`. Archiving something already
archived deliberately keeps the **original** date ([`src/shelf.ts`](../../src/shelf.ts),
`coalesce(archived_at, now())` on the Postgres side), so a client that stamped its own would print a
time the store disagrees with.


## See also

- [260825g-tweet-thread-page.md](260825g-tweet-thread-page.md) — the other page, same routing change
- [260825c-bottom-bar.md](260825c-bottom-bar.md) — the bar this page's button lives in, and why the About panel
  existed at all
- [../project/original-version/difficulty-and-reading-time.md](../project/original-version/difficulty-and-reading-time.md)
  — the difficulty verdict we are not building, and the reading-time arithmetic we are
- [../project/library.md](../project/library.md) — the shelf, and the route table this extends
- [../project/architecture.md](../project/architecture.md) — storage layout, and the seam a database
  goes behind
- [../reusable/silent-success.md](../reusable/silent-success.md) — the pattern behind both of the
  problems found above
