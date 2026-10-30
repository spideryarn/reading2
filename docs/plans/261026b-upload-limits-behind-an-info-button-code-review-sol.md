Implemented the review fixes without committing or changing the index.

Findings:

- Fixed: pressing the new (i) incorrectly marked an older chosen file as the reader’s latest intent, potentially changing “Add” to “Add file.” Intent tracking now responds only to the File button. [AddArticle.tsx](/var/tmp/spideryarn-worktrees/fbkx8z6d-upload-small-print-tooltip/src/web/AddArticle.tsx:354)
- Fixed: File and its (i) were separate flex items and could wrap onto different lines in `UploadInstead`. They are now one non-shrinking inline group with sufficient tap-target spacing. [UploadPicker.tsx](/var/tmp/spideryarn-worktrees/fbkx8z6d-upload-small-print-tooltip/src/web/UploadPicker.tsx:308)
- Fixed: the tooltip test read the whole page, including the permanent `sr-only` copy, so it passed if the tooltip content disappeared. It now inspects the house tooltip directly, tests keyboard focus, touch-style press toggling, screen-reader association, tap-target class, grouping, and the intent regression. [test](/var/tmp/spideryarn-worktrees/fbkx8z6d-upload-small-print-tooltip/tests/upload-caps-are-stated-before-the-file-is-chosen.test.tsx:164)
- Fixed: stale descriptions in `UploadInstead`, the ingest reference, the original feedback report, and the postmortem now reflect the limits being behind the (i).
- Confirmed: `LimitsInfo` follows the house pattern—`Tooltip`, `usePressToggle`, keyboard focus, screen-reader description, and `.tap-target`. [UploadPicker.tsx](/var/tmp/spideryarn-worktrees/fbkx8z6d-upload-small-print-tooltip/src/web/UploadPicker.tsx:547)

Mutation checks proved the tests fail when the tooltip copy is removed and when the old intent-capture bug is restored.

Checks:

- Relevant Vitest suite: 4 files, 43 tests passed.
- Touched test: 6 tests passed.
- Biome lint: passed.
- `git diff --check`: passed.
- `npm run typecheck` was attempted twice but the sandbox denied `tsx` its IPC socket (`EPERM`). Running the same script without the CLI IPC layer—`node --import tsx scripts/typecheck.ts`—passed all projects and confirmed all 4,025 source files are covered.

No new wider decision arose. `ADDING_SENDS_TEXT_AWAY` remains visible; the existing question to Greg is still the only product decision outstanding.