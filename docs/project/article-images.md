# The article's own images

The pictures the article came with — figures, equations, data tables rendered as PNGs. Stage 4.5
fetches them at ingest and stores them beside the document, and the reading view serves them from us.

Everything below is intent and signposts. The mechanism is in
[`src/assets.ts`](../../src/assets.ts) (pure: which URLs, what the bytes turn out to be, the map the
reader looks a URL up in) and [`src/collect-assets.ts`](../../src/collect-assets.ts) (the network,
the budget and the bucket), both of which explain themselves at length. The reasoning, the options
weighed and the review that found a blocker are in
[260829b-hosting-the-articles-images.md](../plans/260829b-hosting-the-articles-images.md).

## Delivery, and what is actually switched on

Storing was built first and **serving came a week later**, on 2026-09-06, with the PDF figures that
needed it ([260906a](../plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md), stage D).
Until then the step downloaded every image, hashed it, put it in the bucket and wrote a manifest —
and not one byte of it was ever served, so every reader was still hot-linking the publisher's CDN.

Three pieces, and all three are **generic**: they serve *an article's images*, and a PDF's figures
are the first kind to flow through them.

- [`src/asset-delivery.ts`](../../src/asset-delivery.ts) — which stored object a URL names, and how
  the URL is spelled. It searches both collections in the manifest.
- `GET /api/asset/:slug/:hash.:ext` ([`src/routes.ts`](../../src/routes.ts) § `sendArticleAsset`) for
  the owner, and `GET /api/public/asset/…` ([`src/public/routes.ts`](../../src/public/routes.ts))
  for a visitor, which re-asks the visibility question on every request.
  **The key is rebuilt from the manifest entry, never from the path** — the bucket is shared by every
  article and every reader, so a hash absent from *this* article's manifest is a 404 even for its
  owner.
- [`src/web/rehost.ts`](../../src/web/rehost.ts) — the rewrite, in the browser, **after**
  `sanitizeArticle`. It has to be after: `stripOwnApiUrls` deletes any `src` resolving to our own
  API, deliberately.

**What is switched on is PDF figures and nothing else.** Greg's sequencing, 2026-09-06: build the
mechanism generic, land it PDF-only, prove it, then flip the article's own images on — which is stage
E, and is one addition to `rehost.ts` rather than a route.

## Why host them rather than hot-link

Three reasons, and the third is the one that made it worth doing:

- Hotlinks rot.
- Publishers block by referer, so a figure that worked at ingest stops working later, for everyone.
- **Every reader's browser announces itself to the publisher's CDN on every read.** A reader of a
  piece in Spideryarn should not be a reader the publisher can count.

Greg, in [open-questions.md](open-questions.md), before it was built:

> If we are fetching every image at ingest, we could *host* them: hotlinks rot, publishers block by
> referer, and today every reader's browser announces itself to the publisher's CDN on every read.

It also closed a security gap rather than opening one. The argument for leaving DNS rebinding open
was that a URL comes from Greg's own text box; these come from the *page*, hundreds per article,
chosen by a publisher — so [fetching.md § DNS rebinding](fetching.md) had to be closed first.

## The one way to get this silently wrong

`blocks.json` stores `…&amp;s=3a2bee…`. `getAttribute("src")` returns `…&s=3a2bee…`. Build the
manifest from the stored string and look it up from the DOM and **every entry misses** — no error, no
broken image, just the publisher's URL left in place and a feature that appears to do nothing. Five
of the corpus's thirteen images carry a query string like that.

So both sides parse a DOM and read the attribute through the same function — `imageSourcesIn` in
[`src/assets.ts`](../../src/assets.ts), handed a jsdom node by the pipeline and a browser node by the
reading view. **The selection and the attribute read happen exactly once, in one place**, which is
the whole defence. [silent-success.md](../reusable/silent-success.md) is the family.

## Decisions worth knowing before changing anything

- **An image is rehosted as a unit: the `src`, never the `srcset`.** Thirteen `<img>` elements in the
  corpus carry 46 `srcset` candidates between them — the same pictures at different widths, which
  content addressing cannot dedup, so fetching them all is 4× the requests and 2.7× the bytes for
  nothing a reader can see. And "the largest candidate" is not well defined once width descriptors,
  density descriptors, media queries and `<picture>` are in play (GPT Sol, 2026-08-29). At render
  `srcset`, `sizes` and any sibling `<source>` are **removed**, because a browser given a rewritten
  `src` and an untouched `srcset` prefers the `srcset` and goes on hot-linking while the page looks
  fixed.
