## Verdict

Do not approve the plan’s current integration design. The decoded-XObject → PNG approach is sound, but extraction/storage should not live in stage 2, and stage-2 HTML must not contain final `/api/figures/...` URLs.

Use the existing `assets` step, extend its manifest for PDF-origin figures, and complete the missing delivery/reader work for both web and PDF images:

```text
pdf-read.renderHtml
  → <figure data-spya-pdf-figure="<opaque ref>">…caption…</figure>
  → blocks preserve that ref
  → existing assets step reopens raw.pdf, extracts, encodes and stores
  → Assets maps ref → stored hash or recorded failure
  → client, after sanitising, inserts the trusted <img src="/api/assets/…">
  → route authorises against the current Assets manifest and serves the blob
```

### D1 — Where extraction lives

- **D1-1 — P0: Put byte extraction in the existing `assets` step, not stage 2 and not a new pipeline step.** Stage 2 owns `extractedHtml` and metadata; stage 4.5 already owns `assets.json` and Storage ([architecture.md:116](/home/greg/code/spideryarn2/docs/project/architecture.md:116), [architecture.md:119](/home/greg/code/spideryarn2/docs/project/architecture.md:119)). Extend `STEPS.assets.run` to read the raw manifest and, for PDFs, call a new `extractPdfFigures` helper; it already reads the authoritative rendered blocks and produces the only needed manifest ([pipeline.ts:2277](/home/greg/code/spideryarn2/src/pipeline.ts:2277), [pipeline.ts:2293](/home/greg/code/spideryarn2/src/pipeline.ts:2293)).

- **D1-2 — P1: Option (a) has less reuse benefit than it appears.** `pass0` destroys its pdf.js document and worker before returning ([pdf.ts:676](/home/greg/code/spideryarn2/src/pdf.ts:676), [pdf.ts:693](/home/greg/code/spideryarn2/src/pdf.ts:693)). `openPdfCuts` is a separate pdf-lib document, not the pdf.js object store needed for XObjects ([pdf-read.ts:601](/home/greg/code/spideryarn2/src/pdf-read.ts:601), [pdf-read.ts:611](/home/greg/code/spideryarn2/src/pdf-read.ts:611)). Stage 2 would therefore either reopen the PDF anyway or require a substantial lifetime refactor.

- **D1-3 — P0: The plan’s final stage-2 URL would be stripped.** The sanitiser explicitly removes host-relative `/api/...` values ([sanitize-policy.ts:391](/home/greg/code/spideryarn2/src/sanitize-policy.ts:391), [sanitize-policy.ts:406](/home/greg/code/spideryarn2/src/sanitize-policy.ts:406), [sanitize-policy.ts:463](/home/greg/code/spideryarn2/src/sanitize-policy.ts:463)). Thus the proposed `<img src="/api/figures/...">` would not survive stage 3, contrary to plan lines 214–218. Generate the trusted URL in the client only after `sanitizeArticle`, at the `resolveAccess` ingress seam ([App.tsx:904](/home/greg/code/spideryarn2/src/web/App.tsx:904)).

- **D1-4 — P0: Fix assets freshness before using it for PDF figures.** The assets stamp is currently `hashBlocks(blocks)` plus `ASSETS_VERSION` ([pipeline.ts:2288](/home/greg/code/spideryarn2/src/pipeline.ts:2288)). `hashBlocks` includes id, text, role and treatment, but not `block.html` or image references ([source-hash.ts:82](/home/greg/code/spideryarn2/src/source-hash.ts:82), [source-hash.ts:149](/home/greg/code/spideryarn2/src/source-hash.ts:149)). Adding a marker or `<img>` to a captioned figure therefore does not invalidate an empty carried manifest. Define `assetsInputHash` over the web image URLs, PDF figure refs, and raw PDF `storedSha256`, and bump `ASSETS_VERSION`.

- **D1-5 — P0: A PDF figure ref must prevent stale carried images from matching a new extraction.** Assets are carried into new revisions ([pg-revisions.ts:249](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:249)). A ref such as `page:3` could therefore show an old PDF’s page-three figure after the raw document changes. Mint an opaque ref from a version tag, raw PDF SHA-256, page, figure ordinal, and caption digest. Exact ref matching then fails closed until `assets` reruns.

- **D1-6 — P1: Do not put an unresolved `src` into stored HTML.** Default ingest normally runs `assets` ([pipeline.ts:218](/home/greg/code/spideryarn2/src/pipeline.ts:218)), but stages are explicitly independently runnable ([architecture.md:308](/home/greg/code/spideryarn2/docs/project/architecture.md:308)). When `Assets` is absent, a PDF should remain caption-plus-placeholder with no network request or broken-image icon. A failed PDF entry looks the same to the reader but remains distinguishable in the manifest from “never ran.”

