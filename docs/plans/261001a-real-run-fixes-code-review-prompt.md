# Code review: plan 261001a, the fixes the real runs called for

You are GPT Sol. You reviewed this plan and every stage of it; stages 1–6 are committed. The real runs
(read § Real runs, 2026-10-01 in `docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md`)
found four things, and the uncommitted change in `docs/plans/261001a-real-run-fixes-code-review.diff`
fixes them:

1. **P0 — a press that read the paper kept nothing.** With the paper in hand the model ran no web
   search, and both `src/citation-investigate.ts` (NOTHING_READ) and the `citation_investigations_counts`
   CHECK required an extract. Now zero extracts is allowed only when `paper_state = 'read'`, with
   `coalesce` so that a NULL can't pass the CHECK; there is a new migration
   `drizzle/20261001015331_citation_investigation_no_extract_with_paper.sql`, and the view has a
   sentence for it. A paid re-run of the same press now finishes.
2. **Author–year labels** (`Santoro et al 2016`) were called identity conflicts. `authorYearLabel`
   and `registryIdentifiesCitation` in `src/paper-evidence.ts`, shared with `src/citation-registry.ts`:
   a label agrees when the registry's first author's family name and its year match; the registry's
   title then becomes what the PDF must show.
3. **The page-1 title was stripped as a running header.** The identity check now reads page 1 with
   its furniture kept (`linesWithFurniture` in `src/paper-text.ts`); what is chunked and sent is
   unchanged.
4. **A DOI's publisher suffix** (`.full`, `.abstract`, `.pdf`, …, and a bioRxiv `v\d+`) is dropped in
   `parseWorkId` (`src/bibliographic.ts`), and the paper's address is built from the normalised id.

Look hardest at whether 2 and 3 reopen your P-2 (a mistyped identifier confirming itself) or C-2 (a
paper that merely cites the work being confirmed):

- Can a label match the wrong paper? Think of a common surname, the same year, and an arXiv id typed
  wrong by one digit.
- Can a running header that is *another* paper's title — a journal issue's or a proceedings' header —
  now pass the page-1 check?
- Is stripping `.pdf` or a `v2` ever wrong for a real DOI?

Also look at:

- the migration (a CHECK dropped and re-added; is it safe on production rows, and ahead of the code);
- the prompt line near `src/citation-investigate.ts` ~306 that still says "You read search results
  about it", which is false when the search returned nothing — fix it if it is worth fixing;
- tests that could not fail.

**You may fix what you find** in these files (sandbox workspace-write); run `npm run typecheck` (or
`node --import tsx scripts/typecheck.ts`) and the affected tests by path. Do not commit. Findings as
id, severity, evidence, and what you did. End with a verdict.
