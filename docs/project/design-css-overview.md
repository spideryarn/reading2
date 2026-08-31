# Design and CSS: an overview

**This is a stub.** It exists to answer one question — *where does a style live, and which
mechanism owns it?* — because the answer is currently spread across four files and three other
docs, and every new agent has to reconstruct it. What is written below is true and checked. What
is missing is listed at the bottom, honestly, rather than left for you to discover.

Nothing here restates [web-client.md](web-client.md), [icons.md](icons.md) or
[tooltips.md](tooltips.md). This is the map; those are the territory.

## The five files, in load order

`main.tsx` imports **one** stylesheet, and it is not the one you would guess.

| # | File | What it holds |
|---|---|---|
| 1 | [`src/web/tailwind.css`](../../src/web/tailwind.css) | **the entry point.** The `@layer` statement, the Tailwind imports, the token bridge, the source-scanning rule |
| 2 | `tailwindcss/theme.css` + `utilities.css` | Tailwind v4, prefixed `tw`, in layers `theme` and `utilities`. **Preflight is deliberately not imported** |
| 3 | [`src/web/styles.css`](../../src/web/styles.css) | every hand-written rule, ~1200 lines, imported by *file 1* so it lands in `@layer app` |
| 4 | [`styles/tokens.css`](../../styles/tokens.css) | the brand palette and the four font stacks, imported in turn by *file 3* |
| 5 | [`styles/colourscales.css`](../../styles/colourscales.css) | the three palettes that are **not** the brand — categorical, sequential, diverging — imported by *file 4*. See [colour-scales.md](colour-scales.md) |

