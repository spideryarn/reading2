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

Status: **built** — the renderer, Skim, and 31 more sites, with GPT Sol's plan review folded in
(§ Plan review). Code review: § Code review.

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

- `src/web/excerpt-html.ts` § `excerptHtml(block, words, { near? })` → html or `null`, cached per
  block (a `WeakMap`), so a list re-rendering draws nothing twice.
  1. Find `words` in the block **before its maths was drawn** — the same forgiving finder the prose
     marks use (`quote-match.ts` § `findQuote`), first occurrence, as `resolveQuotes`. If not found
     there, find them in the block **as drawn** (a selection or a snippet whose formulas are already
     symbols). A caller that knows where its words sit in the drawn text — a `Found.start`, a
     comment's anchor — passes `near`, which goes straight to the drawn form and chooses between
     repeats. Text inside a dropped element (a diagram's labels) is not matched against.
  2. Widen each end out of any formula it falls inside — a TeX span (`findMathSpans`) or an
     existing `<math>` — so a cut never shows half a formula or a stray `\(`.
  3. `Range.cloneContents()`, then keep only inline formatting (`em i strong b sub sup code kbd
     samp var s del ins u small cite abbr dfn`), each **recreated bare**, plus `<math>` copied
     whole but with every `id`, `name`, `href`, `xlink:href`, `tabindex`, `data-*` taken off and
     any HTML inside it reduced to words. The inline elements the range sits wholly inside are put
     back around it (`cloneContents` leaves them out). Links and `<q>` become their words (an
     excerpt usually sits inside a button that goes to the passage, and its caller already quotes
     it). Pictures, svg, scripts and form controls go. A nested block boundary becomes a space, as
     `extractText` does.
  4. Draw the TeX with **the renderer that drew the block's** (only for the first form), make every
     formula inline (MathML's `display` attribute and temml's `tml-display` class removed, so a row
     stays a row — CSS `display: inline` would take it out of MathML layout), and put the result
     **back through the article policy** (`sanitizeBlockHtml`), as maths.ts does with its own
     output.
- `excerptFallbackHtml(block, words)`: words the block cannot place (a quote from an older
  revision) are still drawn with their maths if the block's renderer is to hand — except in a code
  block, where `\(…\)` is code; otherwise `null` and the caller's string is drawn as before.
- **Where the pre-maths html and the renderer come from**: the `RENDERED_MATHS` provenance symbol
  (maths-provenance.ts), which held `true`, now holds `{ html, render }` — the block's sanitised
  html before maths, and the renderer that drew it. `rendersMaths` still asks only `in`. It is a
  symbol, so it cannot arrive in JSON or authored html, and object spreads carry it (rehost).
- `src/web/Excerpt.tsx` § `<Excerpt blockId words near? />`: looks the block up in the reading
  view's existing index (`block-link-index.ts` § `useBlockLinks`, whose entries now carry `block`;
  the context moved out of BlockLinkCard.tsx so the card can draw an excerpt without an import
  cycle), strips a caller's leading/trailing `…` and puts it back outside, and draws the string
  unchanged outside the reading view, for an unknown block, or for words the block does not hold.
  `<BlockExcerpt block words />` is the same for a caller holding the block: the block-link card,
  and the info page, which is outside the index.

**Safety argument.** The input is html that already passed the article policy at ingress. Kept
elements are created new with no attributes, so nothing can carry an `id`, a `data-spya-*` block
id or an `href` out (docs/project/block-ids.md); kept `<math>` has its addressing attributes and
every `data-*` stripped, whether temml drew it or the article carried it (Sol found the second
carried all four through). Then the same policy runs once more. No new allowance; one more consumer of the policy, which is what
security-map.md asks. It is parsed in an inert document, so nothing loads.

## Stages

1. **The renderer, and Skim** — built. Failing test first:
   `tests/skim-panel.test.tsx` § *draws a quote's maths as maths and keeps its italics* was red
   (`expected null not to be null` on the `<math>`), green after. `tests/excerpt-html.test.ts` pins the
   function; two of its cases were confirmed to fail by breaking the widening and the inline step.
2. **Every other site with a block id at hand** — built, `<Excerpt>` in place of the string:
   Quotes rows and highlight rows; Ideas evidence; Timeline occurrences; Search row and its card;
   Claims (claim, passages, other text in quotes), Criteria (result, placements), Mirror;
   Debate claim heads; FAQ passages; Marginalia FAQ, timeline and asked-question notes (the block
   id is now passed to `MarginNotesSlot`; the structural question note is a model's words and stays
   a string); Glossary's asked
   quote; Citations' first-cited words; the in-article-link hover card; the block-link card behind
   every chip; Dock, comment, annotate and chat dialogs' quoted passage; Illustrated vignettes;
   "where you left off".
3. Docs: maths.md § Excerpts outside the prose (and § What stays as source loses the side-panels
   line); web-client.md § Shared code (client) names `Excerpt`; the feedback note.

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

- One excerpt parses its block's html about four times (cut, finish, the policy, React's sink). Sol
  measured ~1.7 s for 300 ordinary excerpts in jsdom — not a browser, but enough to stop calling it
  "milliseconds". Results are now cached per block across rows and renders; a Search list still pays
  once per hit on first draw.
