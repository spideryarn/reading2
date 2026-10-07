# Invalidating a cache does not restart its mounted readers

Up: [postmortems.md](../project/postmortems.md) · [plan 261007m](../plans/261007m-a-private-copy-of-a-public-article-on-your-own-shelf.md)

Found in Sol's code review, 2026-10-07, before commit. Introduced by the uncommitted
`useShelfEntry` addition in plan 261007m; there is no introducing commit.

The class is **invalidation without restarting the lookup**. `forgetShelf` emptied the
module cache and notified its readers, but the new hook's load effect depended only on its
URL. A mounted hook at the same address re-rendered as unknown after an account switch
and never asked for the new reader's shelf. Its original markup tests ran no effects.

The regression test in [private-copy-offer.test.tsx](../../tests/private-copy-offer.test.tsx)
was seen red: expected `next-readers-copy`, received `unknown`. A generation incremented
only on reader changes now restarts the effect. The test then passed. The existing
request fence still refuses the previous reader's late response.

This was a hook robustness defect, not a demonstrated cross-reader disclosure: the
current `useArticleAccess` returns loading synchronously on a reader-id change, so
`ArticlePage` unmounts the visitor's hook. Independent root-cause review confirmed that
limit. The hook should also be correct when kept mounted.

## What would have caught the class, ranked by ease against value

1. **Keep the consumer mounted while its cache is invalidated**, then assert the replacement
   arrives, not merely that the old value disappears. Added here.
2. **Read invalidation and effect dependencies together** when adding a subscriber to an
   existing cache. Sharing the cache does not automatically share its reload behavior.
3. **A new store abstraction** is rejected: the existing watcher and a reader generation
   suffice. Reloading directly inside the invalidator is also rejected because sign-out
   invalidates before React removes an eligible offer; loading from the effect lets the
   updated eligibility govern requests.
