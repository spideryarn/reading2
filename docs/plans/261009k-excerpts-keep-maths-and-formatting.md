# Excerpts drawn from the block's own markup — maths and inline formatting kept

Report: **spya-pqae7m** (Greg, 2026-10-09 07:42 UTC), on *Attention Is All You Need*, in Skim.

> I saw a quote in skim mode that referred to some LaTeX formulae that was just showing the
> unrendered LaTeX. It should be obviously showing the rendered LaTeX.
>
> I wonder if there's anything else that we should also be doing (is other formatting or rendering
> etc), whether maybe if the quote had italics or bold or something like that, that we should also be
> preserving that in skim mode.
>
> And consider whether there are other modes where we need to also handle this. I don't know. Quotes
> mode itself, or glossary, or anywhere else where we're excerpting text, we want to preserve the
> formatting. Perhaps do this with some kind of reusable excerpt machinery?
>
> — Greg, 2026-10-09

Status: **stage 1 built** (the renderer, Skim drawn through it, tests red-then-green); stage 2 (the
other sites) planned below.

## Why it happened

Every excerpt outside the prose is drawn as a plain string. A stored quote is a slice of
`block.text` (`Quote.text`, src/types.ts), and `block.text` is the block's text content with
whitespace collapsed: it holds a formula as its TeX source, `\(\frac{1}{\sqrt{d_k}}\)`, and has lost
every `<em>`. The prose draws the same block from `block.html`, with its maths turned into MathML at
ingress (docs/project/maths.md). [maths.md § What stays as source](../project/maths.md#what-stays-as-source)
already listed *"TeX in the side panels — quotes, ideas, glossary cards and search snippets"* as a
known gap; this closes it.

## The inventory (tree at `94042d91b`)

An Explore sweep of `src/web` found **33 places** that draw the article's own words outside the
prose, and **every one draws a plain string**. The only places that put article html on screen
outside the prose are the footnote card (`notes-view.ts` § `notePreviewHtml`) and the Lightbox,
which shows a figure, not words. Where each string comes from matters, because there are three
offset spaces:

- **S — a slice of `block.text`**: Quotes, Skim, FAQ, Claims, Criteria, Debate claims, Timeline
  occurrence quotes, citing words. Holds TeX source.
- **B — `block.text` itself, clipped**: the block-link card behind every chip, the in-article-link
  hover card, "where you left off", a chat's opening paragraph.
- **R/C — the text as drawn**: a reader's selection (comments, highlights, chat anchors), and the
  `Found.short`/`.long` snippets Ideas, Timeline and Search cut from `renderedText(block.html)`.
  A formula is already its symbols here (`dk`), so no TeX shows, but italics and sub/superscripts
  are lost and a formula reads as run-together letters.

## The design

**One function, one component, one lookup.**

- `src/web/excerpt-html.ts` § `excerptHtml(block, words)` → html or `null`.
  1. Find `words` in the block **before its maths was drawn** — the same forgiving finder the prose
     marks use (`quote-match.ts` § `findQuote`), no `near`, first occurrence, as `resolveQuotes`.
     If not found there, find them in the block **as drawn** (a selection or a snippet whose
     formulas are already symbols).
  2. Widen each end out of any formula it falls inside — a TeX span (`findMathSpans`) or an
     existing `<math>` — so a cut never shows half a formula or a stray `\(`.
  3. `Range.cloneContents()`, then keep only inline formatting (`em i strong b sub sup code kbd
     samp var s del ins u small q cite abbr dfn`), each **recreated bare**, plus `<math>` cloned
     whole. Links become their words (an excerpt usually sits inside a button that goes to the
     passage; a link inside a button is invalid and unclickable). Pictures, svg, scripts and form
     controls go. A nested block boundary becomes a space, as `extractText` does.
  4. Draw the TeX with **the renderer that drew the block's** (only for the first form), make every
     formula inline (MathML's `display` attribute and temml's `tml-display` class removed, so a row
     stays a row — CSS `display: inline` would take it out of MathML layout), and put the result
     **back through the article policy** (`sanitizeBlockHtml`), as maths.ts does with its own
     output.
- `excerptFallbackHtml(block, words)`: words the block cannot place (a quote from an older
  revision) are still drawn with their maths if the block's renderer is to hand; otherwise `null`
  and the caller's string is drawn as before.
- **Where the pre-maths html and the renderer come from**: the `RENDERED_MATHS` provenance symbol
  (maths-provenance.ts), which held `true`, now holds `{ html, render }` — the block's sanitised
  html before maths, and the renderer that drew it. `rendersMaths` still asks only `in`. It is a
  symbol, so it cannot arrive in JSON or authored html, and object spreads carry it (rehost).
- `src/web/Excerpt.tsx` § `<Excerpt blockId words />`: looks the block up in the reading view's
  existing index (`BlockLinkCard.tsx` § `useBlockLinks`, whose entries now carry `block`), strips a
  caller's leading/trailing `…` and puts it back outside, and draws the string unchanged outside
  the reading view, for an unknown block, or for words the block does not hold.

**Safety argument.** The input is html that already passed the article policy at ingress. Kept
elements are created new with no attributes, so nothing can carry an `id`, a `data-spya-*` block
id or an `href` out (docs/project/block-ids.md); kept `<math>` is one maths.ts already accepted
(its addressing attributes refused), or the article's own MathML, which the policy allows. Then the
same policy runs once more. No new allowance; one more consumer of the policy, which is what
security-map.md asks. It is parsed in an inert document, so nothing loads.

## Stages

1. **The renderer, and Skim** — built. Failing test first:
   `tests/skim-panel.test.tsx` § *draws a quote's maths as maths and keeps its italics* was red
   (`expected null not to be null` on the `<math>`), green after. `tests/excerpt-html.test.ts` pins the
   function; two of its cases were confirmed to fail by breaking the widening and the inline step.
2. **Every other site with a block id at hand** — `<Excerpt>` in place of the string:
   Quotes rows and highlight rows; Ideas evidence; Timeline occurrences; Search row and its card;
   Claims (claim, passages, other text in quotes), Criteria (result, placements), Mirror;
   Debate claim heads; FAQ passages; Marginalia FAQ, timeline and question notes; Glossary's asked
   quote; Citations' first-cited words; the in-article-link hover card; the block-link card behind
   every chip; Dock, comment, annotate and chat dialogs' quoted passage; Illustrated vignettes;
   "where you left off".
3. Docs: maths.md § What stays as source loses the side-panels line and gains a pointer here;
   quotes.md / skim.md get a line; the feedback note.

**Left as strings, on purpose** (each is a few words, or has no block to draw from):

- Timeline's dating phrase (a few words; its block is only reachable through occurrences).
- A chat thread's source tooltip (`ThreadSource` carries no block id).
- Diagram link evidence (the block id is not kept on `Related`).
- Library search snippets (other articles, server-cut, with their own `<strong>`).
- Anything copied to the clipboard (`CopyQuote`) stays plain text — that is what a paste wants.

## Options passed over

- **Render only the string's TeX** (find spans in `quote.text`, draw them). Simpler — no range
  cloning — and it fixes the report's exact case. Passed over because it cannot keep italics, bold
  or sub/superscripts, which Greg asked about, and it would be a second way of turning words into
  markup beside the block's own.
- **Store the formatting server-side** (an html slice on every quote). Every artefact type would
  need a migration and a backfill, and the browser already holds the block's html.
- **Keep links clickable.** Most excerpts sit in a button or a chip that goes to the passage, and
  nesting a link there is invalid HTML. The passage is one click away.
- **A CSS rule for displayed maths** (`display: inline`). maths.md records that taking a `<math>`
  out of `display: math` breaks its layout; changing the MathML attribute keeps MathML layout.

## Costs and risks

- Each drawn excerpt parses its block's html once (memoised per block and words). A Search list of
  a few hundred hits parses a few hundred paragraphs — milliseconds. If it shows, cache per block.
- A quote whose words appear twice in a block draws the first, which is what the prose mark does.
- Excerpts that sit inside elements with their own font rules keep them: the excerpt is a `<span>`.
- Peers in Skim (`fbud2w92`, the Skim-questions session) touch SkimPanel; this changes only the two
  lines that draw the words, plus a `blockId` on the row.

## Questions and assumptions (unattended run)

- **Assumed: links become plain words** inside excerpts (see above).
- **Assumed: displayed equations are drawn inline** inside excerpts.
