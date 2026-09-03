## P0

None.

## P1

- **The resolution advice is unsafe and contradicts the existing runbook.** [migration-ledger.ts](/home/greg/code/spideryarn2/scripts/migration-ledger.ts:662) and [database.md](/home/greg/code/spideryarn2/docs/project/database.md:584) say to always keep both entries. But the common unpublished/generated fork repair explicitly deletes and regenerates the losing migration and its journal entry; handling also differs for custom, already-applied, and published migrations ([database.md](/home/greg/code/spideryarn2/docs/project/database.md:712)). The final journal should contain exactly one entry for each migration that survives the whole-folder reconciliation—not necessarily both original entries.

- **The advice can create a permanent timestamp inversion.** Git presents “ours” then “theirs,” not chronological order. Concatenating both sides and merely renumbering `idx` can place `when: 300` before `when: 200`. Drizzle compares every migration against the database watermark read before the loop, so a database already at 300 will silently skip 200 forever. The repo already says “Keep both, in `when` order” ([database.md](/home/greg/code/spideryarn2/docs/project/database.md:723)). Preserve timestamps, but merge the newly divergent suffix in increasing `when` order. Do not globally sort: the published 0035/0036 inversion is intentionally grandfathered.

- **Resolving only the journal may conceal the more dangerous snapshot fork.** Parallel generation produces two snapshots with the same parent, and Git merges those separate files without a conflict. The existing runbook explains how this later causes re-emitted DDL ([database.md](/home/greg/code/spideryarn2/docs/project/database.md:728)). The diagnostic should say not to migrate until the whole migration fork has been reconciled and `npm run db:chain` passes.

- **`db:generate` swallows the new diagnostic.** Its `readFolder` catches every `readJournal` exception and treats it as the legitimate no-journal-yet state ([db-generate.ts](/home/greg/code/spideryarn2/scripts/db-generate.ts:117)). Generation will still be refused by Drizzle’s generic check, but the filename/line/marker/advice—the purpose of this change—is lost. Catch only the missing-file case and rethrow malformed/conflicted journals.

- **The regex only recognizes exactly seven characters.** Git supports configurable conflict-marker lengths, so both longer and shorter markers can evade it; an eighth `<` prevents the current match. It also omits diff3/zdiff3’s `||||||| base` marker. A complete diff3 conflict is still caught through its other markers, but a partially resolved file containing only the base marker is not. Git documents both [`conflict-marker-size`](https://git-scm.com/docs/gitattributes#_conflict_marker_size) and [diff3/zdiff3 markers](https://git-scm.com/docs/git-merge/2.50.0.html#_how_conflicts_are_presented).

  At minimum, use `{7,}` and include `\|{7,}`. Supporting Git’s complete configurable range requires accepting shorter markers too.

## P2

- **The tests permit a much weaker implementation.** [migration-journal.test.ts](/home/greg/code/spideryarn2/tests/migration-journal.test.ts:249) exercises only a complete, LF, seven-character conflict beginning with the literal `<<<<<<< HEAD`. An implementation special-casing that exact text would pass. Missing cases include isolated opener/separator/closer/base markers, non-seven lengths, CRLF, exact line number, and the promised repair guidance.

- **The “leads with” assertion is effectively vacuous.** At [migration-journal.test.ts](/home/greg/code/spideryarn2/tests/migration-journal.test.ts:268), once `toContain("<<<<<<< HEAD")` passes, the comparison is automatically true whenever the message lacks the literal word `position`. The marker could appear at the very end or after an offset phrased as “byte 8151.” Assert that the first line contains `line 5 begins \`<<<<<<< HEAD\`` and separately reject a leading parser-offset diagnostic.

- **The literal test fixture itself trips Git’s conflict-marker detector.** `git diff --check` reports three “leftover conflict marker” errors at [migration-journal.test.ts](/home/greg/code/spideryarn2/tests/migration-journal.test.ts:253). Construct markers with `"<".repeat(7)`, etc.

- **CRLF detection works, but the displayed marker retains `\r`.** JavaScript’s multiline `$` matches before the CRLF terminator, so standard CRLF conflicts are detected. However, [migration-ledger.ts](/home/greg/code/spideryarn2/scripts/migration-ledger.ts:659) splits only on `\n`, leaving a carriage return in the quoted line.

- **A legitimate—but very unusual—journal can false-positive.** JavaScript treats U+2028/U+2029 as multiline boundaries, while JSON permits them literally inside strings. Drizzle passes migration names into `tag` without sanitizing them, so a valid tag containing `U+2028 + "<<<<<<< HEAD"` matches this regex. Iterating physical CR/LF-delimited lines avoids that corner case.

- **The docs overstate coverage.** “Containing a conflict marker” is false for non-seven markers and a remaining diff3 base marker. “The first command tells you” is false for `db:generate`; `db:chain` invokes Drizzle directly, and deployment also parses the journal independently at [deploy.ts](/home/greg/code/spideryarn2/scripts/deploy.ts:807).

## Placement verdict

`readJournal` is the right primitive for a journal-specific diagnostic: ordinary raw conflict markers already make `JSON.parse` fail, so no caller benefits from receiving the parser error instead. Fix the broad catch in `db:generate`.

A fatal scan of the whole `drizzle/` folder would be scope creep here and could be wrong: `db:migrate` deliberately treats snapshot defects as warnings because snapshots are irrelevant to applying SQL. Any broader SQL/snapshot conflict check should be a separate consumer-specific preflight.

Safer message wording would be along these lines:

> Preserve both sides until the migration fork is understood. The final journal must contain one entry for every surviving `.sql` migration. Keep existing `when` values unchanged, merge newly surviving entries in increasing `when` order, and renumber `idx`. Reconcile the snapshot chain and run `npm run db:chain` before migrating. See “Repairing a fork” in `docs/project/database.md`.