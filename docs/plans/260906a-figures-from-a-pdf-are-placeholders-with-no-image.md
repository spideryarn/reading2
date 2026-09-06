# Figures from a PDF are placeholders with no image

**Status:** plan, under review. Started 2026-09-06.

A reader opening *Analog Cognition and Consciousness* (uploaded as a PDF, 30pp, slug
`analog-cognition-and-consciousness-4-28-26-spya-kn0z4z`) sees eight figure captions and eight
blank spaces where the figures should be. Greg, 2026-09-06:

> it seemed to ingest ok, but the images aren't showing

## What is actually happening

Nothing is broken. This is v1 behaving as designed, and the design is written down:
[260826c-pdf-ingestion.md](260826c-pdf-ingestion.md) chose to ship figures as **caption-only
placeholders** and deferred the picture to v2. One line does it —
[`src/pdf-read.ts`](../../src/pdf-read.ts) `renderHtml`:

```ts
record.type === "figure" || record.type === "table"
  ? `<figure${cls}><figcaption>${escapeHtml(text)}</figcaption></figure>`
  : ...
```

So there is no `<img>` in a PDF-derived article, ever. Stage 4.5
([article-images.md](../project/article-images.md)) then finds nothing to host, because it hosts
what the *blocks* point at and the blocks point at nothing. Both halves are working; the picture
was never fetched in the first place.

**This is v2 of the PDF plan, brought forward** — not a bug fix. Greg's own v2 line:

> For figures and tables, it's ok to skip (with a placeholder) for v1, then v2 can involve a
> screenshot-image, and v3 can involve transcription where possible.
>
> — Greg, quoted in [260826c-pdf-ingestion.md](260826c-pdf-ingestion.md)

## What this PDF is made of — measured, not assumed

Run 2026-09-06 on `uploads/Analog Cognition and Consciousness 4-28-26.pdf` (30pp, 1,723,997 bytes)
with pdf.js 6.2.108 via `getOperatorList()`:

| fact | value |
| --- | --- |
| pages carrying `paintImageXObject` | 8 — pp. 3, 4, 7, 9, 11, 12, 14, 16 |
| image ops per such page | exactly 2 |
| figure captions in the text layer | `Figure 1 …` – `Figure 8 …`, one per those pages |
| pages with no image op | the other 22 |

Every figure is an **embedded raster XObject**. That is route 2 of the three the plan listed, and
on this document it covers 8 of 8 rather than the "40–60% of academic figures" the plan feared.

Decoding them needs **no rasteriser at all**. `page.objs.get(key)` hands back
`{width, height, kind, data}` with `kind` 2 (`RGB_24BPP`) or 3 (`RGBA_32BPP`) — plain decoded
bytes from pdf.js's own worker, and `data.length === width*height*3` (or `*4`) exactly. A
~60-line PNG writer over `node:zlib`'s `deflateSync` turns those into files. Measured, both
kinds, four pages:

```
p3  img_p2_1  1536x864  kind=2  3,981,312 B → 322,272 B PNG   ← Figure 1, renders correctly
p3  img_p2_2  1190x159  kind=3    756,840 B →   1,197 B PNG   ← BLANK
p4  img_p3_1   770x372  kind=3  1,145,760 B →   2,083 B PNG   ← BLANK
p4  img_p3_2   767x660  kind=3  2,024,880 B → 169,449 B PNG   ← Figure 2, renders correctly
p7  img_p6_1   372x1155 kind=3  1,718,640 B →   4,561 B PNG   ← BLANK
p7  img_p6_2   563x1536 kind=3  3,459,072 B → 756,147 B PNG   ← Figure 3, renders correctly
p12 img_p11_1 1105x364  kind=2  1,206,660 B → 177,080 B PNG   ← Figure 6, renders correctly
p12 img_p11_2 1299x212  kind=3  1,101,552 B →   1,675 B PNG   ← BLANK
```

Two findings in that table, and the second is the one that would have bitten:

1. **The pure-JS route works**, and produces the real figure — checked by eye, all four.
2. **Half the image ops are blank.** Each figure page carries the picture *and* a near-empty
   overlay (a caption backing box, drawn as an image). Ship without a blankness filter and every
   figure gets a white rectangle stapled underneath it. Nothing errors; it just looks wrong. The
   family is [silent-success.md](../reusable/silent-success.md).

