# Code review: compressed screenshots (stage C)

You are reviewing commit `defb5197b` in this worktree (`git show defb5197b`), and the six image
commits before it (`git log --oneline -8`), built from the plan
`docs/plans/261007j-box-followups-tmp-age-overseer-unit-png-compression.md` § 3, which you reviewed
before it was built (`docs/plans/261007j-box-followups-plan-review-sol.md`, findings 4, 8, 9, 10).

**Fix what you find inside `scripts/compress-screenshots.ts`, `tests/screenshots-compressed.test.ts`
and `docs/project/browser-control.md`**, narrowly, each fix red-first with a test that reproduces it.
**Report, do not fix,** anything wider. Another reviewer is working on the rest of this worktree at
the same time: do not edit any other file, and do not recompress or rewrite any image under `docs/`.
Do not commit.

Context: the script was run once with no arguments; it compressed 764 tracked PNGs and marked 5 as
tried (pngquant exit 98), 135 MB to 53 MB, and those were committed by name in six batches. The
caller checked 3x crops of light text, grey-on-near-black text and dark article text by eye: no
visible difference. pngquant is 2.18.0. Node is v26.

Look hardest at:

1. Can `needsCompression` pass a file that is not compressed, or refuse one that is? The PNG chunk
   walk (truncated files, a CRC it does not check, an APNG, a 16-bit or grey image, a palette image
   that is enormous), the mark's binding to the IDAT data, and a mark spoofed by copying.
2. `compressOne`: atomicity, the temporary file's name and clean-up, a symlink or a path outside the
   repo given by name, exit codes other than 0/98/99, and what happens to file mode.
3. `docsPngs`: does `git ls-files --cached -- 'docs/*.png'` match exactly the files meant (nested
   folders, upper-case extension, a deleted-but-indexed file, a path with spaces or newlines)?
4. The test: is it fast enough to sit in `npm test`, and can it be skipped silently where it should
   fail (no pngquant: only the `compressOne` block should skip)?
5. Whether any of the 769 committed images lost something they should not have: spot-check a few
   with `git show <commit>^:<path>` against the new bytes (dimensions equal, no colour type or alpha
   lost where it mattered).

Run `npx vitest run tests/screenshots-compressed.test.ts` and `npm run typecheck` after any fix.
Number each finding, give it P0/P1/P2, file and line, and say fixed or reported. End with a one-line
verdict.
