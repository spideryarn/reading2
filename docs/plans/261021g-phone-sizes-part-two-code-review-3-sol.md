## Findings

- D1 — P1 — C7’s ten live utilities used `pointer-coarse`, leaving targets small on touchscreen hybrids. Changed all seven components to `any-pointer-coarse:[40px]`, matching the accepted C3 policy. [BackLink.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/BackLink.tsx:69), [FeedbackButton.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/FeedbackButton.tsx:424), [Library.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/Library.tsx:633), [PlanHelp.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/PlanHelp.tsx:57), [ReceptionAndClaimsPanel.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/ReceptionAndClaimsPanel.tsx:2491), [SimplePanel.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/SimplePanel.tsx:350), [Tweets.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/Tweets.tsx:534)

- D2 — P2 — The TSX guard missed valid nested variants containing `>`/`.`/`/`, falsely matched `not-pointer-coarse`, and did not pin the existence of the converted targets. Replaced it with token-based detection, added mutation cases including the requested `[&_x]` form, pinned every C7 call site, and independently pinned Metadata’s second Archive button. [touch-targets-261021g.test.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/tests/touch-targets-261021g.test.tsx:124)

- D3 — P3 — C7 counted eleven classes, but there were ten live utilities; the eleventh textual hit was a comment. Corrected the plan. [261021g plan](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/docs/plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md:241)

C1–C6 otherwise match the intended fixes. The dock remains exclusively under `pointer: coarse`; its test reads that exact media query and proves ≥40px at 12, 15.36, 16, and 20px roots. Metadata’s second Archive was already correctly floored.

Verification: requested suite passed, 5 files/81 tests; typecheck passed all 3,907 files; scoped lint had only pre-existing advisory findings; `git diff --check` passed. Full `npm test` could not run because local Postgres was unavailable. Fixes remain uncommitted in the working tree.

VERDICT: ship with fixes applied