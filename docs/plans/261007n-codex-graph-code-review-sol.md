1. **P1 — FIXED:** A valid window plus an unknown window of the same duration incorrectly continued the line. Test: duplicate-duration continuity.
2. **P2 — FIXED:** `notObserved` missed readings containing only withheld or unknown windows. Test: no-drawable-window counting.
3. **P2 — FIXED:** Duration colours changed across charts and history ranges. Test: consistent duration colours.
4. **P2 — FIXED:** Account labels and dash patterns differed between chart groups. Test: cross-group account identity.
5. **P2 — FIXED:** Percentage labels overlapped the plot; singleton markers stretched on phones. Tests: label gutter, fixed round markers, and matching rejection-strip alignment.

All new regression tests failed before their fixes. **51 targeted tests pass.** Typecheck passes through the same checker’s Node entrypoint; `npm run typecheck` was blocked by sandbox IPC restrictions. Claude’s series behavior matched HEAD across 1,000 generated sequences.

The 390px visual check remains unverified: Chrome crashed in the sandbox. No commits made.