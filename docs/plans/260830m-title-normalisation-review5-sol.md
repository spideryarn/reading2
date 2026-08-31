NOT FIT TO COMMIT.

### Blockers

1. Encoded `at` keys break “the fragment wins”

[`liftLegacyAnchor`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/router.ts:572) removes only literal `at=` pairs:

```text
/read/a-shared-piece?%61t=spya-k6fpme#spya-k3m9qt
→ /read/a-shared-piece?%61t=spya-k6fpme&at=spya-k3m9qt
```

`URLSearchParams.get("at")` decodes `%61t` and returns the old `spya-k6fpme`, not the fragment’s `spya-k3m9qt`. The textual edit must remove every encoded spelling that parses as key `at`, while preserving unrelated pairs byte-for-byte.

2. The cross-product cannot catch the `?slug=` or `?add=` regressions

[`address-settling.test.ts:149`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/address-settling.test.ts:149) explicitly permits the server’s article title when the client leaves:

```ts
server !== null && server !== `${TITLE} · Spideryarn`
```

Therefore, restoring either unrestricted rewrite produces `client === null`, the server’s ordinary article title, and no failure. I confirmed that exact predicate returns `caught: false` for both cases.

For an address receiving an enhanced server head, `client === null` must reject every non-null server title. Root legacy entrances cannot share that invariant: their initial bare-shell-to-article title change is expected.

3. The “server behaviour” is still manually reassembled

[`serverTitle`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/address-settling.test.ts:65) calls `readMode`, `viewFor`, and `composeShell` itself. Production connects them separately in [`vercel.ts:333`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:333).

Deleting either production `mode:` or `view:` argument would reintroduce the visible title change while this structural test remained green. The wire-level tests also call `servePublicReadPage` with both defaults. This is a contract model, not the real server behaviour its comments claim.

### Answers

- The cross-product idea is right, but the axes are not yet complete. `QUERIES` covers seven key families, not every recognised app parameter, and omits duplicate/order and encoded-key classes such as `%61t`.
- Vary paths separately by routing class. Only server-composed base-read paths belong in strict server/client equality. Root legacy, nested metadata/tweets, add, and malformed paths need route-eligibility assertions instead.
- `splitHref` and hash carriage look sound. Appending `at` is harmless once every equivalent old `at` key is removed; currently it is not.
- I found no current title mismatch in an additional 81,760 canonical-read query/hash combinations. I did find the encoded-`at` settling regression above—the ninth address bug, though not a title divergence.
- I could not rerun Vitest because this workspace is read-only and Vite needs a temporary output file. Read-only Node probes and `git diff --check` succeeded.

