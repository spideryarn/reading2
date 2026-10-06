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
  `drizzle/` and `drizzle/meta/`. Their links to the two renamed docs go stale;
  `tests/doc-links.test.ts` allows that for dated records, as it did for `trajectory.md`.
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

## Reviews

GPT Sol reads this plan before stage 1 (read-only), then the code after stage 1 and again after
stages 2–3 (write-capable, fixing inside the stage). Its doc edits are grepped for "Greg" before
they are committed.
