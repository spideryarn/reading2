# Plan review — Trajectory stage 3, the scrapbook (plan 260928a)

This is a read-only review. Do not change any file.

## The candidate

Commit `d1a76748`. The section under review is **"Stage 3 in detail — the scrapbook"** in
`docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md`. The three spike
screenshots it links sit beside it. Greg's requirement is in `docs/project/trajectory.md` §
Version two, which quotes him. v1, as built, is `src/trajectory.ts`, `src/web/TrajectoryPanel.tsx`,
`src/web/useTrajectory.ts` and `src/web/trajectory-route.ts`, and you reviewed it in the two code
reviews listed in the plan's Progress.

## What to attack

- Is "thread line per stop per depth, replacing the role, written by the same call" the right way
  to do Greg's "short generated snippets that tie together the disparate elements"? Look for
  failure modes: the shape `thread: {"1"?, "2"?, "3"?}`, validation, and whether a line can refer
  to a previous stop the reader never saw at that depth.
- Does the stop card risk the anti-goal in docs/project/vision.md — a summary replacing the
  reading?
- **Data plumbing.**
  - Can the client find the glossary terms, ideas, FAQ passages and timeline events for one block
    **without** triggering any generation, using the hooks and reads that already exist? Look at
    `src/web/useGlossary.ts`, `useIdeas.ts`, `useFaq.ts`, `useTimeline.ts`, `useAutoRun.ts`, and
    the glossary's prose matcher.
  - Is "use the prose matcher, not the stored block list" feasible, and what is it called?
- Compatibility with existing routes: `role` is kept readable, and `PROMPT_VERSION` is bumped.
- Anything simpler that gets most of the value.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

IDs continue from **F18**. For each finding give the evidence (file:line) and a concrete
recommendation. End with a verdict: approve / approve with changes / rethink.
