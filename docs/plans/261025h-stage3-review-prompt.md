# Review: Stage 3 of plan 261025h — the literature search reads through a Haiku triage

Repo: this worktree (TypeScript/ESM, vitest, Postgres via drizzle). You may fix what you find
inside this stage (house workflow: you fix, I read your diff and commit); report anything wider for
me to decide.

## The candidate

Commit 71139c656 (`git show 71139c656`), on top of Stages 1–2. The plan:
docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md (§ Stage 3, its
"Result" and "Built" paragraphs, the cost ladder). The evidence: docs/investigations/261025h-situate-eval-haiku-sonnet-opus.md
and scripts/spikes/261025h-situate-eval.ts (arms C and D, `triageInstructions`). Contracts:
docs/project/ai-gateway.md, docs/project/cost-tracking.md, docs/project/high-powered-ai.md,
docs/project/architecture.md § Conventions (freshness), docs/project/security-map.md (the article,
the evidence and every model answer are untrusted), docs/project/privacy.md, docs/project/prompting-guide.md.

## What I want

An independent attack. In particular:

- **Models and money**: does `situate-triage` really go to Haiku at both powers, and the plan and
  read follow the article's power, as the wire body would send them? Is the triage's cost recorded
  in cost tracking under the right task and category? Could anything route the triage to Opus or the
  read to Haiku? Is the thinking budget real (Haiku's adaptive thinking ate its budget in the eval)?
- **Untrusted triage output**: `readShortlist` keeps only ids this run gathered. Can the triage's
  words reach the read, the stored dossier or a search? Can a shortlist make `checkFindings` looser
  or stricter (it must still check against all the evidence)?
- **Failure is visible**: an empty, malformed or failed triage must be a failure the reader sees,
  not an empty dossier passed off as success. Retry semantics and the rate limits (4/hour, 12/day,
  100/day global) — does a triage failure consume an allowance it shouldn't, or get around one?
- **Freshness**: the per-call `phases` stamp, `isOutdated`, `phasesOutdated`, the pipeline step's
  `stamp` and pg.ts's `isCurrent` arm. Do the two deciders agree in every case? The builder chose
  that old situate/2 dossiers (no `phases`) stay current — is that sound? Any way a dossier is marked
  stale wrongly, or a real model change missed?
- **Privacy**: the builder says the public page needs no change because the same provider gets the
  same data. Check.

Run the suites you touch (`npx vitest run tests/situate*.test.ts tests/high-power-models.test.ts
tests/freshness-deciders.test.ts tests/models.test.ts`; the database may not be reachable from your
sandbox — say so if not). Severity: P0 data loss / exploitable security / incorrect charging /
broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2
design/maintainability; P3 prose. IDs S3-F1…. For each: evidence file:line, and either "fixed" (with
the test that proves it, red first) or a suggested fix.
