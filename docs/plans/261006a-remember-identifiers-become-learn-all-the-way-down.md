# Remember's identifiers become `learn`, all the way down

Queue item **qi-dabpymjd**, the deferred half of spya-mvmpks. Plan
[261005l](261005l-remember-becomes-learn-and-explore-covers-critiques.md) renamed the mode on
screen: every word a reader or a model sees says Learn. The code, the URL, the database and the
docs still say `remember`. This plan renames those, so a grep finds one name.

Greg approved it, 2026-10-06, and the same words are now the rule in
[rename-or-move.md § A rename on screen is a rename all the way down](../reusable/rename-or-move.md):

> Yes, when we rename something in the UI, we should always do a deeper rename ... Don't worry about
> breaking links (e.g. to ?mode=remember) - or add an alias if it's minimal hassle.

The Overseer's brief settles the one question 261005l left for Greg: the stored thread kind is
renamed too, `'remember'` → `'learn'`, by an ordinary migration.

## What the sweep found (2026-10-06)

A Sonnet subagent listed every line containing the stem `remember` outside the dated folders and
classed each. In `src/`: 631 lines name the mode, 521 are the English verb, 47 are history. In
`tests/`: about 975 name the mode. The facts the design rests on:

- **Postgres stores the word in one place**: `chat_threads.kind`, with the CHECK
  `chat_threads_kind` and the unique index `chat_threads_one_remember`. It is not a cost category,
  a job, a step, a log field or a Sentry tag. A Learn turn bills as the `chat` job.
- **No API path contains it.** The kind travels as the body field `kind` on `POST /api/chat`.
- **The browser stores it in one place**: `spya.lastView.<slug>` keeps the pair `remember=<view>`
  (the sub-mode a reader last chose). `mode=remember` is never stored; `NEEDS_AN_EXPLICIT_PRESS`
  drops it.
- **A model sees the identifier in one place**: the command bar's picker and suggester are sent the
  ids `mode:remember` and `submode:remember:<view>` from
  `src/command-pick-catalogue.generated.json`, and answer with them.
- `tools/`, `infra/`, `experiments/` and `scripts/` (bar one line) use only the English verb.

## The table

| What | From | To |
|---|---|---|
| Mode id, `?mode=` value | `remember` | `learn` |
| Sub-mode parameter | `?remember=recall\|tutorial\|explore\|quiz` | `?learn=…` |
| Chat's source filter | `?chatfrom=remember` | `?chatfrom=learn` |
| Thread kind (TS union, wire value, rows, CHECK) | `'remember'` | `'learn'` |
| Unique index | `chat_threads_one_remember` | `chat_threads_one_learn` |
| Types, components, functions, constants that name the mode | `RememberView`, `RememberStance`, `RememberAbout`, `rememberParam`, `rememberInSearch`, `REMEMBER_*` … | `LearnView`, `LearnStance`, `LearnAbout`, `learnParam`, `learnInSearch`, `LEARN_*` … |
| CSS classes | `.remember`, `.remember-submode`, `.remember-submode-btn` | `.learn`, `.learn-submode`, `.learn-submode-btn` |
| Files | `src/web/RememberAbout.tsx`, `src/web/assets/remember.png`, `tests/remember-*.test.ts(x)` (13), `evals/remember-*.ts` (6) | `learn` equivalents, by `git mv` |
| `package.json` script | `eval:remember` | `eval:learn` |
| Command-bar ids | `mode:remember`, `submode:remember:<view>` | `mode:learn`, `submode:learn:<view>` (regenerated) |
| Docs | `docs/project/remember-mode.md`, `remembering-vision.md` | `learn-mode.md`, `learning-vision.md`, and every signpost |

### What keeps the old word, on purpose

- **The English verb.** `rememberableSearch`, `REMEMBERED`, `rememberWaits`, "remembered per
  browser", the aria-label *"Remember what you took from this article"* (a sentence, and it reads
  right under a mode called Learn), and every comment that uses the word in its ordinary sense.
