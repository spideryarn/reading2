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
5. **Deleting must not change what the reader owes.** `ingest_events.article_id` is `on delete set
   null` and quota is recomputed live from `coalesce(a.visibility,'private') = 'public'`, so today a
   delete would silently re-price a public article's ledger rows from half a unit to a full one and
   push the owner's usage *up*. Stage B stamps the price at charge time so it cannot move.
   *Simpler option passed over:* `schema.ts`'s own instruction — compute the delta and say what it
   will cost, as unsharing does. Rejected because a sentence explaining that deleting will use up
   more of your quota cannot be made to sound like anything but a bug.

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

- **`articles_current_revision_fk` is `NO ACTION` and not deferrable**
  ([`drizzle/0001_auth_fks_and_guards.sql:33`](../../drizzle/0001_auth_fks_and_guards.sql)). A
  single-statement `DELETE FROM articles` survives it only because `NO ACTION` is checked at end of
  statement. Deleting children by hand first, or splitting into two statements, breaks it. **Stage A
  proves this against a fully-populated article rather than trusting the reasoning.**
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

- [ ] Spike, in a scratch script against local Postgres: build a **fully populated** article — a
      published revision, blocks, block identities, comments, a chat thread with messages, a search
      run, criteria, claims, checkpoints, glossary lookups, link summaries, an `ai_calls` row, an
      `ingest_events` row, a visibility change, a `jobs` row — then run the one statement
      `delete from spideryarn.articles where id = $1` and report what happens.
      Reuse `tests/helpers/scratch-article.ts`; do not invent a second seeder.
- [ ] Record which tables emptied, which kept a row with a null pointer, and — the point of the
      spike — whether `articles_current_revision_fk` complained.
- [ ] Send this plan to GPT Sol before any production code is written.
- [ ] Fold the verdict back into this doc.

Done looks like: a transcript showing the delete succeeding (or failing, which would reshape Stage
C), and Sol's review answered.

### Stage B — deleting must not change the bill

Independent of everything else and useful on its own.

- [ ] Failing test first: charge an `ingest_event` for a public article, delete the article row,
      assert the owner's usage is unchanged. Watch it go red.
- [ ] Migration: stamp the price onto `ingest_events` at charge time — a column recording whether the
      article was public when the unit was charged — so `usageSql`
      ([`src/store/pg-billing.ts:396`](../../src/store/pg-billing.ts)) stops depending on a row that
      can vanish. Backfill from the live join so existing rows keep their current price.
- [ ] Update `usageSql` and the admin public/private split
      ([`src/store/pg-admin.ts:533`](../../src/store/pg-admin.ts)), which has the same dependency.
- [ ] Update [`docs/project/billing.md`](../project/billing.md) and the note at `schema.ts:4272`,
      which currently says no delete path exists.
- [ ] `npm test`, `npm run typecheck`, `npm run check`. Mutate the new column's read and check the
      suite notices.
- [ ] Sol review. Commit.

### Stage C — the store method and the route

No UI. The whole of the destruction, reachable only by an API call.

- [ ] Failing tests first, in the established places:
      - `tests/owner-isolation.test.ts` § *one owner's article, asked for by another* — "cannot be
        deleted by them": rejects 404 **and** re-select the row to prove it is still there. Keep the
        positive control at `:1176` honest by putting the owner-can-delete case in
        `tests/store-shelf-pg.test.ts` instead, so the isolation fixture survives.
      - `tests/store-slug-guard.test.ts` `STORES` — one line, so a pasted title is a 400 not a 404.
      - An HTTP-level case with the `reader()` harness at `tests/owner-isolation.test.ts:1378`,
        proving the gate is what fills the owner box.
      - A live-job refusal test: a queued job holding a draft ⇒ 409, nothing deleted.
