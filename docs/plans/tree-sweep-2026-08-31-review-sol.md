Review was against committed HEAD `c746302`; I ignored the shared tree’s unrelated uncommitted edits.

| Silent-failure risk | Verdict |
|---|---|
| Highest | Claim 4: committing an unmarked permanent red destroys `npm test` as a trusted gate. |
| High | Claim 3’s local `data/` corpus is not a deterministic CI input. |
| Medium | Claim 2: `pdf-chunks` is stale, and no test proves either checkpoint caller is wired. |
| Loud, not silent | Claim 1’s migration reasoning is backwards; the missing snapshot would cause a duplicate drop and a migration error. |

## Claim 1 — wrong failure mode; right snapshot

The commit message has the diff direction backwards.

Drizzle Kit 0.31.10 is installed ([package.json](/Users/greg/Dropbox/dev/experim/spideryarn2/package.json:108)). It:

1. Reads `_journal.json`, but independently enumerates and sorts snapshot files ([bin.cjs](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-kit/bin.cjs:8134)).
2. Does not check that every journal entry has a corresponding snapshot ([bin.cjs](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-kit/bin.cjs:8155)).
3. Uses the last snapshot as `prev` and the current TypeScript schema as `cur` ([bin.cjs](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-kit/bin.cjs:19848)).
4. Diffs `prev → cur` ([bin.cjs](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-kit/bin.cjs:32189)).

0031 contains `jobs_only_one_running` and `jobs_active_slug` ([0031_snapshot.json](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/meta/0031_snapshot.json:1736)); the current schema omits the former ([schema.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1143)). Therefore the next generation from 0031 would emit:

```sql
DROP INDEX "spideryarn"."jobs_only_one_running";
```

I verified that exact output through Drizzle Kit’s installed `generateMigration(0031, 0032)` function. Reversing the inputs emits the `CREATE UNIQUE INDEX`; that is the direction stated in the commit message, but not the direction `db:generate` uses.

`_journal.json` would merely make the new migration number 0033 ([bin.cjs](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-kit/bin.cjs:32926)). It would not cause a hard error during generation. Applying 0032 followed by the generated 0033 would then fail loudly because the second unguarded `DROP INDEX` targets an index 0032 already removed.

Correct statement:

> Without the 0032 snapshot, the next `db:generate` would successfully produce a 0033 migration containing a duplicate `DROP INDEX`. Applying the sequence would fail loudly; it would not restore the constraint.

The committed snapshot itself is correct. Its `prevId` is 0031’s `id` ([0032_snapshot.json](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/meta/0032_snapshot.json:2)); it retains `jobs_active_slug` ([0032_snapshot.json](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/meta/0032_snapshot.json:1752)); and, aside from IDs, its sole structural difference from 0031 is removal of `jobs_only_one_running`.

## Claim 2 — overstated overall

### (a) `assets.json`: right

Deleting it from `NOT_YET_WRITTEN` was exactly what that bucket’s self-clearing assertion requires ([store-artefact-manifest.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-artefact-manifest.test.ts:241)). It remained correctly in `HOMES`, and the actual importer/exporter handle it ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:600), [export.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:449)).

### (b) `labels-progress.json`: destination right; “forced” is overstated

`NOT_YET_WRITTEN` is definitely wrong: it means no real example exists and must fail once one appears ([store-artefact-manifest.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-artefact-manifest.test.ts:144)).

Putting the name in `HOMES` does not newly redefine that list. Its header explicitly calls the values a “decision record,” and the test never checks them ([store-artefact-manifest.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-artefact-manifest.test.ts:47)). The table and both store adapters already exist; only the callers are absent. So `checkpoints / toc-labels` is the decided destination.

But the claim that this makes the gap safely accounted for is too strong. Adding any key to `HOMES` makes the canary green, even if the value is fiction; an earlier review already states that limitation plainly ([postgres-storage-review-sol.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/postgres-storage-review-sol.md:40)). Today labels still reads and writes its path directly ([labels.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:2102)), while the checkpoint interface explicitly says it has no callers ([checkpoints.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/checkpoints.ts:11)).

