The plan is not safe to build as written. Both original diagnoses are substantially real, but both proposed fixes still have dangerous holes. The `MERGE_HEAD` rule must not ship; the current on-disk revision has already moved to `merge-tree`, but its per-path form can still silently discard an entire incoming merge.

The plan and test changed while I was reviewing, so the line references below use the current files. I reviewed both the original `MERGE_HEAD` proposal from the prompt and the newer `merge-tree` revision now on disk.

## Blocking findings

1. The merge fix still misses a stale index equal to `HEAD`.

The proposed logic begins from `git diff --cached ... HEAD`, as the existing code does at [check-staged-revert.ts:99](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/check-staged-revert.ts:99). If a stale pre-merge index overwrites the merge result with `HEAD`, that diff is empty. `staleSnapshot()` also explicitly treats an index equal to `HEAD` as clean at [check-staged-revert.ts:175](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/check-staged-revert.ts:175).

I reproduced this:

- Start a clean non-fast-forward merge with `--no-commit`.
- Replace the index with the pre-merge `HEAD` tree.
- `git diff --cached HEAD` reports zero paths.
- `git commit` succeeds with two parents.
- The merge tree is byte-identical to its first parent.
- The incoming commit is now an ancestor, but its added file is absent.

That is a silent dropped merge. The current plan’s per-path `merge-tree` rule at [plan:328](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/docs/plans/260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md:328) never examines any path in this case.

Compare whole trees instead:

```text
expected = git merge-tree --write-tree HEAD MERGE_HEAD
actual   = git write-tree
```

Only declare a clean merge safe when the two tree OIDs are equal. An unequal tree is `unknown`, nonzero—not necessarily a “revert.”

2. The original `MERGE_HEAD:<path>` exemption is definitely unsafe.

I constructed both dangerous forms:

- `HEAD` changed `important.ts`; the incoming branch forked earlier and never touched it. A stale old blob equals `MERGE_HEAD:important.ts`, but the correct merge result keeps `HEAD`’s new blob.
- `HEAD` added `security.ts`; the incoming branch predates it. A stale staged deletion matches “absent from `MERGE_HEAD`,” although the correct merge preserves the file.

A merge-base qualification does not fully repair this: two branches can independently arrive at a historical blob while the correct merge result is different. The newer `merge-tree` idea is the right primitive, but it must validate the whole index tree.

3. `check:staged-revert` already fails open on `unknown`.

The comment says “could not tell” must be distinct at [check-staged-revert.ts:68](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/check-staged-revert.ts:68), and `findings()` creates `unknown` after exhausting 40 commits at [check-staged-revert.ts:152](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/check-staged-revert.ts:152). But if only unknowns exist, [check-staged-revert.ts:222](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/check-staged-revert.ts:222) prints a leading `✓` and exits zero.

Fix that in this work. Use a final discriminated result:

```ts
type Judgement =
  | { kind: "safe"; ... }
  | { kind: "unsafe"; ... }
  | { kind: "unknown"; ... };
```

An exhaustive switch should make both `unsafe` and `unknown` nonzero. This is exactly where “let the types catch it” applies.

## The four diagnoses

| Claim | Verdict |
|---|---|
| `git status` stamps the worktree admin directory; optional-lock-free status does not | Correct outcome, slightly wrong mechanism. Merely creating/removing `index.lock` changes the directory mtime; the index file need not be rewritten. With 1.1-second gaps I saw the admin mtime advance even when the index mtime did not. `--no-optional-locks` left both unchanged. The plan’s “index fresh, no stamp” measurement at [plan:105](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/docs/plans/260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md:105) used whole-second values and is uncalibrated. |
| Reflog `%ct` duplicates commit time | Correct. `%ct` describes the selected commit, not the reflog entry. On creation, both values remain the old commit date. The phrase “neither moves on fast-forward” is literally inaccurate: both normally change to the destination commit’s date; neither records when the fast-forward happened. `%gd` with `--date=unix` does. |
| Existing fast-forward assertion is vacuous and never backdates | Correct. The old `Math.max(headTime, …) >= headTime` could not fail, and the old fixture committed at real time. |
| Incoming merge content is reported as a revert and reset advice damages it | Correct. Deletions are unconditional findings at [check-staged-revert.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/check-staged-revert.ts:108), and modified content is searched only through `HEAD` history at [check-staged-revert.ts:123](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/check-staged-revert.ts:123). `git reset -- path` replaces the incoming staged blob with `HEAD` while leaving the working file changed. The advice at [check-staged-revert.ts:231](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/check-staged-revert.ts:231) is harmful during a merge. |

