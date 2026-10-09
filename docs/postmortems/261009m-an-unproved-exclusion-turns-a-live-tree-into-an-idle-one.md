# An unproved exclusion turns a live tree into an idle one

Code review of **4635db483** found new ways for the worktree-removal guard to call a
live tree idle, and for bulk removal to target its caller. The failures were
reproduced in fixtures and temporary repositories; no real worktree was removed
by this review. These were implementation choices, not instructions from Greg.

## The class: evidence omitted from a scan is mistaken for evidence of absence

The new macOS containment walk treated every failed `stat` as a disappeared
directory and eventually returned `outside`. An unreadable alias can lead into
the target: its unreadability proves nothing. The raw/decoded pathname combination
also let one spelling's `outside` erase the other's `unknown`. Separately, the
decoder encoded UTF-16 halves individually, corrupting literal emoji beside an
escaped newline. All were introduced by 4635db483's new macOS section.

The same commit widened the Linux process-group exemption to every descendant,
including a detached child in its own group. The previous rule counted that child.
The new `ps -p` exception accepted exit 1 with partial output, and success without
rows or with unrequested rows, treating omitted processes as gone.

The filter-name allowlist still hid an independent same-group `tail -f` in an
unlocked tree. That preserved an old Linux hole while introducing it to the new
Mac bulk path. It was reproduced both with the pure classifier and a real
reparented tail process in a temporary worktree.

Bulk removal correctly re-ran single-target checks, but caller protection remained
only in the classification. A branch can move between trees. A fixture classified
the other tree, detached it, checked its branch out in the caller, and observed
`removed` rather than `refused`. The removal itself needed to re-earn this guard.

## Why the existing tests stayed green

The fake containment filesystem gave every pathname an identity; failed identity
reads never occurred. The descendant control used only esbuild in the same group.
The recheck runner paired exit 1 only with empty output. The caller-tree test kept
branches fixed. The hook test claimed to exercise a live peer but waited for its
fake Claude to exit and then asserted only the stored lock text.

## The fix and its limits

Permission, I/O and unclassified identity failures now return `unknown`. ENOENT
for an unescaped physical lsof path still walks surviving ancestors, preserving
the plan's unrelated deleted-cwd behavior. Unresolved escaped names remain
unknown, and `inside` wins over ambiguity. Decoding copies whole code points.
Descendants are exempt only while sharing the asking process's group. Recheck
status and output must agree, and returned pids must have been requested.
Bulk classification and fresh removal disable the filter-name exemption; the
caller tree is already kept, so its genuine output filters need no exemption.

The bulk remover compares caller and target filesystem identities before its
fresh checks. Named self-removal is unchanged. The hook fixture stays alive and
asserts an actual liveness veto; additional Mac tests exercise failed `ps` and
failed start-time conversion under `/bin/bash` 3.2.

These remain ordered observations, not a lease. An alias retargeted or removed
between observations is not resolved by this patch. The pipeline-name allowlist
for removal by name remains an implementation heuristic, not proof of pipeline membership.

## Countermeasures, ranked by ease against value

1. **Negative fixtures at exclusion boundaries** — added and observed red before
   the fixes: unreadable alias, mixed escapes, emoji, detached descendants,
   inconsistent recheck output, moved candidate branch, and exited hook owner.
2. **Positive controls alongside refusal tests** — retain esbuild, ordinary
   deleted outside cwd, successful removals and named self-removal, so refusing
   everything cannot earn a passing suite. The deleted-cwd control caught an
   overbroad first revision during review.
3. **A shared creation/removal lease** — a stronger long-term answer to concurrent
   entry and alias changes, rejected for this commit: it changes the cooperative
   protocol and exceeds a narrow reviewer fix.

Up: [Postmortems](../project/postmortems.md). Context: [261009t plan](../plans/261009t-worktree-removal-on-macos-and-an-automatic-sweep.md).
