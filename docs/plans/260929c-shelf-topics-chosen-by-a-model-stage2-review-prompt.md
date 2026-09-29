# Stage 2 code review prompt: shelf topics chosen by a model (260929c)

Reviewer-fixer. **Candidate (live, pre-commit)**: base commit 10a21a0e plus the uncommitted working tree. `git diff 10a21a0e --stat` for tracked changes; untracked files to review too: src/shelf-topics.ts, src/shelf-terms/model-scores.ts, drizzle/20260929065031_shelf_topic_scores.sql (+ its snapshot), tests/shelf-topics-model-scores.test.ts, tests/shelf-topics-route.test.ts, evals/shelf-topics/tally.ts. The tree also contains your own Stage 1 review fixes (declared-spend, the `decisions` wire, choose.ts validation, summary) — already reviewed; don't re-review them.

Start with src/shelf-topics.ts, src/shelf-terms/model-scores.ts, the terms route in src/routes.ts, src/store/pg-shelf-terms.ts (snapshot, readScores/claimScores/writeScores/failScores/releaseScores), the migration, src/models.ts / src/ai-call.ts / src/cost-categories.ts (the new `shelf-topics` job), src/web/useShelfTerms.ts, src/web/PrivacyPage.tsx and docs/project/privacy.md, docs/project/shelf-terms.md § The model's judgement. The requirements are the plan's § Reviews R1–R4 and § Stage 2 "Landed" (docs/plans/260929c-shelf-topics-chosen-by-a-model.md).

**No test has ever run for this stage**: the box's memory guard refused every vitest start. Typecheck passes. So read the tests as claims, not evidence, and look hard for anything a test would have caught.

## Please
1. Spend and billing (R1, R3): is every model call recorded in the request's collector against the reader, never a late finish? Could any path call the model twice for one input (two tabs, the client's refetches, a stale claim), retry in a storm after failures, or run without the allowance? Is the ingest quota untouched?
2. Correctness: the input hash (what refreshes, what must not); the stale-row rule (a stale row's scores applied, unscored keys excluded, fallback to the program's list); the fenced write; backoff; `pending > 0` gating; the client's bounded refetch; scope handling for archived.
3. Security and privacy (R4): owner isolation of the score row (claims, reads, writes all owner-scoped?), the FK and cascade, no titles/gists/labels/profile/prompt/answer in logs (check `errorFields` on a gateway error), the privacy page and doc accurate, prompt injection from article text (the "data, not instructions" line) and whether a malicious title can make the model emit scores for keys that don't exist or break the JSON contract.
4. The migration: additive, reversible, matches schema.ts, the rate-limit bucket widening safe on a table with rows.
5. Fix what is inside the stage, narrowly. You may not be able to run vitest either (the guard); if a fix needs a test, write it and say it is unrun. Do not commit. No paid calls.

## Output
Findings S2-1… with severity (P0/P1/P2/P3), established or reasoned, evidence, what you changed. One-line verdict.