- **`RETIRED_MODES` gains `remember: "learn"`**, the table `trajectory: "skim"` is in. It is one
  row, and `modeFromParam` serves the client, the server's tab title, the Dock, a feedback report
  and Help's `#mode-<old>` anchor from it. So `?mode=remember` goes on opening Learn.
- **The command bar's words.** `MODE_CATALOG`'s alias `remember`, `FORMER_PARENT_NAMES`' value
  `"Remember"`, `vocabulary.ts`'s `"remember mode"`, Help's search keyword. A reader will go on
  typing the old name; 261005l put these there.
- **History.** `docs/plans/`, `docs/postmortems/`, `docs/research/`, `docs/investigations/`,
  `docs/user-feedback/`, `evals/results/**`, `evals/command-pick/catalogue-261002c.ts` and its raw
  results (frozen snapshots), `src/web/changelog-versions.ndjson`, the applied migrations in
  `drizzle/` and `drizzle/meta/`. **Their words keep the old name, but their link *targets* to the renamed files were repointed**
  (88 targets in 42 files, by script): `tests/doc-links.test.ts` checks links from dated records
  too, which this plan first said it did not.
  A comment that cites a plan by its file name keeps the file name.
- **The Greg quote** on the landing page, and the migration test that names the frozen file
  `20261001143901_remember_one_thread.sql` (the test file itself is renamed; the SQL file is not).
- **The stored title `Remembering`** on existing threads, and the placeholder that writes it.
  That is a reader-facing word, 261005l's layer; checked in stage 2 and changed only if 261005l
  missed it (it is drawn only when the reader's first message is empty).

### Old links: one alias kept, three let go

Greg: *"Don't worry about breaking links … or add an alias if it's minimal hassle."*

- **`?mode=remember` — kept**, the one row above.
- **`?remember=<view>` — let go.** The parameter is a nuqs key in three components plus a pure
  parser, and an alias would be a router rewrite like `liftLegacyTweets` with its own tests. An old
  link with `?mode=remember&remember=quiz` opens Learn at Recall, one press from Quiz.
- **A stored `remember=<view>` in `spya.lastView` — let go.** It is dropped on read (the general
  rule already there for a parameter that has left the list), and the reader's next choice is
  stored under `learn=`.
- **`?chatfrom=remember` — let go.** An unknown word already reads as All.

### The safety rule the alias must not break (GPT Sol's PR-1 on 261005l, the other way round)

`last-view.ts` refuses to replay a conversation mode unasked: `NEEDS_AN_EXPLICIT_PRESS` holds the
raw `?mode=` words `chat`, `diagram`, `remember`. Once the set says `learn`, a raw `mode=remember`
(alive through the alias) would slip past it, be stored, and reopen Learn by itself. So the filter
compares the **canonical** mode — the word through `modeFromParam` — not the raw text. That closes
it for every retired word at once. Red first: a test that `rememberableSearch("?mode=remember")`
keeps no mode, failing after the set is renamed and before the canonicalisation.

## Stage 1 — the thread kind, and its migration

`ThreadKind`'s member, `THREAD_KINDS`, every comparison against it (the sweep lists 17 sites in
`src/`), the wire value the client sends, the schema's CHECK and index, the fixture corpus
(`tests/fixtures/data-root/data/writes/chat.json`, through `build-corpus.ts`), and the tests.

**One migration, in place**, copying `drizzle/0048_rename_review_thread_kind.sql`, which did
`review` → `remember` on 2026-09-01:

```sql
ALTER TABLE chat_threads DROP CONSTRAINT chat_threads_kind;
UPDATE chat_threads SET kind = 'learn' WHERE kind = 'remember';
ALTER TABLE chat_threads ADD CONSTRAINT chat_threads_kind CHECK (kind in ('chat','learn','candidates','tutorial','explore'));
ALTER INDEX chat_threads_one_remember RENAME TO chat_threads_one_learn;   -- then its predicate
```

