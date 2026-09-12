# Render LaTeX equations in the reading view

From Greg's feedback report SPIDERYARN-READING2-30, 2026-09-12 08:04Z, on an iPad in production,
reading an uploaded PDF (`entropy-24-00930`, Newman et al., *Revealing the Dynamics of Neural
Information Processing with Multivariate Information Decomposition*, Entropy 24(7) 930, 2022):

> Importing this file worked ok, but all the equations and formulae are being displayed as raw
> latex. Can we somehow render them them to display them nicely within the text?
>
> — Greg, 2026-09-12

Queue item `qi-2zzkstpv`. The note is
[260912_0804-equations-render-as-raw-latex.md](../user-feedback/260912_0804-equations-render-as-raw-latex.md).
The plan review is [260912d-plan-review-sol.md](260912d-plan-review-sol.md) (prompt:
[260912d-plan-review-prompt.md](260912d-plan-review-prompt.md)).

## What the reproduction found

**The same PDF, through the same prompt and the same model, did not reproduce the report — and that
is the finding.** The prompt at Greg's build (`607b57a0`) is byte-identical to HEAD's, and
`PDF_READER_MODEL` (`openai/gpt-5.6-luna`) is a constant with no environment override. Run through
`npm run eval:pdf-read` on 2026-09-12 (19 pages, 191 records, recall 0.993 over 17 pages):

- **no LaTeX at all** — zero `$`, `\(`, `\frac`, `\sum`, or any backslash command;
- instead the maths came out **flattened**: equation (1) as eight lines —
  `I(X;Y) := ∑` / `x∈X` / `y∈Y` / `P(x, y)log2` / `P(x|y)` / `P(x)` / `(1)` — and equation (4)'s
  `≠` as `6=`, the glyph pdf.js reads off the page. 24 of 105 blocks carry maths of this kind.

So there are **two failure modes, and the model chooses between them per run**:

1. It breaks prompt rule 8 (*"No HTML, no markdown, no LaTeX … Plain text only"*) and writes LaTeX —
   Greg's run. The reader sees `\frac{…}{…}`.
2. It obeys rule 8, and a fraction or a sum has no plain-text spelling, so it writes something that
   is neither the formula nor readable — my run. The reader sees `6=`.

Locally, all 189 PDF chunks in `checkpoints` hold no TeX command and no `$`, so (1) is the rare
case, and (2) is what a maths-bearing PDF usually gets. **Rule 8 asks for something that does not
exist**: there is no plain-text transcription of a displayed equation.

Production's copy of Greg's article could not be read from here (no production database access on
this box), so the delimiters the model used on his run are unknown — § What is not known.

## What this run builds, and what it defers

**Built: stage 1, the renderer.** Delimited TeX already in an article — Greg's, and any web page
whose MathJax source survives extraction — renders as maths.

**Deferred: stage 2, asking the transcriber for TeX.** It was in the first draft of this plan as a
one-rule prompt edit. GPT Sol's plan review refused it on an established P0 (F1): `pdf-score.ts`
classifies `\frac` and `\sum` as forbidden markup and `x_1` as an invented token, so a maths chunk
transcribed as TeX fails its content check, is **asked for a second paid time**, and is never
checkpointed — so re-runs pay again. Making the prompt change safe means making the scorer and the
dedup pass TeX-aware first (F1, F9), and rewriting rules 1–2 alongside rule 8, because rules are in
priority order and rule 1 demands exact printed notation (F7). That is a change to the paid path's
gates, not an afternoon's edit, so it is § Stage 2, deferred, below, with the review's findings as its
requirements. Sol: *"splitting it into a follow-up plan would also be defensible if Stage 1 needs to
move immediately."*

**What that leaves unfixed, said plainly:** a maths-bearing PDF imported today mostly gets failure
mode (2), which stage 1 cannot render — there is no TeX in it to render.

## Stage 1 — render delimited TeX at ingress, in the browser

A new module, `src/web/maths.ts`, runs once when an article arrives — in `resolveAccess`
(`src/web/article/access.ts`), **after** `sanitizeArticle` and before `rehostImages`, the same doorway
and the same shape as `rehostBlockHtml`:

```
  block.html (stored, untouched)
      │
      ▼  sanitizeArticle            the policy + new-tab links, as now
      ▼  renderArticleMaths         NEW — only blocks with a delimited span that renders
      │     ├─ find spans in text nodes (skip code, pre, kbd, samp, math, svg, script, style, textarea)
      │     ├─ temml.renderToString(tex, bounded options)          F5
      │     ├─ a span that throws, is over-long, or whose fragment
      │     │    carries id / name / href / xlink:href → stays source text     F6
      │     └─ sanitizeBlockHtml, then openExternalLinksInNewTab, on the changed blocks   F3
      ▼  rehostImages               as now; it and its fallback get the SAME rendered article   F10
      ▼  renderedText / annotateHtml / React   — all see the same, rendered, html
```

