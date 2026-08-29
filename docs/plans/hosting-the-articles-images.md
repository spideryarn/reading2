# Hosting the article's own images

**Status:** plan, not built. Written 2026-08-29, then **revised after GPT Sol's review** — which
found a blocker, and found one claim in the first draft that was simply false. Both are kept in
place rather than edited out, because a plan that hides what it got wrong teaches nobody.

Today an article's images are **hot-linked**. Stage 1 fetches the document and nothing else; the
`<img src>` in `blocks.json` still points at `content.wolfram.com` or `noemamag.imgix.net`, and it is
the *reader's browser* that goes and gets them, every time, from the publisher.

This plan makes the pipeline fetch them and store them alongside the document, and makes the reading
view serve them from us.

> Ok, let's fetch the images, equations, and other artifacts that we'll need, and store them
> alongside the source document in a subfolder inside the per-article folder in Supabase Storage.
>
> Am I right in thinking that we do store the original HTML there already? If not, we should.
>
> — Greg, 2026-08-29

## Greg's question: yes, and the layout is not what he pictured

**Yes, we store the original HTML in Supabase Storage.** Since 2026-08-27, `writeRaw`
([`src/fetch.ts:172`](../../src/fetch.ts)) puts *every* fetched document in the `sources` bucket, not
only uploaded PDFs — [raw-bytes-in-storage.md](raw-bytes-in-storage.md). Two things about it that
matter here:

- It stores the **decoded string**, not the bytes off the wire. `raw.html` is therefore not raw. That
  is why `RawManifest` carries two hashes: `sha256` is what the server sent, `storedSha256` is what
  we kept, and on a Shift_JIS page they differ.
- **There is no per-article folder in the bucket.** The layout is flat and content-addressed —
  `sha256/<hash>.html`, minted by `canonicalKey` ([`src/source.ts:150`](../../src/source.ts)). The
  per-article folder Greg is picturing is the *filesystem* store's `data/<slug>/`, and on the
  Postgres side it is one `article_revisions` row. Neither exists in Storage.

That flatness is load-bearing rather than incidental. The key **is** a claim about the contents, and
that is what makes the signed-upload-grant replay window harmless: a grant is only ever minted for a
`staging/<uuid>` key, a canonical key is never writable by one, and the bytes at a canonical name can
always be re-checked against the name. A per-article prefix would be a second naming scheme in the
same bucket with none of that property.

**So the recommendation is to keep content addressing and put the "per-article folder" in an
artefact instead.** Images go to `sha256/<hash>.<ext>` beside the document; a new per-article
artefact — `assets.json` — is the list saying *these objects are this article's*. Greg gets the view
he asked for, plus dedup that a folder layout cannot give: a publisher's logo across forty articles
is one object, and a re-ingest of the same article stores nothing new.

<a id="alternative-layout"></a>The alternative — `articles/<articleId>/images/<n>.png` — is written
out here so Sol can push back on it. It is more legible in the Supabase dashboard, and it makes
"delete this article's assets" a prefix delete. It costs the re-checkable-name property, duplicates
bytes across readers who saved the same piece, and needs a *second* invariant written down for why a
grant may not touch it. My call is that the dashboard legibility is not worth that, and that the
artefact gives the same answer to "what belongs to this article".

## Why do this at all

Four reasons, in the order they will actually bite:

