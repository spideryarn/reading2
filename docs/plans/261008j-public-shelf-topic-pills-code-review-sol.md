Reviewed and fixed without running the paid eval.

Findings:

- P0: None.
- P1: The production sample omitted the listing’s `<h1>` title fallback and 200-card ceiling; rollback was not explicit on query failure; and the spend sink did not refuse a remote `DATABASE_URL`.
- P1: Docs presented filing at any shelf size as measured, although JSON only measures filing into `wide-20`.
- P2: Total eval spend was 2.82¢, not “about four cents.” The three filing samples used different newcomers, retry details are absent from JSON, and the newcomer index was off by one.
- Spend capture is otherwise correct: async context reaches pooled workers, every worker is awaited, there are no nested collectors, and the sink does not double-count report totals.
- Seeded sampling is deterministic; typing and ESM usage are valid.

What changed:

- Updated [public-shelf-cost.ts](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/evals/shelf-topic-clusters/public-shelf-cost.ts) to mirror the listing query, guarantee rollback, refuse non-local ledger targets, reject pending calls, and correct newcomer selection.
- Corrected numerical and measured-versus-inferred claims in the investigation, plan, and question.
- Documented that the saved `public-6` result predates the query fix and cannot prove whether the missing title fallback affected its inputs.
- Regenerated the feedback question registry.

Checks: TypeScript passed; Biome lint passed; feedback tests passed 53/53; doc-link tests passed 18/18. Full `npm test` could not start because local Postgres/Docker was unavailable. Direct ESLint was unavailable locally and its attempted download was blocked.

VERDICT: PASS WITH DOCUMENTED HISTORICAL CAVEAT — the cost conclusions match the JSON, but exact title parity for the already-run `public-6` sample cannot be reconstructed.