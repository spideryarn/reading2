Not ready. Two core guarantees are false: T1.8 would delete live exports, and Stage 2 assigns overlapping files to parallel lanes.

I reviewed claims against `ba05333b`; the working tree moved and acquired Stage 2 changes while I was reading.

## Findings, ranked by mutation evidence

### 1. T1.5 is confirmed exactly

I ran the original test: 11/11 passed. I then changed all three joins in a temporary copy to:

```ts
.innerJoin(articles, eq(articles.ownerId, articles.ownerId))
```

The same 11/11 tests still passed. The proposed predicate assertions are right:

```ts
expect(sql).toContain(
  'inner join "articles" on "comments"."article_id" = "articles"."id"',
);
```

Repeat for `chat_threads` and `search_runs`.

### 2. T1.8’s “dead re-exports” finding is wrong

Two supposedly dead exports are used dynamically:

- `MissingRawObject` in `tests/store-export-raw.test.ts:268`
- `CorruptRawObject` in `tests/store-export-raw.test.ts:289`

Mutation:

```ts
// Delete these:
export { CorruptRawObject, MissingRawObject };
```

Then run:

```sh
npx vitest run tests/store-export-raw.test.ts
```

Those tests lose the constructors they assert against.

`readRawDocument` and `ArticleNotFound` are unused re-exports, but removing two harmless exports is exactly the low-value “drop an export keyword” work the plan declines elsewhere.

Smallest correction:

```text
T1.8 deletes mark, structuralLeaves, requestOwner and listUploads.
Do not change export.ts’s compatibility re-exports in this sweep.
```

The other four dead-code claims survived the full-tree grep.

### 3. T0.1 is correct, but the proposed build fix misses a caller

The gate order and clean-checkout failure are exactly as claimed. Making `npm run build` the complete recipe is also the better design.

However, [`scripts/deploy.ts`](/home/greg/code/spideryarn2/.claude/worktrees/improve-260903/scripts/deploy.ts:619) currently runs `npm run build` and then explicitly runs the API build. After the proposed package change, the deploy preflight builds the API twice.

Use named component scripts and make every full-build caller invoke the aggregate once:

```json
{
  "build:client": "vite build",
  "build:api": "vite build --config vite.api.config.ts",
  "build": "npm run build:client && npm run build:api"
}
```

```ts
// scripts/deploy.ts
const built = run("npm", ["run", "--silent", "build"], {
  cwd: wt,
  env: BUILD_ENV,
});
gate("build", built.code === 0, () => explainBuildFailure(built.out));
```

Then:

```json
"buildCommand": "npm run build"
```

Build ordering itself is sound:

- `readClientShell` requires client first.
- Both build stamps resolve the same commit; differing timestamps are deliberately allowed.
- Sentry still receives client then API maps.
- `no-secrets-in-bundle` remains correctly scoped to the browser bundle.

The Stage 1 file list must additionally include `scripts/deploy.ts`, `tests/pdf-bundle-trace.test.ts`, `docs/project/dev-and-deployment-overview.md`, and `docs/project/setup-dev.md`. Several comments and error messages currently define `npm run build` as client-only.

### 4. T1.3’s list is complete, but its quantifiers are wrong

This command finds 17 unpinned calls, as claimed:

```sh
rg -n '\.transaction\(' src/store/pg-*.ts
```

But they are across **eight**, not nine, files. There are 22 transaction calls across eleven `pg-*.ts` files:

- 17 unpinned across eight files.
- Five pinned across three store files, with `pg-session.ts` containing three calls.
- Including `src/billing/sync.ts` and `article-rows.ts`, there are seven pinned calls across five files.

The heading’s “Seven transactions” is stale and must become 17.

Pinning is sound. Measuring the Supabase role first is not the right prerequisite: it would only prove today’s mutable default. The repo contains no role/database override, but that cannot establish remote state. The defence is to test against a deliberately wrong default, as `store-session-isolation.test.ts` already does.

Smallest shape:

```ts
export const READ_COMMITTED = {
  isolationLevel: "read committed",
} as const;

await db.transaction(async (tx) => {
  // ...
}, READ_COMMITTED);
```

The new test should fail when any transaction silently inherits its level. It should allow named exceptions such as the read-only `SNAPSHOT`, rather than merely accept any spelling containing `isolationLevel`.

Also add `docs/project/sql.md` to the stage: its “rest still inherits” paragraph becomes false after this work.

### 5. T1.2’s count and fix are sound; “reproduced” is overstated

There are exactly six throwing copies. Five call `requireSlug`; `pg-comments.ts` does not. The two nullable, explicit-owner variants are genuinely different.

But the audit describes re-grepping, not executing a malformed slug. That proves the missing guard from code; it does not reproduce the resulting status.

Mutation/input:

```ts
await expect(pgCommentsStore.load("not a slug")).rejects.toMatchObject({
  status: 400,
});
```

Watch it fail before extraction, then pass after:

```ts
export async function articleIdForOwned(
  slug: string,
  db: Db | Tx = getDb(),
): Promise<string> {
  requireSlug(slug);
  const [found] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(ownedSlug(slug))
    .limit(1);
  if (!found) throw notFound(slug);
  return found.id;
}
```

Either add that red test or downgrade the evidence state to `proved from the code`.

### 6. Stage 2’s lanes collide

The plan says:

```text
2a owns every file under src/store/
```

But 2b explicitly edits:

```text
src/store/ai-calls-fs.ts
```