1. **Equations are images, and ours are unreadable.** The Wolfram article's inline equations are
   transparent PNGs carrying black ink; on our black page they are invisible without the
   `--figure-sheet` mat that every figure currently gets whether it needs one or not. That is
   [Q11](../project/open-questions.md#q11), and it cannot be decided in the browser: the images are
   hot-linked cross-origin with no `crossorigin` attribute, so a canvas drawn from one is tainted and
   `getImageData` throws. **Node has no such rule.** Hosting the bytes is what unlocks the decision —
   not, as Greg first suggested, an LLM, and not incidentally: there *is* no model on stage 2's HTML
   path to hook one onto.
2. **Hot-links rot.** Five of the corpus's thirteen images are imgix URLs carrying an `s=<signature>`
   query parameter. A signature is a thing that can be rotated. When it is, the article silently
   loses its figures and nothing in our system knows.
3. **Publishers block by `Referer`.** `fetchDocument` deliberately sends none
   (`documentHeaders` in [`src/fetch.ts`](../../src/fetch.ts)) — fine for one document, and precisely the header many
   CDNs hotlink-check on. We are currently one policy change away from broken figures.
4. **Privacy.** Every reader's browser announces itself to the publisher's CDN on every read, with
   the reader's IP and User-Agent, once per image. Hosting the bytes ends that. This is the reason
   that fits [vision.md](../project/vision.md) best and the one nobody will ever file a bug about.

## What was measured, not assumed

Against the real corpus on 2026-08-29 — `data/*/blocks.json`, then a `curl -IL` per URL.

| | |
|---|---|
| Articles with any image | 3 of 8 |
| `<img>` elements | 13 |
| **`srcset` candidates behind those 13** | **46**, all on one article's 5 images |
| Distinct URLs if you fetch every candidate | 54 |
| Bytes, every candidate | **6.7 MB** |
| Bytes, `src` only | **2.46 MB** (13 objects) |
| Largest single object | 899 KB (`content.wolfram.com`, a Wolfram figure) |
| Median / p90 | 49 KB / 332 KB |
| HTTP status, all 54, plain curl | `200` — no hotlink blocking on this corpus *yet* |

**The `srcset` number is the finding.** One Noema article's five images carry forty-six candidates
between them — a ten-fold amplification — and they are the *same picture at different widths*, so
content addressing does not dedup them. Fetching every candidate would cost 2.7× the bytes and 4×
the requests to buy a reader nothing they can see. See [the srcset trap](#trap-1) below.

**One `<iframe>` survives into `blocks.json`** (a YouTube embed). The selector must be `img`, not
"anything with a `src`".

### What the corpus cannot tell us

The same scan, counting the shapes the design has branches for:

| Shape | In the corpus |
|---|---|
| `<picture>` | **0** |
| `<source>` | **0** |
| SVG images | **0** |
| `data:` URIs | **0** |
| Relative or protocol-relative `src` | **0** |
| `<video poster>` | **0** |
| Distinct hosts | **3** |
| `<img>` with no `alt` | 0 |
| `<figure>` | 12 |

So every real image we have is an absolute `https` URL to one of three hosts, all of which answer
`200` to a plain `curl`. **The corpus cannot redden most of the guards in this plan** — it has no
`<picture>` for the `<source>` trap, no SVG for the XSS question, no `data:` URI to skip, no failing
host to fall back from, and no second reader to prove dedup.

That is a fact about the evidence, not a reason to drop the guards; it is the reason each one needs a
**synthetic fixture that fails without it**. A guard whose fixture cannot go red is not a guard, and
"0 regressions across 8 articles" would here be a statement about code that never ran. Before any of
these is called done, name the fixture that breaks when it is deleted.

It also means the acceptance test in [build order](#build-order) step 8 is weaker than it looks: a
network trace over three articles proves the ordinary path and nothing else.

## Design

### The step

A new pipeline step **`assets`**, placed in `STEP_ORDER`
([`src/pipeline.ts:105`](../../src/pipeline.ts)) **after `toc` and before `arc`**, and in
`DEFAULT_INGEST_STEPS` so an ordinary ingest fetches images before the reader opens the piece.

It reads the `blocks` artefact — stage 4's `data/<slug>/blocks.json` — rather than `extractedHtml`,
for two reasons. It is what the reader will actually render, so we fetch exactly the URLs that will
be asked for; and it is already the input `inputHashFor` hashes
([`pipeline.ts:524`](../../src/pipeline.ts)), so freshness comes free from the existing stamp
machinery instead of needing a second one invented for this step.

Produces one artefact, `assets`.

### The artefact

`assets.json`, a `jsonb` column on `article_revisions`, carried across revisions.

```ts
export interface Assets {
  version: 1;
  /** The blocks hash this was built from — the ordinary stamp. */
  sourceHash: string;
  fetchedAt: string;
  entries: AssetEntry[];
}

export type AssetEntry =
  | {
      /** The URL exactly as `getAttribute("src")` returns it. See trap 3. */
      url: string;
      status: "stored";
      sha256: string;
      /** The extension the *bytes* earned, never the one the URL claimed. */
      ext: AssetExt;
      contentType: string;
      bytes: number;
      width: number | null;
      height: number | null;
    }
  | { url: string; status: "failed"; reason: AssetFailure; at: string };
```

**Three states, not two** — an entry that is `stored`, an entry that is `failed`, and a URL with no
entry at all, which means *this step has not looked at it*. Collapsing the last two is the mistake
[silent-success.md](../reusable/silent-success.md) keeps describing: an article ingested
before this step existed has no `assets` artefact, and that must read as "hot-link as before", not as
"every image failed".

### Where the bytes go

The existing **`sources` bucket**, at `sha256/<hash>.<ext>`, written through the existing
`storeRawSource` ([`src/store/blobs.ts:373`](../../src/store/blobs.ts)) — `putIfAbsent`, then read
back and hash to check that a dedup hit really is the bytes we wanted, rather than believing the
`409`.

**No new table and no migration for the bytes.** `storeRawSource` is bucket-side only; the
`raw_sources` row is written separately by the Postgres artefact store
([`artifacts-pg.ts:1050`](../../src/store/artifacts-pg.ts)) and exists so `article_revisions` can
foreign-key to *the document*. An image is not the document and needs no such row, so
`raw_sources.kind`'s `check (kind in ('pdf','html'))` stays as it is. The manifest artefact is the
record. Objects nothing references are kept on purpose — there is no sweeper to race
([`schema.ts:1265`](../../src/db/schema.ts)) — so orphaned image bytes are a known, accepted cost.

`canonicalKey` widens from `DocumentKind` to a `StoredKind = DocumentKind | AssetExt`. The
`SHA256_RE` guard stays exactly as it is.
### Fetching

`fetchDocument` **refuses an image by name** today: `sniffKind`
([`fetch.ts:741`](../../src/fetch.ts)) fails anything that is not HTML or PDF with
`unsupported-type`. But that file is also the only place holding `guardAddress`, the per-hop redirect
re-check, `readCapped` and the typed failure taxonomy, so this must reuse it rather than grow a
second, weaker fetcher next to it.

**Split the hop loop into a private `fetchBytes`**, and leave `fetchDocument` as the thin
document-shaped caller that adds `sniffKind` and the encoding sniff. `fetchAsset` sits beside it, in
the same module so `guardAddress` stays private. Sol endorsed the split and was specific that
`fetchBytes` must stay **private and narrow** — it is not a general-purpose fetcher for anything else
to reach for.

**What the refactor must not change**, in Sol's words rather than mine, because this is the most
security-sensitive file in the repo and "the tests still pass" is a weak argument for surgery on it:

- HTTP(S)-only parsing and redirect-scheme refusal
- guard **and pinned address** on every hop and retry
- manual redirect cap, loop detection, chain and final URL
- one deadline for the complete attempt, with fresh deadlines between retries
- cancellation of every abandoned or failed body
- decompressed arriving-byte cap, empty-body and `206` refusal
- status/retry classification against the failing hop
- caller cancellation during backoff
- the existing injected fetch/DNS/time/random seams
- document-specific headers, encoding sniff and `sniffKind` behaviour

<a id="dns-pinning"></a>

#### DNS rebinding closes here, not later

The first draft of this plan noted the known TOCTOU gap and moved on. **Sol's call is that this work
crosses the threshold that made moving on acceptable, and I agree.** The justification written at
`fetch.ts:475` is that an attacker must control both DNS *and* Greg's clipboard. Once we fetch image
URLs, the untrusted publisher chooses up to hundreds of addresses — the premise is simply gone.

So: resolve once per hop, reject any blocked answer, and **force the connection onto one of the
checked addresses** while preserving the original hostname for `Host`, TLS SNI and certificate
validation. Undici takes a request-local dispatcher, so this needs no change to the global network
stack. It lands as its own reviewable commit *before* any asset behaviour, and the test is a resolver
that answers public during the guard and private during the connection — **watch it fail before the
pinning, and pass after**.

#### What we fetch

**The `img[src]` URL, and nothing else.** Not the largest `srcset` candidate, which was the first
draft's answer and is the one thing Sol rejected outright in trap 1: "largest" is ill-defined across
width and density descriptors, media queries and `<picture>` types, and nothing has measured it. All
13 corpus images have a usable absolute `src`; that is the path with evidence behind it. An image
whose `src` is missing or a placeholder stays hot-linked until a real example justifies a branch.

`srcset`, `sizes` and any sibling `<source>` are then **removed** from the rendered copy — see
[trap 1](#trap-1) for why leaving them is a silent no-op.

<a id="limits"></a><a id="limits--policy-not-measurement"></a>

#### Limits — policy, not measurement

The measurements say 899 KB largest, 2.46 MB per article, 13 images. They do **not** derive the
numbers below, and the first draft implied they did. These are generous guards chosen on purpose:

| Limit | Value | Status |
|---|---|---|
| Bytes per image | 16 MiB | policy; clears the 899 KB maximum by a wide margin |
| Bytes per article | 64 MiB | policy; clears 2.46 MB |
| Images per article | 200 | policy; a runaway guard, not a budget |
| Concurrency | **one global queue at 2** | policy. The first draft said "4, and per host", which is either redundant or globally unbounded depending on how you read it |
| Timeout per image | 15 s | policy |

**The article byte counter charges bytes as they arrive**, not on completion. Summing finished
downloads lets concurrent responses overshoot the cap between them — the cap would hold on average
and fail exactly when several large images arrive at once.

#### No `Referer`

The first draft proposed sending the article's own URL, reasoning that a request with no referer is
the shape of a hotlinker. **That is a credential leak.** `meta.url` is the URL *after redirects*, and
this repo already excludes it from public payloads for precisely this reason — it can carry
credentials or signed query parameters ([`public-types.ts:27`](../../src/public-types.ts)). Our own
corpus proves it is not hypothetical: five imgix URLs carry an `s=<signature>`. Sending that to a
third party as a header is worse than the hotlink problem it solves.

And it solves nothing yet: all 54 measured URLs return `200` with no referer. **Send none.** If a
real host ever refuses, retry with the *origin* only — never path, query or userinfo.

<a id="delivery"></a>

### Delivery — the part the first draft got wrong

A native `<img src="/api/asset/…">` **cannot authenticate**. `requireUser`
([`auth.ts:324`](../../src/auth.ts)) accepts only an `Authorization: Bearer` header, and a browser's
own subresource load carries no headers. Every rewritten image would 401.

This is the tenth trap, and it is the shape this repo keeps writing up: pure rewrite tests green,
route authorisation tests green, every artefact test green, ordinary `401`s rather than crashes —
and every image broken.

**The repo has already solved this exact problem once.** `SourceLink.tsx` was an `<a href>` until
2026-08-27, hit the same wall the day the auth gate landed, and its header comment enumerates the
three ways out and rejects two of them: exempting the route (no — it serves a stranger's document
from our origin), and a token in the query string (no — it puts a credential in an address bar, a
history and a log line that `logging.md` cannot redact). It took the third. So does this.

**The first draft proposed option 1**, the one that file rejects by name. That is what a plan is for.

#### Two readers, two paths

| Reader | How the bytes arrive |
|---|---|
| Owner of a private article | `apiFetch` per asset with the Bearer token, then a `blob:` URL — following `SourceLink.tsx`, including revoking the URL |
| Signed-out or non-owning public reader | a new `GET /api/public/asset/…`, dispatched in the public namespace **before** the auth gate ([`routes.ts:3166`](../../src/routes.ts)) |

The public path is not optional. `App` falls back to public article loading for signed-out and
non-owning readers ([`App.tsx:380`](../../src/web/App.tsx)), and those readers can never reach an
authenticated route — so an owner-only design would leave every public article hot-linking while
looking finished from the owner's chair.

The public route checks **current** public visibility and exact manifest membership on every request,
and it uses `no-store` like the rest of the public namespace, **not** the year-long immutable header
the first draft proposed. That header was reasoned from content addressing and is wrong for a
different reason: making an article private again has to take effect immediately.

**Do not render the publisher URL while a stored asset is resolving.** Show a placeholder and
substitute the `blob:` or public URL when it arrives. Otherwise the privacy leak this feature exists
to close has already happened by the time the rewrite lands — and it would happen on every single
read, invisibly, with the feature reporting success.

Short-lived Supabase signed URLs stay a later optimisation. They work for private buckets, and they
stay valid until expiry, which complicates exactly the revocation the public route has to get right.

#### Authorisation

Both routes must check that the requested hash is the **exact `{status: "stored", sha256, ext}` entry
of the article's current revision**, and reconstruct the canonical key server-side from that entry —
never from anything in the path. The slug proves the reader may read *an* article; only the manifest
entry proves this object belongs to it. Without that, `/api/asset/<a-slug-I-own>/<hash-of-your-PDF>`
reads your document out of the shared bucket, because content addressing put it in the same place.

Headers on both: `Content-Type` from the sniffed format, never the origin's claim, plus
`X-Content-Type-Options: nosniff`.

#### SVG is not hosted in v1

The first draft argued for hosting SVG behind a sandbox CSP, on the grounds that refusing it "costs
exactly the case this feature is for, since MathJax and arXiv equations are SVG". **That sentence is
false and Sol caught it.** The case that prompted [Q11](../project/open-questions.md#q11) is seven
transparent **PNGs** on the Wolfram article, and the corpus contains zero SVGs of any kind.

The CSP itself was sound — `sandbox` does apply an iframe-like policy to the resource — but it does
not survive the delivery design above: a response's CSP **is not carried into a `blob:` URL** created
from it, which is precisely how owned assets now reach the page. So the mitigation would have been
inert exactly where it was needed.

An SVG `src` therefore records `status: "failed"`, reason `unsupported-format`, and stays
hot-linked. Revisit when a real article needs it, with the blob-URL interaction as the starting
point rather than a footnote.

### Rewriting in the reader

A pure pass `rehostImages(html, resolved)` in `src/web/rehost.ts`, run in `TableView`'s `proseHtml`
memo ([`TableView.tsx:404`](../../src/web/TableView.tsx)) alongside `annotateHtml` and
`addZoomHandles`.

**It must be client-side at render, and must not be baked into the stored markup.** The sanitiser
deliberately strips any `src`, `srcset` candidate, `href` or `url(...)` pointing at our own API —
`stripOwnApiUrls` ([`sanitize-policy.ts:412`](../../src/sanitize-policy.ts)) — because an article
must never make a reader's browser call our endpoints. Written into `blocks.json`, our rewrite would
be indistinguishable from a publisher's forgery, and stripping both is the correct behaviour. At
render it is downstream: `sanitizeArticle` runs once at load ([`App.tsx:492`](../../src/web/App.tsx)),
`proseHtml` recomputes long after.

**The tempting wrong answer, named so nobody re-derives it:** `isOwnApi` only fires on paths under
`/api/`, so a stored `src="/asset/<hash>"` *would* survive the sanitiser today. That is routing
around a guard by picking a name it does not cover, and it turns the guard into something that must
be re-read every time a route is added. Don't.

Attribute edits only, so the character offsets comment anchoring lives in are untouched — a test must
pin that the way `tests/zoomable.test.ts` pins "does not change the rendered text by one character",
because if it ever stops being true nothing throws and every comment in the article lands a few
characters to the left.

### The artefact's version field

`Assets.version` must be a **string** — `"assets/1"` — and be included in the expected stamp.

`stampOf` ([`artifacts.ts:590`](../../src/store/artifacts.ts)) reads `version` only
`if (typeof a.version === "string")`. The first draft's numeric `version: 1` would have been silently
dropped, so a change to URL selection, sniffing or failure handling would leave every existing
manifest reporting itself current on `sourceHash` alone, and no article would ever re-run the step.

And **`assets` must be added explicitly to both read projections.** `Article`
([`types.ts:1048`](../../src/types.ts)) carries only `meta`, `blocks`, `tree` and optional `arc`; the
filesystem loader returns exactly those fields ([`api.ts:231`](../../src/api.ts)); Postgres uses an
allowlisted projection ([`pg.ts:400`](../../src/store/pg.ts)). Making the field optional would let
every one of those omissions typecheck while the reader quietly went on hot-linking.

## The traps

Every one of these fails silently. That is why they are a list. Numbering is kept from the first
draft so the review maps onto it; two are struck through rather than deleted.

<a id="trap-1"></a>
**1. `srcset` silently beats `src`.** Rewrite `src` to our copy, leave `srcset` alone, and the
browser prefers a `srcset` candidate — so the page hot-links exactly as before while looking
completely fixed. Same for `<source srcset>` inside a `<picture>`, and `<img sizes>` once its
`srcset` is gone. **An image is rehosted as a unit:** rewrite `src`, delete `srcset`, `sizes` and any
sibling `<source>`. The test must assert the *absence* of the publisher host with a short needle —
the token, with word boundaries — not the presence of ours.

**2. `config.toml` does not change a bucket that already exists.** The `sources` bucket declares
`allowed_mime_types = ["application/pdf", "text/html"]`, and Storage **does** enforce that list
against the service key — a measured `415 InvalidMimeType`. Adding image types is a `PATCH` to the
live bucket, **locally and on the remote project, by hand**; the `config.toml` line documents what
was done rather than doing it. This pair of mistakes cost seven hours on 2026-08-27 —
[the-config-file-is-not-the-bucket.md](../postmortems/the-config-file-is-not-the-bucket.md). Run the
existing read-only [`scripts/check-buckets.ts`](../../scripts/check-buckets.ts) **before and after**
the change, so the bucket's real state is read rather than assumed.

**2b. And one comment in the tree still says the opposite.**
[`blobs-supabase.ts:29`](../../src/store/blobs-supabase.ts) claims the MIME allowlist is *not*
enforced against the service key, citing a measurement that the postmortem later showed was an
artefact of the probe falling back to the filesystem store. Fix it in this work: a confident, wrong
comment next to the code is how the seven hours happened the first time.

**3. The map key must be the URL the DOM hands back, not the one in the file.** `blocks.json` stores
`…&amp;s=3a2bee…`; `getAttribute("src")` returns `…&s=3a2bee…`. Key the manifest on one and look it
up with the other and every entry misses — no error, no missing image, just the publisher URL left in
place and a feature that appears to do nothing. **Build the manifest by parsing the HTML with a DOM
and reading `getAttribute`**, exactly as the client will. Five of the corpus's thirteen are like this.

**4. Trusting the origin's `Content-Type`.** The lesson `sniffKind` already encodes: publishers serve
PNGs as `application/octet-stream`, and bot walls serve HTML as `image/jpeg`. Stored extension and
served `Content-Type` both come from the **bytes**.

**5. Content-addressing lets one reader read another's objects.** Covered under
[Authorisation](#authorisation) — the manifest-entry check, not just the slug check.

<a id="trap-6"></a>
**6. One article becomes N requests at one host.** There is no per-host throttle in the repo; job
concurrency is 1 and that has been the whole of our politeness. One global queue at 2, and a byte
counter that charges on arrival.

**7. ~~The DNS-rebind window gets wider.~~** Superseded: it is
[closed in this work](#dns-rebinding-closes-here-not-later).

**8. ~~A failed image leaves the page exactly as today.~~ False, and this is the useful correction.**
It is true of a *pipeline* failure. It is not true of a **delivery** failure: an image that stored
fine and then fails at the route, the auth, the blob read or the client rewrite is a stored entry
with nothing to show, and "hot-link as before" is not what happens. Delivery failure needs its own
decision — restore the publisher URL, or show a placeholder — made explicitly rather than inherited.

**9. ~~`image-size` returns declared dimensions.~~** Moot: v1 stores no dimensions and does not take
the dependency.

**10. Native `<img>` cannot authenticate.** The blocker, in full under
[Delivery](#delivery).

## Format sniffing — no dependency in v1

**Do not add `image-size`.** The first draft recommended it at a pinned `2.0.2` with `disableTypes`
for the risky parsers, on the stated basis that all three infinite-loop advisories were patched
there. **That basis was wrong, and the correction is worth keeping.** Checked against the GitHub
advisory API on 2026-08-29:

| Advisory | Published | Affects | First patched |
|---|---|---|---|
| GHSA-m5qc-5hw7-8vg7 | 2025-04-02 | `>=1.1.0 <1.2.1`, `>=2.0.0 <2.0.2` | **1.2.1 / 2.0.2** |
| GHSA-w3rx-r6r6-pgpr — ICNS | **2026-06-10** | `<= 2.0.2` | **none** |
| GHSA-5p2g-fcmc-qvqq — JXL and HEIF | **2026-06-10** | `<= 2.0.2` | **none** |

Two of the three are unpatched at the current published version, and both were filed a week *after*
the maintainer archived the repository on 2026-06-03. There is no fix coming from there. The
`disableTypes` mitigation also has to be invoked before every CLI, server and test path to be worth
anything — a global-startup assumption that fails silently — and one of the parsers it would have to
disable is HEIF, which is the same parser that reads AVIF.

**So: hand-rolled magic-byte checks for GIF, PNG and JPEG, and nothing else.** That is what the
corpus contains; those three headers are fixed-offset reads and genuinely short. No dimensions
stored. Every other format — WebP, AVIF, SVG, anything unrecognised — records
`status: "failed"`, reason `unsupported-format`, and stays hot-linked. Revisit with a maintained
parser when real evidence of another format arrives.

This is the opposite of the first draft's recommendation and of the library research behind it. The
research conflated the 2025 advisory with the two from 2026 and reported all three as patched.

## The cost, honestly

Adding a pipeline artefact is **13 places minimum** — `ArtifactKind`, `ArtifactMap`, `SHAPE`,
`DECODERS`, `PATHS`, `STORAGE` + `WholeColumn`, the `jsonb` column and its migration,
`REVISION_CARRY_POLICY`, `REVISION_READ_POLICY`, `import.ts` (twice), `export.ts`, and two test
enumerations — plus three more for the new step, and the two read projections above.

Sol's answer to "is that justified": **yes.** The manifest has its own stage, freshness, revision
carry policy, failure history, authorisation meaning and reader projection. Riding it on `meta`,
`raw`, `blocks` or `tree` would braid unrelated ownership and lifecycles, and hide it somewhere a
future reader would not know to preserve. The tax is real and it is the cheaper side.

## Stages, and where we are

Run as staged work per [engineering-manager.md](../reusable/engineering-manager.md): each stage ends
with the gates green and the tree safe to commit, and each gets a GPT Sol review before the next
starts. **Nothing a reader sees changes until stage D.**

| | Stage | Lands | State |
|---|---|---|---|
| 1 | **DNS address pinning** | `pinnedAgent`, `guardAddress` returns its answer | ✅ `1fe0a8d` |
| 2 | **The pure module** | `src/assets.ts` — URL extraction, sniffing, the index | ✅ `82f11b1` |
| 3 | **The bucket** | `sources` accepts png/jpeg/gif, locally | ✅ `e5f421c` |
| A | **`fetchAsset`** | `fetchBytes` split out of `fetchDocument`; images fetchable | ✅ |
| B | **The artefact and the step** | `assets` through all its homes, the migration, the step that fills it | in progress |
| C | **Delivery** | the owned route and the public one | |
| D | **The reading view** | `rehostImages`, and images that come from us | |
| E | **Proof and docs** | the browser pass, `architecture.md`, `deployment.md`, Q11 | |

A and B are built in parallel against **one agreed seam**, so neither waits on the other:

```ts
/** What the assets step needs from the network, and all it needs. */
export type AssetFetch = (
  url: string,
  opts: { maxBytes: number; timeoutMs: number; signal?: AbortSignal },
) => Promise<{ bytes: Uint8Array; contentType: string | null; finalUrl: string }>;
```

Stage A implements it as `fetchAsset`; stage B consumes it and injects a fake in tests. **That is
exactly the shape where both sides go green and the value crossing between them is never
exercised**, so a stage-B test must import the *real* `fetchAsset` and assert it satisfies
`AssetFetch` — a type-level check is not enough, because the failure would be a runtime shape, not a
compile error.

## Build order

1. **DNS address pinning**, on its own, as a separately reviewable commit. Test: a resolver that
   answers public during the guard and private during the connection. Watch it fail first.
2. `src/assets.ts` — the pure parts: URL extraction from block HTML via a DOM, magic-byte sniffing
   for GIF/PNG/JPEG, manifest shape. Tests first, no network.
3. Run `scripts/check-buckets.ts`; widen the `sources` MIME allowlist by hand, locally; run it again.
   Prove an image `PUT` succeeds **and** that a disallowed type still `415`s. Fix the wrong comment
   at `blobs-supabase.ts:29`.
4. `fetchBytes` split out of `fetchDocument`, `fetchAsset` beside it. Existing fetch tests stay green
   unchanged — that is the whole safety argument for the surgery.
   **This also clears a debt step 1 took on:** pinning pushed `attemptFetch` from under Biome's
   cognitive-complexity limit to 28 against a max of 25. Lint is advice here rather than a gate, and
   refactoring the function now would be undone by this step — but it is a regression step 1 caused,
   so it is written down here rather than left to be noticed.
5. The `assets` artefact through all 13 places, plus both read projections.
   `tests/store-artefacts-pg.test.ts` is the oracle.
6. The `assets` step.
7. The two delivery routes, with a test that a hash absent from the manifest 404s even for the
   article's owner, and one that a public reader can fetch a public article's asset and cannot fetch
   a private one's.
8. `rehostImages` + `TableView` wiring: blob URLs for owned, public URLs for public, placeholder
   while resolving, offset-invariance test, negative assertion on the publisher host.
9. Re-run the pipeline over the three real articles and take a **browser** acceptance pass.
10. Update the project docs this changes: stage ownership in `architecture.md`, the changed threat
    premise in `fetching.md`, the DNS status in `security.md`, the bucket configuration in
    `deployment.md`, and Q11 in `open-questions.md`.

### The acceptance test needs both halves

"Zero requests to the publisher" **also passes when no images load at all** — and jsdom cannot see
browser-native subresource loads, which `tests/public-network-trace.test.tsx:32` already says out
loud after Sol caught the same over-claim there on 2026-08-28. So the browser pass must assert:

- each expected image reaches `decode()` or has `naturalWidth > 0`;
- `currentSrc` is the hosted blob or public URL;
- the expected image count is still 13;
- publisher hosts receive zero requests;
- **a deliberately external positive-control image is visible to the recorder** — otherwise "zero
  requests" may only mean the recorder sees nothing;
- removing the `srcset` cleanup makes a synthetic fixture contact the publisher.

## Sol's verdict on the rest

Endorsed without change: content-addressed keys and post-`409` read-back verification; no
`raw_sources` row for images; reading URLs from parsed block HTML rather than comparing serialised
entities; sniffing bytes rather than trusting `Content-Type`; reconstructing the canonical key
server-side; keeping stored article HTML free of own-API URLs; attribute-only rewriting and the
text-offset invariant; the explicit `stored` / `failed` / absent-manifest states; the
synthetic-fixture requirement in [what the corpus cannot tell us](#what-the-corpus-cannot-tell-us);
and treating `config.toml` as a declaration rather than live bucket state.

The full review is in
[hosting-the-articles-images-review-sol.md](hosting-the-articles-images-review-sol.md).