A partial index's predicate cannot be altered, so the index is dropped and created again with
`WHERE kind = 'learn'` (a rename alone would leave an index named `learn` guarding the value
`remember`, which no row has: silently no guard). Generated with drizzle-kit so the snapshot
exists; the `UPDATE` is inserted by hand between the DROP and the ADD, and the header says why, as
0048's does. The re-added CHECK is the postcondition: one surviving `'remember'` row fails it and
the transaction leaves everything as it was. It rewrites a value on readers' rows without changing
what any row means, which is the "ordinary migration" Greg's rule names.

**Simpler option passed over: leave the kind `remember` for good.** No migration, and no window.
Passed over because Greg's rule names stored values in so many words, and because two names for
one thing in `chat.ts` is the confusion the rename exists to remove.

**Another name passed over: `'recall'`.** The queue item notes the kind means Recall's thread
specifically (Tutorial and Explore have kinds of their own). True, and arguably truer. Not taken:
the brief says `learn`, Quiz shares the mode without a thread, and choosing a third word is a
product call nobody asked for. Recorded for the debrief.

**What breaks, briefly, and is accepted** (CLAUDE.md § This is a beta):

- *Between the migration and the new code going live in production*: old code inserting a Recall
  thread fails the CHECK (a failed turn, retried after reload), and old code reading a `learn` row
  coerces the unknown kind to `chat` through `isThreadKind` — for display only; `kind` is written
  on insert alone, so nothing is stored wrong.
- *A tab left open across the deploy* sends `kind: "remember"` and gets the route's 400 until it
  reloads. Same as 0048; no wire alias.
- *The shared local database*: every other worktree's old code meets the same two things once this
  is applied locally. Applied at push time, and the Overseer told.

Done is: the migration test red first (a `remember` row before, `learn` after; a second `learn`
thread on one article refused by the new index); typecheck clean; the chat and migration suites
green against Postgres; `tests/store-migration-registry.ts` and `store-migration-witness.json`
carry the new test file names.

## Stage 2 — the mode id, the URL words, the identifiers, the files

Everything else in the table, in `src/`, `tests/`, `evals/*.ts`, `scripts/`, `package.json`.
Mostly mechanical, done by an Opus subagent from the sweep's line-by-line list, with typecheck as
the net for identifiers and the suite for string values. The parts that are not mechanical:

1. The `last-view.ts` canonicalisation above, red first.
2. `RETIRED_MODES.remember`, with a test that `?mode=remember` opens Learn (the shape of
   `tests/skim-name.test.ts`), and Help's old anchor.
3. The generated catalogue, regenerated with
   `WRITE_COMMAND_PICK_CATALOGUE=1 npx vitest run tests/command-pick-catalogue.test.ts`, and
   `evals/command-pick/phrases.ts`' accept lists and `tests/command-suggest.test.ts` following the
   new ids. **This changes text a model is sent** (an id, not a word of instruction). Not
   re-measured: the id sits beside the label "Learn" it now matches, and the eval's accept lists
   move with it. GPT Sol is asked whether that is too easy.
4. Eval scripts build their output prefix from their own name, so new runs write `learn-*` beside
   the old `remember-*` results. Left: results are history. The docs that point at a results file
   keep pointing at the old name, which still exists.
5. `evals/live/hallucination-on-noise.mts` has "remember mode" inside a noise prompt; changing it
   changes an eval input, so it stays.

Done is: typecheck clean; `npm test` green but for contention reds re-run alone; `git grep -i
remember` over `src tests evals/*.ts scripts package.json` shows only the English verb and the
kept list above; a Sonnet browser check at desktop, iPad and phone widths — Learn opens from the
bar with `?mode=learn`, each of the four sub-modes writes `?learn=`, `?mode=remember` opens Learn,
a Recall turn is sent and answered, Chat's filter shows a Learn thread under `?chatfrom=learn`,
the sub-mode chips are styled as before.

## Stage 3 — the docs

