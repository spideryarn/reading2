The overall Plain-mode shape is sound. The source-serving section is not: it uses the wrong store seam, mishandles legacy production rows, and turns broken blob invariants into misleading 404s.

## Blockers

### 1. The proposed `readerStore.rawSource()` is the wrong abstraction

Files: [src/store/index.ts](/home/greg/code/spideryarn2/src/store/index.ts), [src/store/contracts.ts](/home/greg/code/spideryarn2/src/store/contracts.ts), [src/routes.ts](/home/greg/code/spideryarn2/src/routes.ts:228)

Mechanism: the exported `readerStore` is the reader-profile/preferences store. Article reads use the internal `ArticleReader` abstraction. Adding raw article data to `readerStore` either will not fit the existing type or will braid article storage into an unrelated store.

Failure sequence: `GET /api/source/:slug` calls the proposed method; the filesystem and Postgres implementations either cannot share the interface cleanly or the profile store starts acquiring article-specific methods.

Fix: add a source read to `ArticleReader`, or introduce a small dedicated source reader. Each adapter should return a resolved result such as `{ bytes, filename, contentType }`. The route should not know canonical blob keys, Postgres legacy columns, or filesystem locations.

A separate source projection is appropriate. Extending the normal article read with storage-only columns would expose data on every page load. The existing artifact reader is also the wrong direct seam because it reads pipeline drafts rather than the current published revision.

### 2. The production legacy fallback is wrong

Files: [src/store/export.ts](/home/greg/code/spideryarn2/src/store/export.ts), [src/routes.ts](/home/greg/code/spideryarn2/src/routes.ts:228), `src/store/artifacts-pg.ts`

Mechanism: the plan says that a revision without `raw_source_sha256` should fall back to the filesystem. Production legacy rows can instead have their source in the same Postgres row’s `raw_bytes`. The existing export path already understands this storage era.

Failure sequence:

1. A production article predates blob references.
2. Its current revision has `raw_bytes` but no `raw_source_sha256`.
3. The route tries the Vercel filesystem.
4. `ENOENT` becomes 404.
5. The owner is told that no source exists even though the database still contains it.

Fix: put the fallback inside the Postgres adapter: blob reference when present, otherwise legacy `raw_bytes`. The filesystem adapter should use filesystem storage. Never cross from one selected store to the other as a fallback.

Better still, extract and reuse the existing raw-document resolution in `src/store/export.ts` instead of implementing a second interpretation of the same revision fields.

### 3. A missing referenced blob is not a 404

Files: [src/store/export.ts](/home/greg/code/spideryarn2/src/store/export.ts), [src/routes.ts](/home/greg/code/spideryarn2/src/routes.ts:228), `src/store/blobs-supabase.ts`

Mechanism: once a current revision contains a non-null blob reference, that object is an invariant. The existing export code treats a referenced-but-missing object as `MissingRawObject`, a server failure. The plan instead returns 404.

Failure sequence: the database says the source exists, but an object was deleted, a bucket is misconfigured, or a deployment points at the wrong bucket. The reader sees “not found,” monitoring may not receive a failure, and an operational fault looks like ordinary article state.

Fix:

- No source/reference: 404.
- Reference present but object absent: 500, or a deliberate 503.
- Blob service throws: 5xx; the current outer route plumbing already makes an unclassified throw a 500.
- Blob content fails verification: 500.

Add tests for all four outcomes. A successful read plus “blob client throws” is not enough.

### 4. The plan must verify the returned blob against its key

Files: [src/store/export.ts](/home/greg/code/spideryarn2/src/store/export.ts), `src/store/blobs.ts`, `src/source.ts`

Mechanism: content-addressed deduplication is safe only while the key and returned content agree. The existing export resolver rehashes the bytes. The proposed route appears to call `get()` and send what it receives.

Failure sequence: corruption, an incorrect backfill, or a service-key write puts different bytes under article A’s recorded key. A caller authorised for A is then served those bytes, potentially bytes belonging to another article.

Fix: reuse the existing resolver or perform the same digest verification before sending. Also bound the object size before buffering it.

Normal cross-reader deduplication is fine: if two revisions point to the same valid hash, the bytes are identical, and the caller cannot choose the stored hash.

## High

### 5. `meta.url` is not guaranteed safe enough to copy directly into another `href`

Files: [src/web/Masthead.tsx](/home/greg/code/spideryarn2/src/web/Masthead.tsx), [src/store/import.ts](/home/greg/code/spideryarn2/src/store/import.ts), [src/urls.ts](/home/greg/code/spideryarn2/src/urls.ts)

Mechanism: normal fetching validates HTTP(S) URLs, but imported metadata can populate `finalUrl` directly. Rendering an old or imported `javascript:` or `data:` value as an anchor creates an active URL sink. The existing masthead link appears to share this weakness; adding another sink makes it more important, not safer.

Failure sequence: import an article whose stored metadata has `url: "javascript:…"`, open the reader, and click “original.”

