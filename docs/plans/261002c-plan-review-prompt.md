You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, Postgres via drizzle, React client).

Plan: docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md

Read it, then read the code it touches and check its claims against the code, especially:
- src/term-match.ts (termPattern), src/glossary.ts (findOccurrences, inDocumentOrder, buildGlossary, isStale), src/term-lookup.ts (anchorIn), src/web/annotate.ts (termMarks)
- src/store/pg.ts loadGlossary and blockHashQuery; src/store/public-reader.ts glossary read
- src/store/pg-reading-time.ts and its routes in src/routes.ts (the owner-only per-article pattern the hide table copies); drizzle/ migrations and src/db/schema.ts readingTime
- src/web/useGlossary.ts (useGlossaryRead, look), src/web/GlossaryPanel.tsx (Term, Looked, visibleEntries), src/web/modes/glossary/GlossaryMode.tsx, src/web/reader/Reader.tsx (openTermInGlossary, termSelections), src/web/ProseHoverCard.tsx (TermCard)
- docs/project/glossary.md, docs/project/security-map.md

Questions I most want answered:
1. Is the hyphen/space equivalence correct and safe with the BEFORE/AFTER lookarounds, the SUFFIX, longest-first ordering, and termMarks' rendered-text offsets? Any form where it misbehaves?
2. Is recomputing entry.blocks + re-ordering in loadGlossary when not stale sound? Does it exactly reproduce write-time semantics (same block set)? Does anything rely on the stored order/blocks that this would break (cache hashes, job drafts, chat tools, comparisons with stored artefact)? Should the public reader do it too, and can it?
3. Hide design: is the table + PUT/DELETE + attach-at-read right? Which owner check should the routes use? Anything in the public read path or export that would leak or break? Any interaction with the threshold gate counts, ?term= clearing, the G key, Skim stop cards linking to a hidden term?
4. Dig deeper from the card via a one-shot request consumed by the owner's band: race conditions (band not mounted yet, glossary still loading, gate hiding the row, busy lookup), and is there a simpler way?
5. Anything simpler that gets the same result.

Report findings ranked by severity, each with file:line evidence and a concrete fix. Do not edit files.