`git mv` the two docs; fix every signpost (`AGENTS.md`'s two lines — signposting, so no approval
needed — `reading-view-overview.md`, cross-links from other `docs/project/` files, the tutorial
that cites them, `help-page.md` if it names the anchor); rewrite the evergreen docs' identifiers
(`url-state.md`, `mode.md`, `chat-tools.md`, `database.md` …) to the new names, with one dated
sentence where a reader would otherwise wonder ("`remember` until 2026-10-06; `?mode=remember`
still opens it"). `rename-or-move.md`'s example keeps `?mode=remember`: it is inside Greg's quote.
`tests/doc-links.test.ts` green.

## After the plan review (GPT Sol, 2026-10-06: approve with changes)

[The review](261006a-plan-review-sol.md). All eight findings accepted; the stages above are
re-cut as below, and where this section disagrees with one above, this section wins.

| Finding | What it said | What changed |
|---|---|---|
| PR-1 P1 | Code that does not know the kind `learn` coerces it to `chat` (`pg-chat.ts`, `export.ts`), so in the window a Retry or Edit of a Recall answer is rewritten under Chat's prompt, and stored | **Stage 0, new**: an unknown stored kind is an error, not a chat. It ships in a deploy *before* the rename |
| PR-2 P1 | Taking `remember` out of `ARTICLE_PARAMS` makes an old `?remember=quiz` link look bare, so the browser's stored view overrides the link | `remember` moves to `NEVER_REMEMBERED`: never stored or restored, but the link still wins. Tested for restore and first open |
| PR-3 P2 | The frozen fold migration's test seeds `remember` rows, which the new CHECK refuses | That test keeps its historical values and widens the CHECK inside its rolled-back transaction; the new migration gets its own test |
| PR-4 P2 | Typed `kind: "remember"` in nested `evals/` breaks stage 1's typecheck | One code stage; `evals/` swept recursively |
| PR-5 P2 | Source comments cite the two docs, and `doc-links.test.ts` checks source comments | The docs move in the same stage as the code |
| PR-6 P2 | `phrases.ts`' blind case b16 takes its accepted ids from the frozen `blind.raw.json` | A `BLIND_RELABEL` for b16; the raw file untouched |
| PR-7 P2 | Two eval scripts hardcode `remember-explore.<run>.json` as *input* too | New runs write `learn-*`; reading falls back to the old prefix |
| PR-8 P2 | The picker's ids are part of its prompt; moving the accept lists does not measure it | A bounded run of the command-pick eval over Learn, its sub-modes, the old name and its neighbours, after the build, written up in `docs/investigations/` |

Sol also confirmed there is no place that equates a thread kind with a mode id, that
canonicalising the explicit-press filter leaves `chat`, `diagram` and the Marginalia words as they
are, and that the migration's shape is sound (drop and create the index; no `ALTER INDEX RENAME`).

### The stages as built

- **Stage 0 — an unknown stored thread kind refuses.** `pg-chat.ts` and `export.ts` stop coercing
  to `chat`. Red first. Small, right by itself (the coercion is the silent mislabel its own
  comment warns about), and pushed to `dev` at once so a deploy can carry it ahead of the rename.
  **The order is a request to the Overseer, not a mechanism**: if stage 0 and the rename go out
  in one deploy, the window is as PR-1 describes — minutes long, and needing a reader to press
  Retry or Edit on a Recall answer inside it. That fallback is accepted; the order just removes it.
- **Stage 1 — the whole rename**: kind and migration, mode id, URL words, identifiers, files,
  evals, docs. One commit that is safe by itself, because nothing in between is.
- **Stage 2 — the picker measured** (PR-8) and the browser check.

## Reviews

GPT Sol reads this plan before stage 1 (read-only), then the code after stage 1 (write-capable, fixing inside the
stage; stage 0 rides in the same review). Its doc edits are grepped for "Greg" before
they are committed.

## Stage 0's code review (GPT Sol, 2026-10-06)

The review is [261006a-stage-0-code-review-sol.md](261006a-stage-0-code-review-sol.md). Both
findings were checked against the code and were true. Each was reproduced by a failing test before
it was fixed: `tests/unknown-thread-kind-refuses-cleanly.test.ts`.

| Finding | What it said | What was done |
|---|---|---|
| S0-1 P1 | `rename` and `remove` in `pg-chat.ts` committed their write and then read the thread list. With a kind the code does not know on the article, the read threw after the commit: the reader was told the delete or rename failed, and it had happened | Both now read the list inside the same transaction, so the refusal rolls the write back. The test refuses a delete and a rename and finds the thread and message rows unchanged, then runs the same call with a readable list to show it does write |
| S0-2 P1 | The refusal reached the browser as a 500. The chat client treats only a 409 as a refusal; a 500 is committed on screen, so a refused Retry blanked the answer and a refused Edit rewrote the question and dropped the later turns, though Postgres kept them, until a reload | `UnknownStoredThreadKind` now carries `status = 409` and a sentence for the reader (`CHAT_BEING_UPDATED`, `[db-updating]`). That is the existing mechanism: the store guard passes an error with a status and the route answers with it. No client change. The test sends a retry and an edit through the route, the browser's `runTurn` and the real controller, and finds the original rows on screen |

Three things follow from the 409 and were left as they are:

- **Every chat route answers this way, not only a turn.** Opening the panel in the window shows the
  same sentence in place of the list.
- **A 409 is not reported to Sentry**, and its log line is a warning carrying the reader's sentence
  and not the stored value. The value is on the error's `stored` field, which nothing logs. Inside
  a deploy that is right; a row that was simply wrong would now be quieter than it was as a 500.
- **`exportArticle` throws the same class**, so a failed export prints the reader's sentence where
  it used to print the stored kind.

`sweepPending` still marks stale pending answers as failed before its own read refuses. It was
left alone: those rows are past their lease and would be swept by the next read anyway, so nothing
a reader had is lost.

## What landed (stage 1, code)

The code half of stage 1: `src/`, `tests/`, `evals/`, `scripts/`, `package.json` and `drizzle/`.
The docs half was done beside it by another agent.

**Built**

- **The rename itself**, as the table says: the mode id and `?mode=` value, `?learn=`,
  `?chatfrom=learn`, the thread kind, the identifiers (`LearnView`, `LearnStance`, `LEARN_SYSTEM`,
  `LearnBand`, `learnParam` and the rest), the CSS classes, 21 files by `git mv`, the
  `eval:learn` script, and the command bar's ids (catalogue regenerated). The bulk was a script
  over an explicit list of identifiers, then typecheck; history comments were put back by hand.
- **The migration**, `drizzle/20261006005914_rename_remember_thread_kind_to_learn.sql`:
  generated by drizzle-kit (four statements, no prompt), with the `UPDATE` inserted by hand
  after the two DROPs and before the CREATE and the ADD. Its test,
  `tests/learn-kind-migration.test.ts`, puts the schema back to the day before inside a
  rolled-back transaction and replays the file.
- **The frozen fold migration's test** (`tests/learn-one-thread-migration.test.ts`) keeps its
  `remember` fixtures and assertions, and widens the CHECK inside its transaction (PR-3).
- **`RETIRED_MODES.remember`**, and `last-view.ts` asking about the mode a word means
  (`needsAnExplicitPress`), with `remember` moved to `NEVER_REMEMBERED` (PR-2).
  `tests/learn-name.test.ts` holds these.
- **`evals/stored-result.ts`**: one helper that finds a saved result under its old name when the
  new one is absent. The Explore judge, its critic pairs and the plain-words arms read through it
  (PR-7). `tests/stored-eval-results.test.ts` reads two real saved files through it.
- **`BLIND_RELABEL` for the blind case** (PR-6).

**Differs from the plan**

- **PR-6's case is `b15`, not `b16`.** It is line 16 of `blind.raw.json`, whose first line is
  the bracket.
- **Dated records are not exempt from `tests/doc-links.test.ts`.** The plan says their links to
  the renamed files may go stale. They may not: a markdown link from `docs/plans/`,
  `docs/investigations/`, `docs/research/` or `docs/user-feedback/` to a file that has gone is a
  red test. 47 such links point at the two renamed docs and at `evals/remember-*.ts`. When
  `trajectory.md` became `skim.md` the dated links were retargeted, and the same is needed here.
- **A worktree's own `data/` goes stale.** `data/writes/chat.json` is a gitignored copy of the
  fixture, made by `npm run worktree:setup`. A tree set up before this change still holds
  `kind: "remember"` there, which reads back as `chat`, so `tests/store-roundtrip.test.ts`
  fails on `preserves chat.json exactly` until the file is copied again from
  `tests/fixtures/data-root/data/writes/chat.json`.
- **The fixture was edited by hand to match its generator.** `build-corpus.ts` rebuilds the
  whole corpus from a laptop's `data/`, which the box does not have.
- **The plain-words artefact key moved to `learn`** too. A saved arm's `remember.json`, which
  names itself `remember` inside, is read as the `learn` generator.
- **One error message a client can receive changed**: *"A remember conversation is about the
  whole article…"* is built from the kind, so it now says *learn*.
- **The new migration test failed in the full suite and passed alone.** The lane's database is
  shared, and other suites' committed `learn` rows broke the step that puts the old CHECK back.
  The test now turns them into `remember` rows first, inside its rolled-back transaction. That
  fix has passed alone and beside six chat suites, but has not been through a second full run.
- **Help has a new anchor**, `#mode-learn`. `#mode-remember` shipped, so it stays pinned in
  `tests/help-page.test.tsx` and resolves through the alias.

**Keeps the old word, on purpose**

- The English verb, wherever it is one, and the identifiers built on it (`rememberableSearch`,
  `REMEMBERED`, `NEVER_REMEMBERED`, `rememberReturn` and the like).
- Words a reader types or reads: the alias `remember` in `MODE_CATALOG`, the value `"Remember"`
  in `FORMER_PARENT_NAMES` (its key moved), `"remember mode"` in `vocabulary.ts`, Help's search
  keyword, the old compounds in the generated catalogue (`Remember Quiz` and the rest), the
  aria-label *"Remember what you took from this article"*, and the stored placeholder title
  *"Remembering"*, which 261005l decided stays.
- The old URL words where they are the point: `RETIRED_MODES.remember`, `"remember"` in
  `NEVER_REMEMBERED`, `mode-remember` in Help's pinned anchors, and the tests that send them.
- History: applied migrations and their snapshots, the frozen fold migration's test, comments
  that date a rename or cite a plan by its file name, the dated requests quoted in comments in
  `QuizPanel.tsx`, `WrittenForYou.tsx` and `LandingPage.tsx`, `evals/results/**`,
  `evals/command-pick/results/**`, `evals/command-suggest/results/**`,
  `evals/cost/baseline/**`, `catalogue-261002c.ts`, `blind.raw.json`, the changelog files,
  `evals/live/hallucination-on-noise.mts`, the Overseer's captured terminal tail, and the ledger
  slug `test-remember-route-fixture` named in `src/store/ai-calls.ts`.

## Stage 1's code review, and the picker measured (2026-10-06)

- **GPT Sol's code review** of `8c36c5caa`: [approve](261006a-code-review-sol.md). No P0, P1 or
  P2. Four comments the rename had got wrong (two English verbs turned into `learn`, two test
  headers whose history had been rewritten), fixed by the reviewer. CR-5, a sentence in
  `learn-mode.md` that stage 0 had made false, fixed by hand. A second pass by grep over every
  added line for the same two mistakes found no more.
- **Full suite** on `27e84ba15`: 1701 files passed, 5 failed, and those five are the ones that
  need `npm run build` output; after building, all five pass (112 tests). The migration test that
  went red in the first full run (the lane database held other suites' `learn` rows) was green in
  this one.
- **PR-8, the picker**:
  [261006a-command-picker-after-remember-ids-became-learn.md](../investigations/261006a-command-picker-after-remember-ids-became-learn.md).
  38 phrases run twice, $0.02. 36 right before and after; all six Learn phrases right; one pick
  moved, between two accepted Learn rows at about 0.5 confidence. Not an A/B on the ids alone,
  and the suggester was not run. Taken as enough.
