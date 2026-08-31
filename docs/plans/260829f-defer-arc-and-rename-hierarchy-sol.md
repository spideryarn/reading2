Verdict: revise before building. The settled scope is safe, but the plan has three correctness gaps: incomplete freshness inputs, no complete client trigger/read design, and an incomplete rename sweep.

All findings below are checked against the working tree unless marked “inference.” I did not run tests because this was a read-only static review.

1. Arc is optional everywhere — agree, with one wording change

Checked:

- Both article types make it optional: [src/types.ts:1048–1053](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:1048), [src/public-types.ts:118–133](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public-types.ts:118).
- Both stores require blocks and tree, but conditionally include arc: [src/api.ts:203–231](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:203), [src/store/pg.ts:1176–1196](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1176).
- The public path also tolerates it: [src/store/public-reader.ts:323–387](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:323), [src/public/dto.ts:329–350](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:329).
- `buildArcColumn` returns `null`; `TableView` falls back to the ordinary root gist: [src/web/tree.ts:327–360](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:327), [src/web/TableView.tsx:698–750](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/TableView.tsx:698).
- The spine and stats use the tree, not arc: [src/web/App.tsx:1074–1083](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1074), [src/web/stats.ts:41–77](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/stats.ts:41).
- Metadata and `has.arc` only report presence: [src/web/Metadata.tsx:673–683](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:673), [src/web/ShelfEntry.tsx:217–230](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ShelfEntry.tsx:217).

Change: say “all current read and render paths tolerate an absent arc.” The current fallback is usable content, not a Loading state; that state will be new.

2. Removing arc exposes silent staleness — agree, but it is already possible

Checked:

- `cascadeForce` propagates only through the steps already present in that job: [src/jobs.ts:185–196](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:185).
- Therefore a job containing only `["toc"]` cannot invalidate, add, or force `arc`.
- `stepIsDone` falls back to artefact existence when no stamp/check exists: [src/pipeline.ts:504–517](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:504).
- Arc currently has neither a stamp nor `isDone`: [src/pipeline.ts:1183–1212](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1183).
- Exact range lookup silently omits unmatched arc sections: [src/web/tree.ts:341–360](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:341).

Change: replace “introduces a staleness bug” with “turns an existing explicit-`toc` refresh hole into the normal refresh path.” Add a red test specifically for forced `steps: ["toc"]` beside an existing arc.

3. Blocks plus tree are necessary, but not sufficient

The structural reasoning is right:

- Arc reads blocks and tree: [src/arc.ts:269–294](/Users/greg/Dropbox/dev/experim/spideryarn2/src/arc.ts:269).
- Its prompt uses tree titles and gists, so identical ranges with changed wording require regeneration: [src/arc.ts:152–173](/Users/greg/Dropbox/dev/experim/spideryarn2/src/arc.ts:152).
- `structureHash` includes ids, parents, ranges, titles and gists: [src/source-hash.ts:146–208](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:146).
- `ideas` is the correct structural precedent: [src/ideas.ts:108–127](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:108).

But arc also reads metadata and feeds title, byline and site name into the prompt: [src/arc.ts:277–335](/Users/greg/Dropbox/dev/experim/spideryarn2/src/arc.ts:277), [src/article-prompt.ts:119–131](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-prompt.ts:119). A metadata-only change would currently escape the proposed fingerprint.

Change:

- Include the metadata fields actually used by `articleText`.
- Test changed gist/title with identical ranges, plus metadata-only changes.
- Update PostgreSQL step-status calculation too; it currently treats arc as presence-only: [src/store/pg.ts:1270–1315](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1270).
- Decide how the public DTO handles the new provenance field: [src/public/dto.ts:193–203](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:193).

Also, every legacy `arc.json` will lack the new hash and become stale. That interacts directly with the visitor problem below.

4. Existing shared links remain compatible — agree; the rationale is wrong

Checked:

- After the rename, `mode=toc` will parse as unknown, producing `null`, and the query-state default will select `hierarchy`: [src/web/params.ts:263–268](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/params.ts:263).
- I found no schema field, reader-profile field, localStorage record or IndexedDB record storing only the mode id. View state is URL-owned: [docs/project/url-state.md:1–24](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/url-state.md:1), [src/db/schema.ts:158–184](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:158), [src/web/lib/offline-store.ts:31–66](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/offline-store.ts:31).

However, `toc` does appear in generated URLs: `withMode` always writes the parameter, including the default: [src/web/Dock.tsx:641–655](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Dock.tsx:641).

Change:

- Say old links are safe because unknown values fall back, not because `toc` never appeared.
- Add an explicit legacy `?mode=toc` test.
- Make `withMode("hierarchy")` delete the parameter so future default URLs are canonical.

5. The listed mode/step classifications are right, but the table is incomplete

