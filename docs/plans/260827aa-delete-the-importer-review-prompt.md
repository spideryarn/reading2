# Input on a re-sequencing: delete the importer, and let the pipeline write to Postgres

This is a **plan-stage input round**, read-only. Nothing here is built yet. You have reviewed the
two plans it re-sequences — `docs/plans/260827j-transactional-stage-runner.md` (you returned NO-SHIP on its
first draft; the corrections are folded in) and `docs/plans/260827o-raw-bytes-in-storage.md` (three rounds,
all of which found something real).

Be adversarial. Every previous round on this body of work found something real; assume this one does
too.

## What the owner decided

Greg asked whether `db:import` was needed only for legacy data and whether he could ditch it. I said
he was right about the destination but that the importer is currently the **only** path into
Postgres, so it has to be replaced rather than deleted. He answered:

> Ok, great, proceed as per your recommendation. I don't care about preserving/importing existing
> data. Let's aim for the long-term-best approach.

So: no backfill, no migration of existing rows, and existing articles may lose their raw source
document when `raw_bytes` drops. That is accepted, not overlooked.

## Read, in this order

1. `docs/plans/260827aa-delete-the-importer.md` — the new plan. The subject of this review.
2. `docs/plans/260827j-transactional-stage-runner.md` — the landings it re-sequences. Especially
   § The order (A–E), § What has to be true, and § Open.
3. `docs/plans/260827o-raw-bytes-in-storage.md` — § The part the first draft did not have, § The backfill can
   put the wrong bytes under a hash, § What changes.
4. `src/store/blobs.ts` — `storeRawSource`, `projectMismatch`, `CorruptObject`. Built.
5. `src/db/schema.ts` — `rawSources`, and `article_revisions.raw_source_sha256`/`_kind` with their
   CHECK and composite FK. Built.
6. `src/store/pg-revisions.ts` — `publishRevision` (the gate is **not** there), `beginDraftIn`,
   `openOrBeginJobDraft`, the `CARRY` table.
7. `src/store/import.ts` and `src/store/export.ts` — what is being deleted and rewritten.
8. `tests/store-parity.test.ts`, `tests/store-roundtrip.test.ts`, `tests/chat-anchor.test.ts` — the
   three tests that lose their means of populating Postgres.
9. `src/jobs.ts`, `src/pipeline.ts`, `src/store/artifacts.ts` — the write path as it is today.

## Attack these specifically

1. **Is the claim true that deleting the importer costs nothing operationally?** The plan asserts
   that existing rows keep working and only *new* articles are blocked, and that ingestion into
   Postgres on Vercel does not work today anyway. Check that against the code. If there is a live
   path that puts an article into Postgres without `db:import`, the plan's central premise is wrong.

2. **The sequencing rule.** The plan says the adapter-parity suite lands in landing C and the
   importer is not deleted until that suite is green, so there is no coverage gap. Is a
   *store-adapter* parity suite actually a replacement for what `tests/store-parity.test.ts` covers?
   That test compares the **wire form** of `fsArticleReader` against `pgArticleReader` — a reader
   comparison, one layer above the artefact store. An `ArtifactStore` parity suite may not reach it.
   If those are two different properties, say so and say what the second one needs.

3. **`tests/chat-anchor.test.ts`.** It uses import→export as a vehicle for the block-identity
   contract, not as a store test. Does deleting the importer lose regression cover for
   `block_identities`, and if so what is the smallest honest replacement?

4. **The publication gate as one condition.** With no legacy rows, the plan reduces it to: a
   `status = 'done'` `fetch` run in the lineage plus a null `raw_source_sha256` is a refusal. Your
   earlier round pointed out that `beginDraftIn` copies both the source fields *and* every step-run
   row, so a later revision legitimately inherits a `fetch` run it did not perform — which the
   lineage phrasing handles. Are there other states this single condition gets wrong? In particular:
   a revision whose fetch failed; a revision that only ever had `meta` written; an article ingested
   from an upload rather than a URL.

5. **The demolition commit.** Delete the importer, turn on the gate, drop `raw_bytes`, rewrite
   `db:export`, all in one commit, because splitting them creates an intermediate state where the
   gate refuses what the importer writes. Is that reasoning right? Is there a safe split I have
   missed, and is there anything in that commit that cannot be reversed if it turns out to be wrong?

6. **The window between now and the demolition commit.** During landings B–D the importer keeps
   writing `raw_bytes` and no reference, while the live path (once D lands) writes a reference and no
   `raw_bytes`. Two shapes of revision coexist. What breaks in that window that the plan has not
   named? Consider `db:export`, `GET /api/source/:slug` (`sendSource` in `src/routes.ts`),
   `REVISION_COLUMNS`, and the CHECK/FK on the two new columns.

7. **Open 3 of the runner plan is still a blocker** — `src/api.ts` builds the metadata page from
   `STEPS[step].outputs(ctx)` and constructs `dir`/`htmlFile` to do it, so landing D does not
   typecheck until that page has something else to say. The new plan repeats this and does not solve
   it. Is there a cheaper answer than I think — can the page be driven from `produces` plus what the
   store actually holds, and what does it lose?

8. **What the plan has not thought about at all.** Previous rounds each found one of these. The
   likeliest candidates, in my estimation: the checkpoint store (§ B3, still open); whether
   `raw_sha256` should be dropped alongside `raw_bytes` given it is the *network-bytes* hash and
   `raw_sources.sha256` is the *stored-bytes* hash; and how a test gets an article into Postgres once
   the importer is gone without reinventing it under another name.

## Format

Findings ranked by severity, each with a confidence and a concrete reproduction or a specific
`file:line`. A verdict at the top. Do not accept a claim in the plan because it is stated
confidently — several of them are mine and two earlier rounds have caught me overclaiming from a
measurement that did not support it.

**Markdown links must be repo-relative** (`docs/plans/x.md`) or plain code spans — absolute paths
into one laptop's filesystem break `tests/doc-links.test.ts`, which has happened in all four previous
rounds.
