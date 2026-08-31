Verdict: **CHANGES REQUIRED.** Keep the content-addressed storage and separate manifest. Do not build the serving, fetch-security, SVG, or dependency parts as written.

## Direct answers to the six questions

1. **Keep the shared content-addressed bucket plus manifest.** A per-article prefix duplicates bytes and introduces another naming invariant. The authorization rule is sufficient only if the route checks the exact current-revision entry `{status:"stored", sha256, ext}`, reconstructs the key server-side, and performs the ownership/public-visibility check against that same revision.

2. **Split `fetchDocument`; do not duplicate the hop loop.** Make `fetchBytes` private and narrow. Land DNS address pinning as part of that preparatory change, ideally as a separately reviewable commit before adding asset behavior. Preserve unchanged:

   - HTTP(S)-only parsing and redirect-scheme refusal
   - guard and pinned address on every hop and retry
   - manual redirect cap, loop detection, chain and final URL
   - one deadline for the complete attempt, with fresh deadlines between retries
   - cancellation of every abandoned or failed body
   - decompressed arriving-byte cap, empty-body and `206` refusal
   - status/retry classification against the failing hop
   - caller cancellation during backoff
   - existing injected fetch/DNS/time/random seams
   - document-specific headers, encoding sniff and `sniffKind` behavior

   Those are spread through [`fetchDocument`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:1029), the [hop loop](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:1061), and [`readDocument`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:1152). Undici supports a request-local custom dispatcher, so this does not require changing the global network stack. [Undici Fetch documentation](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md)

3. **Neither `srcset` option. Fetch the actual `img[src]` in v1.** For a stored image, rewrite that one URL and remove `srcset`, `sizes`, and sibling `<source>` elements. The corpus proves that path: all 13 images have usable absolute `src` values, while fetching the largest responsive candidate has not been measured. “Largest” also becomes ill-defined across width/density descriptors, media queries and `<picture>` types. Leave a missing or placeholder-only `src` hot-linked until a real example justifies another branch.

