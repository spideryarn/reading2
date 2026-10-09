LAND WITH FIXES

1. Fixed false hints from `git commit` text inside quotes, comments, and heredocs. Added conservative executable-command detection without changing `commit_command.parse` or approval behavior.

2. Fixed wrong-repository hints for `git -C`, non-leading `cd`, `pushd`, Git directory variables, and quoted `cd …/..` forms.

3. Fixed source comparison for symlinks, equal-hash file/symlink type changes, symlink directories, newline filenames, deletions, and unborn `HEAD`. Added red-first regressions.

4. Verification: both required hook suites end `ALL PASS`; direct-loader typecheck passes all 3,611 files; decline-path benchmark was 0.69–0.83 seconds over 471 feedback files. `npm test` remains blocked by unavailable local Postgres, and repo-wide lint retains its unrelated 92-error baseline.