The nesting is the load-bearing part. Importing `styles.css` from `main.tsx` alongside
`tailwind.css` **does not work** — it lands unlayered, outranks every utility, and Tailwind
silently does nothing. The full reasoning is in the header comment of
[`tailwind.css`](../../src/web/tailwind.css) and in
[web-client.md § Four guards](web-client.md#four-guards-all-in-tailwindcss).

## Which mechanism owns what

Three mechanisms can style the same element, and picking wrongly is how the cascade fights get
started. The rule of thumb:

- **`styles.css`** owns anything structural, anything that reads as a *system* — the table
  geometry, the spine, the tooltip card, the reading typography. Semantic class names
  (`.spine`, `.gist`, `.prose`) are the interface; [web-client.md § Never delete a semantic class
  name](web-client.md#never-delete-a-semantic-class-name) says why they must not be replaced by
  utility soup even where they carry no rules.
- **Tailwind utilities**, written `tw:flex`, `tw:hover:bg-accent` — v4 colon syntax, not the v3
  dash — own one-off adjustments inside components, mostly where a shadcn component needs
  nudging.
- **shadcn components** in [`src/web/components/ui/`](../../src/web/components/ui/) own
  `button` and `toggle`, and nothing else. What is staying hand-written, and why,
  is in [web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components).

  **A worked example of that boundary, 2026-08-26.** Every "run this job" button moved to shadcn's
  `Button`, via [`JobProgress.tsx`](../../src/web/JobProgress.tsx). Not because shadcn is better,
  but because there were three copies of one component and two of them carried their own
  hand-written rules — `gloss-btn` and `summ-btn`, identical apart from two paddings, a gap and two
  colours. A button that appears in three panels is a *system*, which by the first bullet would put
  it in `styles.css`; but it is also chrome, which the third bullet puts in shadcn. Chrome won,
  because the alternative was inventing a third set of numbers for something the thread page was
  already drawing correctly. 38 lines of CSS went.

The longer version, with the bugs that made each boundary necessary, is
[260825a-shadcn-migration.md § Which mechanism does what](../plans/260825a-shadcn-migration.md#which-mechanism-does-what).

## Colour: one source, dark only

[`styles/tokens.css`](../../styles/tokens.css) is the single source of truth. Two things follow
from that, and both bite:

- **Dark only, unconditionally.** No toggle, no `prefers-color-scheme`, no light fallback —
  Greg's call, 2026-08-24. [web-client.md § Dark mode](web-client.md#dark-mode) has the quote and
  what to do if light mode ever comes back.
- **`--accent` is a raised dark *surface*, not the orange.** That is shadcn's meaning of the name,
  and shadcn's own components walk straight into it. Anything meaning the brand orange says
  `--highlight`. See the token block at the top of
  [`styles.css`](../../src/web/styles.css), and
  [260825a-shadcn-migration.md § Trap A](../plans/260825a-shadcn-migration.md#the-token-bridge).

The semantic layer at the top of `styles.css` (`--ink`, `--page`, `--panel`, `--surface-raised`,
`--rule`) sits over the brand tokens so the rules below read in reading-view terms rather than in
shadcn surface names. On a dark ground the greys run the other way: *soft* and *faint* are darker,
not lighter.

### Both of those are checked, because both had already happened

[`tests/css-tokens.test.ts`](../../tests/css-tokens.test.ts) reads all four stylesheets and asserts
two things. Neither was a hypothetical; `§ outline mode` had six instances of the second and three
of the first, and the panel was half unreadable on screen for four days before Greg's screenshot.

- **A `var(--x)` with no fallback names a token that exists** — in one of the four sheets, or set as
  an inline style from `src/web` (the test reads those too, including the `--h${i}` family
  `annotate.ts` emits). An undefined custom property with no fallback is *invalid at computed value
  time*: the whole declaration is dropped and the property inherits. Nothing errors, and the rule
  looks exactly like one that was applied. `.outln-row.here { color: var(--fg) }` — the mark on the
  reader's whole ancestor chain — did nothing at all.
- **No `color:` is a surface token.** `--muted` is `oklch(0.245 0 0)` and the page is
  `oklch(0.145 0 0)`, so text painted in it sits at about 1.2:1. The text twin is
  `--muted-foreground`, aliased here as `--ink-faint`.

A third checks the same mistake in Tailwind's spelling: `tw:text-muted` is not the text colour —
the bridge at the top of `tailwind.css` maps `--color-muted` to `--muted`, the surface — and
`tw:text-muted-foreground` is. All 88 call sites in `src/web` are already the right one, so that
check arrives with a clean baseline, which is the only time one is cheap to add.

**The file's header says what it does not prove**, and that matters more than the list above.
It is a text scanner: it cannot see scope or reachability, cannot see what is actually behind the
text, and cannot judge a fallback that is present and still wrong. Each half also asserts it can
still *find* the shape it filters, because a regex that has stopped matching anything is
indistinguishable from a codebase with nothing wrong in it.

The `--accent` warning above was already written in two files, in capitals, and the mistake was made
anyway with `--accent`'s neighbour. **A rule that is only written down is not a check**, which is
why these now are.

**There is exactly one colour that is not the orange, and it is `--hit-rgb`** — the wash over search
results ([search.md](search.md)). It exists because a comment, a glossary term and a search hit can
all cover the same sentence, and three meanings separated only by opacity is one hue too few. That
is not a guess: the version this project is an offshoot of drew all three in `#DB8A45` and got away
with it only because it could never show two at once
([original-version/highlighting.md](original-version/highlighting.md)). On a near-black ground the
failure is worse than muddled, it is invisible.

It is held as **three space-separated numbers rather than as a colour**, because the confidence wash
is `rgb(var(--hit-rgb) / <alpha>)` and that form is the one that takes a variable alpha. `--hit` is
the ordinary-colour alias beside it. Anything else that needs a second meaning on the prose should
add a token here rather than reach for another alpha of the orange.

**Since 2026-08-26 that sentence needs a second half.** Several saved searches can be showing at
once, each in its own hue, so the search mark had to split into two channels: a low-chroma slate
wash (`--hit-wash-rgb`) carrying the model's confidence, and one coloured rule per search underneath
it carrying *which* search. `--hit-rgb` is now the panel's chrome colour rather than the wash's. The
eight hues are in [`colourscales.css`](../../styles/colourscales.css) and the reasoning is in
[colour-scales.md](colour-scales.md) — including the two things that make a published palette wrong
on this page, and the fact that slot 6 sits close enough to the brand orange to be worth knowing
about.

One trap worth repeating here because it is invisible: **mix colours in `oklab`, not `oklch`.**
`--page` is written `oklch(0.145 0 0)`, a hue explicitly specified as 0 rather than missing, so
polar interpolation drags a mix round to 11.7° and the result is quietly pink instead of warm.
`--highlight-wash` escapes only by using `in oklab`.

## Typography

**One sans for everything the reader looks at** — the article and the chrome alike. Geist,
self-hosted from `@fontsource-variable/geist`, imported at the top of
[`tailwind.css`](../../src/web/tailwind.css) with the system stack behind it.

| Token | Used for |
|---|---|
| `--font-sans` | Geist — the family itself. Nothing should name this directly; use one of the two below |
| `--font-reading` | the article, and the reader's own words in a comment |
| `--font-ui` | chrome: controls, masthead facts, column headers |
| `--font-mono` | Geist Mono — counts, and anything that wants to line up |
| `--font-id` | Courier — block ids, and only block ids (Greg's ask) |
| `--font-brand` | Trebuchet MS — the wordmark, and only the wordmark |

`--font-reading` and `--font-ui` both resolve to `--font-sans` today. They stay separate names
anyway: the article and the chrome being one face is a *decision*, and undoing it should be one
line rather than a search-and-replace.

**Georgia was here until 2026-08-25, and it should not have been.** The story is worth knowing
because it is a documentation failure rather than a design one. Our own notes on the previous app
([original-version/typography.md](original-version/typography.md)) reported a research doc
recommending Georgia at 17px on an x-height argument, and that recommendation was carried into
`tokens.css` as though it were what the previous app had shipped. Checking the actual repo shows it
never shipped: `app/globals.css` sets `body { font-family: Arial, Helvetica, sans-serif }`, Geist
Sans sits behind Tailwind's `--font-sans`, and Georgia appears nowhere in it. Its reading surface
was sans, headings and body in the same face. Greg, 2026-08-25, asked to *"follow how we were doing
fonts in the previous version"* — so we now follow what they did rather than what they wrote down.

The cost is stated in [`tokens.css`](../../styles/tokens.css) and repeated here because it is the
thing most likely to want revisiting: **the article column no longer looks different from our own
chrome.** A gist in the column beside a paragraph is now the same face as the paragraph.

Two numbers from that research doc *are* worth keeping, because they are independently attested:

- **65ch**, the reading measure — which the previous app really did ship, as `max-w-[65ch]`.
- **Space above a heading exceeds space below it** — `mt-6` against `mb-4` in their document
  viewer. We had lost this; every block here is a table row and every row had the same padding, so
  a heading sat exactly halfway between the section it ended and the one it introduced. It is back,
  as `td.text.kind-heading` in [`styles.css`](../../src/web/styles.css).

### Weight, and the variable axis

`--reading-weight` is **450, not 400**. Light text on a dark ground optically thins; the previous
app's own wishlist named the fix — *"add ~50 to the weight axis in dark mode"* — and could not use
it, having no variable face. Geist's axis runs 100–900, so we can. Drop it to 400 the day a light
theme appears.

### Vertical rhythm

`--rhythm` is `17px × 1.4 ≈ 23.8px`. Theirs, and it is arithmetic rather than evidence — but good
arithmetic, and the thing that makes a page look considered rather than assembled.

Every vertical gap **in the article column** is a multiple of `--block-pad`, which is a quarter of a
unit: one pad above and below each block (so two pads — half a unit, 11.9px — between paragraphs),
two above a heading, half a pad below. **`--block-pad` is the one number to change** if the article
wants more or less air; every rule is written as a multiple of it, so the heading spacing keeps its
proportions on its own. It has come down twice on Greg's asking — half a unit until 2026-08-27, a
third until 2026-08-28 — and there is a floor below this that is not arithmetic: at 17px/1.6 the
whitespace *between two lines of one paragraph* is around 10px, and once the gap between paragraphs
stops clearly exceeding that, the paragraph stops being a unit the eye can see. A fifth would be
past it.

**Scoped to the reading column on purpose.** The chrome keeps its per-rule `rem` values; sweeping
1,800 lines onto a scale is a different job, and Greg scoped this one to the article. Do not reach
for `--rhythm` or `--block-pad` outside `.prose` / `td.text` — the one exception is the section of
`/design` that exists to display them.

### Content that cannot reflow

A code block or a data table in an article is as wide as its widest line and neither will wrap.
`.prose pre` and `.prose table` now scroll inside their own box. Until 2026-08-25 nothing stopped
either, and the consequence was worse here than in most layouts: the *page* scrolls horizontally in
this view by design, and the masthead, the spine and every sticky bar are pinned to that scroll —
so one wide code sample in one paragraph dragged the whole article's furniture off to the left.

`display: block` on the `<table>` is load-bearing and is not a typo: `overflow` does nothing on
`display: table`.

### Content that cannot be read at all: the light sheet under a figure

Added 2026-08-28. Greg, looking at Wolfram's *What If We Had Bigger Brains?*: *"Improve how we
display tables, equations. They seem to be being displayed in dark text on a black background."*

They were, and **it was not a colour bug.** The block is a `<p>` containing one `<img>`, and all
seven of that article's images are PNGs with an alpha channel carrying near-black ink — equations
and data tables, drawn for a white page and served onto ours. The alpha extrema are in
[260828az-figures-in-the-prose.md](../plans/260828az-figures-in-the-prose.md).

So `.prose .zoomable > :is(img, svg)` sits on `--figure-sheet`, an off-white, with a small mat of
padding. Three things about that are worth knowing before changing it:

- **It is unconditional, and it has to be.** CSS cannot see an alpha channel, and JavaScript cannot
  either: article images are hot-linked cross-origin with no `crossorigin` attribute, so a canvas
  drawn from one is tainted and `getImageData` throws. Per-image detection would mean proxying every
  image, which is stage 1's job. Wikipedia's night mode reached the same conclusion the long way
  round — their `skin-invert` class is applied *by hand*, to images an editor has certified as pure
  black, precisely because `filter: invert()` wrecks anything with a real hue.
- **An opaque photograph covers its own sheet exactly**, so the only visible cost is the mat. The
  case this makes worse is white-ink-on-transparent, which is rare because the web's default page is
  white — but it is a real regression class, not a hypothetical.
- **The scope is `.zoomable >`, and that is a guard, not a coincidence.** A 1×1 tracking GIF given
  this rule is a pale square in the middle of a sentence.
  [`zoomable.ts`](../../src/web/zoomable.ts) already decides what counts as a figure (it skips an
  `<img>` under 64 declared pixels), so hanging the sheet off its wrapper makes that judgement once,
  in the only place that can see the width attribute.

The same wrapper carries the **⤢** that opens [`Lightbox.tsx`](../../src/web/Lightbox.tsx) — one
figure, near-full-screen. That is a native `<dialog>` opened with `showModal()`, so it is in the
browser's **top layer** and does not appear in the z-index budget below at all; its header says what
else the platform's modal gives for free, and what it does not.

## Controls: one height, one radius, one hover

Added 2026-08-27, after Greg looked at the shelf and said the buttons were ugly. He was right, and
the reason turned out to be one line of CSS rather than taste.

### The reset covered a minority of what it named

We do not import Tailwind's preflight (the header of
[`tailwind.css`](../../src/web/tailwind.css) says why, and it is a good reason — it would reset the
article author's own HTML inside `.prose`). The replacement was scoped to `[data-slot]`, the
attribute shadcn stamps on everything it generates.

Most of the buttons in this app are not shadcn's. Measured on the shelf that morning:

| | before | after |
|---|---|---|
| buttons carrying the UA's own `2px outset white` border | **36 of 59** | 0 |
| buttons with `cursor: default` | **59 of 59** | 0 |

Both numbers are the same bug. A browser's default `border-style` for a `<button>` is not `none`,
it is `outset` — and no colour utility touches a border's *style*, so `tw:border-border` on a
hand-rolled button recoloured a border that was still white and still 2px. Tailwind v4's preflight
also dropped v3's `button { cursor: pointer }`, and shadcn does not set it, so nothing in the app
had it.

You could see the first one: the shelf's cards/table toggle was **two bright white boxes**, 33px
tall in a 38.6px fieldset, standing a head above the 26px pills beside it. `SortChips` in
[`lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) already carried a bare `tw:border-0` with no
comment — somebody hit this, fixed their own fieldset, and had no reason to think it was general.

This is [silent-success](../reusable/silent-success.md) again, and it is the *same shape* as the
story `tailwind.css` already tells two blocks further down: the previous app's
`prefers-reduced-motion` guard covering two class names while fifteen animations ran regardless. A
reset that is present, documented, and covers a minority of what it names. **The check that would
have caught it is one line in a console** — count the buttons whose computed `border-style` is
neither `none` nor `solid` — and it is worth running after anything that touches this file.

### The other half of the same hole: images

Found 2026-08-27, when Greg said the screenshots on the landing page *"look warped somehow"*. They
were: stretched vertically by about **1.95×**, every letter in them twice as tall as it should be.

The same missing preflight, in a place nobody thought to look. `width` and `height` on an `<img>`
are not merely hints about aspect ratio — the HTML spec maps them to CSS `width` and `height` as
**presentational hints**. [`LandingPage.tsx`](../../src/web/LandingPage.tsx) sets both (deliberately,
so the page does not jump as a large capture lands) and then sizes the image with `tw:w-full`. The
utility overrode the width; nothing overrode the height. So a 1245×815 screenshot was drawn 640 CSS
px wide and still 815 tall, and 1245/640 is exactly the 1.95 you can see.

Three things kept it hidden, and all three are worth naming:

- **The file was never wrong.** [`landing-assets.test.ts`](../../tests/landing-assets.test.ts) reads
  the JPEG's own header and checks it is the shape the page reserves space for. It passed, because
  it was true. The test is about the *asset*; the bug was in the *rule*.
- **`.prose img` in [`styles.css`](../../src/web/styles.css) has carried `height: auto` all along**,
  so every image inside an article was fine. Only chrome images were affected — a split that stops
  anyone suspecting something global.
- **The page around it looked perfect.** This reads as "the screenshots look odd", which sounds like
  a capture problem, not a stylesheet one.

The fix is preflight's own rule, `img, video { max-width: 100%; height: auto }`, in `@layer base`
alongside the button reset — so an explicit height in `app` or a `tw:h-*` utility still wins. The
`max-width` half comes with it: an image overflowing its column is the other face of the same
surprise.

Two general lessons. **A hand-written reset is a list of the cases you happened to think of**, and
this one was written while looking at buttons — so widening it once for buttons did not widen it for
anything else. And **an HTML attribute that also sets CSS is a rule you did not know you wrote**;
`width`/`height` on an image are the common one, and the moment a utility sets only one of the pair,
they stop being about aspect ratio and start being about size.

### Two hover languages, and the orange one won

`--accent` is a raised dark grey **surface**, not the orange; both `tokens.css` and `styles.css`
carry shouted comments about that name. shadcn's `outline` and `ghost` both hovered to `bg-accent`,
while every hand-rolled control on the shelf hovered to `bg-highlight/10`. Same page, two answers.
The variants were repainted to the app's own; see the header comment in
[`button.tsx`](../../src/web/components/ui/button.tsx), which is now **two** local edits rather than
one.

`outline` lost more than a hover. It shipped `dark:bg-input/30` over `bg-background` plus
`shadow-xs`, and every `dark:` here means *always* (the `@custom-variant` in `tailwind.css`), so it
rendered as a muddy translucent grey slab — `oklab(0.3 0 0 / 0.3)` — under a 5%-black drop shadow
that a near-black page cannot show. That is what made **Add**, the one thing the shelf exists to let
you do, the quietest control on the page. It is `default` now, and orange.

One more thing that only bites on a dark ground: `hover:bg-primary/90` composites the orange over
what is behind it, so the stock hover makes an orange button **darker**. `hover:brightness-110`
instead.

### The numbers

Not a scale — the page has no spacing scale and this does not invent one — but the controls on a
list page now agree, and agreeing is the whole of it:

| | height | radius |
|---|---|---|
| sort chips, Unread, Undo, Show deleted, card icon buttons, the view toggle | **28px** (`h-7` / `size-7`) | pill for state, `rounded-md` (8px) otherwise |
| the view toggle's two halves | 24px (`size-6`) inside the 28px box | `rounded-sm` (6px) = outer 8 − 2px padding |
| shadcn `size="sm"` | 32px | `rounded-md` |
| shadcn `size="default"`, and the inputs beside it | 36px | `rounded-md` |

The chip is stated as a **height**, not as padding, in `chipClass` in
[`lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) — that is what lets an icon-only control in
the same row agree with a text one without anybody redoing the arithmetic when an icon changes. It
is exported because the shelf has two more chips of its own
([`ShelfControls.tsx`](../../src/web/ShelfControls.tsx)) and the class string had been copied out
character for character.

### Narrow windows: wrap, do not shrink

There are no breakpoints on the shelf and it does not need any — `max-w-4xl` makes the page fluid
below 896px and `mx-auto` simply stops doing anything. What a narrow window actually breaks is the
**rows**, and the rule that keeps them honest is: *a row of things whose widths you do not control
must be allowed to wrap.*

Three of them were not, and were fixed on 2026-08-27 as a set:

- the page's masthead line, wordmark against the **You** / **Design** links
- a card's bottom meta line — word count, question count, and a note whose text is whatever the
  current sort makes it (`opened 3 weeks ago`, `added 26 Aug 2026`)
- the tooltip, capped at `min(22rem, calc(100vw - 1.75rem))`. Floating UI's `shift` already keeps a
  panel on screen, but shifting a 352px box inside a 390px viewport pins it to one edge with
  nowhere left to go; capping the width is what lets it stay near the thing it is about.

Two rows were already right and are worth knowing about, because they are the pattern to copy.
`ShelfControls` is `flex-wrap` around a `flex-wrap` fieldset, so the chips reflow inside their own
group and the Unread / view-toggle pair takes its own line, still right-aligned by `ml-auto`. And
the dense table is inside `overflow-x-auto`, which is the other half of the rule: content that
genuinely **cannot** reflow — a six-column table — scrolls in its own box rather than pushing the
page sideways. Same call as the code blocks in
[Content that cannot reflow](#content-that-cannot-reflow).

The check is one line in the console, at whatever width you are worried about:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth  // must be 0
```

### The reading view's narrow window, which is a different problem

Everything above is the shelf, where a narrow window breaks *rows*. On the reading view it breaks
the **columns**, and the fix is not CSS at all — it is arithmetic in
[`src/web/layout.ts`](../../src/web/layout.ts), which stops offering gist columns once one will not
fit beside the prose. `styles.css` § **a narrow window** and § **a short viewport** at the end of the
file are only what is left over after that: the block-id gutter, the wordmark, the two bars that
were silently clipping their own controls, and the mode band going full-screen.

Three things worth carrying to whatever is built next:

- **The breakpoint is derived, not chosen.** `731px` is `GIST_MIN + PROSE_MIN + the spine`, minus
  one — the width at which layout.ts gives up the last gist column and the prose column *becomes*
  the window. `tests/layout.test.ts` pins the crossover on the TypeScript side; since 2026-08-28
  `tests/spine-width.test.ts` reads the query out of the stylesheet and checks it against the same
  sum, which is the half a layout test cannot see. Both are needed: the number is written down six
  times and the compiler checks none of them.
- **A row that does not fit must scroll, never clip.** `.dock-modes` had `overflow: hidden` for a
  good reason (rounded corners on a segmented control) and it quietly turned into a machine for
  deleting buttons: 48px of clip over a 245px control, five of six modes unpressable, no scrollbar
  and no sign anything was missing. `flex: none` on anything whose overflow is hidden, and
  `overflow-x: auto` on the bar around it.
- **`.controls` moves by `transform`; everything under it moves by `top`.** A bullet here used to
  say a transform on that bar computed to identity and could not be used. That was wrong, and it was
  wrong for the reason [browser-testing.md § a hidden tab](browser-testing.md) now describes: a CSS
  transition does not advance in a tab that is not frontmost, so every reading of the moved bar
  returned the value it started from and agreed with itself. Verified with transitions disabled,
  2026-08-27: switching `--bar-bottom` gives `matrix(1,0,0,1,0,-44)`. The split is a real one and
  worth keeping — a transform moves only the paint, where animating a sticky element's own `top`
  re-runs the stickiness constraint every frame — but it is a choice, not a limitation.
- **The bottom bar moves the same way**, since 2026-08-28, driven by `--dock-bottom`: the
  bottom-edge twin of `--bar-bottom`, `0px` while the bar is away and its resting room otherwise.
  Anything pinned *above* the bar (the mode band, the overflow fade) reads it directly; anything
  that must clear the bar permanently (`.reader`'s bottom padding, the dialogs) reads `--dock-space`
  instead. **Do not tie the document's height to the moving one** — a page that grows and shrinks
  under the finger scrolling it is worse than a bar in the way.

The full account, including what the measuring harness cannot see, is
[docs/plans/260827t-mobile-reading-view.md](../plans/260827t-mobile-reading-view.md).

### The screen is bigger than the window: `env(safe-area-inset-*)`

`index.html` carries `viewport-fit=cover`, so on an iPhone the document is laid out across the whole
physical screen and the notch, the home indicator and — in the installed app — the status bar all
overlap it. `styles.css` § **safe areas** turns each edge into a token (`--safe-top`, `--safe-bottom`,
`--safe-left`, `--safe-right`) and every piece of fixed or sticky chrome adds the one it faces. The
article itself does not: prose running a few pixels behind a rounded corner is what `cover` is for.

Three things to know before touching any of it:

- **Every one of them is `0px` on every machine we develop on**, so a rule with a mis-typed `env()`
  name falls back to the same `0px` and looks perfect. There is nothing to see until it is on a
  phone. To check one, set the token to `40px` at `:root` and watch the chrome move — a rule that
  cannot be made to move that way will not move on the device either. Run a nonsense control
  (`--zz-control`) alongside it, or you are testing your method rather than the rule.
- **`cover` is not standalone-only.** In an ordinary Safari or Chrome tab it also opens up the notch
  in landscape and the home indicator in portrait, and Safari's bottom inset *changes* as its
  toolbar minimises. Only the top inset is reliably zero in a tab.
- **Two things cannot do this arithmetic in CSS** and read the numbers through
  [`src/web/safe-area.ts`](../../src/web/safe-area.ts): `fitView`, which divides the window's width
  in pixels and must not spend width the notch has taken, and `stickyOffset`, which predicts where
  the controls bar's bottom edge will be. Reading the custom property back is not an option —
  an unregistered one is never substituted for the CSSOM, and `@property` does not survive this
  build. So the module measures a probe instead.

The plan, the review that found three of these, and the install path they exist for:
[docs/plans/260828av-mobile-screen-real-estate.md](../plans/260828av-mobile-screen-real-estate.md).

## What is not written down yet

The honest list. Each of these currently lives only as values in `styles.css`, and someone will
eventually have to decide whether they are a system or an accident:

- **The z-index budget.** Nine values between 1 and 80, and their ordering is real — the spine is
  45, the tooltip 80 *because* it must clear the spine and both sticky bars. Written as a comment
  on one line of `styles.css`, nowhere else. This is the most likely thing to break next. The one
  thing that had to cover *everything* — the figure lightbox — sidesteps it entirely by being a
  native modal `<dialog>` in the top layer, which is the cheapest answer available and is worth
  reaching for again.
- **Spacing.** No scale. `rem` values chosen per rule. Control *heights* on a list page are
  settled — see [Controls](#controls-one-height-one-radius-one-hover) above — but that is one row
  of one page agreeing with itself, not a scale, and it should not be read as one.
- **Breakpoints.** Exactly one, `max-width: 760px`, plus the widths at which the columns are given
  up, computed in JS rather than in CSS ([`layout.ts`](../../src/web/layout.ts)). The interesting
  responsive behaviour is not in the stylesheet at all. (The spine used to be in that sentence too,
  collapsing from 13rem to a strip on width; the expanded rail was deleted on 2026-08-26 and it is
  now one width, on or off — 12px since 2026-08-28.)
- **Motion.** Settled, mostly. One global guard in `@layer base` at the foot of
  [`tailwind.css`](../../src/web/tailwind.css) flattens every animation and transition; four
  narrower blocks in `styles.css` remain, for the things that are *wrong* when reduced rather than
  merely fast (a tooltip's transform, the context panel's scroll-behaviour). Written globally
  before most of the motion it guards exists — which is the lesson from the previous app, where
  the guard covered two class names while fifteen keyframe animations ran regardless. Individual
  durations are still per-rule.
- **What "done" looks like.** Whether this project wants a design system, or whether ~1200 lines
  of well-commented CSS *is* the answer at this size, is genuinely undecided.

## See also

- [web-client.md](web-client.md) — the view all of this styles, and its constraints
- [icons.md](icons.md) — Lucide, one stroke weight, and two ways an SVG breaks a layout quietly
- [colour-scales.md](colour-scales.md) — the three palettes that are not the brand, and why every
  published one is upside down on a black page
- [tooltips.md](tooltips.md) — the one component whose appearance is entirely ours
- [original-version/overview.md](original-version/overview.md) — where the palette and the typography came from
- [browser-testing.md](browser-testing.md) — **do not judge colour from a screenshot**
- **`/design`** — not a doc but the live counterpart to this one:
  [`DesignPage.tsx`](../../src/web/DesignPage.tsx) renders every token, face, weight, button
  variant, toggle state and icon size on one page against the real ground, with contrast ratios
  computed in the browser from *resolved* values. Look at it after changing anything in
  `tokens.css`. It catches what tests cannot: a token change where every component still renders,
  nothing throws, and one variant nobody looked at is now unreadable
- [../plans/260825a-shadcn-migration.md](../plans/260825a-shadcn-migration.md) — how the Tailwind half got here
- [../reusable/css-sticky-containing-block.md](../reusable/css-sticky-containing-block.md) —
  `position: sticky` declared correctly and doing nothing
