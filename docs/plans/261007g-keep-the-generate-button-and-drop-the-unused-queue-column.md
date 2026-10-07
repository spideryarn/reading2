# Keep the Generate button after a failed Try again, and drop the unused queue column

**What the reader sees, before and after.** Before: when a mode has nothing yet and the
connection drops twice — once on its own, once when the reader presses *Try again* — the mode's
button that makes one (*Find the ideas*, *Choose the quotes* and the rest) disappeared, and only
reloading the page brought it back. After: the button stays, with the "couldn't reach the server"
line and *Try again* above it, as it already did in the Thread view.

Two small changes, owner-approved, two commits. They are the seventh sweep's questions 4 and 6
([261006m](261006m-seventh-codebase-sweep-depth-umbrella.md), the revised *For Greg* list); both
answers were relayed verbatim by the Overseer on 2026-10-07.

## 1. The Generate button survives a failed *Try again*

> ok, i'll go along with you on this. I don't quite follow
>
> — Greg, 2026-10-07, answering question 4

The recommendation he went along with: keep the button in every mode; a possible duplicate run is
cheaper than a dead end.

**The defect** (WCO6 in
[the client investigation](../investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-opus.md)).
Sequence: the read answers "none yet"; a later read fails; *Try again* fails too. In twelve hooks
— Ideas, Timeline, FAQ, Debate, Quotes, Glossary, Citations, Quiz, Simple, Sketch, Illustrated,
Skim — `retryRead` set `loading` because nothing was loaded, and the catch's
`was === "loading" ? "error" : was` then landed on `error`, which no empty state draws. `useTweets`
kept the button: its catch consults an `answered` ref (postmortem 261004f).

**The rule.** Once the server has said "none yet" for this article, a failed refresh or a failed
*Try again* ends at `none`, with the failure shown. A failed *opening* read still ends at `error`.

**The change, per hook: one ref, one line per "none yet" branch, one changed ternary.**
`saidNoneFor = useRef<string | null>(null)`, set to the slug in each "none yet" branch, and the
catch becomes `was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"`. Keyed
by slug rather than a boolean reset in an effect (Tweets' shape), because a slug key needs no
effect and cannot be out of step with the read it describes; the ordering machinery
(`useOrderedRead`, `current()`) is untouched, so a superseded reply still sets nothing. Sketch and
Illustrated have two "none" branches each (a 404, and a 200 with nothing drawable); both set it,
and the faults the second sets are left as they were.

**Simpler options passed over.**
- *Change only `retryRead`* — go to `loading` only from `error`, so a retry over `none` never
  leaves it. One token per hook and no ref, but the retry's *Looking…* would vanish and a
  successful retry would jump straight from the empty state to the artefact: a visible change in
  cases Greg was not asked about.
- *A shared helper or hook.* The deletion test fails it: deleting a helper would put back one
  ternary per hook, and the reasoning lives once in [mode.md](../project/mode.md) anyway.

**One panel needed more than its hook: Illustrated.** `IllustratedView`'s empty state drew
`ReadError` *instead of* the empty state whenever there was an error, in either status, so the
paint button went with any failed read over "none yet" — the failed refresh included, not only the
retry. It now draws the failure above the empty state when the status is `none`, and the failure
alone when it is `error` (unchanged). That is the same rule; it is the one place it reaches a case
beyond the retry, and it is said here so that it is decided rather than inherited. Sketch's panel
already drew its button in both statuses, so its change is invisible on screen.

**Checked, and unaffected:** Glossary's local patches and render-time slug reset (the reset
returns to `loading`, and the slug key means the old article's answer is not the new one's), Quiz's
kept answers (the "none yet" branch already clears them; the catch touches none of them),
Citations' local patches (no value, nothing to patch).

**The cost, accepted.** In that state the reader can start a run while the app does not know
whether one has landed since; and a mode press made in that state is read by `useAutoRun` as
*none* and spends once, where before it read the failure and asked again.

