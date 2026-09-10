# Code review: Stage 1 of a job-launch bookkeeping module (second attempt)

Repo: this worktree (`.claude/worktrees/launch-protocol`), branch `worktree-launch-protocol`.
TypeScript + ESM, `tsx`, vitest. This is ordinary reliability engineering for an internal job
scheduler: a daemon keeps a journal of the jobs it starts, so that after its own restart it can tell
whether a job already started and avoid starting it twice.

Your first attempt at this review stopped part-way (the run ended early), after recording two
findings. They are already accepted and being fixed, so do not spend time on them:

- **F14** — both stores read the journal with `split("\n").filter((line) => line !== "")`, which
  silently drops a blank interior line, so a damaged journal opens as whole.
- **F15** — a history reset records occurrences found only as artefact directories in
  `artefactDirs` rather than `carried`, so `plan()` will plan them again.

## The candidate

Committed: commit 25bd82bf (one commit). `git show --stat 25bd82bf`.
Files: tools/overseer/launch-protocol.ts, launch-store.ts, launch-admission.ts, launch-artefacts.ts,
and tests/overseer-launch-{protocol,store,admission,artefacts}.test.ts.

Another implementer is building the next stage in this worktree while you read, so working files
may differ from the commit. Review the committed bytes (`git show 25bd82bf:<path>`).

## What it is meant to do

The plan is `docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`;
its "Review dispositions — Sol, plan round 1" section (your earlier plan review) overrides D1–D11,
and the Stage 1 status paragraph lists the implementer's departures. The property to check: **after
the daemon restarts at any point, it never starts a job a second time when the first start may
have happened, never holds two slot reservations for one job, and never frees a slot without
evidence (a valid `exit.json`, a different boot id, or proof nothing started) or an operator's
recorded decision.** And a journal that cannot be replayed whole and in a legal order refuses to
plan new jobs.

## What you can run

The tree is read-only for you. /tmp and node_modules caches are writable. Please run the focused
tests yourself: `npx vitest run tests/overseer-launch-protocol.test.ts` and the other three. No
network. My run: `docs/plans/260910f-launch-protocol-stage1-results.txt` (128 tests, exit 0;
typecheck exit 0).

**Write each finding to `/tmp/260910f-launch-protocol-stage1-review-sol-b-findings.md` as soon as
you have it**, then give the whole review as your final answer.

## What to check

1. Walk the restart cases in the plan's D4 table and confirm the code handles each one as written,
   including the review dispositions F1, F2, F4, F5, F7, F8, F9 and F11.
2. Check the tests: does each one actually exercise the case it names? A test that would pass even
   if the code did nothing (for example, "at most one start" passing when there were zero) is a
   finding.
3. Check the replay and the fold: can any sequence of journal lines be accepted that the plan says
   must make the history lost?
4. Check how reconciliation reads evidence files: does it ever trust a path from the journal in a
   way that could read the wrong job's files?

For each finding: an ID (continue from F16), a severity, and whether it is established (you ran it
or can point at the exact lines) or reasoned; (a) the test or input that shows it; (b) the smallest
fix.

| | |
|---|---|
| **P0** | data loss, security, incorrect charging, or the service broadly unusable |
| **P1** | wrong behaviour a user could see, or a stated contract broken |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | comment or prose defect |

## My own questions — read last

1. The slot owner's `lookup`/`release` have a third answer, `unavailable`. Is every caller of it
   cautious — nowhere treated as "none" so that it frees a slot or reserves a second one?
2. `drive()` continues from a `reserved` record by reserving again; reconciliation turns a
   `reserved` into `failed-before-launch` and frees it. Can both act on one record so that a slot is
   freed while the job holding it is being started?

Do not change any file in the repo.
