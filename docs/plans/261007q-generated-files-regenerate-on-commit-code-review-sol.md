Fixed the following, ranked by severity:

1. **P1 — Approval could turn an appended path into a shell command.** Trailing `;` or `&&` was discarded by parsing. Strict approval now rejects both, pathspec magic such as `git add -- :/`, amendment, hook bypass, and ambiguous `cd …/..`.

2. **P1 — Directory coverage admitted untracked peer sources.** Reproduced a successful commit containing a generated entry for a note Git omitted. The guard now checks actual Git membership.

3. **P1 — Hidden source edits escaped the guard.** `assume-unchanged` let unfinished peer bytes enter generated output. The hook now refuses hiding index flags, symlinks and special files, and checks ignored inputs.

4. **P1 — The second generator could invalidate the first recheck.** Added a final source/output fingerprint check across every successful set.

5. **P2 — Direct dependencies were missing.** Added the Help token/label sources and feedback generator’s directly imported helpers.

**One wider P2 remains:** generators write in place. If a generator writes and then fails, an output already named by the original commit can still be committed. I reproduced this: the hook said “did not add,” while the commit carried `PARTIAL OUTPUT`. Temporary-output support in both generators would fix it; those files are outside your authorized scope. This decision is recorded in the [plan](/var/tmp/spideryarn-worktrees/generated-files-fresh/docs/plans/261007q-generated-files-regenerate-on-commit.md:129).

Validation: regeneration **59/59**, PNG **74/74**, focused tests **74 passed**, and underlying typecheck passed. New boundary, membership and concurrency regressions were observed failing before their fixes. No PNG behavior regression found. Full `npm test` was blocked by sandbox access to the local database.

This worktree’s index and HEAD were unchanged.