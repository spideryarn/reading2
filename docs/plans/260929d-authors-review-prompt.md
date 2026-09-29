You are reviewing a plan before it is built, in the repository at the current directory (Spideryarn:
TypeScript, Postgres via drizzle, React client). Read-only: do not edit files.

The plan: docs/plans/260929d-authors-and-affiliations-at-import-shown-and-linked.md. Read it, then read
the code it touches before judging it:

- src/meta-authors.ts and src/extract.ts (`readArticle`, `runExtract`, where `chooseByline` is called)
- src/pdf-frontmatter.ts (the prompt `SYSTEM`, `SCHEMA`, `assemble`, `frontMatterFingerprint`) and
  src/pdf-read.ts where `front?.byline` becomes `meta.byline`
- evals/pdf/titles.mts, evals/pdf/titles/expected.json, one fixture's records-*.json
- src/store/artifacts-pg.ts (`META_COLUMNS`, `metaColumns`, `readMeta`), src/store/pg.ts (the
  projection map and `metaFrom`), src/store/pg-revisions.ts (carry policy), src/store/public-reader.ts,
  src/store/export.ts, src/db/schema.ts
- src/web/Masthead.tsx (the `facts` line), src/web/Metadata.tsx, src/web/Tooltip.tsx,
  src/web/shelf-narrow.ts and src/web/library-hits.ts (the shelf's `?q=` search)
- docs/project/sql.md, docs/project/prompting-guide.md, docs/project/security.md on untrusted PDF text

Questions I most want answered, in order:

1. The PDF design lets the front-matter model write author names and affiliations as text, held to a
   word-by-word provenance check (plan § 3). Is the check sound? Can a hostile PDF get arbitrary text
   into `meta.authors` or `meta.byline` through it, and does the three-letter run-on allowance open a
   hole? Is there a simpler check that is at least as strong?
2. Is deriving `meta.byline` from the author list (names joined "; ") safe for every consumer of
   `byline` — Referee mode's `authorKeys` in src/referee-candidates.ts, the prompts' `BY:` line, the
   public card cap, the freshness fingerprints?
3. JSONB vs a column/table for `authors`, given docs/project/sql.md. And does adding a column need
   anything I have not listed (store parity tests, a projection-map test, export tests, the visitor's
   payload type)?
4. Does `/read?q=<name>` actually find the other articles, given how `queryTerms` and `fold` treat a
   name like "Samuel A. Nastase" or "Yun-Fei Liu"?
5. Anything in the plan that is wrong about the code, or a simpler route to the same outcome for
   Greg's request.

Answer with numbered findings, each with a severity (P0 blocks building, P1 fix in the build, P2
worth a note), the file and line you are relying on, and what to change. Be concrete; skip praise.
