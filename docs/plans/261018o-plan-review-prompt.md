You are reviewing a plan before it is built, in the Spideryarn repo (this working tree). Read-only: do not edit files.

The plan: docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md

Background to read:
- docs/plans/261017h-stage-3-design-citation-blurbs.md (the shipped abstract-note design and its review G1-G10)
- docs/investigations/261017c-citation-blurbs-cost-and-quality.md (the spike: arm A abstracts, arm B one web search per work)
- docs/user-feedback/questions/q-ny49p3.md (the question Greg answered "1B / 2B")
- src/citation-evidence.ts, src/citation-blurbs.ts (judgeNote, checkRequest), src/citation-blurbs-identity.ts, src/citation-blurb-words.ts
- src/citation-find.ts (readFind, the web-search request shape), src/citation-lookup.ts (resultIsTheWork), src/shingles.ts
- src/fetch.ts fetchBibliographicJson and BIBLIOGRAPHIC_HOSTS, src/bibliographic.ts (limiter, inServiceTurn, coolAfter)
- src/dig-deeper.ts admitDig, src/routes.ts around the Dig deeper / investigate routes, src/stream-run.ts, src/web/lib/sse.ts
- src/web/BibliographyPanel.tsx, src/web/ProseHoverCard.tsx (Open in Sources), src/public/dto.ts
- docs/project/security-map.md, docs/project/bibliography.md, docs/project/cost-tracking.md

Please check, with file:line evidence:
1. Key handling: is appending OPENALEX's api_key inside fetchBibliographicJson and redacting it from FetchFailure enough to keep it out of logs, Sentry, the ledger and stored rows? Anything else that records a bibliographic URL (cache rows, log lines, error messages, Sentry breadcrumbs from fetch instrumentation)?
2. The cascade: is the Semantic Scholar batch + identity rule (id equal AND title agrees) sound? Is refactoring the strict title rule to cover OpenAlex items correct, and are there OpenAlex-specific traps (authorships order, display_name vs title, type vocabulary differing from Crossref's, search syntax/escaping)? Does anything in the 261017h stamps/partial/negatives logic break when new sources appear?
3. The web note (stage 2): are the identity clauses (annotation URL, resultIsTheWork, not the citing article, judgeNote, the check call) the right ones and in the right order? Is resultIsTheWork strict enough to mean "the work's own page, never someone else's"? Is reusing the dig-deeper allowance right? The SSE-stages-only (no prose streaming) decision vs the repo's "stream any model call a person is waiting on" rule.
4. Storage: the new citation_web_notes table vs alternatives; identity attach; owner-only; the 7-day negative.
5. Security: anything about rendering a search result's URL/title/extract-derived sentences in the owner's UI; prompt injection from the extract.
6. The Semantic Scholar licence finding: is building it key-gated and asking Greg the right handling?
7. Anything missing, or a simpler version that keeps what Greg chose.

Answer with numbered findings, each with severity (P0/P1/P2/P3), file:line evidence, and a concrete fix. End with a one-line verdict: "VERDICT: proceed", "VERDICT: proceed with fixes", or "VERDICT: rethink".
