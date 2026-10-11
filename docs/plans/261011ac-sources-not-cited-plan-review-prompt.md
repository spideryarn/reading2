You are reviewing a PLAN (no code yet) in the Spideryarn repo, read-only. The plan is
docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md. Read it, then read enough of
the code it leans on to judge it: src/citation-index.ts (the OpenAlex "Cited by" lookup this
copies), src/bibliographic.ts (inServiceTurn, the shared limiter), src/web/modes/sources/SourcesMode.tsx,
src/web/sub-modes.ts (SOURCES_SUB_MODES), src/web/activation.ts (activationForSources),
src/web/sources-counts.ts, src/types.ts (CitedWork, Bibliography), docs/project/sources.md,
docs/project/reception.md § Cited by, docs/project/security-map.md.

Facts measured by the author on 2026-10-11 (you have no network): OpenAlex
/works?search.semantic=<title+abstract>&filter=publication_year:<2018 cost 10 credits and returned
highly relevant NMT/attention work for "Attention Is All You Need"; OpenAlex's referenced_works for
that paper missed works the paper does cite (Sutskever 2014, ByteNet); related_works and
cites-filter coupling were poor.

Judge: is this the right v1 for "what the piece does not cite" given Greg asked to prioritise by
ease and value? Is the exclusion against our Bibliography sound, and what false "not cited" or
false exclusions will it produce? Is the cache keyed on a query hash safe (privacy, sharing between
articles/owners, logging)? Anything in the security map this crosses (outside party's text,
links built from its answer)? Anything missing from the stage list that a new Sources sub-mode must
touch? Simpler alternatives?

Output: findings with IDs F1.., each with severity P0 (wrong/harmful), P1 (should fix before
building), P2 (worth doing), P3 (nit), the evidence (file:line), and the fix. End with a one-line
verdict: BUILD, BUILD WITH CHANGES, or RETHINK.
