Review the code built from this plan, and fix what you find inside it.

Plan: docs/plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md
(read its "GPT Sol's plan review, and what changed" section: it records what was done with your
plan findings F1 to F8).

The stage is one commit, the tip of this worktree's branch: `git show --stat HEAD`, then
`git show HEAD` for the diff. The tree is clean, so anything `git diff` shows afterwards is yours.

What it does: at import, the `extract` step (and the `metadata` step for a minimal paper) finds the
article's own DOI or arXiv id without a model, asks `lookupWork`, and keeps the registry's journal,
DOI and publication day only when the registry's title and one author agree with the article's.
The Metadata page prints the day and the journal under the title. Nothing stored is backfilled.

Files: src/article-registry.ts (new), src/bibliographic.ts (WorkRecord.published, realIsoDay,
crossrefDay), src/store/pg-bibliographic.ts, src/db/schema.ts, drizzle/20261003235102_*.sql,
src/pipeline.ts (articleRegistryDeps, withArticleRegistry, keptPaperMetadata, the three call sites),
src/extract.ts (ownIds), src/store/artifacts-pg.ts, src/store/pg.ts, src/store/pg-revisions.ts,
src/types.ts (Meta.journal), src/web/Metadata.tsx (the facts line), tests/setup/provider-guard.ts,
tests/article-registry.test.ts, tests/bibliographic*.test.ts, tests/minimal-paper.test.ts,
tests/metadata-origin.test.tsx, docs/project/content-extraction.md.

Look hardest at:
1. Can a wrong work's date or journal reach an article? Walk `ownIdsOfPdf`, `ownIdsOfDocument`,
   `registryIsThisArticle`, `registryAuthorIsOurs`, `withRegistryFacts`. Try: a cited work's DOI on
   page 1 by one of the same authors with a title that is this title plus a subtitle; a one-word
   family name that is also a common word in a byline; a byline that is free text ("By the
   Economist staff"); a `dc.identifier` that is an ISBN or a URL; a DOI with a trailing bracket or
   an angle bracket in running text; DOI_IN_TEXT's `g` flag and `lastIndex` across calls.
2. `keptPaperMetadata`: can it now carry a stale `publishedAt` or `journal` onto an article where
   that is wrong (a web page whose publisher removed its date; a re-extract of an article whose
   previous DOI came from this same registry step and no longer agrees)?
3. `metaColumns` writes `journal ?? null` and `publishedAt ?? null`. Is there any path where a
   re-run of `extract` on an existing article loses a date it had, or gains one it should not?
4. Does `journal`, or a registry-supplied `publishedAt`, reach a visitor or any public projection?
   It must not in this version.
5. The new CHECK and the raw SQL in pg-bibliographic.ts: a `release`, a not-found write, or a
   refresh of a found row that now states no day. Does any write leave a `published_day` on a
   non-found row and so violate the check at run time?
6. The provider guard change: does refusing api.crossref.org and api.datacite.org break any other
   test's legitimate use (a test that stubs fetch is fine; one that relied on reaching the network
   is the finding)? You have no network or database in this sandbox, so name the tests to run and
   I will run them.
7. The Metadata facts line: duplicate React keys (`key={fact}`) if two facts are the same string;
   the journal/siteName de-duplication.
8. Anything that reports success while doing nothing.

Fix what is inside this stage, narrowly, each fix with a test that fails without it. Report, do
not fix, anything wider. You can run a test file that needs no database or network with
`npx vitest run tests/<one>.test.ts` and a script with `node --import tsx <script>`; not `npm test`
or `npm run typecheck`. tests/article-registry.test.ts, tests/bibliographic.test.ts and
tests/metadata-origin.test.tsx need neither. tests/minimal-paper.test.ts and
tests/bibliographic-pg.test.ts need Postgres: I will run those.

Findings as P0/P1/P2 with an ID each (C1, C2, …) and file:line, saying for each whether you fixed
it. End with a one-line verdict: land, or not yet. Be brief.
