---
id: q-swc9st
report: none
status: answered
asked: 2026-10-31
title: [Q-migration-guard] How should we stop a migration being edited after the box's shared database has run it?
refs: session fix-local-ledger-sources-digest · docs/postmortems/261031a-a-migration-edited-after-the-shared-database-ran-it.md · drizzle/20261030220450_chat_thread_origin_sources_digest_and_summary.sql · tests/store-migration-registry.ts · qi-z8xp4m8x · docs/plans/261031e-a-test-that-the-shared-database-never-ran-a-different-version-of-a-migration-file.md
acted: spya-fpdjgq
---
How should we guard against a database migration being edited after the box's shared local database has already run it? That stopped the readiness checks for about five hours this morning.

A. A test (recommended). Each npm run compares the shared database's record of applied migrations with the files and fails with "this migration has already run on the shared database; write a new one". The author would see it on their next test run, in their own tree. It costs one test, and it is a test that reads the shared database rather than a private one, which is new for the suite.

B. A sentence in database.md: "a migration has run once any tree on the box has migrated, so a review fix to one is a new migration." It costs nothing, but prose erodes, and nothing enforces it. Its wording is a rule-doc edit, so it needs your yes as written here.

C. Both A and B.

D. Nothing more. This is the first time in two months, and the fix took one row.

Recommended: C. The test catches it; the sentence says why.

Details

What happened. The Sources digest work added a migration at 00:27 on 31 October. One of the session's own test runs applied it to the box's one shared local database. At 02:37 GPT Sol's review edited the same file. From then on, every tool that migrates the local database refused, saying the file no longer matched what had run. That included the readiness loop, which checks each dev commit before a deploy. No commit was checked from 05:40 to about 09:40.

Production was never affected: it only ever got the final file, and its record matches (checked read-only).

The fix. A one-row correction to the local database's record. That was safe only because the edit changed no schema statements. A session fixed it and the loop is running again. The full write-up is the postmortem in refs.

Why not a git rule that refuses edits to migration files: the obvious version would not have caught this, because the file had not reached dev yet when it was edited. A stricter version would also forbid revising a migration nobody has run.

Greg's reply, 2026-10-31 (spya-fpdjgq):

> Use your judgment.

Acted on 2026-10-31 (queue item qi-z8xp4m8x): C, after consulting Opus and GPT Sol, who both
agreed. The test is `tests/migration-shared-ledger.test.ts`, in the shared-services lane. It reads
the shared database's ledger on every `npm test` and fails, in the author's own tree, on any of
the tree's migration files that the database ran in a different form. It was watched going red on
a reproduction of the 261031a edit. B's sentence is in database.md § Rule 4, word for word as
above. Plan: docs/plans/261031e-a-test-that-the-shared-database-never-ran-a-different-version-of-a-migration-file.md.