- **Measured.** The browser check (Vite dev, headless Chrome, a box busy with other agents' tests)
  searched BERT for "the": 588 hits, 99 of them with maths, and main-thread long tasks of 1–3 s
  while the list drew. There is no baseline with the old code, so how much of that is this change
  is not known. Each block is now **parsed once** and its finder built once, however many excerpts
  are cut from it, and an excerpt that is only words skips the policy pass (it was serialised from
  text nodes, so it is already escaped). In jsdom, 600 excerpts from 60 blocks went from 765 ms to
  197 ms. Not re-measured in Chrome; if a common-word Search still stalls, the next step is drawing
  excerpts only for rows on screen.
- A stored quote whose words appear twice in a block draws the first, which is what the prose mark
  does; a hit, an idea, a timeline occurrence and a comment draw the one they were placed at.
- Excerpts that sit inside elements with their own font rules keep them: the excerpt is a `<span>`.
- Peers in Skim (`fbud2w92`, the Skim-questions session) touch SkimPanel; this changes only the two
  lines that draw the words, plus a `blockId` on the row.

## Browser check

A Sonnet subagent, Playwright on the box, the local database, BERT (`arxiv-1810-spya-e24vmj`, 35
blocks with TeX, 39 quotes of which 10 carry maths; a Skim route planned for it through the UI):

- **Quotes**: 39 excerpts, 10 with `<math>`; italic *i*-th and *C*, BERT<sub>BASE</sub> drawn as in
  the prose. **Skim**: the cut row with maths and its hover card both draw it (2 → 4 `<math>` on
  hover). Zero `\(` anywhere on the page in either mode.
- **Block-link card**: a chip's card drew its paragraph with 2 `<math>`; another kept `<em>`/`<sub>`.
- `.excerpt [id], .excerpt [href], .excerpt [data-spya-id]`: 0 in Quotes, Skim, the Skim card and a
  588-hit Search. No console errors in Chrome or WebKit.
- Not checked: the current Skim stop's row (stop 1 had no maths).
- Shots: [quotes and a card](261009k-shot-1-quotes-maths-and-block-link-card.png),
  [skim and its card](261009k-shot-2-skim-maths-and-tooltip.png),
  [iPhone quotes](261009k-shot-3-iphone-quotes-maths.png).

## Plan review

GPT Sol, read-only — [261009k-…-plan-review-sol.md](261009k-excerpts-keep-maths-and-formatting-plan-review-sol.md),
verdict *proceed with changes*. All nine taken:

| | Finding | What changed |
|---|---|---|
| F1 | an excerpt wholly inside one `<em>` came out plain | `withAncestors` puts the enclosing inline elements back; test |
| F2 | the article's own MathML carried `id`, `href`, `name`, `data-spya-*` through | `inertMath` strips them, HTML inside reduced to words; test with Sol's payload |
| F3 | first occurrence imposed on callers that know their position | `near`, passed by Ideas, Timeline, Search, Quotes' highlight rows, Marginalia, annotate and chat dialogs; test |
| F4 | the info page is outside the index, so it drew raw TeX | `BlockExcerpt` takes the block; Metadata and the block-link card use it, which also removed the card's hand copy |
| F5 | matched text a dropped `<svg>` then removed | dropped elements' text is not matched; test |
| F6 | the cost was understated, and `useMemo` shares nothing between rows | per-block `WeakMap` cache; the number above |
| F7 | a kept `<q>` doubles the caller's quotation marks | `<q>` unwrapped; test |
| F8 | Marginalia FAQ and Timeline notes had no block id | passed down from Reader to `MarginNotesSlot` |
| F9 | the fallback could turn a stale code quote's `\(…\)` into maths | no maths fallback for a code block; test |

**A cost this adds, named.** Twelve node-environment test files (`quotes-panel`, `quotes-step`,
`glossary`, `block-ref`, `chat`, `command-match-mode-aliases`, `command-pick-catalogue`, `diagram`,
`dock-mode-order`, `dock-mode-urls`, `prioritised-defaults`, `tweets-page`) import a component whose
graph now reaches `Excerpt` → `excerpt-html.ts` → the sanitiser, which builds DOMPurify on `window`
when it loads; they run under jsdom now. A future node test importing a panel will fail loudly
(`window is not defined`), not silently. The alternatives were weighed and passed over: making
`src/web/sanitize.ts` build its DOMPurify lazily is a change to a defence (security-map.md), left for
Greg; reaching the sanitiser by dynamic import makes an excerpt's first draw race the import; and
dropping the final policy pass would remove the second line the safety argument rests on.
maths-provenance.ts was split out on 2026-09-12 for this same reason, for a module (`search-hits.ts`)
that is pure; a React panel already needs a DOM to be drawn.

## Code review

GPT Sol, fixing inside the stage —
[261009k-…-code-review-sol.md](261009k-excerpts-keep-maths-and-formatting-code-review-sol.md),
verdict *ship after my fixes*. What it changed, each read and kept:

- `Found.start` is the match, not the snippet's start, so a repeated passage could take the wrong
  occurrence's formatting. `quote-match.ts` § `snippetAt` returns the snippet's offset too
  (`snippet` is unchanged for the server), and `Found` carries `shortStart`/`longStart`, which
  Search, Ideas and Timeline pass as `near`.
- The comment dialog and the Dock pass their anchor's `start`.
- `near` is translated past dropped elements' text (`textProjection`), rather than "close enough".
- The result cache checks the block's html, source and renderer, not only the block's identity.
- More attributes come off kept MathML: every ARIA and HTML id-reference (`aria-labelledby`, `for`,
  `headers`, …), with a hostile-MathML test.
- It agreed with the twelve suites moving to jsdom, and found the text-only `finish` shortcut sound
  (now pinned by a test).

After it: `npm run typecheck` clean; the full `npm test` 1,900 files passed, the one failure the
three screenshots here being uncompressed, since compressed.

## Questions and assumptions (unattended run)

- **Assumed: links become plain words** inside excerpts (see above).
- **Assumed: displayed equations are drawn inline** inside excerpts.
