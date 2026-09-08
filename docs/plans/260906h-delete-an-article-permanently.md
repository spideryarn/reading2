# Delete an article permanently

**Status as of 2026-09-06: decided, not built** — evidence: no `DELETE /api/library/` in
`src/routes.ts`, and no `db.delete(articles)` anywhere under `src/` or `scripts/` (only
`tests/helpers/scratch-article.ts:335`).

## Goal

A reader can destroy one of their own articles, for good, from that article's metadata page. Today
the only ending an article has is Archive — `articles.archived_at`, a flag that hides a card and
erases nothing. Greg, 2026-09-06:

> We have a way to Archive documents, which is great. I think we also need a way to delete them
> permanently (probably only visible for now from within Metadata for that article, underneath
> Archive, with appropriate UI styling). Obviously be extra-careful to make sure that people can
> only delete articles they own, etc.

This is **the first irreversible act on a reader's own data in this product**, and the store was
built the other way round on purpose — `schema.ts` says *"Never a delete; Greg chose archive +
Undo"*. So the interesting content of this plan is not the `DELETE` statement, which is one line
and already proven in a test helper. It is the four things that statement does not do.

## References

Read these first; they are the reason most of the stages exist.

- [`docs/user-feedback/260904_1722-archive-an-article.md`](../user-feedback/260904_1722-archive-an-article.md)
  § *Permanent deletion: deferred, and here is the shape it should take* — the recorded design for
  this feature, written when Archive was renamed. Four failure modes, two questions left to Greg.
  **One of its recommendations is overruled below**; the rest is the backbone of this plan.
- [`docs/project/library.md`](../project/library.md) § *Archive, and Undo is the confirmation* —
  Greg's 2026-08-26 choice of archive over delete, why an archived article stays readable by direct
  link, and the line this feature crosses: *visibility controls whether the link works; archiving
  controls listings.*
- [`src/db/schema.ts:4272`](../../src/db/schema.ts) — the heading **"Deleting an article silently
  raises its owner's usage"**, written in anticipation of this feature. Stage B exists because of it.
- [`src/db/schema.ts:330`](../../src/db/schema.ts) (`article_visibility_changes`) and
  [`drizzle/0026_visibility_audit_survives_deletion.sql`](../../drizzle/0026_visibility_audit_survives_deletion.sql)
  — the takedown log was deliberately changed from `cascade` to `set null` *for* this feature.
- [`src/store/pg-glossary.ts:186`](../../src/store/pg-glossary.ts) `deleteGlossary` — the structural
  twin, and the shape Stage C copies: `requireSlug` first, one transaction, an `ownedSlug` +
  `for update` lookup, a live-job refusal, then the write.
- [`src/store/owned-slug.ts:45`](../../src/store/owned-slug.ts) `ownedSlug` — the owner check and the
  lookup as one SQL clause, so there is no window between "whose is it" and "change it".
- [`src/store/pg-billing.ts:70`](../../src/store/pg-billing.ts) — the lock order
  (`billing_accounts` before `articles`, everywhere) and `lockBillingAccount` at `:807`.
- [`src/store/blobs.ts`](../../src/store/blobs.ts) — the blob seam, `remove(key)` at `:86` (never
  called today), and the dedup contract Stage E has to work around.
