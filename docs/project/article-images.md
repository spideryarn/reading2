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
  API, deliberately. **Both footings fetch the bytes and put a `blob:` in the `src`** — an owner
  because an `<img>` cannot carry a bearer token, a visitor because a `src` nobody checked is a
  broken rectangle when the answer is a 404. The file's header has the trade that buys and its cost.

**Both halves are switched on since 2026-09-06.** Greg's sequencing was: build the mechanism
generic, land it PDF-only, prove it, then flip the article's own images on. That last step was one
addition to `rehost.ts` and no change to a route at all — `storedAssetFor` already searched both
collections.

### The two draws, and why an image is blank for a moment

A PDF figure and a web image are not the same job, and the difference decides the shape of the whole
delivery path:

| | a PDF figure | an article's own image |
|---|---|---|
| in the stored html | an empty `<figure>` and a caption | a working `<img src>` at the publisher |
| what the reader gets | an `<img>` **inserted** | the `src` **replaced** |
| if we cannot | a caption on its own | the publisher's URL, exactly as before |

So a web image always has somewhere to fall back to and a PDF figure never does — and the rewrite
still cannot wait for the bytes, for two reasons that pull opposite ways:

- **A stored image's publisher URL must not reach the DOM while our copy is on its way.** Render
  the block and swap our copy in a moment later and the browser has already fetched from the
  publisher: the reader has been counted, invisibly, on every read, with the feature reporting
  success. The plan says it in bold — *"Do not render the publisher URL while a stored asset is
  resolving."* It is deliberately a rule about *that window only*: a `failed` entry, an entry the
  step never looked at, and an image whose fetch we gave up on all go back to the publisher's URL,
  because the alternative is taking a working picture off the page.
- **And the prose must not wait for the pictures.** Measured on the local corpus 2026-09-06, the
  worst article we hold carries **102 stored images totalling 7.04 MB**, above and below the fold
  alike; the median article carries 3 and 0.16 MB. Blocking on the first turns *the prose appears*
  into *the prose appears once every image has downloaded*.

`rehostImages` therefore hands back **two articles**: one to draw at once, with the PDF figures in it
and every image we hold a copy of stripped of its `src`, `srcset`, `sizes` and sibling `<source>`;
and a promise of the same article with the copies in. `useArticleAccess`
([`src/web/article/access.ts`](../../src/web/article/access.ts)) draws the first and replaces it
with the second — an
ordinary state transition, because an `src` written imperatively into the live DOM would be erased
the next time `TableView` re-rendered that block. GPT Sol, 2026-09-06.

**A load owns its fetches and its object URLs, and the claim is made synchronously in the effect.**
It used to be claimed inside `rehostImages` — which runs only *after* the article payload has come
back, so whose turn it was got decided by which HTTP request finished last: a slow article returning
after the reader had moved on would revoke the object URLs of the article now on screen and abort its
fetches, blanking it. `ArticleLoad` in [`src/web/rehost.ts`](../../src/web/rehost.ts) has the
sequence written out. The effect's cleanup releases it, which is also the only thing that frees a
load the reader abandoned for the shelf, for an unshared article, or for a payload that never came.

The costs, named rather than discovered: **an image we hold is blank between the two draws** — a few
hundred milliseconds on the corpus — and the publisher's `width`/`height` are left on the element
precisely so the browser can still reserve the box. `IMAGE_WAIT_MS` bounds it at 15 s, which is not a
first-paint budget but the point at which we stop believing a fetch of ours will land and let the
publisher's URL back; without it one hung connection would leave every image on the article blank for
the rest of the read, because there is a single second draw rather than one per picture.
Delivering that second draw in batches is the fix if a slow image ever holds up the fast ones.

A deadline on the *first* draw was written and thrown away: at the deadline it would have put the
publisher's URL back into markup the reader was about to see, which is the sentence in bold above,
done deliberately.

**The figures do have a clock, and it is a different kind of thing.** `FIGURE_WAIT_MS` is not a
budget on latency but a ceiling on a hang: the figures *are* awaited before the first draw, so until
2026-09-07 one `/api/asset/…` that never answered meant the article never appeared at all — a blank
page rather than a blank picture, on a document we hold in full. Past the ceiling a figure is
caption-only, which is a state this feature already had, so the bound added no new reader-facing
words. Nothing healthy comes near it: the bytes come from our own bucket at a ~348 ms median, and
the largest figure in the corpus is 0.76 MB.

**And the guarantee is conditional on our own end working.** An image of ours that fails or times
out falls back to the publisher's URL, because the second draw is rebuilt from the original html —
so a manifest saying `stored` over a bucket that has lost the objects hands every reader straight
back to the CDN, with nothing reporting a failure. Measured on 2026-09-07: one article in the local
corpus had 102 of 102 `stored` and none of the objects, and every asset request answered 500. It
turned out to be a seeded fixture rather than anything this box ingested — every other article's
objects were present — but it is the shape the privacy claim fails in, and
[security.md](security.md) now says so.

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

