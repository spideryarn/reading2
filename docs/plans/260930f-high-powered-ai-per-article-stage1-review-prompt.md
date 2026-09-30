# Code review, Stages 1–2: 260930f high-powered AI per article

CANDIDATE: commit 9b611dfe (parent 3f83c9a7). `git show --stat 9b611dfe` lists every changed path.

You are the code reviewer AND fixer for one stage. Repo: this worktree. The candidate is the commit
named in `CANDIDATE` below (`git show --stat <sha>` lists every changed path; start with the files
under "Start here", which do not limit scope). The plan is
`docs/plans/260930f-high-powered-ai-per-article.md` (decisions 1–8, Stages 1–2 with "What landed");
its plan review is `docs/plans/260930f-high-powered-ai-per-article-plan-review-sol.md`.

Goal of the stage: a per-article switch (`articles.high_power_since`) that, on an admin-owned
article, moves every capable-tier model call made for that article from Sonnet 5 to Opus 5.5 via a
required `power: ModelPower` argument; freshness treats the two models as one generation; checkpoint
keys stay exact; effort parity (provider-default → `high` on Opus); an admin-namespace route
`PUT /api/admin/article/:slug/high-power` scoped to the caller's own article.

Start here: src/models.ts, src/high-power-model.ts, src/messages-stream.ts, src/ai-call.ts,
src/store/artifacts.ts, src/store/pg-high-power.ts, src/jobs.ts (readStepPower, AdvanceParts.power,
runStep), src/pipeline.ts (StepContext, stamps), src/routes.ts (powerOf and its callers, the admin
route), src/citation-lookup.ts, src/citation-investigate-context.ts, src/labels.ts,
src/hierarchy-expand.ts, src/article-prompt.ts, src/web/article/access.ts, src/web/PrivacyPage.tsx,
drizzle/20260930111320_article_high_power_since.sql, tests/high-power-*.test.ts.

## What to attack (independent pass first)

1. Any call made for a high-power admin article that still sends Sonnet (pipeline, chat wire inside
   the pipeline, every request path, live conversation tools, term lookup, hierarchy expand/deepen,
   successors/resets/retries). Any call for a NON-admin or standard article that sends Opus.
2. Freshness: does toggling in either direction make anything stale, detach citation lookups, or
   trigger regeneration? Does an unrelated model still read as stale?
3. Checkpoint/fingerprint keys: can an Opus run reuse a Sonnet-paid answer or vice versa?
4. Effort parity on both wires, and whether any ceiling is now too small.
5. The admin route: authz, ownership, strict body, response; the metadata/public DTO exposure of
   `highPowerSince` (must not reach a stranger).
6. The migration (hand-edited to `ADD COLUMN IF NOT EXISTS`, applied directly to the local DB because
   another worktree's migration sat in the shared ledger) — is it safe for production's migrate?
7. Spend attribution: does `ai_calls` record the model actually sent?
8. Anything simpler that would do the same job.

## Fix, narrowly

Fix what is inside this stage, red-first (a failing test, then the fix). Report — do not fix —
anything wider. You cannot reach Postgres or the network: tests needing a database will fail for
that reason; say which you could not run. Run `npm run typecheck` and the pure test files you touch.
Do not commit. Do not touch src/billing/*, auth, or the admin gate.

## Output

Findings with IDs (F1…), severity (P0 data loss/exploitable security/incorrect charging/broadly
unusable; P1 user-visible wrong behaviour or authoritative contract violated; P2 design risk, no
wrong behaviour today; P3 prose), file:line evidence, and whether you fixed it (list files touched).
Refuse only on an established P0/P1. End with `VERDICT: ship` or `VERDICT: fix-first`.

## My own suspicions (worth less)

- Two cache estimates still use Sonnet's 1,024 floor (labels.prefixIsCacheable,
  hierarchy-expand.expansionPrefixIsCacheable).
- `buildTree` still stamps Sonnet and `generateHierarchy` overwrites the stamp.
- `generationKey` maps all four spellings to `anthropic/claude-sonnet-5` to keep existing hashes
  byte-identical — does that bake in something that breaks when the capable tier next moves?
