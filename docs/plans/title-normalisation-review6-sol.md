STOP — not fit to commit yet.

BLOCKERS

1. The client half still models production. [`clientTitle()`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/address-settling.test.ts:115) calls `pageTitle()` itself. If [`App.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1143) omits `mode`—which compiles because it is optional—the real tab loses the mode while the cross-product stays green.

2. The server’s final wiring remains untested. Changing [`url: restored`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:315) to `url: path` compiles and drops all query state. The corpus stays green because it supplies its own URL directly at [`address-settling.test.ts:90`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/address-settling.test.ts:90). Required means “some string,” not “the restored string.”

3. The tenth: [`redirectsToMetadata()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/read-address.ts:113) treats a `?` inside another parameter’s value as a new parameter boundary. These wrongly redirect:

   - `?add=https://x.test/a?about=1`
   - `?next=https://x.test/?about=1`
   - `?x=?panel=about`

   Both sides agree on the wrong page, so equality cannot catch it. Only the first `?` begins the query; after that, only `&` separates pairs.

On `about`/`panel`: decoding removal alone would indeed be wrong. But raw/raw is not my preferred rule. Percent-encoded unreserved characters are the same parameter, and `at`, `slug`, and `mode` already behave that way. Decode both the shared decision and removal, while retaining untouched pairs byte-for-byte. That should make `%61bout=1`, `about=%31`, and `panel=%61bout` equivalent to their literal forms.

Taking the whole `url` is not an injection or authorization risk: mode and view resolve to closed vocabularies, and the URL is not reflected. The risks are semantic—the false boundary above—and the still-unprotected transport seam.

NIT

The test and project doc still repeatedly say “eight,” although they enumerate nine; for example [`address-settling.test.ts:2`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/address-settling.test.ts:2) and [`page-titles.md:497`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/page-titles.md:497).