You are reviewing a small change in the repo at /var/tmp/spideryarn-worktrees/docs-split-and-push-hint (uncommitted; see `git status` and `git diff HEAD`).

The change: a new Claude Code PreToolUse hook on Bash, `.claude/hooks/push-doc-hint.sh`, registered in `.claude/settings.json` beside the existing `protect-shared-tree.sh`. On a `git push`, it lists docs under `docs/project/` that name (by basename) a file changed in the non-merge commits of `origin/dev..HEAD`, skipping docs the push itself changed. It emits the list as JSON `hookSpecificOutput.additionalContext` on stdout and logs a line to `push-doc-hint.log` in the git common dir. Tests: `bash .claude/hooks/push-doc-hint.test.sh`. Also a signpost line in `docs/reusable/documentation-policy.md` § Keeping it true and a note in `docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md` § 6.

Hard requirements from Greg (the owner):
- It must NEVER block a push or any Bash call: always exit 0, never emit a permissionDecision, never trigger a permission prompt.
- If anything errors, it stays quiet.
- Fast: effectively one grep over docs/project.
- A self-test like protect-shared-tree.sh's, plus tests.

Please check, and FIX inside these files what you find (you have write access; keep edits minimal and in the style of the surrounding code):
1. Any path where it can exit non-zero, hang (e.g. waiting on stdin, a slow git command, a huge repo), or print something that is not valid hook JSON to stdout.
2. Whether the push detection misses realistic forms (`git push`, `git -C dir push`, `cd x && git push origin HEAD:dev`, multi-line commands) or fires on non-pushes.
3. Correctness of the doc-matching (whole-basename match, touched-doc skip, cap at 10) and the log write.
4. Whether the tests would actually go red if the hint stopped appearing, and whether they exercise the failure modes.
5. Whether the additionalContext JSON shape is right for Claude Code PreToolUse hooks (it should allow normal permission flow untouched).
Run the test script after any change. Report: what you found, what you changed, anything wider you did not change. Do not commit.
