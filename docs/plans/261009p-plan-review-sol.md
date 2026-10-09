APPROVE WITH CHANGES

1. The staged rule currently widens the hook too far. As written, every detected commit selects every staged-and-unchanged PNG—even a pathspec commit such as `git commit -- other.ts`. That rewrites and re-stages another agent’s staged screenshot, contradicting the shared-tree rationale at [plan line 85](/var/tmp/spideryarn-worktrees/bug-uncompressed-shots-recur/docs/plans/261009p-the-commit-hook-reads-only-one-commit-command-in-seven.md:85). Preserve the existing regression case where a path commit leaves an unrelated staged PNG alone at [compress-commit-pngs.test.sh:159](/var/tmp/spideryarn-worktrees/bug-uncompressed-shots-recur/.claude/hooks/compress-commit-pngs.test.sh:159). If rule 1 is intended only for bare commits, the plan must explain how it identifies them after abandoning the parser.

2. “A parent directory appears as a whole word” is underspecified and potentially very over-broad. With ordinary word-boundary semantics, mentioning `docs/plans/foo.md` also mentions the parent `docs/plans`, selecting every changed screenshot below that shared directory. Matching `docs/` would be broader still. Match a directory only when it is a complete shell-like token, or when immediately followed by an explicit glob component—not merely when it is a prefix of another pathname. Add a negative test: committing `docs/plans/foo.md` must not compress a sibling `docs/plans/peer-shots/a.png`.

3. The remaining command-text limitations should be stated honestly. It will still miss:

   - `P=docs/plans/x.png; git commit -- "$P"` and arrays/command substitutions.
   - `git commit -a`, which can include an unstaged tracked PNG without naming it.
   - `--pathspec-from-file`.
   - Shell-escaped or pieced-together names such as `docs/with\\ space/x.png` or `docs/plans/"x".png`.
   - Commits reached through `git -C`, `pushd`, a later `cd`, `GIT_WORK_TREE`, or a Git alias.

   It can wrongly touch files named in commit messages, unrelated commands, comments/heredocs, negative pathspecs, `--dry-run`, or a command whose commit later fails. Some false positives are acceptable, but the plan should bound them rather than calling the rule unfoolable.

4. A safer, simpler interim rule is: retain the existing parser whenever it succeeds; when it fails, fall back to exact candidate-file matches plus directories that appear as complete argument-like tokens or explicit glob bases. Do not infer selection from every textual parent. This covers the reported trailing-command, variable-in-message, heredoc, and shots-glob cases while preserving more of the previous non-interference contract. No command-text heuristic can simultaneously understand every shell expansion and identify the exact future commit; only a Git hook can do that.

5. The re-staging contract is sound if implemented uniformly. Before compression, record an index receipt for every selected file whose index blob equals the worktree’s pre-compression bytes—regardless of whether it was selected as “staged” or “named.” Then receipt-check and update it once. Add explicit tests for:

   - Staged and named, index equals worktree: compressed bytes are re-staged.
   - Staged and named, worktree differs from index: worktree may be compressed, but the index remains untouched.
   - Concurrent worktree and index changes remain protected.

   Do not retain the current branch-local `restage = {}` behavior from [compress-commit-pngs.sh](/var/tmp/spideryarn-worktrees/bug-uncompressed-shots-recur/.claude/hooks/compress-commit-pngs.sh:111).

6. Leaving Git-hook installation to Greg is correct. A direct common-directory hook at `.git/hooks/pre-commit` technically avoids `core.hooksPath` and would cover every linked worktree, but it is untracked, silently absent from fresh clones, changes every agent’s commits immediately, and conflicts with the tracked `.githooks` design in [260902b](/var/tmp/spideryarn-worktrees/bug-uncompressed-shots-recur/docs/plans/260902b-protect-main-from-an-accidental-push.md:172). There is no automatic repository-level Git hook that avoids either installation or configuration. It is therefore not clearly within this repair’s remit.

7. Candidate discovery needs an explicit safeguard. Do not use `git status`, `git diff`, or `git ls-files -m` as the sole “modified against HEAD” test; assume-unchanged/skip-worktree can hide changes—the previous review already found that class. Enumerate filesystem candidates without following symlinks and compare their raw blob hashes with `HEAD`, treating absence from `HEAD` as new.

8. The plan’s state is inaccurate: it says “fixed,” but the hook is unchanged; only red tests have been added. It also links to a postmortem file that does not yet exist. Add the required status line, use future tense until implementation lands, and either create the postmortem before linking it or mark it explicitly pending. The known identical defect in `regenerate-commit-generated.sh` also needs a concrete tracked follow-up; merely reporting an 86% miss rate leaves a known harmful default in place.