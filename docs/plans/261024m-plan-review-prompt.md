# Plan review: 261024m — a citation's hover card streams a note on what this paragraph cites the work for

You are reviewing a PLAN, read-only. Repository: this worktree (Spideryarn, TypeScript, Postgres via Drizzle, React client). The plan is the untracked file `docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md`; read it first.

The request (Greg, admin, verbatim in the plan) asked that hovering a source automatically start a deeper dive, possibly an "Ask in chat" with a default question, streamed into the hover card. The plan builds a cheap quick-tier note instead and asks Greg about the full-chat version. That scoping is my decision, not Greg's; the question in the plan is not yet answered.

Read, at least:
- src/link-summary.ts (the precedent, end to end), src/store/pg-link-summaries.ts, src/store/contracts.ts § LinkSummaryStore / SummaryKey / SummaryInputs, src/db/schema.ts § linkSummaries
- src/routes.ts § streamLinkSummary, src/web/link-facts.ts § the summary loader, src/web/ProseHoverCard.tsx § CiteCard and LinkRelation and the CiteCard call site (~line 848), src/web/useHoverCard.ts
- docs/project/links.md § And what it has to do with the piece in your hands; docs/project/bibliography.md § A note from the abstract, § Marked in the prose, in every mode, and § Nothing about the work beyond the article's bibliography
- src/citation-blurbs-identity.ts (what a stored abstract note holds; the abstract text itself is NOT stored, only sentences + quotes)
- docs/project/security-map.md for the untrusted parties

Questions I want answered:
1. Is the product shape right, and is the question to Greg fair (options, costs)? Is there a smaller version that gets most of the value, or a reason this note would be a "generic gist" failure (see links.md's test) given how little we hold about the work?
2. Copy the LinkSummaryStore protocol into a new `cite_notes` table + store, versus a generic store over both, versus something else. Which, and why?
3. The key and fingerprints: is (owner, article, work_id, block_id) right given that CitedWork ids are inherited across re-runs by `key`? What must go in the fingerprints so a stale note is never served?
4. Authorization/abuse: anything the route must refuse that the plan misses (visitor, bibliography absent, block not in citedAt, etc.)? Prompt-injection surface from article text / entry / abstract quotes?
5. The trigger: dwell 600 ms after the 320 ms open, owner only, only from a citing paragraph. Anything wrong with how that interacts with useHoverCard (warm swaps between cards, touch, Marginalia's reuse of CiteCard)?
6. Anything in the plan that is wrong about the codebase.

Severity scale: P0 (would ship broken or unsafe), P1 (must fix before building), P2 (should fix), P3 (nit). Give each finding an ID (F1, F2, …), a severity, the evidence (file:line), and the fix. End with a one-paragraph verdict.

My own suspicions, last: (a) the prompt may have too little to say about the work when no abstract note exists, and fall back to restating the paragraph; (b) the dwell might be better tied to the card's open state than to a separate timer; (c) the stream reader in link-facts.ts may not be shareable without churn.
