No P0 findings.

1. **P1 — `src/web/FeaturesPage.tsx:387`** — Tweets promised every item linked back and implied opening always generated it. Legacy/invalid posts may lack links, and only an owner’s absent thread auto-runs. Fixed the copy and provenance comment.

2. **P2 — `tests/features-page-modes.test.tsx:69`, `tests/landing-page-tiles.test.tsx:51`** — Experimental-tag tests began from `[data-mode]`, so omitting a `mode` prop could make a broken occurrence invisible. Fixed by finding every expected visible title first, then asserting its mode and tag.

3. **P2 — `tests/marketing-public-sharing.test.tsx:64`** — Privacy assertions could pass when comments/searches were merely mentioned, without saying they were shared; profile privacy was untested. Fixed with scoped, directional assertions for comments, searches, chats, and profile.

All earlier plan-review findings are now honoured. `/design` uses real components; the inert panel has no user or effect-driven write path. Screenshot dimensions and alt text match the inspected PNGs. The Experimental tag remains readable before an intact heading and its CSS is safe at 390px.

Validation: 113 focused tests passed; all four TypeScript projects passed. The `npm run typecheck` wrapper itself was blocked by sandbox IPC permissions, so its underlying compiler commands were run directly. No changes were committed.