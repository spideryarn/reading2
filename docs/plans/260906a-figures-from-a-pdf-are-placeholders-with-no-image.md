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
| `evals/pdf/much-harder` (Wellcome scan) | 17 | 17 | **one full-page scan image per page**, every one 661×1024 at deflBpp ≈ 2.0 |

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

## What Sol settled, 2026-09-06

Full review in [260906a-figures-plan-review-sol.md](260906a-figures-plan-review-sol.md). The P0s
that changed the design are folded in above; the rest, held as build constraints:

- **The decode cap has to reach pdf.js itself.** Checking dimensions after `getOperatorList()` is
  too late — building the operator list is what decodes the image and sends the buffer. Pass
  `maxImageSize` to `getDocument`, which checks width × height *before* decoding. A refused image
  is recorded as "no recoverable raster", because pdf.js drops the operation entirely.
- **Cap the deliverable bytes at 4 MiB, not `MAX_IMAGE_BYTES`.** A Vercel function response is
  limited to 4.5 MB and `MAX_IMAGE_BYTES` is 16 MiB, so the existing cap and a proxying route
  contradict each other. The largest figure measured here is 756 KB, well inside it.
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

| | Stage | Lands | State |
|---|---|---|---|
| A | **The pure module** | `src/pdf-figures.ts` — the blankness rule, the PNG writer, the one-figure-one-image gate. No pdf.js, no network, no store. Tests on fixture pixel arrays. | |
| B | **The extraction** | reading real XObjects out of a real PDF, behind the pure module. Pinned against the four known-blank keys and the eight known-real ones in the table above. | |
| C | **Storage and the step** | `storeRawSource` for the bytes, the artefact, the step, its freshness hash. Nothing served yet. | |
| D | **Delivery and the prose** | `sendFigure` after `sendPlate`; `<img>` in the HTML; the honest line where nothing was recovered. **The first stage a reader can see.** | |
| E | **Proof and docs** | the browser pass on a real ingest, `article-images.md`, `content-extraction.md`, this file. | |

**Done looks like:** the Analog Cognition PDF re-ingested locally against Postgres shows eight
figures under their eight captions; the ball-lightning paper shows four and refuses the masthead;
the Wellcome scan shows none and staples no page of the book under a caption; and
`evals/pdf/easy` — which has no raster at all — is untouched and costs nothing.
