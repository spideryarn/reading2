# Review: the delete control a reader presses, and three enforcement fixes beneath it

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently`, branch
`worktree-delete-article-permanently`. TypeScript + ESM, Postgres via Drizzle (schema `spideryarn`),
React web client, Vite. This is a **code review of committed work**.

## The candidate

Two commits, reviewable independently:

```
git show cd76536f     # Stage B's three P2s — the database enforcement
git show 0ced1d69     # Stage D — the control on the metadata page
```

changed paths:

```
git diff --name-only 3bd96545..0ced1d69
```

Start with `src/web/Metadata.tsx` (the new `DeletePermanently`, ~line 2690) and
`drizzle/20260907200800_ingest_events_unlink_atomically.sql`. That is where to begin, not the limit
of scope — the manifest above is.

**Not in scope, and deliberately so:** Stage C (`pgShelfStore.destroy`, `src/store/pg-jobs.ts`,
`src/jobs.ts`) is being fixed concurrently in this same tree and is under separate review. Its files
are uncommitted and will look half-finished; ignore them. Judge Stage D against the route contract
as documented below, not against the working tree's copy of the store.

## What it is meant to do

Spideryarn is adding permanent article deletion — the first irreversible act on a reader's own data
in this product, against one production database with real paying readers and **no staging copy**.
Archive already exists and erases nothing; this is the other ending.

**Stage D** is the control: `DeletePermanently`, in its own section under Archive on an article's
metadata page, owner only. Two-step inline confirm, no modal. It calls
`DELETE /api/library/:slug` → `{ destroyed: slug }`; 409 while an import is running; 404 for a
non-owner (never 403).

**Stage B's P2s** are three database-level fixes under it, from your own earlier review of Stage B
(findings F7, F8, F9 in `docs/plans/260906h-delete-an-article-permanently-stage-b-review-sol.md`):
a partial index on `ingest_events.article_id`; the freeze trigger now stamping the price and nulling
`article_id` in one statement plus a `CHECK` that the two are never both set; and a
`BEFORE UPDATE OF article_id` trigger raising `23514` when the price would be lost.

The invariants that must not break:

1. **A reader can only ever destroy their own article**, and a non-owner gets 404, never 403.
2. **Deleting must not change what the owner is charged**, in either direction. Usage is recomputed
   live from `articles.visibility`; a public article costs half a slot, a private one a full slot.
3. **A delete that reports success must have happened**, and one that reports failure must not leave
   the reader believing a false state. The house doc on this is
   `docs/reusable/silent-success.md`.
4. **The reader must never be told something the client cannot know.** `apiFetch` answers a failed
   GET from the offline copy with a real `Response`, status 200 and `x-spideryarn-offline: copy`
   (`src/web/lib/api.ts`), which is the specific trap this control was built around.

Deliberately out of scope: any delete control on the shelf cards; a soft-delete or grace period;
bulk or account deletion; admin deleting somebody else's article; and **Stage E**, which will
reference-count and delete the stored bytes. The raw downloaded file therefore still survives a
delete today, on purpose, and `/privacy` says so.

## Context you need that the code assumes

- `ArchiveArticle` in `src/web/Metadata.tsx` — the sibling control and the model for this one. Its
  three-state discipline (never offer a button over a state we have not established) and its catch
  block (a failed request is not proof that nothing was written) are the conventions Stage D
  inherits.
- `docs/project/copy.md` § *The words on the one control that cannot be undone*.
- `docs/project/privacy.md` § *Deleting an article, for good*.
- `src/web/lib/cached-shelf.ts` and `src/web/lib/offline-store.ts` — `forgetUser` retires the
  reader's whole cached set; stale data after a delete looks exactly like a delete that failed.
- `docs/project/billing.md` § *a public article counts half* for invariant 2.
- `CLAUDE.md` for the house rules.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can build
a throwaway harness under `/tmp`. **You have no network, not even loopback**, so anything needing
Postgres will fail rather than tell you something — do not spend the run on it.

`tests/metadata-delete-permanently.test.tsx` (22 cases) and `tests/metadata-page-order.test.tsx`
need no database and are yours to run. The Postgres-backed ones are mine; `npm run typecheck` is
clean, `tests/db-schema.test.ts` is 32/32 in a lane that rebuilds from the migrations, and
`db:chain`, `db:migrate` and `db:check` are green.

## Attack it

Independently, before you read my questions below.

**The invariant to break is the third and fourth together: find a sequence in which this control
tells the reader something false about whether their article still exists.** Then the second: find
an ordering in which the money comes out wrong.

For each finding give:

- an ID, a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the input or mutation that shows it fails its own claim
- (b) the smallest change that closes it — a code block, or exact replacement wording

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it. Established means direct
evidence with no unresolved material inference.

**IDs are stable across this whole chain and F1–F22 are already issued.** Number anything new from
**F23** upward. Do not reuse an ID for a different finding.

## Previous findings this candidate answers

| ID | Finding, verbatim from your Stage B review | Disposition | What changed |
|----|-------------------------------------------|-------------|--------------|
| F7 | no index on `ingest_events.article_id`; the trigger's UPDATE and the FK's SET NULL each scan the unbounded ledger per article | fixed | partial index `ingest_events_article_id_live`. **We think you overcounted**: with F9's atomic unlink the FK action finds no rows, so it is one scan, not two. Say if that is wrong. |
| F8 | a plain `update ingest_events set article_id = null` loses the price without passing the trigger | fixed | `ingest_events_require_price_on_unlink`, `BEFORE UPDATE OF article_id`, raises `23514` |
| F9 | "not a second source of truth" is tested but not enforced | fixed | freeze + unlink in one statement, plus `CHECK (article_id is null or article_visibility_at_delete is null)`, added **validated** |

Treat these fixes as unreviewed code written by someone else.

## Questions I would like answered on their own merits

- **The `CHECK` is added validated.** No supported path can produce a row with both columns set, and
  Stage B has never run in production, so we believe there are no such rows anywhere. Is there a
  path we have not thought of — a partial failure, a `COPY`, a restore — that could leave one, and
  should the constraint have been `NOT VALID` and validated separately instead?
- **Does the F8 trigger have a false positive?** It must not fire on the legitimate path, where the
  freeze trigger moves both columns in one `UPDATE`. `articles.visibility` is `NOT NULL`, which we
  believe closes the only way the freeze could write a null price. Check that reasoning.
- **The three-valued re-read.** Is `stillOnTheServer` actually authoritative? We claim only a fresh
  server 404 proves deletion and only a fresh server 200 proves survival, with offline copies,
  transport failures, 5xx and 401 all falling through to "we cannot tell". Find a fifth case.
- **Cache retirement.** On a confirmed delete the control calls `forgetCachedReader()`, retiring the
  reader's whole cached set rather than invalidating per-article. Is there a window in which a
  cached response outlives the delete and shows the reader their deleted article?

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run above this line.

- The double-click guard is asserted **structurally** (jsdom has no layout): the trigger is
  unmounted, the confirm is not the card's first element child, and >100 characters of prose
  separate them. That is a proxy for "the confirm button is not where the trigger was", and I am not
  sure it is a sufficient one.
- The 409 path deliberately does **not** re-read, on the grounds that a 409 is already a fresh
  server answer that deleted nothing, because `destroy` refuses on the live-job check before it
  reaches the `DELETE`. That reasoning depends on Stage C, which is out of scope here — say if the
  client should not be relying on it.
- The export offer scrolls to the page's Export section rather than linking
  `GET /api/export/:slug`, because a browser follows an anchor with no `Authorization` header. I
  believe the plan was simply wrong; say if there is a reason to prefer the link.
- The three failure sentences carry **no bracketed error code**, against `copy.md`'s general rule.
  This was a deliberate product decision, not an oversight.

Do not change any file.