- **The format is earned from the bytes, never claimed by the URL or the `Content-Type`.**
  Publishers serve PNGs as `application/octet-stream` and bot walls serve HTML as `image/jpeg`.
  `sniffImage` decides, and the name we store *is* a claim about the contents — see
  [database.md § what the bucket will accept](database.md) for the other half of that line, and why
  SVG is refused on both sides.
- **One bad image must never fail the step.** An article is readable with a broken figure and
  unreadable with no article, so every per-image failure is recorded and the loop carries on. The
  manifest has three states and they are not interchangeable: `stored` is served by us, `failed`
  stays hot-linked, and **no entry at all** means this step never looked at the URL. That is why the
  wall-clock budget writes `out-of-time` entries rather than stopping — leave them out and the
  article reads as one ingested before the step existed.
- **The article's byte budget is reserved before a fetch starts, not charged after.** Summing
  finished downloads lets two concurrent responses overshoot between them; reserving a slice up front
  and passing it as that fetch's own `maxBytes` means the bytes in flight can never exceed what is
  left. The caps are `MAX_IMAGE_BYTES`, `MAX_ARTICLE_BYTES` and `MAX_IMAGES` in
  [`src/collect-assets.ts`](../../src/collect-assets.ts).
- **The PDF half has its own clock, its own article budget, and its own words for a failure.**
  [`src/collect-pdf-figures.ts`](../../src/collect-pdf-figures.ts) recovers no bytes over a network,
  so none of the machinery above applies to it — but the *shapes* do, and it copies them rather than
  inventing parallel ones: `PDF_FIGURES_BUDGET_MS` races the whole run and finalises every marker the
  race left behind, and `MAX_ARTICLE_FIGURE_BYTES` bounds what one document may store, because
  capping the marker count and the per-figure size still let 100 × 12 MiB through. Both numbers match
  their `collect-assets.ts` counterparts deliberately: the two halves are **alternatives**, since a
  PDF-made article has no `<img>` and a web article has no PDF, so an article costs at most one of
  them. The reasons are a vocabulary rather than a catch-all — `no-source`, `unreadable-pdf`,
  `storage`, `budget` and `out-of-time` say *whose* problem it is, for the reason `AssetFailure`
  keeps `storage` apart from `network`: the two need different people. All four were once spelled
  `out-of-time` (GPT Sol, C-4).
- **A figure ref carried by two elements refuses both.** The manifest is keyed by ref, so one entry
  is all there is; keeping the first meant the same picture appeared under two different captions —
  a fabricated claim about the paper the reader cannot detect. Both `pdfFigureMarkersIn` walks now
  count first and drop every occurrence (GPT Sol, C-5).
- **The politeness gate is global, and it is all the politeness there is.** There is no per-host
  throttle anywhere in this repo; job concurrency was 1 and that was the entire story until one
  article became up to 200 requests. `GATE` admits two at a time *across the process* — not two per
  article, which is the same unbounded number wearing a limit's name.

## Freshness

`assets` is one of the stages fingerprinted on a content hash, and its hash input is **the image
URLs and the PDF figure refs in the blocks, and nothing else** — `assetsInputHash` in
[`src/collect-assets.ts`](../../src/collect-assets.ts).
[architecture.md § Conventions](architecture.md#conventions).

It was `hashBlocks` until 2026-09-06, which reads like the same claim and is not: that hash covers a
block's `id`, `text`, `role` and `treatment` and **not** its `html`, so it could not see a PDF figure
marker arrive and a carried-forward empty manifest would have gone on reporting itself current for
ever. Stamping what the step actually consumes is the rule `articleFingerprint` states and three
other stages had already broken —
[260906a](../plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md).

## See also

- [fetching.md](fetching.md) — stage 1, and the address guard these URLs made necessary
- [database.md](database.md) — where the bytes live, and what the bucket will accept
- [export.md](export.md) — `content/assets.json` names every image, its hash, type and source URL, so
  a bundle *names* everything even though the bytes stay behind
- [security.md](security.md) — the sanitiser's view of what an article may point at
