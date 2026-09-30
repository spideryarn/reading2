# Plan review: Citations' Investigate button (260930a)

You are reviewing a PLAN, read-only. Do not change any file.

Plan: docs/plans/260930a-citations-investigate-one-work-on-demand.md at commit 91093a3e (this worktree's HEAD).

Context to read (all in the tree):
- docs/plans/260929g-check-a-cited-paper-supports-the-claim.md — the prior, shipped work (5G) this builds on, and its reviews' lessons (R-1..R-8).
- docs/project/citations.md — what Citations mode is today.
- src/explain.ts (explainStream, buildExplainMessages, SYSTEM) — the plan proposes generalising this.
- src/term-lookup.ts and the route streamTermLookup in src/routes.ts — the pattern copied (streamed, stored per entry, `done` only after save).
- src/citation-lookup.ts, src/citation-find.ts — 5G's identity rule and quote verification.
- src/openrouter-stream.ts collectSearchEvidence / MAX_EVIDENCE_EXCERPT.
- src/ai-call.ts AI_JOB_ROUTE and src/models.ts — job registry.
- docs/project/ai-gateway.md, docs/project/prompting-guide.md, docs/project/security-map.md.

The request (Greg, admin): an on-demand "Investigate" button per citation row that does web research into whether the cited work corroborates the claim, how else it relates to the article, plus an addendum from the reader profile and "why you're reading this one" — instead of doing it for every citation. Hard rule from 5G: be explicit about whether the actual paper was obtained, so nothing is hallucinated. Simplest version first.

Questions I want answered:
1. Is generalising explainStream (a prompt seam + job name + opt-in evidence) the right reuse, or would a separate module be simpler/safer? Name the specific risk to existing explain/glossary callers.
2. Is the "what was read" line honest as specified? In particular: is "search extracts, not the full text" actually always true for openrouter:web_search on this wire? Is running 5G's identity rule over every evidence page sound, or does it answer a weaker question?
3. The post-hoc quote check on streamed prose (double-quoted runs >=6 words checked against collected extracts): will it work — does the model see the same text we collect (annotation `content`), are there cases where a correct quote is reported missing or an invented one passes? Is "report, don't rewrite" acceptable?
4. Staleness hash, storage shape (sql.md: columns over JSON), privacy/export, allowance numbers.
5. Anything simpler that gets most of the value; anything missing for the 5G honesty rule.

Severity scale: P0 (ships something false or unsafe to readers), P1 (wrong design / will need rework), P2 (should fix), P3 (nit). Give every finding an ID (P-1, P-2, …), the file/section, the problem, and the concrete change. End with a verdict: build / build with changes / rethink.

My own suspicions, last: (a) the prompt seam might silently change explain's cached prefix; (b) the model may quote from its own memory of the paper and that looks identical to a search quote; (c) identity matching over up to ~40 pages might accept a citing page as "the work's own page"; (d) whether streaming then post-hoc marking gives a reader an unverified quote before the check line arrives.
