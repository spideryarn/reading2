---
id: q-b80y0k
report: none
status: answered
asked: 2026-10-21
title: A finished commit is stranded in a stuck session's tree. May I put it on dev?
refs: qi-mzfxw3q2 · commit 42a8d876 · /var/tmp/spideryarn-worktrees/qi-mzfxw3q2-stage-a · session qi-mzfxw3q2-sources-contract · decisions file item 85
acted: spya-xs7sn6
---
One session (qi-mzfxw3q2, the first step of the Sources contract) made a commit and then got stuck at a permission prompt before pushing it. The commit exists only in that session's working copy on the box. It makes the first-draft save name only the columns it writes, which is the groundwork the later Sources change needs.

A. Yes: I merge that commit onto dev, run the tests, and close the stuck session and its working copy. The Sources work then carries on from dev as normal.
B. No: leave it where it is until you look at that session yourself. The Sources contract work stays stopped.

Recommendation: A. The work is finished and reviewed; only the push is missing.

Details

The session stopped at a prompt asking to move where its permissions are rooted, which I will not answer on your behalf. Nothing else depends on the session itself, only on its commit.

## Greg's answer, 2026-10-21 (in the Feedback dialog, reply `spya-xs7sn6`)

> A Yes, if you're confident, definitely go ahead. And make a note, a minimal note in the relevant doc that going forwards you should use your judgment. If it's clear-cut and straightforward and there's a definite right answer, just do it. Don't ask me.

Done. Commit 42a8d876 is merged onto dev (a clean merge; typecheck and the full suite green; GPT Sol reviewed it against current dev and found no defect), and the stuck session and its tree are closed once nothing unique was left there. The contract migration itself (qi-mzfxw3q2, stage 2) is untouched and still gated on Greg; Sol's notes for it are in the plan's log. The note is in docs/project/overseer.md § 2, beside the rule on bugs and no-trade-off improvements. (qi-x3qp42gv, 2026-10-21.)
