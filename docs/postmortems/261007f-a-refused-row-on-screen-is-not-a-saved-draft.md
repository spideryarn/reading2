# A refused row on screen is not a saved draft

Review of `a95dae313` reproduced loss of a reader's refused criterion after reload. No reader
incident was reported in this review. The criterion and both poles stayed visible until the hook
unmounted, then vanished: the server had refused to store them and the browser had no draft store.

Up: [postmortems.md](../project/postmortems.md) · change:
[the ceiling plan](../plans/261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md).

## The class: visibility mistaken for durability

The refusal test ended while React still held the failed row. That proved the words were on screen,
but was used to support the stronger claim that the words were kept. The two lifetime boundaries
were different: the transaction never accepted the row, and the hook discarded its state on
unmount. A draft needs an owner beyond that component.

The underlying optimistic failure handling and opening `setRows([])` originated in `b9f1d2a53`
(Criteria's first implementation, confirmed with `git log -S`). `a95dae313` introduced the routine
ceiling refusal that relied on that ephemeral state. The older full-list refusal had the same
limitation; this review changes only ceiling-refused drafts, not every input in the application.
Chat and Search also have draft stores with explicitly documented memory-only lifetimes; those
are wider work, not changes made here.

## The scoped fix and its limits

[`criterion-refusal-drafts.ts`](../../src/web/criterion-refusal-drafts.ts) keeps ceiling-refused
words and configuration in session storage keyed by reader and article. Restoration submits
nothing. Acceptance hands ownership to the server; explicit deletion discards the draft. Late
responses must observe that discard, including one made by a remounted hook. This is a durable
draft boundary for mode changes and reloads in the same tab; it does not promise cross-device
storage, survival after closing the tab, or recovery when browser storage is unavailable.

## Countermeasures, ranked by ease against value

1. **Unmount and remount after refusal** — implemented in
   [`use-criteria-refusals.test.tsx`](../../tests/use-criteria-refusals.test.tsx). The three initial
   preservation cases failed before the fix: **3 failed, 15 passed**. Test the lifetime boundary
   beyond the one that makes the value visible.
2. **Delete a restored draft before an older response lands** — implemented. Two separate
   interleavings each failed before their guards: **1 failed, 18 skipped**, then **1 failed,
   19 skipped**. Discard is an ownership change, not just removal from today's screen.
3. **A server draft table for every unsaved input** — not implemented. It could preserve input
   beyond the browser, but introduces a second storage lifecycle and broader product choices.
   The refusal fix does not require that larger system.
