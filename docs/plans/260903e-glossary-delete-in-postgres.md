# Glossary "Start again" in Postgres: build the delete, retire the 501

**Status:** reviewed twice by GPT Sol — *not ready*, then **ready to build**. Building.
**Owner:** this run. **Predecessor:** docs/plans/260903d-improve-the-codebase-second-sweep.md,
which found the refusal and corrected the sign on it.

## The job in one line

`DELETE /api/glossary/:slug` answers **501 on the deployed app**. Build the Postgres half so it
answers, and delete the scaffolding that said it could not.

## What a reader cannot do today

The glossary panel's **Start again** button — *"throw the list away and find a new one"* — fails for
everybody who is not a developer on a laptop. `src/web/useGlossary.ts:471` sends the DELETE, catches
the failure, and shows the reader the store's message; `reset` deliberately stops there rather than
running the step anyway, because the glossary step **appends** (`src/glossary.ts`), so falling
through would lengthen the list the reader just asked to be rid of.

## Why it was refused, and what is actually true

`src/store/index.ts:340` wires the Postgres side to `notMigrated("Deleting the glossary")`. Its
comment says the SQL is trivial but that it is not settled whether it may run at all, because the
delete nulls `article_revisions.glossary` on the *published* revision and that table is documented
immutable once published.

**The first version of this plan said the decision had already been made and the code relies on it
daily. That was wrong, and GPT Sol caught it.** `src/db/schema.ts:390` claims `hierarchy`, `arc`,
`tweets` and `glossary` *"write their own column onto the revision that is already published, in one
`UPDATE`"*. **They do not, and have not since the D1b work.** Traced end to end:

- every job opens a **draft** — `openOrBeginJobDraft` (`src/store/pg-revisions.ts:856`) →
  `beginDraftIn` (`:711`), which copies the current revision's columns, blocks and step runs into a
  new revision row;
- `writeArtefacts` (`src/store/artifacts-pg.ts:1272`) writes to **that draft's** `ref.revisionId`,
  fenced by `requireLiveJobOwnsDraft`;
- a job ending `done` calls `publishRevisionIn` (`src/store/pg-session.ts:454`), which moves
  `articles.current_revision_id` to the draft.

So a glossary run mints a revision like everything else. **There is no runtime precedent for
mutating a published revision's glossary, and this plan introduces one deliberately.**

**The schema comment is stale and gets corrected in this work.** It is exactly the failure mode
CLAUDE.md names — a restatement of a fact that lives in the code, which nothing kept in step, and
which two readers (its author and me) believed.

### Why the exception is still the right call

The comment's *reasoning* survives its stale example, and it argues for the in-place update:

> A revision per glossary regeneration would copy every `revision_blocks` row of the article to add
> one JSONB value, and no reader could tell the difference — a single-column `UPDATE` is already
> atomic.

That is more true for a **deletion** than for a write: minting a whole revision to *remove* a value
is the clearest case of paying for a copy that buys nothing. `publishRevision` also refuses a
revision with no tree or no blocks, so a delete-by-revision would have to carry the whole article
forward to null one column.

## The question that looked like a trap, and the answer

Nulling the column does not move the step's fingerprint (`FINGERPRINT_COLUMNS` hashes the step's
*inputs* — tree, title, byline, site). So if `revision_step_runs` still says `glossary: done`, a
delete would remove a glossary nothing regenerates: **strictly worse than the 501**.

It cannot happen. `hasArtefacts` (`src/store/artifacts-pg.ts:678`) requires **both**:

1. a `revision_step_runs` row with `status = 'done'`, **and**
2. every produced kind reading back — `readArtefactOutcome` answers `absent` for a null column.

So `has()` is false, `stepIsDone` (`src/pipeline.ts:906`) is false, and an ordinary run rebuilds it.
**The delete must be one `UPDATE` and must not touch `revision_step_runs`** — removing that row would
be a second, unnecessary write that only creates ways for the two to disagree.

**Measured, 2026-09-03, not merely traced.** A throwaway spike built a Postgres fixture with a
published revision holding a glossary and a `revision_step_runs` row saying `done`, then nulled the
column by hand and asked the runner's own question:

```
✓ re-runs glossary after the column is nulled, even though the run row still says done  191ms
  Test Files  1 passed (1)     Tests  1 passed (1)
```