**Delimiters**: `\[…\]` and `$$…$$` display; `\(…\)` inline; and `$…$` inline **only with a strong
TeX signal** — a backslash command, a brace, `^` or `_` — on top of pandoc's rules (opening `$`
followed by a non-space, closing `$` preceded by a non-space and not followed by a digit; `\$` is
never a delimiter). So *"$5 and $10"*, *"Set $x=$y"* and *"$PATH/$HOME"* stay prose (F8), and a bare
`$x$` is deliberately missed. Every span must then parse in temml, with `throwOnError: true` and
`trust: false`: `\href`, `\style`, `\class`, `\id` and unknown commands throw and stay as source.

**Bounded** (F5): temml's `maxSize` defaults to infinity, and `\rule{1000000em}{1000000em}` becomes a
million-em box the sanitiser lets through. So `maxSize` and `maxExpand` are set, and a span longer
than a source-length ceiling is left alone. The limits are named constants in `maths.ts`, chosen
against the equations of real papers.

**No id, no link** (F6): `\label` is not trust-gated, and with `\tag` it emits an HTML `id` —
`x\label{spya-aaaaaa}\tag{1}` survives the sanitiser as `<mtr id="spya-aaaaaa">`, which would forge
a block id. `\ref`/`\eqref` emit anchors. A fragment carrying `id`, `name`, `href` or `xlink:href` is
therefore not inserted; its span stays as source. Cross-references between separately-rendered spans
could not work anyway.

**Nothing is downloaded for an article without maths.** The span scan is plain string work; temml —
its JS, `Temml-Local.css` and its local script font — is a dynamic `import()` taken only when the
scan finds a span.

**Why MathML (temml), not KaTeX or MathJax.** MathML is laid out natively by Safari — Greg's iPad —
Chrome (109+) and Firefox, so temml needs only a small stylesheet and one ~10 KB font (F4: the
stylesheet is required, not optional — it sets `display: block` on display maths for Safari and
Firefox, and carries WebKit corrections for fractions, accents and scripts; the policy strips temml's
inline `style`, so the stylesheet is what does that job). The lazy payload is about 116 KB gzipped JS
before minification, ~3 KB CSS and the font. KaTeX's HTML output needs its stylesheet and ~20 font
files; MathJax is several times larger again. And MathML is content the sanitiser already keeps on
purpose — `src/sanitize-policy.ts` § *The default profile keeps SVG and MathML* (Greg's call,
2026-08-25) — so the output passes through the policy **we already have**. The spikes: temml's output
survives `sanitizeHtml` with only `form` and `style` attributes stripped, and a second pass is a
no-op.

**Re-sanitising is the security argument, not decoration.** The new markup is written after the pass
the reading view relies on, so it goes through the same policy again before anything parses it.
Nothing is allowed that was not already allowed; this edits no defence in
[security-map.md](../project/security-map.md) — it adds a consumer of one. The spikes ran under
jsdom's parser, and parser disagreement is the mXSS mechanism, so the stage's browser check puts the
hostile outputs through a real browser engine as well (F11).

**Block ids are untouched.** Only text nodes inside a block's html are replaced; the stored html,
`block.text` and the `data-spya-*` ids are never written, and F6 stops a formula minting one. The
render is recomputed on every load, so it can be changed or removed with no migration.

**The offset space comments are anchored in** (`src/web/annotate.ts` § *Why the offsets are DOM
offsets*). `renderedText`, `annotateHtml` and the live DOM all read the rendered html, so they still
agree with each other — the reason for doing this at ingress and not in a `useEffect` over the
painted prose. What changes, **in a block that renders maths**:

