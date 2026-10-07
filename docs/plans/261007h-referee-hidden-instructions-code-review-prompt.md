You are reviewing built code in the repo you are sitting in, and you may fix what you find.

The plan, with your own plan review folded in (§ Review of this plan):
docs/plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md
Your plan review: docs/plans/261007h-referee-hidden-instructions-plan-review-sol.md

The change is the commit(s) on this branch since `origin/dev`: run
`git diff origin/dev...HEAD` (and `git log origin/dev..HEAD`) to see it. Files:
- src/web/SourceScanNotice.tsx — `sourceScanMark`, `grouped`, `KIND_MEANS`, `placeInWords`, the row
- src/web/modes/referee/RefereeMode.tsx — Notices no longer holds the scan or opens itself; the fifth chip and its mark; the `hidden` panel
- src/web/referee-views.ts, src/web/sub-modes.ts, src/web/activation.ts (REFEREE_TARGET total), src/web/params.ts
- src/web/styles/referee.css, src/web/help/help-modes.tsx
- tests/referee-notices.test.tsx, tests/source-scan-notice.test.tsx, tests/referee-band-fits.test.ts, tests/referee-mode.test.ts, tests/referee-tooltips.test.tsx
- docs/project/referee-mode.md, docs/project/security.md, docs/project/url-state.md

The boundary: this run may not edit a defence. src/injection-scan.ts and the shape of its answer
(src/injection-scan-types.ts) must be untouched. The five rules for the notice in
docs/project/referee-mode.md § rule 5 must still hold: a PDF never says nothing found; the caveat
travels with a clean result; an ordinary-labelled finding is sorted last and still drawn; a
visible-instruction prints its caveat; the panel is shut unless something was found.

Look for:
1. Any way a hostile document can now hide a finding, or its words, from a referee who opens Hidden
   text, or silence the mark on the chip (labels are forgeable; `where` and class names are
   attacker-written; `text` is capped).
2. Correctness bugs in grouping, the mark, the live region (it must be one node that exists before
   the scan arrives), the `hidden` view's wiring (URL param, command bar, activation, anything else
   that enumerates Referee's views), and the CSS (dark mode tokens, phone width).
3. Stale comments or docs that still describe the scan as inside Notices or the mode as having four
   sub-modes, where they describe the present rather than history.
4. Tests that could not fail, or rules with no test.

Fix what you find inside this change's scope (run `npx vitest run <the test files above>` and
`npm run typecheck` after). Anything wider, or anything that would edit src/injection-scan.ts,
report but do not do. Finish with a numbered list: each finding, severity, evidence (file:line),
and whether you fixed it.
