NO-SHIP.

## Findings

1. **Critical — `blocksMatchTheirHtml` can both skip a required Stage 3 run and rerun Stage 3 forever.**

The comparison reduces both documents to whitespace-collapsed `body.textContent` at [src/pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:587). That loses block boundaries, tags, links, images, and significant whitespace.

Concrete under-fire:

- Previous extraction: `<p>Alpha</p><p>Beta</p>`
- New extraction: `<p>AlphaBeta</p>`
- Old blocks still contain two blocks and match the old stamped HTML.
- Both bodies yield `AlphaBeta`, so [the guard returns true](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:672) and Stage 3 skips.

I executed that state against `STEPS.blocks.isDone`; it returned:

```json
{"done":true,"oldBlocks":["Alpha","Beta"],"newBlocks":["AlphaBeta"]}
```

The same failure occurs for:

- `h2 → p` with unchanged words, despite changing block kind and ToC semantics.
- Changed `href`, `src`, `alt`, figure, or other markup with unchanged text.
- Significant whitespace changes in `<pre>`.
- Any split/merge whose concatenated text happens to match.

Concrete over-fire: Stage 3 sanitises the extraction at [src/blocks.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:978), including removing forbidden elements such as `<style>` at [src/sanitize-policy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize-policy.ts:173). Therefore a healthy pair can legitimately have different `textContent`.

I executed a healthy Stage 3 result from:

```html
<article><script>evil()</script><p>Alpha</p></article>
```

The guard returned `false` even though the produced blocks were correctly `["Alpha"]`. Under Postgres, rerunning Stage 3 cannot cure this: `extracted_html` remains unsanitised while `stamped_html` remains sanitised, so it stays stale forever.

Parsed visible text is therefore not sound. The timing measurements may be correct, but cost is not the deciding problem. A durable input digest/generation binding is the sound answer; otherwise compare a canonical sanitised block-candidate sequence that preserves boundaries, tags, and relevant attributes. The lack of a current `STAMP_SOURCE.blocks` entry is a reason more storage work is needed before the flip, not a reason to accept this heuristic.

The existing tests cover changed prose and entity serialisation at [tests/pipeline-artifact-store.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/pipeline-artifact-store.test.ts:1226), but not sanitiser removal or block-boundary collapse.

2. **High — the importer fix works only for a new step row; re-import still leaves or creates `StampDisagrees`.**

The revision document is updated in place when blocks are unchanged at [src/store/import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1055). That includes tree, metadata, and all six widened artefacts.

But the corresponding step-row insert still uses `onConflictDoNothing` at [src/store/import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1370). Therefore:

1. Import artefact with `sourceHash = H1`.
2. Re-cut the tree or change metadata without changing blocks.
3. Regenerate the artefact with `sourceHash = H2`.
4. Re-import: JSONB becomes H2; the existing imported row remains H1.
5. `stampForStep` throws `StampDisagrees`.

More immediately, rows previously imported with `hashBlocks` are not repaired by this change. This matters especially for the already-widened `arc`, `ideas`, and `sketch`.

The new test hides the conflict path by explicitly deleting the row before importing at [tests/store-import-revision.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-import-revision.test.ts:274). It proves insertion, not re-import convergence.

Imported rows should be updated when—and only when—the conflicting row is itself marked `implementation_version = 'imported'`. Real pipeline rows must remain untouched.

Keeping `toc.input_hash = hashBlocks(blocks)` is correct because publication explicitly compares it at [src/store/pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1175).

3. **High — the “one fingerprint for six stages” abstraction is incomplete for `ideas` and `sketch`.**

Those two stages do not send the same metadata bytes as the other four:

- `articleWithIds` emits `URL:` at [src/article-prompt.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-prompt.ts:79).
- With no metadata, `ideas` and `sketch` send a synthetic `TITLE: tree.slug` at [src/ideas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:852) and [src/sketch.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch.ts:485).
- `articleFingerprint` hashes neither URL nor the fallback title at [src/source-hash.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:263).
- `structureHash` does not hash `tree.slug` at [src/source-hash.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:188).

I verified that changing only `tree.slug` makes the `ideas`/`sketch` prompt change while the fingerprint remains identical:

```json
{
  "hashEqual": true,
  "promptEqual": false,
  "aHead": "TITLE: old-slug",
  "bHead": "TITLE: new-slug"
}
```

The self-caught near-miss avoided an “always stale” result by hashing `null`, but replaced it with an incomplete fingerprint that can incorrectly skip.

The URL exclusion is not the right call. Attribution can affect a model’s answer, and more fundamentally it is part of the prompt. Also, the claim that Postgres carries no URL field is false: `article_revisions.final_url` already exists, and Postgres reconstructs `Meta.url` from it at [src/store/artifacts-pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:288).

Either:

- give the `articleWithIds` stages a fingerprint covering URL and their effective fallback title, or
- deliberately remove those inputs from their prompts.

The current middle ground does not complete their fingerprints.

4. **Medium — missing metadata is reconstructed differently by the Postgres pipeline and Postgres reader paths.**

The Postgres artefact adapter returns `null` when `title` is null at [src/store/artifacts-pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:288). That agrees with filesystem stamps and the generators.

But `metaFingerprintOf` always returns an object with `title: ""` at [src/store/pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:953). The fingerprint explicitly distinguishes `null` from an empty metadata object.

I confirmed those hashes differ. Consequently, a legitimate no-`meta.json` artefact can:

- be considered current by Postgres pipeline preflight;
- be reported stale by `pgArticleReader.loadTweets`, `loadGlossary`, `loadSummaries`, `loadIdeas`, `loadSketch`, `loadArc`, and the metadata page.

This is not data loss, but it is a permanent cross-store/currentness disagreement.

## Corrections and scope

- Moving arc’s canonical formula into `articleFingerprint` did preserve the existing arc hash byte-for-byte.
- The ordinary writer/stamp paths for valid metadata now agree for all six stages.
- `assets` remaining blocks-only is correct.
- Copying an artefact’s own `sourceHash` is the correct importer rule; the implementation needs to update existing imported rows as well.
- The importer change is necessary before Stage 3. It remains live through the deployable Stage 1 and Stage 2 boundaries, and the widened hashes make its inconsistency larger.
- The repeated claim that a reading-view rename changes these prompts is false. Renames are shelf overrides written separately at [src/store/pg-shelf.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-shelf.ts:84); generators read extracted revision metadata. A changed extracted title invalidates correctly, but a private shelf rename does not and should not be cited as the reason.
- I found no unrelated implementation in the scoped diff that should simply be split out. The importer, API, projections, and Postgres read changes are all required companions to widening the hashes. The inaccurate documentation above should be corrected.

Typechecking passed across all projects. Vitest could not start under this review’s read-only sandbox because Vite attempted to create temporary directories. The two HTML failures and the missing-meta/stub hash discrepancies were reproduced directly with executable probes.