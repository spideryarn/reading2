---
id: q-b80y0k
report: none
status: open
asked: 2026-10-21
title: A finished commit is stranded in a stuck session's tree. May I put it on dev?
refs: qi-mzfxw3q2 · commit 42a8d876 · /var/tmp/spideryarn-worktrees/qi-mzfxw3q2-stage-a · session qi-mzfxw3q2-sources-contract · decisions file item 85
---
One session (qi-mzfxw3q2, the first step of the Sources contract) made a commit and then got stuck at a permission prompt before pushing it. The commit exists only in that session's working copy on the box. It makes the first-draft save name only the columns it writes, which is the groundwork the later Sources change needs.

A. Yes: I merge that commit onto dev, run the tests, and close the stuck session and its working copy. The Sources work then carries on from dev as normal.
B. No: leave it where it is until you look at that session yourself. The Sources contract work stays stopped.

Recommendation: A. The work is finished and reviewed; only the push is missing.

Details

The session stopped at a prompt asking to move where its permissions are rooted, which I will not answer on your behalf. Nothing else depends on the session itself, only on its commit.
