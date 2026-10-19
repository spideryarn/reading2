You are reviewing the code of Stage 1 of a plan, in the Spideryarn repo (this working tree). READ-ONLY: do not edit any file — another agent is building Stage 2 in this same tree right now. Report findings only.

The plan: docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md — "Stage 1 (2B)" as amended by "The plan review, and what it changed" (R2, R3, R5, R6, R10). Your own plan review is docs/plans/261018o-plan-review-sol.md.

The code under review is exactly commit d55fe3d99: run `git show d55fe3d99 --stat` and `git show d55fe3d99 -- <file>` (ignore drizzle/meta/*_snapshot.json except to check it matches the migration). Do NOT review uncommitted working-tree changes; they are Stage 2, in progress.

The builder's notes on where it departed from the plan:
1. The keyless policy hashes exactly as before (policy left out of the hash when base) so the deploy moves no stored stamps.
2. A Crossref title match with no abstract goes to S2 but not to OpenAlex reconstruction, as today; a work found by OpenAlex's own title search does get the reconstruction.
3. OpenAlex title search sends only the title's words; surname compared locally.
4. An S2 429 turns S2 off for the run.

Please check, with file:line evidence:
1. Secrets: can either key reach a URL, a FetchFailure, a log line, Sentry, a stored row, or a non-matching host? Is the header attached only for the exact host? Is SEMANTIC_SCHOLAR_COMMERCIAL_USE=approved really required for every S2 request?
2. Keyless behaviour exactly unchanged (stamps, requests made, outcomes)?
3. The cascade phases: correctness of S2 identity (externalIds re-parse, doiFor compare, title agreement, paperId), OpenAlex adapter (display_name, first author by author_position, type refusals, book rule), MAX_TITLE_SEARCHES accounting, budget/deadline handling, the 401/403/429 handling, concurrency and limiter (new service, migration CHECK + seed, EXPECTED_SLOTS).
4. R3 source-policy stamp: does enabling a key re-ask registry negatives and re-run the step, without hiding notes? Any path that forgot the policy?
5. The S2 link on screen and in the public DTO: paperId validation, utm_source, no other registry value in a link.
6. Tests: do they actually exercise what they claim (could any pass while the code is wrong)? Missing tests that matter.
7. Docs/privacy text accurate to the code.

Answer with numbered findings, each with severity (P0/P1/P2/P3), file:line evidence, and a concrete fix. End with one line: "VERDICT: ship", "VERDICT: ship with fixes", or "VERDICT: rework".