## The corpus, surveyed — where the heuristics will actually break

Same probe run over the eval PDFs, 2026-09-06. `deflBpp` is deflated bytes per pixel on a
subsample; `colours` is distinct RGB, capped at 4096.

| document | pages | image ops | what they are |
| --- | --- | --- | --- |
| `uploads/Analog Cognition…` | 30 | 16 | 8 figures (deflBpp 0.24–0.91) + 8 blank overlays (0.0039–0.0040, ≤4 colours) |
| `evals/pdf/easy` | 8 | **0** | no raster at all |
| `evals/pdf/titles/arxiv-arnn-eeg-stamp` | 3 | **0** | — |
| `evals/pdf/titles/frontiers-wrapped-title` | 3 | **0** | — |
| `evals/pdf/titles/kuhn-landscape-of-consciousness` | 3 | 3 | 2 pictures + one 119×119, 58-colour logo at 0.0165 |
| `evals/pdf/harder` (ball lightning) | 14 | 5 | 4 figures, 2067px wide, one per figure page — plus a 200×70 journal masthead on p1 |
| `evals/pdf/much-harder` (Wellcome scan) | 17 | 17 | **one full-page scan image per page** on pp. 2–17, 633–661 × 1024 at deflBpp ≈ 2.0 — *plus* a 500×164 logo on p1, which is not a scanned page at all |

Four things fall out of that table, and three of them are traps:

1. **The blank overlays separate cleanly** — 0.004 against 0.24 and up, two orders of magnitude,
   and ≤4 colours against thousands.