## Sweep safety

The current revision’s missing-reflog behavior is safely fail-closed: `core.logAllRefUpdates=false` and aggressive `git reflog expire` both produced empty HEAD/branch reflogs, which become `null` and therefore keep the tree at [worktree-sweep.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/worktree-sweep.ts:170). Default expiry—normally 90 days for reachable entries and 30 for unreachable ones—is longer than the 24-hour floor. `advice.*` does not affect reflog creation.

Other cases:

- A branch created elsewhere is okay under ordinary configuration: attaching the worktree creates a current per-worktree HEAD reflog even when the branch reflog is old.
- A linked worktree from a bare common repository also received a HEAD reflog in my check; “bare” alone is not the failing case.
- Saved tracked/untracked edits are protected by `dirty` at [worktree-check.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/worktree-check.ts:154). Ignored pipeline output is protected separately through `unexplained` at [worktree-check.ts:175](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/worktree-check.ts:175), not by `dirty`.
- Pure reading, unsaved editor buffers, or a clean live session older than 24 hours produce no observable activity. That residual limitation should be stated.

I would not make HEAD reflog the sole signal as proposed at [plan:178](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/docs/plans/260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md:178):

- `git update-ref` elsewhere can move the checked-out branch without moving that worktree’s HEAD reflog. A tree-identical commit leaves status clean; only the branch reflog records it.
- `GIT_COMMITTER_DATE` can backdate a nonempty reflog entry. I created a new worktree whose HEAD and branch `%gd` both claimed January, while the admin-directory mtime correctly recorded now.

Ship the conservative maximum of:

- mandatory valid per-worktree HEAD reflog; missing/malformed means unknown and keep,
- corrected branch-reflog entry time when attached,
- admin-directory mtime.

Drop commit date. Once [worktree-check.ts:386](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/worktree-check.ts:386) supplies `GIT_OPTIONAL_LOCKS=0`, admin-mtime false positives come from other Git activity and only delay removal. Dropping that independent signal is the dangerous direction.

Also remember that a lock is not a backstop: removal explicitly unlocks the tree before removing it at [worktree-sweep.ts:363](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/scripts/worktree-sweep.ts:363).

## Which merge rule I would ship

I would ship:

1. Outside a merge, preserve the existing detection, but make `unknown` nonzero.
2. During a single-parent, conflict-free merge, compare the whole index tree with `git merge-tree --write-tree HEAD MERGE_HEAD`.
3. Exact equality is safe.
4. Any mismatch, merge-tree failure, conflict, octopus merge, or strategy ambiguity is `unknown`, exits nonzero, and never recommends reset.

`merge-tree` costs one modern-Git operation and writes objects. It may differ from a merge originally performed with special strategy options or custom drivers, but that disagreement fails closed. It cannot validate human conflict resolution; no parent/blob comparison can infer human intent.

An unconditional “cannot judge during merge” is simpler but blocks every `--no-commit` merge. Whole-tree equality safely handles the common clean case with less code than the proposed per-path explanations.

The plan’s conflicted-merge story is currently inconsistent: [plan:374](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/docs/plans/260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md:374) says merge-tree failure exits 1, so the “resolved to theirs still reads as a revert” corner at [plan:378](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/docs/plans/260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md:378) is unreachable for a genuinely conflicted merge.

## Calibration tests

