Review complete. I found four in-scope issues and fixed them:

- Removed remaining report-level “needs a decision” copy and stale documentation.
- Made both pill and shortcut render the single `waitingQuestionCount`.
- Added regression coverage after replies, deferrals, retained drafts, and initial loading.
- Confirmed report rows use “Waiting,” never “Needs a decision.”

Full record: [code-review-findings.md](/var/tmp/spideryarn-worktrees/fbh2d3my-needs-a-decision-counts/docs/plans/261011ad-needs-a-decision-code-review-findings.md)

Verification:

- Feedback dialog tests: 296 passed.
- Typecheck: equivalent direct invocation passed all projects; `npm run typecheck` itself was blocked by the sandbox’s IPC socket restriction.
- Scoped lint: no new errors.
- `git diff --check`: passed.
- No commit or push performed.

LAND WITH FIXES (made)