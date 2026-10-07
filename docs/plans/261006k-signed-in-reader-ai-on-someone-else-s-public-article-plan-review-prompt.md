# Review request: a plan that answers a question and builds nothing

You are reviewing `docs/plans/261006k-signed-in-reader-ai-on-someone-else-s-public-article.md` in this repository. Read-only: do not edit any file except to write your findings.

Background. Greg (the owner of this product, an admin) filed a feedback report: "I'm wondering if we should allow AI processing (e.g. search) if they are logged-in on a public article? Would that create extra complexity? If not, and if you think it's a good idea, proceed." An unattended session may build only if no listed security defence is touched (docs/project/security-map.md § Where the defences physically live) and the complexity is small. The plan concludes: it does add complexity, nothing is built, and it puts options A to D and two questions to Greg.

Please check, against the actual code and docs, not the plan's prose:

1. Every factual claim in the plan. In particular: that a signed-in non-owner is treated exactly as a signed-out visitor (src/web/article/access.ts, src/web/visitor.ts); that the ingest allowance does not count post-ingest model calls and there is no general per-account limit on them (docs/project/billing.md, src/routes.ts, src/store/pg-rate-limit.ts); search costs and the quick-starts-meaning behaviour (docs/project/search.md); that saved searches are keyed per article and every finished one is published to visitors (src/store/pg-searches.ts, src/store/public-reader.ts); that the cost record cannot name the article for a non-owner (src/store/ai-calls-pg.ts); the limiter numbers quoted.
2. The claim that option B (a link to the existing `/add/<url>` for a signed-in visitor, using the `url` already in the public payload) edits no listed defence. Is that true? Is there a hazard I missed (for example `/add/` fetching on arrival, the public `url` being absent or a guessed address, a slot spent without a confirmation, rights)?
3. The claim that options C and D each edit a listed defence, and that C does not need the per-reader storage work. Is there a version of what Greg asked that touches NO defence and is small, which the plan missed? If so say exactly what.
4. Whether the complexity sizes (B an afternoon; C a few sessions; D large) are honest.
5. Whether the two questions can be answered by somebody who has not read the code: are the options explained plainly, is anything missing that Greg would need to decide, is any question one the session should have decided itself?
6. Anything security-relevant the plan should say and does not.

Write your findings as your final answer: numbered, each with a severity (P1 wrong or dangerous, P2 should change, P3 minor), the evidence (file and line), and what to change. End with a line beginning `VERDICT:` that says either "agree: no build, Awaiting Greg" or what you think should happen instead.
