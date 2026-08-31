Verdict: deleting C4’s special `toc` case is right. The plan is still NO-SHIP until the related test, runner stamp, runtime invalidation, and raw-byte-count hole are corrected.

1. Yes—delete the `toc` case.

`has` must uniformly mean readable outputs plus a `done` run row. No hash comparison.

Because `toc` has no expected `stamp`, current `stepIsDone` returns `true` after `has` succeeds ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:497)). Therefore C4’s proposed `has=true`, `stepIsDone=false` assertion is also wrong. It must be `true/true`, including when the recorded hash differs.

When `toc` actually runs, D must dynamically invalidate or rerun every range-bound consumer—currently `arc` and `summary`. That must happen for every cause: force, missing output, missing/non-done row, or future freshness failure. Both joins silently omit unmatched ranges ([tree.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:218), [tree.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:318)).

Also remove the now-wrong Postgres consequence in the `STEPS.toc` comment ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1098)).

2. Partly correct.

Mechanically, `beginStepRun` writes `NO_INPUT_HASH`, and `finishStepRun` preserves it when no `inputHash` is supplied ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:856), [pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:942)).

But NO-SHIP on the conclusion that D should therefore omit `toc`’s hash. Two different stamps are being conflated:

- `PipelineStep.stamp`: expected stamp used before running.
- `StepProduct.stamp`: actual input used by the completed run.

`toc` must have no former stamp yet, but must record the latter. Its labels already contain `sourceHash` ([labels.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1467)).

Otherwise every new publication also fails the existing `toc.inputHash === hashBlocks(blocks)` guard—not merely `has` ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1057)).

3. The done-row requirement is right, but it is not hazard-free.

`beginDraftIn` copies columns, blocks, and step rows inside one transaction, so it does not create disagreement from a coherent revision ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:547), [pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:569)).

It can preserve an existing disagreement, however. Examples:

- Carried `toc` outputs plus a missing/non-done row cause a `toc` rerun and the `arc`/`summary` loss.
- A carried glossary plus no row causes another append pass.
- A missing row for an earlier step can make it rerun without `cascadeForce` informing later carried steps.

The importer can produce imperfect legacy combinations: it infers `toc` solely from `tree`, not all three outputs ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:811)).

Keep the row requirement. Fix D so the decision “this step will actually run” propagates invalidation at runtime.

4. Artefact authority is right; silent overlay is NO-SHIP.

For overlapping fields, the artefact should supply the freshness value. That matches the filesystem and judges the thing actually being served.

But conflicts must not be hidden:

- On live writes: reject and roll back when row stamp and artefact stamp disagree.
- On legacy reads: report no usable stamp—preferably `null` with a warning—rather than choosing whichever happens to look current.

After agreement checking, the row should contribute only a real `implementationVersion`; it should not fill fields absent from the artefact, or Postgres gains freshness evidence the filesystem does not have.

5. Dropping `NO_INPUT_HASH` and `PIPELINE_RUN` is right.

`PIPELINE_RUN` preserves a real database distinction—pipeline provenance versus importer provenance—but it is not an implementation version ([artifacts.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts.ts:126)). Keep it in the row; omit it from `StepStamp`.

Return `null` when nothing remains. That correctly matches filesystem behaviour for `fetch`, `extract`, and `blocks`.

6. Yes—null `title` should mean no `meta`.

Use `title === null`, not general truthiness. `Meta.title` is required, while injecting the bound slug proves nothing about whether extraction produced metadata ([types.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:815)).

There can be a published revision with blocks but no title:

- The column is nullable.
- Publication does not require a title.
- The importer accepts missing `meta.json` and writes `title: null` ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:232), [import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:509)).

A successful live extraction should have a title because HTML falls back to the slug.

7. The kind-based filename rule is right, but one premise and one larger omission are wrong.

`raw_filename` is the original uploaded filename, not `RawManifest.file`. The latter is an internal name derived exactly from kind: `html → raw.html`, `pdf → raw.pdf` ([260827aa-delete-the-importer.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827aa-delete-the-importer.md:329), [fetch.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:93)).

Use:

- Referenced row: derive from `raw_source_kind`.
- Legacy unreferenced row with `raw_bytes`: sniff.
- Both present but disagree: treat as corrupt; do not silently prefer one.
- Neither: return `null`.

It need not be wholly unreadable before C6.

However, C6 as written is NO-SHIP after `raw_bytes` is dropped: `RawManifest.bytes` is the network-byte count, while `raw_sources.bytes` is the stored-object count. They differ for non-UTF-8 HTML. Adding `storedBytes` does not preserve the required network count. Add a carried revision column for that count—or store the complete manifest/provenance—before demolition.