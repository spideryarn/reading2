Code review of plan docs/plans/261007q-generated-files-regenerate-on-commit.md, as built. You may fix
what you find, inside these files; report anything wider for me to decide.

The change (uncommitted in this worktree; `git status`, `git diff HEAD`):
- .claude/hooks/regenerate-commit-generated.sh — the new PreToolUse hook (new)
- .claude/hooks/regenerate-commit-generated.test.sh — its self-test (new)
- .claude/hooks/commit_command.py — the parser moved out of compress-commit-pngs.sh (new)
- .claude/hooks/compress-commit-pngs.sh, .claude/hooks/compress-commit-pngs.test.sh — now import the parser
- .claude/settings.json — registration
- docs/project/help-page.md, docs/project/feedback-reports.md — which way each file stays fresh
- the plan, and your plan review: docs/plans/261007q-generated-files-regenerate-on-commit-plan-review-sol.md

Evidence: `bash .claude/hooks/regenerate-commit-generated.test.sh` → ALL PASS (34 ok);
`bash .claude/hooks/compress-commit-pngs.test.sh` → ALL PASS (74 ok, unchanged count from before the move).
A mutant hook that never runs its generator fails 12 checks. A live `claude -p --permission-mode default`
run in a throwaway repo with the hook registered and no Bash permission ran `git commit -F msg -- page.md`
and the commit carried the regenerated corpus too, so Claude Code applies updatedInput+allow.

Look hardest at:
1. The approval: can any command the hook returns `allow` for do something other than a plain path-limited
   commit of literal files? (Hooks run in parallel; deny > ask > allow.)
2. The guard and recheck: can the regenerated output not match what the commit carries? Can a peer's
   unfinished source ride in?
3. Does the parser move change the PNG hook's behaviour in any way?
4. Silent success: a path where it says "regenerated" or "added" and the commit does not carry it.
5. Never blocks / always exit 0 / quiet / bounded time (30 s registration; internal 25 s deadline).
Do not run git commands that change this worktree's index or HEAD. Be concrete; rank by severity.
