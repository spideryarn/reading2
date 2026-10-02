## Findings

**F1 — P1 — The migration leaves `revision_step_runs.prompt_version` disagreeing with the artefact.**

The plan rewrites `skim.version` and `revision_step_runs.step_name`, but not the separate run-row prompt version ([plan:94](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:94), [plan:102](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:102)). That column is persisted independently ([schema.ts:2513](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/db/schema.ts:2513)), while artefact `.version` is interpreted as the same stamp field ([artifacts.ts:986](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/store/artifacts.ts:986)). `stampForStep` compares them and throws `StampDisagrees`; it does not merely call the route outdated ([artifacts-pg.ts:724](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/store/artifacts-pg.ts:724), [artifacts-pg.ts:739](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/store/artifacts-pg.ts:739)).

Concrete fix: simplest is to retain the internal provenance tag `trajectory/7`; it names an unchanged prompt, not the user-facing mode. If it must become `skim/7`, rewrite every `revision_step_runs.prompt_version` beginning `trajectory/` in the same transaction, as well as the artefact version. Add a migration test exercising both `loadSkim` and the step-doneness/stamp path.

**F2 — P1 — The rename criterion would change the hash namespace and make every stored current route stale.**

The input hash includes the literal domain separator `trajectory-input\n` ([trajectory.ts:413](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/trajectory.ts:413), [trajectory.ts:428](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/trajectory.ts:428)). The plan’s final grep permits no such compatibility exception ([plan:130](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:130)). Renaming it to `skim-input` changes the recomputed hash, which both step freshness and `loadTrajectory` compare against the stored `sourceHash` ([pg.ts:3175](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/store/pg.ts:3175), [pg.ts:3733](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/store/pg.ts:3733)).

Concrete fix: rename the function but deliberately retain `"trajectory-input\n"` as the stable hash namespace and add it to the allowed compatibility residue. Recomputing both artefact `sourceHash` and run-row `input_hash` from every route’s inputs would be substantially more complex and buys nothing.

With F1 and F2 fixed, `generator` and `profileHash` are unaffected, and I found no other live freshness cache keyed by the prompt-version string.

**F3 — P2 — The browser persistence inventory misses the IndexedDB offline copy.**

Trajectory is explicitly cacheable ([api.ts:847](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/lib/api.ts:847)), and IndexedDB persists both the exact URL and parsed response body ([offline-store.ts:54](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/lib/offline-store.ts:54)). Its key is the exact URL ([offline-store.ts:385](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/lib/offline-store.ts:385), [offline-store.ts:458](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/lib/offline-store.ts:458)). The current client requests `/api/trajectory/...` and reads `body.trajectory` ([useTrajectory.ts:104](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/useTrajectory.ts:104), [useTrajectory.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/useTrajectory.ts:117)). After the rename, that paid offline route becomes unreachable from `/api/skim/...`.

Concrete fix: add an exact IndexedDB compatibility migration or fallback that maps `/api/trajectory/<slug>` to `/api/skim/<slug>` and the top-level response field `trajectory` to `skim`. Test an existing old cached response while offline.

**F4 — P2 — Feedback contains two additional persisted spellings, and the proposed stale-tab handling covers only one.**

`feedback.url` stores the whole address and can contain `?mode=trajectory`; `feedback.diagnostics` is persisted JSONB ([schema.ts:4235](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/db/schema.ts:4235), [schema.ts:4271](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/db/schema.ts:4271)). Diagnostics contain both `article.mode` and `job.step` ([feedback-payload.ts:123](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/feedback-payload.ts:123), [feedback-payload.ts:134](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/feedback-payload.ts:134)). They are parsed through separate current-name lists ([feedback-payload.ts:518](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/feedback-payload.ts:518), [feedback-payload.ts:534](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/feedback-payload.ts:534)). The plan mentions normalising only the mode through `RETIRED_MODES` ([plan:82](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:82)); it will silently lose an old tab’s `job.step`.

Concrete fix: add these fields to the inventory. Preserve existing feedback URLs and historical JSON as evidence, but accept/normalise both incoming `article.mode: "trajectory"` and `job.step: "trajectory"` from stale tabs. The latter needs a step alias, not `RETIRED_MODES`.

