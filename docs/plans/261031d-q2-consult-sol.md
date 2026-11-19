**Verdict: choose A for the first live version. Build only a measurement-gated, constrained follow-up later—not general B.**

For the reader, adaptive searching could resolve a citation that the initial searches only half-explain. But the digest already searches broadly—1–2 searches and up to eight pages per lead—and exposes uncertainty through *could not tell* and *dig further*. Adding another round raises an approximately $1 run by 30%, extends an already long sequential pipeline, and makes every reader wait for research whose value is currently unmeasured. Chat provides the valuable escape hatch on the particular question the human cares about.

More importantly, unrestricted B risks epistemic trust more than money. A publisher controlling a page returned by the first search could plant instructions that make Haiku search for the publisher’s preferred framing, its own material, or irrelevant terms. They cannot initiate a digest: the owner must press, their page must first be returned, and caps limit the added spending. Their likely gain is steering the evidence and therefore the digest; wasting roughly $0.30 is secondary.

They do **not ordinarily see the resulting query merely because they authored the page**. OpenRouter and Exa see it. The page operator would need some additional observation channel to learn it. Nevertheless, the page could cause private article words from the lead passages to be copied into a query sent to those providers. The readers do not see the profile, so profile leakage is not available.

The existing defences bound, but do not remove, this:

- `validateQueries` strips addresses, emails, operators and control characters; enforces length, deduplication and caps. It does not detect semantic steering or ordinary article prose copied into a query.
- Quote checking proves that quoted words occurred in the returned text. It does not prove that the page is truthful, relevant or correctly interpreted; a hostile page’s genuine words pass.
- Fencing and no-tools calls reduce prompt-injection success, but turning the model’s answer into an outbound search restores operational leverage.
- Per-run and daily caps bound spending and fan-out, not evidence poisoning.

If the measurement justifies more depth, I recommend a narrower variant: follow up only on unresolved, consequential leads, with at most four follow-ups per run. The reader selects a target from a closed set; code constructs the query around a work already named by the planner or a deterministically verified DOI/bibliographic record. “Must share words with the first query” is too weak.

Minimum security properties:

1. No free-form page-derived query; closed selection plus code construction.
2. No profile or passage prose in the query; only approved bibliographic fields.
3. One round, one search per selected lead, and a small global cap.
4. Exa search only—no model-chosen URL fetching.
5. Preserve the first pass if follow-up fails; fence new evidence and re-check every quote.

Build it only if the 3–4 article measurement finds that roughly 20% of leads—or at least two important leads on multiple articles—remain unresolved specifically because one identifiable search is missing, and manual follow-ups materially change or resolve the digest. Generic *dig further*, inaccessible papers, or reader reasoning failures would not justify B.