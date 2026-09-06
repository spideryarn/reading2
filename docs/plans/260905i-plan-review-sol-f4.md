### F4 — P1

The false-deferral path remains open.

1. **The trigger is contradictory.** Stage 1b mandates seeding when 1a is under threshold ([lines 210–220](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:210)), but Stage 1a says it “alone can end the job” and that a small result exonerates A7 ([line 191](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:191)). “Skipped entirely if Stage 1a decides” therefore permits a defer without 1b.

2. **The seeded workload has no acceptance criteria.** “Long,” “dense,” and “overlapping” specify neither counts nor verified intersections. A thin seed could satisfy their ordinary meaning and reproduce the false defer.

3. **The Stage 1a early-exit language is the remaining comfortable-number escape hatch.**

Smallest correction:

- State that **Stage 1a may end the job only with an optimise verdict**. If every 1a probe is below threshold, Stage 1b is mandatory; defer is unavailable until 1b passes.
- Give 1b objective pre-timing acceptance criteria, for example: an article with at least 2,000 blocks, at least 100 anchored comments on distinct blocks, glossary occurrences on at least 1,000 distinct prose blocks, and at least 100 blocks where comment and glossary ranges genuinely intersect. Verify those rendered/working counts before accepting any timing.
- State that defer is allowed only when this accepted workload remains below every decision threshold.

F4 still open.