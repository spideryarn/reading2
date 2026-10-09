Review complete. No unfixed findings remain in scope.

1. **P2 — duplicated Summary sub-mode names and aliases. Fixed.** “Brief”, “Fuller”, and Thread aliases could drift from their owning table. They now derive from `SUMMARY_SUB_MODES`, while unsafe `rerun x` remains excluded. Evidence: [step-names.ts:90](/var/tmp/spideryarn-worktrees/fbu62q09-metadata-ai-step-names/src/web/step-names.ts:90), [rerun-commands.ts:117](/var/tmp/spideryarn-worktrees/fbu62q09-metadata-ai-step-names/src/web/rerun-commands.ts:117).

2. **P3 — inaccurate non-mode descriptions. Fixed.** Source now covers uploads, extraction covers webpages and PDFs, figures acknowledges partial copying, and Blocks avoids unexplained “id” jargon. Evidence: [step-names.ts:38](/var/tmp/spideryarn-worktrees/fbu62q09-metadata-ai-step-names/src/web/step-names.ts:38).

3. **P3 — stale reader copy and comments. Fixed.** The section no longer calls every result a mode, running text no longer says awkward things such as “the summary › thread”, StageRow’s comment reflects its new description line, and reset comments use current Peer review terminology. Evidence: [Metadata.tsx:1650](/var/tmp/spideryarn-worktrees/fbu62q09-metadata-ai-step-names/src/web/Metadata.tsx:1650), [Metadata.tsx:2129](/var/tmp/spideryarn-worktrees/fbu62q09-metadata-ai-step-names/src/web/Metadata.tsx:2129), [reset-role.ts:83](/var/tmp/spideryarn-worktrees/fbu62q09-metadata-ai-step-names/src/reset-role.ts:83).

Command matching is correct: every generated re-run phrase selects its own row; `rerun summary` selects only Brief/Fuller; `rerun peer review` and `rerun diagram` select no paid sub-run. Unknown and prototype-key steps safely fall back. The full-row flex layout is sound at 390px.

Checks:

- Affected Vitest: 10 files, 225 passed, 2 skipped.
- Typecheck: all four projects and all 3,612 source files passed via `node --import tsx scripts/typecheck.ts`. The `npm run typecheck` launcher itself was blocked by the sandbox’s IPC-socket restriction.
- Biome lint: clean.
- Full `npm test` was attempted but could not start because the shared local database port/Docker was unavailable.

Files I changed:

- `src/reset-role.ts`
- `src/web/Metadata.tsx`
- `src/web/ResetArticle.tsx`
- `src/web/rerun-commands.ts`
- `src/web/step-names.ts`
- `tests/command-match-rerun-and-find.test.ts`
- `tests/step-names.test.ts`

No commit made.