### D2 — Caption association

- **D2-1 — P0: Adopt the strict one-to-one page invariant.** Attach only when a page has exactly one figure marker and exactly one supported, nonblank raster candidate. Anything else writes a failed PDF-figure entry such as `ambiguous`, `no-raster`, `unsupported-kind`, or `too-large`. Do not stack all page images and do not order-match.

- **D2-2 — P0: Wrong association is silent semantic corruption.** A plausible plot under the wrong caption may be impossible for a reader to detect; absence is obvious. The safe v1 false negative is a visible unrecovered figure. The pure association function should additionally assert that no candidate is consumed twice and no marker receives more than one image.

- **D2-3 — P1: Defer y-coordinate matching.** Pass 0 has text coordinates ([pdf.ts:647](/home/greg/code/spideryarn2/src/pdf.ts:647), [pdf.ts:660](/home/greg/code/spideryarn2/src/pdf.ts:660)), but matching correctly also requires replaying the PDF graphics transforms to obtain placed image boxes. “Nearest caption” without that geometry is not yet a cheap heuristic. Model bounding boxes add cost and a second unverified association mechanism.

- **D2-4 — P1: Make the scan exclusion explicit.** The measured Wellcome document shows why a figure-record gate alone is insufficient. Skip an entirely scanned PDF using existing `meta.unverified`; later, if mixed scan/text PDFs matter, add a measured placed-CTM page-coverage rule. Do not infer full-page coverage from intrinsic pixel dimensions.

### D3 — Blankness

- **D3-1 — P0: Use only exact visual emptiness in v1.** For `RGBA_32BPP`, discard an XObject only when every alpha byte is exactly zero. Never classify RGB images as blank by compression ratio, colour count, whiteness, or entropy. The eight measured overlays have alpha `0` throughout, while the real figures do not (plan lines 118–139).

- **D3-2 — P0: Remove the proposed “one colour within tolerance” clause.** It is unneeded by the measured corpus and introduces precisely the false negative that matters: a near-white diagram, faint grid, solid colour plate, or one-pixel line. Keeping an extra flat rectangle is visible; deleting a real figure is silent.

- **D3-3 — P1: Pin the predicate with adversarial tests.** At minimum:

  - fully transparent RGBA → blank;
  - identical data with one pixel at alpha `1` → retained;
  - opaque all-white RGB → retained;
  - white RGBA plus one light-grey, opaque one-pixel line → retained;
  - the eight named real XObjects → retained;
  - the eight named overlays → blank;
  - kinds other than 2/3 → explicit refusal, never “blank.”

### D4 — Storage and manifest

- **D4-1 — P1: Reuse storage below `collectAssets`, not its network orchestration.** Extract a helper analogous to `storePlateImage`, returning `{sha256, ext, contentType, bytes, width, height, outcome}`. It should validate/sniff and call `storeRawSource`, which already owns content hashing, canonical names, create-only writes and dedup verification ([blobs.ts:392](/home/greg/code/spideryarn2/src/store/blobs.ts:392), [blobs.ts:414](/home/greg/code/spideryarn2/src/store/blobs.ts:414)). Leave URL fetching, retry reservations and network failure classification in `collectAssets` ([collect-assets.ts:717](/home/greg/code/spideryarn2/src/collect-assets.ts:717)).

- **D4-2 — P1: Do not put a pseudo-URL into `AssetEntry.url`.** That field promises the exact DOM `src` and drives fallback-to-original behavior ([assets.ts:83](/home/greg/code/spideryarn2/src/assets.ts:83), [assets.ts:404](/home/greg/code/spideryarn2/src/assets.ts:404)). Add a separate `pdfFigures` collection keyed by the opaque ref, or migrate entries to a discriminated source:

  ```ts
  type AssetSource =
    | { kind: "url"; url: string }
    | { kind: "pdf-figure"; ref: string; page: number };
  ```

  Given existing production manifests, an additive `pdfFigures?: PdfFigureEntry[]` is probably the smaller migration.

- **D4-3 — P1: Every expected PDF marker needs an entry.** Stored or failed, none may disappear because of ambiguity, count limits, timeout, unsupported kind, or oversized decode. Current asset semantics intentionally distinguish “looked and failed” from “never looked” ([assets.ts:101](/home/greg/code/spideryarn2/src/assets.ts:101), [collect-assets.ts:582](/home/greg/code/spideryarn2/src/collect-assets.ts:582)).