4. **Refuse to host SVG in v1.** The proposed CSP is technically sound: CSP `sandbox` applies an iframe-like sandbox policy to the resource. [W3C CSP specification](https://www.w3.org/TR/CSP/#directive-sandbox) But there are zero SVGs in the corpus, and the case that prompted Q11 is explicitly seven transparent PNGs, not SVGs ([design evidence](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/design-css-overview.md:183)). The claim that refusing SVG costs “exactly the case this feature is for” is therefore factually wrong. It also becomes especially unsafe if authenticated assets are converted to `blob:` URLs, because the original response CSP is not carried into the newly created Blob.

5. **Use a new `assets` artefact.** It has its own stage, freshness, revision carry policy, failure history, authorization meaning and reader projection. Putting it in `meta`, `raw`, `blocks` or `tree` would braid unrelated ownership and lifecycle. The 13-place cost is real architectural tax, but cheaper than hiding the map somewhere future readers will not know to preserve.

6. **Several traps need changing.**

   - Trap 1’s diagnosis is right; “largest candidate” is the unsupported part.
   - Trap 2 is right, including service-role enforcement. The postmortem has direct container evidence of the `415` ([evidence](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/260828a-the-config-file-is-not-the-bucket.md:37)). However, [`blobs-supabase.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/blobs-supabase.ts:29) still states the opposite and must be corrected.
   - Trap 6 is ambiguous. “Concurrency 4, and per host” is either redundant if both limits are four, or unbounded globally if it means four for every host.
   - Trap 7 reaches the wrong decision: close DNS rebinding in this work.
   - Trap 8 is false. A pipeline failure leaves the original image, but a successfully stored image followed by an auth, route, blob-read or client-rewrite failure produces a broken image.
   - Trap 9 is premature if v1 stores no dimensions.
   - The missing tenth trap is the authenticated delivery path below.

## Findings ranked by time saved

### 1. Blocker: native `<img>` requests cannot authenticate to the proposed route

The plan rewrites `src` to an endpoint inside `serveAuthenticatedApi` ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260829b-hosting-the-articles-images.md:229)). But `requireUser` accepts only an `Authorization: Bearer` header ([auth](/Users/greg/Dropbox/dev/experim/spideryarn2/src/auth.ts:324)), and a native image request cannot attach it.

The repository has already encountered and solved exactly this for source links: [`SourceLink.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SourceLink.tsx:4) says plain navigation cannot carry the header, so it calls `apiFetch` and creates a Blob URL. The same applies to images.

This can ship with:

- pure rewrite tests green;
- route authorization tests green;
- all artefact tests green;
- ordinary `401` responses rather than crashes;
- every rewritten image broken.

It also omits anonymous public readers. The public namespace deliberately runs before authentication ([routes](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3166)), and `App` falls back to public article loading for signed-out or non-owning readers ([client flow](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:380)). They can never use the proposed authenticated route.

What I would build:

- Private/owned article: fetch each authorized asset through `apiFetch`, create and revoke Blob URLs, following `SourceLink`.
- Public article: add a closed `/api/public/asset/...` route that checks current public visibility and exact manifest membership on every request. Do not copy the year-long private cache header; the existing public namespace uses `no-store` so making an article private takes effect immediately.
- While a stored asset is being resolved, do not render its publisher URL. Use a placeholder, then substitute the Blob/public URL. Otherwise the privacy leak already occurred before the rewrite completes.
- Keep short-lived Supabase signed URLs as a later optimization. Supabase explicitly supports them for private buckets, but they remain valid until expiry, which complicates public-visibility revocation. [Supabase Storage documentation](https://supabase.com/docs/guides/storage/serving/downloads)

### 2. High: this feature crosses the documented DNS-rebinding threshold

The current justification says the attacker must control both DNS and Greg’s clipboard ([fetch comment](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:475)). Here, the untrusted publisher chooses up to hundreds of URLs. That premise no longer holds.

Close the gap now: resolve once per hop, reject any blocked answer, and force the connection to use one of the checked addresses while preserving the original hostname for `Host`, TLS SNI and certificate validation. Add a test whose resolver answers public during the guard and private during connection; see it fail before pinning and pass afterwards.

### 3. High: `image-size@2.0.2` is not fully patched

The plan says all three infinite-loop advisories are patched in 2.0.2 ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260829b-hosting-the-articles-images.md:353)). Current reviewed advisories say the opposite: both the ICNS and JXL/HEIF event-loop DoS flaws affect `<=2.0.2`, with no patched release. [ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [JXL/HEIF advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)

`disableTypes` may avoid those parsers if it is invariably invoked before every CLI, server and test path, but that global-startup assumption is another silent-success seam.

For v1, do not add the dependency. The measured corpus needs only GIF, PNG and JPEG; identify those with tight magic-byte checks, store no dimensions, and reject everything else. Revisit a maintained parser when real WebP/AVIF/SVG evidence arrives.

### 4. High: the proposed artefact version will not invalidate anything

`Assets.version` is numeric `1`, but `stampOf` only reads a string `version` ([stamp code](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts.ts:590)). Therefore a change to URL selection, sniffing or failure behavior can leave every existing manifest reporting current based only on `sourceHash`.

Use a string such as `version: "assets/1"` and include it in the expected stamp, or complete the currently unused `implementationVersion` path.

The manifest must also be explicitly added to both owned and public read projections. `Article` currently has only meta, blocks, tree and optional arc ([type](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:1048)); the filesystem loader returns exactly those fields ([loader](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:231)); and Postgres uses an allowlisted projection ([projection](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:400)). Making `assets` optional would let every one of those omissions typecheck while the reader continues hot-linking.

### 5. Medium: the acceptance test needs a positive image assertion

“Zero requests to the publisher” also passes when no images load at all. The existing test documentation explicitly says jsdom and fetch spies cannot observe browser-native subresource requests ([test limitation](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-network-trace.test.tsx:32)).

The deployed/browser acceptance must prove both sides:

- each expected image reaches `decode()` or has `naturalWidth > 0`;
- `currentSrc` is the hosted/Blob/public URL;
- the expected image count remains 13;
- publisher hosts receive zero requests;
- a deliberately external positive-control image is visible to the network recorder;
- removing the `srcset` cleanup makes a synthetic fixture contact the publisher.

Define delivery failure separately from pipeline failure. For a stored entry whose delivery fails, choose explicitly between restoring the publisher URL and showing a placeholder; neither is “exactly as today.”

### 6. Medium: limits and `Referer` are policy, not measurement

The measurements do not derive 16 MiB, 64 MiB, 200 images, concurrency 4 or 15 seconds. They show 899 KB maximum, 2.46 MB total and 13 images. Those proposed values may be reasonable generous guards, but the plan should call them policy.

I would start with one global queue at concurrency 2. A shared aggregate byte counter must charge bytes as they arrive; summing completed downloads allows concurrent responses to overshoot the article cap.

Do not send the full article URL as `Referer`. The code deliberately excludes `meta.url` from public payloads because redirect URLs can carry credentials or signed query parameters ([public type](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public-types.ts:27)). The corpus already shows every image returning `200` without a referer. Send none initially; if a real host refuses, retry with the origin only, never path, query or userinfo.

## Sections that are fine

The following choices are good:

- Content-addressed keys and post-`409` read-back verification.
- No `raw_sources` row for images.
- Reading URLs from parsed block HTML rather than comparing serialized entities.
- Sniffing bytes rather than trusting origin `Content-Type`.
- Reconstructing the canonical key server-side.
- Keeping stored article HTML free of own-API URLs.
- Attribute-only rewriting and the text-offset invariant.
- Explicit `stored` / `failed` / absent-manifest states.
- The new synthetic-fixture requirement in “What the corpus cannot tell us.”
- Treating `config.toml` as a declaration rather than live bucket state. Build order should explicitly run the existing read-only [`check-buckets.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/check-buckets.ts:1) before and after the authorized bucket change.

Finally, the implementation plan should include the corresponding project-doc updates: stage ownership/architecture, fetching’s changed threat premise, security’s DNS status, deployment/storage configuration, and Q11. No code or data was changed during this review.

Prior memory only guided which persistence and reader paths to inspect; every finding above was checked against the current workspace.

