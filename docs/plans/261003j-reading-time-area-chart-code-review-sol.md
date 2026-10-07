- **F5 — P2, established, fixed:** With marginalia open, `marginNotes` depended on the fresh owner object and defeated `TableView`’s memo on every reach update. It now depends on the ownership boolean. The behavioral test failed with two renders before the fix and passes with one.
- **F6 — P3, established, fixed:** Help claimed no shading meant no reading. Recorded time below the 0.35 threshold also draws nothing. Corrected the copy after reproducing this mismatch.
- **F7 — P3, established, not fixed:** The older “thicker” wording remains in `reading-view-overview.md` and `experimental-features.md`, outside the candidate’s manifest.

Replaced the two Reader source-text tests with behavioral render-count and reach/levels wiring checks. Retained the CSS test as a declaration guard; it does not prove rendered clipping.

Subpixel bridging remains a **reasoned concern**, not an established live bug: normal visible rows have a 24px minimum; folded rows occupy zero height. The plain `ReadReach` alias currently has no incorrect production caller.

The changed reading-time and colour docs, and both Help passages after the correction, agree with the code. SVG child order and levels behavior remain covered.

All four requested files pass **102 tests**. Typecheck passes; scoped lint reports only existing complexity advisories. Both fixes were tested red first. Changes remain uncommitted; no whole suite or state-changing Git commands ran.

VERDICT: land after fixes