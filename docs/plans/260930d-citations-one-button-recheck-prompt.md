# Narrow check: 260930d's changes after the code review (read-only)

Read-only; change nothing. Your code review of 260930d is docs/plans/260930d-citations-one-button-code-review-sol.md. After it, three commits changed code; check ONLY these, discovery is otherwise closed:

1. 40db96a4 — your C-2 was overruled: the no-match `remove` of the earlier find is undone (src/citation-investigate.ts "A no-match stores nothing", src/store/pg-citation-finds.ts, src/store/contracts.ts, the test "keeps an older code-identified match…"). Opus upheld the overrule with a copy fix.
2. The copy fix (the commit after 40db96a4): provenance says "an earlier quick check" (src/web/CitationInvestigation.tsx `investigationProvenance`).
3. fab4bc92 — the prompt forbids quotation marks outright and ANSWER_TOKENS 1,500 → 3,000, prompt version 4, after a reproduction found 4 of 5 real calls stopped by the quote guard. Evidence: docs/plans/260930d-quote-stop-rerun.log (7 of 7 finished after), scripts/probes/260930d-quote-stop-repro.ts, and the plan's § Review log.

Questions: Is anything in these three now untrue or broken — e.g. the prompt still telling the model elsewhere it may quote (grep INVESTIGATE_SYSTEM and investigatePart for any remaining permission to quote), the provenance wording false in some state, the remaining guard allowances now inconsistent with the prompt in a way that matters, the version bump missing somewhere it is pinned, the ceiling interacting badly with cost limits (INVESTIGATE_RATE_POLICY / the $20 budget in citations.md)? Run `npx vitest run tests/citation-investigate.test.ts tests/citation-investigation-view.test.ts tests/citations-panel.test.tsx`.

IDs R-1…, severity P0..P3, the concrete change. Verdict: land / fix first: ….