Fix: accept only parsed `http:` and `https:` URLs at rendering or article-read time, using the existing URL helper. Ideally validate at import as well and repair the existing Masthead sink. Add `rel="noopener noreferrer"` to external targets.

### 6. The plan has a third `inMode` consumer: the controls branch

File: [src/web/App.tsx](/home/greg/code/spideryarn2/src/web/App.tsx)

Mechanism: the controls branch currently uses `inMode` both to suppress granularity controls and to show the mode exit. Those are no longer the same question.

Failure sequence: Plain has `inMode === true` and `bandOpen === false`. If the planned × is rendered throughout the `inMode` branch, Plain displays an exit button whose destination is Plain. It does nothing.

Fix:

- Use `inMode` to suppress the hierarchy/granularity controls.
- Use `bandOpen` to decide whether the × exists.
- Use `inMode` for forced prose visibility.
- Use `bandOpen` for `fitView({modeBand})` and panel rendering.

With that split, `inMode` and `bandOpen` are genuinely two facts. This is not a repeat of the `proseVisible` mistake, provided no consumer treats them as interchangeable.

### 7. Changing the default breaks more historical links than `?mode=toc`

Files: [src/web/params.ts](/home/greg/code/spideryarn2/src/web/params.ts), [src/read-address.ts](/home/greg/code/spideryarn2/src/read-address.ts), [src/web/Dock.tsx](/home/greg/code/spideryarn2/src/web/Dock.tsx)

Mechanism: `withMode` historically omitted `mode=hierarchy` because Hierarchy was the default. Therefore old canonical Hierarchy links commonly contain no `mode` at all.

Failure sequence: open an old shared URL such as `/read/x?cols=1,3` or `/read/x?text=0`. After the default changes, it lands in Plain, not Hierarchy. `cols` and `text` survive, but their intended initial presentation does not.

Fix: the plan must acknowledge this migration boundary. An absent mode is inherently ambiguous after the default changes. If preserving old bare URLs is required, new Plain URLs need an explicit marker such as `mode=plain` or a URL-version mechanism; merely aliasing `toc` cannot solve it.

The alias belongs in one shared `resolveMode()` function used by both client parsing and `readMode`. It should not become a hidden member of `MODES`: that would pollute exhaustive labels, visitor policy, keyboard order, tests, and Dock selection with a mode that has no UI.

Also, the server implementation to change is [src/read-address.ts](/home/greg/code/spideryarn2/src/read-address.ts), not the re-export in `src/vercel.ts`.

## Medium

### 8. The bar selector weakens the focus guarantees through specificity

File: [src/web/styles.css](/home/greg/code/spideryarn2/src/web/styles.css)

Mechanism: `:root[data-bars="hidden"]:not(:has(.mode-band))` has higher specificity than the present hidden-bars selector. It ties the nearby `:focus-within` guards, which currently win outright and are documented not to depend on source order.

Failure sequence: a later CSS move or override places the hidden rule after a focus guard. A focused control can then be translated offscreen despite the accessibility guard.

Fix: preserve the old specificity, for example:

```css
:root[data-bars="hidden"]:where(:not(:has(.mode-band))) {
  …
}
```

The deep-descendant `:has(.mode-band)` itself is valid. It does not break the `--bar-bottom`/`--dock-bottom` contract: all affected tokens return to their resting values together while the band exists. A brief animation as the band mounts is plausible, but there is no contradictory steady state.

### 9. Source response headers need stricter construction

Files: [src/routes.ts](/home/greg/code/spideryarn2/src/routes.ts:228), `src/store/contracts.ts`

Mechanism:

- `raw_content_type` is an origin header, not the verified stored kind. Valid PDFs may have been fetched as `application/octet-stream`.
- `raw_filename` is not necessarily safe to interpolate into `Content-Disposition`; quotes, backslashes, and non-ASCII characters need encoding.

Failure sequence: a valid PDF is sent with `nosniff` and an unhelpful content type, so it fails to open as a PDF. Or a filename produces a malformed response header.

Fix:

- Serve `application/pdf` based on the verified stored kind.
- Generate `Content-Disposition` with an escaped ASCII fallback plus RFC 5987 `filename*=UTF-8''…`.
- Fall back to a slug-based filename.
- Set `Content-Length` from the actual verified bytes.

The plan does not need `rawContentType` in the source projection if this endpoint only serves PDFs.

### 10. The controls bar is vertically safe but the source control can be inaccessible on phones

Files: [src/web/SourceLink.tsx](/home/greg/code/spideryarn2/src/web/SourceLink.tsx), [src/web/styles.css](/home/greg/code/spideryarn2/src/web/styles.css), [src/web/scroll.ts](/home/greg/code/spideryarn2/src/web/scroll.ts)

Mechanism: `.controls` has a fixed height, so adding one child does not invalidate `stickyOffset()` or deep-link landing offsets. On small screens, however, the bar horizontally scrolls and children do not shrink. A new rightmost icon can begin offscreen.

