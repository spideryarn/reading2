# Code review — Trajectory stage 6 (plan 260928a)

Reviewer and fixer. Candidate: commit `00f9b51d` on branch `worktree-trajectory-flash-position-0928`
(`git show --stat 00f9b51d` for the paths). Start with `src/trajectory.ts` (`trajectoryInput`,
`trajectoryInputHash`, `renderPrompt`, the system prompt), `src/pipeline.ts` (the trajectory
step's stamp), `src/store/pg.ts` (`loadTrajectory` and the current-check), `src/step-order.ts`,
`src/web/useTrajectory.ts`, `src/web/modes/trajectory/TrajectoryMode.tsx`,
`src/web/TrajectoryPanel.tsx`, and the tests — do not limit yourself to them.

Spec: `docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md` § "Stage 6 as it will
be built" (items 1 and 2), with the Sol ledger F60–F69 above it. Read
`docs/project/prompting-guide.md` for the prompt. Items 3–5 (measurement, the Quotes nudge, section
stops) are out of scope.

**Fix inside this stage**, narrowly, red-first. **Report** anything wider. Do not commit. You can run
`npx vitest run tests/trajectory.test.ts tests/trajectory-panel.test.tsx tests/modes-that-start-themselves.test.tsx tests/article-cache-group.test.ts`
and `node --import tsx scripts/typecheck.ts`. No network: `tests/trajectory-freshness-pg.test.ts`
needs Postgres — reason about it, or write more of it and say so; I will run it.

Attack:

1. The associations: exact vs beside; the neighbour walk (skipping headings and supplements, not
   crossing a top-level section, not past the article's ends); multiple occurrences; a quote whose
   block is gone; an idea with no occurrences.
2. The hash: does it cover exactly what is rendered, no more (anything volatile — timestamps,
   order that isn't semantic — would make every route stale) and no less? Do the write path, the
   stored `sourceHash` and the read path compute it from the same inputs in every case (no Ideas,
   stale Ideas, a provisional tree with no gists)? Old routes (`trajectory/6`) — outdated, never a
   crash?
3. Stale vs outdated: the implementer reports an Ideas change as **stale** (one hash). What does
   "stale" drive elsewhere (card clusters hidden? the door? `notOnRoute`? export? the public
   projection)? Is any of that wrong for "the Ideas changed"?
4. The request rules: `precededBy` names quotes only when missing/stale and ideas only when
   none/error/stale — never when merely outdated (re-running a merely-outdated step would replace a
   reader's artefact on a route press; see the F38 revert in the plan). Does the server's
   `stepIsDone` agree with the client about "stale" for Ideas? What happens when the Ideas read
   is still loading at press time?
5. The prompt: plain-words rule, fenced untrusted data, bounded size on a long paper, nothing that
   invites a finding into the cue.
6. The STEP_ORDER move: anything else that assumed `trajectory` right after `quotes`.

Severity P0–P3 as before. IDs from **F70**. Each: severity, evidence (file:line), fixed (with the
red→green test) or reported. Verdict: accept / accept after fixes / reject.
