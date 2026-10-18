# Visitors on a shared link get the front and back matter folds

Queue item `qi-8y3tx5tp`. Report `spya-ftsqsn` (`SPIDERYARN-READING2-JE`), question
[q-f7zp3t](../user-feedback/questions/q-f7zp3t.md), note
[261017_2012](../user-feedback/261017_2012-front-and-back-matter-folded-by-default.md). Follows
[261018a](261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md), which built the
folds for the owner only.

## What Greg said

> 1A / 2B / And let's broadly try and remember these as principles. If we make a change that would
> affect all of the existing articles, assume that we're not going to re-import all of the existing
> articles unless I explicitly ask you to, because that would be somewhat expensive and probably a
> bit disruptive. So assume that we're just going to fix or improve things for new. And, and that,
> you know, if something's going to make the experience better and that it would be straightforward
> enough to include for shared articles, and it doesn't incur extra AI processing and it doesn't give
> away anything sensitive, then, you know, include it for shared articles too. And that way you don't
> have to ask me these questions every time. So make a minimal update to write this up as a principle
> in the appropriate docs.
>
> — Greg, 2026-10-18 (`spya-r8arjm`, reply to `q-f7zp3t`)

- **1A**: existing articles are left alone; they fold the new way when re-imported. No backfill
  (`qi-erfq52cg` was dropped by the sweep).
- **2B**: a visitor gets the same folds. That is his say-so for this one edit to the public DTO, a
  listed defence (`qi-exhw79tc` superseded).
- **The two principles**, written up minimally where they belong (below).

## What crosses, and what does not

`PublicArticle.matter?: MatterStretchStored[]` — per stretch `{ from, to, kinds }`: two block ids
the visitor already has, and closed kind names from `MATTER_KIND_NAMES`. They are the model's
classification (combined with the labels rule and held to the text by code), but **no model prose**
crosses (plan review F2): the stored document's `version`, `generator`, `sourceHash`,
`modelUnavailable` and any `unavailable` reason stay behind. The labels and the (i) text a visitor sees are the app's own words.

It crosses under exactly the owner's rule, `matterForReader`: only a valid `ok` document of today's
version whose `sourceHash` equals `matterInputHash` of the blocks on this payload, every id a block
here, the stretches in order. Otherwise the key is absent and the client falls back to the older
byline rule, as today. No paid call: the read only reads a column.

## Build

1. **A leaf for the reader's half.** `matterForReader` lives in `src/matter-step.ts` and
   `matterInputHash` in `src/matter.ts`; both import the model gateway, which the public import graph
   forbids (`tests/public-imports.test.ts`, `SPENDS`). Move `matterForReader`, `matterInputHash`,
   `MATTER_HASH_VERSION`, `MatterBlock` and `MATTER_PROMPT_VERSION` into a new pure leaf,
   `src/matter-current.ts` (node:crypto, `matter-shape.ts`, types). Update the importers directly
   rather than re-exporting (six files). The version constant's comment already says it is not where
   it belongs; it moves with the check that reads it.
2. **The read.** `PUBLIC_PROJECTIONS.article` selects `articleRevisions.matter`. `loadArticle` in
   `src/store/public-reader.ts` calls `matterForReader(found.revision.matter, blocks)` over the
   sanitised `blocks`, the same input the owner's `loadArticle` hashes (`blocksFor` sanitises too).
3. **The DTO.** `publicArticle` takes the raw column (`matter: unknown`, required so a reader that
   forgot it is a type error) and `publicMatter` asks `matterForReader` of it against the row's
   blocks, then builds each stretch field by field. The policy is then in the DTO, where a unit test
   can hand it a whole stored document and ask what crossed (review F3).
4. **The client** needs nothing: `resolveAccess` spreads the public payload into the `Article`, and
   `matterStretches` (src/web/matter-view.ts) already reads `article.matter`. Correct the comments
   that say a visitor never has it (types.ts, matter-view.ts, front-and-back-matter.md).
5. **Tests**, each seen red first: `tests/public-dto.test.ts` (the stretches cross, the document's
   other fields do not, absent stays absent); `tests/public-reads.test.ts` (the article query
   selects `"matter"` on the filtered row); `tests/public-visibility-pg.test.ts` or a new pg test
   (a stored current document reaches a visitor; a stale one does not).
6. **Docs.** security-map.md: a paragraph under the allowlist section, Greg's words, what crosses and
   what does not. The two principles:
   - **No re-import by default**: architecture.md § Conventions already has the 2026-10-11 rule; add
     today's quote to that bullet, which extends it to re-imports.
   - **Shared articles get it too**: security-map.md § The allowlist has two failure directions
     ("come here and decide") gains the default, with his conditions (better experience,
     straightforward, no extra AI processing, nothing sensitive) and his words; mode.md's visitor
     bullet points there.

7. **The owner's sharing inventory** (review F1): `WIRE_ROW` in `tests/shared-inventory.test.ts`
   is total over `PublicArticle`, so `matter` maps to the *text* row, and that row's sentence in
   `src/messages.ts` now says the front and back matter start folded.

## The simpler option passed over

Re-export from the old modules instead of updating importers: fewer lines touched, but two names for
one thing, which the rename rule here asks us not to leave. Rejected. Hashing the raw rows or the
sanitised blocks gives the same answer, since the sanitiser changes only `html` (review F4); the
blocks are used because they are what the payload carries.

## Risk

Low. The stretches are ids into blocks the visitor already holds, and kinds from a closed list. The
failure direction worth testing is the quiet one: the key never crosses and the visitor sees today's
behaviour, which every owner-side test would miss.

## The plan review

GPT Sol, read-only, [261018l-plan-review-sol.md](261018l-plan-review-sol.md): *revise*, five
findings, all taken. F1 (the sharing inventory's total record, and its sentence) is step 7. F2 (the
stretches *are* the model's classification; what stays behind is its prose and provenance) is in
§ What crosses. F3 (test provenance where the whole document is visible) is why the DTO takes the
raw column, plus a Postgres case comparing owner and visitor through the real routes with a
non-null `level` in the fixture. F4 (the sanitiser does not touch the hash's fields) corrected
§ The simpler option; the hash test now also covers `id` and `role`. F5 (stale references to the
moved symbols) was a sweep.
