No fixes were needed.

- P0 — none.
- P1 — none.
- P2 — none.

The plan’s voice conclusion is correct. `asked.quote` originates from the reader’s DOM selection of article prose ([selection.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9a-marginalia-typeface-by-voice/src/web/selection.ts:99)), passes unchanged through the thread summary ([useChatAnchors.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9a-marginalia-typeface-by-voice/src/web/useChatAnchors.ts:141)), and the server rejects it unless it occurs in the named article block ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9a-marginalia-typeface-by-voice/src/routes.ts:4210)). The new author face is therefore right both shut and opened ([MarginaliaColumn.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb9a-marginalia-typeface-by-voice/src/web/marginalia/MarginaliaColumn.tsx:352)). The remaining Marginalia and tooltip strings match their author/AI/reader/UI provenance.

The opened-label rule works ([marginalia.css](/home/greg/code/spideryarn2/.claude/worktrees/fb9a-marginalia-typeface-by-voice/src/web/styles/marginalia.css:128)): it overrides the closed rule, the reset button remains a 100%-wide block, and no relevant ancestor clips overflow. It reaches FAQ, Debate, Citation, comment and question labels through the shared `ShutNote`. The three-line AI-answer clamp is deliberate preview behaviour, not this bug.

Checks: focused suites 73/73 passed; typecheck passed across 2,772 source files; touched-file lint and `git diff --check` passed. Full `npm test` could not start because this sandbox cannot access local Docker/Postgres.

Verdict: approve — both conclusions are correct, with no P0/P1/P2 findings.