The natural T1.4 regression test is also `tests/store-ai-calls*.test.ts`, swallowed by 2a’s broad `tests/store-*.test.ts` ownership.

Smallest correction:

```text
2a owns only the enumerated pg-*.ts files plus store/export.ts.
2b owns store/ai-calls-fs.ts and tests/store-ai-calls-lock.test.ts.
No lane owns tests/store-*.test.ts as a wildcard; enumerate every edited test.
```

`src/process-state.ts` and `src/cost-report.ts` otherwise do not collide. The `scripts/db-*` allocation is clean.

### 7. T1.4 did not count the idiom across the tree

At `ba05333b`, this finds ten server-side module-local promise locks, not one:

```sh
git grep -nE \
  'let (writing|queue): Promise<.*> = Promise\.resolve\(\)' \
  ba05333b -- src
```

Besides `ai-calls-fs.ts`, the closest identical sibling is `realtime-sessions-fs.ts`. Eight filesystem read-modify-write queues also remain. Separately, `routes.ts` has six module-local liveness/locking registries already named by the previous sweep.

Do not casually expand T1.4 to all of them, but the umbrella must record the complete count:

```text
T1.4 fixes ai-calls-fs.ts and realtime-sessions-fs.ts, the two append/update
mutexes with the same shape.

Eight filesystem RMW queues are deferred to the database-move plan.
Six routes.ts registries are deferred to the existing route-split prerequisite.
```

Otherwise the next reader will reasonably believe the module-reload class was swept and closed.

### 8. T2.1 is worthwhile, but keep it a pure fold

The original incident lived in the filesystem ledger. A Postgres-only grouped query would therefore not have fired on it. The ordinary `npm run cost` path already loads `AiCallRow[]`, so no new store query is needed.

Mutation fixture:

```ts
[
  row({ jobId: "j", stepName: "hierarchy", runId: "run-a" }),
  row({ jobId: "j", stepName: "hierarchy", runId: "run-b" }),
]
```

It must report two executions. Two calls sharing `run-a` must not report duplication, because some steps legitimately fan out inside one run.

Smallest shape:

```ts
export function duplicateJobSteps(rows: readonly AiCallRow[]) {
  // scopeKind === "job_step"; require jobId and stepName;
  // group by jobId + stepName;
  // report groups with more than one distinct runId.
}
```

Use it in the ordinary report before any early return.

### 9. T2.3 should not be built now

The no-drift argument wins. Seven stable copies are not evidence for an abstraction, and the adjacent transport code’s historical drift is not evidence that this timer idiom has drifted.

The proposed signature is also incomplete:

```ts
withStallTimeout(...) => { signal, touch }
```

It provides no way to clear the live timeout. Every current caller has a `finally { clearTimeout(...) }`; removing that without `dispose()` leaks the timer and can keep the process alive.

If this is ever extracted, the minimum honest interface is:

```ts
const clocks = streamClocks({ timeoutMs, stallMs, signal });
try {
  clocks.touch();
  // clocks.signal for the request
} finally {
  clocks.dispose();
}
```

It must also expose the deadline and stall signals separately because callers use them to classify failures. That is already enough interface complexity to fail YAGNI today. Defer it until the first behavior change or actual drift.

### 10. The unattended stages require approvals the plan does not acknowledge

The important-doc process applies not only to `CLAUDE.md`, but also to:

- `docs/reusable/rename-or-move.md`
- `docs/project/code-quality-overview.md`
- rule wording in `static-analysis.md`, `version-control.md`, and `sql.md`
- the entry-point `design-css-overview.md`

There is no code mutation for this finding; it is a process conflict. Smallest plan correction:

```text
Prepare exact before/after proposals for all important-doc edits.
Do not edit or commit them until Greg approves that set.
The corresponding code stage may not claim docs-complete meanwhile.
```

## Machinery verdicts

| Item | Deletion test | YAGNI | Verdict |
|---|---|---|---|
| T1.2 | Removing the shared lookup spreads a demonstrated invariant across six callers. | Present requirement and actual drift. | Do it. `lockArticle` is marginal but acceptable only as part of the same existing module. |
| T1.3 | Removing explicit policy returns correctness to mutable role configuration. | Seventeen current transactions exist. | Do it; test against a wrong default, do not merely measure today’s default. |
| T2.1 | This is a defence, not an abstraction; deleting it removes the only cheap signal. | It would have identified an actual $10+ incident. | Do it as a small pure fold. |
| T2.3 | A helper would centralise the mechanism, but callers still own lifecycle and classification. | No drift and no pending requirement. | Defer. |

## Ordering and blind spots

Stage 1 is correctly first: later evidence should not rest on a known-red gate. No Tier 1 item deserves to precede it.

The most important missed problem shape is module re-evaluation during a live request. The prior postmortem already names the `routes.ts` registries and filesystem queues, yet the new plan calls the request path sound without carrying that qualification forward. A `vi.resetModules()` test that begins work through one module copy and retries/stops through another is the adversarial shape to add to the next dedicated plan.

The remaining admitted blind spots are real: overlapping database transactions, provider streams ending without throwing, generated/deployed artefact behavior, and browser-only interaction or layout failures. Static reading cannot clear any of those.

**Verdict: not ready.** First re-cut Stage 2 from an exact lock/caller inventory with exact per-lane file ownership; the present cut both schedules deletion of live exports and assigns `src/store/ai-calls-fs.ts` to two lanes.