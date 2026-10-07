Checked all five commits, the current script and tests, and the plan sections. No files changed; no database access or tests run.

**D1 — closed with a residue.** [The hook](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:656) locks identities and checkpoints before the proof and comparison, inside `destroy`’s transaction through deletion. Both interleavings are closed:

- An earlier checkpoint update must finish before the lock is granted; the comparison then catches it. A later update cannot commit before deletion.
- An earlier reading-time insert holds the identity’s key-share lock; the hook waits, then the proof sees the committed row and refuses. A later insert waits behind the identity lock and fails after deletion.

Checking the schema and supplied production foreign-key inventory found **no third admissible cascade table left unprotected**. Other article children must be empty by the proof; revision descendants require a refused revision, and `chat_messages` require a refused `chat_threads` row. `reading_time` is the only identity child using cascade.

The deadlock safety reasoning holds: unordered multi-row writers can form a cycle; aborting `destroy` rolls back that article and stops the run, while aborting the writer leaves none of its writes committed. Earlier article deletions remain committed and can use D3’s subset restore. The residue is wording: [§ 5](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/docs/plans/261007f-tidy-the-never-published-production-articles.md:312) promises abortion “within” one second, but `deadlock_timeout` controls when checking begins, not a completion deadline. [PostgreSQL documentation](https://www.postgresql.org/docs/current/runtime-config-locks.html#GUC-DEADLOCK-TIMEOUT)

**D2 — closed.** [All three tables](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:157) feed `readerRowsOf`, used by both the survey and `proveEligible`, including the final proof under the locks. Any attached row refuses eligibility, regardless of age.

**D3 — closed.** [restoreBackup](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:563) validates the subset and uses [backupOf](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:438)’s single set for articles, identities, checkpoints and ledger links. Presence checking applies to the selected articles; selecting a present article refuses before writing.

**D4 — closed with a residue.** The command path enforces source identity, file consistency and the remote `--ids` requirement before writes: [readBackup](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:510) → [main’s restore branch](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:849) → `restoreBackup`, which compares the target identity inside its transaction.

One literal manifest-check residue: sorted ids are compared using `.join()`. Header `[“UUID-A,UUID-B”]` compares equal to article-row ids `[“UUID-A”, “UUID-B”]`. Compare the sorted arrays with `isDeepStrictEqual` instead. This does **not** bypass production’s independently parsed UUID subset, and script-generated backups contain valid individual UUIDs.

The exported `restoreBackup` helper also trusts its supplied object and can bypass file validation and remote pinning if called directly; its only repository caller is the checked command path.

**safe to run under the plan’s conditions**