- [`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) § `ArchiveArticle` (~:1612) — the component
  the new one sits under, and a long comment on why red was deliberately removed from this page.
- [`tests/owner-isolation.test.ts:1077`](../../tests/owner-isolation.test.ts) — the cross-owner
  suite, including the positive control at `:1176` without which a broken predicate looks identical
  to a working one.
- [`docs/project/billing.md:576`](../project/billing.md) — *"Archiving an article does not give the
  slot back."* Neither does deleting.

## Principles, key decisions

Five product calls, all Greg's, 2026-09-06.

1. **Immediate and irreversible.** No `deleted_at`, no 30-day purge. Archive *is* the grace period,
   and from the metadata page its undo never expires — a soft delete would be a second archive under
   another name, and the reader who wanted the thing gone would still have it.
   *Simpler option passed over:* `deleted_at` + a sweeper, which the archive note called "the boring
   option". Rejected because the boring option is already built and is called Archive.
2. **Metadata page only.** No Delete on the shelf card, not even in the *Show archived* disclosure.
   The shelf's buttons are hover-revealed and adjacent, and on a phone they are all tap targets.
3. **Not gated on Archive.** **This overrules the recorded recommendation** in the archive note,
   which wanted Delete offered only on an already-archived article so that "offer to just archive
   instead" became structural. Greg's call: a gate adds a greyed-out control that needs explaining
   and doubles the trip for the deliberate case, and the two-step confirm already buys the safety.
   The steering it was trying to do is done by one sentence of copy instead — *If you only want it
   off the shelf, Archive above does that and can be undone.*
4. **Delete the bytes too**, and therefore build reference counting — Stage E. The blobs are
   content-addressed and shared across articles *and across owners*, so this is the one part of the
   job where getting it wrong damages somebody else's library. It is last, and separately reviewed,
   for that reason.
   *Simpler option passed over:* leave the objects as orphans, which is what the archive note
   recommends (*"orphans are the safe failure; cross-owner deletion is the unsafe one"*) and what
   `raw_sources` § *No lifecycle, on purpose* records Greg choosing in 2026-08-27. Overruled by Greg
   on 2026-09-06: "permanently delete" over a PDF still sitting in our bucket is a claim the privacy
   page cannot make honestly.
   **Reopened and re-confirmed, 2026-09-06.** Sol's F1 showed the reference counting as first
   described is unsafe — counting and then removing is a race a second owner can lose — and that
   doing it safely means a blob catalogue with locking and a durable cleanup queue, plausibly larger
   than the rest of this feature. Fable then found that the honesty argument runs the other way:
   [`PrivacyPage.tsx:441`](../../src/web/PrivacyPage.tsx) has said since 2026-09-02 that *"we keep
   the original downloaded file, stored under a fingerprint of its own contents rather than under
   your name, so that if somebody else added the same document it is the same file and deleting your
   copy cannot take theirs"* — so the page never claimed the bytes go, and orphans would have kept a
   promise rather than broken one. Fable recommended withdrawing the decision.
   **Greg chose again, with the cost and that finding in front of him: build the catalogue.** The
   decision stands and Stage E is the catalogue. One consequence to carry: the privacy paragraph
   above becomes false in the other direction and must be rewritten — deleting your copy still
   cannot take somebody else's, but we will no longer keep the file when nobody is left referring
   to it.
5. **Deleting must not change what the reader owes.** `ingest_events.article_id` is `on delete set
   null` and quota is recomputed live from `coalesce(a.visibility,'private') = 'public'`, so today a
   delete would silently re-price a public article's ledger rows from half a unit to a full one and
   push the owner's usage *up*. Stage B stamps the price at charge time so it cannot move.
   *Simpler option passed over:* `schema.ts`'s own instruction — compute the delta and say what it
   will cost, as unsharing does. Rejected because a sentence explaining that deleting will use up
   more of your quota cannot be made to sound like anything but a bug. **The mechanism changed after
   Sol's F2** — stamping at *charge* time is the thing `billing.md` explicitly rejects, because it
   misprices every article shared or unshared later. The price is stamped at *delete* time instead,
   which touches nothing while the article is alive. The decision itself stands.

Two things that are **not** decisions, because the code already made them:

- **A non-owner's slug gets a 404, never a 403** — a 403 confirms the slug exists.
  `notFound` in [`src/store/pg.ts:145`](../../src/store/pg.ts).
- **The route performs no ownership check.** Authorisation is the `where` clause inside the one
  statement. A second check in the route is a second opinion that can disagree with the first.

## What survives a delete, deliberately

Named here because the confirmation copy has to be honest about it, and because a future agent will
otherwise read the gaps as bugs.

| Survives | Why |
|---|---|
| `ai_calls` (`article_id` → null, `article_slug` kept) | the cost ledger outlives everything |
| `ingest_events` (`article_id` → null) | the billing slot is **not** refunded |
| `article_visibility_changes` (`article_id` → null, `slug` kept) | takedown evidence about documents we no longer serve — changed to `set null` *for* this feature |
| `feedback` (`slug`, no FK) | a bug report naming the article |
| `raw_sources` rows | Stage E removes the object; the catalogue row is the audit of what was there |

## Risks, surfaced early

- ~~**`articles_current_revision_fk` is `NO ACTION` and not deferrable**~~ — **settled by the Stage A
  spike, 2026-09-06.** The single statement works; hand-deleting children first fails, and a
  transaction does not rescue it. See *What the spike found* below, which is now the authority.
- **Three tables are keyed by `slug` with no foreign key** and are invisible to the cascade:
  `jobs.slug` ([`schema.ts:1752`](../../src/db/schema.ts)), `uploads.slug` (`:1700`), `feedback.slug`
  (`:3531`). `jobs` also carries the `jobs_one_running_per_slug` and `jobs_reserved_slug` partial
  unique indexes, so leaving its rows behind means the reader cannot re-add the same URL afterwards.
- **The database will not refuse a delete mid-job.** Every FK declares an `onDelete`, so a running
  job's next write lands on a cascaded-away revision. That needs a query, not a constraint.
- **`src/web/lib/cached-shelf.ts:34` states in as many words that "Delete is archive, so nothing here
  can lose anything."** That sentence stops being true in Stage D, and a stale card that paints and
  then opens a 404 is the visible failure.
- **Article images have no `raw_sources` row** — deliberately
  ([`src/store/artifacts-pg.ts:235`](../../src/store/artifacts-pg.ts)). Their only references are the
  `assets` manifests inside `article_revisions`, which is JSON. So Stage E cannot refcount images the
  way it refcounts raw sources, and that asymmetry is the whole difficulty of that stage.

## Stages

Each ends with the tree green and safe to commit. Docs are updated in the same stage as the change,
not at the end. Every stage ends with a GPT Sol review — obligatory, two rounds maximum, then I
settle it and record any overrule here.

### Stage A — prove the delete is possible, and get this plan reviewed

- [x] Spike, in a scratch script against local Postgres: build a **fully populated** article — a
      published revision, blocks, block identities, comments, a chat thread with messages, a search
      run, criteria, claims, checkpoints, glossary lookups, link summaries, an `ai_calls` row, an
      `ingest_events` row, a visibility change, a `jobs` row — then run the one statement
      `delete from spideryarn.articles where id = $1` and report what happens.
      Reuse `tests/helpers/scratch-article.ts`; do not invent a second seeder.
- [x] Record which tables emptied, which kept a row with a null pointer, and — the point of the
      spike — whether `articles_current_revision_fk` complained.
- [ ] Send this plan to GPT Sol before any production code is written.
- [ ] Fold the verdict back into this doc.

Done looks like: a transcript showing the delete succeeding (or failing, which would reshape Stage
C), and Sol's review answered.

#### What the spike found, 2026-09-06

Seeded through `scratchArticleInPg` — the real load path, so a genuinely **published** revision and
a non-null `current_revision_id`, which is the whole risk — plus raw inserts for the leaf tables:
19 blocks, 19 identities, 9 step runs, and a row in every reader-state table.

**`delete from spideryarn.articles where id = $1` succeeded, `rowCount = 1`.**
`articles_current_revision_fk` did not complain. Everything with a cascading FK emptied. The four
`on delete set null` tables — `ai_calls`, `ingest_events`, `article_visibility_changes`,
`realtime_sessions` — each kept its row with `article_id` now null, individually confirmed.

**The positive control was observed red**, which is the half that makes the above worth believing.
Deleting children by hand first fails, and **a transaction does not rescue it** — these constraints
are `NOT DEFERRABLE`, so the check lands at end of *statement*, not end of transaction:

```
delete from spideryarn.article_revisions where article_id = $1
→ 23503 update or delete on table "article_revisions" violates foreign key constraint
  "articles_current_revision_fk" on table "articles"

begin;
  delete from spideryarn.block_identities where article_id = $1;   -- throws here
  delete from spideryarn.articles where id = $1;
→ 23503 … violates foreign key constraint "comments_identity_fk" on table "comments"
```

The same article then deleted cleanly with the single statement. **So Stage C must delete the
`articles` row in one statement and let the cascade run — tidying up children first is the thing
that breaks, and wrapping it in a transaction hides nothing and helps nothing.**

Four more `NO ACTION` composite FKs *between* cascade-children survive the single statement silently,
and are named here because they are the same class of trap for anyone who later tries to be tidy:
`comments_identity_fk`, `revision_blocks → block_identities`, `chat_threads → block_identities`,
`comments(article_id, criterion_id) → referee_criteria`.

**The one real gap the cascade leaves is an active job**, and it is sharper than the plan assumed.
Both slug indexes are partial:

```
jobs_reserved_slug        unique (slug) where status in ('queued','running') and reserves_name
jobs_one_running_per_slug unique (slug) where status = 'running'
```

Measured, by deleting the article and then re-adding the same slug:

| leftover job status | re-insert article | new job |
|---|---|---|
| `done` / `error` | ok | ok |
| `queued` / `running` | ok | **`23505 duplicate key value violates unique constraint "jobs_reserved_slug"`** |

So a terminal job is inert and can be left alone; a `queued` or `running` one left behind **blocks
the reader from ever re-adding that URL**, and is also an orphan the queue will still try to run.
`jobs_active_work` and `jobs_active_source` are partial on the same statuses and behave the same way.

This is not fully covered by the live-job refusal in Stage C step 4: the glossary query it copies
deliberately misses *a claimed job that has not opened its draft yet*. So step 5 must delete the
slug's non-terminal jobs rather than relying on the refusal to mean there are none.

`uploads` and `feedback` rows also survive with a stale `slug`, but neither has a unique index on it,
so they dangle harmlessly.

#### What Sol's plan review found, 2026-09-06

The full answer is
[260906h-delete-an-article-permanently-review-sol.md](260906h-delete-an-article-permanently-review-sol.md);
the prompt it answered is beside it. **Sol refused the plan** on three P0s. I checked every load-bearing
citation myself and all six findings stand — the first draft would have shipped incorrect charging,
a permanently leaked quota slot, and an article that could come back from the dead.

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| F1 | Stage E's count-then-remove can delete a blob another owner committed a reference to in between | P0 | **Accepted** — Greg chose to build the catalogue, 2026-09-06. Stage E rewritten |
| F2 | Stage B stamped the price at *charge* time, which `billing.md` explicitly rejects; share-later and unshare-later would both misprice | P0 | **Fixed** — stamp at *delete* time instead, Stage B rewritten |
| F3 | Stage C deleted active jobs, leaking their reservation for ever — reservations deliberately never expire | P0 | **Fixed** — refuse on a broad predicate, never delete an active job. Stage C 4–5 rewritten |
| F4 | Enqueue can race the delete and `lockOrCreateArticle` resurrects the article | P1 | **Fixed** — enqueue must lock the article row; barrier test. New Stage C item |
| F5 | Storage cleanup misses illustrated plates and upload staging keys, and a crash mid-loop is unknowable | P1 | **Accepted with F1** — durable cleanup tasks per object class, Stage E |
| F6 | Cache invalidation far too narrow, and the failure re-read can be answered from the offline copy and lie | P1 | **Fixed** — `forgetUser`, and a network-authoritative re-read. Stage D rewritten |

Two of Sol's open decisions are now settled and no longer open questions:

- **A public link to a deleted article returns 404, not 410.** A tombstone would break the
  deliberate indistinguishability of *absent* and *private* (`src/store/public-slug.ts:28`). Test the
  public page, the public API and public image URLs after a delete.
- **A private article's deletion needs no audit row.** A never-public article was never served to a
  stranger, so there is no takedown obligation to answer; an article that *was* public keeps its
  `article_visibility_changes` rows, which is exactly the evidence a late complaint needs
  (`schema.ts:316`).

Sol also confirmed that decision 3 — not gating delete on archive — creates no integrity hazard.
Archive was a speed bump, not a boundary.

### Stage B — deleting must not change the bill

Independent of everything else and useful on its own. **Rewritten after Sol's F2** — the first draft
stamped the price at charge time, which is the design
[`billing.md`](../project/billing.md#a-public-article-counts-half) explicitly rejects: *"charging half at add time misses the
article you decide to share three weeks later, which is most of them."* Usage must stay live while
the article exists, and freeze only when it stops existing.

- [x] Failing tests first, all three, watched red:
      - charge an `ingest_event` for a public article, delete the article, assert usage unchanged;
      - charge it private, then **share** it — usage must still fall;
      - charge it public, then **unshare** it — usage must still rise.
      The last two are the regression Stage B could so easily introduce.
- [x] Migration: add nullable `ingest_events.article_visibility_at_delete`. It is null for every
      existing row and for every live article, so it is not a second source of truth — it is only
      ever read once the article it described is gone.
- [x] Stamp it in a `BEFORE DELETE` trigger on `articles` rather than in the application, so it holds
      for every deletion path including a future admin one or a hand-run statement.
- [x] `usageSql` ([`src/store/pg-billing.ts:396`](../../src/store/pg-billing.ts)) and the admin
      public/private split ([`src/store/pg-admin.ts:533`](../../src/store/pg-admin.ts)) both become:

      coalesce(a.visibility, e.article_visibility_at_delete, 'private') = 'public'

      The live column still wins wherever there is one.
      **The two spellings are now one**, exported as `isPublicPrice` from `pg-billing.ts` and
      imported by `pg-admin.ts`: the constant was already there so the usage query and the offer
      query could not disagree about what "public" means, and that argument does not stop at the file
      boundary.
- [x] Update [`docs/project/billing.md`](../project/billing.md) (§ *Deleting an article freezes its
      price rather than moving it*) and the note at `schema.ts:4272`, which said no delete path
      exists.
- [x] `npm test`, `npm run typecheck`, `npm run check`. Mutate the new column's read and check the
      suite notices.
- [ ] Sol review. Commit.

**What landed, 2026-09-06.** `drizzle/20260906230500_ingest_events_freeze_price_at_delete.sql` — the
nullable column, a CHECK matching `articles_visibility`, and
`spideryarn.ingest_events_freeze_article_price()` on a `BEFORE DELETE` row trigger. The trigger is
drift drizzle's snapshot cannot see, the same class as the guards in `0001`, so
`tests/db-schema.test.ts` § *deleting an article freezes what it cost onto its charged rows* is its
guard. Behaviour is pinned in `tests/billing-half-units.test.ts` § *deleting an article freezes what
it cost, rather than repricing it*; the two spellings of the predicate in
`tests/billing-quota-sql.test.ts` and `tests/admin-queries.test.ts` § *the ingest ledger's half-price
split*.

### Stage C — the store method and the route

No UI. The whole of the destruction, reachable only by an API call.

- [x] Failing tests first, in the established places:
      - `tests/owner-isolation.test.ts` § *one owner's article, asked for by another* — "cannot be
        deleted by them": rejects 404 **and** re-select the row to prove it is still there. Keep the
        positive control at `:1176` honest by putting the owner-can-delete case in
        `tests/store-shelf-pg.test.ts` instead, so the isolation fixture survives.
      - `tests/store-slug-guard.test.ts` `STORES` — one line, so a pasted title is a 400 not a 404.
      - An HTTP-level case with the `reader()` harness at `tests/owner-isolation.test.ts:1378`,
        proving the gate is what fills the owner box.
      - A live-job refusal test: a queued job holding a draft ⇒ 409, nothing deleted.
      - **And the one that broke the first draft (Sol F3): a `queued` job with `draft_revision_id`
        still null, charged.** Assert 409, and assert the article, the job, the reservation and the
        computed usage are every one of them unchanged.
- [x] `ShelfStore.destroy(slug)` in [`src/store/contracts.ts`](../../src/store/contracts.ts),
      implemented in [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) beside `patch`, following
      `pgGlossaryStore.deleteGlossary` exactly:
      1. `requireSlug(slug)` before any query.
      2. One transaction. **`lockBillingAccount(ownerId)` first** — the lock order at
         `pg-billing.ts:70` is `billing_accounts` before `articles`, everywhere, and violating it is
         the documented deadlock cycle.
      3. `select … .where(ownedSlug(slug)).for("update")`; `if (!row) throw notFound(slug)`.
      4. **Refuse while any job is live, on the broad predicate.** Select and lock every job for
         this owner and slug whose status is `queued` or `running` — regardless of draft pointer or
         lease age. If any exists, 409 with a sentence, and delete nothing.
      5. **Never delete an active job** (Sol F3). The first draft did, to clear the
         `jobs_reserved_slug` collision Stage A measured; that would have leaked the job's quota slot
         for ever, because deleting a job deliberately does not touch its reservation
         (`schema.ts:1976`) and an unsettled reservation deliberately never expires
         (`schema.ts:4253`, itself Sol's call on 2026-09-02). Refusing at step 4 solves the
         collision too, since the reader stops the import and then deletes. Terminal rows
         (`done`/`error`) are inert — Stage A measured that — and stay as history; the cascade nulls
         their `article_id`. `queue_state.running_job_id` needs no clearing: its FK is already
         `on delete set null` (`schema.ts:2223`). **Leave the `uploads` row alone** — the first
         draft said to delete it, and deleting it destroys the only durable mapping to the staging
         key (`pg-uploads.ts:221`), which Stage E needs. See *What landed* below.
      6. `delete(articles).where(ownedSlug(slug))` — **one statement**, children left to the cascade.
      7. Return something the client can act on; never the deleted entry as though it still existed.
- [x] **Close the enqueue race (Sol F4).** Today the bare-slug ownership check happens before the
      job is built (`src/jobs.ts:2965`, `:3066`) and `enqueueOrGet` never locks the article
      (`src/store/pg-jobs.ts:704`). So: enqueue checks the article exists, delete commits, enqueue
      inserts, and the worker calls `lockOrCreateArticle` — which is documented to *create the row
      if it is missing* (`src/store/pg-revisions.ts:482`). The article comes back after a successful
      delete. Fix: every enqueue targeting an existing article must lock the owner-scoped article row
      and insert the job in one transaction, re-reading absence after the lock and returning 404
      rather than inserting. A barrier test must allow both legal orders and forbid
      "delete succeeded **and** the article later exists".
- [x] `DELETE /api/library/:slug` in `serveAuthenticatedApi`, reusing the existing `shelfEntry`
      pattern beside the PATCH at [`src/routes.ts:7106`](../../src/routes.ts). `slugPart`, no body,
      no ownership check in the route. Update the route index comment at the top of the file.
- [x] `npm test`, `npm run typecheck`, `npm run check`. Then mutate the finished code — drop the
      `for update`, drop the owner clause — and check the suite goes red for each.
- [ ] Sol review. Commit.

#### What landed, 2026-09-06

`ShelfStore.destroy(slug)` ([`src/store/contracts.ts`](../../src/store/contracts.ts),
[`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts)), `DELETE /api/library/:slug`
→ `{ destroyed: slug }` ([`src/routes.ts`](../../src/routes.ts)), and the article lock in
`tryEnqueue` ([`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts)) that closes F4. No UI.

Three things the plan did not say, found while building:

- **`lockBillingAccount` cannot be the first statement after all.** It *creates* the reader's
  billing row, so taking it before establishing the article is theirs means a request that is about
  to be refused writes a row on its way out — and for an owner id with no `auth.users` row that
  comes back as `23503` wearing a 500 rather than the 404 it is. Watched doing exactly that. The fix
  keeps the lock order intact: an **unlocked** `SELECT` refuses first, and a plain read takes no row
  lock, so it is outside the order and cannot be half of a cycle. The locked re-read after
  `lockBillingAccount` is still the authorising one.
- **The `uploads` row is left alone**, where step 5 said to delete it. Deleting it destroys the only
  durable mapping to the staging key ([`pg-uploads.ts`](../../src/store/pg-uploads.ts) § `forget`),
  and `uploads.slug` has no foreign key and no unique index, so a stale one dangles harmlessly.
  **Stage E therefore inherits a live `uploads` row rather than a cleanup task**: it must find the
  article's staging objects by asking `uploads` for rows whose `slug` names an article that no
  longer exists, and retire the row once the object is gone.
- **F4 is closed for the shape that needed it and deliberately not for the others.**
  `ticket.requiresArticle` is true only for `{ slug, steps }` — *run something on the article I
  already have*. A URL or an upload is a request to **have** an article, so `lockOrCreateArticle`
  creating the row is correct for those, and insisting on it would break a simultaneous double-paste
  that legitimately adopts a name from an in-flight job before any article row exists. Every enqueue
  still *takes* the lock; only that one shape refuses on absence.

#### Sol's Stage B code review, 2026-09-06 — passed, with three P2s

[The answer](260906h-delete-an-article-permanently-stage-b-review-sol.md). *"No refusal: I found no
established P0/P1. The supported lifecycle preserves live repricing and freezes the correct value at
deletion."* It could not break either charging invariant through supported operations — concurrent
visibility changes serialise on the article row, a rolled-back delete rolls back the stamp, and it
found no reverse lock path closing a cycle with Stage C's order.

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| F7 | The trigger's `UPDATE` and the FK's `SET NULL` both scan `ingest_events` unindexed — Postgres does not index the referencing side of a foreign key. Each delete scans the unbounded ledger twice; eventually deletion exceeds the runtime role's two-minute statement timeout | P2 | **Take it.** Partial index on `article_id where article_id is not null` |
| F8 | A plain `update ingest_events set article_id = null` loses the price without passing through the trigger. Not reachable from any TypeScript path today | P2 | **Take it.** A child-table trigger refusing non-null→null unless the price is already frozen — so if the article trigger ever drifts away, deletion fails loudly instead of quietly changing the bill |
| F9 | *"Not a second source of truth"* is tested, not enforced: the CHECK restricts the vocabulary only, so a live public article's row may carry a frozen `'private'`. No wrong bill today because the live value wins | P2 | **Take it.** Freeze *and* unlink in the same statement, then `check (article_id is null or article_visibility_at_delete is null)` makes the invariant structural rather than conventional |

F9 is the one worth reading twice: the plan claimed the two columns are never both readable, and that
claim was true of the code and not of the database. Making the trigger do both writes in one statement
is what turns a description into a constraint.

Explicitly *not* findings, having been put to it as suspicions: `SQLWrapper` is broad but both call
sites' generated predicates are tested; the behavioural test is an adequate trigger-drift guard
against a freshly migrated database; and **no safe backfill exists** for rows whose article was
deleted before the migration — their article identity is gone and slug is mutable, so full price is
the only non-gameable answer.

#### Stage B P2s applied, 2026-09-07

All three in one migration,
[drizzle/20260907200800_ingest_events_unlink_atomically.sql](../../drizzle/20260907200800_ingest_events_unlink_atomically.sql),
with a case each in `tests/db-schema.test.ts`. Each test was written first and watched fail against
the pre-migration schema, then each finished guard was mutated and the suite re-run to confirm it
noticed.

- **F7** — partial index `ingest_events_article_id_live` on `article_id where article_id is not
  null`. Declared in `src/db/schema.ts`, so it is in drizzle's snapshot; the test pins the `where`
  clause, which is the part an edit would drop silently. Removing the predicate turns it red.
- **F9** — `ingest_events_freeze_article_price` now sets `article_visibility_at_delete` **and**
  `article_id = NULL` in one `UPDATE`, and `check (article_id is null or
  article_visibility_at_delete is null)` enforces what the Stage B comments only claimed. The one
  statement is what makes the constraint satisfiable: a CHECK is evaluated as each row is written,
  so stamping first and letting the FK unlink afterwards would put **every** delete through the
  forbidden state. That is exactly what the mutation showed — reverting the function to stamp-only
  turns *"deleting an article freezes what it cost"* red with a
  `check constraint "ingest_events_frozen_only_after_unlink"` violation. The FK's `on delete set
  null` is untouched and now finds nothing, which is the backstop F8 needs.
- **F8** — `ingest_events_require_price_on_unlink`, `BEFORE UPDATE OF article_id`, raising `23514`
  when `article_id` goes non-null → null with no frozen price. It does not fire on the legitimate
  path, because that path carries the price in the same statement; the test asserts both halves,
  since a guard that also broke deletion would be found within the hour and one that quietly
  allowed the stray write would not.

**One thing to know about the migration as generated.** `db:generate` also emitted a `DROP`/`ADD` of
`revision_step_runs_step`, identical to the one
[drizzle/20260906190000_labels_step.sql](../../drizzle/20260906190000_labels_step.sql) had already
applied. It appeared because Stage B's snapshot was re-stamped by hand after the merge from a base
that predated `'labels'`, so the snapshot had lost a step name the database has. The DDL was removed
from the `.sql`; the snapshot beside this migration carries the correct list again, which is the
repair. Left in, it would have been a second full validation scan of an unrelated table.

**Correction to the review's framing of F7 — and then a correction to the correction.** The first
version of this paragraph said that with F9 in place the FK's `SET NULL` does no second pass at all,
so the delete costs "one scan, not two". Sol's next review took that apart (F29, P3): the referential
action still runs and still performs its own index-backed lookup — it simply finds nothing, because
the trigger has already nulled the rows in the statement before it.

So the accurate claim is the narrower one. **With F9 the FK still performs a second index-backed
lookup, but it visits no matching ledger tuples; only the trigger's `UPDATE` touches rows.** What F7
buys is that neither of those is a sequential scan of an unbounded table, which is the whole of why
the delete stops being a statement-timeout risk. Overstating it as "one lookup" was the sort of tidy
sentence that is easier to remember than the truth, which is why it is worth writing the truth down.

#### One mutation the behavioural tests do not catch, 2026-09-06

Dropping the owner clause from the `DELETE` statement itself — leaving everything else in
`destroy` intact — turns exactly **one** test red, and it is the static guard
*"so no store module resolves a slug without one"*, not any behavioural case.

That is not a defect, but it is worth writing down. `destroy` refuses a non-owner at the locked
re-read *before* it reaches the delete, so ownership is already established by the time the
statement runs; the `ownedSlug` on the delete is the second of two independently sufficient
layers, and a behavioural test cannot reach past the first to see it go. The static guard is
therefore the only thing holding that layer in place. **Do not delete that guard for looking
like a test of nothing**, and do not read "the isolation tests still pass" as evidence the
statement is still owner-scoped — it is not evidence, and this mutation is why.

#### Sol's Stage C code review, 2026-09-06 — refused

> "Refuse. No P0 found, but F20 is an established P1 and violates the 'must stay happened'
> contract."

The full review is
[260906h-delete-an-article-permanently-stage-c-review-sol.md](260906h-delete-an-article-permanently-stage-c-review-sol.md).
It cleared the things Stage C was built to get right — the early unlocked read is safe, both
owner predicates should stay, leaving `uploads` for Stage E is the right call, and there is no
lock cycle because enqueue takes only `articles` and never asks for `billing_accounts`
afterwards. What it found instead is that **Stage C's F4 fix guards the wrong seam**.

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F20 | P1, established | A retained terminal job can resurrect the article after deletion, via retry | Confirmed by me; **fix as proposed is wrong**, see below |
| F21 | P1, reasoned | Fresh URL adoption has the same hole: `requiresArticle` is derived from the request's shape, not from what the slug allocation *means* | Accepted |
| F22 | P2, established | The delete test asserts three child tables out of fourteen direct FKs and calls it "every child table" | Accepted |

##### F20, verified

`retryJob` copies the failed attempt's `url` or `upload` into the new request
([src/jobs.ts:3885](../../src/jobs.ts)), and `requiresArticle` is
`!request.url && !request.upload` ([src/jobs.ts:3084](../../src/jobs.ts)) — so **every retry of a
URL or upload ingest declares that it does not need an article**. `slugForRetry` deliberately
keeps the failed attempt's own slug, so the retry lands on exactly the destroyed name, `enqueueIn`
inserts it, and the worker's `lockOrCreateArticle` makes the row again.

`jobs` has **no `article_id` column at all** — jobs are keyed by slug — so nothing about deleting
an article touches its terminal jobs, and Stage C deliberately does not delete them (that is the
F3 fix). The reader can therefore do this sequentially, at leisure. It is not a race.

##### But Sol's fix (b) is not safe as written

The proposed closure is `requiresArticle: request.retryOf !== undefined || (!request.url && !request.upload)`
— i.e. *every* retry insists on an article. That collides with the case `slugForRetry`'s own
comment describes: **"a failed first ingest is neither"** on the shelf nor a live job
([src/jobs.ts:3529](../../src/jobs.ts)). `slugAlreadyHolding` asks exactly those two questions
([src/jobs.ts:3632](../../src/jobs.ts)), so an ingest that failed before its article existed mints
the old name with no article behind it — and under Sol's fix its retry would 404. Retrying a
first ingest that fell over is the commonest retry there is.

F21's remedy does not rescue this either. Preserving allocation provenance answers "adopted from
the shelf, so the article must be there", but a retry after a delete allocates as **minted** —
nothing holds the URL any more — which is the branch that is allowed to have no article.

So the discriminator both findings actually need is neither "is this a retry" nor "how was the
slug allocated", but **did the attempt this repeats ever get as far as creating an article** —
and, if it did, is that article still there. Before adopting any of this, settle whether an
`articles` row always exists by the time a job can reach `error` (`openOrBeginJobDraft` runs from
`pg-session.ts` when a stage's store is built, so a job that fails while `queued` may have none).
If it always exists, Sol's one-line fix is correct and cheap. If it does not, the honest fix
records on the job whether it created the article.

**Stage C does not commit until this is closed.**

#### Stage C, second pass — F20, F21 and F22 closed, 2026-09-07

Two changes, both small, and **neither of them is the fix Sol proposed for F20**.

##### The article's terminal jobs go with it (F20)

`pgShelfStore.destroy` now deletes this owner's `done`/`error`/`cancelled` jobs for the slug, in
the transaction that deletes the article and *after* the live-job refusal has established there
are no others. `deleteTerminalJobs` in [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) holds
the argument.

*The alternative considered and rejected*: **record on the job whether it ever created an
article** — the note above proposes this, and it is the honest discriminator. It needs a column, a
migration, and a write at `openOrBeginJobDraft`, and it buys a distinction nothing else in the
codebase wants. Deleting the rows removes the retry surface outright and needs no schema change.

*The thing that had to be established first*, because it is why Stage C refuses an active job
rather than deleting it: **can a terminal job still hold an unsettled reservation?** No, and it is
a property of the code rather than of the rows. There are four transitions into a terminal status
and each settles the slot in the same transaction — `settlingIfTerminal` wraps `releaseStep` and
`finish`, `requestCancel` settles on the branch that answers `cancelled`, `settleExpired` releases
everything its sweep ended, and `settleIn` succeeds the slot in the publishing transaction. F3's
leak belongs to an **active** job, which is still refused. `pgJobStore.forget` and `trimFinished`
have deleted terminal rows on exactly this reasoning since before F3 was written.

The cost, stated: a deleted article's job history goes too, so *Add* history loses those cards.
That is what `forget` already offers by hand, and the cards named an article that no longer exists.
The ledger is untouched — `ai_calls` keeps `article_slug`, `ingest_events` keeps the settled row,
and the test asserts the reader's computed usage does not move.

##### `requiresArticle` comes off the allocation, not off the request (F21)

`SlugAllocation` gains provenance, as Sol asked: `minted`, `adopted from: "shelf"`, or
`adopted from: "queue"`. `requiresArticle` is `insistsOnTheArticle(allocation)`, which is
`from === "shelf"` and nothing else. The lookup `freeSlug` takes now answers a `SlugHolder` pair
rather than a bare slug, because erasing *which kind of thing holds this address* at the lookup is
what made the fact unrecoverable later.

That closes F21 and also strengthens the retry path: a retry whose URL is still on the shelf now
insists on the article, where before it did not.

##### Where Sol was wrong, and the test that pins it

Sol's F20(b) — `requiresArticle: request.retryOf !== undefined || …` — is refused, for the reason
sketched above and now verified: an `articles` row is created when the worker opens its draft, not
at enqueue, so a job stopped or swept while still `queued` has none, and `jobWorthRetrying` offers
Retry on it. Under that rule, *paste a URL, press Stop, press Retry* would 404. There is a green
test standing on that sequence — tests/article-delete-pg.test.ts § *still lets a retry mint for an
attempt that never got as far as an article* — so the wrong fix cannot be reintroduced quietly.

##### The cascade test is derived from the schema (F22)

`articleForeignKeys()` in [`tests/store-shelf-pg.test.ts`](../../tests/store-shelf-pg.test.ts) walks
the drizzle schema for every foreign key pointing at `articles` — fourteen, ten `cascade` and four
`set null` — and the fixture now seeds a row in each. Three assertions, and the first two are what
stop the third going quietly vacuous:

1. the seeder's keys equal the schema's list exactly, so a fifteenth foreign key is a red test
   rather than a silence;
2. every table had a row of ours *before* the delete;
3. after it, no row anywhere points at the article — and the **total** row count fell by exactly
   the seeded rows for a `cascade` key and did not move for a `set null` one, which is the only
   way to tell the two apart.

Generic *insertion* is still by hand (every table has its own not-null columns and CHECKs); what is
no longer by hand is the list.

##### Evidence

Red first, in every case, and each fix mutated afterwards to check the suite notices.

| Finding | Watched red | Mutation that put it back red |
|---|---|---|
| F20 | *goes with the article, so a retry has nothing left to retry* — the `error`, `cancelled` and `done` rows all survived the delete | removing the `deleteTerminalJobs` call: 2 cases fail |
| F21 | *refuses rather than queueing a job that would rebuild what was deleted* — the enqueue resolved with a queued job on the destroyed slug | restoring `requiresArticle: !request.url && !request.upload`: 1 case fails |
| F22 | n/a (a coverage gap, not a defect) | dropping one table's seed → *referee_claims was never seeded*; dropping one key → the equality case fails; calling a `cascade` key a survivor → *comments is a deliberate survivor and lost a row* |

`npm run typecheck` clean. Green: `article-delete-pg`, `store-shelf-pg`, `jobs`,
`one-article-for-one-address`, `enqueue-owns-the-article`, `enqueue-drives-what-it-queues`,
`billing-admission`, `owner-isolation`, `retry-keeps-the-checkpoints`,
`retry-is-only-for-a-failed-job`, `retry-after-a-failed-refresh`, `pipeline-slug-claim`,
`job-state`, `owner-jobs`, `store-slug-guard`, `find-article`. The barrier case was run four times
for flakiness.

##### One thing Stage C left red, found on the way past

`tests/authenticated-api-route-contract.test.ts` had been failing since Stage C landed the route:
`EXPECTED_AUTH_ROUTES` never learned about `DELETE /api/library/:slug`, so five cases were red —
the contract-vs-source comparison, the guard-count canary, and three *"a method no matcher accepts
is the terminal 404"* rows that refuse to send a request the source would answer. Fixed by adding
`DELETE` to the `shelfEntry` matcher's methods and bumping `EXPECTED_GUARD_COUNT` 81 → 82. It is
outside the file list this pass was scoped to, but a red gate is a red gate.

The only other red in a full `npm run check` was `tests/chat-web-links.test.ts` §
*grows roughly linearly in the number of unclosed brackets*, a timing assertion; green on its own,
and it is the box.

##### Still open

- `uploads.slug` survives a delete, deliberately, for Stage E. `/add/upload/<id>` is a stale
  redirect afterwards; it cannot resurrect the article (an upload always mints a fresh slug), but
  it is a dead link until Stage E retires the row.
- `feedback.slug` survives, as the table above says.

#### Sol's Stage C code review, round two — refused, and all four findings taken

[The answer](260906h-delete-an-article-permanently-stage-c-review-2-sol.md). Round one (`a239fd83`)
removed the **sequential** resurrection surface: `destroy` deletes the article's terminal jobs in the
transaction that deletes the article, so Retry on a month-old failure has nothing left to retry. Sol
refused again on the two **concurrent** surfaces that leaves, and on the one state the schema permits
that the safety argument called impossible. All four stand and all four are closed.

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| F40 | An in-flight Retry survives the delete: `retryJob` reads the attempt on the pool, the delete takes attempt and article, and the retry inserts anyway because a mint insists on nothing | P1 | **Fixed**, Sol's shape — `retryOf` travels on the `EnqueueTicket`, and `enqueueIn` locks and requires that same-owner attempt after the article lock |
| F41 | `adopted from:"queue"` is the same shape: the provenance records only that *a* holder was seen, and it is stale by insert time | P1 | **Fixed**, Sol's shape — `SlugAllocation`'s queue branch carries the holder's job id, and the insert requires that exact job still to be active, under the article lock and only when the article is absent |
| F42 | Postgres permits a terminal job with an unsettled reservation, and `deleteTerminalJobs` erases the only job-to-slot provenance | P0 | **Fixed**, and it was cheap: one indexed query and a loud refusal, no schema change |
| F43 | Two comments in `pg-shelf.ts` still say terminal jobs survive | P3 | **Fixed** — both statements removed |

**F40 and F41 are one fix wearing two hats**, and naming it that way is what kept it small. Slug
allocation lets a request proceed because of *something it saw*: an article on the shelf
(`requiresArticle`, closed in round one), the attempt this repeats, or a live job minting this
address. Every one of those is a fact about the moment of the lookup, and the insert happens later.
So all three are re-asked inside the insert's own transaction, under the same article lock `destroy`
takes — `requireWhatTheAllocationLeanedOn` in [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts).
The holder's id now travels on `SlugAllocation` for the same reason `from` does: the fact is known
at the lookup and every attempt to recover it later is a guess.

Three decisions inside that, two of them departures from the answer:

- **Existence, not status, for the retried attempt.** Sol says *"lock and require that same-owner
  terminal source job"*. `retryJob` has already refused an attempt that is not terminal, and terminal
  is absorbing, so a status check here could only ever disagree with the one that already ran.
- **The queue-holder check is conditional on the article being absent**, which Sol's text says and is
  worth restating, because it is what stops the guard being a regression: a holder that finished by
  *publishing* leaves an article behind, and joining it then is an ordinary adoption.
- **A 409 for the queue case, not the retry's 404.** Nothing the reader named is missing — they
  pasted an address, and the thing it was joining stopped existing underneath them. Asking again
  works, and the sentence says so. The retry keeps 404 because that is the answer `retryJob` would
  have given a moment earlier: a race moves *when* an answer is discovered, not what it is.

**Both races are made deterministic rather than hoped for.** A third connection holds the `articles`
row, which is where `tryEnqueue` stops — after the allocation that has already read the thing it is
about to be wrong about, and before the insert. `expect(settled).toBe(false)` before the barrier
releases is the proof the window was entered; without it, an enqueue that had already finished would
go green on a fix it never exercised. The holder then commits the delete's own two statements from
inside its own transaction, so the state the enqueue resumes into is the state `destroy` commits — it
is spelled as SQL because `destroy` wants the very row lock the barrier is holding. Two positive
controls sit beside the two refusals: a holder that is really still there, and one that finished by
publishing. `tests/article-delete-pg.test.ts` § *what a delete can take out from under a request
already in flight*.

**F42 was taken even though it is not this feature's bug.** The exposure is pre-existing and shared
with `trimFinished` and `forget`, which have deleted terminal rows on the same assumption for weeks,
so Stage C introduced nothing. But the guard is one indexed query, needs no schema change, and makes
`destroy` strictly safer than the status quo, so there was nothing to trade. It **refuses rather than
settling**: the state is corrupt by hypothesis, so choosing to charge or to refund on the strength of
it is a bill nobody asked for in either direction, and silently repairing corruption is how it stops
being visible. The query locks nothing at all on a healthy article — the join is inner and the
predicate is *unsettled*, so nothing matches. `for update of jobs`, which is what a reviewer reaches
for, is a `42601`: drizzle qualifies the table with its schema and Postgres wants the alias alone.

##### The evidence, and why none of it counts yet

Each finding was watched red with its guard disabled — F40 and F41 both by *resolving*, with a
`queued` job standing on the destroyed slug, which is the resurrection itself rather than a proxy for
it — then green, then each fix mutated back and the suite watched to notice.

**All of that ran on 2026-09-08 between 01:12 and 02:11, on a box at load 80–240**, which a triage
agent then declared critically overloaded: swap full, the OOM killer already fired with postgres
invoking it, eighteen suites running across about twenty sessions, and every `vitest` process killed.
Two full-suite attempts died with `EXIT=143` without reaching a verdict. So **none of these numbers
are settled**, and they are written down here as claims to be re-checked rather than as results.

Two distinctions survive the caveat and are worth keeping:

- **The reds that are findings were semantic, not timeouts.** A promise that *resolves* with a queued
  job on a destroyed slug is not something contention manufactures. A killed run and a real failure
  look alike; a resolved-instead-of-rejected does not look like either.
- **`tests/pdf-integrity.test.ts` § "rejects partial cached record…" was red twice, including alone**,
  in a file whose import alone took 90 s. It touches no jobs, no shelf and no database, so it is
  almost certainly not ours — but it is **not a finding until it is re-run on a quiet box**, and it is
  written here so that it is not quietly forgotten either.

The order to re-run in, when the box is quiet: `tests/article-delete-pg.test.ts` first — 16 cases,
and all the new work lives in it.

##### Re-run on a recovered box, 2026-09-08 02:37–02:48 — all green

One file at a time, load checked between each and never above 40:

| | |
|---|---|
| `tests/article-delete-pg.test.ts` | **16/16** — the file that matters |
| `tests/store-shelf-pg.test.ts` | 35/35 |
| `tests/jobs.test.ts` | 65/65 |
| `tests/one-article-for-one-address.test.ts` | 4/4 |
| `tests/owner-isolation.test.ts` | 50/50 |
| `tests/authenticated-api-route-contract.test.ts` | 322/322 |
| `tests/metadata-delete-permanently.test.tsx` + `doc-links` | 46/46 |
| `npm run typecheck` | clean |

**`tests/pdf-integrity.test.ts` passes alone, 28/28**, so the twice-red case above was contention and
not a defect — which is why it was written down as a suspicion rather than a finding. That is the
whole value of the distinction: a red under load is not evidence, and the way to find out is to ask
again later rather than to argue about it.

`npm run check` in full is still owed, and is deliberately not run here: twenty-eight `vitest`
processes belonging to other sessions were live on the box at the time, and the last full-suite
attempt on a loaded box is what preceded the OOM sweep.

### Stage D — the control on the metadata page

- [ ] `DeletePermanently` under `ArchiveArticle`, in its own `Section` labelled **Delete this
      article**, last on the page. The same three-state discipline `ArchiveArticle` documents:
      never offer a button over a state we have not established, and refuse on the fixture.
- [ ] Two-step inline confirm, no modal — the page has no dialog component and
      `AccessSharing.tsx` records why. Press *Delete permanently*, the row is replaced in place by
      the question, the destroyed-things sentence and *Delete for ever* / *Keep it*. **The confirm
      button must not land where the trigger was**, or a double-click deletes.
- [ ] Copy, per [`docs/project/copy.md`](../project/copy.md) — reviewed by Fable, 2026-09-06:
      - Button at rest: **Delete permanently** (never bare "Delete", which for nine days meant
        archive). Working: **Deleting…**
      - Question: **Delete "{title}" for ever?** — the title in the question is the cheap 90% of
        type-the-title: it makes the reader read *which* article.
      - At rest: *This erases the article and everything you have done with it — your comments,
        notes, highlights, questions and chats, its summaries and hierarchy — and it cannot be
        undone. If you only want it off the shelf, Archive above does that and can be reversed.*
      - Plus, when shared: *It is shared, so anyone with the link will find nothing there afterwards.*
      - Plus the export offer, which the archive note asks for: a link to `GET /api/export/:slug`,
        turning an irreversible act into a recoverable one.
      - Failure after a re-read confirms it survived: **Couldn't delete it — {server message}. The
        article is still here, untouched.** If the re-read fails too: **Couldn't tell whether that
        worked. Reload the page.**
      - The 409: *An import is running on this article. Stop it first, then delete.*
- [ ] Styling: quiet at rest like Archive; **red only in the confirm step**, where *Delete for ever*
      is the one solid-destructive control on the page. That restores the meaning
      `ArchiveArticle`'s comment reserves for red — *this cannot be undone* — to the one thing on
      the page that cannot be undone. Update that comment, which currently says there is no
      destructive tint anywhere here.
- [ ] Afterwards: navigate to the library. And per the lesson in `ArchiveArticle`'s catch block — a
      lost response is not proof nothing happened — on failure re-read `/api/metadata/:slug`; a 404
      means it went, so navigate anyway. **But the re-read must be network-authoritative (Sol F6).**
      `apiFetch` answers a failed GET from the offline copy with a real `Response`, status 200 and
      `x-spideryarn-offline: copy` (`src/web/lib/api.ts:664`) — so the naive re-read would cheerfully
      report *"still here, untouched"* about an article that is gone. Only a fresh server 404 proves
      deletion and only a fresh server 200 proves survival; a transport failure or an offline copy
      proves neither and must fall through to **Couldn't tell whether that worked. Reload the page.**
- [ ] Cache: invalidating `/api/article/<slug>` and `/api/library` is not enough (Sol F6) — metadata,
      comments, chat, search, glossary and illustrated are all cacheable too
      (`src/web/lib/api.ts:834`), and `offline-store.ts:697` says stale data after a delete looks
      exactly like a delete that failed. Call `forgetUser(ownerId)`
      ([`offline-store.ts:718`](../../src/web/lib/offline-store.ts)) on confirmed deletion and retire
      the reader's whole cached set; per-article invalidation can replace it later. Fix the now-false
      claim in [`src/web/lib/cached-shelf.ts:34`](../../src/web/lib/cached-shelf.ts).
- [ ] Authenticated plates and assets are served `immutable` for a year (`src/routes.ts:605`, `:691`).
      Make those revalidate authorisation, and say plainly in the copy and in `privacy.md` that a
      copy already downloaded to a reader's own device cannot be recalled.
- [ ] The confirm button must never be auto-focused and must not inherit the trigger's keyboard
      activation, and must not be reachable from metadata we only have an offline copy of (Sol).
- [ ] Component tests. Then drive a real browser in a Sonnet subagent — tests going green is not
      evidence a reader can see it.
- [ ] Docs: [`library.md`](../project/library.md) (a section for delete beside Archive, and the
      overrule in decision 3 recorded), [`privacy.md`](../project/privacy.md) (what a reader can
      actually get rid of), [`copy.md`](../project/copy.md), and the archive feedback note, whose
      recommendation was overruled.
- [ ] Sol review. Commit.

#### The browser pass, 2026-09-07 — two things no component test saw

Playwright against system Chrome on the box, signed in, on a dev server of its own. Two scratch
articles created by pasting a real URL through `/add` and deleted again, so nothing anybody else
owns was touched.

**The question named nothing.** It rendered `Delete “” for ever?`. An article whose extraction
produces no title carries `""` and not null — an ordinary URL paste did it — so `meta.title ?? slug`
kept the empty string. The one safeguard in that sentence is that the reader reads *which* article,
and on any untitled article it had silently become empty quotes. Fixed to `meta.title?.trim() || slug`,
with two cases pinning it; renaming the article through the page's own title editor and watching the
heading fill in is what proved it was the fallback rather than the wiring. **Twenty-two green tests
never saw this because every fixture in the file had a title** — the defect lives exactly where the
fixture was convenient.

**The confirm is nowhere near the trigger, and now that is measured rather than argued.** At
1280×900 the trigger sits at y 705.06 and *Delete for ever* at y 897.06: vertical overlap **0.0 px**,
gap **158 px**; at 390×844 the gap is **278 px**. `elementFromPoint` at the trigger's old centre
returns the question heading, and a real `mouse.dblclick` on the trigger left the article alive. The
structural assertion in the component tests was a sound proxy, and this is the thing jsdom could
never answer. Worth knowing: the guard is purely **vertical** — the confirm's x-range sits inside the
trigger's.

**Red really is only in the confirm step, and proving it needed painted pixels.** A computed-style
check cannot see this: the token resolves to `oklab(…)`, which neither an `oklch` regex nor
`canvas.fillStyle` converts, so two scans reported "no red" in both states — a
[silent success](../reusable/silent-success.md) in the check rather than in the code. Counting red
pixels in full-page screenshots: 428 at rest (warm accent text and links), 3721 in the confirm, and
the extra 3156 are one contiguous band exactly the confirm button's box. Contrast 7.03:1.

##### Open, and Greg's to decide: what a deleted article's own URL should say

Going back to `/read/<slug>` after deleting renders **"Not shared — This document isn't shared. If
somebody sent you the link, ask them to turn sharing on for it."** The owner who just destroyed it is
being told to ask *them* to turn sharing on.

This is not a bug in Stage D and the obvious fix is not obviously right. The API returns **404 for a
non-owner, never 403**, deliberately — that conflation is a security property, so after a reload the
client genuinely cannot tell "deleted" from "not yours", and a page that says "this article is gone"
would be claiming knowledge it does not have. The honest change is a neutral wording that serves both
readings — *this isn't available; it may have been deleted, or never shared with you* — on a page
strangers see, which is why it is recorded here rather than changed on the way past.

Not checked by the browser pass: keyboard activation held on the trigger, and where focus lands after
the swap.

#### Sol's review of the built control, 2026-09-08 — REFUSE, and the six it named

The plan-stage review could not have found most of these: they are about the transitions the built
component makes *after* a press, which is why the second review is weighted higher than the first.
The verdict in full is
[…-stage-d-review-sol.md](260906h-delete-an-article-permanently-stage-d-review-sol.md). Every one
below was reproduced as a failing test before it was fixed, and each fix was then mutated back to
confirm the suite notices — 24 cases became 32.

- **F23 — a failed *refresh* left deletion offered.** `readProvenance` deliberately keeps the
  previous `provenance` when a revalidation fails, so the reader does not watch the page empty out
  over one lost request. `DeletePermanently` therefore reached `known=true, failed=true` — a state
  the first load cannot produce, which is exactly why the existing failed-load test (it starts from
  `provenance === null`) never saw it — and its refusal branch tested only `!known`. Now
  `!known || failed`. Reaching that state in a test needs a real second read, and the only lever
  that fires one is a *Generate it again* row's job coming back `done`, driven through
  `jobEngine.receive` the way `tests/metadata-rerun-section.test.tsx` does it. `ArchiveArticle` has
  the same exposure and keeps it: Archive is reversible, which is the whole difference.

- **F24 — `res.ok` is five statuses and the comment claimed one.** `stillOnTheServer`'s own header
  says only a fresh server 200 proves survival; the code also took 201, 202, 204 and 206, so a
  `204 No Content` re-read made the page say *"still here, untouched"* about an article that had
  just been destroyed. Now `404 → gone`, `200 → here`, everything else `unknown`.

- **F25 — the route's confirmation was parsed and thrown away.** `DELETE /api/library/:slug` answers
  `{ destroyed: slug }`, and the client believed the *status*. `readJson` deliberately turns an empty
  successful body into `{}`, so a `204`, a `{}`, or a body naming a **different** article all read as
  a confirmed deletion — cache retired, reader navigated away, every success assertion still green.
  The [silent success](../reusable/silent-success.md) shape, in the one place that cannot be walked
  back. The client now requires the answer to name this slug, and the refusal falls into the same
  authoritative re-read as any other failure — so a route that really did delete and merely answered
  oddly still ends with the reader in their library, by evidence rather than by assumption.

- **F26 — the honest sentence was printed under a live button.** When the delete outcome *and* the
  re-read were both inconclusive, the control set *"Couldn't tell whether that worked"* and then put
  `busy` back to false with `asking` still true, so *Delete for ever* stood enabled directly beneath
  an admission that we could not say whether the article still existed. The component's own rule,
  broken in its own error path. There is now an explicit `uncertain` state rendering the sentence and
  **no controls at all** — not the confirm, not *Keep it*, and not the trigger, which would only
  invite a second DELETE. It is `ArchiveArticle`'s `at === undefined` branch, borrowed, and it is
  checked before the offline and unknown branches because it is the only claim on the card about what
  we may already have *done* rather than about what we know.

- **F27 — accepted in part, and the rest declined on purpose.** Sol asked for the DELETE, the re-read
  and the cache retirement to be bound to one captured principal. The half worth having is the cache:
  `forgetCachedReader` looked the reader up *after* the delete had settled, so a direct A→B sign-in
  inside that window emptied B's drawer and left A's holding a card for an article that no longer
  exists — which paints on A's next visit and opens a 404, the exact thing `cached-shelf.ts` says
  nothing here may go on doing. Silent and durable, and closing it cost one argument: the reader is
  captured before the DELETE and handed in.

  The other half is declined. Using one credential for both requests means letting a caller pass a
  token into `apiFetch`, whose header argues at length that the token must be fetched per request and
  never remembered — bfcache, backgrounded tabs and refresh races all depend on it. That is a new
  seam in the app's single auth chokepoint, for one control, against a race that needs an account
  switch to land inside a single round trip. And Sol's *"do not navigate or report an outcome into
  the new reader's UI"* looks worse than what it replaces: reader B would be left sitting on the
  metadata page of somebody else's destroyed article reading an error about it, where the library is
  a neutral place to be. The honest limit is written into `cached-shelf.ts`: the capture narrows the
  window to the moment before the request rather than closing it.

- **F28 — `privacy.md` told two stories about its own page.** One paragraph said `PrivacyPage.tsx`
  caught up on 2026-09-07 (it did — `0ced1d69`); two bullets in the watch-list seventy lines later
  still said the page "has not been rewritten yet" and was "overdue". The bullets were the stale
  half. They now say what is genuinely open — account deletion is still a mailbox, and export has had
  a button for a while and has never been mentioned on the page either way — and the Archive bullet
  became a bullet about *both* controls and the difference between them.

- **F29 (P3)** is answered above, in the Stage B P2 section it corrects.

`copy.md` gained the two sentences this changed: the *"did not confirm"* refusal, which reaches the
reader wrapped in the ordinary *Couldn't delete it —* line, and the note that the *"cannot tell"*
sentence now stands with nothing underneath it.

**Not re-checked in a browser.** The new branch is a paragraph in the existing card, reached only by
a failed delete followed by a failed re-read — a state the 2026-09-07 pass could not have produced
either.

### Stage E — the bytes, by way of a blob catalogue

Last, and separately reviewed, because this is the only stage where a bug damages a reader who did
not ask for anything. **Greg confirmed decision 4 on 2026-09-06 knowing the cost**, so this is the
catalogue, not orphans.

**Big enough that it may want its own plan doc and its own Sol review before a line is written.**
Sketch the schema first, send *that* to Sol, and only then build. What follows is the shape F1(b)
and F5(b) prescribe, not a finished design.

Why counting is not enough, in one paragraph. Blobs are content-addressed and deduplicated **across
owners**, and bytes are written before and outside the transaction that records the reference
([`src/store/artifacts-pg.ts:1015`](../../src/store/artifacts-pg.ts)). So count-then-remove is a race
Alice loses to Bob: Alice counts zero, Bob ingests identical bytes and commits a reference, Alice
removes the object, Bob's article points at nothing.
[`src/store/blobs.ts:375`](../../src/store/blobs.ts) already documents this exact class and says the
seam has no serialisation to fix it with. Article images, PDF figures and illustrated plates make it
worse: they have **no catalogue row at all**, only `assets` and `illustrated` manifests inside
`article_revisions`, so there is nothing to count and nothing to lock.

- [ ] **One catalogue for every canonical blob class** — raw sources, article assets, PDF figures,
      illustrated plates — not one per class. A second refs table records which revision refers to
      which object. `raw_sources` becomes a view onto it or is folded into it; its header says rows
      are never deleted, so changing that is a decision to record rather than a detail.
- [ ] **Writers and deleters lock the same catalogue row.** The catalogue row must be inserted or
      locked in the *same transaction* that commits the reference — which means moving the reference
      commit and the catalogue write together, since today the bytes land first and outside.
- [ ] **No free-standing count followed by `remove`.** When the deleting transaction retires the last
      reference it marks the object `pending_delete` and commits a durable cleanup task in the same
      transaction. A writer that meets `pending_delete` waits or retries after ensuring the bytes are
      restored, and may **never** commit a reference to an object still scheduled for deletion.
- [ ] **The cleanup queue is durable and idempotent** (F5). A crash after commit and before removal
      must leave retryable work, not an unknowable partial state. A storage failure is pending work,
      never a discarded logged orphan. Every object class gets a task: the raw source, every stored
      asset and PDF figure, every successful illustrated plate
      ([`schema.ts:851`](../../src/db/schema.ts),
      [`src/illustrated-image.ts:107`](../../src/illustrated-image.ts)), and the upload staging key.
      **Stage C hands that one over by not touching it**: the `uploads` row survives the delete with
      its `slug` naming an article that no longer exists, which is the mapping to the staging key
      ([`pg-uploads.ts:221`](../../src/store/pg-uploads.ts)) and is exactly the predicate this stage
      can sweep on. Retire the row once the object is gone; staging keys wait for the existing
      upload-grant sweep predicate to say removal is safe.
- [ ] **Backfill by scanning the manifests** — that is what scanning is for. It is a migration and a
      consistency check, never the live arbitration mechanism.
- [ ] **The barrier test is the point of the stage.** Race a second owner's reference commit against
      a delete and prove every committed reference still resolves. The sequential two-owner test in
      the first draft cannot exercise this and is not sufficient on its own — keep it as the cheap
      case and add the race.
- [ ] If cleanup is asynchronous, the API and the UI must distinguish *article access deleted;
      storage cleanup pending* from *every retained server copy removed*, rather than claiming the
      second while doing the first.
- [ ] Docs: [`privacy.md`](../project/privacy.md) and
      [`PrivacyPage.tsx:441`](../../src/web/PrivacyPage.tsx) — the live page currently promises we
      keep the original file for ever, which this stage makes false; rewrite it to say the file goes
      once nobody refers to it, and that deleting your copy still cannot take somebody else's. Plus
      the `raw_sources` header and the `article_revisions_raw_source_fk` comment
      (`schema.ts:1047`, `:2338`).
- [ ] Sol review of the schema **before** building, and again of the code. Commit, push, and check
      the worktree is safe to remove.

## Open questions

None blocking. Settled since the first draft: the public link 404s rather than 410s; a private delete
needs no audit row; and decision 4 was reopened after Sol's F1 and Fable's privacy-page finding, and
re-confirmed by Greg — Stage E builds the catalogue. All three are recorded under *What Sol's plan
review found* and in decision 4.

Carried into Stage E rather than answered here: whether it wants its own plan doc, and whether
`raw_sources` becomes a view onto the new catalogue or is folded into it.
