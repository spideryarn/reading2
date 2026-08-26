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
| [`src/web/router.ts`](../../src/web/router.ts) + [`Link.tsx`](../../src/web/Link.tsx) | `/`, `/read/<slug>`, and its `/metadata` and `/tweets` pages — [library.md](library.md) |
| [`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) | `/read/<slug>/metadata`: what the article is, what shape it is, and which pipeline stages have run — [metadata-page.md](../plans/metadata-page.md) |
| [`src/web/Tweets.tsx`](../../src/web/Tweets.tsx) | `/read/<slug>/tweets`: the article as a numbered thread, with the button that writes one and the line that says the thread is out of date — [tweet-thread-page.md](../plans/tweet-thread-page.md) |
| [`src/web/Library.tsx`](../../src/web/Library.tsx) | the homepage: the shelf of articles — [library.md](library.md) |
| [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx) + [`useJobs.ts`](../../src/web/useJobs.ts) | paste a URL, watch the five stages tick over — [ingest-queue.md](ingest-queue.md). The poll is deliberate; the hook's header says why it is not server-sent events. `useJobs` has two ways in: `add(url)` for an ingest, `run({slug, steps})` for a named step on an article already on the shelf — the thread page is the only caller of the second |
| [`src/web/tree.ts`](../../src/web/tree.ts) | tree → table geometry (`rowSpan` per node range) |
| [`src/web/TableView.tsx`](../../src/web/TableView.tsx) | the table itself: hover chain, deep links, and the arc column — [granularity-zoom.md § The arc](granularity-zoom.md#the-arc) |
| [`src/web/Masthead.tsx`](../../src/web/Masthead.tsx) | title, byline, source and counts — everything about the article that does not vary with position. The provenance behind a `▾` used to be here and is now a drawer panel |
| [`src/web/Dock.tsx`](../../src/web/Dock.tsx) | the bottom bar and the drawer that rises out of it: the five-mode switch, your questions, and the links to the tweets and metadata pages — [bottom-bar.md](../plans/bottom-bar.md). Its buttons are **three** kinds — navigate, open a drawer, switch mode — and the markup says which. The order is Greg's, set by hand; the way home and the dimmed placeholders both left it on 2026-08-26 |
| [`src/web/HomeLogo.tsx`](../../src/web/HomeLogo.tsx) | the Spideryarn wordmark fixed in the very top-left of the window, and the way home — everywhere except the library, which *is* home. Read its header before resizing anything: the corner is only free because `--spine-w` is wide, and the masthead and controls bar reserve `--logo-w` for it when it is not — [bottom-bar.md § Home left the bar](../plans/bottom-bar.md#home-left-the-bar-and-the-app-got-a-logo) |
| [`src/web/stats.ts`](../../src/web/stats.ts) | word, block, part, section and depth counts, pure — used by the masthead's facts line and the metadata page |
| [`src/web/Spine.tsx`](../../src/web/Spine.tsx) | the bird's-eye rail down the far left — [granularity-zoom.md](granularity-zoom.md#the-spine-a-birds-eye-rail) |
| [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx) | hover tooltips over Floating UI — [tooltips.md](tooltips.md) |
| [`src/web/BlockRef.tsx`](../../src/web/BlockRef.tsx) | one block id, drawn small and faint and linked to itself — [block-ids.md § Showing an id](block-ids.md#showing-an-id) |
| [`src/web/tailwind.css`](../../src/web/tailwind.css) | **the CSS entry point.** Four guards, the token bridge, and the `@import` that puts `styles.css` in a layer — [§ Tailwind and shadcn](#tailwind-and-shadcn-components) |
| [`src/web/styles.css`](../../src/web/styles.css) + [`styles/tokens.css`](../../styles/tokens.css) | reading typography and brand tokens, lifted from [the original version](original-version/overview.md). Both now load *inside* `@layer app`, via `tailwind.css` — the map of all four stylesheets is [design-css-overview.md](design-css-overview.md) |
| [`src/web/components/ui/`](../../src/web/components/ui/) | shadcn components, generated then owned by us — `button`, `toggle` |
| [`src/web/lib/utils.ts`](../../src/web/lib/utils.ts) | `cn()`, the class-name helper every shadcn component imports as `@/lib/utils` |
| [`components.json`](../../components.json) | what `shadcn add` reads: our paths, our `tw` prefix, Lucide — [setup-dev.md](setup-dev.md#adding-a-ui-component) |
| [`src/web/selection.ts`](../../src/web/selection.ts) + [`annotate.ts`](../../src/web/annotate.ts) + [`CommentDialog.tsx`](../../src/web/CommentDialog.tsx) | ask the model about a selected passage — [comments.md](comments.md) |
| [`src/web/comment-nav.ts`](../../src/web/comment-nav.ts) | comments in reading order, and the panel's prev/next — [comments.md](comments.md#several-at-once) |
| [`src/web/Cited.tsx`](../../src/web/Cited.tsx) | **model prose with block ids in it**, drawn as chips you can press with the paragraph itself on hover. Shared by chat and the summary panel rather than copied into each — [summaries.md § A summary is a door](summaries.md#a-summary-is-a-door) |
| [`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) + [`useChat.ts`](../../src/web/useChat.ts) | **chat**, in the band between the spine and the prose: threads, the streamed answer, the block-id chips that jump the article, and what a turn can have done to it — copy, retry, edit, **stop** — [chat-mode.md](../plans/chat-mode.md), and [§ What a turn can have done to it](../plans/chat-mode.md#what-a-turn-can-have-done-to-it) for why a stop is a `done` rather than an error |
| [`src/web/citations.ts`](../../src/web/citations.ts) | the block ids in a model's answer, found and checked against the article — pure, DOM-free, and the piece of chat that carries the contract — [chat-mode.md § The citation contract](../plans/chat-mode.md#the-citation-contract) |
| [`src/web/params.ts`](../../src/web/params.ts) | what every URL parameter means — [url-state.md](url-state.md) |
| [`src/web/position.ts`](../../src/web/position.ts) | reading position → the section that goes in `?at=` |
| [`src/web/layout.ts`](../../src/web/layout.ts) | which columns fit and how wide — [granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them) — and, since 2026-08-25, how wide the **mode band** is when the middle is something other than the columns |
| [`src/web/scroll.ts`](../../src/web/scroll.ts) | `scrollToBlock`, shared so a restore and a jump land identically; the flat-duration glide, and `stickyOffset()` |
| [`src/web/keynav.ts`](../../src/web/keynav.ts) | ↑ / ↓ nav, aimed by the pointer — [keyboard.md](keyboard.md) |
| [`src/api.ts`](../../src/api.ts) | server side: `loadArticle(slug)`, `listArticles()` and `articleMetadata(slug)`, mounted as dev middleware in [`vite.config.ts`](../../vite.config.ts) |

Running it: [setup-dev.md](setup-dev.md). `npm run dev` opens the **library** at `/`
([library.md](library.md)); an article is `/read/<slug>`, and a fresh clone that has never run the
pipeline still has the committed `example/` fixture to open ([`src/api.ts`](../../src/api.ts)). Old
`/?slug=<slug>` links are rewritten on the way in and keep working.

Deep links are `/read/<slug>?at=spya-k6fpme`. Every other bit of view state is in the query string
too — see [url-state.md](url-state.md) for the full set, for the rule that divides the path from the
query, and for why scrolling *replaces* the history entry while toggling a column *pushes* one.

An article has **three pages**, and which one is a third path segment: the reading view itself,
`/metadata` ([metadata-page.md](../plans/metadata-page.md)) and `/tweets`
([tweet-thread-page.md](../plans/tweet-thread-page.md)). They share the fetch, the bottom bar and the
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
prose) — and the band between them is the working surface. `?mode=` says which mode owns it,
absent meaning the granularity columns; `fitView` reserves the band's width; and four CSS rules add
a `--mode-w` term that is `0px` in the default mode.

