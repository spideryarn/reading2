# Plan review, round 2: Citations' Investigate button (260930a)

Read-only. Do not change any file.

Plan: docs/plans/260930a-citations-investigate-one-work-on-demand.md at commit 6059f29b. Your round-1 review is docs/plans/260930a-citations-investigate-plan-review-sol.md (verdict: rethink). The plan was rewritten: quote-free streamed prose with a refuse-to-store quote guard, verified quotes left to 5G's Look it up, no identity line, a lower-level stream runner extracted from explainStream (move-only, explain request snapshots first), Exa pinned, one context hash including profile and model, probe-first allowance numbers, export coverage.

Check narrowly:
1. Is each of your P-1..P-8 closed by the revision? Name any that is not, and why.
2. The quote guard: "every run of six or more words inside straight or curly double quotes must be found in the article itself (findQuote strict), else the whole answer is not stored and the client replaces the streamed text". Holes? (e.g. single quotes, block quotes, quotes under six words, a source quote that happens to also be in the article, a reader with a profile containing quotes.) Is refusing the whole answer right, or too blunt?
3. The provenance sentence: "We did not obtain the paper itself, or the full text of any page. This was written from search extracts of N results (hosts). It is the AI's reading of those extracts, paraphrased, not quoted." Is every clause true on the wire the plan specifies?
4. Anything new the revision introduced.

Severity P0..P3, IDs Q-1, Q-2, …, a concrete change for each, and a verdict: build / build with changes / rethink.
