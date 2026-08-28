Overall: **NO-SHIP**. The block-ID fix is sound, but D also breaks glossary and idea identity carry-over, and the proposed guard is not strong enough.

| # | Verdict |
|---|---|
| 1 | **NO-SHIP** |
| 2 | **SHIP** |
| 3 | **SHIP** |
| 4 | **SHIP** |
| 5 | **NO-SHIP** |
| 6 | **NO-SHIP** |
| 7 | **NO-SHIP** |

1. **NO-SHIP — the hazard is real, but “every ID on every run” is false.**

A re-extraction or full re-ingest is dangerous: stage 2 supplies fresh unstamped HTML, and the production caller supplies no previous blocks except through `runBlocks`’ filesystem read. Without that file, unchanged paragraphs are minted again.

But a blocks-only rerun over already-stamped HTML keeps IDs directly from the HTML at [src/blocks.ts:750](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:750). That path does not need previous blocks. So the accurate claim is:

> After D, every stage-3 run whose input came from stage 2 will re-mint every ID unless previous blocks are supplied from the store.

D must also specify which HTML stage 3 consumes. Prefer `extractedHtml`, falling back to `stampedHtml` for legacy/blocks-only cases. Merely saying “read HTML from the store” is ambiguous because Postgres deliberately has both columns.

2. **SHIP — `revision_blocks` is sufficient, and HTML byte equality is not required.**

The plan overstates what the matcher compares. For a block with text, `exactKey` uses only `tag` and whitespace-collapsed `text`; it ignores `html`. For a textless block, it extracts only the `src` attribute from `html`. The folded pass uses only `tag` and `text` [src/blocks.ts:328](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:328).

Therefore whitespace or serialization differences in the whole HTML fragment cannot make ordinary paragraph matching fail.

The Postgres adapter:

- selects every relevant field;
- orders by `ordinal`;
- returns `html` unchanged [src/store/artifacts-pg.ts:427](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:427);
- writes those same fields and derives `ordinal` from array order [src/store/artifacts-pg.ts:994](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:994).

No schema change is needed. Read through `ArtifactStore`, not directly from the table.

3. **SHIP — read the draft’s own carried rows.**

`beginDraftIn` copies the published revision’s block rows into the new draft before any stage runs [src/store/pg-revisions.ts:525](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:525). Those rows are exactly the frozen baseline stage 3 needs.

This is not “matching against itself” in the dangerous sense:

- Before the first stage-3 write, they are the previous published blocks.
- After a failed computation, the transactional write has not replaced them.
- On a deliberate second stage-3 run, matching against the immediately preceding result is correct idempotence.

Read them before `writeBlocks` deletes and replaces them. Use `store.read`, not `has`: carried completion rows make `has` answer a different question.

4. **SHIP — but make it a three-way distinction.**

The correct cases are:

- No `basedOn` revision: genuine first ingest; mint.
- `basedOn` exists but its copied baseline is missing or unusable: fail.
- Store operation throws: propagate the failure and fail the stage.

Do not warn and mint. That converts an infrastructure fault into irreversible identity loss.

The existing Postgres reader already propagates connection and permission failures [src/store/artifacts-pg.ts:465](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:465). The missing piece is distinguishing a legitimate first draft from an existing article whose expected baseline returned `null`. That requires carrying `basedOn` or an equivalent baseline-state signal into D.

5. **NO-SHIP — the old guard dies, but the suggested replacement is insufficient.**

Confirmed: after the files disappear, `previousBlockCount` returns zero [src/pipeline.ts:453](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:453), so the warning at [src/pipeline.ts:1059](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1059) becomes unreachable.

Counting resolved comments and search hits is useful as a migration audit, not as the main guard:

- It misses chat-thread anchors.
- Search hits are generated, source-hashed data and are allowed to become stale.
- Comments deliberately point at `block_identities`, not necessarily the current revision.
- An article with no existing reader anchors would let a totally broken matcher pass.
- Aggregate counts can hide which particular anchors changed.

Use three protections:

1. At runtime, compare baseline IDs with output IDs. A non-empty baseline and non-empty output with zero intersection should stop the stage or publication unless there is an explicit whole-article-replacement operation.
2. Add a Postgres-path integration test: published blocks → copied draft → fresh stage-2 HTML → stage 3 → unchanged paragraphs retain exact IDs. Also prove a failed baseline read throws.
3. Run the comments/chat/search resolution audit as a one-off deploy or corpus check, comparing exact anchor sets rather than only totals.

6. **NO-SHIP — “fix stage 3 before re-ingest” is right, but the full sequence is incomplete.**

The re-ingest must occur only after:

- stage 3 reads the carried draft baseline;
- the zero-overlap guard exists;
- glossary and ideas read their previous outputs from the store;
- B3’s checkpoint store exists;
- the source route works without files;
- the publication gate is enabled.

The source route cannot wait until a later demolition step: the plan itself says it must move no later than D [delete-the-importer.md:1255](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/delete-the-importer.md:1255).

The safe order is broadly: identity carry-over fixes and B3 → D plus source access → replacement suites → delete importer → enable gate → re-ingest → compatibility release → validate export/source paths → later drop `raw_bytes`.

7. **NO-SHIP — there are two more prior-output dependencies.**

The same omission exists in two later stages:

- **Glossary:** it reads `glossary.json` to append a top-up, preserve entry IDs during regeneration, retain earlier entries, and maintain `passes`/`elapsedMs` [src/glossary.ts:1078](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:1078). If D removes that read, “Find more terms” becomes “replace the glossary with one fresh batch,” resets its history, re-mints IDs, breaks `?term=` links, and leaves paid glossary-lookups detached.
- **Ideas:** it reads `ideas.json` solely to inherit IDs when regenerating against the same source [src/ideas.ts:757](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:757). Losing it breaks every surviving `?idea=` link.

Tweets and summaries read their own files only for freshness checks; D already intends to replace those with store stamps. ToC label progress and PDF chunk reuse are the checkpoint dependency already assigned to B3.

The D acceptance suite therefore needs an explicit case for “a stage reads its own previous artefact,” not merely the existing proposed case that a stage reads the previous stage’s output.