`SourceLink` also renders its full error message next to the button. Inside the fixed-height horizontal bar, that message can become an offscreen or disruptive bar child.

Failure sequence: open a narrow phone layout with several controls; the “original” action is beyond the visible edge. If PDF lookup fails, its diagnostic sentence appears in the controls scroller.

Fix: put the original control in the always-visible cluster near the mode exit, or make it sticky to the appropriate edge. Give `SourceLink` an error-presentation hook and announce the error outside the bar through a toast/live region. Browser-test at roughly 390px.

The owner capability is already available in `App.tsx`: `onRenamed !== undefined` reaches this point only through the owned-reader path. A new `reader-capability.ts` mechanism is unnecessary, though an explicit local `owner` name would be clearer.

### 11. The planned test update list is incomplete

Files:

- [tests/page-head.test.ts](/home/greg/code/spideryarn2/tests/page-head.test.ts)
- [tests/page-title.test.ts](/home/greg/code/spideryarn2/tests/page-title.test.ts)
- [tests/url-state.test.ts](/home/greg/code/spideryarn2/tests/url-state.test.ts)
- [tests/public-read-rewrite.test.ts](/home/greg/code/spideryarn2/tests/public-read-rewrite.test.ts)
- [tests/address-settling.test.ts](/home/greg/code/spideryarn2/tests/address-settling.test.ts)
- [tests/visitor-gaps.test.ts](/home/greg/code/spideryarn2/tests/visitor-gaps.test.ts)

Mechanism: several tests do not derive expectations from `MODES`; they contain literal mode counts, literal label maps, default-Hierarchy cases, or their own parsing logic.

Failures:

- `page-head` asserts nine modes and that Hierarchy is omitted.
- `page-title` special-cases Hierarchy as the default.
- `url-state` expects absent/invalid/`toc` to resolve to Hierarchy.
- `public-read-rewrite` groups `toc` with unknown values.
- `address-settling` implements `MODES.includes(value) ? value : DEFAULT_MODE`, bypassing the proposed alias.
- `visitor-gaps` has an explicit free-mode expectation.

Fix: update these intentionally. Parsing tests should call the shared resolver rather than reproduce it. Add distinct cases for `toc` aliasing to Hierarchy and unknown input falling back to Plain. First run the targeted old assertions and observe them fail; a broad green suite alone would not show that the compatibility cases were exercised.

### 12. Several project docs become false

Files:

- [docs/project/url-state.md](/home/greg/code/spideryarn2/docs/project/url-state.md)
- [docs/project/page-titles.md](/home/greg/code/spideryarn2/docs/project/page-titles.md)
- [docs/project/web-client.md](/home/greg/code/spideryarn2/docs/project/web-client.md)
- [docs/project/performance.md](/home/greg/code/spideryarn2/docs/project/performance.md)
- [docs/project/reading-view-overview.md](/home/greg/code/spideryarn2/docs/project/reading-view-overview.md)

Mechanism: they state that an absent mode means Hierarchy/default, that the default has granularity columns, or that the default/ToC opens no band.

Fix: update those statements using the important-doc before/after approval process. `keyboard.md`, `touch.md`, and `chat-handoff.ts` do not appear to require changes merely because Plain exists.

## Low

### 13. The × should name its destination, not inherit it

File: [src/web/App.tsx](/home/greg/code/spideryarn2/src/web/App.tsx)

Mechanism: `setMode(DEFAULT_MODE)` couples “close the band” to an unrelated product choice.

Failure sequence: a later release changes the default again; the × silently starts opening Hierarchy or another mode instead of closing to Plain.

Fix: use `setMode("plain")`, with an accessible label such as “Close mode” or “Return to plain reading.” The default and the close destination happen to coincide now, but they are different contracts.

## Parts of the plan that are right

- `fitView({ modeBand: false, chosen: [], showText: true })` produces spine plus prose and no gist columns. The empty manual choice is honoured correctly.
- Existing `?cols=`, `?text=`, and `?spine=` values remain latent in the URL and return when appropriate. Plain forcing prose visible is consistent with the other non-Hierarchy modes.
- The fit/auto affordance is absent in Plain, which is honest: Plain is not currently fitting gist columns.
- `visitorGap("plain") === null` is the correct explicit fail-open entry, and `markedModes` derives correctly.
- `withMode`, `carriedSearch`, the off-reading-view Dock arm, and shared title composition adapt correctly once the default and parsers are changed.
- Plain belongs in the real Dock keyboard order; `nextModeIndex` needs no special handling.
- Closing a band into Plain matches the stated “back to the main text” decision. Remembering Hierarchy in a ref would make navigation non-shareable and remount-dependent.
- `raw_source_sha256` is the correct stored-object key for both acquisition paths: upload and fetch both record the digest returned by `storeRawSource`. It is deliberately not merely `Meta.rawSha256`.
- Adding one fixed-height control does not itself invalidate `stickyOffset()` or jump offsets.