### D5 — Encoding, costs and limits

- **D5-1 — P1: PNG is the correct v1.** The existing illustrated-image decision applies: re-encoding to JPEG needs the banned decoder or a substantial encoder to maintain ([illustrated-image.ts:27](/home/greg/code/spideryarn2/src/illustrated-image.ts:27), [illustrated-image.ts:34](/home/greg/code/spideryarn2/src/illustrated-image.ts:34)). Preserve RGB as PNG colour type 2 and RGBA as type 6. Validate the resulting signature and dimensions before storage.

- **D5-2 — P0: The current 16 MiB per-image cap is incompatible with proxying images through the Vercel function.** Vercel currently limits a function response to 4.5 MB ([official Vercel limits](https://vercel.com/docs/functions/limitations)); `MAX_IMAGE_BYTES` is 16 MiB ([collect-assets.ts:120](/home/greg/code/spideryarn2/src/collect-assets.ts:120)). For the simplest v1, cap deliverable PNGs at 4 MiB and record larger ones as failed. The alternative is an authorised redirect to a short-lived signed Storage download, which avoids the response limit but adds token and cache lifecycle work.

- **D5-3 — P1: Use shared output budgets plus PDF-specific decode limits.** Recommended initial policy:

  - 12 million pixels per XObject;
  - 4 MiB encoded per image if proxy-served;
  - existing 64 MiB total article bytes;
  - at most 100 PDF figure markers;
  - the existing 180-second assets-stage budget, not another 180 seconds.

  These are generous guards, not corpus-derived claims. The measured largest figure is far inside them.

- **D5-4 — P0: The decode cap must be passed to pdf.js itself.** Calling `page.objs.get` after checking operator-list dimensions is too late: building the operator list starts `createImageData` and sends the decoded buffer ([pdf.worker.mjs:40437](/home/greg/code/spideryarn2/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs:40437), [pdf.worker.mjs:40446](/home/greg/code/spideryarn2/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs:40446)). Use `getDocument({ maxImageSize: MAX_PDF_IMAGE_PIXELS })`; pdf.js checks width × height before decoding ([pdf.worker.mjs:40293](/home/greg/code/spideryarn2/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs:40293), [pdf.worker.mjs:40299](/home/greg/code/spideryarn2/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs:40299)). A size-refused image may have to be recorded generically as “no recoverable raster,” because pdf.js removes the operation.

- **D5-5 — P1: Prefer asynchronous zlib.** `deflateSync` makes the wall-clock cancellation ineffective while one large figure is encoding and blocks unrelated requests in the same process. An async deflate or abortable stream, combined with the pixel cap, gives the stage budget meaning.

### D6 — Integration, identity, export and security

- **I-1 — P0: Delivery is currently absent and is part of this feature’s floor.** `assetIndex` has no production caller; the only hit is its definition ([assets.ts:404](/home/greg/code/spideryarn2/src/assets.ts:404)). `sanitizeArticle` only sanitises block HTML ([sanitize.ts:103](/home/greg/code/spideryarn2/src/web/sanitize.ts:103)), and `TableView` renders that HTML directly ([TableView.tsx:1440](/home/greg/code/spideryarn2/src/web/TableView.tsx:1440)). The only comparable binary route is `sendPlate` ([routes.ts:605](/home/greg/code/spideryarn2/src/routes.ts:605)). Build a generic article-asset route and `rehostImages`; do not create a PDF-only parallel delivery mechanism.

- **I-2 — P1: Register the marker in `RESERVED_ATTRS`.** Only `src/reserved.ts` may name `data-spya-*` attributes, and incoming copies must be scrubbed before Spideryarn writes its own ([reserved.ts:27](/home/greg/code/spideryarn2/src/reserved.ts:27), [reserved.ts:129](/home/greg/code/spideryarn2/src/reserved.ts:129)). This follows the existing notes/callouts provenance mechanism. Add the marker to the shared server/browser sanitiser corpus; ordinary `data-*` currently survives ([sanitize.test.ts:60](/home/greg/code/spideryarn2/tests/sanitize.test.ts:60)).

- **I-3 — P1: Captioned block IDs are safe, but the plan’s captionless analysis is incorrect.** A captioned figure is keyed on its text, so adding an attribute or textless `<img>` preserves its ID ([blocks.ts:911](/home/greg/code/spideryarn2/src/blocks.ts:911), [blocks.ts:914](/home/greg/code/spideryarn2/src/blocks.ts:914)). However, `renderHtml` currently skips any empty-text record before it creates a figure ([pdf-read.ts:1528](/home/greg/code/spideryarn2/src/pdf-read.ts:1528)). Captionless figures do not currently have an empty figure block that can “re-mint once”; they have no block at all. Either explicitly exclude them from v1 or deliberately introduce a new media block.

- **I-4 — P1: Keep generated UI text out of the stored block’s text-node space.** Inserting “figure could not be recovered” as text inside `block.html` changes the DOM text used for comment/highlight offsets ([annotate.ts:14](/home/greg/code/spideryarn2/src/web/annotate.ts:14)). Render the muted message as client-owned UI adjacent to the prose HTML, or otherwise ensure it is excluded from annotation text. The inserted image should use `alt=""`, with the visible `figcaption` carrying the caption, and should include width, height, `loading="lazy"` and `decoding="async"`.

- **I-5 — P0: Authorisation must be against the current manifest, not the path or merely the blocks.** Follow `sendPlate`: verify ownership/public visibility, locate the exact hash and extension in the current article’s stored manifest, then rebuild `canonicalKey` from that entry ([routes.ts:611](/home/greg/code/spideryarn2/src/routes.ts:611), [routes.ts:623](/home/greg/code/spideryarn2/src/routes.ts:623), [routes.ts:626](/home/greg/code/spideryarn2/src/routes.ts:626)). Return `nosniff`; use a private immutable response for owned articles. A public route must independently verify that the article is currently public.

- **I-6 — P0: Validate decoded objects before allocating the PNG scanlines.** Require positive safe-integer width/height, supported kind, bounded `width * height`, and exact `data.length === width * height * channels`, using overflow-safe arithmetic. Re-encoding into a minimal PNG is preferable to serving the PDF’s original stream: it drops ancillary metadata and lets the route state a trustworthy content type.

- **I-7 — P1: Reuse the existing pdf.js bootstrap and teardown.** `loadPdfjs` installs the geometry-only `DOMMatrix` and explicitly loads the worker for Vercel tracing ([pdf.ts:98](/home/greg/code/spideryarn2/src/pdf.ts:98), [pdf.ts:152](/home/greg/code/spideryarn2/src/pdf.ts:152), [pdf.ts:174](/home/greg/code/spideryarn2/src/pdf.ts:174)). Export a narrow shared `withPdfDocument`/loader seam rather than importing pdf.js independently in `pdf-figures.ts`. Always clean up and destroy in `finally`. Keep the real bundle trace asserting canvas and native bindings remain absent ([pdf-bundle-trace.test.ts:59](/home/greg/code/spideryarn2/tests/pdf-bundle-trace.test.ts:59), [pdf-bundle-trace.test.ts:112](/home/greg/code/spideryarn2/tests/pdf-bundle-trace.test.ts:112)).

- **I-8 — P1: Export becomes materially less complete for uploaded PDFs.** The export currently claims image URLs are originals and generally refetchable, and that the original document is easy to fetch again ([export-bundle.ts:182](/home/greg/code/spideryarn2/src/store/export-bundle.ts:182), [export-bundle.ts:193](/home/greg/code/spideryarn2/src/store/export-bundle.ts:193)). Neither claim holds for a PNG extracted from an uploaded PDF. Ideally include PDF-derived image bytes or the original uploaded PDF; if deferred, update the omission text and preserve PDF page/ref provenance in `assets.json`.

- **I-9 — P1: Expanding `Assets` changes the public payload automatically.** The public DTO passes `Assets` through wholesale ([public/dto.ts:638](/home/greg/code/spideryarn2/src/public/dto.ts:638)). Keep PDF entries free of object keys, bucket paths, diagnostics and source prose; page number, opaque ref, dimensions, hash, format, size and bounded failure reason are sufficient.

No files were changed.

## Suspicions and unverified limitations

- **SP-1 — P2: A decoded XObject may not equal the page’s rendered appearance.** Masks, blend modes, clipping, rotation/flipping and multiple XObjects composing one logical figure may require graphics-state interpretation. The four eye-checked examples reduce this concern for the target document but do not settle it generally.

- **SP-2 — P2: Supporting only `paintImageXObject` will miss inline images, repeated-image operators and vector-only figures.** That is an acceptable v1 limitation if recorded explicitly rather than presented as general PDF figure recovery.

- **SP-3 — P2: Photographic figures may make PNG expansion hit the 4 MiB delivery cap.** If corpus measurements show this is common, preserving original `DCTDecode` JPEG streams is the likely next route—but it needs careful handling of masks, colour spaces and blankness, so it should not be pulled into v1.