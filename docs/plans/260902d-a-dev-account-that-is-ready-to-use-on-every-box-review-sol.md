The overall shape is right: reuse the existing local admin account, seed Postgres from the committed corpus, and keep the production write path. I would not ship the plan unchanged, though. Two failures can still produce a green setup with no usable seeded shelf.

## Findings

1. **High — the end-to-end command uses the wrong route and will falsely pass.**

The plan names `/reading/writes`; the application route is `/read/writes` ([router.ts](/home/greg/code/spideryarn2/src/web/router.ts:251)). Unknown paths deliberately fall back to the library ([router.ts](/home/greg/code/spideryarn2/src/web/router.ts:203)), so `/reading/writes` loads the shelf, makes successful API calls, and satisfies `browser-sign-in.ts` without ever requesting the article ([browser-sign-in.ts](/home/greg/code/spideryarn2/scripts/browser-sign-in.ts:363)).

Use:

```sh
npx tsx scripts/browser-sign-in.ts --at /read/writes
```

This is exactly the silent-success class the verification was meant to prevent.

2. **High — “published exists” and `count(*)` do not prove the selected fixtures are visible.**

The shelf excludes archived articles in SQL ([pg.ts](/home/greg/code/spideryarn2/src/store/pg.ts:1472)), then separately drops revisions with no tree or no blocks ([pg.ts](/home/greg/code/spideryarn2/src/store/pg.ts:1886)). The shared `onTheShelf()` predicate is explicitly only the SQL-expressible half and does not include those readability checks ([pg.ts](/home/greg/code/spideryarn2/src/store/pg.ts:201)).

The plan therefore gets these states wrong:

- A published but archived selected article is skipped yet absent from the normal shelf.
- A current revision lacking a tree or blocks is skipped/counts, yet `listArticles()` drops it.
- A historical published revision with `current_revision_id = null` must not count as complete. The wording should say “the current revision,” not merely “a published revision exists.”
- Three selected slugs can belong to another owner while unrelated old admin articles make the final count positive.
- “Report and continue” must still make the command exit non-zero if any required slug remains unavailable. Otherwise a global slug collision becomes successful setup.

Replace the count with the actual reader seam:

```ts
const entries = await runAsOwner(owner, () =>
  pgArticleReader.listArticles({ archived: false })
);
```

Then assert that all three expected slugs are in that result. This checks the same outcome the browser shelf consumes, including archive, tree, blocks, and ownership.

3. **High — warning about `SPIDERYARN_STORE=files` is not enough for a command whose promise is “ready to use.”**

With `files`, both the seeded articles and the experimental-profile row are invisible to the running application. Store selection is fixed at module load, so even editing `.env.local` does not repair an already-running shared server ([live.ts](/home/greg/code/spideryarn2/src/store/live.ts:55)).

I would:

- Perform the durable seed first.
- Then exit non-zero if the configured store is not `postgres`.
- Do not mutate `.env.local` or restart the shared server.
- Keep the correct `/read/writes` browser command as the final proof against a server started before the setting changed.
- Add `SPIDERYARN_STORE=` to [.env.example](/home/greg/code/spideryarn2/.env.example:130), not only to the remote allowlist.

That division remains safe for the shared checkout while preventing `npm run setup` from claiming completion in a known-incomplete state.

4. **Medium — the wrong-bucket case is missing from the silent-success table.**

`loadArticleIntoPg` calls `storeRawSource` without selecting a required Postgres-compatible blob store ([load-article.ts](/home/greg/code/spideryarn2/tests/helpers/load-article.ts:393)). Its default `blobStore()` silently selects filesystem storage when credentials are missing ([blobs.ts](/home/greg/code/spideryarn2/src/store/blobs.ts:251)), and it does not itself prove that `SUPABASE_URL` matches `DATABASE_URL`.

`npm run setup` happens to run `db:seed-owner` first, which checks the Auth endpoint. But standalone `db:seed-dev` could commit database references while putting source bytes in the filesystem or another local Supabase stack.

Construct `postgresBlobStore("db:seed-dev is loading Postgres articles")` before loading. Its constructor checks both credentials and the database/bucket pairing ([blobs.ts](/home/greg/code/spideryarn2/src/store/blobs.ts:302)). The existing database-vs-CLI check should remain as a separate fence.

5. **Medium — do not mirror `writeExperimental`; call it.**

The proposed handwritten upsert would be a second implementation of semantics already centralized in `pgReaderStore.writeExperimental`: database clock, `coalesce`, `updated_at`, and returned stored value ([pg-reader.ts](/home/greg/code/spideryarn2/src/store/pg-reader.ts:83)).

Use:

```ts
runAsOwner(ADMIN_USER_ID_LOCAL, () =>
  pgReaderStore.writeExperimental(true)
);
```

A readback through `readExperimental()` is reasonable evidence. Reimplementing the SQL is unnecessary drift.

6. **Low — `noema-mythology-of-conscious-ai` is not unpublishable.**

Only `constitution` is the negative publication fixture. `noema` lacks `raw.json` to exercise manifest asymmetry ([fixture README](/home/greg/code/spideryarn2/tests/fixtures/data-root/README.md:45)); the parity suite excludes only `constitution` and publishes the other corpus articles ([store-parity.test.ts](/home/greg/code/spideryarn2/tests/store-parity.test.ts:285)).

Excluding `noema` from the dev shelf is still sensible because it lacks an original source, but “two deliberately unpublishable fixtures” is factually wrong.

## The `scripts/` → `tests/helpers/` precedent

I think it is acceptable for this v1. It does not resurrect the deleted importer: there remains one fixture-copy implementation, and it drives the real artefact and publication seams. The test coordination lock is also useful because setup and tests share the database ([run-lock.ts](/home/greg/code/spideryarn2/tests/helpers/run-lock.ts:129)).

If the dependency becomes uncomfortable later, the cheapest structural alternative is to move the canonical loader into `scripts/lib/` and make tests import it. Do not create a wrapper that reimplements copying, and do not promote it into `src/store/`; its single-transaction fixture semantics are intentionally not production semantics.

## What to cut

- Cut the extra `copied.length > 0` check: the loader already throws on an empty copy ([load-article.ts](/home/greg/code/spideryarn2/tests/helpers/load-article.ts:411)).
- Cut the extra `published === true` check when calling with default `publish: true`; publication refusal already throws.
- Replace the total count with the exact `pgArticleReader.listArticles()` postcondition rather than retaining both.
- Cut the handwritten experimental upsert and call the existing store.

Keep the target fence, exact-owner handling, three-fixture list, docs updates, and browser verification. Those are proportionate safeguards, not over-build.