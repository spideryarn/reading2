The approach is sound, but several correctness gaps need fixing before implementation.

1. **P1 — The inventory misses existing older-version notices.**  
   Evidence: `src/web/SketchView.tsx:270`, `src/web/IllustratedView.tsx:559`, and `src/web/ClaimsPanel.tsx:424` contain standalone older-version notices absent from the plan’s supposedly complete table (`docs/plans/261010a-dismiss-older-version-notices.md:23`). Row-level warnings also need explicit classification: `src/web/CriteriaPanel.tsx:1246` and `src/web/DebatePanel.tsx:2534`.  
   Fix: audit user-facing stale/older-version copy rather than CSS classes, add the three standalone notices, and explicitly document which row-level warnings remain. Use a shared dismissal control/hook rather than forcing every differently shaped surface into one banner component.

2. **P1 — `search:<runId>` does not expire when a search answer is regenerated.**  
   Evidence: the plan assumes rerunning changes the identity (`docs/plans/261010a-dismiss-older-version-notices.md:59`), but search revisions deliberately retain the same ID (`src/searches.ts:145`, `src/searches.ts:173`), and retries update the same database row (`src/store/pg-searches.ts:175`, `src/store/pg-searches.ts:215`). `finished_at` is the generation clock that changes (`src/db/schema.ts:4887`).  
   Fix: expose a bounded answer-generation identity—such as `finishedAt` or a generation UUID—and key dismissal by `search:${run.id}:${generation}`. Test revision and retry paths where `run.id` stays unchanged.

3. **P1 — Dismissing Quiz and Skim fault banners would hide their only useful fault explanation.**  
   Evidence: Quiz refuses submission before the server’s explanatory 409 can occur (`src/web/QuizPanel.tsx:1061`), disables its answer controls (`src/web/QuizPanel.tsx:1245`, `src/web/QuizPanel.tsx:1280`), and hides its footer while stale (`src/web/QuizPanel.tsx:1131`). Skim explicitly relies on the stale banner to explain a missing stop (`src/web/modes/skim/SkimMode.tsx:700`, especially the comment at `:711`); its row only shows a disabled dash (`src/web/SkimPanel.tsx:802`). This contradicts the plan’s fallback claim (`docs/plans/261010a-dismiss-older-version-notices.md:43`).  
   Fix: before making these banners dismissible, add persistent control-local explanations: Quiz’s disabled marking state must say why, and each missing Skim stop must say that its passage no longer exists. Add post-dismissal fault tests.

4. **P2 — Dismissal can also hide running, failed, or stoppable regeneration jobs.**  
   Evidence: several panels suppress their footer whenever stale because the banner currently owns job status and Stop controls: `src/web/IdeasPanel.tsx:283`, `src/web/FaqPanel.tsx:163`, `src/web/TimelinePanel.tsx:467`, `src/web/SimplePanel.tsx:180`, and `src/web/QuizPanel.tsx:1131`. Skim already had to repair this exact case for its profile-notice dismissal (`src/web/SkimPanel.tsx:740`, comment at `:753`).  
   Fix: distinguish “stale banner is visible” from “artifact is stale.” Once dismissed, render job progress, failure, and Stop controls in the normal footer. Test dismissed-plus-running and dismissed-plus-failed states for every job-bearing panel.

5. **P2 — Accepting arbitrary opaque keys leaves unbounded persistent storage.**  
   Evidence: the endpoint would accept invented identities without checking current artifacts (`docs/plans/261010a-dismiss-older-version-notices.md:90`). The glossary precedent explicitly rejects format-only validation because it permits unlimited invented rows (`src/store/pg-glossary-hidden.ts:8`). The security model does treat signed-in readers as trusted (`docs/project/security-map.md:29`), so this is not a cross-reader disclosure, but repeated requests and ordinary regenerations can still accumulate rows indefinitely.  
   Fix: either validate keys against current artifact identities, or structurally bound storage: one replaceable dismissal per article/mode, with separately bounded Search dismissals tied by foreign key to search runs and cascaded when those runs disappear.

6. **P2 — The cache requirements name races but do not specify or test enough to prevent them.**  
   Evidence: the plan only calls for optimistic success and POST-failure reread tests (`docs/plans/261010a-dismiss-older-version-notices.md:134`). Existing dismissal code needs explicit slug and request-order fencing (`src/web/useSkim.ts:126`, `src/web/useSkim.ts:231`), while account epochs protect sign-out transitions (`src/web/rewrite-hold.ts:29`). An older GET can otherwise overwrite an optimistic dismissal, and one failed POST can roll back another pending or successful dismissal.  
   Fix: define cache entries by `(account epoch, slug)`, share one in-flight GET, use monotonically ordered reads and per-key mutation tokens, overlay pending dismissals on server results, and discard completions from old epochs/slugs. Test stale GET completion, concurrent POSTs, slug navigation, sign-out, and GET deduplication.

7. **P3 — The proposed coverage cannot enforce the claimed completeness and misses registries.**  
   Evidence: a manually enumerated component table cannot make a newly added stale banner fail if the author forgets to add it—the current omissions demonstrate that (`docs/plans/261010a-dismiss-older-version-notices.md:141`). The new store also belongs in the guarded-store registry (`tests/store-guarded.test.ts:144`), and replacing close markup affects the cross convention test (`tests/close-cross.test.ts:28`, `tests/close-cross.test.ts:120`). Existing stale-surface coverage is itself partial (`tests/mode-surface-changes-no-markup.test.tsx:2175`).  
   Fix: add a source-level guard against legacy stale-banner markup/copy outside the shared primitive or an explicit exception list; update `store-guarded`, `close-cross`, and stale-surface tests. Include the omitted notices in component and accessibility coverage.

build with fixes