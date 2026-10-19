1. **Low — registry DOI values could still carry U+0000** in [src/bibliographic.ts](/var/tmp/spideryarn-worktrees/fbu5azdm-pdf-import-22021/src/bibliographic.ts:384). `normaliseDoi` bypassed the prose cleaner, and its DOI regex accepted NUL. I now clean controls before validation and added Crossref/DataCite regressions in [tests/bibliographic.test.ts](/var/tmp/spideryarn-worktrees/fbu5azdm-pdf-import-22021/tests/bibliographic.test.ts:289).

2. **Low — identity and scoring behavior lacked direct regression coverage.** I added tests proving that cached dirty readings are cleaned once without another reader call or checkpoint write, `stripped` remains `1` across replays, and clean readings preserve identity in [tests/pdf-integrity.test.ts](/var/tmp/spideryarn-worktrees/fbu5azdm-pdf-import-22021/tests/pdf-integrity.test.ts:142). I also added a scoring test showing pass0 and transcription controls become spaces consistently in [tests/pdf-score.test.ts](/var/tmp/spideryarn-worktrees/fbu5azdm-pdf-import-22021/tests/pdf-score.test.ts:43). The phase-two identity check is safe: the cleaned value has already become `item.reading`; only recovery subsequently changes that reference. Usage accounting occurs before cleaning.

3. **Low — checkpoint NUL detection needed stronger proof, not an implementation change.** The regex in [src/store/checkpoints.ts](/var/tmp/spideryarn-worktrees/fbu5azdm-pdf-import-22021/src/store/checkpoints.ts:409) correctly recognizes JSON’s odd backslash runs for real NULs while accepting literal `\u0000` text. I added cases with zero, one, and two source backslashes in [tests/store-checkpoints.test.ts](/var/tmp/spideryarn-worktrees/fbu5azdm-pdf-import-22021/tests/store-checkpoints.test.ts:422).

I found no other open U+0000 path from PDF-derived foreign text into a Postgres text/jsonb column. Pass0, first-page text, front-page records, PDF Info titles, transcription scoring, model metadata, and registry metadata now share cleaned inputs. Raw figure-recovery text is used only for layout matching and is not persisted.

Checks:

- Seven non-database requested test files passed: **235 tests**.
- The combined command including `tests/store-checkpoints.test.ts` could not start because the sandbox denied access to local Postgres at `127.0.0.1:54362`. A direct checkpoint serialization probe passed.
- `npm run typecheck` was blocked by the sandbox denying tsx’s `/tmp` IPC socket; the equivalent `node --import tsx scripts/typecheck.ts` completed successfully for all **3,841** source files.
- Touched-file lint and `git diff HEAD --check` passed.
- No commit or git-state change was made.

VERDICT: SHIP AFTER MY FIXES