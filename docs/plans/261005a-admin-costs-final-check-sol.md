Findings:

- **[P1-CACHE-BOUNDARY — established]** The new calls-per-job gate uses an accounting boundary, not the actual cache-reuse boundary. Calls are first grouped by task and wire, then by `jobId` or request `runId` ([cost-analysis.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-analysis.ts:906)). This avoids unrelated calls within one request inflating the count, but:
  - request-path caches are reused across separate requests for the same task/article;
  - pipeline caches can be shared by different tasks in the same job, such as Glossary and Quotes.
  
  Both are explicit in [prompt-caching.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/prompt-caching.md:46). Therefore “a task that makes one call per job has nothing to reuse” is false, and the gate can suppress genuine low-cache-reuse alarms. The `$3.07` amount is correctly calculated under the new predicate, but the predicate does not justify dismissing the other pairs as false alarms.

- **[P2-MEDIAN-LOWER — established]** An even-sized population uses nearest-rank P50—the lower middle—not the conventional average of the two middle values ([cost-report.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-report.ts:168)). Thus job sizes `[1, 3]` produce “median 1” and are not flagged, rather than median 2. The added test uses `[1, 2, 2, 3]`, where both definitions happen to return 2. This is internally consistent with the repository’s percentile convention, but the report’s unqualified “median” does not reveal the consequential distinction.

- **[P3-Q6-SCOPE — established]** Q-6’s “Attributing it is one word in the route table” is inaccurate ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md:291)). `/api/command-pick` is an exact route, so it cannot use `first-capture`; its request contains no slug and rejects unknown fields ([command-pick.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/command-pick.ts:43)). Attribution requires carrying the slug from the command bar, changing the request parser, and wrapping the handler—or changing the route shape.

The other checks pass:

- The repeat-purchase columns are correct. The key is an article UUID or a per-report HMAC-backed recorded-article key; another owner’s slug is removed in SQL. No slug or title text can enter the column. Recorded keys are cryptographically derived from a slug but are opaque and unlinkable across reports. Dates are UTC days from the earliest/latest ledger call in the article-step group.
- Listing every cache pair changes no total: the lead amount still sums flagged pairs only, while the evidence table lists all pairs.
- The model-by-task wording matches the calculation: models are sorted by recorded amount within each task and the first maximum is marked. In a tie, one tied maximum is marked.
- The p95 behavior is correct: fewer than 20 priced calls render a dash in HTML and terminal output; JSON retains the p95 and priced-call count.
- Q-5’s implementation claims match the tree: production reports deliberately skip Auth and use opaque user IDs. The historical Auth call/deletion cannot be independently established from the repository.
- The audit paragraph accurately describes the differences: recorded-slug rows, renamed-step normalization, and outcome handling.
- Requested tests passed: **3 files, 129 tests**.
- No files were changed; worktree status remained as it began.

VERDICT: revise