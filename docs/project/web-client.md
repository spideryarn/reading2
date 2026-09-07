# The web client (stage 6)

The reading view: the article rendered as a table, one row per block, columns running coarse to
verbatim. Greg's framing, 2026-08-24:

> up-down is chronology in the document and left-right is granularity, with a column for each level
> of the table of contents

> so by scrolling rightwards, you get more detail. By scrolling downwards, you progress through the
> chronology of the article.

Why the feature exists and what a gist may and may not be:
[granularity-zoom.md](granularity-zoom.md). This doc is just the client's own signposts.

## Where the code is

| File | What it does |
|---|---|
| [`index.html`](../../index.html) + [`src/web/main.tsx`](../../src/web/main.tsx) | Vite entry. `main.tsx` imports **`./tailwind.css`**, not `styles.css` — see below, it matters. It also calls **`enableHistorySync()`**, without which nuqs cannot see our own navigations and router.ts's whole argument is false |
| [`src/web/App.tsx`](../../src/web/App.tsx) | picks the page from the path, then fetches `/api/article/<slug>` **once for all three of an article's views** — masthead, the granularity controls |
| [`src/web/AppBoundary.tsx`](../../src/web/AppBoundary.tsx) | the last thing between a throw during render and a blank white page: `main.tsx` wraps the whole app in it. Hand-written rather than Sentry's, because reporting is optional and the fallback is not; it reports through `captureClientFailure` and `recordLog` and shows the reader `[render]` and no `error.message` — [260826p-error-boundary.md](../plans/260826p-error-boundary.md) |
| [`src/web/FeatureBoundary.tsx`](../../src/web/FeatureBoundary.tsx) | **the smaller one**, around one mode's controller and panel, so a broken mode leaves the article readable — [§ A mode that breaks does not take the article with it](#a-mode-that-breaks-does-not-take-the-article-with-it) |
| [`src/web/modes/`](../../src/web/modes/) | a mode's controller and its band, out of `App.tsx` — `modes/ideas/IdeasMode.tsx` is the first, and more follow under [260905e](../plans/260905e-main-app-architecture-review.md). The extraction is what lets a boundary enclose the mode's own computation, since a boundary cannot catch a throw from the component that renders it |
| [`src/web/LazyPage.tsx`](../../src/web/LazyPage.tsx) | **the two routes whose code is not in the reader's first download** — `/admin` and `/design`, fetched when somebody asks for the address. Takes a loader and a route key rather than children, because a rejected `React.lazy` re-throws its rejection forever, so *Try again* has to build a **fresh** lazy type, and because both routes sit in the same position in `SignedIn`'s tree, so without the key one route's failure — or its loaded component — follows the reader to the other. Reader, shelf and mode code stays **eager** on purpose: cached JSON cannot make an unloaded chunk execute, and in-tab offline navigation depends on that. [`tests/eager-client-graph.test.ts`](../../tests/eager-client-graph.test.ts) is what stops the boundary quietly rotting, and [260905i](../plans/260905i-lazy-load-admin-and-design-routes.md) has the numbers |
| [`src/web/router.ts`](../../src/web/router.ts) + [`Link.tsx`](../../src/web/Link.tsx) | `/`, `/read/<slug>`, and its `/metadata` and `/tweets` pages — [library.md](library.md) |
| [`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) | `/read/<slug>/metadata`: what the article is, what shape it is, and which pipeline stages have run — [260825e-metadata-page.md](../plans/260825e-metadata-page.md) |
| [`src/web/Tweets.tsx`](../../src/web/Tweets.tsx) | `/read/<slug>/tweets`: the article as a numbered thread, with the button that writes one and the line that says the thread is out of date — [260825g-tweet-thread-page.md](../plans/260825g-tweet-thread-page.md) |
| [`src/web/Library.tsx`](../../src/web/Library.tsx) | the homepage: the shelf of articles — [library.md](library.md) |
| [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx) + [`useJobs.ts`](../../src/web/useJobs.ts) | paste a URL, watch the five stages tick over — [ingest-queue.md](ingest-queue.md). The poll is deliberate; `jobEngine.ts`'s header says why it is not server-sent events. `useJobs` has two ways in: `add(url)` for an ingest, `run({slug, steps})` for a named step on an article already on the shelf — the thread page is the only caller of the second |
| [`src/web/jobEngine.ts`](../../src/web/jobEngine.ts) | **the one thing here that is not a component and not view state**: a module-scope service, one per tab, that polls the job list and walks each job through its steps. On Vercel the browser is the worker, and `App()` is a chain of early returns — so while this lived in `useJobs`, whether an import kept running depended on whether the route you opened happened to mount an unrelated feature hook. `useJobSession` (in `useJobs.ts`) starts and stops it on `user.id` and resumes it on a fresh access token; `useJobs` is a `useSyncExternalStore` subscriber over it. [ingest-queue.md § The browser is the worker](ingest-queue.md#the-browser-is-the-worker) |
| [`src/web/uploadEngine.ts`](../../src/web/uploadEngine.ts) + [`useUpload.ts`](../../src/web/useUpload.ts) | **the second one**, and it exists for the same reason: getting a PDF from the reader's disk into an article — hash, grant, PUT, `POST /api/jobs` — takes minutes, and the reader is meant to walk away from it. Held in a mount, it died the moment they did. One transfer at a time, bound to `user.id` in the same `useJobSession`, every reply fenced so a PUT landing after a sign-out or a Stop writes nothing. It reports its queue POST through `jobEngine.epoch()` / `actionSucceeded` rather than waking the poller itself. [ingest-queue.md § Add commits, and does not wait](ingest-queue.md#add-commits-and-does-not-wait) |
| [`src/web/tree.ts`](../../src/web/tree.ts) | tree → table geometry (`rowSpan` per node range) |
| [`src/web/TableView.tsx`](../../src/web/TableView.tsx) | the table itself: the gist columns, the hover chain and deep links — [granularity-zoom.md](granularity-zoom.md) |
| [`src/web/nav-labels.ts`](../../src/web/nav-labels.ts) | **whether to draw the paragraph-label layer at all, and what to say instead** — four surfaces read the one rule, so it is not four `=== "ready"`s. An absent `navLabel` has always meant *deliberately unlabelled*, so a label that is merely not written yet draws a blank cell; while `Article.navLabelStatus` says otherwise the whole layer is withheld — [hierarchy.md § Absence on a node](hierarchy.md#absence-on-a-node-is-deliberately-unlabelled-not-written-yet-is-a-column) |
| [`src/web/Masthead.tsx`](../../src/web/Masthead.tsx) | title, byline, source and counts — everything about the article that does not vary with position. The provenance behind a `▾` used to be here and is now a drawer panel. Directly under the title is the **origin line**: the article's own web address, host first with the path faded and truncated after it, or — for the owner, and never for a visitor — the words *Uploaded from a file* / *No web address was recorded*. It was a ↗ glyph beside the title until 2026-09-06, when Greg asked to be *"prominent about the origin"*. Beside the title, for the owner only, one mark is left, saying **who can read it**: a globe or a lock linking to the metadata page's sharing switch ([library.md § The Shared badge](library.md#the-shared-badge)) |
| [`src/web/Dock.tsx`](../../src/web/Dock.tsx) | the bottom bar and the drawer that rises out of it: the mode switch (fourteen of them, `MODES_UI`), your questions, and the links to the tweets and metadata pages — [260825c-bottom-bar.md](../plans/260825c-bottom-bar.md). Its buttons are **five** kinds — navigate, open a drawer, switch mode, the experimental-features toggle, and, since 2026-09-06, open a modal (Feedback, and since 2026-09-07 the command bar) — and the markup says which (`aria-current` / `aria-expanded` / `aria-checked` / `aria-pressed`; a modal opener carries `aria-haspopup="dialog"` and none of the other four, because it neither goes anywhere nor holds a state). The order is Greg's, set by hand. **The way home came back on 2026-09-06** as `DockHome` at the left-hand end, along with a Feedback trigger at the right, when both left the window's top corners on the pages that mount a bar (the article, its metadata page and its tweets page, in both an owner's and a visitor's shape) — [260905g](../plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md). Neither is a mode: the wordmark is outside the `role="radiogroup"`, is a `Link`, and wears `.dock-home` rather than `.dock-btn` so it cannot take the hover wash |
| [`src/mode-catalog.ts`](../../src/mode-catalog.ts) | **what each mode *is***, as opposed to how the bar draws it: the **two sentences** on its bar-button card (`description`, and `how` — the half a press would not have told you, added 2026-09-07 in [260907b](../plans/260907b-rich-tooltips-on-the-dock-modes.md)), the words they might type meaning it, and whether it is behind the experimental switch. `how` is written about the **artefact** rather than about pressing anything, and that is load-bearing rather than stylistic: the same string is read on the reading view, on the metadata and tweets pages where the same modes are loose links that arm nothing, and by a visitor who gets an explanatory band instead of a generator — so *"opening it runs a model pass"* is false on three of those four. Outside `src/web/` on purpose — it imports only [`modes.ts`](../../src/modes.ts), so both runtimes can read it and neither drags React across the seam ([`tests/client-imports.test.ts`](../../tests/client-imports.test.ts) lists it and checks the claim). The two pre-existing fields were `blurb` and `experimental` on a `MODES_UI` row until 2026-09-07, when a second reader was arriving that could not import a 2,300-line component — [260906h](../plans/260906h-mode-catalog-and-a-command-bar.md). The **name** is not here: that is `MODE_LABEL` in [`src/title-text.ts`](../../src/title-text.ts) |
| [`src/web/CommandBar.tsx`](../../src/web/CommandBar.tsx) | **⌘/Ctrl-K, and the ⌘ button in the bar**: type a mode's name, press Enter, and it opens *exactly as pressing its Dock button does* — same activation, same generate-on-open, same cost. A native `<dialog>` + `showModal()`, following [`FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) down to its visual-viewport treatment, because `showModal()` alone leaves the box under the iOS keyboard. **It imports nothing from `Dock.tsx`** — the visible modes and one `activateMode` callback arrive as props, and an import back the other way would close a cycle. Its styling is `tw:` utilities rather than a sheet under `src/web/styles/`, which is an exception argued in its own header. Modes only, and everything it deliberately cannot do is named in [260906h](../plans/260906h-mode-catalog-and-a-command-bar.md) — [reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar) |
| [`src/web/command-match.ts`](../../src/web/command-match.ts) | **what the command bar shows once you have typed something**, as a pure function of the words and the list: `canonical()` (lowercase, trim, collapse internal whitespace) and `rankModes()`, whose five tiers are one ordered array so the position *is* the rank. Ties break in the order the caller handed the modes in, which is Dock order, so the result is total and testable. `canonical` is the **same function** [`tests/mode-catalog.test.ts`](../../tests/mode-catalog.test.ts) checks the alias table with — two normalisers that agree today is how `"peer review"` and `"peer  review"` both pass uniqueness and then collide |
| [`src/web/dock-fit.ts`](../../src/web/dock-fit.ts) | how much of itself that bar spells out, **measured rather than keyed to a width**: it asks the row whether it overflows and drops labels until it does not. A `max-width: 1100px` media query did this until 2026-09-02 and the number went stale as the modes multiplied — [260902k-the-bottom-bar-measures-its-own-fit.md](../plans/260902k-the-bottom-bar-measures-its-own-fit.md). **Four rungs since 2026-09-06**, the new first one shedding only the wordmark's and Feedback's words, so a 1280 or 1366 laptop keeps its mode labels; the numbering shifted with it |
| [`src/web/HomeLogo.tsx`](../../src/web/HomeLogo.tsx) | the Spideryarn wordmark fixed in the very top-left of the window, and the way home — everywhere except the library, which *is* home, and, since 2026-09-06, except the article and its metadata and tweets pages, which mount a `Dock` and draw `DockHome` in the bar instead. Read its header before moving it: the two bars used to reserve `--logo-w` for this corner and stopped on 2026-09-06, because the only page they are drawn on is a page this component is no longer drawn on. What keeps the corner clear now is that the pages which still draw it have no sticky bars at all — [260825c-bottom-bar.md § Home left the bar](../plans/260825c-bottom-bar.md#home-left-the-bar-and-the-app-got-a-logo) |
| [`src/web/SourceLink.tsx`](../../src/web/SourceLink.tsx) | the way to the reader's own uploaded PDF, and `webSource(meta)` — *does this article have a web address at all?* **A missing address is never evidence of an upload:** for a visitor it may be one `publicSourceUrl` withheld, and even for an owner it may be a lost `meta.json`. `cameOffADisk(meta)` is what says "uploaded", and since 2026-09-07 it asks `meta.filename` rather than `meta.source === "pdf"` — that one was the *media kind* standing in for the *origin*, and it stopped being a proxy the day an uploaded document could be a web page ([260907b](../plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md)). `webSource` is also the allowlist on that field's `href`s, so a `javascript:` from an import never becomes a link |
| [`src/web/stats.ts`](../../src/web/stats.ts) | word, block, part, section and depth counts, pure — used by the masthead's facts line and the metadata page |
| [`src/web/Spine.tsx`](../../src/web/Spine.tsx) | the bird's-eye rail down the far left — [granularity-zoom.md](granularity-zoom.md#the-spine-a-birds-eye-rail) |
| [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx) | hover tooltips over Floating UI — [tooltips.md](tooltips.md) |
| [`src/web/BlockRef.tsx`](../../src/web/BlockRef.tsx) | one block id, drawn small and faint and linked to itself — [block-ids.md § Showing an id](block-ids.md#showing-an-id) |
| [`src/web/BlockGutter.tsx`](../../src/web/BlockGutter.tsx) | the narrow column beside every paragraph: mark, permalink, chat, "?", and a "…" for whatever the row has no room to draw — [prose-gutter-icons.md](../plans/prose-gutter-icons.md), [260905c-icons](../plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md). **The chat chip opens what it is counting**: on a paragraph that already has a conversation a press reopens one rather than starting another, whole-block ahead of a newer selection ([`useChatAnchors.ts`](../../src/web/useChatAnchors.ts) § `threadFor`, [`App.tsx`](../../src/web/App.tsx) § `chatAboutBlock`) — so the door to a *second* conversation is "New conversation" in the panel it opens. [260905c-chip](../plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md) |
| [`src/web/tailwind.css`](../../src/web/tailwind.css) | **the CSS entry point.** Four guards, the token bridge, and the `@import` that puts `styles.css` in a layer — [§ Tailwind and shadcn](#tailwind-and-shadcn-components) |
| [`src/web/styles.css`](../../src/web/styles.css) + [`styles/tokens.css`](../../styles/tokens.css) | reading typography and brand tokens, lifted from [the original version](original-version/overview.md). `styles.css` is an entry point of nothing but `@import`s; every rule is in one of the 37 files under [`src/web/styles/`](../../src/web/styles/). Both now load *inside* `@layer app`, via `tailwind.css` — the map of the stylesheets is [design-css-overview.md](design-css-overview.md) |
| [`src/web/components/ui/`](../../src/web/components/ui/) | shadcn components, generated then owned by us — `button`, `toggle` |
| [`src/web/lib/utils.ts`](../../src/web/lib/utils.ts) | `cn()`, the class-name helper every shadcn component imports as `@/lib/utils` |
| [`components.json`](../../components.json) | what `shadcn add` reads: our paths, our `tw` prefix, Lucide — [setup-dev.md](setup-dev.md#adding-a-ui-component) |
| [`src/web/selection.ts`](../../src/web/selection.ts) + [`annotate.ts`](../../src/web/annotate.ts) + [`AnnotateDialog.tsx`](../../src/web/AnnotateDialog.tsx) + [`CommentDialog.tsx`](../../src/web/CommentDialog.tsx) | mark a passage, note it, and ask about it if you want — [comments.md](comments.md) |
| [`src/web/comment-nav.ts`](../../src/web/comment-nav.ts) | comments in reading order, and the panel's prev/next — [comments.md](comments.md#several-at-once) |
| [`src/web/Cited.tsx`](../../src/web/Cited.tsx) | **model prose with block ids in it**, drawn as chips you can press with the paragraph itself on hover. Shared by chat and the summary panel rather than copied into each — [summaries.md § A summary is a door](summaries.md#a-summary-is-a-door) |
| [`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) + [`useChat.ts`](../../src/web/useChat.ts) | **chat**, in the band between the spine and the prose: threads, the streamed answer, the block-id chips that jump the article, and what a turn can have done to it — copy, retry, edit, **stop** — [260826a-chat-mode.md](../plans/260826a-chat-mode.md), and [§ What a turn can have done to it](../plans/260826a-chat-mode.md#what-a-turn-can-have-done-to-it) for why a stop is a `done` rather than an error |
| [`src/web/citations.ts`](../../src/web/citations.ts) | the block ids in a model's answer, found and checked against the article — pure, DOM-free, and the piece of chat that carries the contract — [260826a-chat-mode.md § The citation contract](../plans/260826a-chat-mode.md#the-citation-contract) |
| [`src/web/params.ts`](../../src/web/params.ts) | what every URL parameter means — [url-state.md](url-state.md) |
| [`src/web/position.ts`](../../src/web/position.ts) | reading position → what goes in `?at=`, and the one rule about when the scroll spy may overwrite it |
| [`src/web/layout.ts`](../../src/web/layout.ts) | which columns fit and how wide — [granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them) — and, since 2026-08-25, how wide the **mode band** is when the middle is something other than the columns, and since 2026-09-03 how wide the reading column goes when it is the only column there is (`PROSE_ALONE_MAX_REM`, `Fit.alone`, and the centring in [`styles/narrow-window.css`](../../src/web/styles/narrow-window.css) § plain, centred) |
| [`src/web/scroll.ts`](../../src/web/scroll.ts) | `scrollToBlock`, shared so a restore and a jump land identically; the flat-duration glide, and `stickyOffset()` |
| [`src/web/keynav.ts`](../../src/web/keynav.ts) | ↑ / ↓ nav, aimed by the pointer — [keyboard.md](keyboard.md) |
| `src/store/index.ts` | server side: `loadArticle(slug)`, `listArticles()` and `articleMetadata(slug)`, bound to the Postgres reader and reached through [`src/routes.ts`](../../src/routes.ts). These lived in `src/api.ts` — the filesystem reader — until it went with the store on 2026-09-05 |

Running it: [setup-dev.md](setup-dev.md). `npm run dev` opens the **library** at `/`
([library.md](library.md)) and an article is `/read/<slug>`. Old `/?slug=<slug>` links are rewritten
on the way in and keep working.

**A fresh clone needs `npm run setup` before it has anything to open.** It used to serve the
committed `example/` fixture straight off the disk when no article had been ingested, because
`src/api.ts` read articles from directories and fell back to that one. There is no filesystem reader
since 2026-09-05, so the fixture reaches you the same way every other article does — `npm run setup`
runs `db:seed-owner` and then `db:seed-dev`, which loads the committed corpus into Postgres.

Deep links are `/read/<slug>?at=spya-k6fpme`. Every other bit of view state is in the query string
too — see [url-state.md](url-state.md) for the full set, for the rule that divides the path from the
query, and for why scrolling *replaces* the history entry while toggling a column *pushes* one.

An article has **three pages**, and which one is a third path segment: the reading view itself,
`/metadata` ([260825e-metadata-page.md](../plans/260825e-metadata-page.md)) and `/tweets`
([260825g-tweet-thread-page.md](../plans/260825g-tweet-thread-page.md)). They share the fetch, the bottom bar and the
query string, so moving between them keeps your place and costs no request.

## The middle is a slot

Since 2026-08-25 the reading view has three regions rather than two-plus-columns, and the middle one
is **whatever mode you are in**. Greg's framing, which is the whole of it:

> I'm thinking that this might be a common pattern, that when we switch into a mode (e.g. Chat,
> Glossary, etc) we'll want to keep the spine and article, but reuse the middle sections. In fact,
> the current "Table of Contents" middle sections are just such a mode that can be chosen from the
> bottom-bar (the default).
>
> — Greg, 2026-08-25

So two things are permanent — **where you are** (the spine) and **what you are reading** (the
prose) — and the band between them is the working surface. `?mode=` says which mode owns it;
`fitView` reserves the band's width; and four CSS rules add a `--mode-w` term that is `0px` whenever
no band is open.

**Two modes open no band at all**, and they differ in what is left: `hierarchy` is the granularity
columns beside the prose, and `plain` — the default since 2026-08-31 — is the prose on its own, with
the columns gone as well ([plain-mode-and-the-way-out.md](../plans/plain-mode-and-the-way-out.md)).
So *a mode is open* and *a band is open* are two questions now, named `inMode` and `bandOpen` in
[`App.tsx`](../../src/web/App.tsx). Reading either one as the other is the mistake `proseVisible`
below already exists because of.

"Permanent" means *no mode takes it away*, which is the claim Greg's framing is making, and it is
still true. It is not a promise the reader cannot put the rail away themselves: `?spine=0` does
exactly that, in every mode. There was a `Spine` pill in the controls bar until 2026-09-05, and it
was the one granularity-bar control that stayed on screen in a mode; now the rail is simply on
unless the URL says otherwise ([granularity-zoom.md § the spine](granularity-zoom.md#the-spine-a-birds-eye-rail),
[url-state.md](url-state.md) for `?spine=`). The prose has no off switch at all any more: `?text=0`
hid it in the hierarchy mode and nowhere else — which is what `proseVisible` in
[`layout.ts`](../../src/web/layout.ts) exists to say once rather than twice — and since 2026-09-05
that address is rewritten to `?mode=outline` on arrival, because the pill that put the prose back
went with the controls bar ([url-state.md](url-state.md#the-parameters)).

Chat is the first mode that is not the hierarchy
([260826a-chat-mode.md](../plans/260826a-chat-mode.md)). Adding a second — the Glossary in Greg's example — is a
value in `MODES`, a component, and a width; it is deliberately not a new negotiation with
`layout.ts` each time.

## Adding a mode

The checklist lives in **[new-mode.md](new-mode.md)** since 2026-09-03 — both halves, the client
and the artefact, in one place at Greg's request. This heading stays so links to it keep working.

## A mode that breaks does not take the article with it

There was one boundary until 2026-09-05, and its fallback **replaces its children** — so a throw
inside one panel took the prose, the spine, the dock and every route with it. Nothing was known to
throw; the problem was the blast radius, and every mode added since inherited it.

So a mode's controller and its panel go inside a
[`FeatureBoundary`](../../src/web/FeatureBoundary.tsx) at the point `Reader` composes them. Its
fallback is band-shaped, names the mode, offers a retry and a way back to the article, keeps `?at=`,
reports through the same sanitised path as `AppBoundary`, and shows no exception text and no article
prose. The boundary goes around the **controller**, not the panel: the mode's own memos and layout
effects — where a throw is actually likely — run one level up, which is why the controller moves out
of `App.tsx` into `src/web/modes/` first.

The failed controller is unmounted, so its existing cleanup runs and the prose is left with no stale
marks. And a mode press that fails has its activation token retired at the point of failure
([`activation.ts`](../../src/web/activation.ts) § `retireActivation`), so a later Back cannot spend
a press that never started anything. Ideas is the first mode wired this way;
[260905h](../plans/260905h-a-mode-failure-should-leave-the-article-readable.md) is the reasoning,
and [`tests/a-broken-mode-leaves-the-article-readable.test.tsx`](../../tests/a-broken-mode-leaves-the-article-readable.test.tsx)
is what holds it.

## Tailwind and shadcn components

> Let's switch to using Shadcn.
>
> — Greg, 2026-08-25

Read that as **adopting shadcn components**, not switching the reading view to shadcn. The plan and
the full accounting are [260825a-shadcn-migration.md](../plans/260825a-shadcn-migration.md); this section is
what actually landed and what a future reader would otherwise have to reverse-engineer.

**What shadcn now stands behind:** the granularity pills in [`App.tsx`](../../src/web/App.tsx), a
`Button` waiting for the comment dialog, and — since 2026-08-26 — **every "run this job" button in
the app**, via [`JobProgress.tsx`](../../src/web/JobProgress.tsx).

That last one was a deliberate visible change and the first time this section's own logic was
applied rather than just written down. The glossary, the summaries and the thread each had a private
copy of the same component; two of them were drawn with hand-written `gloss-btn` / `summ-btn` rules
that differed from each other only in two paddings, a gap and two colours. That is not two designs,
it is one design diverging. The thread was already on shadcn, this section already named shadcn as
the house style for chrome, and a run button is chrome — so the other two moved rather than a third
set of numbers being invented. 38 lines of CSS went with them. All four states are on
[`/design`](../../src/web/DesignPage.tsx), because three of them only exist while a model call is in
flight. What it buys is accessibility we did not have —
`aria-pressed` on the toggles — and a house style for chrome not yet built.

The masthead's `▾` used to be on this list, over shadcn's `Collapsible`. It went when the article's
details moved to the bottom drawer ([260825c-bottom-bar.md](../plans/260825c-bottom-bar.md)), and the drawer that
replaced it is hand-written rather than a `Sheet` — worth recording, because a `Sheet` is exactly
what the migration plan would have predicted here. The reason is the z-index ladder: the drawer has
to interleave with the spine, the sticky bars, the comment dialog and the tooltip layer at
*specific* rungs, and a component that manages its own portal and overlay stacking is harder to
place in an order that already exists than 40 lines of CSS that simply state the rung.

**What is staying hand-written, and always will be:** the spine, the table geometry and its
`rowSpan` arithmetic, the sticky-bar ladder and its z-index order, the reading measure, `mark.cmt`
and the annotation layer, the modeless comment shell, and the runtime pixel geometry
[`layout.ts`](../../src/web/layout.ts) computes. That is the large majority of the hand-written
CSS — `wc -l src/web/styles.css src/web/styles/*.css` was 15,951 lines over 38 files on 2026-09-06.
*(This said "about 1,060 of `styles.css`'s 1,212 lines" until then, which was right when it was
written and had been wrong by an order of magnitude for a while: a proportion pinned to two
absolute numbers goes stale twice as fast as one.)*
**So there are two ways of styling here, permanently** — utilities for chrome, semantic CSS for
everything utilities cannot express. Nobody is going to convert the rest, and nobody should try.

### Four guards, all in `tailwind.css`

Each is there for a failure that is silent rather than loud. Every one of them was found by building
it, not by reasoning about it. The file itself carries the long version; this is the map.

| Guard | Without it |
|---|---|
| `prefix(tw)` on both imports | Tailwind's scanner is a plain **text** scanner — it pulls bare words out of source and emits a utility for any that matches a utility name. It found 18 in `src/web/`, two of which collide with live class names, and `.outline` drew a 1px border round the whole table in outline mode (`/?text=0`) |
| `@layer app` on the `styles.css` import | Unlayered declarations beat layered ones whatever the order. Every place a shadcn component goes is already covered by a descendant rule (`.cmt-nav button`, `.cmt-dialog header`, `.cmt-dialog button.linky`), so a utility you deliberately wrote would lose twice over and say nothing |
| `source(none)` + an explicit `@source "../../src/web"` | v4 auto-detects sources from the project root. It scanned `docs/`, found the `tw:flex` and `tw:rounded-md` written as **examples in the migration plan's prose**, and compiled them into the production bundle — seven utilities no component used. It then happened again from a doc comment inside [`lib/utils.ts`](../../src/web/lib/utils.ts) |
| `@custom-variant dark (&)` | Tailwind compiles `dark:` to `@media (prefers-color-scheme: dark)`, and this page is dark with no media query — see [§ Dark mode](#dark-mode) |

Two of these are worth stating in full, because the lesson outruns the fix.

**The prefix and the layer solve opposite problems, and neither substitutes for the other.** The
prefix stops Tailwind *inventing* a class we already use. The layer stops a class we *meant* from
losing. Layering alone would have made the `.outline` collision worse, not better, because it makes
utilities win more.

**Documentation prose can become shipped CSS.** That is the `source(none)` guard's real lesson, and
it has a second half: while it was happening, *"the class is in the compiled CSS"* stopped being
evidence that anything worked — the class was there because a document mentioned it. A verification
step that cannot fail is the shape of bug this repo keeps meeting
([silent-success.md](../reusable/silent-success.md)). Widen `@source` when client code moves, and
never point it at a directory containing prose.

One thing that went right by design: `twMerge` correctly drops shadcn's
`data-[state=on]:bg-accent`, so the orange on-state we override survives. `--accent` in this palette
is a raised dark **surface**, not the brand orange — the trap
[original-version/overview.md § Brand facts](original-version/overview.md#brand-facts-now-load-bearing) records,
arriving through the front door in the first component we adopted. The orange has its own Tailwind
name, `--color-highlight`, so nobody can reach for `tw:bg-accent` expecting it.

### Individual `Toggle`s, not a `ToggleGroup`

The plan called for `ToggleGroup type="multiple"` for the granularity pills. **We used separate
`Toggle`s instead, and the reason is the keyboard.** A ToggleGroup wraps its items in Radix's roving
focus, which binds ArrowLeft, ArrowRight, ArrowUp *and* ArrowDown. In this app all four are spoken
for: ↑/↓ step through the article and ←/→ choose the level they step by
([keyboard.md](keyboard.md#choosing-the-level-without-a-mouse)). A group would swallow all four whenever focus sat in
the controls bar — which is exactly where focus lands after you click a pill.

Separate toggles give the same `aria-pressed` and `data-state` and leave the arrow keys alone. **This
is a standing constraint on future component choices, not a one-off**: any Radix primitive with
roving focus (`ToggleGroup`, `RadioGroup`, `Tabs`, `Menubar`, `NavigationMenu`) will take the arrow
keys from the reader the moment focus lands inside it. Check before you reach for one.

### Never delete a semantic class name

Seven files read the DOM by selector — `.controls`, `thead th[data-col]`, `tr[data-block]`,
`td.text .prose`, `[data-nav-depth]`, `mark.cmt[data-comment]`. If `.controls` ever becomes a
Tailwind-styled flex row, keep `className="controls tw:flex …"`. Losing `.controls` makes
`stickyOffset()` fall back to the safe-area inset alone, and then every deep link and arrow jump
lands *under* the sticky bar while `scrollY` confirms the scroll happened.

`thead th[data-col]` is the sharper case, because the row it reads is **invisible**: the table head
has had no height since 2026-09-05 and exists for the fisheye panels' geometry and for a screen
reader ([granularity-zoom.md § the header row](granularity-zoom.md#the-header-row)). A `display: none`
on it renders identically and empties every panel.

### How the migration finished

Both of the plan's remaining steps are resolved. One was done; one was dropped on purpose.

**Step 8 — deleting the superseded controls CSS — is done.** `.controls button`, its `:hover` and
`.on` are gone. An earlier draft of this note called them harmless, on the reasoning that
`@layer app` lets the utilities win. That only holds where the two *conflict*: where the old rule
declared something no utility mentioned, it was still the thing painting. Two cases, and the
second is the one that mattered:

- `.controls button` supplied `font-family` (via `font: inherit`) and `cursor: pointer` to the new
  pills. `PILL` in [`App.tsx`](../../src/web/App.tsx) states both now, so the deletion could not
  change them — but that had to happen first.
- `.controls button.linky` — the `auto` control, the one thing in that bar that never became a
  `Toggle` — only ever overrode border-colour, underline and inline padding, and leaned on the base
  rule for the rest, so it was made to state its box in full. Both it and the `×` went on
  2026-09-05, when the bar was cut down to the granularity pills
  ([260905d](../plans/260905d-declutter-the-reading-view-top-bars.md)), and their rules went with
  them. The lesson outlives them and is written above `.mode` in [`styles/shell.css`](../../src/web/styles/shell.css): **any button put
  back in this bar states its own reset in full**, because there is no `.controls button` left to
  inherit one from.

`.controls button.on` was genuinely dead before it was deleted: Radix marks state with
`data-state="on"`, never a class.

**Step 7 — the comment dialog chrome — was dropped, and should stay dropped.** The plan said to
convert `.cmt-close`, `.cmt-nav button` and the dialog's `.linky` buttons to shadcn `Button`. Both
Greg's reviewer and this analysis landed in the same place: it is negative value.

- `Button` is not Radix. It is a `<button>` with a cva class string and a `Slot` for `asChild`.
  Unlike `Toggle`, which brought a real `aria-pressed` state machine, there is no behaviour and no
  ARIA to inherit here.
- Every variant that fits is wrong in the details. `ghost` hover paints `bg-accent`, which in this
  palette is a raised dark **surface**, not the brand orange — the same trap the pills hit. Every
  size variant is a fixed `h-*`; none of them is "inline, line-height 1", which is what a 15px
  chevron in a baseline-aligned header needs. `link` has the wrong colour, offset, and underlines
  only on hover where ours is always underlined.
- So the conversion is: adopt a component, then write a longer class string undoing
  `h-9 w-9 rounded-md gap-2 text-sm font-medium shadow-xs hover:bg-accent` to arrive back at what
  nine lines of CSS already say plainly.

The one argument for it is target size — `icon-xs` would give those buttons a deliberate 24px
target where they are currently about 20×15px. That is worth doing, but it is an accessibility
change, not a component migration, and three lines of CSS buy the same thing.

### The focus ring, which the migration quietly broke

Worth its own heading, because it is the clearest example in this whole exercise of a regression
that no test and no screenshot could see.

shadcn's components suppress the browser's focus ring with `outline-none` so they can draw their
own, at `focus-visible:ring-ring/50`. With shadcn's stock dark `--ring` that ring measures
**1.84:1** against this page — under the **3:1** WCAG 2.2 asks of a focus indicator, and against
the **11.4:1** of the browser ring it replaced. The first thing the migration did for keyboard
users was take away their focus indicator and hand back something they could barely see.

Nothing reported it. The ring was real, it was the colour it had been asked to be, the class was on
the element, and it only exists while Tab is held. It is also not a misconfiguration here —
`--ring: oklch(0.55 0 0)` on `--background: oklch(0.145 0 0)` is what shadcn ships.

Two fixes, both in [tokens.css](../../styles/tokens.css) and
[`toggle.tsx`](../../src/web/components/ui/toggle.tsx):

- `--ring` is the app's orange, 7.3:1, matching the focus convention the hand-written CSS already
  had in `.spine-hit` ([`styles/spine.css`](../../src/web/styles/spine.css)) and `.cmt-search`
  ([`styles/annotations.css`](../../src/web/styles/annotations.css)). The token alone could not fix it — halved, even the orange is
  2.6:1 — so the `/50` came off.
- `focus-visible:border-ring` is gone from `Toggle`. Upstream has focus repaint the border to match
  the ring, which is right where a border is decoration. On these pills the border colour **is** the
  on/off signal, so every pill you tabbed past lit orange: a keyboard user watched the columns
  appear to switch themselves on as focus went by. The halo says focused; the border says on.

Those are hand edits to generated files, which is the shadcn model rather than a workaround — but
`shadcn add` would silently undo them, so both files carry a header saying so.

## Dark mode

The reading view is **dark only** — an all-but-black page, off-white text, Spideryarn orange
unchanged. There is no toggle, no `prefers-color-scheme` branch and no light fallback. Greg,
2026-08-24:

> actually, it's night, and I'd quite like to be in dark mode. I don't want to add too much
> complexity, so I'm happy just to switch over and say we're going to make it always be in dark mode
> … which means the CSS is going to need a black background, white text, but keep the orange where
> possible.

This reverses the "light mode only" inherited from the original app — see
[original-version/overview.md § Decision: the palette](original-version/overview.md#decision-the-palette), which now
records the reversal. What made it cheap: the palette had already been collapsed into one source, so
switching themes meant changing values, not chasing colours through the stylesheet.

How it's put together, and what to know before touching it:

- **The variable *names* did not change.** [`styles/tokens.css`](../../styles/tokens.css) still
  defines `--background`, `--foreground`, `--muted`, `--sidebar` and friends; only their values
  flipped. Nothing downstream needed rewiring, and anything copied from the original codebase still
  resolves.
- **The orange is untouched — `#DB8A45`, unconditionally.** It's the one colour that needed no
  adjusting, and it works *better* here: `#DB8A45` on the near-black page is about 7.8:1, against
  about 2.6:1 on white. Orange text was borderline in light mode and is comfortable now, so the
  highlight can carry more work than it used to.
- **Not literally black-on-white inverted.** The page is `oklch(0.145 0 0)` and the text
  `oklch(0.97 0 0)`, because pure white on pure black haloes at reading sizes. First noticed in
  Georgia, and it did not go away when the reading face became Geist in 2026-08-25 —
  light-on-dark bloom is about the contrast, not the face. The other half of the same fix is
  `--reading-weight: 450`; see
  [design-css-overview.md § Typography](design-css-overview.md#typography).
- **Soft and faint greys run the other way.** In [`src/web/styles/tokens.css`](../../src/web/styles/tokens.css),
  `--ink-soft` / `--ink-faint` now *descend* in lightness from `--ink` instead of ascending. Anything
  that read `color-mix(…, black)` to darken the orange became `color-mix(…, white)` to lift it — that
  one lives in `--highlight-ink` now, so it's stated once.
- **Panels are lighter than the page, not darker.** `--sidebar` sits above `--background`; on a dark
  ground a raised surface reads as forward. The same inversion catches `--accent`, which is still
  shadcn's "hover surface" meaning and is now a dark grey — the trap described in
  [original-version/overview.md](original-version/overview.md#brand-facts-now-load-bearing) is unchanged in kind, only
  the failure mode flipped: a highlight that goes near-white becomes one that vanishes into the page.
- **`color-scheme: dark` is declared twice on purpose** — on `:root` in `tokens.css` for scrollbars
  and form controls, and again as a `<meta>` in [`index.html`](../../index.html) so the browser
  paints its canvas dark *before* the stylesheet loads. Without the meta there's a white flash on
  first paint. `theme-color` is the page black rather than the orange for the same reason.

If a light mode is ever wanted back, the shape of the change is a `[data-theme]` attribute on
`:root` and a second block of the same variable names — not a `prefers-color-scheme` media query,
which would give the reader no way to override it.

### What Tailwind and shadcn assume instead, and the bug it caused

Both of them assume `dark:` means *the OS is in dark mode*. Here it means nothing of the kind, and
that mismatch shipped a bug that nobody working on it could see.

- **`@custom-variant dark (&)` in [`tailwind.css`](../../src/web/tailwind.css).** Tailwind compiles
  `dark:` to `@media (prefers-color-scheme: dark)`, and shadcn's components lean on it — `Button`
  alone has `dark:bg-input/30`, `dark:border-input`, `dark:hover:bg-accent/50`. This app has no media
  query anywhere, so **on a machine whose OS was in light mode none of those rules would have
  applied, and the components would have rendered their light-mode branch on our permanently dark
  page.** The failure depended on the OS setting of whoever *viewed* it: perfect on a dark-mode Mac,
  subtly wrong on a light-mode one, invisible to the author and to every test. Redefining the variant
  as always-matching makes `dark:x` mean exactly `x`, which is the truth here. If light mode returns,
  this line is the first thing to change.
- **`shadcn init` writes a light palette, so we never run it.** It emits a light `:root` block plus a
  `.dark` block, and loaded after `tokens.css` its `--background: oklch(1 0 0)` wins: white page,
  near-invisible orange. [`components.json`](../../components.json) is hand-written for that reason
  and `init` is skipped entirely — `add` alone does not touch the palette. Diff `tokens.css` and
  `tailwind.css` after any `add` anyway ([setup-dev.md](setup-dev.md#adding-a-ui-component)).
- **`tokens.css` stays canonical.** The `@theme inline` block in `tailwind.css` only *points*
  Tailwind's `--color-*` names at it. `inline` is the load-bearing keyword: without it Tailwind copies
  the resolved value at build time, and `tw:bg-background` would freeze whatever `--background` was
  when the CSS compiled, then silently disagree with a hand-written `var(--background)` the moment
  anyone changed the token.
- **`--highlight-wash` stays hand-written.** Tailwind's opacity modifiers mix with `transparent`;
  ours mixes with `var(--page)`, an opaque blend. Different colours wherever the wash sits over
  `--panel` rather than `--page` — which is exactly where the active gist cell and the active spine
  band put it. `tw:bg-highlight/20` is a plausible-looking substitution that renders subtly wrong on
  half its uses.

## Reading an API response

Every `fetch` in the client reads its response through
[`src/web/lib/api.ts`](../../src/web/lib/api.ts) — `readJson` when the body is
wanted, `fetchOk` when it is not, and `failure` underneath both. There are two
rules in it and both are there because they were once broken:

**Read the text once, then decide.** Twelve call sites had each written the same
careful four lines:

```ts
const body = await r.json();
if (!r.ok) throw new Error(body.error ?? r.statusText);
```

which parses *before* it checks. When the failing reply is not JSON — Vercel's
plain-text 500, an HTML 404, a proxy's login page — `r.json()` throws first and
the second line never runs. In production on 2026-08-26 the homepage said
`Unexpected token 'A', "A server e"... is not valid JSON`. The error handling was
not missing; it was unreachable.

**A response body never becomes a user-facing message.** Only the server's own
`{ error }` string does, because that one is written for a reader. An unparsed
body belongs to somebody else, and putting it on screen is how a stack trace or a
login page ends up rendered inside a red box. What the reader gets instead is the
status and a pointer to the console; what the console gets is the status, the
URL, the content type and the first 300 bytes.

Two smaller things it fixes on the way. `res.statusText` is **empty in
production** — HTTP/2 removed the reason phrase from the protocol — so the old
`?? r.statusText` fallback produced `new Error("")`, an empty red box, on exactly
the deployments where it mattered and never on a laptop. And a `200` that is not
JSON gets its own sentence, because it usually means the single-page-app fallback
answered a request the API should have: calling that "not found" sends you
looking in the wrong place entirely.

Failures are logged with `console.error`, once. There is no client-side logger
and there should not be one — [logging.md](logging.md) is about the server, and a
browser already has a console — but before this, nothing reached it at all.
[`tests/web-api.test.ts`](../../tests/web-api.test.ts) pins the real bodies.

`describeFetchFailure` in [`useComments.ts`](../../src/web/useComments.ts) is the
neighbouring case and stays where it is: it names the failure where the request
never got a *response at all*, which is a different thing from a response that
says no.

### A write nobody reads the answer to

`readJson` makes the check unforgettable for a call whose body you want — you
cannot get the body without it. The calls with nothing to read had no such
protection, and the same omission shipped twice: a DELETE whose response was
never looked at took the row off the screen and said nothing, so the reader saw
it gone and found it back after a reload (`forget` in
[`useComments.ts`](../../src/web/useComments.ts), then again in
[`useSearch.ts`](../../src/web/useSearch.ts)). `fetchOk` is that check made
unforgettable in the same way — **asking and checking are one act** — and the six
sites that send a DELETE, a POST or a PATCH now go through it.

Three kinds of site deliberately do **not**:

- **A response about to be streamed.** `if (!r.ok || !r.body)` asks a second
  question, and a stream can end by simply stopping, which looks exactly like
  finishing. `useComments` § `answer`, `useSearch` § `run`, `chat/effects.ts`.
- **A status that is an answer.** A 404 from `/api/ideas/:slug` means nobody has
  asked for ideas yet; a 409 from the chat stream means somebody else is already
  answering; `/api/public/…` answers 404 for a piece that is not shared. Those
  callers read the status before deciding, and throwing would report an ordinary
  state as a fault.
- **A fetch that is not ours.** The Wikipedia summary in `link-facts.ts` and the
  Supabase settings probe in `lib/supabase.ts` both treat a non-2xx as *nothing
  to show*, which is not a thing to tell anybody about.

[`tests/refused-writes-are-reported.test.tsx`](../../tests/refused-writes-are-reported.test.tsx)
is the measure taken from outside, and its shape matters twice. It mocks **none**
of `lib/api.js`, because `fetchOk` calls `apiFetch` inside the module — so the
`vi.mock("…/lib/api.js", { apiFetch })` seam two neighbouring tests use does not
reach it, and a mocked `fetchOk` would be a test asserting against its own fake.
And one of its cases is a 500 whose body dies mid-read, which is the only thing
that separates `fetchOk` from letting `readJson` make the same check: `failure`
reads the body with a `.catch` and `readJson` does not, so without it a refusal on
a cut connection reaches the reader as `describeFetchFailure`'s *"Couldn't reach
the dev server"* — false, and unactionable, for somebody on a production page
whose server answered perfectly well.

## Empty is not the same as not asked yet

Every list in the client starts empty, and a fetch that has not come back yet
leaves it empty. So `items.length === 0` answers three completely different
questions with the same value — *you have none*, *we have not asked*, and *we
asked and it failed* — and a component that reads it as the first tells the
reader something false for as long as it is one of the other two.

On a fast connection that window is 40ms and nobody sees it. Greg opened chat
mode on a slow one, 2026-08-27:

> I tried loading Chat mode on a slow internet connection, and it initially told
> me there were no chats (even though I knew there were)! Then eventually the
> existing chats loaded and replaced that message. Better to show a loading
> spinner when loading, rather than default to the empty/initial state (which is
> wrong and worrying).

**Wrong and worrying is the whole of it.** A spinner says "wait"; an empty state
says "there is nothing", and a reader who knows better than that has just been
told the app has lost their work.

### The rule

**An empty claim requires a fetch that came back *and worked*.** That is the
whole of it, and it is a hard rule. "Nothing asked yet", "Nothing searched for
yet", "Nothing on the shelf yet" are all claims about the reader, and only a
successful, completed collection fetch earns one.

Which means every fetching hook exposes the three outcomes, not two. The client
spells it three ways and all three are fine:

- a `status` union — `useGlossary`, `useIdeas`, `useSimilar`, `useProjection`;
- `null` for "not asked yet" against `[]` for "asked, none", with `"error"` as a
  third value — `useShelf`, `useProfile`, `useAdminUsers`,
  [`ProfilePage.tsx`](../../src/web/ProfilePage.tsx)'s two local fetches;
- a pair of booleans, `loaded` and `loadFailed` — [`useChat`](../../src/web/useChat.ts),
  [`useSearch`](../../src/web/useSearch.ts), [`useComments`](../../src/web/useComments.ts).

**In the pair, `loaded` means *we have asked*, not *it worked*.** It is set on
the failure path on purpose, so a reader whose server is down can still open a
conversation and watch the send fail with a reason rather than face a panel that
never resolves. That is exactly why `loadFailed` has to exist beside it: with
`loaded` alone the panel drops out of the spinner into the same false claim one
beat later. Both fixes were needed and the second was missed the first time
round — GPT Sol found it, 2026-08-27.

**`loadFailed` is not `error !== null`.** `error` in these hooks carries any
transport failure — a retry, a delete, an answer that would not start — long
after the list arrived, and the three hooks do not even agree about when it goes
away (`useComments` and `useSearch` clear it when a retry *starts*; `useChat`
never clears it at all). `loadFailed` is about the one fetch that fills the list,
and only the mount effect sets or clears it. A body that comes back
`200 { error }` counts as a failed load too: there are no rows in it.

**Guard the result with a per-run flag, not with the slug.** `React.StrictMode`
mounts, unmounts and mounts again, so two fetches for the *same* article are in
flight at once — and `useChat` compared against a slug held in a ref, which they
both matched. The first one failing after the second one succeeded set
`loadFailed` back to true under a list that was on screen. A `let live = true`
closed over by the effect's cleanup is per-run by construction; all three hooks
use it. `tests/load-failed-flags.test.ts` mounts under a real `StrictMode` and
asserts the double-run happened before relying on it.

### A failed *reload* must not take the answer away

There is a fourth state, and it is the one the rule above does not cover: **we
asked again, over an answer we already had, and this time it failed.** The list
on screen is still true — it is just no longer known to be the newest truth — so
a hook that drops into `error` has taken something correct off the reader's
screen to tell them about a request they never made.

It is not a rare path. Every artefact hook reloads from `onFinished` whenever a
job that writes its artefact completes, and the reader is sitting there watching
when it happens.

The guard is one line, and the state it protects is the one the panel renders on:

```ts
setStatus((was) => (was === "loading" ? "error" : was));
```

Only the opening read has nothing to fall back on. **The error is still
reported** — `error` is a separate field from `status`, and the panels put it
above the list — so this is not a swallowed failure, it is a failure said beside
the thing it failed to replace. [`Tweets.tsx`](../../src/web/Tweets.tsx) has to
say it in a second state (`reloadError`) because its `Loaded` union cannot hold a
thread and a message at once.

[`useGlossary`](../../src/web/useGlossary.ts) learned this from a GPT Sol review
of the built code on 2026-08-28. **Three hooks had been copied from it before
that** — `useSummaries` (26 Aug), `useIdeas` (27 Aug) and `Tweets.tsx` — and
none of them inherited the fix, because a fix that lands in the original after
the copies were taken has nothing to propagate it. Two of the three were live:
`IdeasPanel` and the thread page both render only in their ready branch.
[`useShelf`](../../src/web/useShelf.ts) is the one that had it right all along —
it never nulls `articles` on a failed reload, and `Library` draws the shelf and
the message together.

`tests/background-reload-keeps-the-list.test.tsx` is the pattern, and the shape
matters: the reload is driven through the **job-completion callback**, not by
calling the loader directly, because calling it directly passes on a hook whose
`onFinished` is wired to nothing. Each surface keeps a sibling test for the
opening read, so "keeps the list" cannot pass by never reporting a failure at
all.

**And a failed POST does not mean the request never landed.** `queue.run` returns
`null` for *any* throw, including `readJson` on a 4xx or 5xx
([`useJobs.ts`](../../src/web/useJobs.ts) § `act`) — so a job the server received
and **refused**, for quota or auth or a bad step, is one of these. `useIdeas`
claimed *"The request did not reach the server."* until 2026-08-28, which threw
the server's own reason away and replaced it with a false one.

**Both obvious ways of getting that reason back are wrong**, and the second one
was the fix for the first. Reading `queue.error` *inside* the click handler gives
you the value from the render that created the closure — `useJobs` sets it during
the same `await` — so what you read is the previous error, or nothing. Reading it
*at render* is right for about one frame: `error` is shared with the poller, and
`act`'s own `finally` starts a poll the instant the POST fails, so the poll
succeeds and its `setError(null)` takes the sentence away again. All four
surfaces had that second spelling; the test that came with it used a posed queue,
which has no poll, so it proved the ternary and not the sequence.

So the reason is **snapshotted at the one instant it is available** — in
`start`, out of `queue.lastFailure()`, a ref only the actions write and no poll
can clear — and held until the next press. It lives once, in
[`useStepJob`](../../src/web/useStepJob.ts) § `failed`, with the failure and its
reason as **one value** rather than a boolean beside a string, so no later edit
can set one and forget the other — which is how the four copies drifted in the
first place. `tests/refused-job-reason-survives.test.tsx` drives the real
sequence, polls and all.

All four surfaces are on it: `useGlossary`, `useIdeas`, `useSummaries` and
[`Tweets.tsx`](../../src/web/Tweets.tsx). The thread page came last, a day after
the others, and was the one whose copy was **inline in a component** rather than
in a hook — so `jscpd` never saw it, and it drifted furthest. For that day it
went on reading `queue.error` at render, because the fix lived in the hook and
there was nothing to propagate it to a fourth copy.

### The waiting state

**Behind [`useSlow`](../../src/web/useSlow.ts)**, wherever the indicator *stands
in place of the content*. A fetch that finishes in 40ms then draws nothing at
all, and a spinner that flashes and vanishes reads as breakage — which is the
failure this rule replaces, not a second copy of it. `SLOW_AFTER_MS` is 600 and
lives in one place. A word in a status line that is on screen anyway — the
profile textarea's `Saving…` / `Loading…` caption — is not standing in place of
anything and does not need it.

**Name what is being waited for.** "Fetching your conversations…", not
"Loading…". The reader is waiting for a specific thing and the sentence is free.
Same rule as [copy.md](copy.md), and the one `useSlow`'s own docstring asks for.

**`role="status"` on the element, and hold its height.** The sentence arrives
600ms after the panel does, and a line that simply appears is announced to nobody
— `role="status"` is a polite live region, so a screen reader is told at the next
pause rather than interrupted. The wrapper renders through the quiet 600ms with a
`min-height` (or a `&nbsp;`) so the panel does not grow underneath the reader when
the words land. Both were missing from the first version and both came from GPT
Sol's second pass, 2026-08-27.

**And the failure line does not guess why.** These fire on anything `readJson`
throws — a 500, a non-JSON 200, a dropped connection — so the four of them say
*"Couldn't load your conversations. Reload to try again."* and stop there.
Promising the data is still on the server is a claim only the last of those three
supports.

The house shape is `LoaderCircle` from lucide with `.cmt-spinner`, in a flex row
beside a sentence — [`ChatListLoading`](../../src/web/ChatPanel.tsx),
[`CommentDialog.tsx`](../../src/web/CommentDialog.tsx),
[`JobProgress.tsx`](../../src/web/JobProgress.tsx). It is on `/design` under
"Icons and the spinner".

### Where this does not apply

A wait so short it is structural: [`App.tsx`](../../src/web/App.tsx) renders
`null` for the single frame between page load and the auth SDK's first
`INITIAL_SESSION`, because a spinner on every reload is worse than a frame of
nothing.

And a place where "empty" is itself the suspicious answer. The admin page says
*"No accounts came back, which should not be possible — you are one. Something is
wrong upstream of this page."* rather than drawing an empty grid, because there
the empty array is the bug rather than an answer.

### Testing it

[`tests/use-comments-load-state.test.ts`](../../tests/use-comments-load-state.test.ts)
is the pattern for the hook: a stubbed `apiFetch` with the *real* `readJson`
behind it, deferred promises so a request can be left in flight while the article
changes underneath it, and the interleaving where the article you left answers
late and must do nothing at all.

[`tests/load-failed-flags.test.ts`](../../tests/load-failed-flags.test.ts) is the
same for `useChat` and `useSearch`, including the StrictMode case above.

[`tests/chat-list-loading.test.tsx`](../../tests/chat-list-loading.test.tsx) and
[`tests/dock-questions-loading.test.tsx`](../../tests/dock-questions-loading.test.tsx)
are the pattern for the panel: the three states that must not say it — waiting,
waiting-and-below-the-threshold, failed — **and** the two the indicator must not
eat, a real empty list and a real populated one. Without those last two, a panel
that simply never showed its empty state passes everything else.

Every fetching hook in the client was surveyed on 2026-08-27. The three that got
it wrong are the three fixed here: `useChat`/`ChatPanel`, `useComments`/`Dock`,
and `ProfilePage`'s shelf — plus `useSearch`/`SearchPanel`, which had the
loading half already and was missing the failed half.

## The constraints it works under

- **Position is a block id, never a pixel offset or a selector.** Scroll restore, deep links,
  everything — and it is stored as the id of a *section's first block*, never a node id, which is
  regenerated with the tree ([url-state.md](url-state.md#the-unit-is-a-section-not-a-position)).
  [block-ids.md](block-ids.md) — read it before touching anything that resolves an id.
  In particular, ids are random: resolve a range by looking both endpoints up in the block sequence,
  never by comparing id strings.
- **One payload, no network on zoom.** `GET /api/article/<slug>` returns `meta + blocks + tree`
  together, so changing granularity is pure client state
  ([architecture.md § Server and client](architecture.md#server-and-client)).
- **The table geometry assumes a valid tree.** Contiguous ranges, children exactly partitioning
  their parent ([granularity-zoom.md § The tree](granularity-zoom.md#the-tree)). A tree that breaks
  those renders a plausible *wrong* article rather than an error — run `npm run validate-tree`.
- **Generated text is rendered as text, never as HTML.** The explanation in
  [`CommentDialog.tsx`](../../src/web/CommentDialog.tsx) is React children, not
  `dangerouslySetInnerHTML` — model output sits beside the author's prose and must not be able to
  dress itself up as it. The one `dangerouslySetInnerHTML` in the client is the author's own
  block html. See [comments.md](comments.md).
- **The height of the sticky bars is measured, never written down.** Deep links, the `?at=` tracker
  and the arrow keys all offset by it, and it used to be the literal `84` in two places with a
  comment asking you to keep it in step with `--bar-h` and the head's height. `stickyOffset()`
  measures `.controls` instead — and only that, since 2026-09-05, when the table head gave up its
  height and stopped being a term at all (a global `document.querySelector("thead th")` could also
  have matched an *article's own* table). Drift there is pure
  [silent success](../reusable/silent-success.md) — nothing throws, every jump just lands slightly
  under the bar, and `scrollY` confirms the scroll happened. Since 2026-08-27 it measures how much
  of the bar a row arriving at the top will have to **clear** rather than how tall the bar is,
  because on a short viewport the bar slides away while you read and a moved element's height does
  not change. And **no jump may change that number while it is travelling**: every path in
  `scroll.ts` that moves the page marks the window it owns, and the bar watcher sits it out — a
  destination is computed once, so chrome that answered to our own scrolling would land every jump
  44px out. [260827t-mobile-reading-view.md](../plans/260827t-mobile-reading-view.md).
- **On a phone the horizontal axis is a switch, not a scroll.** Below 732px `fitView` offers no gist
  columns at all and the prose column *is* the window; a mode band stops taking horizontal room and
  covers the article instead. Both are the same rule — the view would otherwise promise more columns
  than the window has and cut every line of prose mid-word. What a phone loses, and the one thing
  the spine cannot make up for on touch, is in
  [260827t-mobile-reading-view.md](../plans/260827t-mobile-reading-view.md).
- **Never substitute generated text for prose silently.** The verbatim column is the author's words;
  a gist stands in for text only where the reader chose that level. See
  [vision.md](vision.md#principles) — "no hidden reformulation".
