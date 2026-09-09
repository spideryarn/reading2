# Review the code built from your plan review

You reviewed the plan for this work and returned nine findings; the plan was revised and the code is
now written. **Weight this review higher than the plan one** — a plan-stage review cannot find a
function that writes one field and then rejects the request.

## What to read

Start with the scoped diff:

```
git diff origin/dev...HEAD
```

(three dots — two is a live comparison against a trunk other agents keep moving, and renders their
commits as deletions this branch makes)

The files:

- `scripts/worktree-inuse.ts` — new. The two liveness signals and the ownership proof.
- `scripts/worktree-remove.ts` — new. `npm run worktree:remove`, the whole removal path.
- `scripts/worktree-sweep.ts` — its `removeOne` now forwards to the above; new `young` verdict; ghost
  classification moved to `classifyRegistration`.
- `.claude/hooks/protect-shared-tree.sh` + `.test.sh` — the branch-deletion ban.
- `tests/worktree-inuse.test.ts`, `tests/worktree-remove.test.ts` — new.
- `docs/project/worktrees.md` — § Removing one, § Sweeping them up, § ExitWorktree.
- `docs/plans/260908k-*.md` — the revised plan; its § "What the review changed" maps your findings.

## How your nine findings were answered

1. **present+prunable force-deleted** — `classifyRegistration` now calls a ghost an ABSENT path only.
   **But I checked your loss claim and it does not hold**: `git worktree remove --force --force`
   REFUSES this case (`fatal: validation failed, cannot remove working tree: '<path>/.git' does not
   exist`) because a moved-away tree has no `.git` at the registered path. Measured on a scratch repo;
   the file with `precious.txt` survived. So this was a misclassification ending in a confusing
   failure, not data loss. **Tell me if you can construct a present+prunable state where the double
   force DOES delete files** — if you can, I have understated it and the docs are wrong.
2. **stale proof + `branch -D`** — `reachableOids` + `landedProof` + `deleteRefIfUnmoved`, retaken
   after removal, `update-ref -d <ref> <old-oid>`.
3. **"no live process" ≠ finished** — the 24h floor is KEPT for third-party removal. Only the proved
   owner waives it.
4. **the in-tree form refused its own case** — `ownerStanding` returns `asking` when the lock's exact
   `(pid,start)` is in the caller's ancestry.
5. **`cannot-tell` failed open** — `composeInUse` is three-valued; uid-filtered; same-uid unreadable
   cwd is `unknown`.
6. **reflog blind spot** — every reflog oid is in the proof; the worktree's own HEAD reflog is read
   BEFORE the directory goes.
7. **partial-failure states** — unlock stops on failure, removal restores the lock, orphan-branch mode.
8. **matcher false positives** — per-command segmentation; `tag` and remote deletion cut.
9. **`REMOVABLE` vocabulary** — new `young` verdict.

## What I most want attacked now

- **`worktree-inuse.ts` correctness against real `/proc`.** `parseStat` counts fields from the last
  `") "`. Is that right for every case, including a comm containing `") "` itself? Is field 20 after
  that offset really `starttime`, and field 2 really `ppid`?
- **The ownership proof as implemented.** Can a session that does NOT own a tree get `asking`? Can the
  owner fail to get it in a legitimate case (e.g. after `ExitWorktree({action:"keep"})`, or when the
  removal runs under `npm run`, which inserts shells)?
- **`reachableOids` / `landedProof`.** Does `git rev-list --ignore-missing --count <oids> --not <sha>`
  answer the question I think it does? What happens when a reflog names a GC'd object, when the branch
  reflog is disabled (`core.logAllRefUpdates=false`), or when `reflog show` returns empty — does the
  proof become vacuously true or correctly `cannot-tell`? **This is the guard standing between a
  `git branch -d` ban and real work being deleted; treat it as the most important thing here.**
- **Order of operations and TOCTOU** in `removeWorktree`, especially between the `blockers()` call and
  `git worktree remove`, and between removal and the branch delete.
- **The lock restore path.** If `git worktree remove` fails after the unlock, is the lock actually
  restored identically? What if the reason contains characters that need escaping?
- **The hook regex** `(^|[^[:alnum:]_-])(--delete|-[[:alpha:]]{0,3}[dD][[:alpha:]]{0,3})([^[:alnum:]_-]|$)`
  and the segmentation `sed 's/&&/;/g' | tr ';|&' '\n\n\n'`. False refusals that would bite daily?
  Bypasses that matter? Does the segmentation break on quoted strings containing `;` or `|`?
- **The tests.** Do any of them pass for the wrong reason? I mutation-tested eight guards and each
  went red, but tell me which guard has NO test that could fail.

## What I want back

Findings ranked by severity, each with the concrete failure sequence, whether work is LOST or merely
disrupted, and the smallest fix. Say plainly if something is wrong rather than proposing an addition.
If a piece is over-built, say which to cut. And check my conclusion on finding 1 above — I may have
talked myself out of your most severe finding, and I would rather be told.
