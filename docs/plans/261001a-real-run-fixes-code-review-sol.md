Found four issues; all are fixed in the working tree. I did not commit.

### Findings

- **R-1 — P0 — Author–year labels could confirm a mistyped identifier.**  
  A common surname and year, such as `Smith et al 2020`, was enough to accept whatever paper a mistyped arXiv ID resolved to. Its registry title could then confirm its own PDF.  
  Fixed in [paper-evidence.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/paper-evidence.ts:441) and [citation-registry.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citation-registry.ts:123): surname/year now only identifies a work when the article’s own reference entry also contains the registry title. Otherwise it remains `label-unconfirmed`, without being mislabeled an identity conflict. Added negative tests for the one-digit-wrong arXiv case.

- **R-2 — P1 — Page-one furniture could reopen C-2.**  
  A proceedings or journal header containing the target title could pass the identity check, even when the PDF’s real title was different.  
  Fixed in [paper-evidence.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/paper-evidence.ts:489): cleaned page-one text remains authoritative. A match found only in retained furniture now requires the expected first-author surname within the next three lines, approximating a title/byline pair. Added a failing-then-passing test with another paper’s title as a repeated header.

- **R-3 — P1 — Generic DOI suffix stripping corrupted valid identifiers.**  
  DOI suffixes are registrant-defined and opaque; `.pdf`, `.full`, or `v2` can legitimately be part of a DOI. This is confirmed by [Crossref’s DOI construction guidance](https://www.crossref.org/documentation/member-setup/constructing-your-dois/) and the [DOI Handbook](https://www.doi.org/doi-handbook/html/).  
  Fixed in [bibliographic.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/bibliographic.ts:183): rewriting is restricted to the observed bioRxiv/medRxiv and BioOne publisher URL shapes. Generic DOI endings are preserved. Added negative controls for `.pdf`, `.full`, `.abstract`, `-v2`, and `.v2`.

- **R-4 — P2 — Paper-only investigations overclaimed web evidence.**  
  The prompt still said web results had been read, and the UI heading claimed both paper and web extracts when none existed.  
  Fixed in [citation-investigate.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citation-investigate.ts:303) and [CitationInvestigation.tsx](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/web/CitationInvestigation.tsx:47). The prompt version is bumped, and paper-only results now have accurate copy. I removed one proposed client test because it could not fail against the old implementation.

### Migration assessment

The [migration](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/drizzle/20261001015331_citation_investigation_no_extract_with_paper.sql:1) is safe for existing production rows: the old constraint required at least one extract, so every existing valid row satisfies the weaker replacement. `coalesce(..., false)` correctly prevents `NULL` from satisfying the exception. It is also safe to deploy ahead of the code; old code continues producing at least one extract. Pending migrations run transactionally, so the drop/re-add does not expose an intermediate unconstrained state.

### Verification

- Focused run: 11 test files, 300 tests passed.
- Final affected run: 6 files, 221 tests passed.
- Full TypeScript typecheck and coverage typecheck passed.
- Migration journal/snapshot/digest tests passed.
- `npm run db:chain` passed.
- `git diff --check` passed.
- The PostgreSQL-backed route test could not run because no local database was reachable; static migration coverage passed, but that integration check remains to be run with Postgres available.

**Verdict: approve with the review fixes applied.** No known code blocker remains; the only outstanding verification is the database-backed route test.