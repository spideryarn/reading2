1. **P1 — [AddPage.tsx](/var/tmp/spideryarn-worktrees/fbwc4vku-dictation-on-add-page/src/web/AddPage.tsx:2343):** A microphone start or transcription retry batched with a public-copy answer could unmount the box before its layout effect reported busy. Fixed by reporting busy synchronously at the press; the layout effect corrects refused starts. Added regressions for both paths.

2. **P2 — [prose-boxes-have-a-microphone.test.ts](/var/tmp/spideryarn-worktrees/fbwc4vku-dictation-on-add-page/tests/prose-boxes-have-a-microphone.test.ts:75):** The line-based ratchet missed inline textareas, could count microphone names in comments, and allowed a second textarea to borrow its component’s first microphone. Replaced it with TSX syntax-tree inspection and an ambiguity guard.

Tests: 4 files passed, 167 tests passed.

Typecheck: `npm run typecheck` was blocked by sandbox IPC permissions (`listen EPERM /tmp/tsx-1000/14.pipe`). The equivalent `node --import tsx scripts/typecheck.ts` passed all four projects and confirmed all 3,863 source files are covered.

Verdict: **ship with the fixes above**.