A fourth bucket is only honest as status documentation. If its keys are simply added to `known`, it is another unchecked exemption and weakens the canary exactly as feared. The real expiry mechanism must be a behavioural test that runs labels through a `CheckpointStore` and proves a second store instance reuses the entry.

### `pdf-chunks`: `NOT_MIGRATED` is stale

The contradiction is real, and the older manifest entry is stale.

`NOT_MIGRATED` still says `pdf-chunks` was deliberately excluded ([store-artefact-manifest.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-artefact-manifest.test.ts:120)). The newer schema explicitly names both checkpoint forms as the table’s Postgres home ([schema.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1978)), and the interface’s closed namespace contains both `toc-labels` and `pdf-chunk` ([checkpoints.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/checkpoints.ts:130)). The current PDF caller still uses `data/<slug>/pdf-chunks` directly ([pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:1011)).

So labels and PDF chunks are the same state: **destination and adapters built, callers not wired**. That supports the labels destination; it requires correcting `pdf-chunks` to match it.

## Claim 3 — deletion right; corpus design wrong

There is no current production or CLI caller that writes `data/<slug>/article.html`.

- `fsLocations` puts the HTML at `output/<slug>.html` ([artifacts-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:84)).
- The HTML extractor writes the caller-provided output and derives the slug from its basename ([extract.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:152), [extract.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:341)).
- The PDF extractor also writes exactly `opts.outFile` ([pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:1158)).
- The pipeline passes `ctx.htmlFile` ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1221)); the PDF CLI constructs `output/<slug>.html` ([pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:1522)).

Therefore the proposed manual command explains `data/wolfram-bugs/article.html` exactly. The repo’s plan records that the investigation rerun created that file ([faster-ingest-and-concurrency.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/faster-ingest-and-concurrency.md:860)). Deleting it with approval was correct; no manifest entry was warranted.

One stale doc still says the durable HTML is under `data/<slug>/` ([content-extraction.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/content-extraction.md:187)). The command table has the real location ([setup-dev.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/setup-dev.md:344)).

`completeArticles()` is not sound as a deterministic gate. It scans a directory entirely excluded from git ([.gitignore](/Users/greg/Dropbox/dev/experim/spideryarn2/.gitignore:3)), selects any directory with two filenames ([store-parity.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-parity.test.ts:165)), and then asserts the machine happened to contain at least one ([store-parity.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-parity.test.ts:249)). The testing doc already admits clean checkouts fail because `data/` is absent ([testing.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/testing.md:326)).

That scan is useful as an opt-in local corpus audit. It must not define `npm test`’s reproducible gate corpus. A tracked `example/` fixture or test-created temporary corpus should do that.

## Claim 4 — wrong as a gate; no hidden mechanism exists

The repro is valid, but leaving it as an ordinary red test makes the declared gate unusable. `npm test` is explicitly the gate ([code-quality-overview.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/code-quality-overview.md:17)); the new cases are ordinary positive assertions ([late-step-on-a-cold-instance.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/late-step-on-a-cold-instance.test.ts:129)).

There is no known-failures mechanism, tagged project, or separate workspace in this repo. Vitest has one include set ([vitest.config.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/vitest.config.ts:16)), and `npm test` is plain `vitest run` ([package.json](/Users/greg/Dropbox/dev/experim/spideryarn2/package.json:7)).

The cheapest honest representation is not `it.fails`, because that accepts any thrown error. Assert the exact current defect:

```ts
await expect(STEPS.tweets.run(coldContext(), store))
  .rejects.toThrow(/ENOENT.*blocks\.json/);
```

Do the same for arc and name both tests as current known defects tied to stage 1b. This keeps the reproduction running, keeps `npm test` green, fails if the defect disappears unexpectedly, and also fails if it changes into an unrelated error. When stage 1b lands, flip those assertions back to `resolves`.

If the tests must remain unmarked and red, there is no technical mechanism that also keeps a red suite meaningful. Those requirements contradict each other.