In order: `hasArtefacts` **true** before (so the fixture was real), the run row still `done` and its
`input_hash` unchanged after the null (so the row is not what moved), `hasArtefacts` **false**, and
`stepIsDone(STEPS.glossary, …)` **false**. Postgres was reachable, so it ran rather than skipped.

Stage 1's test asserts the same thing permanently, so this is not the last time it is checked.

Recorded in `src/store/live.ts` as of commit `a5d9ae93`.

## The race that makes this more than one UPDATE

**GPT Sol's finding, and the reason the first plan was not ready.** Verified in the code:

Every draft copies the current revision's `glossary` forward. The delete changes the current
revision **in place**, so `articles.current_revision_id` does not move. Therefore a draft opened
*before* the delete still satisfies `publishRevisionIn`'s exact-base guard —
`draft.basedOnRevisionId !== article.currentRevisionId` (`src/store/pg-revisions.ts:1561`) — and
publishes its copied, **non-null** glossary. The reader's deletion is silently undone.

It is worse than a generic race, for two reasons:

1. **Any job resurrects it, not just a glossary job.** Every draft carries every column.
2. **The reader's own retry can be the thing that undoes it.** `reset` posts an ordinary run after
   the delete; if a job for the same work is already in hand, `sameWork` (`src/jobs.ts:2441`) hands
   that existing job back and pumps it rather than creating a second one — so the very job that
   holds the stale draft is what gets driven to completion.

**This is not the race the filesystem has.** A filesystem job for some other step does not copy and
later rewrite `glossary.json`.

### The fix, and the two options that lost

**Chosen: refuse while a live job holds a draft for this article.** Under the same article lock
`openOrBeginJobDraft` takes, so the check is race-closed rather than merely narrow: if a queued or
running job has a draft, answer **409** and say so. The reader waits for the job to finish and
presses Start again.

- *Mint a revision instead, so the delete joins the exact-base protocol.* Rejected: it makes a
  concurrent job's publish fail with `PublishRefused`, throwing away real work — including model
  spend on an unrelated step — to satisfy a button press.
- *Do nothing and accept the race.* Rejected: silent resurrection of data the reader asked to
  destroy is the failure this repo writes postmortems about.

**This is the one user-visible change nobody asked for**, so it is called out rather than slipped
in: Start again can now say *"a job is running on this article — wait for it to finish and try
again"*. The client already handles a failed DELETE properly (`src/web/useGlossary.ts:472` shows the
message and deliberately does not fall through to a run), so the path exists; it stops being dead
code and starts being used. If Greg would rather it queued behind the job, that is a bigger change
and a separate plan.

## The shape of the implementation

```
requireSlug(slug)                                   -- 400 for a non-slug, before any query
BEGIN (read committed)
  SELECT id, current_revision_id FROM articles WHERE ownedSlug(slug) FOR UPDATE
    no row  -> notFound(slug)                       -- 404, never 403
  live queued/running job with a draft for this article?
    yes     -> 409 "a job is running on this article"
  current_revision_id IS NULL -> { deleted: false }  -- no revision, so no glossary
  UPDATE article_revisions SET glossary = NULL
   WHERE id = <rev> AND glossary IS NOT NULL         -- the guard is what makes `deleted` honest
COMMIT
returns { deleted: rowCount === 1 }
```

### The analogue to copy

`pgVisibilityStore.set` (`src/store/pg-visibility.ts:94`) is the same shape: one slug in, one column
on one owned row changed, a boolean-ish answer out. It is a transaction, a `.for("update")` read
through `ownedSlug`, `notFound` on a miss, an idempotent short-circuit when there is nothing to do,
and `READ_COMMITTED`. This should look like that, so there is one way to write this kind of method
rather than two.

**What it must not copy** is the pipeline's write. `writeArtefacts`
(`src/store/artifacts-pg.ts:1272`) reaches the same column, but everything it does is keyed off a
`JobDraftRef` — `requireBound`, `requireLiveJobOwnsDraft`, and `lockStepRun` taking `FOR UPDATE` on
a `revision_step_runs` row held by that exact job attempt. A reader pressing a button has no job, no
attempt and no step-run row, so that path is not merely heavier, it is unavailable.

### Leaf discipline, and where `requireSlug` comes from

`requireSlug` lives in `pg.ts:138` and the new file must not import `pg.ts`. **Extract it to its own
leaf**, `src/store/require-slug.ts`, and re-export it from `pg.ts` exactly as `ownedSlug` is
re-exported from `owned-slug.ts` — so its dozen existing callers do not change and nothing has to
know it moved. `isSlug` itself is in `src/ingest.ts`; the leaf imports that and nothing else.

