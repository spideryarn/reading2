The framing is right, but two parts of this implementation should not land as written. Keep the selective `logs/` treatment; revert the `.env` subset inference and remove `dev-server` from the allowlist.

## Findings

1. **High — `onlyStaleLines` can print SAFE over a worktree-only edit.**  
   [scripts/worktree-check.ts:384](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/scripts/worktree-check.ts:384)

   Concrete states:

   - Primary: `A=1\nB=2\n`; worktree: `A=1\n`. If the agent deliberately removed `B`, the worktree’s lines are still a subset, so the deletion is called “stale” and can lead to SAFE.
   - Worktree: `A=1\nA=2\n`; primary: `A=2\nA=1\n`. The sets are identical, but this repo’s parser is last-wins, so the effective values are `2` and `1` respectively ([src/env.ts:393](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/src/env.ts:393)).
   - A worktree-only comment is deliberately discarded by the new test at [tests/worktree-check.test.ts:391](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/tests/worktree-check.test.ts:391), although a comment can itself be somebody’s note or explanation.

   The implication “every line of A occurs in B ⇒ deleting A loses nothing” ignores absence, order and multiplicity. Multi-line shell values create similar composition problems. `export` spelling differences remain conservative; ordinary CRLF and outer-whitespace normalization match the current parser, but they do not repair the fundamental inference.

   **Recommendation:** revert the entire `onlyStaleLines` narrowing. A safe version needs historical evidence, such as recording the creation-time hash: unchanged from baseline plus changed primary proves staleness; comparing two current snapshots cannot. This is especially clear because the measurements say the narrowing cleared zero current trees.

   **Confidence:** certain.

2. **High — `dev-server` is declared disposable without evidence, and allowlisted directories are never inspected.**  
   [scripts/worktree-check.ts:267](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/scripts/worktree-check.ts:267), [scripts/worktree-check.ts:436](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/scripts/worktree-check.ts:436)

   Put the only copy of `notes.md` at `logs/dev-server/notes.md`; `logStrays()` skips the whole directory and can permit SAFE. An unreadable `logs/dev-server/` or `logs/tmux-jobs/` is also accepted without attempting to read it, despite the fail-closed contract.

   The plan itself says `dev-server` has no repository writer and is “unknown, so it blocks” at [the plan:66](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/docs/plans/260908b-stop-worktree-check-crying-wolf-on-logs.md:66), then the implementation section reverses that without justification. The claim that this “loosens nothing” at line 142 is therefore false.

   **Recommendation:** remove `dev-server` from `TRANSIENT_LOG_SUBTREES`. `tmux-jobs` is defensible as an explicit scratch-output ownership policy because it has a fixed writer, but I would still inspect it and accept only its expected flat, regular `.log` files; nested directories, symlinks, other extensions and EACCES should block. Note that `tmux-job.ts` accepts arbitrary commands, so even its output is not mechanically guaranteed to be reproducible.

   **Confidence:** certain.

3. **Medium — the prescribed resolution command exposes secrets on stdout.**  
   [scripts/worktree-check.ts:789](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/scripts/worktree-check.ts:789), [docs/project/worktrees.md:340](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/docs/project/worktrees.md:340)

   The check and return value do not themselves include secret contents. However, when an environment file differs, they tell the operator to run raw `diff primary/.env.local .env.local`, and the docs explicitly say to run it. That writes both old and new secret values to stdout, where they may enter a terminal transcript, conversation, or activity log.

   **Recommendation:** replace this with a helper that reports key names and value hashes only. Do not prescribe raw `diff` for secret-bearing files.

   **Confidence:** high.

4. **Medium — the `.gitignore` coupling test does not prevent the class it claims to prevent.**  
   [tests/worktree-check.test.ts:302](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/tests/worktree-check.test.ts:302)

   It does fail for the demonstrated literal `/new-cache-dir/`, but:

   - `/new-cache-*/` is skipped because it contains a glob; a resulting `new-cache-a/` remains unexplained forever.
   - A literal `/.env.local/` passes because the test accepts either spelling: bare `.env.local` has a verdict, while the runtime spelling `.env.local/` is unexplained.
   - Nested `.gitignore` files are intentionally not examined.

   Thus the narrower test description is partly accurate, but the plan and docs overstate it as “adding a line to `.gitignore` means classifying it” ([worktrees.md:329](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/docs/project/worktrees.md:329)).

   **Recommendation:** require the slash spelling for rules ending in `/`, handle common directory globs, and narrow the documentation claim unless nested ignore files are covered.

   **Confidence:** certain.

5. **Low — a concurrent writer can add protected log work after the directory snapshot.**  
   [scripts/worktree-check.ts:429](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/scripts/worktree-check.ts:429), after ignored status was collected at [scripts/worktree-check.ts:845](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/scripts/worktree-check.ts:845)

   If `logs/tmux-jobs/` exists when `readdirSync(logs)` returns, and a peer then creates `logs/loops/report.md`, that new entry is absent from `entries`; `logStrays()` returns empty and the check may say SAFE. No exception reaches `worktree-sweep`’s unjudgeable handling.

   This is partly an inherent snapshot/removal race and predates this change for newly created ignored paths, but selective inspection creates another window inside an already-seen `logs/`. A stable `logs` symlink, quoted path, case mismatch, loose symlink, or unreadable root `logs/` fails safely; the race is the problematic case.

   **Confidence:** high on the mechanism, low expected frequency.

## Other checks

- I found no inflated ignored-path count. Each `unexplained` element still represents one reported top-level path; folding the hint into the same string was correct.
- The numeric before/after table is appropriately labeled uncontrolled. The main documentation overstatements are “loosens nothing,” the `.gitignore` coverage claim, and [worktrees.md:299](/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms/docs/project/worktrees.md:299), which still says `.env.local` is compared byte-for-byte despite the new exception.
- I attempted the targeted suite: 42 tests passed, while 16 repository-construction tests could not start because this review sandbox rejected their `spawnSync git` calls with `EPERM`. That is an environment limitation, not evidence of a code failure.

## Verdict

“Recognise more, fail closed on the rest” is the right response to this class of credibility-eroding false alarm. The original blanket refusal was operationally harmful, and walking `logs/` is the right shape.

But recognition must rest on an actual ownership invariant. `tmux-jobs` has the beginnings of one; `dev-server` does not. The `.env` subset rule is not recognition at all—it guesses history from two current snapshots and can produce the silent false-safe the guard exists to prevent.

I would not revert the whole change. I would block it until the `.env` narrowing is reverted, `dev-server` is removed from the allowlist, and the secret-printing `diff` advice is replaced.