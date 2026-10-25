## Findings

- High — [src/matter.ts:1243](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter.ts:1243): an article actually titled “Highlights” was treated as a summary label, folding its opening prose after the masthead removed the label. Added an explicit title rejection and regression test.

- High — [src/matter.ts:1183](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter.ts:1183): 13 short body paragraphs totalling over 300 words evaded `ownProseBefore`; prose beginning “Abstract reasoning…” was also incorrectly excused as an abstract. Short prose now counts, while only syntactic Abstract labels are excused.

- High — [src/matter.ts:1265](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter.ts:1265): a short introductory line before a Highlights list disabled the list-item cut, folding the unheaded article following the bullets. Unstructured lists now end at their last item even after introductory text.

- High — [src/matter-labels.ts:128](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter-labels.ts:128): “Research highlights” and “Significance statement” were absent from the duplicate contents-preview regex. A body box rejected as `summary` could therefore have its linked bullets folded as `contents`. The rule now uses the complete `isSummaryLabel` predicate.

- Medium — [src/matter.ts:1298](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter.ts:1298): repeated summary labels caused recursive rescanning of earlier labels, potentially exponential on an untrusted maximum-size opening. The label pass now shares memoized results and precomputed windows/section ranges. A 3,000-block regression case covers this.

- Low — [src/matter-labels.ts:7](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter-labels.ts:7), [src/matter.ts:18](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter.ts:18), [src/web/matter-view.ts:3](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/web/matter-view.ts:3): corrected stale comments describing four label sources, the model’s kinds, and the client’s supported matter kinds.

No unresolved persistence, request-shape, public-reader, client-index, or Structure-label findings.

Verification: the requested five test files pass, 161/161. The complete typecheck script passes all five projects and covers all 4,008 source files. `npm test` could not run the database lanes because the local Postgres/Docker service is unavailable. Scoped lint had advisory complexity notices only.

## Files edited

- [src/matter.ts](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter.ts)
- [src/matter-labels.ts](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/matter-labels.ts)
- [src/web/matter-view.ts](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/src/web/matter-view.ts)
- [tests/matter-summary.test.ts](/var/tmp/spideryarn-worktrees/fbhnw9xq-fold-front-summaries/tests/matter-summary.test.ts)