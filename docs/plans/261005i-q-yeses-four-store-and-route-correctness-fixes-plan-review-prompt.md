# Review: a plan for four small store and route correctness fixes, before it is built

You are reviewing a plan before it is built. Read-only: do not edit any file.

Repo: this worktree, branch `worktree-q-yeses-store-route-correctness` (TypeScript, ESM). Base
`origin/dev` at `8646b09ad`.

## The candidate

Live pre-commit: two untracked files, the plan
`docs/plans/261005i-q-yeses-four-store-and-route-correctness-fixes.md` and this prompt. Nothing
else has changed.

Read the plan, then the code each item changes:

- **A:** `src/pipeline.ts` § `blocksMatchTheirHtml` and the `blocks` step's `isDone`;
  `src/store/pg.ts` § `articleMetadata` § `isCurrent`, `REVISION_READ_POLICY`, `currentRevision`,
  `blocksFor`; `tests/store-revision-columns.test.ts` (the projection tests near line 360 and the
  guard near line 670); `tests/freshness-deciders-agree.test.ts` (`DISAGREEMENTS`, and the `blocks`
  describe near line 698).
- **B:** `src/store/pg-visibility.ts`; `src/store/pg-billing.ts` § `lockBillingAccount` and § The
  lock order; every other writer of `articles.visibility`, `public_at`, `processing`;
  `tests/public-visibility-pg.test.ts`; `tests/public-reads.test.ts` (the SQL-reading assertion).
- **C:** `src/routes.ts` § `searching`, `liveRuns`, `search`, `refereeing`, `liveCriteria`,
  `runRefereeCriterion`, `pullingClaims`, `runRefereeClaims`; `tests/referee-stream-lifetime.test.ts`;
  `tests/routes.test.ts` (search for `liveRuns`).
- **D:** `src/store/pg-searches.ts` § `begin`, `src/store/pg-referee-criteria.ts` § `begin`,
  `src/store/pg-referee-claims.ts` § `begin` (the precedent), `src/store/contracts.ts`,
  `src/searches.ts` § `withRun`, and the two handlers above.

The evidence the items came from: `docs/plans/261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md`
§ Found, not fixed (items 1 and 2), and
`docs/plans/261004d-fifth-sweep-cluster-6b-store-contracts-require-the-attempt-and-markers-outlive-finish.md`
§ Not here and § Code review.

## What it is meant to do

Change nothing a reader sees on an ordinary day. A: the Metadata page and the queue give one answer
about `blocks`. B: the visibility race test and the comments around it say what is true about which
lock does what. C: a live marker cannot be released by a request other than the last one holding
it. D: a Search or Criteria run records the hash of the blocks the model was sent.

## What I want from you

Independent pass first. For each item: is the change right; is the chosen design the simplest that
is correct, and is the option passed over really worse; what would it break that the plan does not
name (other callers, fakes of these contracts in tests, scripts, evals, the public reader); would
each red-first test really be red today and green after, for the stated reason and not another.

You may run one test file that needs nothing outside the tree
(`npx vitest run tests/<one>.test.ts`) or a script (`node --import tsx <script>`). You have no
network, not even loopback, so anything touching Postgres will skip or fail; do not report that as
a finding. Say which claims you reproduced and which you reasoned to.

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, service
broadly unusable. **P1** user-visible wrong behaviour, or an authoritative contract violated.
**P2** design or maintainability risk with no wrong behaviour today. **P3** prose or comment
defect. Refuse the plan only on an established P0 or P1 (direct evidence, no unresolved material
inference). Give every finding an ID: `PF1`, `PF2`, …

End with one line: **build**, **build with corrections**, or **do not build**.

## My own suspicions (already mine; spend most of the run elsewhere)

- A: whether reading `extracted_html` and `stamped_html` and re-splitting on every Metadata load is
  acceptable, and whether the stored blocks as `blocksFor` returns them are the same shape
  `blocksMatchTheirHtml` compares (`file.blocks` from the artefact read), on a draft as well as a
  current revision.
- B: whether any writer of the `articles` row exists that does not hold the owner's billing lock.
- C: whether a count can leak (a throw between `begin` and the `try`), pinning a key for the life
  of the process.
- D: what moving `loadArticle` ahead of `begin` changes for the reader when it fails, and whether
  `withRun`'s retry and revise paths want the passed hash or the old row's.