"Permanent" means *no mode takes it away*, which is the claim Greg's framing is making, and it is
still true. It is not a promise the reader cannot put the rail away themselves: the `Spine` pill in
the controls bar does exactly that, in every mode, and it is the one granularity-bar control that
stays on screen in one ([granularity-zoom.md § the spine](granularity-zoom.md#the-spine-a-birds-eye-rail),
[url-state.md](url-state.md) for `?spine=`). The prose is the half with no off switch: `?text=0` hides it
in the table-of-contents mode and nowhere else, which is what `proseVisible` in
[`layout.ts`](../../src/web/layout.ts) exists to say once rather than twice.

Chat is the first mode that is not the table of contents
([chat-mode.md](../plans/chat-mode.md)). Adding a second — the Glossary in Greg's example — is a
value in `MODES`, a component, and a width; it is deliberately not a new negotiation with
`layout.ts` each time.

## Tailwind and shadcn components

> Let's switch to using Shadcn.
>
> — Greg, 2026-08-25

Read that as **adopting shadcn components**, not switching the reading view to shadcn. The plan and
the full accounting are [shadcn-migration.md](../plans/shadcn-migration.md); this section is
what actually landed and what a future reader would otherwise have to reverse-engineer.

**What shadcn now stands behind:** the granularity pills in [`App.tsx`](../../src/web/App.tsx) and a
`Button` waiting for the comment dialog. What it buys is accessibility we did not have —
`aria-pressed` on the toggles — and a house style for chrome not yet built.

The masthead's `▾` used to be on this list, over shadcn's `Collapsible`. It went when the article's
details moved to the bottom drawer ([bottom-bar.md](../plans/bottom-bar.md)), and the drawer that
replaced it is hand-written rather than a `Sheet` — worth recording, because a `Sheet` is exactly
what the migration plan would have predicted here. The reason is the z-index ladder: the drawer has
to interleave with the spine, the sticky bars, the comment dialog and the tooltip layer at
*specific* rungs, and a component that manages its own portal and overlay stacking is harder to
place in an order that already exists than 40 lines of CSS that simply state the rung.

**What is staying hand-written, and always will be:** the spine, the table geometry and its
`rowSpan` arithmetic, the sticky-bar ladder and its z-index order, the reading measure, `mark.cmt`
and the annotation layer, the arc column, the modeless comment shell, and the runtime pixel geometry
[`layout.ts`](../../src/web/layout.ts) computes. That is about 1,060 of `styles.css`'s 1,212 lines.
**So there are two ways of styling here, permanently** — utilities for chrome, semantic CSS for
everything utilities cannot express. Nobody is going to convert the rest, and nobody should try.

### Four guards, all in `tailwind.css`

Each is there for a failure that is silent rather than loud. Every one of them was found by building
it, not by reasoning about it. The file itself carries the long version; this is the map.

| Guard | Without it |
|---|---|
| `prefix(tw)` on both imports | Tailwind's scanner is a plain **text** scanner — it pulls bare words out of source and emits a utility for any that matches a utility name. It found 18 in `src/web/`, two of which collide with live class names, and `.outline` drew a 1px border round the whole table in outline mode (`/?text=0`) |
| `@layer app` on the `styles.css` import | Unlayered declarations beat layered ones whatever the order. Every place a shadcn component goes is already covered by a descendant rule (`.controls button`, `.cmt-nav button`, `.cmt-dialog header`), so a utility you deliberately wrote would lose twice over and say nothing |
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

Seven files read the DOM by selector — `.controls`, `thead th`, `tr[data-block]`, `td.text .prose`,
`[data-nav-depth]`, `mark.cmt[data-comment]`. If `.controls` ever becomes a Tailwind-styled flex row,
keep `className="controls tw:flex …"`. Losing `.controls` makes `stickyOffset()` return 0, and then
every deep link and arrow jump lands *under* the sticky bar while `scrollY` confirms the scroll
happened.

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
  rule for the rest. It now states its box in full. Two of its declarations look like dead weight
  and are not: the `1px solid transparent` border is 2px of box and is what keeps it the same
  height as the pills beside it, and the `border-radius` has nothing to round but is what keeps the
  focus ring a lozenge, because an outline follows `border-radius` whether or not a border shows.

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

- `--ring` is the app's orange, 7.3:1, matching the focus convention `styles.css` already had in
  `.spine-hit` and `.cmt-search`. The token alone could not fix it — halved, even the orange is
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
- **Soft and faint greys run the other way.** In [`src/web/styles.css`](../../src/web/styles.css),
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
  comment asking you to keep it in step with `--bar-h` and `--head-h`. `stickyOffset()` measures
  `.controls` and `thead th` instead: drift there is pure
  [silent success](../reusable/silent-success.md) — nothing throws, every jump just lands slightly
  under the bar, and `scrollY` confirms the scroll happened.
- **Never substitute generated text for prose silently.** The verbatim column is the author's words;
  a gist stands in for text only where the reader chose that level. See
  [vision.md](vision.md#principles) — "no hidden reformulation".
