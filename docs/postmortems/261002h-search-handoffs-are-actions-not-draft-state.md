# Search handoffs are actions, not draft state

Up: [postmortems.md](../project/postmortems.md) · [the plan](../plans/261002h-quick-search-bar-in-the-dock.md)

Stage 3 review caught lost Enter requests, premature asks, and an old request replayed on article
return. Reproductions used the real bar, band and search hook with mocked transport. The fixes are
uncommitted at the time of writing.

The class is **an action represented as mutable view state across an asynchronous handoff**.
The draft answers “what does the box say now?”; Enter answers “ask these words, sealed now”. A
single `"enter"` flag cannot represent both. Reading the draft when consuming that flag changed
what an earlier Enter meant, and a second Enter simply overwrote the first. Retaining the flag
alongside the article's persistent words also made a later mount execute an abandoned action.

Introduced by **234ae4cd9**, the stage 3 shared-draft/bar commit. Its initial tests mounted the band
promptly, outside StrictMode, so producer and consumer were almost synchronous. The real client
uses StrictMode: consuming an action in the first effect setup removed it from the store, then
session cleanup erased it before the opening GET answered. Separately, an older bar timer survived
a transfer to the band's session and could force that session's next ask too early. Both mechanisms
come from missing ownership rules at the handoff, rather than from the search matcher.

The durable fix is the one made here: explicit Enters retain ordered snapshots of their words;
automatic pauses can coalesce and use the latest words; article or mode departure discards actions while retaining
the draft; the band's registration transfers debounce ownership; consumption waits until after
StrictMode's effect replay. The existing session reducer still owns the loaded gate and request
rules. This adds no second requesting path.

Countermeasures, ranked by ease against value:

1. **Delay the consumer and its acknowledgement independently.** Done in
   [dock-quick-search.test.tsx](../../tests/dock-quick-search.test.tsx): multiple Enters and later
   edits before mount, StrictMode plus delayed GET, departure before consumption, and a surviving
   local timer followed by a newer edit. Each defect's test failed before its fix.
2. **Represent explicit actions with immutable arguments, separately from view state.** Done in
   [search-draft.ts](../../src/web/search-draft.ts). This is cheaper than reconstructing the intent
   from whichever words happen to be visible later.
3. **A persisted event journal or lifting search requests into Reader.** Rejected: the handoff is
   short-lived and the existing band already owns asking. Those choices add ownership surfaces
   without improving this contract.