### Leaf discipline

`pg.ts` imports `src/api.ts`, which reaches `glossary.ts` and `arc.ts`, so importing `pg.ts` from a
new store file risks an import cycle — and `npm run cycles` is a gate, not advice. The house answer
is already visible: `ownedSlug` lives in its own leaf (`src/store/owned-slug.ts`), `READ_COMMITTED`
lives in another (`src/store/isolation.ts`), and `pg-visibility.ts:51` keeps its **own three-line
copy of `notFound`** rather than importing `pg.ts`'s. Do the same here and say why in the file.

### The owner is ambient, so a slug-only signature is right

`deleteGlossary(slug)` takes no owner because it does not need one: `ownedSlug` defaults to
`currentOwnerId()`, which reads the request's `AsyncLocalStorage` scope (`src/owner.ts:237`) and
throws a 500 if a store read somehow arrives before authentication. That is the normal shape for
every reader path in this repo, not a gap in the contract.

Three things this gets from the house style rather than inventing:

- **`ownedSlug`** (`src/store/owned-slug.ts`), never `eq(articles.slug, …)`. `articles.slug` is
  globally unique, so the bare comparison finds *somebody else's* article and the failure is silent.
  `tests/owner-isolation.test.ts` greps `src/store/` for the unfiltered spelling.
- **A miss is a 404, not a 403** (`src/store/pg.ts:217`) — "there is no such article" is all a
  stranger should learn about a slug they do not own.
- **`glossary IS NOT NULL` in the `WHERE`**, so `deleted` means *there was one and now there is not*,
  matching the filesystem's ENOENT → `{ deleted: false }` (`src/api.ts:846`).

### What does not carry over, and why that is right

The filesystem version has a **403** for the `example` fixture — *"its glossary is not yours to
delete"*. There is no counterpart and there must not be one: `example/` is the one committed
directory in the repo, a filesystem-only artefact. In Postgres an unknown slug 404s like any other.
The Postgres half is genuinely simpler, not missing a check.

## Stages

Each ends green and committable on its own.

### Stage 1 — the store method, red first

**New file `src/store/pg-glossary.ts`**, exporting
`pgGlossaryStore: Pick<GlossaryStore, "deleteGlossary">` — the same shape `fsGlossaryStore` is
declared in (`src/store/fs.ts:135`), because `lookUpTerm` is not a store function on either side:
it is store-independent orchestration that `index.ts` builds from whichever adapters are live.

**Wiring**: `src/store/index.ts:340` becomes
`guarded("glossary", pgGlossaryStore, fsGlossaryStore)`. **`guarded` is not optional** — it is
`guardDbStore` for the Postgres side (`src/store/index.ts:200`), which stops Drizzle putting bound
parameters into a failed query's message. The `notMigrated` ternary and its doc comment go.

**New test `tests/store-glossary-delete-pg.test.ts`**, built on the fixture shape in
`tests/store-carry-forward.test.ts` (`pgReady` from `tests/helpers/pg-ready.ts`, a `test-` prefixed
slug so `tests/store-parity.test.ts` skips it by name, and `beginRevision` / `recordStepRun` /
`publishRevision` from `src/store/pg-revisions.ts` rather than the importer). It asserts:

- delete with a glossary present → `{ deleted: true }`, and the column reads back null;
- delete again → `{ deleted: false }`;
- an unknown slug → 404;
- **another owner's slug → 404, and their column is still there.** The one that matters;
- **`revision_step_runs` is untouched and still says `done`**, and `hasArtefacts` returns `false`
  anyway. That is the trap above asserted rather than reasoned — if someone later "fixes"
  `hasArtefacts` to trust the row, this test is what fails.

- **a malformed slug is a 400, not a 404** — and `pgGlossaryStore.deleteGlossary` joins the family
  in `tests/store-slug-guard.test.ts:73`, which is the list that exists so a seventh store cannot
  quietly skip the guard;
- **the generated SQL contains `FOR UPDATE`.** Sol's point, and a good one: dropping `.for("update")`
  would leave the whole suite green unless a race happened to occur during a run. Export the query
  builder the way `pg-visibility.ts:77` does and assert on the SQL it renders;
