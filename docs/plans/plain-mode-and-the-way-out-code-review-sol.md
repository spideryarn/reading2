No critical findings. I found one high-severity issue, four medium issues, and two lower-severity test/documentation problems.

## Findings

### High — the `meta.url` allowlist was applied to only two of its active sinks

Files: [Metadata.tsx:517](/home/greg/code/spideryarn2/src/web/Metadata.tsx:517), [ShelfEntry.tsx:343](/home/greg/code/spideryarn2/src/web/ShelfEntry.tsx:343)

`TheOriginal` and the masthead correctly call `isWebUrl`, but the metadata page and shelf card still render the same imported `meta.url`/`entry.url` directly as `href`.

Failure sequence: import an article whose `final_url` is `data:text/html,...`, `javascript:...`, `file:...`, or another non-HTTP scheme; then open its metadata page or press “Open the original page” on its shelf card. Those anchors exist despite the stated HTTP(S)-only policy. React currently mitigates some `javascript:` values, but it does not make these sinks comply with the application’s allowlist.

Fix: gate every article-source anchor with `isWebUrl`, ideally through one shared source-link component. Invalid values may remain visible as text but must not become anchors. Add Metadata and ShelfEntry cases to the existing control tests.

### Medium — raw objects are still buffered without the requested size bound

File: [raw-document.ts:114](/home/greg/code/spideryarn2/src/store/raw-document.ts:114)

`readRawDocument` calls `sources.get(key)` without `maxBytes`. Supabase’s implementation can reject from `Content-Length` before buffering, but only when that option is supplied.

Failure sequence: an oversized object is placed under a referenced key through a service-key write, backfill, or bucket-policy drift; an owner opens the original or runs an export. The server buffers the entire object before hashing it. Several concurrent requests can exhaust a serverless process.

The configured bucket’s 50 MiB limit reduces the normal exposure, but this is still the exact “bound the object size before buffering it” requirement from the earlier review.

Fix: pass `{ maxBytes: MAX_UPLOAD_BYTES }`, imported through `source.ts`, and add a test whose fake store asserts that the limit was supplied.

### Medium — the Postgres adapter itself can still fall back to filesystem blobs

File: [pg.ts:1367](/home/greg/code/spideryarn2/src/store/pg.ts:1367), especially [pg.ts:1384](/home/greg/code/spideryarn2/src/store/pg.ts:1384)

`pgArticleReader.loadSource` calls `blobStore()`. That function chooses the filesystem whenever Supabase credentials are absent.

The normal server imports [store/index.ts:116](/home/greg/code/spideryarn2/src/store/index.ts:116), which calls `postgresBlobStore(...)` at boot. Therefore a laptop with `SPIDERYARN_STORE=postgres` and no Supabase credentials does not fall back as the comment claims—it fails boot, correctly.

But `pgArticleReader` is also an exported adapter and is imported directly by scripts and tests. A direct caller can bypass that boot guard:

1. Configure Postgres without Supabase credentials.
2. Import `pgArticleReader` directly.
3. Call `loadSource` for a reference-era row.
4. It reads `data/_blobs`; a coincidentally matching local object is served, otherwise a false dangling-reference fault is reported.

Fix: have this method call `postgresBlobStore("Postgres source reads")`, or inject that checked store into the adapter. Do not use `exportBlobStore`; that would reintroduce the dependency problem the extraction removed. Correct the comment to say the supported Postgres configuration fails closed.

### Medium — `filename*` is not valid RFC 5987 for all legal filenames

File: [routes.ts:311](/home/greg/code/spideryarn2/src/routes.ts:311)

`encodeURIComponent` leaves `'`, `(`, `)` and `*` unescaped, but those characters are not valid in an RFC 5987 extended parameter. For example:

```text
O'Brien (draft)*.pdf
→ filename*=UTF-8''O'Brien%20(draft)*.pdf
```

A client may ignore that parameter and use the lossy ASCII fallback. Also, a lone UTF-16 surrogate makes `encodeURIComponent` throw `URIError`, turning an imported malformed filename into a 500.

The quoted fallback does prevent CRLF, quote, backslash and semicolon parameter injection. I found no second-header injection.

Fix: first normalize to well-formed Unicode, then apply `encodeURIComponent(...).replace(/['()*]/g, percentEncode)`. Add punctuation and malformed-Unicode tests, not merely a `decodeURIComponent` round trip.

### Medium — a failed source open is silent to screen-reader users

Files: [SourceLink.tsx:133](/home/greg/code/spideryarn2/src/web/SourceLink.tsx:133), [App.tsx:2068](/home/greg/code/spideryarn2/src/web/App.tsx:2068)

Sighted failures are reported: the blank tab closes and an error appears. But neither the component’s default error nor the controls-bar error is an `aria-live` region.

