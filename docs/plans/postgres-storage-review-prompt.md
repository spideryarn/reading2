# Review request: the Postgres storage migration in Spideryarn

> **Not yet run.** Dispatched 2026-08-26 with `gpt-5.6-sol --effort high` and it died 169,738 tokens
> in, out of credits, after reading the diff and before writing a word of the answer. Kept here so
> the re-run is one command rather than a reconstruction:
>
> ```bash
> npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 40 \
>   --prompt-file docs/plans/postgres-storage-review-prompt.md \
>   --output /tmp/sol-postgres-review.md
> ```
>
> **If credits are tight, make it cheaper before making it shorter.** Most of that 170k went on
> exploration, not reasoning: `git log -p` over four commits in a repo whose documents are long.
> Drop the "read these first" list to `postgres-storage-implementation.md` alone, name the six source
> files to read instead of pointing at the diff, and use `--effort medium`. The questions below are
> the part worth keeping.

You are reviewing work in `/Users/greg/Dropbox/dev/experim/spideryarn2`. This is the cross-family
review the house process asks for before committing (it was skipped earlier — your workspace was
out of credits — and a Claude model arbitrated instead, so treat its conclusions as unverified).

Be adversarial and concrete. I would much rather you find a real defect than tell me this is good.
Where you disagree, say so plainly and say what you would do instead. **Do not edit any files.**

## What the work is

Spideryarn stores articles as JSON files under `data/<slug>/`. Greg asked to finish moving storage
to Supabase Postgres, with four decisions made up front: **full cutover** (Postgres becomes the only
store), **local only** (nothing applied to the remote project), **import the existing articles and
keep the files**, and **`owner_id` from a seeded dev user** because there is no auth yet.

I got roughly two thirds of the way. Reads, comments, the importer, the exporter and the tests are
done and committed; the pipeline write path and the job queue are not.

## Read these first

- `docs/plans/postgres-storage-implementation.md` — my doing document. Progress table, decisions,
  what is deliberately not done. **Start here.**
- `docs/plans/postgres-migration.md` — the older design doc: the schema, the seven decisions, and a
  section called "The traps" that lists the ways this work fails while reporting success.
- `docs/project/database.md`, `docs/project/block-ids.md`, `docs/reusable/silent-success.md`

## The code to review — the last four commits

```
a253f01 Stop the shelf putting undated articles first
1bc9e6c Move the reader's questions into rows, and say what is still on disk
518161b Serve the reading view from Postgres, and give it a way back
2e848cc Read an article out of Postgres, and prove it is the same article
```

`git log -p 2e848cc^..HEAD` is the whole diff. The files:

| File | What it is |
|---|---|
| `src/db/schema.ts` | the tables. I added `summary`/`labels` JSONB, `jobs.guidance`, `revision_step_runs.started_at`, and four new tables (`chat_threads`, `chat_messages`, `search_runs`, `glossary_lookups`) |
| `drizzle/0002_*.sql`, `drizzle/0003_*.sql` | generated, then a hand-written companion for the `auth.users` FKs and indexes |
| `src/db/client.ts`, `src/db/ssl.ts` | the runtime pool; the TLS decision extracted so migrator and app cannot disagree |
| `src/owner.ts` | who owns a row — the one file the future beta gate changes |
| `src/store/contracts.ts` | the seam. Deliberately `src/api.ts`'s existing surface, function for function |
| `src/store/fs.ts`, `src/store/pg.ts`, `src/store/pg-comments.ts` | the two stores |
| `src/store/import.ts`, `src/store/export.ts` | importer, and the exporter that is the rollback |
| `src/store/index.ts` | which store is live (`SPIDERYARN_STORE=postgres`), and the no-fallback rule |
| `tests/store-parity.test.ts` | both stores must return the identical API-shaped result |
| `tests/store-roundtrip.test.ts` | `data/` → Postgres → `data/` loses nothing |
| `tests/store-artefact-manifest.test.ts` | a new artefact file becomes a red test |
| `tests/store-comments.test.ts` | the Postgres comment store's semantics |

State: 1132 tests pass, `npm run typecheck` and `npm run lint` are clean on these files. To run the
database tests yourself: `npm run db:start && npm run db:migrate && npm run db:seed-owner`.

## What I most want you to attack

1. **Is the parity test actually load-bearing, or does it pass for bad reasons?** It compares
   `JSON.parse(JSON.stringify(...))` of both stores' results. I already found one case where it
   agreed *by accident*: the library was ordered on `fetched_at` alone, Postgres sorts NULLs first
   under DESC, and the only article with a null `fetched_at` happens to be the newest. What else is
   it blind to? What is compared nowhere at all?

2. **`src/store/import.ts`.** Revision ids are derived from `slug + hashBlocks(blocks)` so re-running
   is idempotent rather than merely convergent, and `created_at` is seeded from `blocks.json`'s
   mtime so the library's `addedAt` fallback lands on the same value. Is the derived-uuid scheme
   sound? Is the one transaction actually atomic in the way the comment claims? What happens if two
   imports run concurrently for the same slug — I have seen one unreproduced flaky test failure
   under load and I do not know its cause.

3. **`src/store/pg.ts` vs `src/api.ts`, field by field.** `exactOptionalPropertyTypes` is on, so an
   absent property and one set to `undefined` are different, and Postgres returns `null` where a
   file had no key. I used conditional spreads throughout. Did I miss any? Are the thrown errors
   tagged with the same `status` in every path, given `routes.ts` turns an untagged throw into a 500?

4. **`src/store/pg-comments.ts`.** It must match `src/comments.ts`'s documented semantics: reset in
   place on a retry rather than appending, `createdAt` surviving that reset, a patch unable to rename
   a comment, and the anchor pointing at `block_identities` so a comment survives its paragraph being
   dropped. Is the id-minting inside the transaction racy? Is `orderBy(createdAt, id)` a safe
   reconstruction of the file's array order?

5. **The known-unfinished list, and whether I have the danger ranked right.** The plan's
   "What is not done" section claims the biggest hazard is that publication must carry the on-demand
   artefacts (`tweets`, `glossary`, `summary`) forward, or a re-extraction silently empties a
   reader's paid-for glossary — and that the parity test will never catch it, because parity is
   checked without a re-extraction in between. Do you agree that is the top risk? Is there something
   worse that I have not noticed?

6. **Anything else** — the schema, the migrations, the no-fallback rule and its 501, the artefact
   manifest test, the exporter's fidelity, the `owner.ts` production guard, or a place where my
   comments claim something the code does not do. That last category matters most to me: this
   codebase's documents are load-bearing, so a comment that is confidently wrong is worse than no
   comment.

Answer as prose, organised by the numbered questions, with file:line references. Lead with the most
serious thing you found. If you think something is fine, say so briefly rather than at length.
