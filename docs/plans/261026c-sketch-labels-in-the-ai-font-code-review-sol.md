1. **P2 — [tests/sketch-label-face.test.ts:129](/var/tmp/spideryarn-worktrees/sketch-labels-ai-font/tests/sketch-label-face.test.ts:129):** The tests derived everything from `SKETCH_LABEL_VOICE`, so reverting it to `"ui"` would still pass. Added an assertion pinning Greg’s `"ai"` decision.

Version-bump audit found no further defects:

- Existing sketches become `outdated`, but are not automatically regenerated.
- Sketch remains outside default ingest/cascades; auto-run only generates when none exists.
- Illustrated accepts an older-version Sketch unless it is absent, stale, or wrong-profile.
- Existing Illustrated paintings remain current because their exact source Sketch is unchanged.
- No stale `sketch/5`, Geist/0.53, prompt-31, eval-harness, or cache assumption remains in active code.

Checks:

- `npx vitest run sketch` — passed: 7 files, 157 tests.
- `npm run typecheck` — could not start because the sandbox denied `tsx`’s `/tmp` IPC socket (`EPERM`).
- Equivalent non-IPC invocation, `node --import tsx scripts/typecheck.ts` — passed all projects; 4,025 source files covered.
- Biome lint on the edited test — passed.
- `git diff --check` — passed.

No stored sketches, production data, remote databases, or Git history were touched. No commit was made.