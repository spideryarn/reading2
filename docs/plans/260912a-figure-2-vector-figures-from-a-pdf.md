# Figure 2 did not display: a PDF figure drawn rather than pictured

**[SPIDERYARN-READING2-31](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-31)** ·
reported 2026-09-12 08:05 UTC · kind: problem · from an admin (Greg) · on an iPad, build `607b57a0`

> Why didn't the image for Figure 2 display correctly?

Slug `entropy-24-00930-spya-bmvfyb`, block `spya-d8tgkx`. The paper is MDPI *Entropy* 2022, 24, 930;
the slug is the PDF's own filename.

**Status: stage 1 built and committed (`52d8d47a`), under GPT Sol's code review; stage 2 under
way.** The plan was revised after Sol's review (`ad65edb2` was the first draft; the review is
[260912a-…-plan-review-sol.md](260912a-figure-2-vector-figures-from-a-pdf-plan-review-sol.md), and
§ The review, and what it changed says what was taken).

On `52d8d47a`, on my own run: typecheck exit 0; 206 tests in 8 files green; the real step on the
report's page stored Figure 2 as a 1045 × 852 PNG that is exactly both lattices with every label;
arXiv p2 Figure 1 1039 × 694 and p3 Figure 2 1585 × 571. `npm run build` exit 0, and the bundle
reaches `@embedpdf/pdfium` only through `await import(…)` and a `createRequire(…).resolve` of its
wasm; `tests/cold-start-lazy-imports.test.ts` and `tests/pdf-bundle-trace.test.ts` both green with
PDFium added to them. **The trace was checked directly, not only through the test's own list**:
`nodeFileTrace` on `api-dist/vercel.js` collects 2,950 files, four of them `@embedpdf/pdfium`'s —
`package.json`, `dist/index.js`, `dist/index.cjs` and **`dist/pdfium.wasm`**. So the tracer sees the
wasm through `createRequire(…).resolve`, and `vercel.json`'s `includeFiles` needs no change. Its one
pdfium warning is the "Failed to parse … as script" nft prints for every ES module it then traces
as a module, which the trace test already excludes for that reason.

**End to end, through the real queue, on the reported article's own PDF** (ingested locally as
`entropy-24-00930-spya-pywwkq`, on `0201fdfc`): `npx tsx scripts/stage.ts assets <slug>`, **without**
`--force` — the new policy element in `assetsInputHash` is what made the old manifest read stale —
finished `0 images stored, 4 figures recovered`, and the newest revision's manifest records page 8 as
`stored`, 1045 × 852, 48,753 bytes: the same bytes the direct run produced. Figures 1, 3 and 4 are
unchanged, byte for byte.

One thing tripped on the way, and it is the queue's documented behaviour rather than this change: a
terminal ingest leaves the article's `labels` job queued with nobody driving it, and `claim` refuses
while an older job holds the article, so the `assets` run waited behind it (`BUSY_GIVE_UP_MS`,
scripts/stage.ts). `npm run labels -- <slug>` cleared it and the waiting run then finished on its
own. Worth knowing before re-running Greg's article on production, where a browser drives the
queue and this does not arise.

**Seen in a browser** (a subagent, Playwright against system Chrome, this worktree's own server,
signed in as the dev admin, `/read/entropy-24-00930-spya-pywwkq`): Figure 2's `<figure>` now holds an
`<img>` — natural size 1045 × 852, a `blob:` source, loaded, 659 × 540 on screen — both lattices drawn
above the caption, between the paragraph before it and the heading *4.3. Choosing a Redundancy
Measure*, with the ⤢ in its corner; and no *"We couldn't recover this figure from the PDF."* line
anywhere on the page. Figure 1, the bitmap control, is unchanged at 1503 × 1067.

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
458 paths. A LaTeX paper with matplotlib or TikZ figures produces exactly this. The ball-lightning
paper's four figures are all bitmaps.

## The fix, narrowed

**A second route, for one narrow and common case: a page with exactly one figure caption, no image
of any kind, and a drawing that unambiguously belongs to that caption. Find the drawing's rectangle,
render only that rectangle, and store the pixels as a PNG exactly as the bitmap route stores its
own.** Everything downstream is unchanged — a `stored` manifest entry, `GET /api/asset/…` and its
public twin, `rehost.ts`, the lightbox, the page link. **Anything outside the narrow case stays
caption-only, as today** — the rule 260906a was built on, that a missing figure is visible and a
wrong one is not.

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
| licence | the wrapper is MIT; the bundled PDFium binary is Apache-2.0 per the package's documentation (it also ships PDFium's BSD-style `LICENSE.pdfium`). Both permissive; we run it in our own function and redistribute nothing to readers |

