# F4a, F7 and P1-fix round-2 review

Reviewed `1b1fe60d0` and `c433e121b` independently against plan 261007h; Part B is limited to the listed round-1 P1 fixes. Findings recorded before fixes. No established P0 or P1.

## Findings before fixes

- **M1 — P2, F7: order-chip caller retention is claimed but not checked.** `controls.md`'s table and `ControlsAcrossModes` say the named family test holds listed callers to the shared piece. `failure-colour-and-order-chips.test.ts` checks class declarations only: removing `OrderGroup` or `.gloss-sort-btn` from an order row leaves it green. Add a narrow caller census with negative controls for the five shared rows and Search's intentionally separate row (R19). Other table entries also need wording that distinguishes shared-piece checks from caller checks; the loading tests exercise the component/geometry, not a complete caller census.
- **M2 — P3, F7: the run-button specimen claims an unconditional 32px.** Citations' Dig deeper intentionally uses `Button` outline / xs (24px), documented in the existing run-button test. State the default and this exception in `/design`.
- **R2-1 — P2, F1 E1: accepted formatted children lose their reserved footprint.** `BandWaiting.children` accepts `ReactNode`, but `wordsOf` drops React elements/fragments. `<BandWaiting><em>Looking for the questions…</em></BandWaiting>` reserves an empty sentence before 600ms and a full sentence afterwards. Current production callers pass strings/string arrays, so this is a reuse risk, not an established current-user P1. Preserve arbitrary child markup in the hidden, aria-hidden footprint; keep the CSS-content path for plain sentences.

## Part A checks

F4a failure-state classes in Diagram/Illustrated are separated from waits/known empties. Failure/refusal/over-limit sites use danger; the latter indicate an operation that cannot be completed, rather than a normal empty answer. Destructive fills and status chips retain their fill token. Search's working line retains its own quiet colour. No wait/empty newly painted as danger was established.

Danger clears 4.5:1 in both themes on the additional solid grounds actually found here: card, popover and muted, as well as page/panel/raised (token-resolved measurement, not browser sampling): dark 6.010 / 5.213 / 5.444, light 6.109 / 6.109 / 5.201. Hover-card failures are on panel; admin feedback cards on card; voucher row errors on the table's normal ground. Tinted refusal cards in Metadata/admin vouchers retain foreground ink, not danger. The guard is a text scanner, not evidence about every arbitrary future ground.

The six order rows retain wrapping/layout ownership: Glossary, Quotes, FAQ, Citations and Debate use the shared group; Search uses display:contents. Both chip classes use a 28px minimum at rest and a 40px coarse-pointer floor; chosen orders have full ink, raised fill, an edge and weight 600, distinguishing them from unchosen/hovered chips. No clipping or finger-floor override found by source inspection; browser measurement unavailable.

The danger Tailwind bridge resolves and remains a permitted text token in css-tokens' guard. The six eager-client-graph additions are genuinely reached by both the reader and lazy design route; the graph test checks the intersection and stale allowances independently.

## Part B checks

- **E1 / K1:** for current string callers the ghost has the same two flow children and caller display/gap as the visible branch. Both ghosts are aria-hidden and visibility:hidden; the live region receives no early words. Only the spinner has flex:none; the ghost sentence can shrink. Formatted-child risk is R2-1.
- **E2–E4:** Search's first answer and Referee's Claims/Criteria initial pending lines use delayMs=0; Illustrated's known empty is immediate and spinnerless, while the readiness wait remains delayed. Plate wait keys match slug/hash/ext byte-fetch identity.
- **C1/C2:** the signed-out document shell's direct-child nav selector matches; safe-top pads the nav, subtracts from its floor and is included in anchors/sticky offsets. Reveal uses the observer's default zero root margin, removing the width-relative negative percentage.
- **D1:** skip-to-modes sets the persistent arrival flag before focus; the final CSS rule finishes the dock/install-hint entrance and restores visibility.
- **H1/H2:** coarse chip-row gap/padding specificity wins over later caller rules; Quotes' row padding and internal spacing contain the expanded targets at 12px and 16px roots.
- **K2:** Skim changes the reveal trigger from null to the chosen depth when its bar appears, so the hook attaches and reveals even when the selected depth did not change. The focused real-panel regression passes.

## Validation so far

Requested ten-file command: **10 files, 282 tests passed**. Round-2 focused component/contract tests: **9 files, 302 tests passed**. `band-waiting-layout.test.tsx` could not reach its assertions: system Chrome launch fails with crashpad `setsockopt: EPERM` and SIGTRAP under this sandbox. Source reasoning above is the fallback requested in the brief.

This was the pre-fix checkpoint. Completion and final verification follow below. No commits made.

## Fixes and final verification

All three findings above are resolved:

- **M1:** the order-family test now checks the five actual `OrderGroup` rows plus Search's separate named group, chip classes and pressed-state attributes. Six negative controls failed before the guard existed (**6 failed, 44 passed**); the completed focused suite passes **50/50**, rejecting component/group or chip-class removal. The docs, entry-point signpost and `/design` comment now distinguish tests of shared pieces from tests of listed callers.
- **M2:** `/design` states the 32px default and the intentional 24px Citations exception.
- **R2-1:** primitive sentences retain CSS-generated ghost words; formatted children retain their original markup in the same invisible, aria-hidden span. The new fragment/emphasis/line-break regression failed before the fix (**1 failed, 8 passed**) and passes afterwards. It also checks that the markup fallback has no duplicate data-words and that the ghost rule retains visibility:hidden. A formatted multiline fixture extends the browser geometry check. The existing postmortem records the cause and corrects its stale claim that E1 remains unresolved.

Final requested command: **10 files, 295 tests passed**. Component and four relevant caller suites: **142 passed**; latest strengthened BandWaiting test: **9 passed**. Additional round-2 checks including the signed-out document-shell notch contract: **324 passed** across ten files.

Typechecking: `npm run typecheck` could not start because the tsx CLI's IPC pipe is forbidden (`listen EPERM`). Running the same checker with `node --import tsx scripts/typecheck.ts` **passed all four projects and covered all 3410 source files**. `git diff --check` passes. Scoped Biome reports the existing, unchanged `/design` specimen's `noDangerouslySetInnerHtml` finding at line 1231; no new lint findings remain.

Full `npm test` was attempted and blocked before tests by the private database setup: local Postgres connection `EPERM` on 127.0.0.1:54362 and Docker inspection unavailable. System Chrome also remains blocked at startup; browser geometry was not freshly measured. These are verification limits, not established defects in the scoped changes. No remaining P0/P1; no commits made.

Files changed by this review (the pre-existing prompt file was not edited):

- `docs/plans/261007h-f4a-f7-and-round-2-code-review-sol.md`
- `docs/postmortems/261007k-a-shared-wait-still-belongs-to-one-request.md`
- `docs/project/controls.md`
- `docs/project/design-css-overview.md`
- `src/web/BandWaiting.tsx`
- `src/web/DesignPage.tsx`
- `src/web/styles/mode-band.css` (comment only)
- `tests/band-waiting-layout.test.tsx`
- `tests/band-waiting.test.tsx`
- `tests/failure-colour-and-order-chips.test.ts`

VERDICT: ready with these fixes
