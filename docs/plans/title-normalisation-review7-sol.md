LGTM

- Blocker 1 — CLOSED. `TitleSpec` requires `mode` for article views and forbids it elsewhere. `mode?: never` also rejects variable-built specs. `PublicPages.tsx` and `Metadata.tsx` only construct non-article variants. [page-title.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/page-title.ts:85), [App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1143)

- Blocker 2 — CLOSED. `req.url` is restored before every route branch; the sole production call passes that request, and `servePublicReadPage` reads it directly. The previous `restored`/`path` call-site choice no longer exists. [vercel.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:254), [page.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/page.ts:300)

- Blocker 3 — CLOSED. Only the first `?` starts the query; pairs split only on `&`; key and value are decoded together. `+`, missing `=`, repeated `about`, and malformed escapes behave correctly. The corpus is independently anchored for view; separate explicit tests anchor mode and title composition. [read-address.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/read-address.ts:77), [address-settling.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/address-settling.test.ts:172)

- Robots decision — safe. Named groups do not inherit `*`; without their own `Disallow: /`, they would indeed be open. The longer `Allow: /read/` wins only there. This follows the [Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html). The composed head remains gated by `visibility = 'public'`; private, absent, and unreadable articles receive the bare shell. [robots.txt](/Users/greg/Dropbox/dev/experim/spideryarn2/public/robots.txt:42), [public-slug.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-slug.ts:40)

Validation: 194 targeted tests passed; the web TypeScript project is clean.

One remaining nit: [address-settling.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/address-settling.test.ts:11) says “Eight” but enumerates nine items because it includes `not-shared`. This does not block the change.