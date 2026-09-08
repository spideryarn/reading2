# The monkeys illustration did not load

**[SPIDERYARN-READING2-2B](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2B)** ·
reported 2026-09-07 07:35:52 UTC · kind: problem · from an admin · *shipped*

> The illustration of the smoking & drinking monkeys doesn't load/show

Slug `after-work-we-ll-have-each-other-spya-rqztkp`, block `spya-km50p0`, build `84521f3b`.

**Status: finished, and landed on `dev`.** Both GPT Sol reviews are in and were acted on in full —
the second one changed the fix rather than polishing it (§ *And `srcset` had to go too*). `npm run
check` is green on the merged tree, all gates: typecheck 1664 files, build, **863 test files /
16 865 tests**, cycles, chain, conflicts, committed. Not deployed — production is Greg's. Three
remainders are named below and deliberately not built; the two that matter are decisions for Greg
rather than work anybody is part-way through.

**The short version.** It is an article's own figure, not a generated plate. The reader's browser was
hot-linking `asteriskmag.com`, which serves its AVIF variants as `Content-Type: text/plain` with
`X-Content-Type-Options: nosniff` — so Chrome's opaque-response blocking refuses them outright
(`net::ERR_BLOCKED_BY_ORB`, measured), and a `<picture>` that has already chosen a `<source>` **has no
way back to the `<img>`**. Nothing of ours errored, which is why there was no Sentry event and no
server log to find.

