You are reviewing a short implementation plan in the Spideryarn repo (TypeScript, Postgres). Read-only review.

Plan: docs/plans/261007k-repeat-paste-is-free-and-says-so.md

Read the plan, then check it against the code it names:
- src/routes.ts, the POST /api/jobs handler (search `kind: "exact"` near `path: JOBS_PATH`), and parseJobRequest
- src/jobs.ts: enqueue, freeSlug, slugAlreadyHolding
- src/store/find-article.ts: slugForUrlKey
- src/billing/admission.ts: withIngestSlot
- src/web/AddPage.tsx: articleAnswer, completion, Phase, the completion effect (~lines 1150-1280)
- src/web/ProseHoverCard.tsx: the `add` function and describeAdd
- src/mcp/tools.ts: import_article, withLink
- docs/project/billing.md § "The quota, and the one thing it has to survive", § "A public article counts half" (the 'charges again' line), § "Which requests spend a slot"
- tests/billing-admission.test.ts (the harness the new test will use)

Questions:
1. Is short-circuiting at the route before withIngestSlot correct and safe? Any way it lets a script get free model work, or skips work a caller really asked for? Is the `no steps, no force` condition the right one?
2. Is there any other caller of POST /api/jobs {url} that would break on a 200 {article, repeat} answer (search src/web and src/mcp)? Anything in the add page (sharing at add, High-powered AI intent, purpose box, openEarly) that misbehaves when the completion is an articleAnswer for a repeat?
3. Does a repeat paste today do anything useful we would lose (e.g. refetch a changed page, un-archive, queue modes)? Check DEFAULT_INGEST_STEPS caching and publishRevisionIn.
4. Anything simpler?

Answer with numbered findings, severity P0-P3, each with file:line evidence. Be concise.
