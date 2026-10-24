- **F1 — P3, fixed:** [content-extraction.md:570](/var/tmp/spideryarn-worktrees/fix-import-cycle/docs/project/content-extraction.md:570), [read-parts.ts:154](/var/tmp/spideryarn-worktrees/fix-import-cycle/src/read-parts.ts:154) and related comments still pointed to the helpers’ old implementation location.
- **F2 — P3, fixed:** [read-article.ts:923](/var/tmp/spideryarn-worktrees/fix-import-cycle/src/read-article.ts:923) referred to `ReadabilityRefused` and its docstring “above”; both remain in `extract.ts`.
- **F3 — P3, fixed:** [postmortem:49](/var/tmp/spideryarn-worktrees/fix-import-cycle/docs/postmortems/261024m-import-cycles-closed-by-a-new-caller.md:49) incorrectly described a second guard layer. The guard returns the same object unchanged. Also corrected its claim about what the new module’s header documents.

No behavioral regression found. All 17 exports remain; moved implementations are unchanged. Runtime probes confirmed re-export identity, `instanceof`, lazy jsdom loading and allowance-store identity. The adapter’s dependencies do not reach `pipeline.ts`; Situate tests inject dependencies directly.

Validation: cycles, typecheck via `node --import tsx scripts/typecheck.ts`, and **318 tests across 9 files passed**. Lint had advisory findings only. PostgreSQL tests could not start because sandbox access to local Postgres/Docker was denied.

**Final verdict: APPROVE — no blocking findings; PostgreSQL validation remains outstanding.**