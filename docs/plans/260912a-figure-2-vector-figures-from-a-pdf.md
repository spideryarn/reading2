# Figure 2 did not display: a PDF figure drawn rather than pictured

**[SPIDERYARN-READING2-31](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-31)** ·
reported 2026-09-12 08:05 UTC · kind: problem · from an admin (Greg) · on an iPad, build `607b57a0`

> Why didn't the image for Figure 2 display correctly?

Slug `entropy-24-00930-spya-bmvfyb`, block `spya-d8tgkx`. The paper is MDPI *Entropy* 2022, 24, 930;
the slug is the PDF's own filename.

**Status: plan, before review.** Nothing built yet.

## The answer to the question

**Figure 2 is drawn, not pictured.** Page 8 of the PDF carries no bitmap at all: the two lattices
are 58 vector path operations with their labels set as text. The PDF-figure route
([260906a](260906a-figures-from-a-pdf-are-placeholders-with-no-image.md)) recovers only *embedded
bitmaps*, so a figure whose page has none is recorded `no-raster`, and the reader gets the caption, a
muted *"We couldn't recover this figure from the PDF."* and *View the original*. Figures 1, 3 and 4
are each one bitmap on a page of their own, which is why they came through.

- **Not cluster F.** The `srcset` candidate change
  ([260911a](260911a-figures-with-enough-resolution-to-read.md)) is about a web article's `<img>`;
  this article is a PDF and has no `<img>` anywhere.
- **Not a regression.** 260906a named it at the time: *"a document whose figures are vector drawings
  gets nothing from this route — which is the honest limit of it"*. No commit introduced a fault. The
  note under the figure deliberately names no cause (`src/web/PdfFigureNote.tsx` header explains
  why), which is exactly why the report is a *why*.

So there is no postmortem: there is no defect to root-cause, only a limit that turned out to matter.

## Reproduced, not reasoned

This session has no production access — no database credential, no Vercel or Sentry sign-in — so the
same document was ingested locally instead: `pub.mdpi-res.com/…/entropy-24-00930.pdf`, 2,138,371
bytes, through `npx tsx scripts/stage.ts ingest <file>` against the local Postgres.

| | |
|---|---|
| assets step log | `figures: 4, figuresStored: 3` |
| page-8 manifest entry | `{"status":"failed","reason":"no-raster","page":8}` |
| the block's caption | `<figcaption>Figure 2. Partial information lattices. On the left is …` |
| pdf.js operator list, p5 / p9 / p10 | one `paintImageXObject` each |
| pdf.js operator list, p8 | **zero** image operations, 58 `constructPath` |

*Assumption, unverified:* production holds the same PDF. The slug is its filename and the figure
count matches the report; nothing here read production.

**It is not rare.** The same operator survey over the committed eval PDFs:
`evals/pdf/titles/arxiv-arnn-eeg-stamp` has its figures on p2 and p3 with **zero** images and 553 and
458 paths. A LaTeX paper with matplotlib or TikZ figures — a large share of what gets uploaded —
produces exactly this. The ball-lightning paper's four figures are all bitmaps.

## The fix

**A second route for a figure whose page offered no usable bitmap: find where the figure sits on the
page, render that rectangle, and store the pixels as a PNG exactly as the bitmap route stores its
own.** Everything downstream is unchanged — a `stored` manifest entry, `GET /api/asset/…` and its
public twin, `rehost.ts`, the lightbox, the page link.

### Rendering it: PDFium, compiled to WebAssembly

pdf.js cannot render on the server without a canvas, and `@napi-rs/canvas` is 34 MB of Vercel bundle
and banned by name in `tests/pdf-bundle-trace.test.ts`. PDFium — Chrome's own PDF engine — compiled
to WASM needs no native addon at all.

**Spike, 2026-09-12**, `@embedpdf/pdfium` 2.15.0 in plain Node on the box:

| | |
|---|---|
| the result | page 8 correct — both lattices, every brace label crisp; page 5's bitmap figure correct too |
| `pdfium.wasm` | 4.63 MB, 2.14 MB gzipped; package 7.3 MB on disk |
| cold init | ~80 ms |
| render one A4 page at 2× | ~120 ms |
| memory | ~+70 MB RSS per full page rendered, and a WASM heap never shrinks — so render **only the clipped region**, never the page |
| native addon / network | none / none (a throwing `fetch` did not stop it) |
| how it finds the wasm | pass the bytes in (`init({ wasmBinary })`); its own default reads a path next to its module, which a bundler can break |
| licence | MIT wrapper; PDFium BSD-3 |

