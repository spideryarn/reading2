# Figures and tables open in the original, and a titled arXiv box keeps its words

Report `spya-weuekx` (#697), Greg (admin), a suggestion, 2026-10-24 16:55 UTC, on
`arxiv-2308-08708-spya-xax6v4` (Butlin et al., *Consciousness in Artificial Intelligence*, imported
from `https://arxiv.org/html/2308.08708`), at block `spya-rme98g`:

> All figures and tables and anything else like that extracted from the original article should
> provide a subtle UI widget of some kind that enables you to go back to the original article to see
> that diagram. I say that because the one that I'm looking at doesn't seem like it's been imported
> correctly.

Two things, then: the widget he asked for, and why that one was wrong.

## What was wrong with that one (read from production, read-only)

Two blocks after `spya-rme98g` is `spya-wejt97`, and it is **Box 1, "Determinacy, degrees,
dimensions"** — about 300 words — stored as an empty SVG: a black rounded frame, a white interior,
a black title bar, and nothing in them. The same is true of Boxes 2, 3 and 4 (`spya-xgh7tw`,
`spya-ymqz9n`, `spya-fsaefz`). Over a thousand words of the paper are missing, and the reader sees
four empty boxes.

LaTeXML draws a `tcolorbox` as an SVG frame with its words in `<foreignObject>`s; the sanitiser
deletes `foreignObject` (rightly, `src/sanitize-policy.ts`), so `src/latexml.ts` §
`liftBoxedPassage` takes the words out first. It was written against 2608.13566, whose box has **one**
`foreignObject`, and it refuses anything else on purpose, because a diagram has one per label. These
boxes have a **title bar**, so two: the title, then the body. Every one of the four in this paper is
that shape (counted on the live page, 2026-10-24).

The figures and tables of this paper came through: Figures 1–7 are images with captions, Tables 1–3
are tables. So the widget would not have shown Greg anything new for those, but it would have for
the boxes — and on a page where the lift fails some other way, it still will.

## Stage A — a titled box keeps its title and its words

Widen `liftBoxedPassage` by exactly one measured shape: **two** `foreignObject`s, each the same
container/content shape as today, the first (in document order) a title of at most 25 words with no
line break in it. The result is one `<span>` with the SVG's `id`, holding `<strong>` + the title's
nodes + `<br>` + the body's nodes. `<strong>` because the title bar is the box's heading (LaTeXML sets
it `ltx_font_bold`, a class the sanitiser drops) and run into the body without it, it reads as the
first sentence. Every other rule stays: frame tags only, no active content, linked ids keep the page
unchanged. Three or more `foreignObject`s is still a diagram and is left alone.

Test first, from a fixture cut from 2308.08708's Box 1, red before the change. Forward only:
the existing article changes when re-extracted, which is a production write and Greg's call.

## Stage B — every figure, table and image of a web article gets a way back

A quiet icon (`ExternalLink`, the masthead's own) after the block, in the `.figure-note` row the PDF
figures already use (`PdfFigureNote.tsx`), opening the publisher's page **at that element** in a new
tab. Same look as the PDF one: faint at rest, full on hover or focus, an `.sr-only` name.

- **Which articles**: those with a web source, `webSource(meta)` (`SourceLink.tsx`) — fetched pages,
  including for a visitor, who already sees that address in the masthead. Not an upload's *saved
  from* address, which is a claim out of a file and is never called the original. A PDF keeps its
  own control.
- **Which blocks**: `kind === "media"`, or a block whose html holds a `<table>`, `<figure>`, `<img>`,
  `<picture>`, `<video>` or `<svg>` — skipping a maths-only block (`<math>`), and an image inline in
  a paragraph of prose (more than a few words of text and no `<figure>`/`<table>`), which is an icon,
  not a figure.
- **Where it lands**: the first original `id` inside the block (not ours, `spya-…`): stage 3 keeps
  descendant ids, so arXiv's `S2.F1.g1` is on the published page too. Failing that, a text fragment
  (`#:~:text=`) of the caption's opening words, or the block's. Failing that, the page itself. The
  tooltip says which: *"Open this figure in the original"* or *"Open the original page"*.
- **Pure helper, tested**: `originalLinksIn(article): Map<BlockId, OriginalLink>` beside
  `pdfFigureNotesIn`, memoised in `TableView` the same way, rendered as a sibling after `.prose` so
  no comment anchor moves.

Why not something smarter, such as a screenshot of the original figure: it is a fetch and a
renderer per figure for what a link already does, and the reader's question is "is this what the
page shows?", which the page answers.

## Deferred, with a queue entry

**A PDF's tables** carry no page marker (`pdf-read.ts` § `figureMarker` marks figures only), so they
get no link yet. Adding one means a new reserved attribute through stage 2, the sanitiser's list and
the web path's forgery scrub. Queued rather than done here.

## Simpler option passed over

Linking every such block to the page without a fragment. One line, but on a long paper it drops the
reader at the top of a 40-page HTML rendering, which is no way back to *that* diagram.

## GPT Sol's plan review, and what changed

[261024w-plan-review-sol.md](261024w-plan-review-sol.md). All six checked against the code.

1. **Use the existing classifier** (P1) — taken. Which blocks is `figuresOf` (src/figures.ts), the
   answer Skim's *Figures* walk and Structure's marks already give, so a rule, a pull-quote, a layout
   or equation table and lettering get nothing. Plus one addition the classifier does not make: a
   block with no words that draws something, because that is how a box we failed to lift reaches
   the reader, and it is the one most worth checking against the page.
2. **A figure whose only id was on its own element loses it** (P1) — true, and accepted for v1:
   it aims by its caption or at the page. Carrying the root id through stage 3 is a change to the
   block contract's neighbourhood for a fallback that already lands near enough. Written in
   article-images.md.
3. **Two short labels would read as a titled box** (P1) — taken. The title must be set bold
   (`ltx_font_bold` on every word), with a negative test for two plain labels.
4. **Text-fragment encoding** (P1) — already `-`-safe; tests now pin `-`, `,`, `&`, `%`, `#` and
   non-ASCII, and the link carries `rel="noreferrer noopener"`.
5. **Multi-page articles** (P1) — true: the article holds page 1's address only. A block carrying a
   later page's namespaced id (`p2-…`) is aimed at the page, not at an id page 1 lacks; one with no
   id cannot be told apart and its caption fragment simply fails to match on page 1. Accepted for
   v1, written down; per-block page provenance is the fix if it matters (multi-page import landed the
   same day, 261024p).
6. **One link per block** (P2) — accepted as the product claim: a block holding a figure's panels is
   one figure, and `figuresOf` counts it as one.

## Found while building

**Box 3 holds a figure**, and the lift refused any `<img>` (261005l F28, written against an
embedded YouTube player). So the box stayed empty, 450 words with it. A plain `<img>` is no longer
refused: on an arXiv page (rule 1) it is the paper's own figure, fetched and hosted by stage 4.5 like
any other. Players, `picture`, `source` and the rest stay refused. All four boxes of 2308.08708 now
lift, checked on the live page.
