## Findings

1. **Must-fix — the concurrency docs understate the peak.** Both docs say the change raises peak queries from two to three ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/library-read-latency.md:448), [reader profile](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/reader-profile.md:195)). But `resolveProfile` starts two queries ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2710)), while the glossary loader can later start two more concurrently ([pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1393)). If the profile queries remain outstanding, glossary can peak at **four**, not three.

2. **Must-fix — the plan incorrectly says `resolveProfile` returns `null` for a missing slug** ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/library-read-latency.md:443)). The shelf read falls back, but a global profile still renders and is returned ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2714)). The route comment has the correct wording: “the global half still counts.”

The reader-profile heading “costs nothing extra” also overstates matters; the section itself correctly admits extra concurrent work and possibly extra latency.

## Requested checks

1. **The promise shape is right.** `.catch` immediately marks the original profile promise handled. The later `await profile` still observes its rejection; it does not re-arm an unhandled rejection. Rejection before, between, or after those operations behaves consistently.

2. **The 404 test guards the `allSettled` regression.** A harness timeout is valid evidence for a never-settling implementation, though its diagnosis is slower and less precise than racing the reply against a one-turn sentinel. It does not prove there is zero finite delay, but it proves the relevant claim: the response does not wait for the profile to settle.

3. **All four call sites are correct.** Each invokes the loader inside the thunk and selects the correct stamp: `thread`, `glossary`, `summaries`, and `ideas`.

4. **The exact `asked` assertion is sufficient.** Its post-response position catches an unconditional probe followed by a real second load. No separate count is needed.

The shelf-filter widening is sound. That corpus check is deliberately conditional, while the owned fixture independently and unconditionally proves the fallback at [store-shelf-reads.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-shelf-reads.test.ts:658).

Focused results: all 16 concurrency tests passed. I could not independently reproduce the mutation table in this read-only tree. Full `npm test` was blocked by permission to create Vite’s temporary config. The normal typecheck hit a sandbox IPC error; running its logic directly found unrelated in-flight errors in `public-reader.ts` and two unchecked preview files, so I cannot confirm the current whole-tree gate is clean.

**Verdict: not ready to commit.**