- **the 409 while a live job holds a draft**, deterministically: open a draft for a job, then call
  the delete, then assert the glossary is still there.

Watch each go red against the 501 before building.

**And one integration test, because `hasArtefacts === false` is not the reader's claim.** Sol is
right that asserting the store layer proves the store layer. Drive the real claim/session path with
a fake glossary step — no model call needed — and assert that after the delete an *unforced* job
actually runs the step and publishes a replacement. That is the sentence the feature promises.

**The trip-wire fires as designed.** `tests/store-seams-have-two-implementations.test.ts:326` fails
the moment `pgGlossaryStore` exists — *"GlossaryStore declares no postgres side but has
pgGlossaryStore"* — until the `SEAM_ASYMMETRIES` entry is deleted from `src/store/live.ts`. That is
the record working, not a problem to route around.

### Stage 2 — the reader's path, and the comments that describe a world that ended

Nothing here changes behaviour; it stops five files lying to the next reader.

- `src/web/useGlossary.ts:472` — the `reset` catch explains at length that *"this is where production
  stops"*. **The catch stays**: a failed DELETE must still not fall through to a run, because the
  step appends. Only its stated reason changes.
- `tests/store-carry-forward.test.ts:637` — nulls the column by hand as a stand-in for
  `deleteGlossary`, *"which has no Postgres implementation yet"*. Call the real function instead.
- `tests/glossary-one-fetch.test.tsx:325` — says the DELETE *"would not describe production if it
  were"* exercised. It would now.
- `docs/plans/260826e-postgres-storage-implementation.md` — four places, including the section
  *"deleteGlossary is step 11's, and that leaves a hole"*. Step 11's question is the one that got
  answered.
- `docs/plans/260831b-finish-the-database-move.md:312,432` — *"only `deleteGlossary`"* still lacks a
  Postgres side. After this, none does.
- `docs/project/deployment.md:926` — still says the deletion is correctly refused and the permission
  question is open. Sol found this one; the first plan missed it.
- `docs/plans/260827am-glossary-read-latency.md` and
  `docs/plans/260903a-improve-the-codebase-sweep.md` — present-tense claims that it is refused.
- **`src/db/schema.ts:390` — the stale claim that four steps update a published revision in place.**
  This is the one that matters beyond this task: it is wrong today, and it is what made the first
  version of this plan wrong. Correct it to say what the code does — every job drafts and publishes
  — and record the delete below it as the single deliberate exception.

**Then drive a real browser** against a Postgres-backed article: press Start again, watch the panel
empty and a new list arrive. Tests going green is not evidence a reader can see it.

## What done looks like

`npm run check` green; `SPIDERYARN_STORE=postgres` **Start again** empties the panel and a new list
arrives; no `SEAM_ASYMMETRIES` entry for `GlossaryStore`; no doc still saying it is refused.

## What the work turned up

**`pgVisibilityStore.set` never calls `requireSlug`.** It goes straight from a slug to
`lockedArticleQuery` (`src/store/pg-visibility.ts:96`), so a malformed slug — a pasted title after a
URL decoder has had it — reaches a query and comes back as a **404 instead of a 400**. It is a
write, and it is not in `tests/store-slug-guard.test.ts`'s family.

This is the same finding the last sweep filed as T1.2, in a seventh place, and that entry predicted
it in as many words: *"a fix simply failed to reach one of six copies, which is the shape that
predicts the seventh."* Extracting `requireSlug` into a leaf is being done anyway, so the fix is one
import and one line, plus an entry in the guard family. **Folded into Stage 1** rather than filed —
the machinery is open.

## Not doing

- **Making the glossary step replace instead of append**, which would remove the need for a delete
  endpoint entirely. Rejected: appending is what preserves entry ids across runs, and
  `src/glossary.ts` is explicit that minting fresh ids where old ones exist is data loss.
- **Minting a revision per delete.** The schema already argues against it: it would copy every
  `revision_blocks` row to change one JSONB value, and no reader could tell.
- **Deleting the `revision_step_runs` row.** Not needed, per above.

## The one technical fork, named rather than slipped past

**A transaction with a locked read, or a single `UPDATE` with a subselect?**

The single statement is smaller and cannot deadlock:

```sql
UPDATE article_revisions SET glossary = NULL
 WHERE id = (SELECT current_revision_id FROM articles WHERE slug = $1 AND owner_id = $2)
   AND glossary IS NOT NULL
```