`src/web/Metadata.tsx:678` is definitely a pipeline-step reference and must remain `"toc"`: [src/web/Metadata.tsx:673–683](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:673). Its `STAGE_ICONS.toc` entry is also a step reference: [src/web/Metadata.tsx:222–230](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:222).

Material omissions include:

- Mode-bearing URLs in [src/types.ts:1992–1997](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:1992) and [src/routes.ts:1718–1723](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:1718).
- Additional mode and visible-label references in [src/web/App.tsx:1122–1135](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1122), [src/web/App.tsx:1800–1820](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1800), [src/web/Dock.tsx:297–301](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Dock.tsx:297), and [src/web/library-hits.ts:108–111](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/library-hits.ts:108).
- More visitor tests than the one listed: [tests/visitor-gaps.test.ts:98–99](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/visitor-gaps.test.ts:98).
- Active docs including [docs/project/url-state.md:170–174](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/url-state.md:170), [docs/project/glossary.md:124–134](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/glossary.md:124), and [docs/project/web-client.md:88–91](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/web-client.md:88).

Change: redo §3.3 as an exhaustive acceptance sweep. Preserve historical plans, postmortems, direct Greg quotations, pipeline-step names and `toc.json`.

6. Use a narrow arc route

Recommendation, based on checked code but not benchmarked: add the narrow route.

The current article read loads blocks, tree and arc together in both stores: [src/api.ts:203–231](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:203), [src/store/pg.ts:1176–1196](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1176). Refetching it after one small artefact changes repeats the expensive projection.

Change:

- Add `loadArc` to the reader contract and both stores.
- Have the route distinguish current, stale and absent arc.
- Do not render a known-stale arc while rebuilding; otherwise the exact-range join can show a plausible but incomplete result.
- Keep the public read path bundled.

7. The visitor hole must be settled before build

Checked: putting the hook in `OwnedReader` preserves the no-POST visitor contract, because visitors take a separate branch: [src/web/App.tsx:769–859](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:769).

But the hole is larger than new articles: adding a required stamp makes every legacy arc unstamped. Signed-out readers cannot trigger repair.

My recommendation: keep arc out of the blocking ingest job, but enqueue a second, non-blocking arc job after the tree-producing job finishes. That preserves early navigation while eventually serving visitors.

Do not generate it from an anonymous GET: that turns public reads into paid mutations and exposes an abuse path.

If the smallest scope must remain strictly owner-triggered, explicitly accept and test permanent root-gist fallback for visitors. It is functionally safe, but it is a product regression.

8. Deferring arc may help, but “one call in three” is not supported

Checked:

- ToC makes one structure request followed by potentially many label-batch requests: [src/labels.ts:1242–1269](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1242).
- Label batches may be parallel or serial depending on cacheability: [src/labels.ts:1355–1371](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1355).
- Arc is one later serial request.

Therefore request count does not establish the saving. The relevant quantity is arc wall time divided by total ToC-plus-arc wall time.

Arc does not consume `navLabel`, so in principle it could overlap label generation after the structural tree exists. Today that intermediate tree is not published until labels have merged: [src/toc.ts:756–837](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:756). Exposing it would add a new intermediate artefact or callback, so I do not consider that a cheap change.

Change: measure the baseline before changing defaults. Treat label deferral/overlap as separate work.

9. Reorder the commits

The current order has an unsafe deployment gap: it removes arc from defaults before the client reliably starts or reads it.

There is another missing detail: `useStepJob` does not auto-start. It only returns `start`: [src/web/useStepJob.ts:145–159](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useStepJob.ts:145), [src/web/useStepJob.ts:188–208](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useStepJob.ts:188). The plan needs an effect that calls it, local arc state, race handling, and a decision whether every owned article read or only Hierarchy mode triggers it. `OwnedReader` currently cannot see the mode, which is owned lower down: [src/web/App.tsx:1112–1140](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1112).

Safer order:

1. Measure the baseline.
2. Add the complete stamp and status logic while arc remains a default.
3. Add the narrow read route, owner auto-start, local state and stale-arc suppression.
4. Resolve visitor/legacy-arc handling.
5. Remove arc from defaults and add it to `FORCE_ONLY_WHEN_NAMED` together.
6. Perform the rename separately.

Freshness is useful by itself because it fixes the existing explicit-`toc` hole; the plan’s claim that steps 1 and 2 are “worthless apart” is incorrect.

Also update the active architecture docs that currently say arc has no hash and is protected by default cascade: [docs/project/architecture.md:173–203](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/architecture.md:173), [docs/project/ingest-queue.md:393–430](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/ingest-queue.md:393), [docs/project/database.md:126–135](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/database.md:126).

10. The sanitiser quotation is fair

I checked the surrounding docstrings. The plan has not quoted them selectively: the stored-block stamp is the primary guard, while the browser sanitiser remains a second render-time defence: [src/sanitize.ts:1–30](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize.ts:1), [src/web/sanitize.ts:1–40](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/sanitize.ts:1). No change needed.

