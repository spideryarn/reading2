NO-SHIP.

## Finding

1. **High — the importer still overwrites pipeline-owned output when the input hash is unchanged.**

The artefact JSONB is replaced at [src/store/import.ts:1114](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1114). When the guarded upsert refuses the pipeline-owned row, the importer throws only if the hashes differ at [src/store/import.ts:1508](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1508).

Concrete failure:

1. Pipeline owns glossary row with `inputHash = H` and glossary A.
2. `glossary.json` is changed to glossary B while retaining `sourceHash = H`.
3. Import replaces A with B.
4. The row is refused, but `held.hash === claimed`, so no exception is thrown.
5. Every freshness check remains green although the pipeline never produced B.

The new test changes the hash at [tests/store-import-revision.test.ts:404](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-import-revision.test.ts:404), so it misses this state. A pipeline row must block a materially different artefact, not merely a different input hash. Simplest safe rule: abort on any refused pipeline row; alternatively compare the existing and incoming artefacts exactly before allowing a no-op import.

## Sanitizer interaction

For this specific 3→4 bump, the rerun is safe.

- The new rules remove only a class and two attributes.
- ID matching uses tag plus text, or `src` for textless blocks, at [src/blocks.ts:525](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:525). Those inputs do not change.
- My executable probe retained 2/2 IDs while removing all three forbidden values.
- `assertIdsCarried` therefore passes. More generally, it refuses only zero overlap at [src/blocks.ts:1400](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1400); a future policy that removes or rewrites every matchable block can indeed turn a policy bump into a refused job. Partial changes may mint replacement IDs for the changed blocks by design.

I would not add an explicit stamp check yet. The exact re-derivation at [src/pipeline.ts:744](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:744) already proves whether today’s policy changes the output, and selectively reruns only affected articles. Postgres has nowhere to persist the sanitizer version, so a stamp check now would either diverge by store or report every Postgres revision stale forever. Add it with the later persisted generation binding/column.

I found no silent-dirty state for a coherent stored pair:

- Dirty stamped HTML fails the byte comparison.
- Dirty `block.html` fails `canonicalBlock`.
- Either side dirty independently is also caught.

A v3 stamp can remain while the bytes already satisfy v4; the guard then says current while `sanitizeStoredBlocks` calls the stamp stale. That is an uncertified-but-clean state, not dirty content.

Also, metadata-page reads evaluate the guard but do not automatically rerun Stage 3. A job containing `blocks` performs the rerun. I found zero exact `hit`, `data-hit`, or `data-hues` occurrences in the current on-disk `data/` and `output/` artefacts; I did not inspect production Postgres.

## `sendSource` tests

The live Postgres branch ran—not skipped—and all 17 source-store tests passed. The principal mutations would go red: missing object, wrong bytes, removed legacy fallback, removed ownership filtering, or filesystem access restored in the route.

They are not fully mutation-proof:

- No Postgres HTML fixture proves either kind guard at [src/store/pg-source.ts:144](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-source.ts:144) and [src/store/pg-source.ts:167](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-source.ts:167). Returning referenced or legacy HTML bytes would pass the present suite.
- Nothing asserts the first query excludes `raw_bytes`; adding the 32 MiB column would pass.

The implementation itself is correct on both points; add those negative controls.

## Scope

The supplied patch omits the untracked [pg-source.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-source.ts) and [source-store.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/source-store.test.ts), so the review artefact is not self-contained.

Quotes work also appears beyond the two warned files: `src/api.ts`, `src/routes.ts`, `src/source-hash.ts`, `src/store/artifacts-fs.ts`, `artifacts.ts`, `contracts.ts`, `import.ts`, `index.ts`, and two tests. Those hunks are not Stage 1a/1b.

Typechecking passed. Focused suites passed 132/132. The full suite reached 6,870 passes; three unrelated failures came from Supabase Auth returning 500 and another process holding the run-lock key.