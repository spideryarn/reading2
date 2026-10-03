**Verdict: land.**

No P0/P1/P2 findings in the new changes; C1–C3 excluded.

1. **Stored state:** An in-memory check of 100 combinations found no violations. Non-hideable columns remain visible; Published requires its ID in the shown key; valid choices survive toggling and remounting. IDs belonging to the other key are ignored.
2. **Identity:** `visibility` and its callback remain stable across unchanged renders, including freshly rebuilt column arrays. Memos depend on string keys, not `canHide`. [shelf-hidden-columns.ts:115](src/web/shelf-hidden-columns.ts:115)
3. **Other consumers:** `/design` uses neither API. `/admin` and tests without controlled visibility retain their existing behavior; `useSortedTable` does not interpret `startsHidden`.
4. **Tests:** Every newly added case asserts Published starts absent, so ignoring `startsHidden` would fail it.
5. **Simpler alternative:** One versioned object of explicit overrides, such as `{"length":false,"published":true}`, with legacy arrays migrated on read. Missing entries use column defaults. This meets both requirements but adds migration logic; the second key is reasonable here.

`npx vitest run tests/shelf-table-hide-columns.test.tsx`: **31 tests passed**. No files changed.