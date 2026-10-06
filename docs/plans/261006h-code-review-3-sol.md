**Closed.** The fix is committed as `9a24721e5`. The timeout ends `loading` without setting `known`, so it no longer records a signed-out article arrival. The late session preserves the shared link and saves it under A’s key.

The requested tests passed: **3 files, 16 tests**.

Reverting `known` to `!loading` would make the new test fail: the timeout records the article for nobody; A’s subsequent arrival then strips `?mode=glossary&at=spya-d2w4rt`.

No introduced P0 or P1 found. Every session notification—including a signed-out `null` answer—and replay of an already-known session sets `known` true. It remains false only while no session answer ever arrives; saving and restoration stay withheld because the reader’s identity remains unknown.

No files changed.

VERDICT: closed