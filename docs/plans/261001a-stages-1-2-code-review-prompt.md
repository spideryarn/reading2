# Code review: plan 261001a, stages 1 and 2

You are GPT Sol. You reviewed this plan before it was built
(`docs/plans/261001a-citations-read-the-paper-plan-review-sol.md`); the plan was revised to take every
finding (`docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md`,
§ Stage 1, § Stage 2, § Review log). Now review the code built for **stages 1 and 2**, uncommitted in
this working tree. The whole change is in `docs/plans/261001a-stages-1-2-code-review.diff` (tracked
diff plus every new file); read the files themselves for context.

Stage 1: `src/bibliographic.ts`, `src/store/pg-bibliographic.ts`, `fetchBibliographicJson` in
`src/fetch.ts`, the three tables in `src/db/schema.ts` and `drizzle/20260930232254_bibliographic_lookup.sql`,
tests `tests/bibliographic*.test.ts`. Stage 2: `src/paper-evidence.ts`, changes to `src/paper-text.ts`,
`src/pdf.ts` (`pass0` abort and character cap), `src/citation-lookup.ts` exports, test
`tests/paper-evidence.test.ts`. Nothing calls either module yet except tests; stage 3 will.

The builders' own notes on decisions the plan did not settle — judge each:

- Stage 1: the claim lasts 30 s, not 20; a record with no title is stored as not-found; a claim-only
  row has null state and an error deletes it; Retry-After is capped at 1 h; 404/410 = not-found; a
  Crossref record over 1 MB is `unavailable` every time and never cached.
- Stage 2: over the character cap → refuse (`too-large`) rather than truncate; `registryTitleAgrees`
  = one title a prefix of the other, or ≥80% of the citation's significant words; the registry's first
  author stands in when the citation has none, only after the registry title agreed; "different
  identifier" = the landing page's meta DOI or the final address's arXiv id (arXiv's 10.48550 DOI
  counted as that id), and a DOI printed in the PDF text is not checked; a References heading before
  300 words is ignored; a tail chunk under 60 words is merged; zero-score chunks fill the budget
  earliest first; `sentText` is `[cN, page P]\n…` per chunk and `sentSha256` hashes exactly that;
  with `pdfOnly` a failed `citation_pdf_url` is `unreadable`; the registry is asked before the fetch.

Look hardest at:

- the DB limiter's correctness under concurrency across instances (claims, slots, spacing, cooldown
  — races, leaks when a caller dies, a missing seed row);
- whether a mistyped DOI, or a paper that merely cites the work, can still be confirmed;
- `verifyPassage` scoping;
- the abort really stopping pdf.js work and freeing memory;
- the SSRF / host guard in the JSON caller;
- the migration being safe to apply to production ahead of the code (additive only);
- silent-success tests (a test that could not fail).

**You may fix what you find** inside these stages' files (sandbox workspace-write): make the fix, run
`npm run typecheck` and the affected test files by path, and list each fix. Do not commit. Report
anything wider for me to decide. Findings as id (C-1 …), severity (P0/P1/P2/P3), evidence file:line,
and what you did (fixed / left for the orchestrator, and why). End with a verdict.