- a comment made before this whose quote included TeX source no longer resolves and draws no mark
  (it stays in the Dock's list) — `resolveMark` returning `null`, the designed failure;
- **an offset recorded before the render no longer means the same place** (F2), because a formula's
  source and its symbols differ in length, so it can no longer choose between two occurrences of the
  same quote. In a rendered-maths block the offset is not trusted: one occurrence resolves, two or
  more draw no mark. A mark disappears rather than moving to the wrong words;
- a search hit or a quote whose model-quoted words include TeX from `block.text` does not resolve.

All confined to blocks that render maths.

**`annotateHtml` already handles `<math>`**: it counts text inside foreign content and never wraps
it, so a mark can span an equation without putting a `<mark>` inside MathML.

**Styling**: display maths scrolls sideways within `.prose` rather than widening the page at phone
width ([narrow-windows.md](../project/narrow-windows.md)), like `.prose pre` and `.prose table`.

## Stage 2, deferred — ask the transcriber for TeX

Worth doing, because failure mode (2) is the common one. Its requirements, from the review:

- **F1** — the PDF checks become TeX-aware *before* the prompt changes: recognised, balanced `\(…\)`
  and `\[…\]` spans get a comparison form that removes control words and structural syntax while
  keeping operands, `\text{…}` prose and printed numbers; the forbidden-markup check runs on the text
  outside them. Not landed until a maths chunk passes on its first attempt, is checkpointed, and is
  reused without another call.
- **F9** — the same comparison form in `withoutRepeats` and `wordsOf`, or a context-page equation
  re-emitted under the next page's number escapes duplicate suppression.
- **F7** — rules 1, 2 and 8 rewritten together; the delimiters doubled in the template literal, with a
  runtime assertion against `SYSTEM`.
- Measured on this paper against the baseline above (per-page recall 0.915–1.0; page 8 lowest).

When it lands, re-importing a maths-bearing PDF gives maths stage 1 renders.

## The options passed over, and why

- **The simplest: stage 1 alone** — what this run ships, after the review showed stage 2 costs more
  than its first draft admitted.
- **Only a prompt change, rendering nothing** — telling the model to write Unicode maths. It already
  does where it can (equations (5)–(8) came back readable); it cannot write a fraction or a stacked
  sum, which is exactly where it produced eight lines.
- **Convert at extraction, storing MathML in `article.html`.** Every consumer would see the same
  thing. Passed over: stage 3 recovers a block's id by its tag and text, so changing stored text on a
  re-extraction risks re-minting ids; it could not reach Greg's already-stored article without a
  re-extraction; and it moves a third-party parser's output into the pipeline, where the render-time
  version keeps it in one browser-side module that can be deleted.
- **KaTeX / MathJax** — above, under *Why MathML*.
- **Render every article as a maths document** (MathJax over the whole page): the delimiter rules and
  the lazy import are exactly what stop a price or a shell variable turning into italic letters.

**The trade-off Greg is deciding rather than inheriting**: a new dependency — `temml`, MIT, one
maintainer, loaded only for articles with maths — on the render path of every article that has any.
Reversible by deleting one module; it touches no stored data.

## What is not known

**The delimiters on Greg's own production copy.** If the model wrote `\(…\)`, `\[…\]`, `$$…$$`, or
`$…$` with a TeX signal inside, stage 1 renders it on his next load after deploy. If it wrote **bare**
TeX with no delimiters (`I(X;Y) := \sum_{x} …`), or `$x$` with nothing TeX-like inside, stage 1 leaves
it — recognising undelimited TeX in prose is guessing, and a wrong guess renders a sentence as italic
letters. The fix for his article is then a re-import after stage 2.

## Deferred

- Stage 2, above.
- Undelimited TeX, and bare `$x$` — only with a real specimen in hand.
- Maths in the side panels (quotes, ideas, glossary cards, search snippets), which show
  model-written or `block.text` strings rather than block html, and so still show TeX.
- Normalising `block.text` against the rendered text so search hits, quotes and ambiguous comment
  anchors resolve inside maths blocks.
- Re-extracting maths-bearing PDFs already on the shelf.

## Stage 1, done means

`src/web/maths.ts` + `tests/maths.test.ts` (delimiter rules red-first, including the F8 negatives;
the sanitiser round-trip and the new-tab links kept, F3; `data-spya-*` untouched and F6's `\label`
rejected; F5's huge `\rule` rejected; code/pre untouched; temml never loaded when nothing matched;
F2's two-identical-phrases regression; F10's fallback); wired in `access.ts`; the CSS; a browser
check of a maths block — and of F11's hostile outputs — on the local dev server; the doc line.
GPT Sol code review. `npm test`, `npm run typecheck`. Then the note, `overseer-queue done`, push.

## Log

- 2026-09-12 — reproduced (above); spike of temml through `sanitizeHtml`; plan written.
- 2026-09-12 — second spike, display mode and hostile input, temml 0.13.5 through `sanitizeHtml`:
  display output is `<math display="block" class="tml-display" style="display:block math;">` and the
  policy strips the `style`; `\color{red}` emits a `style` the policy strips; `\style`, `\class`,
  `\id` and `\data` throw (*"not trusted"*); `\text{<img src=x onerror=…>}` arrives as escaped text
  inside `<mtext>`; `aligned` arrives as `<mtable>`; and a second `sanitizeHtml` over every output is
  a no-op. The client's other readers of `block.html` — `graph.ts`, `search-hits.ts`,
  `notes-view.ts`, `PdfFigureNote.tsx`, `TableView.tsx` — all take blocks from article state, which
  is downstream of `resolveAccess`. (The first draft of this entry also said the stripped `style` was
  the browser's default anyway; F4 showed that is false in Safari and Firefox.)
- 2026-09-12 — GPT Sol's plan review: refused on F1 (P0, established). Stage 2 deferred with F1, F7,
  F9 as its requirements; F2–F6, F8, F10, F11 folded into stage 1. No finding overruled.
