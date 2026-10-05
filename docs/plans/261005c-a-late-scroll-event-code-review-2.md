Two findings, both fixed. Nothing committed.

- **D1 — P1, fixed:** [useColumnContext.ts](/home/greg/code/spideryarn2/.claude/worktrees/qi-d7pxe8z7-structure-click-at-rewrite/src/web/useColumnContext.ts:79) read the anchor without observing its changes. An already centred jump creates an anchor without scrolling, leaving the previous section marked indefinitely. Clearing the hold without scrolling also leaves stale state. Added notifications for both transitions, using the existing frame scheduler. Both tests failed at the intended assertions before the fix.
- **D2 — P3, fixed:** [url-state.md](/home/greg/code/spideryarn2/.claude/worktrees/qi-d7pxe8z7-structure-click-at-rewrite/docs/project/url-state.md:575) grouped Structure’s 40% line into a sentence saying everyone measures under the bars. Clarified the distinction.

The section answer itself fits Structure and breadcrumbs. Deep paragraphs and passages still belong to their containing section; folded anchors are rejected. Covering the prose changes visibility, not section ownership. Diagram and on-screen link highlighting use separate samplers.

The original test **detects removal of the branch**, failing with `0` instead of `5`. Its injected scroll event masks D1. Disabling the new subscription leaves that original test green while both new tests fail.

Validation: requested suite **3 files, 51 tests passed** after fixes and mutation restoration. Typecheck passed through `node --import tsx scripts/typecheck.ts`; the npm wrapper hit sandbox IPC denial. Scoped lint and whitespace checks passed. The round-1 prose corrections need no further changes.

VERDICT: approve with changes