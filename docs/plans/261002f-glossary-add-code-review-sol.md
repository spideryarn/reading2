# Glossary added-term code review — GPT Sol

Up: [plans.md](../project/plans.md)

Reviewed commit `0abd03712`, the revised implementation plan, and every finding in the plan review.
The explicit decisions in the review brief take precedence where the revised plan still says the
opposite: a hide does not follow an absorbed added entry, and Chat sees the term's name and note but
not its lookup answer.

## Findings

1. **Medium — rollback restore discarded the field that makes the row an added term.** The rollback
   exporter writes `addedName` into `glossary-lookups.json`
   (`src/store/export.ts:790-804`), but the fixture type and the database seeder did not carry it
   back. Restoring an export therefore recreated the answer with `added_name = null`; the owner's
   read no longer made an entry from it, so the added term disappeared and a later export made the
   loss permanent. This is asymmetric format evolution across a bidirectional serialization
   boundary. **FIXED:** added the rollback-file shape with `addedName` (`src/glossary-lookups.ts:73-110`),
   restored it into the row (`tests/helpers/seed-reader-state.ts:360-382`), and added a fixture-to-DB
   regression (`tests/helpers-seed-reader-state.test.ts:284-315`).

2. **Low — the stated regression matrix was incomplete at the edges the plan review called out.**
   The implementation tests did not force a blob-ID collision, did not cover a returned added ID
   absent after refresh, checked only one malformed result arm, and did not directly pin either
   Dig deeper on an added entry or Chat's privacy boundary. The absorbed-entry test also did not
   prove the deliberate rule that its old hide stays behind. **FIXED:** added deterministic
   collision and non-following-hide assertions (`tests/glossary-added-term.test.ts:178-197`,
   `tests/glossary-added-term.test.ts:259-276`), the absent-after-refresh and remaining malformed
   arms (`tests/glossary-ask-adds-term-band.test.tsx:249-257`,
   `tests/glossary-ask-adds-term-band.test.tsx:298-313`), an added-entry Dig deeper case
   (`tests/term-lookup.test.ts:438-463`), and a Chat test that proves the name/note are present while
   the private answer and source are absent (`tests/chat-glossary-tool.test.ts:40-72`).

3. **Low — comments and one existing test still asserted the pre-change “nothing is stored”
   contract.** That made the code explain two incompatible products, and
   `tests/glossary-compact-header.test.tsx` still expected the obsolete *Not added to the list*
   tooltip even though the component had changed it. **FIXED:** updated the route, hook, lookup,
   panel and bundle descriptions to the stored-owner-entry contract (for example
   `src/web/GlossaryPanel.tsx:1582-1605` and `src/web/useGlossary.ts:769-794`), corrected the tooltip
   assertion (`tests/glossary-compact-header.test.tsx:380-388`), and recorded that an absorbed
   answer follows while its hide does not (`docs/project/glossary.md`, “A finished answer adds the
   term”).

## Checks without findings

- `addTerm` resolves ownership through the transaction handle, then locks the same article row
  before reading the current revision, lookups, hides, matching or minting
  (`src/store/pg-lookups.ts:107-174`). A competing add waits; at PostgreSQL's default READ COMMITTED
  isolation its later statements see the winner. Publication's update of `articles` and child-row
  inserts protected by the article foreign key also conflict with that row lock, so the comment's
  serialization claim holds. The no-glossary arm writes nothing, matching uses the article quote,
  IDs include blob, lookup and hidden IDs, and `owner_id` comes from the ambient owner.
- Added IDs flow through the owner's combined `loadGlossary` result, so Dig deeper, hover cards,
  `?term=`, occurrence relocation and fresh Skim cards are generic over them. Stale Skim still drops
  the whole glossary by the stated product decision. Both export projections include the column and
  the schema-derived sentinel sets it.
- The public reader never joins `glossary_lookups`; the direct non-owner write and public-read tests
  cover the two privacy sides. Chat's owner-only combined read now has the explicit no-answer test
  above.
- `isAddedTerm` validates both ID-bearing arms and the `hidden` boolean
  (`src/web/useGlossary.ts:102-121`). `AskATerm` selects and clears only after that ID is present in
  the refreshed list (`src/web/GlossaryPanel.tsx:1633-1649`), so an absorbed/missing row leaves the
  answer in place and an unscored added row is not immediately removed by the threshold.

## Verification

- PASS — `node --import tsx scripts/typecheck.ts` (all four TypeScript projects; all source files
  covered). The `npm run typecheck` wrapper itself could not create tsx's `/tmp/*.pipe` IPC socket
  under this sandbox, so the same script was run directly without that wrapper.
- PASS — focused unit run: 5 files, 57 tests, including the added-term band, wire validation, Chat
  boundary, fixture loader and tooltip contract.
- PASS — focused Stop-card and ask-in-chat run: 2 files, 20 tests.
- PASS — scoped Biome lint: no errors; seven existing informational complexity/fragment notices in
  `src/routes.ts` and `src/web/GlossaryPanel.tsx`. `git diff --check` also passed.
- BLOCKED BY SANDBOX — the private-Postgres tests, including
  `tests/glossary-added-term.test.ts` and `tests/helpers-seed-reader-state.test.ts`, cannot open
  `127.0.0.1:54362` here (`connect EPERM`). Their new cases typecheck, but they still need one run in
  an environment allowed to reach the already-running local database.

**Verdict: APPROVE WITH FIXES; run the focused private-Postgres tests outside this socket-restricted sandbox before landing.**
