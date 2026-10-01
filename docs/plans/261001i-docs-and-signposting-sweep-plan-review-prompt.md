# Plan review: docs and signposting sweep

You are reviewing a **plan**, read-only. Do not change any file.

The plan is the untracked file `docs/plans/261001i-docs-and-signposting-sweep.md` in this worktree
(read it from the working tree, not git). Its probe brief and tasks are
`docs/plans/261001i-probes/brief.md` and `docs/plans/261001i-probes/tasks.md`; some `before-P*.md`
probe results are already there and you may read them as evidence.

Context you need:

- The request (Greg, verbatim) is quoted at the top of the plan.
- `docs/reusable/documentation-policy.md` is the policy being applied and updated.
- `AGENTS.md` is the signpost every agent loads; `docs/reusable/edit-important-docs.md` says which
  docs need Greg's approval for wording changes (AGENTS.md, the seven entry points, docs/reusable/)
  and which are free (signposts).
- `tests/doc-links.test.ts` is the existing mechanical enforcement.

What to judge:

1. Is the probe method sound as a before/after measure? In particular: the probes run on a tree
   where the adjacent feature already exists; probes are Sonnet subagents that inherit AGENTS.md; the
   answer keys are written by Opus from the landed plans. What would make the after-round
   improvement meaningless or inflated (e.g. probes reading my new docs that name the answers,
   teaching to the test), and how should scoring guard against it?
2. Is the stage order right? Anything that should be cut, merged or added?
3. The proposed new check (a backticked repo path in an evergreen doc that does not exist): is it
   cheap and sure, or will it be noisy? Any other check that is equally cheap and sure?
4. Is a "shared building blocks" doc the right shape, and who should own it, given one-home-per-fact
   and the risk that such a list goes stale? Would header comments in the canonical modules plus a
   short list be better?
5. Anything that would conflict with the approval rules or with other agents editing docs
   concurrently.

Severity scale: P0 (plan is wrong, will waste the job), P1 (will produce a misleading or wrong
result), P2 (worth changing), P3 (nit). Give each finding an ID (R1, R2, …), the severity, the
evidence (file and section), and a concrete change to the plan. Lead with the highest severity.
Keep it under 120 lines.
