The scoped fixes are uncommitted. The marker-binding defect remains unresolved because correcting it also requires updating five image marks.

1. **P2 — Reported:** [compress-screenshots.ts:143](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/compress-screenshots.ts:143) hashes only IDAT. A valid transparency change still passes. Hash the header and rendering data, then migrate the five existing marks; your image-edit restriction prevents that migration here.
2. **P2 — Fixed:** [compress-screenshots.ts:80](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/compress-screenshots.ts:80) accepted truncated, CRC-corrupt and structurally incomplete PNGs. Added framing, CRC, header, palette and terminal-IEND checks consistent with the [PNG specification](https://www.w3.org/TR/png-3/#5Chunk-layout).
3. **P1 — Fixed:** [compress-screenshots.ts:136](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/compress-screenshots.ts:136) could convert animation or 16-bit images destructively. Both now fail before pngquant runs.
4. **P1 — Fixed:** [compress-screenshots.ts:182](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/compress-screenshots.ts:182) accepted external paths and symlinks. Added checkout containment and symlink rejection, including dangling links.
5. **P2 — Fixed:** [compress-screenshots.ts:223](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/compress-screenshots.ts:223) used a predictable temporary name and lost permissions. Private temporary directories now preserve mode and clean up safely.
6. **P1 — Fixed:** [compress-screenshots.ts:228](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/compress-screenshots.ts:228) could overwrite a concurrent edit or accept bogus successful output. Added source-change and output-structure/dimension checks.
7. **P2 — Fixed:** [compress-screenshots.ts:193](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/compress-screenshots.ts:193) missed mixed-case extensions and hid filesystem errors. Selection now covers extension case variants; tests cover nesting, spaces, newlines, deleted files and untracked exclusions.
8. **P2 — Fixed:** [compress-screenshots.ts:252](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/compress-screenshots.ts:252) silently discarded unknown options, potentially turning a mistyped check into compression. Unknown options now fail.
9. **P2 — Fixed:** [screenshots-compressed.test.ts:59](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/tests/screenshots-compressed.test.ts:59) skipped broken installed pngquant executables. Only ENOENT now permits skipping.
10. **P2 — Fixed:** [browser-control.md:21](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/docs/project/browser-control.md:21) overstated unchanged text and gate coverage. Guidance now states lossy compression, advisory coverage and applicability to both machines.
11. **P1 — Reported, outside scope:** [overseer-scheduled-dispatch.test.ts:850](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/tests/overseer-scheduled-dispatch.test.ts:850) has two type errors from missing `attentionOffSinceRestart`.

Regression tests were observed failing before the corresponding fixes. Final focused run: **28 passed in 1.87 seconds**. Without pngquant: **25 passed, only three integration checks skipped**. File-backed subprocess capture also resolves this sandbox’s synchronous-pipe EPERM failure.

`npm run typecheck` was blocked by tsx’s IPC socket. Running the same checker through `node --import tsx` found only finding 11. Lint has one complexity advisory.

All 769 images retain dimensions; six decoded spot-checks found no meaningful alpha or colour-metadata loss. No images were rewritten.

**Verdict: changes requested until marker binding is corrected and typecheck passes.**