The two-classification test at [worktree-sweep.test.ts:221](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/tests/worktree-sweep.test.ts:221) genuinely detects today’s feedback loop, and its non-null check prevents literal `null === null` vacuity. But it can still pass if:

- `lastActivityAt()` is reordered before the mutating check, creating a one-call lag, or
- admin mtime is dropped, so status mutates the tree without affecting the returned HEAD-only activity.

Add a direct test: deliberately stale a tracked file’s cached stat without changing its contents, record the index/admin mtimes, call `gather()`, and assert the facts remain clean and both mtimes remain unchanged. Remove `GIT_OPTIONAL_LOCKS=0` once and require that exact assertion to fail.

The newly added backdated test at [worktree-sweep.test.ts:185](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/tests/worktree-sweep.test.ts:185) is better, but:

- it tests worktree creation, not a fast-forward;
- it commits only in `primary`, so the worktree is ahead of `origin/dev` and `keep` can be true for the wrong reason;
- it does not assert the plan’s claimed “only reason is the floor”;
- it should assert the commit really is older than 24 hours and bracket the creation time tightly.

Push the aged commit to the scratch origin before classification. Separately perform a real fast-forward between two backdated commits and assert activity advances to the operation’s independently captured time. Add detached creation and missing/expired-HEAD cases.

For staged-revert, do not thread `cwd` through production code or export internals merely for tests. Spawn the real CLI with `{cwd: scratchRepo}`; this repo already uses that pattern. Test exit status and output:

- ordinary non-merge revert: nonzero, path named;
- clean merge with index tree exactly equal to `merge-tree`: zero;
- stale merge index equal to `HEAD`: nonzero `unknown`;
- partial stale index: nonzero;
- conflict/manual resolution: nonzero `unknown`, no reset advice;
- 40-commit history exhaustion: nonzero `unknown`.

The current cherry-pick expansion should be cut or corrected: on Git 2.43, a clean `git cherry-pick --no-commit` left no `CHERRY_PICK_HEAD`, even while staging a historical blob that the existing guard would call a revert. The proposed marker check at [plan:368](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/docs/plans/260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md:368) does not cover its stated case.

## What to cut and add

Cut:

- Per-path merge-tree “explained path” logic; whole-tree equality is smaller and safer.
- The test-only `cwd` threading/export refactor.
- Cherry-pick/rebase/revert expansion from this patch unless each operation gets a calibrated real-Git test.
- The blanket rule “never advance the clock.” Advancing `now` is correct for pure `classifyOne` tests; ageing the fixture is necessary for acquisition tests.

Add:

- Tri-state, exhaustively handled `safe | unsafe | unknown`.
- Missing/backdated reflog tests and the direct no-index-write test.
- Whole-index merge calibration, especially the `index === HEAD` case.
- A documented manual-merge escape/runbook, because an unknown human resolution still has to be committed somehow.
- The cheap class-level prevention already ranked first in the postmortem: a guard may not land until its author records the exact red message produced by its calibration mutation at [postmortem:127](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/docs/postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md:127). The project workflow says to implement the postmortem’s prevention in the same run at [engineering-manager.md:147](/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp/docs/reusable/engineering-manager.md:147); the plan currently discusses this but does not enact it.

Both fixes are worth making. The optional-lock fix is sound. The activity fix needs independent conservative signals retained, and the staged-revert fix needs whole-tree merge validation plus fail-closed unknowns.

For completeness, the live inventory moved during review: I measured 15G and 20G free, 19 registered worktrees total, 17 under `.claude/worktrees`, and 12 of those 17 heads ancestral to the currently recorded `origin/dev`. That does not disprove the earlier snapshot, but the plan’s “sixteen” at line 20 and “eighteen” at line 249 need one timestamped, consistent denominator.

I could run all direct Git 2.43 reproductions. The Vitest file itself could not run in this sandbox: all real-Git tests stopped at their first nested `spawnSync("git")` with `EPERM`, so I am not treating that attempted suite run as evidence.