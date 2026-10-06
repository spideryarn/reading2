No P0 or P1 found. Extending the existing helper is proportionate; the header and offline-cache exclusion preserve compatibility with old tabs.

**F1 — P2: Define absence as “no usable artefact,” or explicitly distinguish unusable data.**  
The plan’s loader instructions say only “never made” moves (plan lines 20–26), but three guards combine absence with unusability:

- `src/store/pg.ts:3919`: FAQ also rejects a missing/non-array `questions`.
- `src/store/pg.ts:4028`: Simple rejects any unusable document, including legacy `simple/1`; `src/types.ts:6021` deliberately says these read as absent.
- `src/store/pg.ts:4157`: Debate combines absence and failed `isDebateDocument` validation in **one throw**, rather than two artefact-absence throws.

**Plan change:** Explicitly preserve these predicates and convert their existing “no usable artefact” throws wholesale. Add cases for legacy Simple, malformed FAQ/Debate, and valid empty FAQ/Timeline/Debate documents. This keeps current UI semantics and prevents the builder inventing a distinction during implementation.

**F2 — P2: Browser acceptance needs evidence that every intended request occurred.**  
Plan lines 81–83 require no 4xx for ten reads on page load, but Simple mounts only within its Summary view (`src/web/useSimple.ts:15`); four others are read together by Marginalia (`src/web/marginalia/MarginaliaColumn.tsx:722`). A clean network log can therefore pass without exercising every route. Clicking an empty mode can also start generation (`src/web/useAutoRun.ts:174`), obscuring the empty-state check.

**Plan change:** Open the relevant views directly by URL without a mode activation, enable Marginalia where needed, and assert the observed request set includes all ten URLs. Check empty and populated states separately. Correct the introduction’s unconditional “seven red 404s” claim accordingly.

**F3 — P3: “There is now one convention” overstates the scope.**  
Plan line 45 contradicts its explicit exclusions: Tweets, Relations, Skim, Sketch and Arc retain ordinary artefact-absence 404s—for example, `src/store/pg.ts:4404`.

**Plan change:** Say “these ten reads share the opt-in convention”; retain the other routes as explicit exclusions.

The remaining suspicions did not reveal blockers: checked loader callers do not depend on the old error name; `guardDbStore` passes numeric-status errors through; other client consumers reuse the hooks in scope; visitors use a separate payload. The offline cache ignores `Cache-Control`. Wrapping outside `withProfileChanged` preserves its error ordering, Glossary’s `alsoFrom`, and Quotes’ cleared-profile rule, provided their existing arguments remain intact.

Validation: existing catch-boundary suite passed **27/27**. No files changed; this does not validate the unbuilt extension.

VERDICT: build it