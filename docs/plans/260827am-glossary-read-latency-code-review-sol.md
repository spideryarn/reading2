## Findings

1. **Must-fix — the glossary change does not typecheck.**

   [useGlossary.ts:123](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:123) declares `run` before assignment, then its initializer’s `finally` reads it at [line 163](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:163). Web typecheck reports `TS2454: Variable 'run' is used before being assigned.`

   The promise-identity idea is correct; implement cleanup after assignment or store an explicit request token.

2. **Must-fix — joining an existing request can consume a job-completion refresh.**

   [fetchNow](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:112) joins every in-flight request. [onFinished](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:356) uses that same operation.

   Concrete race: GET A snapshots the old glossary → job commits new terms → `onFinished` joins A → A installs the old glossary → nothing retries. The paid-for terms remain invisible until another remount or event.

   Separate join-only initial loading from semantic invalidation. Job completion and mount revalidation need one coalesced fetch guaranteed to start after the current request finishes.

3. **Must-fix — lookup and reload still overwrite each other.**

   An old GET can replace a newly patched lookup at [useGlossary.ts:142](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:142). The comment at [line 227](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:227) explicitly accepts that visible loss.

   Worse, lookup reads an entry before the long model call ([term-lookup.ts:146](/Users/greg/Dropbox/dev/experim/spideryarn2/src/term-lookup.ts:146)), then returns that whole old entry ([line 208](/Users/greg/Dropbox/dev/experim/spideryarn2/src/term-lookup.ts:208)). [patchEntry](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:232) replaces the entire current entry. A concurrent glossary regeneration can therefore be overwritten with stale name, prose, aliases, scores, and blocks.

   Patch only `{id, lookup}` and either overlay newer local lookups onto older GET results or guarantee a post-lookup fetch.

4. **Should-fix — failed background revalidation hides the list it was meant to preserve.**

   Every fetch failure sets `status = "error"` at [useGlossary.ts:153](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:153). The panel renders entries only under `status === "ready"` at [GlossaryPanel.tsx:234](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/GlossaryPanel.tsx:234). A transient failure opening the band therefore removes the known glossary instead of reporting a refresh failure behind it.

5. **Should-fix — the projection guard still does not inspect the queries.**

   [store-revision-columns.test.ts:101](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-revision-columns.test.ts:101) compares policy keys with selector-object keys. It does not prove that `currentRevision`, `listArticles`, or publication still use those selectors, nor that each key points to the corresponding column. The cast at [pg.ts:427](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:427) would hide a full-row query from TypeScript.

   The live projections are correct. Export query-builder seams and inspect their generated SQL, as `blockHashQuery` already does.

6. **Should-fix — the promised race and wiring tests are absent.**

   [glossary-one-fetch.test.tsx:113](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/glossary-one-fetch.test.tsx:113) discards `onFinished`, so it cannot expose finding 2. There is no lookup race test. Its header names a nonexistent `glossary-band-wiring.test.ts` at [line 31](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/glossary-one-fetch.test.tsx:31).

   A cheap App guard is an AST-based source contract asserting one `useGlossaryRead(slug)`, its `terms` derivation, and `read={glossaryRead}`. The causal job/lookup races need behavioral tests.

7. **Note — the render-phase reset is loop-safe, but unnecessarily risky.**

   The `readingSlug` guard prevents an ordinary render loop. Its ref writes at [useGlossary.ts:184](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:184) are not rollback-safe under an abandoned concurrent render. Production currently avoids this path because [App.tsx:412](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:412) keys `Reader` by slug.

Other audits:

- All eight live projections contain the fields their readers use. `metadata`, ideas/tree handling, and publish are correct; publish’s `id` is merely unused.
- `blocksFor` maps every `Block` field correctly and drops only database bookkeeping plus `fts`.
- `Promise.all` can use two pool connections because the pool maximum is five. Under saturation it serializes. It is two concurrent database round trips, not literally one.
- Leaving the library’s four JSONB presence checks is defensible as scoped follow-up; the policy documents the debt rather than preventing its later removal.
- Focused tests passed: 4 files, 91 tests. Full `npm test` was blocked by the read-only sandbox’s `.vite-temp` write. Web typecheck reproducibly fails on finding 1.

**Verdict: not safe to commit.**