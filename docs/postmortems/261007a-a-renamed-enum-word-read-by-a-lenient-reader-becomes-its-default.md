# A renamed enum word, read by a lenient reader, becomes its default

From 2026-10-06 the readiness loop on the box went red on every run at
`tests/store-roundtrip.test.ts` > *noema-mythology-of-conscious-ai* > *preserves chat.json
exactly*: `expected { threads: [ …(22) ] } to deeply equal { threads: [ …(22) ] }`. **Nothing
reached a reader.** The reader that did it, `loadThreads` in src/chat.ts, has one caller, the test
helper `tests/helpers/seed-reader-state.ts`, and the deploy gate never saw the file it tripped on.

## What happened

The full diff was two lines, both `- "kind": "remember"` / `+ "kind": "chat"`. The primary
checkout's gitignored `data/noema-mythology-of-conscious-ai/chat.json` was written by hand on
2026-09-01 and held two Recall threads with `kind: "remember"`. On 2026-10-06
[`8c36c5caa`](../plans/261006a-remember-identifiers-become-learn-all-the-way-down.md) renamed that
kind to `learn`: the database by migration
(`drizzle/20261006035355_rename_remember_thread_kind_to_learn.sql`), and the committed fixture
`tests/fixtures/data-root/data/writes/chat.json` by hand. Nothing migrated this file. Its reader,
`normaliseKind`, turned any word outside `THREAD_KINDS` into `"chat"` — written on 2026-08-28 in
`2dd631197`, for files that predate the field. So the two Recall threads were seeded into Postgres
as chats, exported as chats, and compared against `remember`.

Fixing the word exposed a second staleness under it: the same file has **two** Recall threads, which
`46e9f57a1` (2026-10-01, `drizzle/20261001143901_remember_one_thread.sql`) made illegal and folded in
the database. The seed then fails on `chat_threads_one_learn`. So this test was very probably red in
the primary from 2026-10-01, with a duplicate-key error; the rename changed the symptom rather than
starting the failure. Readiness records only name failing files since 261006m, so this cannot be
confirmed from the record.

## The class: a renamed enum word read by a lenient reader becomes its default

A value renamed by migration is renamed wherever the migration reaches. Anywhere it does not — a file
on disk, an export, a worktree's copy, a tab left open — still holds the old word, and a reader that
answers "a word I don't know" with the default turns that old word into the default. It is
[silent success](../reusable/silent-success.md): nothing throws, the value has the right type, and
the wrong answer is a legitimate one. The `kind` field was introduced precisely so that a Learn thread
could not quietly become a chat, and the reader of it was written to do exactly that.

The siblings had already been found. The day before, 261006a stage 0 stopped both Postgres readers
(`src/store/pg-chat.ts`, `src/store/export.ts`) coercing, with `storedThreadKind`. This file reader
was looked at and kept lenient, on the grounds that an absent kind is a real old state — true, but
that argument covers *absent*, not *unknown*, and the two were one branch.

## Why nothing went red where it mattered

- **The deploy gate** builds a throwaway worktree and copies `data/` from the committed fixture
  corpus (`GATE_FIXTURE_ROOT`, scripts/deploy.ts). In that corpus, noema has no `chat.json`, and the
  one that exists (`writes`) had been hand-updated to `learn`. The copy is performed by
  `materialiseCorpus` in scripts/corpus-materialise.ts, called from scripts/deploy.ts.
  So *preserves chat.json exactly* read
  an absent file for noema and passed — correctly, for the data it had. The readiness loop runs in
  the primary, whose `data/` is a larger, hand-kept laptop copy. Same test, different corpus.
- **The plan saw the class and named the wrong instance.** 261006a's notes say a worktree's stale
  `data/writes/chat.json` reads back as `chat` and fails this exact test "until the file is copied
  again". That is the bug, written down as a chore; the default stayed
  ([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)).
- **`normaliseKind` had no test of its own** for an unknown word; the only check was a whole-corpus
  comparison that depends on what happens to be in `data/`.

## What would have caught it, ranked by ease against value

1. **Refuse an unknown word; map a retired one explicitly.** Done: `kindFromFile` in src/chat.ts
   answers absent with `chat`, a word in `RETIRED_THREAD_KINDS` (src/types.ts — `review`,
   `remember` → `learn`) with what it became, and anything else with an error, with
   tests/chat-kind-from-file.test.ts asserting all three. A rename that forgets to add its old word
   now fails loudly on the first stale file instead of rewriting it.
2. **A rename by migration adds its old word to the readers the migration cannot reach**, in the same
   commit — stated in `RETIRED_THREAD_KINDS`' own comment, where the next rename will look.
3. **Bring stale working data up to date when a migration changes its shape.** Done by hand for the
   one file: the later Recall thread (`spya-rdcz32`, an agent's two-message browser check) folded into
   the earliest exactly as `20261001143901` folds (its messages appended, the keeper's `updatedAt`
   raised to the later one), then renamed. A script that runs every data migration over `data/` was
   considered and rejected: `data/` is a fixture source on one machine, and this is the third
   hand-migration of one file in five weeks, not a recurring cost.
4. Make the deploy gate run on the primary's `data/` — rejected. The gate is reproducible precisely
   because it uses the committed corpus; the gap was a lenient reader, not which corpus ran.

## The fix that is right for the long term

The fix for the kind is no default for an unknown word. The fold was applied to the file
rather than taught to the seed helper, because only one file has ever had two Recall threads and
folding is a page of SQL to mirror for it. If a second appears, `seedChatFromFiles` refusing it with a
unique-index error is already the loud outcome.

## The thing I would tell myself

When you stop one reader coercing an unknown value, ask of every other reader of the same field
whether its leniency is for *absent* or for *unknown*. They read the same in code, as one `?:`, and
only one of them is a real old state.
