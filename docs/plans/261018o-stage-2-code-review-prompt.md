You are reviewing, and fixing, the code of Stage 2 of a plan, in the Spideryarn repo (this working tree, a git worktree). You may edit files. Fix what is inside this stage, narrowly, each finding red-first with a test that reproduces it (watch it fail, then pass). Report — do not fix — anything wider. Do not commit; run no version-control command that discards work (read docs/project/version-control.md). Never deploy, never touch the production database, .env.local, systemd or infra/. Do not make paid model calls.

The plan: docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md — "Stage 2 (1B)" as amended by "The plan review, and what it changed" (R1, R4, R7, R8, R9 override the earlier text). Your plan review: docs/plans/261018o-plan-review-sol.md.

The code under review is commit d4a69807c (show it with --stat first; ignore drizzle/meta/*_snapshot.json except to check it matches the migrations). Stage 1 (d55fe3d99, 74125968d) is already reviewed.

The builder's departures from the plan:
1. No response_format schema on the writer call (web_search + require_parameters, unmeasured; reception.ts documents an unsupported field turning into a 404); prompt-specified JSON read strictly by code. The check call keeps its schema.
2. arXiv /html/<id> accepted alongside abs and pdf.
3. The check prompt became checkSystem(evidence); abstract output byte-identical (pinned), so CITATION_BLURBS_VALIDATION_VERSION did not move.
4. 409 bodies carry `reason`.
5. Marginalia's Cites line does not draw web notes (deferred).
6. admin-articles ownWords: true for the table (as citation_finds).
The builder wrote tests after the code and ran mutation checks instead of red-first.

Please check, with file:line evidence:
1. Identity (R1): can any page that is not the work's own pass pageIsTheWork? DOI matching boundaries (suffix of a longer DOI, case, URL-encoding, a DOI in a query string of a citing site), arXiv ids and versions, hosts (subdomains, lookalikes), the title "whole" requirement. The not-the-article checks.
2. The route: order of free refusals vs spend; ownership; the allowance (one at a time, re-read after taking it, release on every path, finish-and-store after disconnect but no spend before); what is stored vs transient (R4); a race of two presses; a 503 from registries.
3. The model calls: request shape matches citation-find's (Exa, max results, require_parameters, tools), max_tokens vs thinking, readWebNote's strictness, prompt injection from the extract into the writer and the check, cost tracking (jobs registered everywhere; ledger rows).
4. Read side: shownWebNote rebuild/caps/isWebUrl/no credentials/host recompute; identity attach; abstract note wins; never public, never chat; export/transfer/deletion inventories complete.
5. Client: only the prose card's Open in Sources triggers it, owner only, single flight, rows with a note don't fire; stage lines; text rendered as text; link rel; the (i) sentence.
6. The SSE stream: frames, end/abort handling, error copy (docs/project/copy.md).
7. Tests: could any pass while the code is wrong? Missing ones that matter.
8. Docs accurate to the code (bibliography.md, database.md, privacy.md, the help page).

Write your findings to the answer file: numbered, severity (P0-P3), file:line, what you fixed (with the test) or what you recommend. End with one line: "VERDICT: ship", "VERDICT: ship with fixes" (meaning: with the fixes you made), or "VERDICT: rework".
