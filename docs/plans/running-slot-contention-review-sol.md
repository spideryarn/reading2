Verdict: PROCEED-WITH-CHANGES. The implementation is sound, but the tests do not pin several essential parts of the retry contract.

Findings:

- [P2] The tests never exercise the production defaults because every call passes `FAST`. Changing `ATTEMPTS` to `1` or `GAP_MS` to `0` would leave all five green. [running-slot.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/running-slot.test.ts:29)

- [P2] Nothing asserts that waiting actually happens. Removing the `setTimeout` would produce a tight contention loop while all five tests still pass. Use fake timers or spy on the delay. [running-slot.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/running-slot.ts:81)

- [P2] The “not contention” case uses `23502`. A regression to retrying every `23505`, regardless of constraint name, would pass. Add a `23505` carrying a third real constraint such as `jobs_draft_revision_unique` and assert one call. [running-slot.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/running-slot.test.ts:69)

Answers to the specific attacks:

1. Moving the loop does not change `load-article` behavior. IDs and tokens are still minted afresh inside every attempted insert. The successful job is returned before `body`, and the same ID reaches `finally`.

   However, the comment is wrong: deletion is not fenced on the token; it matches only `jobs.id`. That was already true before this refactor. [load-article.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/load-article.ts:234)

2. Moving `made.push(id)` after the insert is correct for an ordinary constraint failure: PostgreSQL statements are atomic, so that row was not inserted. It also avoids teardown deleting somebody else’s row after an unlikely ID collision.

   A lost connection after the server committed creates an ambiguous outcome, but the file’s `afterAll` also deletes its two fixture slugs, so normal teardown still catches it. [store-job-draft.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-job-draft.test.ts:113)

3. Retry versus advisory lock is a false choice. A shared test lock can serialize all cooperating test suites; the constraint retry remains necessary behind it for a dev server or ingest that does not cooperate. The lock gives test claimants orderly coordination; retry handles outsiders.

4. Yes, this change can increase parity failures. Previously, a losing suite exited quickly; now it eventually acquires and occupies the slot. Fixed 500ms polling offers no fairness, synchronizes contenders, and permits leapfrogging. It can therefore transfer failures to claimants that still treat contention as failure.

   Also, “20s” is not a wall-clock limit: there are 39 sleeps, plus query time, and an insert can itself block behind an uncommitted conflicting index tuple. A shared test lock is stronger than tuning this polling loop.

5. The options seam is acceptable in a test-only helper. The problem is not exposure; it is that the tests exclusively use the seam and therefore do not test the defaults.

6. The fake matches the installed Drizzle/pg shape: one `DrizzleQueryError` wrapper whose `cause` carries `code` and `constraint`. A real database test is unnecessary for that structural classifier. The missing cases are delay, defaults, and another `23505` constraint.

Verification: the five focused tests pass; Biome and `git diff --check` are clean. The current shared tree’s typecheck now fails only on unrelated uncommitted `src/notes.ts:229`, not these files. No files were edited.