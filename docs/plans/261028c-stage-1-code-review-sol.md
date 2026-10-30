## Findings

- **CR-1 — P2 — [src/explanations.ts:136](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/explanations.ts:136)**  
  Freshness hashed the whole Structure tree even though no tree skeleton reaches the model. A tree-only edit could therefore trigger an identical paid rerun. I changed the fingerprint to cover the exact rendered article and ceiling, with the tree used only for the fallback title. The Postgres freshness read now includes block `kind` so it computes the same paragraph ceiling ([src/store/pg.ts:1891](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/store/pg.ts:1891)).

- **CR-2 — P3 — [src/explanations.ts:250](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/explanations.ts:250)**  
  Once the cap was full, a valid new block was not recorded as taken. A later row for that block was therefore counted as another `overCap`, despite the one-per-block rule preceding the cap. I moved the `taken` update before the cap check. Returned explanations are unchanged; drop accounting is now correct.

- **CR-3 — P2 — [tests/stage-stamp-agreement.test.ts:284](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/tests/stage-stamp-agreement.test.ts:284)**  
  Explanations was absent from the hand-maintained generator-versus-pipeline stamp matrix, and its route was absent from the profile-concurrency matrix. Those omissions could hide permanent reruns or broken `profileChanged` behavior. I added both, including a non-null-profile stamp assertion and the real `/api/explanations/:slug` handler ([tests/route-profile-concurrency.test.ts:66](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/tests/route-profile-concurrency.test.ts:66)).

- **CR-4 — P3 — [tests/explanations.test.ts:200](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/tests/explanations.test.ts:200)**  
  Several named rules had weak or missing mutation-sensitive coverage: spaced-only quote matching, all validation rules preceding the cap, the absent tree skeleton, body-paragraph counting, and the deliberate auto/Metadata exclusions. I added direct assertions for each.

- **CR-5 — P3 — [src/store/artefact-not-made-yet.ts:27](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/store/artefact-not-made-yet.ts:27)**  
  The single-source route list still said sixteen and omitted Sources Claims and Explanations. I corrected it to nineteen and named the missing loaders.

- **CR-6 — P2, wider than this stage — [evals/cost/harness.ts:197](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/evals/cost/harness.ts:197)**  
  `PAYING_STEPS` omits `explanations`, so the planned cost run could succeed without requiring its ledger row. I did not change it: this inventory is already stale for several paid modes and also derives `ALL_MODES`; fixing it properly requires a wider harness-policy change.

## Files edited

- `src/db/schema.ts`
- `src/explanations.ts`
- `src/pipeline.ts`
- `src/store/artefact-not-made-yet.ts`
- `src/store/contracts.ts`
- `src/store/pg.ts`
- `src/types.ts`
- `tests/explanations.test.ts`
- `tests/freshness-deciders-agree.test.ts`
- `tests/pipeline-artifact-store.test.ts`
- `tests/route-profile-concurrency.test.ts`
- `tests/stage-stamp-agreement.test.ts`
- `tests/store-revision-columns.test.ts`

## Checks

- `npx vitest run tests/explanations.test.ts` — **passed, 26 tests**
- `npx vitest run tests/route-profile-concurrency.test.ts tests/stage-stamp-agreement.test.ts` — **passed, 75 tests**
- `npx vitest run tests/pipeline-artifact-store.test.ts tests/store-revision-columns.test.ts` — **passed, 118 tests**
- `npm run typecheck` — wrapper could not start because `tsx` received `EPERM` opening its `/tmp` IPC socket.
- `node --import tsx scripts/typecheck.ts` — **passed all projects; all 4,062 source files covered**
- Database-backed freshness suite — could not start because local Postgres was unavailable.
- Targeted Biome lint — **completed successfully**; only existing advisory findings in large surrounding functions.
- `git diff --check` — **passed**

**Verdict: Stage 1 is ready with these fixes; only the wider cost-harness omission remains for a separate decision.**