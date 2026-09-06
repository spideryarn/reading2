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
   **Reopened 2026-09-06 after Sol's review.** Reference counting as described is unsafe — counting
   and then removing is a race a second owner can lose — and doing it safely means a blob catalogue
   with locking and a durable cleanup queue, which is plausibly larger than the rest of this feature.
   Greg is choosing again with the cost visible. See Stage E.
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
| F1 | Stage E's count-then-remove can delete a blob another owner committed a reference to in between | P0 | **Open — Greg's call.** See Stage E |
| F2 | Stage B stamped the price at *charge* time, which `billing.md` explicitly rejects; share-later and unshare-later would both misprice | P0 | **Fixed** — stamp at *delete* time instead, Stage B rewritten |
| F3 | Stage C deleted active jobs, leaking their reservation for ever — reservations deliberately never expire | P0 | **Fixed** — refuse on a broad predicate, never delete an active job. Stage C 4–5 rewritten |
| F4 | Enqueue can race the delete and `lockOrCreateArticle` resurrects the article | P1 | **Fixed** — enqueue must lock the article row; barrier test. New Stage C item |
| F5 | Storage cleanup misses illustrated plates and upload staging keys, and a crash mid-loop is unknowable | P1 | **Open with F1** — same decision |
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
[`billing.md`](../project/billing.md#L617) explicitly rejects: *"charging half at add time misses the
article you decide to share three weeks later, which is most of them."* Usage must stay live while
the article exists, and freeze only when it stops existing.

- [ ] Failing tests first, all three, watched red:
      - charge an `ingest_event` for a public article, delete the article, assert usage unchanged;
      - charge it private, then **share** it — usage must still fall;
      - charge it public, then **unshare** it — usage must still rise.
      The last two are the regression Stage B could so easily introduce.
- [ ] Migration: add nullable `ingest_events.article_visibility_at_delete`. It is null for every
      existing row and for every live article, so it is not a second source of truth — it is only
      ever read once the article it described is gone.
- [ ] Stamp it in a `BEFORE DELETE` trigger on `articles` rather than in the application, so it holds
      for every deletion path including a future admin one or a hand-run statement.
- [ ] `usageSql` ([`src/store/pg-billing.ts:396`](../../src/store/pg-billing.ts)) and the admin
      public/private split ([`src/store/pg-admin.ts:533`](../../src/store/pg-admin.ts)) both become:

      coalesce(a.visibility, e.article_visibility_at_delete, 'private') = 'public'

      The live column still wins wherever there is one.
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
      - **And the one that broke the first draft (Sol F3): a `queued` job with `draft_revision_id`
        still null, charged.** Assert 409, and assert the article, the job, the reservation and the
        computed usage are every one of them unchanged.
- [ ] `ShelfStore.destroy(slug)` in [`src/store/contracts.ts`](../../src/store/contracts.ts),
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
         `on delete set null` (`schema.ts:2223`). Delete the `uploads` row — but see Stage E, which
         now owns its staging object rather than abandoning it.
      6. `delete(articles).where(ownedSlug(slug))` — **one statement**, children left to the cascade.
      7. Return something the client can act on; never the deleted entry as though it still existed.
- [ ] **Close the enqueue race (Sol F4).** Today the bare-slug ownership check happens before the
      job is built (`src/jobs.ts:2965`, `:3066`) and `enqueueOrGet` never locks the article
      (`src/store/pg-jobs.ts:704`). So: enqueue checks the article exists, delete commits, enqueue
      inserts, and the worker calls `lockOrCreateArticle` — which is documented to *create the row
      if it is missing* (`src/store/pg-revisions.ts:482`). The article comes back after a successful
      delete. Fix: every enqueue targeting an existing article must lock the owner-scoped article row
      and insert the job in one transaction, re-reading absence after the lock and returning 404
      rather than inserting. A barrier test must allow both legal orders and forbid
      "delete succeeded **and** the article later exists".
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

### Stage E — the bytes — **blocked on a product decision**

Last, and separately reviewed, because this is the only stage that can damage another reader's
library. **Sol's F1 and F5 say the design in the first draft is unsafe and the safe version is
large**, so this stage is not startable until Greg picks a route. Stages B, C and D do not depend on
the answer; only Stage D's copy does, and only in one sentence.

The problem, in one paragraph. Blobs are content-addressed and deduplicated **across owners**, and
bytes are written before and outside the transaction that records the reference
(`src/store/artifacts-pg.ts:1015`). So counting references and then removing the object is a race
Alice can lose to Bob: Alice counts zero, Bob ingests identical bytes and commits a reference, Alice
removes the object, Bob's article now points at nothing. `src/store/blobs.ts:375` already documents
this exact class and says the seam has no serialisation to fix it with. Article images, PDF figures
and illustrated plates make it worse: they have **no catalogue row at all**, only `assets` manifests
inside `article_revisions`, so there is nothing to count and nothing to lock.

The two routes:

- **Safe and small — leave the bytes, and say so.** Delete every row; leave the objects as orphans.
  This is what the archive post-mortem originally recommended: *"orphans are the safe failure;
  cross-owner deletion is the unsafe one."* Cost: near zero. Price: decision 4 is withdrawn and the
  copy must not claim the bytes are gone, only the article and everything the reader did with it.
- **Safe and large — build the catalogue.** One catalogue/ref table covering every canonical blob
  class (raw sources, assets, PDF figures, illustrated plates). Writers and deleters lock the same
  catalogue row; the deleting transaction marks the last-reference object `pending_delete` and
  commits a durable cleanup task; a writer may never commit a reference to an object marked
  `pending_delete`. A barrier test races a second owner's write against the delete. This also
  answers F5 — upload staging keys and illustrated plates get cleanup tasks instead of being
  abandoned, and a failed removal is pending work rather than a discarded log line.

Whichever way it goes: [`privacy.md`](../project/privacy.md) has to say what is true, and the
`raw_sources` header currently says nothing ever deletes one.

## Open questions

- **Stage E: orphans or a catalogue?** The one live decision. See Stage E.

Settled since the first draft: the public link 404s, and a private delete needs no audit row — both
recorded under *What Sol's plan review found* above.
