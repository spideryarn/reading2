You are reviewing a plan before it is built, in the repo at the current directory (Spideryarn, a TypeScript reading app on Postgres). Read-only review.

The plan: docs/plans/261002f-glossary-add-a-looked-up-term.md. Read it in full.

Context to read:
- docs/user-feedback/260904_1301-glossary-search-box-for-a-term.md (why "add" was deferred: three reasons)
- docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md (the per-owner hide state just landed; the brief says reuse it rather than build a second store)
- src/term-lookup.ts (makeAskAboutTerm, anchorIn, patternsFor), src/store/pg.ts loadGlossary (~line 3430), src/store/pg-glossary-hidden.ts, src/store/public-reader.ts (glossary projection), src/public/dto.ts, src/glossary-occurrences.ts, src/types.ts GlossaryEntry / AskedTermAnswer, src/db/schema.ts glossaryLookups & glossaryHiddenEntries, src/routes.ts the /api/glossary/:slug/ask route (~line 1960 and ~8416), src/web/GlossaryPanel.tsx AskATerm (~line 1590), src/web/useGlossary.ts, src/web/glossary-shown.ts, src/store/article-rows.ts and src/store/export.ts, src/chat-tools.ts glossary tool, src/vocabulary-sources.ts.

Questions:
1. Is the plan correct against the code? Name any place it would break: the glossary_lookups attach for an id not in the blob, `?term=` validation, export coverage tests, any read that assumes every entry id is in the stored blob (e.g. lookUpTerm / Dig deeper on an added term, the hide presence check, the stale-list logic, Skim stop cards), the public DTO.
2. Is there a simpler design that answers the three deferral reasons? In particular, judge "every finished look-up adds" vs an explicit Add button, and the new table vs reusing glossary_hidden_entries.
3. Privacy/security: does any path leak an added term or its answer to a visitor of a shared article, or let a non-owner write?
4. Anything missing from the tests in the Stages section.

Write your findings, most severe first, each with file:line evidence, to the output file. End with a verdict: build as is / revise then build / rethink.
