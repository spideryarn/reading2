# Code review: Simple on Opus for every article (plan 261001p)

You reviewed the plan and decision already (`docs/plans/261001p-plan-review-sol.md`); every finding
was taken. This is the code built from it. **Fix what you find inside this change** (you have
workspace-write), and report anything wider for me to decide. Do not commit, do not touch git state,
do not run anything that spends money on a model.

**The change:** `git diff HEAD` in this worktree, plus the untracked files `git status --short` lists.
The parts that matter:

- `src/models.ts` — `ALWAYS_HIGH_POWER` (holding `simple`) and `powerFor(task, articlePower)`.
- `src/pipeline.ts` — the `simple` step passes `powerFor("simple", ctx.power)`.
- `src/routes.ts` — `modelsInUse` (`GET /api/models`) resolves through `powerFor`.
- `src/web/HighPowerSwitch.tsx`, `src/web/FeaturesPage.tsx` — copy.
- `tests/simple-summary.test.ts` § the step, and the new case in
  `tests/authenticated-api-route-contract.test.ts`. Both were seen red with the set emptied.
- `evals/simple/probe.ts` — `--power` and `--guard` flags, recorded per result file.
- `scripts/probes/261001p-check-saved-levels.ts`, `scripts/probes/261001p-blind-packet.ts` —
  measurement probes; nothing in `src/` imports them.
- Docs: the plan, `docs/project/summaries.md`, `docs/project/high-powered-ai.md`, status lines in
  261001h and 261001i, and `docs/user-feedback/261001_1710-…`.

**Questions:**

1. Is there any other path that picks Simple's model or reports it and still uses the article's
   power, or `"standard"`, directly? Look for `modelFor("simple"`, `resolveModel("simple"`,
   `generatorFor(` near Simple, the owner's GET, metadata rerun rows, cost estimates or the admin
   cost view, and the `/metadata` copy. Does anything compare a stored Simple `generator` to
   `generatorFor(article power)` and so call an Opus summary stale, or misreport it?
2. Does the 261001j stagger (Fuller first, others on `MeteredCall.onStart`) depend on the model in
   any way the change could break? The plan says the ledger showed it working on Opus.
3. `powerFor` lives in `models.ts` beside `TASK_TIER`. Is that the right home, and is a `Set` of
   tasks the right shape, or would a typed table that every task must appear in be better here?
4. Is the probe's flag parsing correct (`--arm`, `--power`, `--guard`, slugs in any order), and does
   omitting `--guard` keep the press's default?
5. Do the docs now say anything false: numbers, the switch name, the reversal instruction?

Then run `npm run typecheck` and the four relevant suites
(`npx vitest run tests/simple-summary.test.ts tests/authenticated-api-route-contract.test.ts tests/models.test.ts tests/high-power-models.test.ts`)
after any fix you make. Report: what you fixed (file and line), what you would leave for me, each
ranked P0/P1/P2, and the gates' results.
