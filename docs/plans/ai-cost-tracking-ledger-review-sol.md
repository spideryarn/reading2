VERDICT: CHANGES REQUIRED

The core design is good, and I found no ordinary duplicate-write path through either gateway. But four correctness issues can still make the ledger confidently short.

## Findings

1. **P1 — A call finishing during sink draining escapes the await**

`collectSpend` takes its report, waits for the current `box.writes`, and only then sets `closed` ([ai-spend.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:536)). During that wait, `recordSpend` still accepts another finish and appends a new promise to `box.writes` ([ai-spend.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:582), [ai-spend.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:666)). `Promise.allSettled` has already captured its iterable, so it does not await the new promise.

I drove that path directly: two calls were accepted, two sinks started, and `collectSpend` returned while the second sink was still unsettled. On Vercel that second row can disappear. The request log may also already have reported the first call only.

Set `closed` as soon as `fn` settles, snapshot the report and writes, then await that fixed set. Add a test where a call finishes while an earlier sink is blocked.

2. **P1 — Two paid article routes have no article attribution**

`similar` and `projection` call paid embeddings ([similar.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/similar.ts:284), [article-vectors.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-vectors.ts:290)), but their route branches are not inside `withSpendAttribution` ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3384), [routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3424)).

Those rows get the right owner but `article_slug = null`. The CLI then excludes them entirely from “By article” because it filters null slugs before grouping ([ai-cost.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/ai-cost.ts:222)). Phase 6 would therefore understate an article’s real cost.

Wrap both routes and add one route-level test that reads the resulting row, rather than only testing the overlay helper.

3. **P1 — The job total cannot report failed or unreadable writes**

Sink rejection is logged and converted into success ([ai-spend.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:666)). Later, `jobSpend` only sees rows that survived. Zero rows produces no AI status; some rows produce a confident partial total ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:497)).

The filesystem version has a second form: `forJob` discards `unreadable` entirely ([ai-calls-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/ai-calls-fs.ts:97)). A damaged line that belonged to this job produces a short total with no `aiCostStatus`.

That does not meet the specification’s “reconciliation/write status.” A warning elsewhere is useful, but it cannot make the terminal job total trustworthy. The job query needs ledger health, and write failures need a durable incompleteness signal that survives multiple advances.

4. **P1 — `--reconcile` compares unlike periods and treats failure as success**

The default report supplies current-month rows, while reconciliation reads `data.usage` and labels it “this key, all time” ([ai-cost.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/ai-cost.ts:164)). That gap is not stable: it jumps at every month boundary even if the ledger is perfect.

Additionally:

- Missing credentials and non-2xx responses return successfully ([ai-cost.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/ai-cost.ts:148)).
- An empty row range returns before reconciliation runs ([ai-cost.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/ai-cost.ts:194)).
- There is no per-fingerprint baseline.

So the omitted baseline is not enough “for now.” Use `usage_monthly` against current-month rows plus a baseline for the same key and month, creating a new baseline on rotation. A requested reconciliation that cannot run must exit non-zero, as the specification required.

5. **P2 — The JSONL concurrency and corruption contract is not established**

