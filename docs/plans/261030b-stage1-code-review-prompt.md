You are reviewing CODE in this repository, write-capable: fix what you find inside this stage, and report anything wider for me to decide. Read CLAUDE.md first for house rules. Do not commit, push, deploy, or touch any database other than the test databases the suite mints itself.

The plan: docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md (stage 1, the server step), and its earlier plan review docs/plans/261030b-plan-review-sol.md (F1–F7, all said to be taken).
The diff under review: `git diff ac8b11902 48b535ec8` (commit 48b535ec8, "Sources digest stage 1"). Centre: src/sources-digest.ts, tests/sources-digest.test.ts, drizzle/20261030144943_sources_digest.sql, the registrations across src/ and src/store/, and the exports added to src/situate.ts.

Review independently for:
1. Security (docs/project/security-map.md): untrusted article/page/report text reaching the planner, readers and writer — fenced at every boundary? Can any page text steer a search, a fetch, or spending? Is the profile kept from the planner and readers? Is the digest owner-only everywhere it can be read (routes, sharing-steps, export, view-as, feedback payload)?
2. Correctness of the caps and budget: leads, queries, readers, sources, chars, the step budget vs STEP_BUDGET_MS vs the rate lease; does every call really have its own clock and get aborted? Does the rate allowance get taken before the first paid call?
3. The quote check and the writer's validation: can the writer cite a source with no checked quote, or an id not in the article? Do toParagraphs rules apply as Summary's do?
4. Freshness: sourceHash/profileHash/isStale/isOutdated consistent with situate and the freshness-deciders test; nothing-found stored and treated as done.
5. Did the situate.ts refactor change situate's behaviour (searchOne job param, quotedIn)?
6. Logging: nothing from the article, queries, URLs, titles, quotes or model text is logged (docs/project/logging.md).
7. Anything else false, fragile, or simpler.

Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability; P3 prose. Give each finding an ID, severity, file:line evidence, and either "fixed" (with what you changed) or "not fixed, for you" (with the concrete change). Run `npm run typecheck` and the tests you touch (`npx vitest run tests/sources-digest.test.ts tests/situate.test.ts …`) after any fix and report the results.

Write your findings first to docs/plans/261030b-stage1-code-review-sol.md, then end with a one-line verdict: approve / approve with changes / revise.