**F5 — P2 — Rewriting job JSON leaves the derived `work_key` inconsistent and complicates active-job handoff.**

`work_key` is an immutable hash over the ordered step names and force flags ([schema.ts:2150](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/db/schema.ts:2150), [jobs.ts:81](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/store/jobs.ts:81)). It backs the active-work uniqueness constraint ([schema.ts:2404](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/db/schema.ts:2404)). The plan rewrites `jobs.steps` and `reset` without mentioning that derived value ([plan:97](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:97), [plan:104](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:104)). A new equivalent Skim request therefore has a different key and does not deduplicate against an affected active job. An old worker can also try writing `step_name='trajectory'` after the constraint has narrowed.

Concrete fix: add `work_key` and active jobs to the decision. The simple in-place approach should check that no affected queued/running jobs exist immediately before migration and explicitly accept the brief old-code write window. Terminal rows can retain their immutable historical key. If uninterrupted active-job compatibility is required, this is the part that requires a genuine bridged expand/contract deployment, not merely adding and copying a column.

**F6 — P2 — Rewriting `ai_calls` contradicts the ledger’s append-only historical contract.**

The plan calls the cost-ledger values “only a label” and rewrites them ([plan:98](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:98), [plan:118](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:118)). The classifier explicitly says these are historical strings and the ledger is append-only ([cost-categories.ts:32](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/cost-categories.ts:32), [cost-categories.ts:101](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/cost-categories.ts:101)); its tests deliberately preserve retired provenance ([cost-categories.test.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/tests/cost-categories.test.ts:108)).

Concrete fix: do not update `ai_calls`. If reports should combine this exact pure rename, add a narrow, tested legacy classification alias for `trajectory` while retaining the original ledger values.

**F7 — P2 — “Apply locally only at push time” is not sufficient shared-DB coordination.**

The plan correctly identifies that every old worktree breaks, but its only action is timing plus telling the Overseer ([plan:115](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:115)). The database rule says that breakage is inherent and no migration lock covers it ([database.md:917](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/project/database.md:917)).

Concrete fix: make coordination a stage precondition: Stage 1 must be landed first; announce immediately before applying locally; identify active worktrees still using the old schema; apply only when the PG tests and push can follow immediately; then notify them that merging `dev` is required. This does not justify expand/contract, but it makes the accepted disruption deliberate.

**F8 — P3 — The Dock audit names a symbol that no longer exists.**

The plan names `acceptDockMode` ([plan:80](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md:80)); the current read-side function is `modeInSearch`, and it already uses `modeFromParam` ([Dock.tsx:1102](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/Dock.tsx:1102)). `withMode` only emits canonical URLs ([Dock.tsx:2396](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/Dock.tsx:2396)).

Concrete fix: replace the obsolete name in the plan and test `modeInSearch`’s effective behavior.

## Decisions

I agree with rename-in-place over the proposed expand-now/contract-later alternative. Deployment intentionally applies migrations before Vercel ([deployment.md:154](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/project/deployment.md:154)), and the house rules explicitly accept this short beta window. A safe expand/contract would require bridging old writes to the new column or dual-writing across two deployments; the draft’s add-and-copy alternative permits silent divergence and is worse than the loud temporary failure.

`RETIRED_MODES` does cover the actual old-link paths:

- Client parsing and the shared Reader use `modeParam → modeFromParam` ([params.ts:294](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/params.ts:294)).
- Server titles use `readMode → modeFromParam` ([read-address.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/read-address.ts:47)).
- Dock reads use `modeInSearch → modeFromParam`.
- Last-view deliberately retains the raw query; it is parsed when the shared Reader restores it ([last-view.ts:260](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/last-view.ts:260)).
- Keyboard behavior receives the already-parsed mode. Owner and public/visitor readers share that path.

I found no separate public-share snapshot, profile row, reading-position row, Sentry tag, or Storage path keyed by this mode. The persisted omissions are the run stamp, feedback, IndexedDB, and the derived job key above.

**Verdict: Revise before implementation—rename-in-place is the right shape, but F1 and F2 currently make stored Skim routes broken or stale, and the persisted-string inventory is incomplete.**