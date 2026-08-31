NO-SHIP.

## Findings

1. Critical — the rebuilt guard still skips real Stage 3 changes.

[`blockIdentityFree`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:589) removes every Spideryarn-shaped ID and collapses every `#spya-……` reference to the same token. I reproduced two false-current states against the actual `STEPS.blocks` guard:

- Stored block: `<p id="spya-aaaaaa">Alpha.</p>`
- New extraction: `<p id="spya-bbbbbb">Alpha.</p>`
- Stage 3’s candidate uses `spya-bbbbbb`, but `stepIsDone` returns `true`.

And:

- Old extraction links to `#first`.
- New extraction links to `#second`.
- Stage 3 changes the rendered link from the first heading’s block ID to the second’s.
- The guard returns `true` because both targets normalize to `#spya`.

This occurs under Postgres, where old stamped HTML still satisfies the membership check while new extracted HTML is checked independently. The previous argument does matter: it gives unchanged candidates the exact old IDs and therefore makes an exact comparison possible. The comment at [pipeline.ts:724](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:724) claiming otherwise is wrong.

The guard also never compares `candidate.html` with `stampedHtml`, so a changed document head or swapped IDs in stamped HTML can pass independently of block equality.

Use the baseline and compare:

- candidate blocks exactly, including IDs and exact link targets;
- `candidate.html` exactly against `stampedHtml`.

Keep membership as a cheap early rejection. Add the two probes above as tests.

The rebuilt guard does correctly close the previously reported merge, heading-kind, external-link, and sanitiser over-fire cases; I executed all four.

2. High — the importer can report success while creating `StampDisagrees`.

The guarded upsert itself is correct: [import.ts:1403](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1403) updates only imported rows.

But with a real pipeline row:

1. [import.ts:1055](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1055) overwrites the artefact JSONB.
2. `setWhere` refuses to update the pipeline row.
3. The transaction commits successfully.
4. [stampForStep](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:818) subsequently throws because artefact and row disagree.

The new test at [store-import-revision.test.ts:377](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-import-revision.test.ts:377) proves only that the row was not restamped; it deliberately leaves the poisoned pair and never calls `stampForStep`.

If imports can still encounter pipeline-owned revisions, the importer should abort the transaction rather than return success. Otherwise deletion at Stage 3 must be guaranteed before that state becomes reachable.

3. High — existing imported revisions cannot supply Stage 3’s chosen input.

The importer intentionally writes:

- `extractedHtml: null`
- `stampedHtml: …`

at [import.ts:1040](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1040). Draft creation carries both columns at [pg-revisions.ts:208](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:208).

That directly contradicts [blocks.ts:1221](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1221), which claims no state exists with stamped HTML but no extracted HTML.

After the flip, a blocks-only job over an imported article will:

- copy `extractedHtml = null`;
- fail the guard;
- have no `BLOCKS_INPUT_HTML` from which converted Stage 3 can run.

Settle this in Stage 1b: explicit legacy handling, or refetch every imported article before the flip. The current plan defers corpus refetching until Stage 4.

Also, `BLOCKS_INPUT_HTML` presently binds only the guard. Actual Stage 3 still reads `htmlFile` at [blocks.ts:1479](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1479). The filesystem mapping is correct, and Postgres maps the two names to the correct distinct columns, but the constant does not mechanically bind the future converted runner yet.

4. Medium — `sketch` belongs in this stage’s `isCurrent` work.

[`isCurrent`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1657) still has no `case "sketch"` and falls through to `true` at [pg.ts:1741](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1741).

Concrete failure: carry a completed sketch, then change the tree, title, URL, or blocks. `loadSketch` reports it stale at [pg.ts:1989](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1989), while the metadata page reports its stage done.

This stage already widened the sketch fingerprint and its projections, so leaving the consumer unwired makes the “all six completed” claim false. Follow `ideasAreCurrent`: compare the source/version/model, and copy the artefact’s own `profileHash` onto both sides because metadata lacks the current job profile.

5. Scope contamination — the supplied diff contains Quotes work.

[src/types.ts:697](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:697) and [src/types.ts:897](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:897) add `QuotesFound`, `Quote`, `Quotes`, and `QuotesResponse`. None is Stage 1a work. Leave `src/types.ts` out of the Stage 1a commit.

## The other accepted fixes

- Importer imported-row convergence: correct, subject to finding 2.
- Two fingerprint families: correct. I executed the URL and fallback-slug cases; `articleWithIdsFingerprint` moves while `articleFingerprint` correctly ignores URL.
- `metaFingerprintOf(null-title)`: correct.
- `citedMetaFingerprintOf` and the `final_url` projections: correct.
- Literal `useArticleRename` references were removed, but several changed comments still say “renamed article” ambiguously. Prefer “the extracted title changed.”

Some comments are now factually stale: [source-hash.ts:256](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:256) and [artifacts.ts:537](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts.ts:537) still describe all six stages as using `articleFingerprint`; ideas and sketch now use its URL-carrying sibling.

## Idempotence and cost

I found no current non-idempotent input class. I compared exact HTML and exact blocks across 313 targeted/combinatorial cases, including canonical footnotes, nested lists, anchor retargeting, sanitiser removal, embeds, templates, malformed nesting, SVG, orphan text, and duplicate IDs. All were stable. This remains evidence, not proof, but idempotence is not today’s blocker.

The 687 ms cost is acceptable temporarily; weakening correctness is not. There is no cheap exact pre-check with the data currently stored. In particular, filesystem alias equality is unsafe because `runBlocks` writes HTML first and blocks second at [blocks.ts:1487](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1487), so interruption can leave two generations with the same IDs.

The exact optimisation is persisted binding: record digests for Stage 2 input, stamped output, and blocks, transactionally with the step run. Then the guard can hash bytes first and parse only on an unbound or legacy state.

Focused Vitest could not start because the read-only sandbox blocked Vite’s `.vite-temp` write. Typechecking ran through the Node loader: the web project passed, while root/tests failed solely on concurrent unfinished Quotes changes.