# A durable ownership answer needs both a reader and a request generation

Review of [261007k](../plans/261007k-repeat-paste-is-free-and-says-so.md) found that a repeat
answer in the prose hover card could survive a change of reader. Reader A receives an article
answer, signs out, and reader B hovers the same URL: the card says the article is already on B's
shelf and links to A's slug instead of offering to add it. The new repeat behaviour was caught in
the uncommitted change; no reader exposure from that change was established.

## Resource identity is not ownership identity

`asked` in [ProseHoverCard.tsx](../../src/web/ProseHoverCard.tsx), used by `WithAddToShelf`, is
module-level so an add survives the card being torn down. Its key was only `urlKey(url)`. That
correctly joins equivalent addresses, but does not distinguish readers. The new `have` record
made this omission an enduring ownership assertion: `describeAdd` returns its article without
consulting a job or asking the server again.

The shelf lookup has the opposite lifetime: [link-facts.ts](../../src/web/link-facts.ts) forgets
the previous reader's shelf. After B's own empty shelf loads, `ExternalBody`'s `library` and
`shelfKnown` checks allow the old `have` answer through. A correct sibling cache therefore makes
the stale ownership record visible rather than containing it.

The underlying URL-only map arrived in commit `3a282b832be939b21fa0340cf89cd4d96c5acf10`,
*Add to Spideryarn, from the card over the link*: the intent was to retain pending requests,
refusals and job identity across re-hovers. Commit
`b005c9f81b8bd57df86223321c41cb31b72dd61a`, which added reader-change invalidation to shelf and
summary caches, did not include `asked`. The permanent `have` ownership answer was introduced
by the uncommitted 261007k diff. Earlier queued and refusal records also crossed readers; that
part of the class predates this change.

## Clearing the cache does not fence a late refill

[useJobs.ts](../../src/web/useJobs.ts)'s `act` captures the engine epoch and fences engine
updates, but still returns a successful response to its caller. An old card's pending promise can
therefore write A's answer after a reader-change callback clears the map. The caller's durable
store needs its own generation check; the engine's protection is not transferable evidence.

The review fix uses [reader-change.ts](../../src/web/lib/reader-change.ts)'s existing
`forgetOnReaderChange` callback to clear `asked` and `refreshedFor`, and advances a generation
that `add` captures before awaiting its response. A response from another generation cannot
repopulate the maps. This is also the lasting design: these records belong to the active reader,
and retaining them for readers who have left is unnecessary. Keying by reader alone would keep
inactive-reader records and still require careful treatment of pending callbacks.

## What would have caught it, ranked by ease against value

1. **Exercise both completed and pending ownership answers across a reader change.** Cheap,
   high value. The review adds these two component cases to
   [add-to-shelf-from-the-card.test.tsx](../../tests/add-to-shelf-from-the-card.test.tsx), using
   the real reader-change notification. Both were observed red before the fix with the assertion
   “reader B inherited reader A's repeat”: one exposes retained ownership, the other exposes a
   late refill. The original repeat test used one reader and an
   immediate answer, so it could not distinguish either broken lifetime.
2. **Inspect module stores alongside their async writers when adding a durable response kind.**
   A small review cost: identify which reader owns the record, how that ownership ends, and what
   prevents a pending request from restoring it. The sibling shelf and summary stores already
   provide an example of this boundary.
3. **Move the card's records into a new general cache framework.** Rejected: the existing
   reader-change callback and a local generation express the required lifetime directly. A new
   abstraction would add scope without proving that any caller adopted it correctly.

Up: [postmortems.md](../project/postmortems.md).
