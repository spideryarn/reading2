No P0 findings.

1. **P1 — Parallel failures could orphan paid calls.** Fixed the worker pool to stop taking new tasks after a failure and await every call already in flight before releasing the allowance and request collector. Added a concurrency regression test. [model-topics.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/shelf-terms/model-topics.ts:433)

2. **P1 — The arrival drain could file stale topic IDs.** It now takes its second claim, then re-reads both the shelf and current topic set before filing. Added a race test where another request replaces the tree between claims. [shelf-topic-sets.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/shelf-topic-sets.ts:503)

3. **P1 — Missing exact-copy hashes could produce unstable memberships and a stale response.** Paid work now waits for hashes across active and archived articles, re-reads afterward, and rebuilds the browser response. This also correctly restores the phrase fallback if grouping reduces the shelf below eight works. Added four boundary/race tests and updated the docs. [shelf-topic-sets.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/shelf-topic-sets.ts:328)

4. **P1 — Several failure paths could forget a claim.** A failed release now tries the fenced failure path; a refused filing keeps `held` until release succeeds; and route serialization is wrapped so the already-taken claim and allowance are always completed. Persistent database failure can still leave a lease until expiry, which no application retry can eliminate. [shelf-topic-sets.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/shelf-topic-sets.ts:318), [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/routes.ts:8043)

5. **P1 — Tree keys and names were not unique in every collision case.** Qualified keys now receive deterministic suffixes when necessary; previous children are matched by unique branch key; and repeating a parent’s visible label is forbidden even when that parent’s stored key was qualified. Added regression tests for all three cases. [model-topics.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/shelf-terms/model-topics.ts:531)

6. **P1 — An empty successful tree could cross the orchestration seam.** `rethink` now refuses it, and both schema and migration enforce a non-empty JSON array. Added unit and Postgres coverage. [model-topics.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/shelf-terms/model-topics.ts:549), [schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/db/schema.ts:1637)

7. **P2 — Output cleaning and rendering had deterministic edge cases.** Labels now remove Unicode format controls as well as ordinary controls; equal-label term ordering uses the unique key; and paper-card list items use that key, avoiding duplicate React identities for parallel same-name topics. [model-topics.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/shelf-terms/model-topics.ts:142), [PaperCard.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/src/web/PaperCard.tsx:168)

8. **P2 — Left for your decision: the eval permits many intended categories to reuse one topic.** That can overstate category matching and filing recall when one broad model topic covers several truth categories. The results disclose this, but correcting it requires choosing an injective/hierarchy-aware matching rule and rerunning the paid eval. [hier.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbntyes8-topic-pills-research/evals/shelf-topic-clusters/hier.ts:134)

The already-documented equal-deletions/equal-new-unplaced trigger gap remains unchanged, as the plan explicitly accepts it for v1.

Verification:

- 132 non-Postgres scoped tests passed.
- The equivalent full typecheck passed all 2,832 covered files. The literal `npm run typecheck` cannot start in this sandbox because `tsx` is denied its `/tmp` IPC socket.
- Both Postgres files were rerun alone, but global setup was denied access to `127.0.0.1:54362` and Docker before test collection.
- Scoped Biome check had no new findings; only five existing complexity notices elsewhere in `routes.ts`.
- Migration metadata parses and `git diff HEAD --check` passes.
- I did not run migrations or any state-changing git command.

Sound to push to `dev`: yes, with the private-Postgres lane still required before treating this as production-verified.