No P0 findings. Four findings were fixed:

- P1 — [Metadata.tsx:2390](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:2390): both Archive buttons could dispatch before React rendered `disabled`, sending two PATCHes. Added a synchronous in-flight guard and same-turn activation test.
- P1 — [Metadata.tsx:2335](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:2335): malformed metadata or PATCH responses could be treated as a known archive state. Responses are now validated; unknown state removes both buttons and malformed writes trigger the fresh-read recovery path.
- P2 — [Metadata.tsx:3461](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:3461): the focused Access & sharing heading suppressed its focus outline. Restored the native focus indicator and pinned it in the Share test.
- P2 — [metadata-delete-permanently.test.tsx:429](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/tests/metadata-delete-permanently.test.tsx:429), [metadata-export-button.test.tsx:317](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/tests/metadata-export-button.test.tsx:317): tests did not prove why `keepMounted` was required. Added collapse/reopen coverage for Delete confirmation and an in-flight Export.

Checks:

- `npx vitest run tests/metadata-*.test.tsx`: exit 0 — 9 files, 183 tests passed.
- `npm run typecheck`: sandbox blocked `tsx` before checking (`listen EPERM` on its `/tmp` IPC socket). The equivalent `node --import tsx scripts/typecheck.ts` exited 0: all four projects passed and all 2,436 source files were covered.
- Biome and `git diff --check`: passed.

No security-map defence files were changed, and no wider findings remain.

Verdict: **APPROVE after fixes.**