**This is a new dependency, named here so Greg decides it rather than inherits it.** It is a library
in the sense `pdf-lib` is, not a framework, so it is not a third exception to *prefer boring*
([vision.md § Principles](../project/vision.md#principles)) — but it is 4.6 MB added to the API
function (Vercel's limit is 250 MiB), and it is the first thing on the server that *renders* a
stranger's document (§ Security).

**PDFium is handed one page, not the document.** The page is cut out with pdf-lib — already a
dependency, already how stage 2 cuts page ranges (`openPdfCuts`, src/pdf-read.ts) — so the second
parser sees only that page and the resources it references, and its WASM heap is bounded by one page
rather than by a 50 MiB upload. The committed fixture below was made exactly that way and renders
correctly.

### Which pages are eligible — all of these, or the figure stays caption-only

1. **Exactly one figure marker on the page.** Two captions on one page is deferred: Sol's F1 shows
   side-by-side figures over stacked captions defeating any band rule.
2. **No image of any kind on the page**, which is stronger than today's `no-raster`: no
   `paintImageXObject`, inline image, repeated image or image mask in pdf.js's operator list, **and**
   no image XObject in the page's resources — read with pdf-lib, walking Form XObjects to a bounded
   depth — because pdf.js *silently drops* an image over `maxImageSize` from the operator list
   (`src/pdf-figure-read.ts` header § 1). So an image the bitmap route declined for size, kind or
   shape is never handed to a second decoder. Sol F2.
3. **An ordinary page geometry**: `rotate` is 0, pdf.js's view box starts at the origin, and PDFium's
   page width and height agree with pdf.js's to half a point. Anything else is refused rather than
   reconciled across two coordinate engines. Sol F7.
4. **Not too heavy to try**: an operator count and a path count under fixed ceilings, checked on the
   operator list pdf.js has already built. A guard against the obvious runaway, **not a security
   boundary** — one operator can still be expensive (Sol F3; § Security).

### Finding the rectangle, and proving it belongs to the caption

A pure function over what pdf.js already hands back for the page — the box of every *painted* path
(each `constructPath`'s `minMax` carried through the current transform, including nested Form
XObject matrices; a path that only sets a clip paints nothing and is not ink) and the text lines:

1. **Find the caption, not a mention of it.** The page's text lines, joined in reading order, must
   contain the normalised opening of the block's own `<figcaption>` — up to 60 characters, not merely
   "Figure 2" — so a body sentence beginning "Figure 2 shows…" does not match, and a caption split
   across text runs or lines still does. No match, or more than one → refuse.
2. **The ceiling**: the lowest line *above* the caption, overlapping its column, that is prose (≥ 8
   words and ≥ 30% of the page width) or another caption (`Figure|Fig.|Table N`); failing that, the
   top of the body.
3. **Page furniture is not ink**: a thin horizontal rule in the top or bottom 12% of the page (the
   running header's rule sits inside the band on MDPI pages, at y = 771 on p8). A path covering most
   of the page in both directions — a border, a watermark, a background — **refuses the page**
   rather than being trimmed.
4. **The region**: the ink in the band that overlaps the caption's column, grown by ink in the band
   touching it, then the short text lines in the band that touch it (the labels).
5. **Ownership, stated as a refusal**: if there is any other ink in the band — beside the region, in
   another column — the page is refused. So a figure is taken only when *everything drawn* between
   its caption and the prose above it is the one region. That admits a multi-panel figure like
   Figure 2's two lattices, which a one-connected-component rule would refuse, and it refuses a
   sidebar, an ornament, or a neighbouring column's table rules.
6. **Sanity bounds**: the region is at least 36 pt on each side, at most three quarters of the page,
   and no prose line intersects it.

**Prototyped on three real figures and every crop checked by eye**: MDPI p8 Figure 2 (both lattices),
arXiv p2 Figure 1 (a 338 × 224 pt architecture diagram) and arXiv p3 Figure 2 (a 520 × 182 pt,
three-panel figure with its (a)/(b)/(c) labels). All three are single-caption pages with no image.

### The rest of the shape

- **Scale**: the longest side at most `MAX_FIGURE_EDGE` (1600 px) and at most 3× (216 dpi), rendered
  onto white, stored as RGB through the existing `encodeFigurePng` and `storeOne` — the same size
  caps, article budget and clock as a recovered bitmap.
- **Lifecycle** (Sol F5): one cached initialisation promise per process; every PDFium document, page
  and bitmap and every `malloc` freed in `finally`, on the failure paths too; renders one at a time.
  A test renders repeatedly, success and failure mixed, and checks the WASM heap does not grow.
- **Failure words** (Sol F9), in `PdfFigureFailure` (src/assets.ts) and the exhaustive mapping in
  src/collect-pdf-figures.ts. The reader's note is the same for all of them; they exist so the route
  can be measured rather than hide under `no-raster`:
  - `not-located` — an eligible page, and no region we could prove was this caption's;
  - `too-complex` — eligible, and over the operator ceiling, so never handed to PDFium;
  - `render-failed` — PDFium refused, threw, or could not be loaded.
  - `no-raster` keeps its meaning for a page that is not eligible — an image we could not use, more
    than one caption, an odd geometry.
- **Freshness** (Sol F4): `assetsInputHash` gains a PDF-recovery policy version **only when the
  article has PDF figure markers**, so every PDF article's manifest reads stale and no web article's
  does. Nothing re-runs a stale manifest on its own ([cron-scheduler.md](../project/cron-scheduler.md)),
  so this changes what the cache *claims*, not what runs: Greg's article gets its figure when its
  `assets` step next runs — after a deploy, `npx tsx scripts/stage.ts assets
  entropy-24-00930-spya-bmvfyb` against production, a production write and so Greg's to run. The
  caption text is not added to the hash: every ref already folds a digest of it in.
- **Shipping** (Sol F6): the file tracer is the single authority — the wasm goes in
  `tests/pdf-bundle-trace.test.ts`'s `MUST_SHIP` as `node_modules/@embedpdf/pdfium/dist/pdfium.wasm`
  (the package exports it as `@embedpdf/pdfium/pdfium.wasm`), and `vercel.json`'s `includeFiles` is
  used only if the tracer cannot see it, keeping `certs/**`. A wasm that is somehow missing in
  production **fails safe**: `render-failed`, caption-only, never a wrong picture.
  `@embedpdf/pdfium` joins `tests/cold-start-lazy-imports.test.ts`, so no request pays for it
  unless it renders.

### Security

[security.md](../project/security.md) § the PDF says what protects us from a stranger's PDF is that
the two parsers are *"never asked for anything but text, coordinates and bytes: we never render"*.
**This makes that sentence false**, and the doc will say so rather than keep it. PDFium is a third
parser of a hostile document.

What bounds it, and what does not:

- **Memory integrity, not availability.** PDFium runs as WASM, so a memory-safety bug corrupts its
  own linear memory and reaches nothing it was not handed. **Its filesystem is in-memory only**,
  checked in the package rather than assumed: `dist/index.js` mounts `MEMFS` (46 references) and
  names neither `NODEFS` nor `NODERAWFS`. The one `readFileSync` in the glue is the loader fetching
  its own `.wasm` when not handed the bytes, and we hand it the bytes. WASM does **not** isolate CPU
  or process memory (Sol F3).
- **The only hard time bound is the platform's.** A render is synchronous; no timer of ours can run
  while it holds the event loop. The operator ceiling and the one-page cut make a runaway less
  likely, and are described as that and nothing more. An interruptible worker is deferred, and named
  below — the same position `security.md` already records for pdf.js's own synchronous parse steps.
- **Reachability is not a defence.** A figure marker comes from the model's reading of the PDF, and a
  hostile PDF can print "Figure 1." (Sol F8). What narrows the input is the eligibility rules above —
  in particular that no image reaches PDFium at all — and that code is added to
  [security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
  as a new row. No existing defence file is edited.

Flagged to Greg all the same, because it changes a stated protection.

**The security-map row is a proposal, not an edit.** Sol's F8 asks for the eligibility code to be
listed among the defences, and it is right that it now is one. But
[security-map.md](../project/security-map.md) is one of the seven entry points, and a row in *Where
the defences physically live* is wording that tells an agent "you are editing a defence" — so it
goes to Greg under [edit-important-docs.md](../reusable/edit-important-docs.md) rather than in by an
unattended run. The row proposed, to go after `src/injection-scan.ts`:

> | [`src/pdf-figure-page.ts`](../../src/pdf-figure-page.ts) | **what keeps an image away from the second decoder.** `onePageHasImage` walks the cut page's resources and content — XObjects, inline images, patterns, Type 3 glyphs, soft masks — and every doubt counts as an image, so a page the bitmap route refused for an image's size or kind never reaches PDFium. With `locateDrawnFigure`'s operator ceilings in [`src/pdf-figure-region.ts`](../../src/pdf-figure-region.ts), which are guards and not a bound. [security.md](../project/security.md) § the PDF |

(The row's links are written relative to this plan so they resolve here; moved into
`docs/project/security-map.md` they become `security.md` and `../../src/…` unchanged.)

[security.md](../project/security.md) itself — the deep dive, not an entry point — is updated in
stage 2.

## The review, and what it changed

GPT Sol, 2026-09-12, on `ad65edb2`: **do not proceed** — three established P1s. All ten findings
were checked against the code; the verdict was right and the plan above is the narrowed version it
proposed, with one amendment.

| | | |
|---|---|---|
| F1 | P1 · the band rule can attach another drawing | **Taken.** One caption per page, and the ownership rule in step 5. *Amended*: Sol proposed "one exclusive drawing component"; Figure 2 is two disconnected lattices, so that rule would refuse the figure this report is about. Ownership is instead *all the ink in the band is the region*, which refuses the same adversarial layouts |
| F2 | P1 · zero usable rasters bypasses raster refusals | **Taken.** Eligibility 2 — no image of any kind, including those pdf.js drops silently |
| F3 | P1 · no bound on a synchronous render | **Taken in part.** Described honestly; the one-page cut added; the worker **deferred** and named |
| F4 | P1 · existing articles read falsely fresh | **Taken.** Policy version in `assetsInputHash` when markers exist; caption not added (already in the ref) |
| F5 | P1 · lifecycle and peak memory | **Taken.** One-page input, cached init, `finally` everywhere, serial, a heap test |
| F6 | P1 · bundle check can pass without shipping | **Taken in part.** One authority (the tracer), fail-safe on a missing wasm. A packaged-artifact test without `node_modules` is not built: deploys are Greg's and the tracer is what Vercel ships from |
| F7 | P1 · two coordinate engines | **Taken.** Rotation and non-origin boxes refused; page sizes cross-checked; split-caption and body-reference cases tested |
| F8 | P2 · security account | **Taken.** § Security rewritten; a security-map row |
| F9 | P2 · `render-failed` conflation | **Taken.** `too-complex` separate |
| F10 | P3 · licence | **Taken.** |

### Round two: the one departure, put back to Sol, then to Fable

The amendment to F1 was the one place this plan overrode Sol, so it went back to Sol as a narrow
question ([prompt](260912a-figure-2-vector-figures-from-a-pdf-f1-question-prompt.md),
[answer](260912a-figure-2-vector-figures-from-a-pdf-f1-question-sol.md)): **sound with changes**.

| | | |
|---|---|---|
| F11 | P1 · a foreign drawing inside the caption's span is absorbed, not refused | **Residual, accepted** — Fable, below |
| F12 | P1 · text is not ink, so a stray word inside the crop passes | **Taken.** Any text in the band that is not a label touching the region refuses the page |
| F13 | P1 · one extracted marker is not one printed caption | **Taken.** Exactly one printed `Figure|Fig. N` opening on the page, as well as one marker |
| F14 | P1 · no geometry-only rule can prove that disconnected drawings belong together | **True, and not built around** — Fable, below |

Sol's "smallest sound" answer to F14 was an exception keyed to this one PDF's digest. Not taken, and
the page carries no other ownership signal — neither PDF has tagged structure (no `StructTreeRoot`,
checked with pdf.js). So it went to **Fable**, 2026-09-12, as a product call between *connected
drawings only* (safe, and refuses Greg's Figure 2) and *admit disconnected drawings with every fixable
refusal*:

> **Call: B** […] Not C — a digest-keyed exception is a test fixture wearing a feature's clothes; it
> fixes one reader's one article and teaches the code nothing. Not A — multi-panel is the *normal*
> shape of a drawn figure in ML and physics papers […] B's residual is *addition*: the crop is,
> literally and provably, the region printed directly above this caption on this page. The true
> figure is always in it. […] the code does not need to claim ownership. It needs to claim only
> what it can prove.

So disconnected drawings are admitted, with Fable's three further refusals: a component that is one
closed rectangle with text inside it (a boxed equation, a sidebar); any component under 36 pt on a
side (evidence of an ornament, not absorbed into the region); more than six components. Each is
measured against the three real figures before it is trusted. Fable also noted that the F11 layout —
a foreign drawing set beside a half-width figure over a full-width caption — is one a LaTeX float
cannot produce, and that F12 already refuses text-wrapped layouts.

**Fable's wording point** — say *"the drawing above this caption on page N"*, not *"Figure N"* — turns
out to need no change, because the reading view makes no textual claim to reword. A recovered figure
is inserted with `alt=""`, deliberately (`src/web/rehost.ts`, *"The visible `<figcaption>` beside it
carries the caption, so alt text would be the same sentence announced twice"*), and beside it sits
the icon that opens that page of the PDF. So the only assertion the app makes is *this picture sits
under this caption*, which is exactly what the rendered region is. Writing a sentence into the `alt`
would add a claim, not narrow one, and undo an accessibility decision taken for its own reasons.

## Stage 1 code review: GPT Sol, reviewer-fixer

On `52d8d47a` ([prompt](260912a-figure-2-vector-figures-from-a-pdf-code-review-prompt.md),
[answer](260912a-figure-2-vector-figures-from-a-pdf-code-review-sol.md)), write-capable in the
worktree. It fixed eighteen findings red-first and reported two; **not ready (F33)**. Its fixes were
re-run on my side before being committed: typecheck exit 0, 232 tests in the same 8 files green.

| | | |
|---|---|---|
| F15 | P1 · NUL-delimited inline image escaped the scan | fixed |
| F16 | P1 · Type 3 glyphs paint vectors pdf.js never lists | fixed — a reachable Type 3 font refuses the drawn route |
| F17 | P1 · a clipped path could bridge two drawings | fixed — rectangular clips applied, others refuse |
| F18 | P1 · invisible or white-on-white paint as an ownership bridge | fixed |
| F19 | P1 · thick strokes and acute mitres past the 4 pt padding | fixed |
| F20 | P1 · a rotated rectangle lost its boxed-text flag | fixed |
| F21 | P1 · a big label inflating a sub-36 pt drawing past Fable's floor | fixed — component size is ink only |
| F22 | P1 · an unpunctuated second caption, `Figure 4 The…`, missed | fixed — **and it reverses my own relay to the builder**, which asked for a delimiter so that a body line starting "Figure 2 shows…" would not count. Sol's is the conservative side of the rule (it refuses more, never shows a wrong picture), so it stands |
| F23 | P1 · crop padding could take in the caption itself | fixed |
| F24 | P1 · stray text checked only inside the crop, not the whole band | fixed — **also a reversal of my relay**, and here Sol was following this plan's own round-two table, which says *any text in the band*. It refuses a half-width figure beside the other column's prose; conservative, so it stands |
| F25 | P1 · drawn-page analysis could starve the bitmap figures of their clock | fixed — bitmaps finish first |
| F26 | P1 · a failed `FillRect` could pass uncleared memory as a figure | fixed |
| F27 | P2 · one throwing destructor skipped the rest | fixed |
| F28 | P1 · an unclassifiable XObject was skipped, not counted | fixed — fail closed |
| F29 | P2 · a `BI` split across `/Contents` streams | fixed |
| F30–F32 | P2 · mutations the suite did not notice — caption forwarding, the render's y-flip, freshness scoping, byte caps, abort | fixed — each now red under its mutation |
| F33 | P1 · reasoned · pdf.js runs forgiving, so it can omit malformed paint that PDFium then draws into the crop | **taken, round two** — a strict second operator-list pass on candidate pages only, refusing unless strict and forgiving agree. Sound here where it was not before: the empty strict list the builder hit came from pdf.js removing an image, and a candidate page has none |
| F34 | P2 · complexity 147 and 83 in the layout interpreter and the resource walk | **taken, round two** — split into small pure helpers, each tested |

**F33's fix, checked narrowly** ([prompt](260912a-figure-2-vector-figures-from-a-pdf-f33-check-prompt.md),
[answer](260912a-figure-2-vector-figures-from-a-pdf-f33-check-sol.md)): **still open, F35 — P1,
established by a probe.** pdf.js with `stopAtErrors` can resolve the operator list it had already
flushed before its rejection is observed, so a malformed operator at a chunk boundary is missing from
*both* reads alike: an eligible page with 480 `q/Q` pairs before the test's bad `/Sh0 sh` gave 995
operators both ways, `strictAgrees: true`, and passed the locator. Everything else held — a strict
throw or abort fails closed, and the red test is genuine.

**So the check moves to the renderer's side.** Two pdf.js reads cannot see what pdf.js itself
skipped, however they are compared; the picture PDFium draws can. After the render, **every
non-white pixel must fall inside the ink and the labels the locator measured** — padded for
anti-aliasing and stroke — or the page is refused `not-located` / `unmeasured-paint`. That closes the
whole class, whatever the reason pdf.js skipped the paint, not only the chunk boundary. The strict
comparison stays as a second line. What it cannot see, named: skipped paint that lands entirely
inside a box the locator did measure. That goes back to Sol as one more narrow check; if it is still
open after that, it goes to Fable or Greg before landing, not past them.

**F35's fix, checked narrowly** ([prompt](260912a-figure-2-vector-figures-from-a-pdf-f35-check-prompt.md),
[answer](260912a-figure-2-vector-figures-from-a-pdf-f35-check-sol.md)), on `a4bcb82b`: the render
path is **sound** — Sol transplanted both refusal tests onto `0201fdfc` and watched them fail there,
reproduced the in-padding fractions (5.32%, 4.47%, 3.61%), and ran 35 of 35 — but **F35 still open
on F36, P1, established**: the recovery policy was left at `pdf-figures/2`, so a drawn figure stored
by the pre-containment code reads *current* and is served without ever passing the check. This
worktree made exactly such a manifest, in the local run recorded above. The fix is the version bump
`PDF_FIGURE_RECOVERY_POLICY` exists for: `pdf-figures/3`, and every PDF manifest made before
containment reads stale. Nothing outside this worktree holds one — `0201fdfc` was never pushed — so
the bump is about the rule, not about a manifest in the wild.

Proved on that very manifest: after the bump, `npx tsx scripts/stage.ts assets
entropy-24-00930-spya-pywwkq` **without** `--force` ran — the `pdf-figures/2` manifest read stale —
and finished `figures: 4, figuresStored: 4, figuresDrawn: 1`, the drawn one now through containment.
typecheck exit 0; 157 tests in the seven freshness and figure files green.

**The bump, checked narrowly** ([prompt](260912a-figure-2-vector-figures-from-a-pdf-f36-check-prompt.md),
[answer](260912a-figure-2-vector-figures-from-a-pdf-f36-check-sol.md)), on `b8c761e0`: **F35 closed.**
Both freshness checks read the one `assetsInputHash`, so a carried `/2` manifest reads stale against
`/3`; an article with no PDF markers hashes exactly as before; and serving needs the current manifest
to name the blob, so with the one `/2` manifest regenerated and the pre-containment code never
deployed, no drawn figure from before containment is reachable. That was the last open P1 on the
chain.

The two reversals leave a figure beside another column's prose, or on a page where a body line
begins "Figure N", caption-only. Widening either is deferred until a real page shows the refusal
costs something.

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

**Stage 1 — the route, tested.** The eligibility and region rules as a pure module with adversarial
tests (Sol's layouts: side-by-side figures, a watermark, a narrow caption under a wide figure, a
neighbouring column's drawing, a body reference, a split caption, a rotated page); the page layout
read beside `readPdfRasters`; the one-page cut; the renderer behind a lazy import; the wiring in
`collectPdfFigures`; the failure words; the freshness policy version. Fixtures: MDPI page 8 as a
one-page PDF (CC BY 4.0, attributed, `tests/fixtures/pdf-vector-figure/`) and the committed arXiv eval
PDF. Red first. `npm test`, `npm run typecheck`. GPT Sol code review, write-capable. Commit.

**Stage 2 — shipping, and proof on the real article.** The bundle-trace and cold-start guards; docs —
article-images.md, content-extraction.md, security.md, a security-map.md row, the
`pdf-figure-read.ts` header § 3, the `PdfFigureNote.tsx` comment; the local article's `assets` re-run
and Figure 2 seen in a browser; the feedback note and the queue. GPT Sol review. Push to `dev`.

## Deferred, and named

- **Two or more captions on one page**, and a page carrying both a bitmap figure and a drawn one.
  Both need ownership *demonstrated* rather than inferred (Sol F1).
- **An interruptible worker** around PDFium, with a parent-held deadline (Sol F3).
- Captions *above* a figure, or beside it; the band is above the caption only.
- Rendering *every* figure, bitmaps included, which would also pick up labels a publisher set as text
  over a bitmap.
- A note that says *why* when a drawn figure is refused — the eligibility rules now make "this page
  has no image at all" a claim we can stand behind, which the note's header says it could not.
- A backfill of the library. Nothing re-runs `assets` on its own; Greg's article needs the command
  above, and any other would too.
- Whether *View the original*'s `#page=N` lands on the right page in iPad Safari. Not testable from
  this box.
