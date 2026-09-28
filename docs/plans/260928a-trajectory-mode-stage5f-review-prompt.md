# Code review — Trajectory 5f, out of Experimental (plan 260928a)

Reviewer and fixer, narrowly. Candidate: the **uncommitted** changes in the worktree on branch
`worktree-trajectory-flash-position-0928` (base: HEAD). Changed paths, and there are no untracked
files: `src/mode-catalog.ts`, `tests/dock-experimental-modes.test.tsx`,
`docs/project/experimental-features.md`, `docs/project/trajectory.md`. See `git diff HEAD`.

Spec: the plan's 5f and F34 (in `docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md`)
and `docs/project/new-mode.md` § Moving a mode in or out of the switch. Greg asked: "take Trajectory
and Quotes modes out of Experimental features, i.e. into mainstream features." Quotes was already out.

The Overseer's condition for pushing this: the rule on who may trigger a paid run (non-owners —
shared-link and public-shelf visitors) must be built **and tested** in the same push. Check:

1. Is every place that gated Trajectory by the switch now consistent (Dock, command bar, any other
   reader of `experimental`, docs that still say it is behind the switch — grep)?
2. Is there a test, today, that fails if a visitor (shared or public) can cause a paid Trajectory
   run — client (`tests/public-network-trace.test.tsx` has a `trajectory` row; does it prove "no
   POST" for that mode?) and server (the job route refuses to enqueue for an article the caller
   does not own — find the test)? If either is missing, write it, red-first where you can (a test
   that would fail if `POLICY.trajectory` became `available`, say).
3. `tests/dock-experimental-modes.test.tsx`: confirm the change to `BEHIND_THE_SWITCH` alone flips
   the expected tests (run it).

Run `npx vitest run tests/dock-experimental-modes.test.tsx tests/public-network-trace.test.tsx tests/visitor-gaps.test.ts tests/command-bar.test.tsx tests/doc-links.test.ts`.
You have no network, so nothing needing Postgres: if the server-side test needs Postgres, write it
and say so, and I will run it.

Severity P0–P3 as usual (P0 incorrect charging / security). IDs from **F41**. Fix inside 5f; report
anything wider. Do not commit. Verdict: accept / accept after fixes / reject.
