# Review: the codebase-rework umbrella plan, and the skill that produced it

You are reviewing two things in the repo at this working directory (a git worktree of the
Spideryarn project — TypeScript, ESM, Node, React, Postgres/Drizzle).

## Read, in this order

1. `docs/reusable/improve-the-codebase.md` — a NEW reusable instruction doc, written today. It tells
   an agent how to find rework worth doing (tidyups, refactors, rearchitectures, bug hotspots) and
   how to choose between the candidates.
2. `docs/reusable/engineering-manager.md` — the doc it sits under and must not duplicate.
3. `docs/plans/260902e-codebase-rework-umbrella-what-is-worth-doing-next.md` — the umbrella plan
   produced by the FIRST RUN of that skill. This is the main object of review.
4. For background on prior art: `docs/plans/260826m-simplification-audit.md` and
   `docs/plans/260828aj-simplification-wave-2.md` (two earlier waves of this same kind of work).
5. `AGENTS.md` for the working agreements.

## What I want from you

### A. Is the umbrella plan's prioritisation right?

The plan tiers findings 0/1/2/3 and scores each on effort, value and risk. Challenge it:

- **Is anything in the wrong tier?** In particular: 0.1 (six of seven hooks missing a race guard) is
  held at "Tier 0 pending reproduction" rather than being treated as a confirmed bug. Is that the
  right call, or is it a dodge?
- **Is the chosen Stage 1 (items 1.1 and 1.2 — two parity tests for invariants that are currently
  only prose) the best use of a first run?** Argue for a different first cluster if you think one is
  better value. Note the constraint: a stage must end committable, green and deployable, and the run
  is deliberately small.
- **Is anything important MISSING** from the map? The inputs were two Sonnet sweeps over `src/`
  (a "what does the codebase already say about itself" grep, and a duplication sweep), plus
  `npm run check`, plus a churn × complexity ranking. What would those inputs systematically fail to
  see? Name concrete areas, not categories.
- **Is 3.1 (splitting `src/routes.ts`, 6,671 lines, one export `handleApi`, one importer) sized and
  sequenced correctly?** The plan says its prerequisite is a route/method matrix test. Is that the
  right prerequisite, and is "then it becomes a pure extraction" true, or is there a hazard the plan
  is not seeing? Look at the actual file.

### B. Verify the plan's factual claims

Every finding was supposedly hand-verified. Check a sample against the real code, especially:

- the guard-refs table for the seven `src/web/use*.ts` hooks, and whether the six really are exposed
  to the race the plan describes (or whether something else protects them — a key on the component,
  a single mount point, an effect ordering). **This is the claim most likely to be wrong**, and the
  plan admits it is unreproduced.
- the three `sourceHashFor` copies (`pg-searches.ts`, `pg-referee-claims.ts`,
  `pg-referee-criteria.ts`) — are they actually equivalent today, and is a parity test the right
  fix, or should they simply be merged into one function now?
- `MIGRATIONS_SCHEMA`/`MIGRATIONS_TABLE` in `src/migration-digest.ts` vs `drizzle.config.ts` — is
  the "silently starts a fresh history" failure real?

Tell me plainly about anything the plan asserts that is false or overstated.

### C. Critique the skill doc itself

`docs/reusable/improve-the-codebase.md` is meant to be MINIMALIST — suggestions and judgment, not a
rigid checklist — and to bias hard against over-engineering.

- Did the first run actually follow it? Where did the run diverge from what the doc says?
- What in the doc failed to earn its place, judged by whether it changed what this run did?
- What is missing from the doc that this run needed and had to improvise?
- Does the doc's anti-over-engineering guidance actually bite, or would an agent reading it still
  ship a "clean architecture" refactor that makes things worse?

## Output

Prioritised findings, most important first. For each: what is wrong, the evidence, and what you
would do instead. Be concrete and cite file:line. Flag clearly which findings you are confident in
and which are hunches. Disagreeing with the plan's conclusions is the point — do not be agreeable.
