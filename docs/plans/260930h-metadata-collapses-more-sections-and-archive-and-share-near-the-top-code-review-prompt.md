You are reviewing the CODE for plan
docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md
(read it first, including its "Plan review" section: your own earlier plan review is at
docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top-plan-review-sol.md).

The change is uncommitted in this worktree: run `git diff HEAD` to see it. Files: src/web/Metadata.tsx,
tests/metadata-page-order.test.tsx, tests/metadata-delete-permanently.test.tsx,
tests/metadata-export-button.test.tsx, docs/project/library.md, and the plan.

Evidence already gathered:
- `npm run typecheck` exit 0.
- `npx vitest run tests/metadata-*.test.tsx tests/public-metadata-artefacts.test.tsx`: 194 passed.
- Mutations seen red: removing `failed ?` from useArchive reds the refresh-failure case; dropping
  `collapsible` from Export reds the shut-sections test; focusing the first button instead of the
  h2 reds the Share… test.
- Full suite: 4 failures in 5 files, all build-artefact tests that are red in any fresh worktree
  (cold-start-lazy-imports, pdf-bundle-trace, fleet-composed-access, fleet-decisions-route,
  fleet-reports-route). None of them touches Metadata.
- A real-browser pass (Playwright, local dev) confirmed: the top Archive flips both buttons and does
  not navigate, Put back restores, Share… scrolls and focuses the Access & sharing heading without
  opening the confirmation, and there is no overflow at 390px. Screenshots are at
  docs/plans/260930h-shot-top-*.png.

Constraints that must hold: Share… must never bypass AccessSharing's confirmation and rights
tick-box. Archive must stay reversible, must not navigate, and must offer no button when the state
is unknown. Do not edit anything listed in docs/project/security-map.md § Where the defences
physically live.

Review for correctness bugs, accessibility (focus, live regions, `hidden`), React reconciliation
(the top Archive button keeping its DOM node), and test gaps that would let a broken build pass.
**Fix what you find**, inside these files only, and keep to the surrounding comment style. Then run
`npx vitest run tests/metadata-*.test.tsx` and `npm run typecheck`, and report: each finding
(P0/P1/P2, file:line), what you changed for it, the two commands' results, and a one-line verdict.
Anything wider than these files: report it, don't change it.
