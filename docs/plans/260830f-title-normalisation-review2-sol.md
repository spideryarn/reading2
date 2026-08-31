VERDICT: **CHANGES REQUESTED**

### Findings

- **[P2, blocking] A fifth title divergence exists through legacy metadata URLs.**

  `/read/x?about=1` and `/read/x?panel=about` match the server’s base-article rewrite ([vercel.json](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:28)), so the server composes the article title. Before React mounts, the client rewrites either address to `/read/x/metadata` ([main.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/main.tsx:234)). The metadata page later writes `Article · Metadata · Spideryarn` ([PublicPages.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/PublicPages.tsx:59)).

  With `?mode=glossary`, the initial title is even `Article · Glossary · Spideryarn` before becoming Metadata. The direct `/read/x/metadata` reasoning is correct, but it misses this legacy route into the same view. Add both legacy spellings to the server/client pairing.

- **[P2, blocking] `isMode` is not actually the client’s predicate.**

  The server calls `isMode` ([vercel.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:224)), but `modeParam` still independently calls `MODES.includes` ([params.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/params.ts:251)). The transport tests compare against literals, while the title test bypasses transport by passing an already-valid mode directly ([page-head.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/page-head.test.ts:502)).

  They agree today, but “one place decides” is false and no test pairs invalid inputs. Make `modeParam.parse` call `isMode`.

### Other conclusions

`readMode` is safe for browser request query strings: malformed escapes do not throw, duplicate parameters select the first value on both sides, and only static labels can reach `<title>`. A raw `#fragment` produces different results if handed directly to `readMode`, but browsers never send fragments to the server, so it is outside the transport path.

The mode vocabulary, ordering, default, type, and existing exports are otherwise unchanged. The re-export shape is sound.

Nit: comments claiming `title-text.ts` imports only `html.ts` are now false; it also imports `modes.ts`.

The added PG fixtures use scoped IDs and deletes, so I do not think this change causes the reported suite flakiness. However, `admin-store.test.ts` is explicitly read-only and I found no article `TRUNCATE`, so that specific causal explanation is unconfirmed.

Verification: 167 focused tests and the 46/46 shell self-test passed. The web typecheck passed. Full typechecking is currently obstructed by unrelated concurrent-tree errors. No files were edited.