But `rowCount = 0` then means *three* things at once — no such article, no current revision, or
already null — and the first has to be a 404 while the others are `{ deleted: false }`. Recovering
that distinction needs a second query anyway, which is where the saving goes.

So: **transaction, locked read, then the update**, matching `pgVisibilityStore.set`. Flagged for the
review in case that is the wrong call.

## What the second review settled

**The predicate for "a live job holds a draft"**, which is the whole of the 409 guard, taken from
Sol's second pass and using the existing `leaseIsLive` (`src/store/job-fence.ts:80`):

```sql
SELECT 1 FROM jobs j
  JOIN article_revisions r ON r.id = j.draft_revision_id
 WHERE r.article_id = $article_id AND r.status = 'draft'
   AND (j.status = 'queued'
        OR (j.status = 'running' AND j.attempt_id IS NOT NULL
            AND j.lease_expires_at > clock_timestamp()))
 LIMIT 1
```

**A claimed job with no draft yet is missed on purpose, and that is safe** — the article lock
decides the order either way. If the delete gets the lock first, the job opens its draft afterwards
and copies the *nulled* column. If the draft gets it first, the delete sees the committed pointer
and refuses. **An expired-but-unswept job is excluded** and cannot publish anyway, because the same
lease boundary fences every write.

Three deterministic cases to add: queued-with-draft, expired-running-with-draft, and
claimed-without-draft.

**Two more stale comments**, both repeating the same false claim, both corrected here:

- `src/store/pg-revisions.ts:641` — *"`hierarchy`, `arc`, `tweets` and `glossary` update the
  published revision in place"*, given as the reason `beginDraftIn` must be one transaction. The
  requirement is right; the reason given for it is not.
- `src/store/pg.ts:698` — cites *"the importer's in-place update"*. The importer was deleted on
  2026-09-01.

## Progress

**Stage 1 — done, 2026-09-03.** `src/store/pg-glossary.ts`, `src/store/require-slug.ts`, wired with
`guarded`, `SEAM_ASYMMETRIES` entry gone, `pgVisibilityStore.set` guard added, and
`tests/store-glossary-delete-pg.test.ts` with all ten cases. Every case was watched red first —
seven against the 501, three on their own assertions, including the `for update` one that renders
the SQL and the `hasArtefacts`-true-before sanity check. 53 tests green across the four affected
suites; typecheck clean; `npm run cycles` clean, which is the leaf extraction's own gate.

Two deviations from the brief, both right: `result.rowCount === 1` rather than `rowsOf` (which reads
`.rows` off a raw `execute` and does not fit a Drizzle `.update()`; `rowCount` is the idiom in
`pg-revisions.ts:1237` and three other files), and the 409 predicate written as a typed Drizzle join
rather than raw SQL, using the real `leaseIsLive`.

**Stage 2a — docs, done.** Seven files. It also found **where the false claim came from**:
`260826e § "A new revision only when the text changes"`, written 2026-08-26 and true then. The
schema comment restated it, `pg-revisions.ts` cited it as a *reason*, `pg.ts` built on it — and D1b
changed the implementation without anyone revisiting the sentence. Meanwhile
`docs/project/database.md:220` had it right all along: *"A `done` ending publishes the draft."*

**Stage 2b — done.** `tests/glossary-delete-then-rebuild.test.ts` drives the real claim/session
path — a real `jobs` row, `advanceJobWith` over the real `STEPS`, `openPgStoreSession`, a real
draft, the commit, the publication — with only `STEPS.glossary.run` stubbed, so no model call. Three
moves: an unforced run while the list is there **skips** (the control, without which "it ran after
the delete" proves nothing), the delete, then an unforced run that **runs the step and publishes a
new revision** serving the new terms. Red first both ways: with the delete removed, and with the
stub writing the old list back.

The four stale comments are corrected. `src/db/schema.ts` turned out to **contradict itself** — it
listed `hierarchy` among the four writing in place and then said `hierarchy` was not one of them.
Nobody had noticed.

**The browser check found the feature works and the reader still cannot tell.** `DELETE` answered
200, the list emptied, the job ran, the new glossary landed — and the panel never refreshed until a
manual reload. **Not this work's bug**: `trimFinished` deletes a success in the same call that marks
it done once an owner holds 50 failures, so no job is ever announced `done`, for any mode.
docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md —
which ranks the fix and says why it was not taken here.
