# The article's own images

The pictures the article came with — figures, equations, data tables rendered as PNGs. Stage 4.5
fetches them at ingest and stores them beside the document, and the reading view serves them from us.

Everything below is intent and signposts. The mechanism is in
[`src/assets.ts`](../../src/assets.ts) (pure: which URLs, what the bytes turn out to be, the map the
reader looks a URL up in) and [`src/collect-assets.ts`](../../src/collect-assets.ts) (the network,
the budget and the bucket), both of which explain themselves at length. The reasoning, the options
weighed and the review that found a blocker are in
[260829b-hosting-the-articles-images.md](../plans/260829b-hosting-the-articles-images.md).

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
- **The politeness gate is global, and it is all the politeness there is.** There is no per-host
  throttle anywhere in this repo; job concurrency was 1 and that was the entire story until one
  article became up to 200 requests. `GATE` admits two at a time *across the process* — not two per
  article, which is the same unbounded number wearing a limit's name.

## Freshness

`assets` is one of the stages fingerprinted on a content hash, and its hash input is **the blocks
alone** — honestly so: it fetches the images the blocks name, and has no prompt and no head.
[architecture.md § Conventions](architecture.md#conventions).

## See also

- [fetching.md](fetching.md) — stage 1, and the address guard these URLs made necessary
- [database.md](database.md) — where the bytes live, and what the bucket will accept
- [export.md](export.md) — `content/assets.json` names every image, its hash, type and source URL, so
  a bundle *names* everything even though the bytes stay behind
- [security.md](security.md) — the sanitiser's view of what an article may point at
