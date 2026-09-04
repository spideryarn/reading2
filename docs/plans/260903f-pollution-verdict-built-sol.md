Verdict: do not commit T‑E yet. The two stage-B conversions look sound.

1. **Blocking — the non-forced DROP is no longer an atomic stranger detector.**

At [private-db-global.ts:423](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/private-db-global.ts:423), one of our surviving pools already guarantees that ordinary `DROP DATABASE` refuses. A stranger can arrive after the first sample, contribute nothing distinguishable to the already-expected refusal, leave before the re-read, and the run stays green because `seen` still contains ours and `ghostRefusal` is false.

The base-database re-read is correctly located, but it is still only another sample. To retain the atomic claim, terminate the specifically enumerated/tagged own backends before ordinary DROP; then SQLSTATE `55006` really does mean an unexpected client was present. Otherwise document this as two samples, not an atomic backstop.

2. **Blocking — DROP failures and cleanup failures can be green.**

[dropStaleTestDatabase:1146](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-test-create.ts:1146) converts every error—not only `55006`—into `{ dropped: false }`. If the initial sample contains ours, a permission/network/internal DROP error produces `ghostRefusal: false`, no strangers, and therefore a green run. Worse, failure of the forced cleanup at [private-db-global.ts:468](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/private-db-global.ts:468) only prints that the database leaked; it does not set `exitCode`.

Return a discriminated result such as `dropped | in-use | failed`. Only `in-use` belongs in occupant classification; any other ordinary-DROP failure, failed lease close, failed re-read needed for classification, or failed forced cleanup must fail the run as teardown failure—not necessarily `POLLUTED`.

3. **Advisory — the PID tag is collision-resistant, not identity.**

For two cooperative concurrent runs on this host, the client PID is enough: live host PIDs differ, and each database is separately minted. It is not enough against spoofing; `application_name` is client-controlled, so a process using the observed tag is misfiled as ours.

A random nonce improves accidental collision resistance but remains observable and spoofable. Server-side attribution requires a per-run login role/credential and CONNECT ACL; even that is not an adversarial boundary while every worktree retains the same superuser credential. For this trusted local diagnostic, keep the PID design but state that assumption plainly.

4. **Advisory — production pool naming is operationally safe, with two wording defects.**

No functional query behavior depends on the name, and using it through a transaction pooler should not break queries. Because transaction pooling shares backend connections, do not promise that the logical client name remains attributable end-to-end remotely; this feature’s useful target is the direct local stack. [Supabase documents that transaction mode shares database connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

`basename(process.cwd())` is visible in `pg_stat_activity` and may enter database logs; it is not reader-visible, but an arbitrary directory name cannot honestly be promised nonsensitive. PostgreSQL also restricts `application_name` to printable ASCII and less than `NAMEDATALEN`; non-ASCII is escaped. Therefore `.slice(0, 63)` is a UTF-16-character cut, not the claimed byte/encoded cut. Sanitize to printable ASCII and byte-bound it, or soften the claim. [PostgreSQL application-name documentation](https://www.postgresql.org/docs/current/runtime-config-logging.html#GUC-APPLICATION-NAME).

5. **Advisory — the informational line should remain non-failing.**

Failing roughly 29 otherwise-clean suites would create exactly the routinely noisy gate the repo rejects. Vitest destroys the worker afterwards, so this is bounded hygiene, not cross-run pollution.

The message at [private-db-global.ts:265](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/private-db-global.ts:265) overstates what was proved: the tag identifies this run’s connection, not necessarily a `getDb()` pool or a file lacking `closeDb()`. Say “tagged connection(s) remained” rather than diagnosing the cause.

6. **Advisory — shared diagnostics should print the exact current tag.**

[shared-db.ts:187](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/shared-db.ts:187) says this run’s sessions match `spideryarn-test-shared-*`, but every concurrent run matches that wildcard. Print the current worker’s exact `PGAPPNAME`; the per-session names then make peers distinguishable.

7. **Stage B — fine, with mutation-evidence caveats.**

- [chat-anchor-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/chat-anchor-route.test.ts) preserves every prior route assertion. Its Postgres seeding and owner-scoped read-back strengthen it; the per-test thread deletion is equivalent to the old full-directory reseed because these cases do not mutate the article. `anchorQuote → null` is a valid persistence mutation. Advisory: deleting the route’s `checkAnchor` call is the mutation most directly aligned with the conversion’s stated reason—it should turn the foreign-block case from 400 into 500.
- [owner-jobs.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/owner-jobs.test.ts) still tests all public ownership outcomes, with no weaker assertion. Deleting `list`’s owner predicate is valid but proves only list isolation; `get`, `claim/getIn`, and `forget` have separate SQL predicates. That is an evidence gap, not a current behavior hole. The only coverage tradeoff is that the suite can now skip without Postgres, deliberately and visibly.

Decoration: the long incident histories repeated across code comments, `testing.md`, and the plan should be reduced to one owning account plus links—especially the `health`/`billing-tiers` `afterAll` comments. The cleanup calls themselves are fine. Also exclude the unrelated untracked [scripts/stage.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/stage.ts) from this commit.

Checks: test TypeScript, scoped Biome lint, and `git diff --check` passed. The targeted Vitest run could not reach the local database from this review sandbox (`EPERM`), so it collected no useful runtime evidence. No files changed.