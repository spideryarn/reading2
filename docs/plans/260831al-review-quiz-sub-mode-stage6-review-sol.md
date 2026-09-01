Nothing here is unsafe to leave over the weekend.

1. The three fixes close their safety holes: provider `"error"` cannot produce `done`; a pre-SSE disconnect starts the provider signal aborted; and deleting an answer no longer leaves the displayed mark looking current.

2. Fix 2 introduces no shared-route regression. Existing callers already suppress writes using `res.destroyed`/`writableEnded`; only Quiz consumes the new abort signal. One non-blocking leftover deserves recording: an already-closed response still starts an unreferenced heartbeat interval whose `close` event was missed. It spends no money and cannot write, but remains until process exit.

3. The ABA reasoning is sound. [`loadArticle`](/home/greg/code/spideryarn2/src/store/pg.ts:1839) applies `metaFrom` and `titleFor`, including heading and shelf-title fallbacks, while [`metaFingerprintOf`](/home/greg/code/spideryarn2/src/store/pg.ts:1191) returns `null` for a null stored title. Re-hashing the reader-facing `Article.meta` would therefore falsely reject renamed articles and many untitled ones. “Every untitled article” is slightly too absolute—an article falling back exactly to its slug with no other metadata may coincide—but the load-bearing conclusion is correct. The surviving ABA requires two publications inside one handler, with the latter restoring both the fingerprint and original batch; accepting it is a reasonable stopping point.

4. Besides the heartbeat sentence, change the nearby [`didNotFinish` comment](/home/greg/code/spideryarn2/src/quiz-mark.ts:508) from “Two of those five” to “three”; the implementation now rejects `length`, `content_filter`, and `error`. Everything else, including the known test gaps and ABA decision, is already recorded.

The web typecheck passed. Broader checks were obstructed by unrelated dirty-tree type errors and the read-only sandbox preventing Vitest’s temporary config file. No files were changed.

**Verdict: stop here.**