**This is a new dependency, named here so Greg decides it rather than inherits it.** It is a library
in the sense `pdf-lib` is, not a framework, so it is not a third exception to *prefer boring*
([vision.md § Principles](../project/vision.md#principles)) — but it is 4.6 MB added to the API
function, and it is the first thing on the server that *renders* a stranger's document (§ Security).

### Finding the rectangle: the band above the caption

A pure function over what pdf.js already hands back for a page — the box of every path and image in
page coordinates (each `constructPath`'s own `minMax` carried through the current transform), and the
text lines — so no rendering is needed to decide *where*:

1. **Find the caption on the page**: the first text line whose normalised text starts with the
   normalised opening of the block's own `<figcaption>`. Not found → refuse.
2. **The ceiling**: the lowest line *above* the caption, overlapping its column, that is prose (≥ 8
   words and ≥ 30% of the page width) or another caption (`Figure|Fig.|Table N`); failing that, the
   top of the body, with the running header and footer excluded.
3. **The region**: the union of the ink in that band that overlaps the caption's column, then the
   text lines in the band that touch it (the labels).
4. **Trim page furniture**: a running header's rule sits inside the band on MDPI pages (y = 771 on
   p8) and must not stretch the region to the page's edges.

Refused, and left caption-only as today, when: the caption is not on the page; the band holds no ink;
the region is below a size floor; or two captions' regions overlap.

**Prototyped on three real figures and every crop checked by eye**: MDPI p8 Figure 2 (both lattices,
once the band replaced a first draft that grew by proximity and lost the left lattice), arXiv p2
Figure 1 (a 338 × 224 pt architecture diagram) and arXiv p3 Figure 2 (a 520 × 182 pt, three-panel
figure with its (a)/(b)/(c) labels).

**Why this does not break Fable's rule** — *a picture under the wrong caption is a fabricated claim
about the paper*. The region is derived from this caption's own position on its own page and bounded
above by prose; it can reach another figure only if two figures share a band, and that case is
refused. The bitmap route's *one marker, one raster* gate is untouched.

**Which markers take this route**: every marker on a page with **zero usable rasters** — today's
`no-raster`, and `ambiguous` where the page's ambiguity is several captions and no bitmap, since each
caption finds its own band. A page with a bitmap keeps today's route exactly.

**The caption text has to reach the step.** A marker carries a ref, a page and an ordinal and not
the caption (`pdfFigureMarkersIn` says so on purpose). A server-side helper beside it reads each
marker's `<figcaption>` text by ref; `PdfFigureMarker` itself, which the browser shares, is unchanged.

### The rest of the shape

- **Scale**: the longest side at most `MAX_FIGURE_EDGE` (1600 px) and at most 3× (216 dpi), rendered
  onto white, stored as RGB through the existing `encodeFigurePng` and `storeOne` — the same bytes,
  size caps, article budget and clock as a recovered bitmap.
- **A complexity guard before PDFium is called.** pdf.js has already built the page's operator list,
  so a page with an absurd number of operations is refused before a synchronous render that nothing
  can interrupt is started.
- **Two new failure words** in `PdfFigureFailure` (src/assets.ts, and the mapping in
  src/collect-pdf-figures.ts): `not-located` — no bitmap, and no drawing we could place — and
  `render-failed` — PDFium refused, threw, or the page was too heavy to try. The reader's note is the
  same for every failure, so neither changes a word they see; they exist so the next person can
  measure the route rather than find it hiding under `no-raster`.
- **Freshness.** `assetsInputHash` does not change, so no existing article re-runs. Greg's article
  gets its figure only when its `assets` step runs again: after a deploy,
  `npx tsx scripts/stage.ts assets entropy-24-00930-spya-bmvfyb --force` against production. That is
  a production write, so it is Greg's to run. `ASSETS_VERSION` is not bumped: nothing re-runs a stale
  manifest on its own anyway ([cron-scheduler.md](../project/cron-scheduler.md)).

### Security

[security.md](../project/security.md) § the PDF says what protects us from a stranger's PDF is that
the two parsers are *"never asked for anything but text, coordinates and bytes: we never render"*.
**This makes that sentence false**, and the doc will say so rather than keep it.

What bounds the new exposure: PDFium runs as WASM, so a memory-safety bug corrupts its own linear
memory and reaches nothing it was not handed (to be checked: that the Node build is given no
filesystem); it runs only on pages that already passed the page cap and carry a figure marker, and
only when that page has no bitmap; the complexity guard above bounds the one step that cannot be
interrupted. None of the files in
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
is edited. Flagged to Greg all the same, because it changes a stated protection.

## The simpler options passed over

1. **Say why, and do not show it.** Tell the reader of a bitmapless page that the figure is drawn and
   cannot be copied out yet. An afternoon, and it answers *why* — but the question was why it did not
   *display*, and the spike showed that displaying it costs one dependency and about a day. The note
   stays as the fallback wherever the new route refuses.
2. **Render in the reader's browser with pdf.js.** Owner-only, because `/api/source` is owner-only
   and a visitor would get nothing; a 2 MB PDF and ~1.5 MB of pdf.js per reader; the work redone on
   every read. 260906a turned the same route down for the same reasons.
3. **Render the whole page, not a rectangle.** No locating at all — and a page of prose stapled under
   the caption, which is the thing 260906a's scanned-page rule exists to prevent.

## Stages

**Stage 1 — the route, tested.** The region finder as a pure module with adversarial tests; the page
layout read beside `readPdfRasters`; the renderer behind a lazy import; the wiring in
`collectPdfFigures`; the two reasons. Fixtures: MDPI page 8 cut to a one-page PDF with pdf-lib (CC BY
4.0, attributed), and the committed arXiv eval PDF. Red first. `npm test`, `npm run typecheck`. GPT
Sol code review, write-capable. Commit.

**Stage 2 — shipping, and proof on the real article.** `@embedpdf/pdfium` in
`tests/cold-start-lazy-imports.test.ts` and the wasm in `tests/pdf-bundle-trace.test.ts`'s `MUST_SHIP`
(`includeFiles` in `vercel.json` if the tracer cannot see it); docs — article-images.md,
content-extraction.md, security.md, the `pdf-figure-read.ts` header § 3, the `PdfFigureNote.tsx`
comment; the local article's `assets` re-run and Figure 2 seen in a browser; the feedback note and
the queue. GPT Sol review. Push to `dev`.

## Deferred, and named

- A page carrying both a bitmap figure and a drawn one keeps today's `ambiguous`.
- Captions *above* a figure, or beside it, are not looked for; the band is above the caption only.
- Rendering *every* figure, bitmaps included, which would also pick up labels a publisher set as text
  over a bitmap.
- A backfill of the library. Nothing re-runs `assets` on its own; Greg's article needs the command
  above, and any other would too.
- Whether *View the original*'s `#page=N` lands on the right page in iPad Safari. Not testable from
  this box.
