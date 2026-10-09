Findings:

- **F1 — Low — `useSeenOnce` could revoke “seen.”** An `enabled: true → false → true` transition reverted a formatted row to its waiting string. Fixed by permanently recording the eager fallback. Added a red-first regression test, StrictMode coverage, constructor/`observe()` failure coverage, and synchronous-polyfill coverage in [when-seen.ts](/var/tmp/spideryarn-worktrees/bug-search-excerpt-stall/src/web/when-seen.ts) and [search-excerpt-lazy.test.tsx](/var/tmp/spideryarn-worktrees/bug-search-excerpt-stall/tests/search-excerpt-lazy.test.tsx).

- **F2 — Medium — Measurement claims exceeded the evidence.** The profile did not prove the remaining time was parsing/layout, and “adds no long task while scrolling” contradicted the recorded 111 ms maximum. “25 runs” was also unsupported by the described five-run table. Corrected the plan, postmortem, maths documentation, stale 0.8-second comments, and added the introducing commit (`3488ca196`).

- **F3 — Low — One overclaim remains in `performance.md`.** I did not edit this rule-bearing project document because its policy requires explicit before/after approval.

  Before: “jsdom does no style or layout, which was most of that cost.”

  Proposed: “jsdom does no style, layout, or MathML layout, and the Chrome profile did not assign the part of the regression outside excerpt JavaScript.”

- **F4 — Low — A replaced `ref.current` is not followed.** The effect depends on the stable ref object. This cannot occur in `BlockExcerpt`: while unseen it always renders the same unkeyed `<span>`, and key changes unmount the row. Left unchanged; change the helper to return a callback ref before adding a caller that swaps its target element.

No layout or selection defect was found: `.excerpt` has no CSS rules, `.srch-hit-quote` owns the typography and clamp, and both states expose the same text. Hidden bands are re-evaluated when shown; unsupported `scrollMargin` merely removes prefetching.

Checks:

- Focused suite: **75 passed**
- Typecheck: **passed**, 3,594 source files covered
- Doc links: **18 passed**
- Targeted lint: passed with three pre-existing SearchPanel complexity advisories
- Full `npm test`: could not start because this sandbox cannot reach the shared Postgres port (`EPERM`)

No commit or index changes made.

**Verdict: ship after my fixes.** I recommend approving the small `performance.md` correction before committing.