## Findings

- **C1 — P2 — FIXED:** The migration silently collapsed a job containing both `trajectory` and `skim` into duplicate `skim` entries, potentially double-running work or losing distinct status/force state. It now aborts before any mutation when either `jobs.steps` or `jobs.reset.regenerate` contains both spellings. [20261001211832_skim.sql:29](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/drizzle/20261001211832_skim.sql:29)
  - Red→green: [db-step-constraint.test.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/tests/db-step-constraint.test.ts:146).

- **C2 — P2 — FIXED:** Stage 1 left `FaqRead`/`useFaqRead`, which existed solely for Skim’s removed FAQ snippets. The read logic is now internal to `useFaq`; its remaining FAQ panel behavior is unchanged. [useFaq.ts:68](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/src/web/useFaq.ts:68)
  - Red→green: the no-export assertion initially received `useFaqRead`; the final regression covers FAQ loading, generation, and absence of the obsolete hook. [artefact-read-hooks.test.tsx:173](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/tests/artefact-read-hooks.test.tsx:173).

- **C3 — P3 — FIXED:** The Skim documentation linked the command alias to `src/modes.ts`, although it lives in `src/mode-catalog.ts`. [skim.md:22](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/docs/project/skim.md:22)
  - Red→green: [skim-name.test.ts:37](/home/greg/code/spideryarn2/.claude/worktrees/fbskxhcz-bjbcxp-trajectory-becomes-skim/tests/skim-name.test.ts:37).

No wider defects found. The migration’s rename and drop→update→add ordering are correct; JSON array order, `NULL`/missing resets, and empty arrays are preserved. `work_key` remains unchanged deliberately per F5. The retained aliases, prompt version, input-hash namespace, DTO/export names, CSS selectors, and API allowlists are consistent.

Verification:

- 44 targeted tests passed.
- Wider relevant suite: 955 passed; one test could not reach its assertion because sandboxing denied its nested `git` process.
- Documentation links: 16 passed.
- Typecheck passed via direct execution of the project typecheck script; the npm wrapper’s IPC socket was denied by the sandbox.
- Biome lint and `git diff --check` passed.
- PostgreSQL tests were omitted as requested. One broad selection inadvertently reached database global setup, but connection was denied before any test body ran.

Files changed:

- `docs/project/skim.md`
- `drizzle/20261001211832_skim.sql`
- `src/web/useFaq.ts`
- `tests/artefact-read-hooks.test.tsx`
- `tests/db-step-constraint.test.ts`
- `tests/skim-name.test.ts`

No commit was created.

**Verdict: the rename is sound after three narrow fixes; no release-blocking issue remains.**