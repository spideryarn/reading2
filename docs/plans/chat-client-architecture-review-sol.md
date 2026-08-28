## Findings

1. The `refreshThread` comment is wrong. Thread IDs are only unique per article ([schema.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1441)). Two articles may share an ID, so a stale repair can replace or remove the new article’s thread. Keep the guard, rewrite the comment, and test this observable success case ([useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:660)).

2. `setError(null)` is correct but is not currently a reader-visible bug fix: `Reader` already remounts on slug change ([App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:413)). If `useChat` must support changing slugs without remounting, the fix is incomplete: late stop/delete/cancel errors can still arrive after the reset. Correct the claims in the test and write-up.

3. The phase collapse is sound, but its safety claim is false. A stale admitted failure could still change `"ready"` to `"failed"`. The `live` gate prevents bug 10; `phase` merely removes `(loaded=false, loadFailed=true)` ([useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:586), [plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-client-architecture.md:95)).

4. The plan’s count of three `setComments` sites is wrong; there are ten ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-client-architecture.md:30)).

Otherwise, the refactor preserves the requested behavior:

- Body errors, non-2xx responses, and transport failures retain equivalent outcomes.
- `loaded/loadFailed` map correctly across all three phases.
- The `running > 1` early return is unchanged.
- The 409 caller previously ignored the returned boolean, so awaiting `void` changes nothing.
- The outer `.catch` is harmless and still funnels through `settle`; I would keep it as a defensive normalization, though it is not evidence for correctness.

For this single load, the effect-run closure is operation identity. One continuation, one write path, and one `live` gate are as strong as an `opId` admission check. It will not fight step 2; the general operation model is still needed for turns, ownership, repair, and recovery.

Verification: 27 focused tests passed; web and test TypeScript projects passed. Aggregate typecheck currently has unrelated shared-tree errors plus `rename-preview.tsx`.

**Verdict: do not ship.** The one required change is to correct and test the `showing` guard’s observable cross-article same-ID write case.