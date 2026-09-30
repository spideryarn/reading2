# Plan review: Citations — one button, Look it up and Investigate merged (260930d)

Read-only; change nothing.

Plan: docs/plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md (this worktree's HEAD). The request, from Greg: "In Citations mode, can we amalgamate "Look it up" and "Investigate" buttons to get the best of both worlds?"

Context in the tree: docs/plans/260930a-citations-investigate-one-work-on-demand.md (Investigate, shipped today; its § Review log carries your earlier findings and the quote-guard history), docs/plans/260929g-check-a-cited-paper-supports-the-claim.md (Look it up), docs/project/citations.md, src/citation-find.ts (`makeFindCitation`, `findWorkPage`, `judgeLookup` via src/citation-lookup.ts), src/citation-investigate.ts (`makeInvestigateCitation`, `matchedPageOf`, the fingerprint in src/citation-investigate-context.ts), the two routes in src/routes.ts, src/web/CitationsPanel.tsx, src/web/CitationInvestigation.tsx, src/web/useCitations.ts, docs/user-feedback/awaiting-approval.md.

Questions:
1. Does the merged press really keep the best of both — identity by code, the verified quote, the link upgrade, the streamed reading — or does something one of them did get lost or weakened?
2. Step ordering: the matched page, request, allowed quote texts and fingerprint are computed after step 1. Any race or staleness (the list re-made between step 1 and the read; a current lookup whose find row was deleted; a lookup that exists but is `no-extract`/`unreadable`)? Does "skip step 1 when a current reading exists" pick the right condition?
3. Failure semantics: step-1 no-match / provider error continues to step 2; step-1 save failure fails the press. Right? What does the reader see in each, and can the row end up showing a lookup and an investigation that disagree about the matched page?
4. Removing `POST …/find` and the Look it up button: anything else depends on them (grep)? Old cached clients after deploy?
5. Cost/limits: one bucket for a press that now makes two calls. Is taking only `citation-investigate` sound?
6. Is "one product call, taken the simple way" (losing the 3¢ press) fairly stated, or is it a real trade-off Greg should decide before we build?
7. Anything simpler.

Severity P0 (ships something false or unsafe to a reader) / P1 (wrong design, rework) / P2 / P3. IDs P-1… with section, problem, concrete change. Verdict: build / build with changes / rethink.