### And a fourth reason, found by a reader rather than reasoned out

**A `<picture>` whose `<source>` is broken costs the reader the picture, and the working `<img>`
underneath it is never reached.** A `<source>` wins on `type` before any byte moves, and that
decision is final: there is no fallback the way there is for a `src` that 404s.

The real case, 2026-09-07: an Asterisk Magazine essay whose three figures are each a `<picture>` with
an AVIF `<source>` first. `asteriskmag.com` serves those `.avif` files as `content-type: text/plain`
with `x-content-type-options: nosniff`. The bytes are a valid AVIF; the label is wrong, and Chrome's
opaque-response blocking then refuses the response before the decoder sees it —
`net::ERR_BLOCKED_BY_ORB`, measured. All three figures were blank on a build that still hot-linked.
**Nothing of ours errored**: no exception, no Sentry event, no non-200 in our own log, and the report
arrived as prose from a reader.

Hosting the image cures it, and not by accident: `swapImages` deletes the `<source>` siblings of any
image it rewrites, so there is nothing left for a publisher to mislabel. That guard was built against
a synthetic fixture, because [260829b](../plans/260829b-hosting-the-articles-images.md) § What the
corpus cannot tell us found no `<picture>` in the corpus at all. **The corpus has one now**, it is in
`tests/rehost.test.ts`, and it arrived carrying exactly the failure the guard was invented for.

**Holding a copy is not by itself enough**, which is the half this cost us a second look to see. The
second draw is rebuilt from the original html — the design that makes *a failed fetch goes back to
hot-linking* need no stash — and rebuilding it verbatim puts the `<source>` back too. So an image we
hold and fail to *deliver* used to fall back to a `<picture>` that could not work. `ImagePlacement`'s
third case, `unverified`, is that: the publisher's `src` stays — the one URL we actually fetched and
sniffed, unless the step stored a bigger `srcset` candidate instead (below) — and every candidate we
never checked is dropped, the `<source>` elements and the `<img>`'s own `srcset` and `sizes` alike.

**The `srcset` has to go with it**, which is worth stating because it is the same trap wearing a
different hat and this fix's own first draft fell into it. A `srcset` is as unchecked as a `<source>`
— `imageSourceOf` reads `img[src]` and nothing else — and with `w` descriptors it does not merely
outrank the `src`, it removes it from the candidate list, so a broken candidate has nothing beneath
it. Measured in Chrome: with an unreachable `600w, 1920w` present the `<img>` is blank and
`currentSrc` is the broken candidate; with it gone the `src` draws.

One thing this still does *not* fix, in
[260908a](../plans/260908a-the-monkeys-illustration-did-not-load.md): an image we hold **no** copy of
is left with its `<picture>` whole, and is exposed to the same trick. (The width question that plan
also left open is answered by the trial below.)

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

- **An image is rehosted as a unit, named by its `src`.** Thirteen `<img>` elements in the
  corpus carry 46 `srcset` candidates between them — the same pictures at different widths, which
  content addressing cannot dedup, so fetching them all is 4× the requests and 2.7× the bytes for
  nothing a reader can see. And "the largest candidate" is not well defined once width descriptors,
  density descriptors, media queries and `<picture>` are in play (GPT Sol, 2026-08-29). At render
  `srcset`, `sizes` and any sibling `<source>` are **removed**, because a browser given a rewritten
  `src` and an untouched `srcset` prefers the `srcset` and goes on hot-linking while the page looks
  fixed. The removals are the same on both draws, in one loop, so the four lines that actually close
  the leak cannot drift apart between two copies of them.
- **Since 2026-09-11 the unit may carry one bigger picture than the `src`** — a trial Greg chose after
  the monkeys report showed a 300 px `src` under a 659 px column, and a ⤢ with nothing to enlarge.
  `preferredCandidateOf` ([`src/assets.ts`](../../src/assets.ts)) takes one candidate from the
  `<img>`'s own `srcset`: from a list of **widths**, the smallest at least 1,280 px wide, else the
  widest; from a list of **densities**, the highest above 1× and at most 2× — which is how Wikipedia
  marks every figure (the density half was added the same day, the Overseer's call on the plan's open
  question). Every other form, a mixed list included, keeps the `src`. The step fetches the candidate
  first, once, through the same guarded fetch, and falls back to the `src` on any failure. **The
  manifest is still keyed on the `src`**; the candidate is recorded as `from`, because keying on it
  would make every lookup miss. The version was not bumped: the candidates go into
  `assetsInputHash`, so only an article that has one reads stale — most Wikipedia articles among
  them — and nothing re-runs it on its own. On a real Asterisk diagram and chart this took a blur to
  legible labels for 10–11× the bytes, a few hundred KB each; a painting stored as PNG is the
  expensive case, at 1.6 MB. [260911a](../plans/260911a-figures-with-enough-resolution-to-read.md)
  has the evidence.
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
URLs and the PDF figure refs in the blocks — plus, only when there are any, the preferred `srcset`
candidates — and nothing else** — `assetsInputHash` in
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