**Tests.** `tests/read-error-matrix.test.tsx`: a row per mode in the whole app (404, a job
finishing whose refresh fails, a failed *Try again*: the empty state's buttons are all still there,
the failure is shown, nothing posted), and per read alone: the same sequence ends at `none`; a
failed opening read then a failed *Try again* stays `error`; another article's "none yet" does not
stand in for this one's; and Sketch's and Illustrated's nothing-drawable "none". The ideas-states
case that pinned the old ending is flipped. Red first: all twelve hook rows; the app rows for eleven
(Sketch's panel never lost its button); Illustrated's app row went red at the failed refresh, which
is what found the panel. Mutation-checked: Timeline without the memory, Glossary and FAQ with an
unkeyed memory, Sketch without either branch's line, Skim with the old catch, Illustrated's panel
hiding the empty state on error — each red.

## 2. Drop `queue_state.running_job_id`

> yes
>
> — Greg, 2026-10-07, answering question 6 (drop the unused column; nothing reads or writes it;
> its one production row holds null)

**Re-verified absent.** `grep -rnE 'running_job_id|runningJobId'` over `src`, `scripts`, `tools`,
`evals`, `tests` and `drizzle/` outside its own creation in `0000`: the declaration in
`src/db/schema.ts` and one sentence in `src/store/article-rows.ts`, nothing else, and no string
built from parts. `claim` (`src/store/pg-jobs.ts`) only ever runs
`select 1 from queue_state where id = 1 for update nowait`. The row, its seed, its singleton CHECK,
its delete trigger and `claim`'s refusal when the row is missing all stay.

**The export walk was the one thing that noticed the column.** `articleScopedTables`
(tests/store-export-covers-tables.test.ts) follows every foreign key one way and one hop the other,
and `queue_state` was in scope only through this column's key to `jobs`. With the key gone it is
out of scope, so its `ARTICLE_TABLE_COVERAGE` entry — two sentences saying it is not exported —
went red as stale ("names nothing that is not a table any more") and is deleted. The effect on what
anybody receives: the reader's bundle `manifest.json` no longer lists `queue_state` among the
tables it leaves out. Neither export ever wrote a byte of it. `db:reown` finds its tables by an
`owner_id` column, which `queue_state` never had, so it is unaffected.

**The migration**, `drizzle/20261007065807_drop_queue_state_running_job_id.sql`, generated, and
exactly:

```sql
ALTER TABLE "spideryarn"."queue_state" DROP CONSTRAINT "queue_state_running_job_id_jobs_id_fk";
ALTER TABLE "spideryarn"."queue_state" DROP COLUMN "running_job_id";
```

Its stamp, `1791356287082`, sorts after the seven already waiting for production
([261007c § Before applying to production](261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies.md#before-applying-to-production),
which now lists eight and whose pre-flight now checks this one).

**Not applied to the shared local database.** `npm run db:migrate` (Target
`postgresql://postgres@127.0.0.1:54362/postgres`) refused, rightly: that database carries two
ledger rows from a peer worktree's unlanded migrations (`20261007041657_feedback_number`,
`20261007051332_feedback_question_answers`), and the guard will not apply anything past rows this
journal has never heard of. Instead the whole chain was applied to an empty `spideryarn` schema
in a private database (`scripts/db-test-create.ts`): 161 ledger rows, `queue_state` left with `id`
and `updated_at`, its key gone, its CHECK, primary key, delete trigger and one row still there, and
`db:check` against it (Target that database) answered no drift. `db:chain` is clean and
`db:generate -- --allow-empty` says no schema changes.

**Production, read-only.** Inside `BEGIN READ ONLY; … ROLLBACK;` as `spideryarn_app`: one
`queue_state` row, none with a `running_job_id`, the key present, the ledger at 153. Then the
updated pre-flight, the result in 261007c.