**The reported symptom was already cured.** Stage E
([`5f79493b`](#the-fix-existed-before-the-report-and-reached-production-after-it), 2026-09-06 17:14)
serves the figure from us and deletes the `<source>` elements on the way past; it reached production
later on 2026-09-07, after the report. Verified by looking at the real article, on real ingested
bytes.

**But the cure had a hole in it, and that is what this actually ships.** Holding a copy is not enough:
if *delivery* of it fails, the second draw restores the publisher's markup verbatim — `<source>` and
all — and the figure is blank for the rest of the read. GPT Sol found it reviewing this plan.
`ImagePlacement` gains an `unverified` case that keeps the publisher's `src` — the one URL our
pipeline actually fetched and sniffed — and drops every other candidate we were never in a position
to check: the `<source>` elements, and the `<img>`'s own `srcset` and `sizes` with them. **Keeping the
`srcset` was this fix's own first draft and was the same bug one level down**; Sol's second review
caught that too.

What this report *is* good for is that it supplies the one thing
[260829b](260829b-hosting-the-articles-images.md) § What the corpus cannot tell us said it could not:
**a real `<picture>`, from a real publisher, whose `<source>` really breaks.** That plan had to build
its `<source>` guard against a synthetic fixture. The guard was right, and this is the evidence.

## Which of the two features this is, decided by looking

An article's own figure, rehosted at stage 4.5 ([article-images.md](../project/article-images.md)) —
not an illustrated-diagram plate ([diagram.md](../project/diagram.md)). The block's own caption says
so:

> David Teniers the Younger (–1690), *Smoking and drinking monkeys,* c. 1660, oil on panel.

It is `<figure id="…">` / `kind: "media"`, ordinal 27 of 97, one of three figures the piece carries.
The `illustrated` step did run on this article, but not until **07:48** — thirteen minutes *after* the
report, and `GET /api/illustrated/…` answered `404` at 07:37. There were no plates to complain about.

## The timeline, off the production log

`mcp__vercel__get_runtime_logs`, project `spideryarn-reading2`, 2026-09-07:

| time (UTC) | |
|---|---|
| 07:33:33 | job queued — `fetch, extract, blocks, hierarchy, assets` |
| 07:34:58.882 | `assets …: 3 stored, 0 failed` — **all three figures stored, 14 s before the reader opened it** |
| 07:34:58.949 | revision published |
| 07:35:12.288 | `GET /api/article/…` 200 — the reader opens the article |
| 07:35:52.560 | `feedback report filed` |
| 17:31:36 | a later visit: `GET /api/asset/…{52f5573f…png, 725c8f2f…png, 30b36f28….jpeg}` → **200, 200, 200** |

Two things fall out of it.

**We held the picture the whole time.** The three `sha256`s in the manifest are byte-for-byte the
three files `asteriskmag.com` serves today — checked by downloading them and hashing:
`52f5573f…` *is* `collier02_david_teniers-300x.png`, the monkeys.

**And at 07:35 the reader's browser asked us for none of them.** Not one `/api/asset/…` request in
the whole window; the three at 17:31 are the only ones in twenty-four hours. That is not a fault —
production was running `dpl_6k5BVhwbq…`, which is commit `84521f3b` exactly as the report says, and at
that commit `rehostImages` handled **PDF figures only** (`figuresToDraw`, `mightHaveFigure`). The
article's own images were still hot-linked, by design, because the code that changed it had not
shipped yet.

## The mechanism

So the reader was looking at the publisher's own markup, and this is what it is:

```html
<figure id="spya-zvpebu">
  <picture>
    <source srcset="…collier02_david_teniers-600x-q64-sharpen50.avif 600w, …1920w"
            sizes="(min-width: 768px) 750px, 100vw" type="image/avif">
    <img src="…collier02_david_teniers-300x.png" alt="illustration"
         srcset="…-600x-sharpen50.png 600w, … …-1920x-sharpen50.png 1920w"
         sizes="(min-width: 768px) 750px, 100vw">
  </picture>
  <figcaption>David Teniers the Younger (–1690), <em>Smoking and drinking monkeys,</em> c. 1660…</figcaption>
</figure>
```

Chrome supports AVIF, so the `<source>` matches on `type` and wins. Then:

```
$ curl -I …/collier02_david_teniers-600x-q64-sharpen50.avif
HTTP/2 200
server: nginx
content-type: text/plain            ← not image/avif
x-content-type-options: nosniff     ← and we are not allowed to sniff past it
```

The bytes are a perfectly good AVIF — `00000020 66747970 61766966` (`ftypavif`) — and nginx is
mislabelling them.

**And the layer this is refused at is worth naming, because the obvious guess is wrong.** `nosniff`
does not generically block image destinations: the Fetch Standard's nosniff check covers `script` and
`style`. What actually happens is **ORB** — Chrome's opaque-response blocking rejects a cross-origin
response whose declared type is `text/plain` and which carries `nosniff`, so the bytes never reach the
image decoder at all. The observed failure is `net::ERR_BLOCKED_BY_ORB` on the request, not a decode
error. GPT Sol corrected this, and it was then measured rather than taken on trust.

**The `<img>` beneath it is never reached**: `<picture>` picks one source and that decision is final,
so a `<source>` that fails costs the reader the picture even though a working PNG is sitting right
there in the markup.

All five AVIF widths answer the same way, and so do the other two figures' — checked, all three
stems, `content-type: text/plain` with `nosniff` on every one. So all three figures were handed an
unusable `<source>`; the monkeys is the one whose blankness was reproduced in a browser, and the one
the reader named.

### Reproduced, rather than reasoned about

The paragraph above is browser semantics, and browser semantics is exactly the kind of thing that is
90% right in an agent's head. So it was run: headless Chrome, `page.setContent` with the markup as it
sits in `revision_blocks.html`, and then the same markup with the `<source>` taken out.

```
publisher markup, as ingested      {"currentSrc":"…-1200x-q64-sharpen50.avif","naturalWidth":0,"complete":true}
the same, with <source> removed    {"currentSrc":"…-300x.png","naturalWidth":300,"complete":true}
```

`complete: true` with `naturalWidth: 0` **is** the blank box: the request settled, ORB refused the
response, and the `<img>`'s own PNG — which the second line proves works — was never asked for. That
is the reader's screen, reproduced from their article's own bytes. It also rules out the cheaper
explanations, which is what the run was for: not CSS, not extraction, not a broken PNG.

Nothing of ours is involved, which is exactly why the usual routes found nothing: no exception, no
Sentry issue, no non-200 in our log. The `has_linked_error=false` on the report was telling the
truth. **A client-side image failure raises nothing at all** — worth remembering next time a report
says "doesn't load", because the precedent the loop reaches for
([260903_1557](../user-feedback/260903_1557-couldnt-upload-pdf.md), solved by an error 86 seconds
earlier) cannot repeat on this class.

## The fix existed before the report, and reached production after it

`5f79493b` — *"A hundred and two images, and a blank box is the honest way to show them"* — is stage E
of [260906a](260906a-figures-from-a-pdf-are-placeholders-with-no-image.md), committed 2026-09-06
17:14 — **38 minutes after `84521f3b` was cut**, and so about fourteen hours before the report was
filed. It had sat on `dev` the whole time; what production was running was the older build. It makes the article's own images come from us,
and `swapImages` (src/web/rehost.ts) removes the `<source>` siblings of any image it rewrites — on
**both** draws, which the commit message notes was itself a bug caught in review.

That is a complete cure for this failure and not by luck: once we serve the bytes, no `<source>` is
left for the publisher's nginx to mislabel.

It reached production **later on 2026-09-07, after the report**: the 17:31 asset requests are on
`dpl_7JwmFJaC5v…`, which is
commit `c0fb04a4` — a different deployment from the 07:35 one, and `git merge-base --is-ancestor`
confirms `5f79493b` is in it. `c0fb04a4` is what production serves today, so **the cure is live**, and
the three `200`s are it working on this reader's own article.

### Verified by looking, on the real article

The URL is a private article, so it was reproduced end to end instead: the same source URL ingested
into the local Postgres, which produced **97 blocks — the same 97 — and a manifest whose three
`sha256`s match production's exactly**. Then signed in with `scripts/browser-sign-in.ts` against this
worktree's own server and measured:

| | |
|---|---|
| first draw | `src`, `srcset` and `sizes` gone; `picture source` count **0** |
| second draw | `src` is a `blob:`, `naturalWidth` **300**, rendered 311 px |
| the figure | drawn, correctly, under its caption — screenshot in the worktree |

So the reported symptom is gone on current `dev`.

## What lands here

The cure for the reported symptom already existed, so most of this is evidence — **but the review
found a live hole in it, and that is a real fix.**

### The publisher's `<picture>` must not come all the way back

The second draw is rebuilt from the *original* html, which is what makes *an image whose fetch failed
goes back to hot-linking* fall out of the design rather than needing a stash. It is a good design and
it has one bad case: **restoring the markup verbatim restores the `<source>` with it.** So an image we
hold a copy of and fail to *deliver* — a 500 from our own asset route, or the `IMAGE_WAIT_MS` deadline
on a slow connection — goes back to a `<picture>` that on this publisher cannot work at all. Blank
first, because the first draw blanked it; blank afterwards, because the fallback restored something
ORB will refuse.

So the plan's first draft said *"once we hold a copy we are immune"*, and that was **wrong**. GPT Sol
found it. `ImagePlacement` gains a third case, `unverified`: the publisher serves this one after all,
so their `src` stays. Healthy images we hold no copy of are still not touched at all, which is what
makes this cheap.

#### And `srcset` had to go too, which the first version of this fix got wrong

The first version kept the `srcset` as well, on the reasoning that it was *"every width they offered,
more than we would have served"*. **Sol's code review — the second one — killed that**, and it was
right:

- The `srcset` is exactly as unchecked as the `<source>`. `imageSourceOf` reads `img[src]` and
  nothing else, so the pipeline fetched and sniffed one URL out of five and vouches for that one.
- Worse, it is not a fallback. **A `srcset` with `w` descriptors takes `src` out of the candidate set
  altogether**, so a candidate that will not load has nothing beneath it — the same failure as the
  poisoned `<source>`, one level down, on markup where the descriptors are `600w, 1920w`.

Measured rather than read off the spec, in Chrome, on this fixture's own attribute shape:

| markup | result |
|---|---|
| good `src`, broken `srcset` with `w` descriptors | **blank** — `naturalWidth: 0`, `currentSrc` the broken candidate |
| good `src`, broken `srcset` with `x` descriptors | draws — `src` is itself the 1× candidate |
| good `src` alone, `srcset` stripped | draws |

So `unverified` keeps the `src` and drops **every** other candidate. The rule it implements is one
sentence — *the only publisher URL we ever leave behind is the one we actually fetched* — and all
three placements now share the single helper (`dropCandidates`) that enforces it, which is a better
answer to *"the removals must not drift apart between branches"* than the two-of-three the first
version had.

The cost is real and worth naming: on a delivery failure the reader loses responsive resolution and
gets whatever width the publisher chose for `src` — here a 300 px thumbnail. That is a worse picture
than the `srcset` would have given **when the `srcset` works**, and a picture rather than a blank box
when it does not. Reachability wins over resolution on a path that only runs when something is
already broken.

Both tests went red first, and each goes red only for its own guard — checked by mutation, not by
reading:

| mutation | what goes red |
|---|---|
| `unverified` drops `<source>` only, keeping `srcset` (the first version) | `leaves the verified src as the only candidate when delivery fails`, and nothing else |
| the `wanted.images.has(url)` guard removed | `leaves a picture we hold no copy of completely alone`, and nothing else |

That second test is also new, and it closes a gap Sol found: every other failure test here holds no
stored image at all, so `rehostImages` returns before the callback and the guard was never asked. An
article with one image we hold and one `<picture>` we do not asks it.

`rebuild`'s promise that an untouched article comes back as the very same block objects is kept: a
bare `<img>` with nothing to drop is not a change, so `dropCandidates` reports whether it removed
anything and `unverified` marks the block changed only when it did.

### And the evidence

- **`tests/rehost.test.ts` gains this article's real markup** alongside — not instead of — the
  synthetic `noemamag.imgix.net` fixture, which keeps two `<source>` types the real one does not
  have. The comment above it that said *"The corpus has no `<picture>` at all"* is corrected: it was
  true when it was written, and this report is the counter-example. A guard built against an invented
  fixture and vindicated by a real one is worth saying out loud.
- **[article-images.md](../project/article-images.md)** gains the mechanism above, because *"the
  publisher mislabels a `<source>` and `<picture>` has no fallback"* is not a thing anybody would
  re-derive, and it is the strongest argument the feature has for existing.
- This plan doc and [the note](../user-feedback/260907_0735-the-monkeys-illustration-does-not-load.md).

**No defence was touched.** The fix needed nothing from
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
— in particular nothing in `src/fetch.ts`, and no size cap moved. `src/assets.ts` and
`src/web/rehost.ts` were `pdf-figures-stage-f`'s to own; **stage F landed on 2026-09-07 at 02:03
(`1e2637f9`)**, so the claim is spent and there was nothing to collide with. `src/assets.ts` is
untouched; `src/web/rehost.ts` is where the fix lives and is the only source file edited here.

## The simpler thing this passed over, and the decision left for Greg

### The picture we serve is the smallest one the publisher offers

`imageSourceOf` takes `img[src]` and nothing else — Sol's call in
[260829b's review](260829b-hosting-the-articles-images-review-sol.md), point 3: *"Fetch the actual
`img[src]` in v1 … fetching the largest responsive candidate has not been measured … Leave it until a
real example justifies another branch."* That was right, and **this is the real example.**

On this publisher the `src` is the **300 px** thumbnail and the `srcset` runs to 1920. We store the
300, then delete the `srcset` and the `<source>`s that carried the rest. Measured on this worktree at
a 1280×900 viewport:

| | width |
|---|---|
| the image we serve | **300 px** |
| the figure sheet it sits in | 659 px |
| the ⤢ lightbox panel — *"as big as the window will allow"* | 541 px |
| rendered, in both | 311 px |

So **the enlarge gesture now has nothing to enlarge.** Before stage E a reader who pressed ⤢ got
whatever the publisher's `sizes` chose, up to 1920; now they get the thumbnail, at the same size it
was on the page. That is a real loss and it is on the article in this report — but it is *not* what
was reported, and it is not blurry: `width: auto` in lightbox.css means the 300 px image is drawn at
300 px rather than stretched.

**It is a trade, not a bug, and the numbers are ugly in both directions.** For this one figure:

| variant | bytes | |
|---|---|---|
| `300x.png` — what we store today | **126 KB** | the thumbnail |
| `600x.png` | 576 KB | |
| `840x.png` | 1.08 MB | |
| `1200x`/`1440x`/`1920x.png` | 1.61 MB | the publisher caps out at 1200 |
| `1200x…avif` — what the publisher actually sends | 164 KB | **and we cannot take it** |

The AVIF is the whole point of the publisher's markup and it is ten times smaller, and it is exactly
what `sniffImage` refuses: `SIGNATURES` (src/assets.ts) knows PNG, JPEG and GIF only, so an AVIF or a
WebP comes back `unsupported-format`. Upgrading width therefore means **PNG at 1.6 MB a figure**,
~4.8 MB for this article against 255 KB today. On the 102-image article in 260906a's measurements that
direction runs into `MAX_ARTICLE_BYTES` and starts recording `budget` failures — turning images that
work today into hot-linked ones.

**So there are two questions and they are Greg's, not an unattended run's:**

1. **Do we want a bigger picture at all?** The reading view is 659 px and the lightbox 541 px, so
   ~1280 device px is the honest target — `600x` at 576 KB is arguably enough, `1200x` at 1.6 MB is
   certainly enough and probably too much.
2. **Or is the answer to reach the publisher's AVIF**, which is the version that makes their own
   economics available to us instead of fighting them — 164 KB where their PNG is 1.6 MB?

   **Adding AVIF and WebP to `sniffImage` is not that change, and on its own it would do nothing at
   all.** Sol's correction, and it is right: those URLs are never selected, because `imageSourceOf`
   reads the fallback `img[src]` and nothing else. Reaching them needs candidate selection *and* the
   magic bytes *and* `AssetExt`, the manifest's `ext`/`contentType` semantics, the bucket's MIME
   configuration and the delivery tests. It is a project, not a branch. `sniffImage`'s own comment
   already frames the cost — *"widening this list means deciding how the new format is served"* — and
   the hard case it names is **SVG**, a document that runs script when navigated to, which the
   `blob:` URL an owned asset arrives through carries no CSP into. AVIF and WebP have none of that
   problem, so they are the tractable half of that sentence, but only alongside (1).

   There is an irony worth noting on the way past: format sniffing here is deliberate — bytes decide,
   never the URL and never the `Content-Type` — and it is precisely the rule that would have saved
   this reader if `asteriskmag.com`'s nginx had applied it.

Both were left unbuilt on purpose. Picking a width — or opening a new format — is a product call with
a real cost to every reader's download, and CLAUDE.md § Simplest version first says to name it at the
point of choosing rather than let Greg inherit it.

### And the hole that is left after the fix above

`unverified` closes the case where we hold a copy. It does **not** close the case where we hold none —
an entry the assets step recorded as `failed` (whatever the reason: `unsupported-format`, `too-big`,
`blocked`, `network`, `out-of-time`, `budget`, `storage`), or a revision that predates the step. There
the publisher's `<picture>` is left exactly as it arrived, unusable `<source>` and all, and the reader
gets the blank box this report is about with no fallback and no error.

Two candidate fixes, both rejected here rather than overlooked:

- **Strip `<source>` unconditionally.** It would take the publisher's AVIF away from every reader on
  every image we do not host, to protect the small set where a `<source>` is broken — on this article,
  trading 164 KB for 1.6 MB. It also means `rehostImages` can no longer return early on an article we
  hold nothing for, which is the parse-and-serialise cost `mightNeedRehosting` exists to avoid.
- **React to the `<img>`'s `error` event**, Sol's suggestion and the better one: on `error`, drop the
  sibling `<source>`s and let selection re-run against the `<img>`'s own `srcset`; on a second error,
  drop `srcset`/`sizes` and try the bare `src`; record the stage so it cannot loop and survives a
  prose re-render. **It costs a healthy image nothing**, which is the property the first option lacks.
  Note that the second stage is not a nicety: the `w`-descriptor measurement above says a `srcset`
  that fails has no `src` beneath it, so a cascade that stops after dropping `<source>` would still
  leave this class of image blank.

The second is the right answer and it is not this report's to build: it is imperative DOM state on
elements React re-renders from `block.html`, which is the exact hazard `rehostImages` was restructured
to avoid in stage E (*"an imperative `src` written into the live DOM would be erased the next time
`TableView` re-renders a block's html"*). Doing it properly means an ordinary state transition, not an
event handler that writes attributes — and that is a design worth its own plan rather than a corner of
this one.

### And one exceptional path `unverified` does not reach

`unverified` is handed out by `rehostImages`' second-draw callback, so it covers every failure that
callback gets to see — and that is all the ordinary ones, because `imageSources` absorbs each image's
HTTP error, network error, abort and deadline individually. What it does not cover is the whole
second-draw chain *rejecting*: `resolveAccess`'s `.catch(() => accessWith(clean))`
(`src/web/article/access.ts:389`) then restores the sanitised article with the publishers' own URLs
in it, poisoned `<source>` included.

**That catch is right and is not being changed here.** Its own comment gives the reason: falling back
to `null` would leave the *first* draw standing, and that draw has every stored image's `src` removed
— so an unexpected throw would cost the reader every picture for ever rather than one. `clean` is
strictly better than that, and on all but this one publisher it is a working article.

It is recorded because the earlier draft of this plan said the fix held *"on every path"*, and that
was an overclaim Sol caught. The honest version: every path that fails one image, and not the
exceptional one that fails the whole draw.

### And one loose thread, found on the way past and not pulled

The two `<img>` gates are **not the same regex**, and a comment says they are.
`src/web/rehost.ts:272` is `/<img[\s/>]/i`; `src/collect-assets.ts:300` is `/<img[\s>]/i`. The
comment above the first one states the invariant plainly — *"the same gate is asked by the walk that
decides what to fetch and by the pass that rewrites, deliberately: two gates that disagree would
fetch bytes nothing inserts, or — the silent direction — insert nothing for bytes we hold"* — and
then the second one is a separate literal that has drifted by one character.

**It cannot bite today**: stored html is jsdom-serialised, so every tag is `<img src=…>` with a
space, and neither `/` nor the disagreement is reachable. What is wrong is that a stated invariant is
false in the source, which is the condition under which it eventually stops being harmless. One
shared constant would fix it; it is not this report's to fix, and it needs a home that both a
Node-side module and a browser-side one may import.

## What this cost, and one thing that got cheaper

The whole diagnosis came off two sources and neither was Sentry: the **Vercel runtime log** for the
timeline and the deployment id, and **a local re-ingest of the same URL** for the markup and the
manifest. `$0.20` of pipeline model spend, no production access, and nothing written anywhere but the
local dev database.