Failure sequence: a screen-reader user activates the PDF button; the server returns 500; the blank tab closes; text is inserted elsewhere in the controls without being announced. From their perspective, nothing happened.

Fix: make the error container `role="alert"` or `role="status" aria-live="polite"`, and test the rejected-fetch path.

### Low — the source tests do not exercise the route, and one Postgres-gated assertion still expects deleted code

Files: [source-download.test.ts:8](/home/greg/code/spideryarn2/tests/source-download.test.ts:8), [owner-isolation.test.ts:600](/home/greg/code/spideryarn2/tests/owner-isolation.test.ts:600)

`source-download.test.ts` tests `readRawDocument` and `contentDisposition`, not `sendSource` or the outer status plumbing. Changing the route’s null outcome to 500, removing `Content-Length`, or sending headers before loading would leave it green.

Separately, [owner-isolation.test.ts:612](/home/greg/code/spideryarn2/tests/owner-isolation.test.ts:612) still compares the authorization call against `fsLocations(slug)`, which no longer exists in `sendSource`. `indexOf` returns `-1`, so this fails when the Postgres suite runs. Without its database environment, the suite skips and conceals the regression.

Fix: compare `shelfStore.read(slug)` with `loadSource(slug)`, and add route-level tests for authorization order, all four statuses, headers, and exact body length.

### Low — several comments and docs still describe the old default or deleted implementation

Examples:

- [params.ts:202](/home/greg/code/spideryarn2/src/web/params.ts:202) says absent mode means table of contents and that `?mode=toc` still works.
- [url-state.md:37](/home/greg/code/spideryarn2/docs/project/url-state.md:37) says the absent mode is the table-of-contents default, contradicting the corrected section later in that file.
- [SourceLink.tsx:32](/home/greg/code/spideryarn2/src/web/SourceLink.tsx:32) says production still reads the source from local disk.
- [App.tsx:1172](/home/greg/code/spideryarn2/src/web/App.tsx:1172) says the title omits Hierarchy rather than whichever mode is the default.
- [web-client.md:29](/home/greg/code/spideryarn2/docs/project/web-client.md:29) still calls the dock a five-mode switch.
- [search.md:144](/home/greg/code/spideryarn2/docs/project/search.md:144) still describes Search as following `toc`.

Fix: sweep the mode/default/source comments. The implementation should remain unchanged.

## What is correct

- The `inMode`/`bandOpen` split is correct. Plain forces prose on, suppresses gist columns, renders no band, and does not show the ×.
- `plainCols` is stable, the `fit` memo depends on `plainCols`, and no remaining layout consumer incorrectly uses `cols`.
- Plain works with `?text=0`, explicit `?cols=`, and `?spine=0`. Direct execution of the pure layout path produced prose-only layouts in every combination checked.
- `layoutKey` contains every geometry-changing result. Cases where it stays equal have equal table geometry.
- `currentRevision(slug, "rawSource")` is owner-filtered through `ownedSlug`; a different owner gets the ordinary 404.
- `rawBytes` is granted only to the `rawSource` projection. No other current code path invokes that projection.
- The extraction into `raw-document.ts` is behavior-preserving. `export.ts` re-exports all three names, and `npm run cycles` passed.
- Route status plumbing produces the requested 404/500 outcomes. All source loading and verification happens before headers are sent.
- `Content-Length` is calculated from the exact `Uint8Array` being passed to `res.end`; there is no application path to a partial or mismatched body.
- `inline`, `application/pdf`, and `nosniff` are appropriate for opening the PDF in the browser’s viewer.
- The double authorization is defensible. In Postgres it repeats the same ownership predicate rather than providing truly independent policy, but `loadSource` must remain owner-filtered for direct contract callers, while `shelfStore.read` is the route-level defense.
- `owner={!!owner}` matches the owner capability, not merely authentication, so a signed-in visitor cannot get the private-file control.
- The CSS specificity comments are correct. Both guards are `(0,3,0)` and beat the hidden-state selector’s `(0,2,0)`; `:where()` contributes zero. `.mode-band` follows both restored variables.
- The 620px-height/731px-width OR covers phones in either orientation. The existing 832–843px spine-off band mismatch is documented and predates this change.
- `toc` no longer resolves specially; client and serverless title parsing share `DEFAULT_MODE`.
- The tenth dock mode does not break keyboard walking: it uses `MODES_UI.length`.
- `visitorGap`, `markedModes`, shared-link titles, and public rewrite behavior all handle Plain correctly.
- The working-tree copy of `reading-view-overview.md` is already updated, despite the prompt saying it was deliberately not yet.

Verification: `npm run cycles` passed. Vitest could not collect tests because this review sandbox is read-only and Vite tried to create cache directories. Running the typecheck script without its wrapper checked all projects; it found one unrelated peer error in `tests/diagram.test.ts:340`, not in this change.