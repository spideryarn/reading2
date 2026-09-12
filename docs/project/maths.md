# Maths — TeX in the prose, drawn as maths

Part of [reading-view-overview.md](reading-view-overview.md).

> Importing this file worked ok, but all the equations and formulae are being displayed as raw
> latex. Can we somehow render them them to display them nicely within the text?
>
> — Greg, 2026-09-12 (SPIDERYARN-READING2-30)

**Delimited TeX already in an article is drawn as MathML, in the browser, as the article arrives.**
Nothing stored changes: the render is recomputed on every load, so it can be altered or deleted with
no migration. The reasoning, the options passed over and GPT Sol's review are in
[260912d-render-latex-equations-in-the-reading-view.md](../plans/260912d-render-latex-equations-in-the-reading-view.md);
the code is `src/web/maths.ts`, and its header is the detail behind every line below.

## What counts as maths

- `\(…\)` inline; `\[…\]` and `$$…$$` displayed.
- `$…$` inline, **only** when pandoc's rules hold *and* the inside is unmistakably TeX — a
  backslash command, a brace, `^` or `_`. So *"$5 and $10"*, *"Set $x=$y"* and *"$PATH/$HOME"* stay
  prose. The price of that is a bare `$x$`, which is missed on purpose.
- Never inside `code`, `pre`, `kbd`, `samp`, an existing `<math>`, or an `<svg>`. `\$` is never a
  delimiter; an unclosed or empty span is prose.

`src/maths-tex.ts` § `findMathSpans` is the rule, shared by the reading view and the server, and
`tests/maths.test.ts` holds every negative case it was written against.

## What stays as source

- **A span temml refuses** — it will not parse, or it asks for something `trust: false` forbids
  (`\href`, `\url`, `\style`, `\class`, `\id`, `\data`).
- **A span that would address something** — `\label` with `\tag` writes an HTML `id` that could
  collide with a block id ([block-ids.md](block-ids.md)), and `\ref`/`\eqref` write a link. Any
  formula carrying `id`, `name`, `href` or `xlink:href` is refused whole. Cross-references between
  separately drawn formulas could not work anyway.
- **A span over the size limits** — see below.
- **Undelimited TeX**, and **TeX in the side panels** — quotes, ideas, glossary cards and search
  snippets show `block.text` or model-written strings, not block html.

**Most maths-bearing PDFs imported today have no TeX to draw.** The transcriber mostly flattens an
equation into lines of symbols rather than writing TeX; asking it for TeX is the plan's deferred
stage 2, which has to make the PDF checks TeX-aware first.

## Where it sits

In `src/web/article/access.ts` § `resolveAccess`: after the sanitiser, before the pictures are
rehosted, and one object carries on to both draws and to their fallback.

```
sanitizeArticle  →  renderArticleMaths  →  rehostImages  →  renderedText / annotateHtml / React
```

At ingress rather than over the painted prose because the offset space comments are anchored in is
the rendered html, and every reader of it has to see the same html
([comments.md](comments.md), `src/web/annotate.ts` § `renderedText`). **Each changed block goes back
through the same sanitiser policy**, then gets its new-tab links back — MathML was already allowed,
so this adds a consumer of the policy rather than an exception to it
([security-map.md](security-map.md)).

temml, its stylesheet and its one small font are a lazy chunk, fetched only when a block has a span.
A load that fails leaves the TeX exactly as it was. The stylesheet is needed, not decorative: it is
what lays display maths out as a block in Safari and Firefox. Display maths scrolls sideways inside
its own box at phone width, like a code block ([narrow-windows.md](narrow-windows.md)).

**Known: a very long *inline* formula can be a little wider than a phone-width column.** Measured at
400px, a 60-character inline sum ran 20px past its paragraph. There is no clean fix yet. Chromium and
Safari do not break MathML across lines — temml's own `wrap` option says in its source that its soft
breaks work only in Firefox — and giving inline maths `inline-block` to make it scroll takes it out
of MathML layout. Display maths, where long formulas usually are, is not affected.

## The limits on one formula

A source-length ceiling, a largest dimension and a macro-expansion budget, each a named constant with
its measurement beside it: `src/maths-tex.ts` § `MAX_TEX_CHARS`, `MAX_SIZE_EM`, `MAX_EXPAND`. temml
**clamps** an over-large dimension rather than refusing it, so `\rule{1000000em}{1000000em}` draws a
box the ceiling's size, not the source.

## What it means for a comment in that paragraph

**A selection across a formula saves** — as a comment and as a chat's anchor. The reader selects the
formula's symbols while `block.text` holds its TeX, so both server checks accept a quote found in
either form: the stored text first, unchanged for every block without a span, and only then the text
with its maths drawn. The server parses `block.html` and walks the same eligible text nodes as the
browser, then applies the shared span finder, renderer and acceptance rule to each one
(`src/quote-in-block.ts` § `placeQuoteInBlock`, `src/maths-tex.ts` § `renderedMathsText`). This is
per node deliberately: a complete formula may render while another whose delimiters straddle
`<em>` stays source, and the mixed selection still saves. `tests/maths-parity.test.ts` proves the
server's reading of a rendered formula equals the browser's, character for character. temml is
loaded on the server only when that second form is needed, so it is not on the API's cold start.

What still costs something, because a formula's symbols are shorter than its source and everything
after it in the paragraph moves. In a block that had maths drawn into it
(`src/web/maths-provenance.ts` § `rendersMaths` — a mark of its own, so reading it does not load the
renderer or the sanitiser):

- a comment whose words occur **twice** in the paragraph draws no mark, because its recorded offset
  can no longer choose between them (`src/web/annotate.ts` § `resolveMark`, `offsetTrusted`);
- a model-backed search, idea, timeline or referee passage whose words occur **twice** falls back to
  its whole block for the same reason. A unique occurrence is still marked exactly. Generated Quotes
  carry no source offset and retain their existing first-occurrence rule;
- a comment made before maths was drawn, whose words **included TeX source**, draws no mark, and so
  does a search hit or a quote whose model-quoted words include TeX from `block.text`.

Glossary terms and literal search do not need this fallback: their offsets are found directly in the
rendered text. In every ambiguous case a mark disappears or covers its block rather than landing on
the wrong words, and the item stays in its panel. Only blocks that this render pass itself changed
are affected; provenance is an internal symbol on the block, not a class the article can forge.
