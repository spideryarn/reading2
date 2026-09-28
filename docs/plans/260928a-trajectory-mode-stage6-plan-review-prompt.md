# Plan review — Trajectory stage 6 (plan 260928a)

Read-only: do not change any file. Candidate: commit `bba877c3` on branch
`worktree-trajectory-flash-position-0928`. The plan text is the section **"Stage 6 — the route sees
what the other modes know"** and **"Stage 6, widened — Quotes spread, section stops"** in
`docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md`, plus the "5g is not built"
paragraph. The baseline numbers are `docs/plans/260928a-trajectory-mode-stage6-coverage-baseline.md`,
made by `scripts/trajectory-coverage.ts`. Greg's words are quoted in the sections.

Start with: `src/trajectory.ts` (prompt, parse, validation, stamp, `PROMPT_VERSION`),
`src/pipeline.ts` (the trajectory step, `stepIsDone`, `FORCE_ONLY_WHEN_NAMED`), `src/step-order.ts`
and `tests/article-cache-group.test.ts`, `src/quotes.ts` (or wherever the Quotes prompt lives),
`src/types.ts` (`Trajectory`, `TrajectoryStop`, Ideas), `src/web/useTrajectory.ts`,
`src/web/trajectory-route.ts`, `src/web/modes/trajectory/TrajectoryMode.tsx`, `src/web/stop-card.ts`,
`docs/project/prompting-guide.md`, `docs/project/quotes.md`, `docs/project/vision.md`.

Attack:

1. Anything false about the code in the plan.
2. Waiting for Ideas in the route's job (`precededBy: ["quotes","ideas"]`, moving `trajectory` after
   the `ideas … sketch` cache group): is the move safe (cache groups, `StepBefore`, any test or code
   that assumes `trajectory` directly follows `quotes`)? Latency and cost of the wait; what the band
   says meanwhile. Is "wait" right versus "route on what exists and mark for rebuild"?
3. The input additions (Ideas with block ids; outline with section gists; not the Glossary): the
   prompt size on a long paper; freshness hashing (Ideas regenerated ⇒ outdated; a route planned
   without Ideas ⇒ outdated once they exist); interaction with Trajectory's existing profile rule.
4. 6a (Quotes prompt nudge): consequences of bumping Quotes' PROMPT_VERSION for every article and
   every mode that reads Quotes (Trajectory's own freshness via its quotes hash, public/visitor
   views, the Quotes banner). Is there a gentler way to measure it first?
5. 6b (section stops): the stored shape `{ kind: "section", … }` beside quote stops — every reader
   of `TrajectoryStop` (validation, `visibleRoute`, `stepStop`, `doorAfter`, the panel, the card,
   the flash, `?stop=` in the URL, last-view, export), old routes, and the tests. Is a discriminated
   union the right shape? Which block is the section stop's passage? Is this a second set of
   highlights (the thing Greg asked us to avoid)?
6. 6c (a gist line on a section stop only): does it break vision.md's augment-not-replace?
7. The measurement: is "Idea with a stop in or next to its passage" a sound coverage metric, and is
   three articles enough to "keep only what earns its place"? What would you add?
8. Anything simpler that gets most of it (e.g. 6a alone, or Ideas input alone).

Severity: P0 data loss / security / incorrect charging / broadly unusable; P1 user-visible wrong
behaviour or contract violated; P2 design risk; P3 prose. IDs from **F60** (stage-5 code review uses
the F37 range). Evidence as file:line, and a concrete fix each. Verdict: approve / approve with
changes / rethink.
