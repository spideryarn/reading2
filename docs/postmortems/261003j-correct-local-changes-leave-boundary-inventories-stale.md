# Correct local changes leave boundary inventories stale

Up: [postmortems.md](../project/postmortems.md)

Review of `4b502174a` found two integration omissions in Debate's split. Production impact has not
been established. Root causes were independently checked by a read-only subagent.

## The class: a correct local change leaves the boundary inventory stale

The candidate removed `name` from `REMEMBERED` to stop replaying the retired identification filter.
But `ARTICLE_PARAMS` derives incoming-link recognition from that list and `NEVER_REMEMBERED`.
Consequently `?name=linked` alone became a bare address, allowing a saved Claims view and restrictive
bar to be appended. The new test failed with `hasArticleState("?name=linked") === false`.

The candidate also correctly extracted Scholar URL construction from server-only `citations.ts`
into an import-free leaf. The client boundary's `SHARED` manifest was not updated, so its existing
test rejected `src/web/DebatePanel.tsx → ../scholar-search.js`. This was a failing gate, not evidence
of server code reaching the browser: the client build passed.

Both omissions were introduced by `4b502174a`. Tests of the new parsers, row grouping and client build
did not exercise historical-link recognition or the separate import inventory. The wider offline
review run did exercise the import guard and failed on its existing assertion.

## The fixes and countermeasures, ranked by ease against value

1. Keep retired article keys in `NEVER_REMEMBERED`. Added `name`; old memory drops the control,
   while incoming old links still outrank memory. The regression in
   [last-view.test.ts](../../tests/last-view.test.ts) checks both policies. The existing `deep`
   retirement test documents the same contract; scanning present writers cannot cover past links.
2. Register the genuinely shared pure helper in the boundary inventory. Added `scholar-search.js`
   to [client-imports.test.ts](../../tests/client-imports.test.ts); its existing purity check now
   also checks that module's imports. The existing red test is sufficient coverage, with no
   duplicate helper or new mechanism.
3. Forbid deleting inventory entries or automatically allow every new leaf. Rejected: non-article
   parameters may properly leave the URL inventory, and apparent runtime purity must not silently
   widen the client boundary. Each inventory expresses its own policy.

These are the long-term fixes as well as the review patches: no runtime bypass, extra state or
second implementation was needed.
