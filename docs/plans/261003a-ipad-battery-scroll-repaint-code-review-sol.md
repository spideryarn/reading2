No P0 or P1 found. The wrapper preserves the old percentage geometry, paint order, and pointer behavior; the source-wide CSS sweep found no conflicting selectors.

References below are to candidate `fa8d8f534`.

- **R1 — P2:** `docs/investigations/261003a-what-a-scroll-frame-costs-in-the-reading-view.md:38,81` and `scripts/trace-scroll.ts:65` overstate repeatability and desktop gains. Desktop paints varied **159/103 before, 123/86 after**, with different delivered scroll-event counts. **Fixed:** qualified the desktop comparison and removed the unisolated DPR explanation.
- **R2 — P3:** `docs/plans/261003a-ipad-battery-scroll-repaint.md:22,58` retains claims rejected by its plan review: whole-root repaint, CSS hiding removing React work, and no new containing block. **Fixed:** reconciled the plan with the implementation and evidence; corrected the matching test comment.
- **R3 — P3:** Investigation `:100` says deferred work is already queued, but no entries exist. **Fixed the status wording.** Actual queue entries remain for the stage owner.
- **R4 — P3:** Investigation `:43` claims every listener is passive; raw printouts `:20` show a non-passive `pointerdown`. **Fixed:** limited the claim to recorded scroll listeners.
- **R5 — P3:** Investigation `:94` presents an earlier WebKit launch failure as a current limitation. **Fixed:** states that this investigation contains no WebKit/Safari measurement.

Added four tests for placement after window resize, body resize, font swap, and mode switching without another scroll. Mutation checks failed on the intended scaling, stale-placement, and listener-cleanup assertions.

Validation: **146 spine tests passed**, all typecheck projects passed using `node --import tsx`, and scoped lint reported only advisory findings. No Postgres suites ran.

Stage 2’s deferral is justified: its remaining ~13% cost requires link-remount reconciliation. Browser validation remains unverified because the Sonnet dispatch failed with sandbox DNS error `EAI_AGAIN`.

**Verdict: approve stage 1 with these fixes; browser transition/print validation and queue bookkeeping remain before the plan is complete.**