- [ ] `ShelfStore.destroy(slug)` in [`src/store/contracts.ts`](../../src/store/contracts.ts),
      implemented in [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) beside `patch`, following
      `pgGlossaryStore.deleteGlossary` exactly:
      1. `requireSlug(slug)` before any query.
      2. One transaction. **`lockBillingAccount(ownerId)` first** — the lock order at
         `pg-billing.ts:70` is `billing_accounts` before `articles`, everywhere, and violating it is
         the documented deadlock cycle.
      3. `select … .where(ownedSlug(slug)).for("update")`; `if (!row) throw notFound(slug)`.
      4. Refuse while a job is live — reuse the shape of `liveJobHoldingADraftQuery`
         (`pg-glossary.ts:164`) and `refuseIfAJobIsInside` (`tests/helpers/forget-revisions.ts:42`);
         409 with a sentence, not a code.
      5. Delete the `jobs` rows for the slug (frees `jobs_one_running_per_slug` /
         `jobs_reserved_slug` so the URL can be re-added) and clear `queue_state.running_job_id` if
         it names one. Delete the `uploads` row — but **not** its staging object, per
         `pg-uploads.ts:221`.
      6. `delete(articles).where(ownedSlug(slug))` — **one statement**, children left to the cascade.
      7. Return something the client can act on; never the deleted entry as though it still existed.
- [ ] `DELETE /api/library/:slug` in `serveAuthenticatedApi`, reusing the existing `shelfEntry`
      pattern beside the PATCH at [`src/routes.ts:7106`](../../src/routes.ts). `slugPart`, no body,
      no ownership check in the route. Update the route index comment at the top of the file.
- [ ] `npm test`, `npm run typecheck`, `npm run check`. Then mutate the finished code — drop the
      `for update`, drop the owner clause — and check the suite goes red for each.
- [ ] Sol review. Commit.

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
      means it went, so navigate anyway.
- [ ] Cache: invalidate `/api/article/<slug>` **and** `/api/library` via
      [`src/web/lib/offline-store.ts:712`](../../src/web/lib/offline-store.ts), and fix the
      now-false claim in [`src/web/lib/cached-shelf.ts:34`](../../src/web/lib/cached-shelf.ts).
- [ ] Component tests. Then drive a real browser in a Sonnet subagent — tests going green is not
      evidence a reader can see it.
- [ ] Docs: [`library.md`](../project/library.md) (a section for delete beside Archive, and the
      overrule in decision 3 recorded), [`privacy.md`](../project/privacy.md) (what a reader can
      actually get rid of), [`copy.md`](../project/copy.md), and the archive feedback note, whose
      recommendation was overruled.
- [ ] Sol review. Commit.

### Stage E — the bytes

Last, and separately reviewed, because this is the only stage that can damage another reader's
library.

- [ ] Establish the reference counts, and write the test that proves the counting is real: two
      articles — **two different owners** — sharing one `sha256`; delete one; assert the object
      survives and the other article still opens. Then delete the second and assert the object goes.
- [ ] Raw sources: count remaining `article_revisions.raw_source_sha256` references before calling
      `RawSourceStore.remove` ([`src/store/blobs.ts:86`](../../src/store/blobs.ts) — never called
      today). Decide whether the `raw_sources` catalogue row goes with the object or stays as the
      audit of what was there; the table's header says rows are never deleted, so changing that is a
      decision to record, not a detail.
- [ ] Article images and PDF figures: **there is no catalogue row per image** — the only references
      are the `assets` manifests inside `article_revisions`. Work out with Sol whether to add a
      catalogue, scan the manifests, or leave images as orphans in v1 and say so. This is the open
      technical question of the stage and it is deliberately not pre-answered here.
- [ ] Deletion of objects happens **after** the transaction commits, never inside it — a rolled-back
      transaction that has already removed bytes is unrecoverable. A failed object delete is a
      logged orphan, not a failed request.
- [ ] Docs: [`privacy.md`](../project/privacy.md) — this is the stage that makes "permanently
      delete" a true claim about bytes rather than about rows — plus the `raw_sources` header, which
      currently says nothing ever deletes one.
- [ ] Sol review. Commit, push, and check the worktree is safe to remove.

## Open questions

- **What should a public link to a deleted article do?** Left open by the archive note. `publicSlug`
  will simply 404, which is probably right and needs confirming rather than designing.
- Whether a private article's deletion needs its own audit row. `article_visibility_changes` only
  has rows if the article was ever shared, so today a private delete leaves no trace at all.
