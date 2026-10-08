Review this plan, read-only: docs/plans/261007q-generated-files-regenerate-on-commit.md

Context: repo spideryarn (this worktree). The pattern it follows is .claude/hooks/compress-commit-pngs.sh
(and its test .claude/hooks/compress-commit-pngs.test.sh, plan docs/plans/261007m-compress-docs-screenshots-on-commit.md).
Generators: tests/help-corpus.test.ts (WRITE_HELP_CORPUS=1), scripts/feedback-endings.ts. Production reader of
the feedback map from git: scripts/feedback-shipped-emails.ts (GENERATED_REPO_PATH). Server readers:
src/help-chat-call.ts, src/feedback-ending.ts, src/feedback-question.ts. Build: package.json "build", vercel.json.
Commit recipe the agents use: `git add -- <new files> && git commit -F <msg> -- <all files>` (see CLAUDE.md).

Claude Code docs on PreToolUse hookSpecificOutput.updatedInput: "Replaces the entire input object ... Claude Code
evaluates permission rules ... against the input your hook returns ... Combine with "allow" to auto-approve, or
"ask" to show the modified input to the user. For "defer", ignored." Precedence across hooks: deny > defer > ask > allow.
"Deny and ask rules are still evaluated regardless of what the hook returns." All matching hooks run in parallel.

Questions:
1. Is the rejection of option 1 (generate in build) right for each file? Anything I missed that makes it simpler?
2. Is updatedInput+allow acceptable, or is there a way to get the generated file into a `git commit -- paths`
   commit without rewriting the command or auto-approving? (e.g. git's own hooks — consider --only temp-index
   behaviour and the "staged revert" hazard in docs/project/version-control.md)
3. The "every changed source in the set must be in this commit" guard: right condition? holes?
4. Sharing the parser via a python module: worth it, or leave the PNG hook untouched?
5. Anything else that would make it silently do nothing, or do harm (e.g. in the shared primary with peers).
Be concrete and brief. Findings ranked by severity.
