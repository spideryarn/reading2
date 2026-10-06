# Code review: 261006a stage 1, Remember's identifiers become `learn`

You are reviewing **and fixing**. Work in /var/tmp/spideryarn-worktrees/learn-rename only.

**Candidate:** commit 8c36c5caa (the whole rename), with da4082a8f on top (a merge of origin/dev
whose one conflict was the plan file). `git show 8c36c5caa --stat` is the complete path list: 283
paths. Nothing is uncommitted. Do not review the other files the merge brought in.

**What it is.** The plan is
docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md; read § The table, § What
keeps the old word, § After the plan review (your eight findings and what was done with each) and
§ What landed. Your plan review is docs/plans/261006a-plan-review-sol.md. Stage 0 (an unknown
stored kind refuses with a 409) is already on dev and was reviewed separately; it is not in scope
except where the rename interacts with it.

**Where to start (does not limit scope):**
drizzle/20261006005914_rename_remember_thread_kind_to_learn.sql and its snapshot;
src/db/schema.ts (chat_threads); src/types.ts (ThreadKind, THREAD_KINDS); src/modes.ts
(MODES, RETIRED_MODES); src/web/last-view.ts; src/web/params.ts; src/web/thread-source.ts;
src/chat.ts; src/routes.ts; src/store/pg-chat.ts; src/web/sub-modes.ts; src/web/command-match.ts;
src/mode-catalog.ts; src/command-pick-catalogue.generated.json; evals/stored-result.ts;
evals/command-pick/phrases.ts; tests/learn-kind-migration.test.ts; tests/learn-name.test.ts;
tests/learn-one-thread-migration.test.ts; tests/stored-eval-results.test.ts.

**Independent pass first.** This is a rename of about 1,600 lines done partly by script, so the
likely defects are of four kinds, and I would like each hunted:

1. **A string that had to move and did not, or moved and should not have.** A `"remember"` /
   `'remember'` value, a CSS class in a stylesheet but not in the markup (or the reverse), a nuqs
   key, a `data-` attribute, a test id, a storage value, an analytics field, an id inside a prompt,
   a key in a `Record<Mode, …>` satisfied by a cast. Conversely an English verb, a reader's search
   word, a frozen fixture, or a dated statement that was rewritten into something false. Run your
   own `git grep -i remember` over src tests evals scripts package.json and read what is left.
2. **The migration.** Anything that loses, mislabels or orphans a row; fails only where there is
   history; or leaves drizzle's snapshot disagreeing with the schema.
3. **The old-link rules.** `?mode=remember` must open Learn everywhere a mode word is read (client,
   server tab title, Dock, Help anchor, feedback payload) and must never be stored and replayed by
   last-view.ts; an old `?remember=quiz` link must not be overridden by a stored view.
4. **Docs made false.** Present-tense statements under docs/project that the rename contradicts,
   and `file § symbol` citations (tests/doc-links.test.ts checks those; it is green).

**Fix what you find inside this stage, narrowly, and red first where it is behaviour**: write the
failing test, see it fail, fix. Report, do not fix, anything wider. Do not touch docs/plans except
to write your answer; in other docs change only what the rename makes false. Do not write any
sentence attributed to Greg, and do not alter one that is. Do not run `npm run db:migrate`,
`db:reset`, or anything against a remote. Do not commit.

**You have no network, not even loopback**, so you cannot run Postgres tests. Run the unit tests
you touch yourself (`npx vitest run <file>`); these are my raw results on da4082a8f:

```
npm run typecheck                                  clean, 4 projects
tests/learn-kind-migration.test.ts                 4 passed   (private Postgres lane)
tests/learn-one-thread-migration.test.ts           3 passed   (private Postgres lane)
tests/unknown-thread-kind-refuses-cleanly.test.ts  5 passed
tests/unknown-stored-thread-kind.test.ts           3 passed
doc-links, learn-name, store-migration-registry, command-pick-catalogue   54 passed, 2 skipped
full suite on 8c36c5caa before the merge: 1690 files passed, 8 failed —
  learn-kind-migration (3, fixed since: the shared lane database held other suites' committed
  learn rows; green alone and beside six chat suites, NOT yet re-proven in a full run),
  knip-without-build-output (the new .sql was untracked; green since),
  doc-links (dated docs' link targets; repointed since, green),
  five files that need `npm run build` output this worktree does not have.
mutations: raw-word filter in last-view -> 2 red; UPDATE removed from the migration -> 4 red;
  "remember" removed from NEVER_REMEMBERED -> 4 red.
```

**Severity scale (by consequence):** P0 data loss, exploitable security, incorrect charging, or
the service broadly unusable. P1 user-visible wrong behaviour, or an authoritative contract
violated. P2 design or maintainability risk with no wrong behaviour today. P3 prose or comment
defect. ID every finding (CR-1 …); say established or suspected; file and symbol; whether you
fixed it and how. End with a verdict, and a list of every file you changed.

**Accepted already, do not re-litigate:** no wire alias for `kind: "remember"` (a stale tab gets a
400 until reload); `?remember=<view>`, `?chatfrom=remember` and the stored last-view pair are not
carried over; the placeholder thread title "Remembering" stays (261005l decided it); results
under evals/results keep their names; the picker's ids changed without a re-measure yet (a bounded
eval run is the next stage, PR-8).

## My suspicions (mine, worth less; spend most of the run elsewhere)

1. tests/learn-kind-migration.test.ts rewrites other suites' `learn` rows to `remember` inside its
   rolled-back transaction so it can restore the old CHECK. Does it hold a lock that makes
   parallel chat suites in the same lane database time out or deadlock?
2. tests/fixtures/data-root/data/writes/chat.json was edited by hand rather than regenerated.
3. `ChatDrafts.learn()` / `setLearn()` and a boolean named `learn` in ChatPanel.tsx: do the names
   still read correctly, and does any persisted draft key change with them?
4. Two reader-visible strings are built from the kind and now say "learn" in lower case
   ("A learn conversation is about the whole article…", "kind must be chat or learn"). The first
   may be reader-facing copy that should say "Learn".
5. The link targets of 42 dated docs were repointed by a regex over `](…)`; a target inside a code
   span or an HTML href would have been missed, and doc-links may not check those.