2. **But compression is the wrong instrument, and a second measurement found the right one.**
   Kuhn's 119×119 logo sits at deflBpp 0.0165, *below* the blank band, while carrying 58 colours: a
   rule of `deflBpp < 0.02 || colours <= 2` calls a real picture blank and throws it away. See
   [the rule below](#the-blankness-rule-is-not-a-threshold), which needs no threshold at all.
3. **A scan is one full-page image per page, and every one reads as REAL.** Put a figure record on
   a scanned page and we would staple the entire page of the book under its own caption. Two
   defences, and the second is the principled one: reject an image whose placed CTM box covers most
   of the page, and skip pages that pass 0 already knows have no text layer — `src/pdf.ts` computes
   words per page precisely so "this is a scan" is a fact we state rather than meet by surprise.
4. **The figure record is the gate, and it does most of the filtering for free.** Only a page the
   model called a `figure` is ever looked at. The ball-lightning masthead is on p1 and Kuhn's logo
   on p1, and page 1 gets `publisher`/`cover` records, not `figure` ones. Every logo in this corpus
   is excluded by the gate rather than by a threshold.

**Point 3 was overstated, and stage B's tests are what found it.** "One full-page image per page,
all 17" reads that row of the table as if every page were alike. The probe's own output — printed in
this session and then summarised carelessly into the sentence above — says page 1 is a **500×164**
logo and pages 2 and 17 are 649×1024 and 633×1024, not 661. Wellcome's generated rights page is not
a scan: it carries **95 words**, nearly five times `SCAN_WORDS_PER_PAGE`, which is the very fact
`Pass0.isScan`'s comment already records and which this plan repeated without applying.

So the honest claim is **the per-page scan rule excludes sixteen of seventeen pages**, not
seventeen. The seventeenth is refused a page later, by the figure-record gate, because a rights page
gets `cover`/`publisher` records and never a `figure` one.

Which leaves a real choice, and the reason for taking it is worth more than the choice:
a document-level `isScan` would make the number seventeen and the sentence tidy. **It is not
built.** It costs a full text walk of every page to compute, and it would refuse a genuine figure on
the one typeset page of an otherwise-scanned document — a worse failure than the tidy sentence is
worth. The per-page rule stands, and the number is sixteen.

Note also that **order varies**: on p11 of the Analog PDF the real image is painted first and the
blank second; on p16 it is the other way round. Anything that assumes "the picture, then the
overlay" is wrong on this document already.

Also worth knowing: **three of the seven documents contain no raster image at all.** Whatever we
build has to be silent and cheap on those, and a document whose figures are vector drawings gets
nothing from this route — which is the honest limit of it, and belongs in the copy, not in a
promise.

### The blankness rule is not a threshold

Fable's suggestion — decide blankness on the *pixels*, not on how well they compress — turns out to
make the tuning question disappear. Measured 2026-09-06 across the three documents that have raster
images, counting the fraction of pixels that are opaque at all (alpha ≥ 16):

| document | image | opaque pixels | verdict |
| --- | --- | --- | --- |
| Analog Cognition | all 8 overlays | **0.0%** | every one *fully transparent* |
| Analog Cognition | all 8 figures | 32.5–100% | ink 6.7–84% |
| Kuhn | the 119×119 logo the deflate rule got wrong | 100% | ink 69.7% |
| ball lightning | all 5, masthead included | 100% | ink 7.9–82.7% |

So the rule is not "small" or "low-entropy" or "few colours". It is:

> **An image with no opaque pixel in it draws nothing. Drop it.**

Exact, with no constant to tune and no document it is fitted to, and it separates 8 from 8 on the
document in hand and misclassifies nothing in the other two. A second clause is worth having beside
it for the same reason — *every opaque pixel within tolerance of one colour* — which nothing in this
corpus triggers, but which is the same claim about a flat opaque rectangle that the first makes
about a transparent one. It costs one pass over the bytes we already hold.

The one thing to hold on to: these images carry **real alpha**, so they must be stored as RGBA PNG,
and a figure with a transparent background must not end up dark-on-dark. That is already solved —
`--figure-sheet` in `src/web/styles.css:1290` puts a light sheet under every figure, and the comment
there says it was added after exactly that failure.

### What adding an `<img>` does to the block ids

Checked in `src/blocks.ts` rather than assumed, because
[block-ids.md](../project/block-ids.md) is the contract everything else rests on.

`exactKey` (`src/blocks.ts:911`) keys a block on its **text** when it has any. A figure with a
caption has text, so putting an `<img>` inside it changes the html and **not** the key: every
existing figure block keeps its id, and so does every comment, highlight and Hierarchy row aimed at
it. A PDF already in the library can have its figures backfilled without disturbing a reader's
annotations.

The caption-less figure is **not** an exception, though the first draft of this plan said it was:
`renderHtml` skips an empty-text record before it builds anything (`src/pdf-read.ts:1528`), so a
figure with no printed caption has no block at all today. There is nothing to re-mint. v1 leaves
them alone; giving them a media block of their own is a separate decision, not a side effect of
this one.

## Why not the other two routes

- **Model bounding boxes + crop in the browser** (the plan's first choice) needs the reader to
  download `raw.pdf` — 1.7 MB here — and run pdf.js per figure, and needs box accuracy we have
  never measured. Route 2 needs no model call, no reader download, and no accuracy question.
- **`@napi-rs/canvas` on the server** is *banned*, and not by preference:
  `tests/pdf-bundle-trace.test.ts` lists `node_modules/@napi-rs/canvas/index.js` under
  `MUST_NOT_SHIP` because naming it from the API function adds **34 MB** to the Vercel bundle.
  Only `geometry.js` ships, for `DOMMatrix`. Stage 2 runs inside that function, so anything
  needing a real canvas is out before it starts.

## The thing that changes the design: there is nowhere to serve an image from

Hosting the article's images was planned in five stages
([260829b-hosting-the-articles-images.md § Stages, and where we are](260829b-hosting-the-articles-images.md#stages-and-where-we-are)).
Stages 1, 2, 3, A and B are ticked. **C — delivery — and D — the reading view — are not**, and the
plan's own table still says so.

Confirmed in the code rather than taken from the table:

- `assetIndex` (`src/assets.ts:404`) — the map the reading view was to look a URL up in — **has no
  caller anywhere in the repo**. `grep -rn "assetIndex" src/` finds its definition and two comments.
- `assets.entries` is read in exactly one place outside `src/assets.ts`: `src/pipeline.ts:2316`,
  which counts them for a log line.
- There is **no asset-serving route**. `grep -n "asset" src/routes.ts` returns one comment.

So the `assets` step downloads every image in an article, sniffs it, puts it in the bucket under its
content hash and writes a manifest — and **not one byte of it is ever served to anybody**. Every
reader is still hot-linking the publisher's CDN, which is the exact thing the feature exists to stop.
That is a half-built feature, not a broken one, and its own plan is honest about where it stopped;
it is recorded here because this work walks straight into it.

**What it means for us.** A PDF figure cannot be shown by "storing it like an article image does",
because storing is not what puts an image on the page — nothing does yet. Any route to a visible
figure has to build the delivery half. That is not scope creep to be trimmed; it is the floor.

## The design

**Two things in the first draft of this plan were wrong, and GPT Sol found both.** Verified in the
code before accepting them, because a review is evidence and not a verdict:

- **A final `/api/…` URL cannot live in the stored HTML.** `stripOwnApiUrls`
  (`src/sanitize-policy.ts:466`) *removes* any `src` that resolves to our own API — host-relative,
  absolute and protocol-relative alike, resolved rather than string-matched. That is a deliberate
  control: an article may not point the reader's browser at our own endpoints. So
  `<img src="/api/figures/…">` written by stage 2 would be stripped by stage 3 and never reach a
  reader. The first draft of this plan proposed exactly that.
- **Captionless figures have no block to re-mint.** `renderHtml` (`src/pdf-read.ts:1528`) does
  `if (!text) continue;` *before* it builds the `<figure>`, so a figure whose caption is the empty
  string produces no element at all. The paragraph below about it re-minting once was wrong; there
  is nothing there to re-mint. v1 excludes them, and a media block for them is a separate decision.

So the URL is minted **in the client, after sanitising**, which is also how the article's own images
were always meant to work — `rehostImages`, stage D of
[260829b](260829b-hosting-the-articles-images.md). The pipeline writes a *marker* and the manifest;
the reading view turns the pair into an `<img>`:

```text
pdf-read.renderHtml   <figure data-spya-pdf-figure="<opaque ref>"><figcaption>…</figcaption></figure>
blocks                the marker survives; the caption keys the id, so the id survives too
assets step           reopens raw.pdf, extracts, encodes, stores; manifest maps ref → hash | failure
reading view          after sanitizeArticle, inserts <img src="/api/assets/<slug>/<hash>.png">
route                 sendPlate's shape: ownership, look the hash up in the manifest, serve
```

**The ref is opaque and carries the PDF's identity.** Assets are carried into new revisions
(`src/store/pg-revisions.ts:249`), so a bare `page:3` would happily show the *previous* PDF's page
three after the document changed. The ref is minted from a version tag, the raw PDF's sha256, the
page, the figure's ordinal on that page and a digest of the caption — so an exact-match lookup fails
closed until `assets` runs again.

**Delivery is generic, not PDF-only.** One route and one `rehostImages`, serving the article's own
images and PDF figures alike. Greg, asked directly on 2026-09-06, chose **both, PDF figures first**:
land the mechanism with only PDF figures flowing through it, prove it in the browser, then switch web
images on in the same piece of work. That finishes 260829b's stages C and D and closes the
publisher-tracking hole they were written for.

**When nothing was recovered, say so.** Greg chose the muted line *plus a link to the original*:
one quiet sentence in the caption voice, and *view the original* pointing at the PDF the reader
already has. Rendered as client-owned UI beside the prose, never as text inside `block.html` —
`src/web/annotate.ts` computes comment and highlight offsets from that text, and generated UI copy
inside it would shift every anchor in the block.

### Two of Sol's P0s, checked rather than believed

**`maxImageSize` does guard the decode, and it removes the operation rather than reporting it.**
`pdf.worker.mjs:40299` tests `w * h > maxImageSize` against the image *dictionary's* `/Width` and
`/Height`, before any decoding — so the cap genuinely prevents the allocation, which is what Sol
said. But the branch beside it is `if (!ignoreErrors) throw`, and `pdf.mjs:21565` sets
`ignoreErrors = src.stopAtErrors !== true` — so with the default options an oversized image is
**warned about and dropped from the operator list**. The page then looks as though it never had an
image.

That is a silent-success shape, and it is worth naming: with the cap on, *a figure too big to
decode is indistinguishable from a figure that was never a bitmap*. Two consequences we accept and
one we do not.

- Accepted: the manifest reason has to be honest about the ambiguity — "nothing recoverable here",
  not "this figure is vector art".
- Accepted: the cap is set where the corpus makes it rare rather than where it is tight. 12
  megapixels; the largest figure measured anywhere in the corpus is the ball-lightning paper's
  2067×3329 at 6.9 Mpx.
- Not accepted as permanent: if telling the two apart ever matters, `pdf-lib` is **already a
  dependency** — `openPdfCuts` uses it — and can read a page's XObject `/Width` and `/Height` out
  of the dictionary without decoding anything. That is the fix, and it is written here so the next
  person does not have to rediscover it.

**The assets freshness stamp really would not notice.** `STEPS.assets.stamp` calls `inputHashFor`
(`src/pipeline.ts:990`), which is `hashBlocks(blocks)`, and `hashBlocks` builds its canonical string
from `id`, `text`, `role` and `treatment` (`src/source-hash.ts:143`) — **`block.html` is not in it**.
Adding a marker to a captioned figure changes the html and nothing else, so a carried-forward empty
manifest would go on reporting itself current and the step would never run.

This is a family this codebase has already been bitten by and named: `src/pipeline.ts:1006` records
three stages that stamped this same hash while consuming the tree and the metadata head, and so
"went on reporting themselves current" when their real inputs changed.

**The fix, and it makes the step more honest rather than less.** Stamp the assets step on *what it
actually consumes*: the image URLs in the blocks and the figure refs in the blocks. Both are already
extracted by functions that exist for the purpose, the ref already carries the raw PDF's sha256, and
the result is a hash whose inputs are the step's inputs — which is the rule `articleFingerprint`
states and the three stages above broke. `ASSETS_VERSION` bumps with it.

### The scan rule, and where it can be computed for free

Sol's D2-4 asks for the scan exclusion to be explicit rather than left to the figure-record gate,
and the Wellcome measurement is why: 17 pages, 17 full-page images, every one of them opaque and
"real".

`Pass0.isScan` already exists (`src/pdf.ts:234`) and is judged on the *content* pages rather than
all of them — its comment records that Wellcome's own generated rights page is the only text in the
file, so "every page is empty" would say that document is not a scan. But `pass0` runs in stage 2
and the extraction runs in the assets step, so reaching for it would mean plumbing a fact across a
stage boundary.

It does not need plumbing. The extraction is already standing on the page with pdf.js open, and
`page.getTextContent()` there is nearly free. So the rule is local and per-page, which is *better*
than the whole-document flag because it also covers the mixed document — a scanned plate bound into
a typeset paper:

> **A page carrying fewer than `SCAN_WORDS_PER_PAGE` words of text layer is a photograph of a page.
> Its image is the page, not a figure.** Take nothing from it.

`SCAN_WORDS_PER_PAGE` is 20 (`src/pdf.ts:352`) and is exported from the one file that owns the
judgement, so there is no second threshold to keep in step.

### Stage C is much smaller than it looked, and one check is why

`assets` is a **`jsonb` column typed as `Assets`** — `src/db/schema.ts:943`,
`jsonb("assets").$type<Assets>()`. So adding `pdfFigures?: PdfFigureEntry[]` to the `Assets`
interface needs **no migration at all**, and none of the "13 places" the article-images plan had to
plumb a new artefact through. That settles Sol's D4-2 in favour of his own smaller option: an
additive field on the existing artefact rather than a new artefact or a discriminated `AssetSource`
that would rewrite every manifest in production.

The marker still has to be registered. `RESERVED_ATTRS` in [`src/reserved.ts`](../../src/reserved.ts)
is the only file allowed to name a `data-spya-*` attribute, and `tests/reserved.test.ts` enforces it
by scanning `src/` for the literal prefix — so `data-spya-pdf-figure` goes there or the gate goes
red. Two notes for whoever writes it:

- It must **not** join `FORBID_ATTR` in `src/sanitize-policy.ts`. Our own marks are forbidden there
  precisely so a publisher cannot forge them, but this one has to survive the sanitiser to reach the
  reading view at all.
- Which is safe here for a reason worth stating rather than assuming: a forged marker resolves to
  nothing. The ref is minted from the raw PDF's sha256, so an HTML article — which has no raw PDF —
  has no `pdfFigures` entries for a forged ref to match, and the model's transcription reaches the
  html through `escapeHtml` and cannot spell an attribute in the first place. `scrubReserved` on
  ingress is still the discipline; it is belt to that braces.

## What Sol settled, 2026-09-06

Full review in [260906a-figures-plan-review-sol.md](260906a-figures-plan-review-sol.md). The P0s
that changed the design are folded in above; the rest, held as build constraints:

- **The decode cap has to reach pdf.js itself.** Checking dimensions after `getOperatorList()` is
  too late — building the operator list is what decodes the image and sends the buffer. Pass
  `maxImageSize` to `getDocument`, which checks width × height *before* decoding. A refused image
  is recorded as "no recoverable raster", because pdf.js drops the operation entirely.
- **~~Cap the deliverable bytes at 4 MiB~~ — this one is wrong, and the repo already says so.**
  Sol's D5-2 argues a Vercel function response is capped at 4.5 MB. That number is the **request
  body** limit, not the response: [ingest-queue.md](../project/ingest-queue.md) states it in those
  words — *"A Vercel function refuses a request body over 4.5 MB — flat, unraisable"* — and it is
  the whole reason uploads go straight to Storage. On the way out, `sendSource`
  (`src/routes.ts:491`) already `res.end()`s an entire uploaded PDF through that same function, and
  `MAX_UPLOAD_BYTES` is **50 MB** (`src/uploads.ts:31`). If a 4.5 MB response cap applied, that
  shipping route would be broken for most of this project's own eval corpus.

  A cap is still worth having, on the honest grounds — what the reader has to download — rather
  than on a platform limit that is not there. The largest figure measured anywhere in the corpus is
  756 KB.

  **That 756 KB was the *Analog Cognition* document's number, and the corpus is worse.** Stage C
  measured the ball-lightning paper's page-3 figure at 2067 × 1741 of photographic RGB encoding to
  **9,355,050 bytes**, so a 4 MiB cap refused a real fixture — silently — and the cap went up to
  16 MiB to let it through, leaving a reader fetching 9 MB for one picture.

  **A cap was the wrong instrument, and Greg's call on 2026-09-06 was to fix the pixels instead:**

  > downscale instead

  A figure renders at roughly 700 px of CSS width in the reading view, so ~1600 px on the longest
  side is already generous for a 2× display. `downscaleRaster` in
  [`src/pdf-figures.ts`](../../src/pdf-figures.ts) box-filters everything above `MAX_FIGURE_EDGE`
  down to it — alpha-weighted, because averaging colour across pixels of differing alpha puts a dark
  fringe round every transparent edge — and it runs immediately before `encodeFigurePng`. Re-measured
  over the corpus the same day: 9,355,050 → **2,349,789** at 1034 × 871, 2,917,234 → 985,154,
  3,432,261 → 822,724, and every figure already inside the bound returned untouched.

  `MAX_FIGURE_BYTES` becomes a backstop rather than the control, at **12 MiB** — above the
  10,241,600 raw bytes a 1600 × 1600 RGBA raster could ever deflate from, so it cannot refuse a
  figure the downscale allowed. The next real reduction is a lossy encoder, and that is still
  blocked on `@napi-rs/canvas` being 34 MB of Vercel bundle.
- **Drop the second blankness clause.** "Every pixel within tolerance of one colour" buys nothing
  the corpus needs and introduces the one false negative that matters — a near-white diagram or a
  faint grid deleted silently. Only exact transparency, only for `RGBA_32BPP`. Keeping a flat
  rectangle is visible; deleting a real figure is not.
- **Fix the assets freshness stamp first.** It is `hashBlocks(blocks)` plus `ASSETS_VERSION`, and
  `hashBlocks` covers id, text, role and treatment — **not** `block.html`. Adding a marker to a
  captioned figure would therefore not invalidate a carried-forward empty manifest, and the step
  would never run. Needs an input hash over the image URLs, the figure refs and the raw PDF's hash,
  and `ASSETS_VERSION` bumped.
- **`data-spya-*` belongs to `src/reserved.ts`**, and an incoming copy of the marker must be
  scrubbed before we write our own — the existing provenance mechanism, not a new one.
- **Reuse `loadPdfjs`**, which installs the geometry-only `DOMMatrix` and the explicitly-traced
  worker, rather than importing pdf.js again; and keep `tests/pdf-bundle-trace.test.ts` asserting
  the native binding stays out.
- **Export gets less complete**, and its own text currently claims image URLs are refetchable
  originals — untrue for a PNG cut out of an upload. Either carry the bytes or correct the sentence.
- **Every marker gets an entry**, stored or failed. None may vanish through ambiguity, a cap, a
  timeout or an unsupported kind — the distinction between "looked and failed" and "never looked"
  is the one `Assets` already exists to keep.

Two limits Sol names that we accept and record rather than fix: a decoded XObject is not guaranteed
to equal the page's rendered appearance once masks, blend modes and clipping are in play (four were
checked by eye here), and handling only `paintImageXObject` misses inline images and vector-only
figures. This is figure *recovery where the figure is a bitmap*, and the copy must not promise more.

## What Fable settled, 2026-09-06

Asked to arbitrate the product calls rather than the plumbing.

- **A wrong figure is worse than no figure, and it is not close.** A picture under the wrong
  caption is a fabricated claim about the paper, rendered at the verbatim level with the app's
  authority behind it, and the reader has no way to detect it — a missing figure is visible, a
  swapped one looks correct. So **v1 attaches only where a page holds exactly one figure record and
  exactly one non-blank image.** Two captions, two images, an image with no caption, a caption with
  no image: attach nothing. The refusal is *recorded* rather than dropped, for the same reason
  `out-of-time` exists in `Assets` — so "we looked and refused" stays distinguishable from "we never
  looked", and the next version can measure whether order-matching would have been safe.
- **No order-matching, no bounding boxes, no descriptions in v1.** Two-column layouts and captions
  that sit on the next page break order-matching, and there is nothing to check it against.
- **The reader should be told**, in one muted line inside the empty figure, when nothing was
  recovered. Greg read a designed placeholder as a bug; a stranger will too. No bracketed code —
  this is not a failure the reader triggered.
- **Extraction must be a separate step from transcription**, so that adding it invalidates nothing
  already paid for.
- **Cap the decode before allocating.** `data.length === width*height*4` means a 5000×4000 raster
  is 80 MB decoded, inside the Vercel function stage 2 runs in, with no rasteriser to downscale
  with. Refuse on the declared dimensions, before the bytes are asked for.
- **`kind` 1 (`GRAYSCALE_1BPP`) exists** and must be handled or refused explicitly, never fallen
  through. The corpus only exercises 2 and 3.

## Stages

Each ends with the gates green and the tree safe to commit. Nothing a reader sees changes until D.
Greg's two calls, 2026-09-06: **delivery is generic but lands PDF-only first**, then web images are
switched on in the same piece of work; and an unrecovered figure gets **a muted line plus a link to
the original**.

| | Stage | Lands | State |
|---|---|---|---|
| A | **The pure module** | `src/pdf-figures.ts` — the transparency rule, the validator, the PNG writer, the pairing gate, the ref. No pdf.js, no store. | done `0297784f`, reviewed `93d565b4` |
| B | **The extraction** | real XObjects out of a real PDF through `loadPdfjs`, `maxImageSize` on the document, pinned against the eight known-real and eight known-blank keys. | done `06ed314b`, reviewed `a6b1ce49` (one P0) |
| C | **The marker, the manifest and the step** | `data-spya-pdf-figure` in `renderHtml` and `src/reserved.ts`; `pdfFigures` on `Assets`; the assets step extended; **the freshness stamp fixed in both its homes and `ASSETS_VERSION` bumped**. Nothing served yet. | done `87359bca` |
| D | **Delivery and the prose** | the generic asset route after `sendPlate`; `rehostImages` after `sanitizeArticle`; the muted line and its link; the open-the-original icon. PDF figures only. **The first stage a reader can see.** | in progress |
| E | **Web images through the same door** | the article's own images switched on — 260829b's stages C and D finished, and readers stop announcing themselves to publishers' CDNs. | |
| F | **Proof and docs** | the browser pass on a real ingest, `article-images.md`, `content-extraction.md`, `export.md`, this file. | |

**Done looks like:** the Analog Cognition PDF re-ingested locally against Postgres shows eight
figures under their eight captions; the ball-lightning paper shows four and refuses the masthead;
the Wellcome scan shows none and staples no page of the book under a caption; `evals/pdf/easy` —
which has no raster at all — is untouched and costs nothing; and no reader's browser fetches
anything from a publisher.
