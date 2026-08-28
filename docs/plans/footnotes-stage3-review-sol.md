## Verdict

**BLOCKER.** The automatic/asked guarantee is false. Two automatic model calls still receive supplement prose, and the test claiming otherwise omits both.

All line numbers below refer to commit `01b55b2`.

### 1. Automatic prompts still read footnotes

- `src/toc.ts:129-135` renders every block. A prose footnote is `gistable`, so it is not even marked as excluded. `generateToc` sends that unfiltered rendering at `src/toc.ts:672`.
- The model may therefore create sections and gists from notes. `buildTree` then copies those gists at `src/toc.ts:447-455`.
- `src/labels.ts:475-512` walks every block between a batch’s first and last body block, plus context. Supplements are printed as `NOT-GISTABLE`, but their complete text is still sent at line 508.

This also contaminates later calls indirectly: arc, tweets, glossary, ideas and summaries receive tree titles/gists produced by the ToC call, even though their direct article evidence is filtered.

Change:

- Build the model’s ToC over body blocks, then append the deterministic supplement subtree before labels and full-tree validation. The stage-4 plan already describes the required shape.
- In `renderBatch`, skip `!isBodyEvidence(block)` entirely. Marking apparatus is not hiding it.
- Add ToC and labels to `tests/block-policy-prompts.test.ts`.

No asked call was accidentally filtered. Explain, search and converse still receive the full block array; `tests/block-policy-prompts.test.ts:158-186` checks that correctly.

### 2. `hashBlocks` is not actually framed

`src/source-hash.ts:101-103` uses unescaped NUL and SOH delimiters. Distinct classified articles can therefore have identical canonical bytes. I reproduced this with valid block IDs:

- Two ordinary classified blocks.
- One classified block whose text contains the first block’s trailing fields, SOH, and the second block’s fields.

Both produced `40903304d3685a1c`. `tests/source-hash-roles.test.ts:102-113` tests the old tab/newline separators, not the new delimiters.

Change to an unambiguous representation—length-prefixed fields or `JSON.stringify` over fixed-position arrays—and call it `spya-blocks/3`.

For the narrower questions:

- With valid `spya-*` IDs, the legacy and v2 canonical strings cannot be identical because their prefixes differ. Their 64-bit truncated SHA outputs can still collide mathematically.
- Two all-null legacy inputs retain exactly the same equivalence relationship as before because the old algorithm is unchanged.
- The pinned literals are genuine: `158467c^:src/source-hash.ts:49-51` produces `21189fa4eb0bceca` and `66d8a4e76744ae83`.
- Classified → all-null immediately changes v2 back to the legacy hash, so the latest classified artefacts become stale. Returning to an old legacy cache is semantically consistent with the now-unclassified blocks, but it silently masks a classifier regression. If losing all classification must be exceptional, enforce that as a state transition; the hash cannot distinguish intentional removal from detector failure.

### 3. Store normalization is correct, but its proof is missing

The real Postgres paths do normalize correctly:

- `src/store/artifacts-pg.ts:1057-1059` writes absent fields as null; `:463-465` maps them back to absent.
- `src/store/pg.ts:575-577` and `src/store/pg-revisions.ts:381-383` do the same.
- Narrow queries retain null, which `hashBlocks` normalizes with `?? ""`.

I found no fourth two-column feed into `hashBlocks`. The three narrow reads are `pg.ts:649-654`, `pg-searches.ts:146-151`, and `store/import.ts:501-506`; the other feeds read complete blocks.

But the synthetic classified round-trip in `tests/block-roles.test.ts:370-405` uses only the filesystem store. The committed `data/` and `example/` corpus contains no classified blocks, so the Postgres round-trip does not prove these columns survive.

A mutation that should survive the whole suite: change `src/store/artifacts-pg.ts:1058` to always write `treatment: null`. Add a classified Postgres artefact fixture.

### 4. Predicate audit

Direct `gistable` consumers left:

- `src/toc.ts:132` — wrong; described above.
- `src/web/TableView.tsx:674` — fine. This is intrinsic visual treatment of non-prose blocks, not supplement policy.
- `src/blocks.ts:884,1225` — fine. Splitter diagnostics.
- Store, schema and DTO occurrences — fine. They transport the field rather than interpret policy.
- `src/store/pg-shelf.ts:231` — fine. Its SQL is the intended `isSearchable` equivalent.

Search agrees: `library-search.ts:242` uses `isSearchable`, while `pg-shelf.ts:223-232` filters only on `gistable` and deliberately ignores treatment.

The three semantic search assertions are well placed for the predicate, filesystem library search and chat. They are not enough for the independent SQL implementation. `tests/block-policy.test.ts:199-212` is a fourth, source-text guard, but there should also be a real supplement hit in `tests/store-shelf-pg.test.ts`.

### 5. Word counts

The two aggregates are aligned. Both use `ORDER BY ordinal` at `src/store/pg.ts:1102` and `:1110`, and `(revision_id, ordinal)` is unique at `src/db/schema.ts:729`.

The “nothing cheaper can fix it” claim is too strong:

- Recomputing only `word_count` from existing roleless rows cannot work.
- But `article_revisions.stamped_html` is stored (`src/store/import.ts:599`) and contains the note-container stamps. A one-off repair can derive treatment/note IDs from that HTML and existing block IDs, then recompute the scalar—without refetching or rerunning paid stages. Older rows lacking canonical stamps may require stage 2/3 over stored source.

Reader-visible changes beyond the stated card and masthead:

- `src/web/ProfilePage.tsx:175,283` now sums body counts but labels the result “words in all”. That is newly false.
- `src/web/Tweets.tsx:445-456` now says the thread came “from” body words. This is defensible because the prompt also excludes notes, but it is another changed number.
- Metadata, public pages, hover cards and the table repeat the intended shelf/masthead values.
- `src/extract.ts:125` remains a separate `characters ÷ 5 ÷ 200` reading-time formula. It is CLI/debug output, but it still bypasses the seam.
- `src/web/tree.ts:295-303` and `src/web/graph.ts:301-304` sum all words for layout geometry, not displayed reading time; fine.

### 6. Tests that overclaim

- `tests/block-policy-prompts.test.ts:113-155` says automatic stages never see notes but omits ToC and labels.
- `tests/labels-batching.test.ts:212-220` proves footnotes are not numbered for labels, while their prose still reaches `renderBatch`.
- `tests/source-hash-roles.test.ts:117-149` hand-builds narrow arrays. It does not exercise the saved-search or importer queries. `tests/store-block-reads.test.ts` covers only the actual `pg.ts` query.
- The null normalization test at `tests/source-hash-roles.test.ts:55-62` does not pass through Postgres.
- `articleWordCounts` tests cannot detect positional divergence in `scalarInputsQuery`; no test calls or inspects that query.

One further persistence hole: `checkNoteFields` validates each field independently at `src/store/import.ts:233-247`. It accepts `role: "footnote"` with no supplement treatment, or an arbitrary string `noteId`. That stores something declaring itself a footnote while every policy treats it as body. Require at least `footnote ⇒ supplement`, and validate imported footnote IDs against `NOTE_ID_PATTERN`; add matching database constraints where appropriate.

No files were changed.