The pipe-buffer argument in [ai-calls-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/ai-calls-fs.ts:18) does not apply to a regular file. Node explicitly warns that promise-based filesystem operations are not synchronized and concurrent modifications may corrupt data. POSIX gives useful `O_APPEND` guarantees per `write()` call, but this code has not established that each `appendFile` operation is exactly one such call on every supported filesystem. [Node filesystem documentation](https://nodejs.org/api/fs.html), [POSIX `write`](https://pubs.opengroup.org/onlinepubs/9699919799/functions/write.html).

Serialize writes at least within the process. If two processes are supported, use a lock.

The reader also validates only JSON syntax ([ai-calls-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/ai-calls-fs.ts:79)). A valid `{}` is accepted as `AiCallRow`, passes the date filter, and poisons arithmetic with `NaN`. If every line is invalid JSON, `npm run cost` returns before printing the nonzero unreadable count. Skipping and counting is reasonable only with runtime shape validation and only if every consumer carries the count through.

6. **P2 — Failed BYOK spend is printed as zero**

The failed-call line takes only `credits` from `totalRows` ([ai-cost.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/ai-cost.ts:211)). A failed BYOK call with zero OpenRouter credits and $0.01 upstream exposure prints “having spent at least $0.0000.”

Use `credits + upstream`, while continuing to show the pockets separately in the main total. There is no failed-BYOK test.

7. **P2 — Numeric month validation is vacuously green**

The regex accepts `2026-13`; JavaScript normalizes it into:

```text
since: 2027-01-01
until: 2026-02-01
```

That is an inverted range, not a refusal. The tests reject only textual misspellings ([ai-cost-cli.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/ai-cost-cli.test.ts:35)). Explicitly require months 01–12.

## Answers to the specific attacks

- **Exactly once:** The normal gateway paths are sound: `Meter.done` protects the chat wire, memoised `finalMessage` protects Messages, and an unfinished call produces no row. The scope-closing race above is the missing-row path. Postgres also deduplicates a retried insert; JSONL does not, although no current sink retry calls it twice.
- **Attribution concurrency:** The overlay design is sound. Attribution is copied per async context, so sibling and nested overlays do not overwrite one another. The shared box is appropriate for calls and writes. The close/drain race is in that shared box, not in attribution.
- **Owner at record time:** I found no current wrong-owner path. Authentication fills the request box before paid routes run, and pipeline scopes supply `job.ownerId`. However, `articleIdFor` uses ambient `currentOwnerId()` through `ownedSlug`, rather than the already captured `row.ownerId` ([ai-calls-pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/ai-calls-pg.ts:42)). That is a future mismatch for explicit CLI/eval owners.
- **`article_id` plus slug:** Keep both. But resolve the ID once per `(owner, slug)` scope, using the captured owner. Per-row resolution creates an unnecessary query fan-out and can make rows from one run disagree across an article deletion/recreation.
- **Migration 0021:** The empty-table guard is correct. The repository’s migrator wraps all pending migrations in one transaction ([deploy-checks.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy-checks.ts:137)), so a later failure rolls the drops back. I found no portability problem for an expected, empty pre-0021 schema. A database containing rows deliberately stops.
- **`bigint` number mode:** No current bypass found. Both Postgres read paths select through Drizzle and therefore apply the number decoder. The test proves the `int8` string problem is closed. Precision would fail only above `Number.MAX_SAFE_INTEGER`—roughly $9 million in one call—which is not a credible present row.
- **CLI/eval scopes:** Removing the four-of-seven version was right. Calling phases 1–5 complete is not. The leaf helper taking `(slug, ownerId)` remains the smallest clean fix; it also removes the ambient-owner issue above. A separate executable wrapper importing both stage and ledger would avoid the cycle, but exporting seven private CLI mains is more work.
- **Fingerprint baseline:** Not optional if `--reconcile` is meant to detect drift. The fingerprint is necessary identification; it is not a baseline.

## Still unfinished from the prior review

These were in the “do now” list and remain open:

- `OPENROUTER_BASE` and `MESSAGES_BASE_URL` are still exported.
- There is still no real `openRouterReader` failure-then-success test asserting rows `error`, then `ok`.
- `ideas` is still absent from the refusal harness.
- The gateway docs still say callers can pass their own provider and can reach `call.stream.finalMessage()` ([ai-gateway.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/ai-gateway.md:177), [messages-stream.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages-stream.ts:404)). Both statements now describe APIs that no longer exist.
- `owner.ts` still lists `ai_calls` among tables without an owner column ([owner.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/owner.ts:4)).
- The schema uses `input_tokens`, despite the specification explicitly requiring `reported_input_tokens` because the two wires give it different meanings ([ai-cost-tracking-rows-sol.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/ai-cost-tracking-rows-sol.md:38), [schema.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1249)). That is exactly the six-month misleading-column-name case.