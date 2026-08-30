CHANGES REQUESTED — one blocker.

- **Eighth divergence: the hash rewrite reserializes the query.** At [main.tsx:172](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/main.tsx:172), `URLSearchParams.set()` can canonicalize an encoded legacy parameter before the metadata rewrite runs:

  `/read/a?%61bout=1#spya-k3m9qt`

  Server: `viewFor()` sees `%61bout`, returns article.  
  Client: hash rewrite produces `?about=1&at=…`, then redirects to Metadata.

  The same occurs with `about=%31` and `panel=%61bout`. Preserve the raw query during the hash rewrite, or make both sides intentionally decode it. Add a combined regression test; the separate predicate tests cannot catch this interaction.

- **Root constraint:** no incompatible address found. Repository docs and producers use only `/?slug=` and `/?add=`; new links use `/add/<encoded>`. Only undocumented non-root aliases stop working.

- **Callback control:** current behavior is correct, and the root positive control is sound. Minor weakness: counting four `!onCallback` tokens at [router.test.ts:593](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/router.test.ts:593) would not catch a fifth unguarded rewrite. Compare guarded rewrites against rewrite sites instead.

- No `<base>`, service worker, meta refresh, or other pre-React navigation was found outside `main.tsx`. Separately, malformed percent escapes in a hash still throw at `decodeURIComponent`; that is pre-existing.

Targeted result: 4 files passed, 147 tests passed. Not fit to commit until the hash/query interaction is fixed.