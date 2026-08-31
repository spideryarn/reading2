## Bottom line

Build phases 1–5 now and leave phases 6–7. The database and CLI must make the article UI possible, but another UI is not needed to prove the ledger.

### 1. Writing the row

**Call:** do one insert per completed call. Give `collectSpend` an injected sink; `recordSpend` starts the sink immediately, attaches a rejection handler immediately, and retains the resulting promise. At scope close, `collectSpend` awaits every retained promise before returning from [handleApi](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2810) or [runStep](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:267). The sink catches and logs persistence failures so telemetry never changes the model call’s outcome. Keep [ai-spend.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:219) free of store imports.

Do not add a process-level fallback. Wrap supported CLI and eval entry points in explicit scopes with an owner and `run_id`; an unscoped call should emit an immediate warning and produce no row. A process-exit flush cannot reliably recover attribution or run on Vercel.

**Rejected failure:** batching forty rows at scope close turns one mid-step process death into forty missing completed calls. Starting forty small inserts as those calls finish limits the loss to calls genuinely still in flight. A late call remains a bug and may still be lost, but it must be loudly logged rather than supported as a second lifecycle.

### 2. `files` mode

**Call:** reject option 2. Add an explicit cost-store adapter:

- `postgres` → `ai_calls`
- `files` → append-only JSONL
- never retry one against the other

The Vercel objection to JSONL is irrelevant: production already refuses `files` mode in [store/index.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/index.ts:159). JSONL is for the default local configuration, CLI stages, and evals. `npm run cost` reads the selected adapter.

In `postgres` mode, missing database configuration should be a boot failure, not “warn and continue.” The CLI should print the selected cost store and exit non-zero if it cannot read it or reconciliation fails. Add real write/read integration tests for both adapters.

**Rejected failure:** “always Postgres, warn when absent” deliberately makes the default configuration an untracked one. The warning will become normal background noise, and a stopped local database can also impose connection delays and leave a pool holding the CLI open.

### 3. Columns and reconciliation

**Call:** reshape the existing table to match observed data, using a new altering migration. Do not drop and recreate it. Before dropping obsolete columns, make the migration refuse if unexpected rows exist—or preserve them explicitly. Source inspection does not prove the live table is empty.

The row should contain:

- Identity: `id` minted before network I/O, `run_id`, `generation_id`
- Scope: `scope_kind` (`request`, `job_step`, `cli`, `eval`), `owner_id`, nullable `article_id`, `article_slug`, `job_id`, `step_name`
- Transport: `wire`, `purpose`, `requested_model`, `answered_model`, `upstream`, `credential_fingerprint`
- Timing/result: `started_at`, `finished_at`, `duration_ms`, `outcome`
- Money: `credits_used_usd_nanos bigint`, `upstream_inference_usd_nanos bigint`, `is_byok`
- Usage: `reported_input_tokens`, `output_tokens`, cache read/write total, cache-write 5m/1h, normalized `reasoning_tokens`, `web_searches`, `service_tier`, `inference_geo`

`wire` and `reported_input_tokens` matter because the two wires give the input count different meanings. A plain `input_tokens` column invites invalid sums.

Capture the TTL split, reasoning, searches, tier and geography now: they are already present on the wire and affect either pricing or explanation of drift. Normalize Anthropic `thinking_tokens` and OpenAI-shaped `reasoning_tokens` into one `reasoning_tokens` column; both are included within output tokens. OpenRouter’s Messages response currently exposes the cache split, thinking, searches, tier and geography. [OpenRouter Messages reference](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages)

Do **not** add generic `attempt`, `cost_source`, `cost_computed_nanos`, `price_version`, `thinking_tokens`, or `raw_response`. `run_id` groups an invocation; each retry already gets its own call ID. All present costs come from OpenRouter, so `cost_source` adds no information. Compute the expected price in `npm run cost` from the stored raw facts and effective-dated price table. Compare that to both the inline credit charge and `GET /generation.total_cost`; that endpoint also supplies provider, tier and native token metadata. [Generation metadata API](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation)

Yes, nano-dollars in `bigint` are correct. Rename and convert the existing micro-dollar column with `USING cost_micros::bigint * 1000`; do not destroy the table.

**Rejected failure:** storing a derived computed cost makes yesterday’s stale arithmetic look like ledger truth and requires data rewrites when the price table is corrected. Omitting the wire-level pricing inputs makes the later drift check unable to explain its own disagreement.

### 4. Attribution

**Call:** extend the existing spend `AsyncLocalStorage` with immutable nested attribution. Add something like `withSpendAttribution({ articleSlug, … }, fn)` around each article-bound route. It shares the collector and sink but overlays the route’s article context. This is neither a second ALS nor a mutable global field.

`runStep` supplies `{ ownerId: job.ownerId, jobId, stepName, articleSlug }`. Article routes supply the slug they already parsed; the Postgres sink resolves `article_id` once per scope. Always retain `article_slug` as the historical snapshot because `article_id ON DELETE SET NULL` is intentional. Keep `job_id` as a durable textual identifier rather than an FK that job retention can erase. `owner_id` remains non-null with `ON DELETE RESTRICT`.

Request calls such as transcription legitimately have no article. Chat, explain and meaning-search do not: they must carry their route’s article.

**Rejected failure:** accepting article attribution only for ingest makes “what did this article cost?” exclude the questions asked about it—the exact second half phase 6 promises. A mutable route field risks attribution leaking between concurrent async branches.

### 5. Whole-job total

**Call:** query the cost store at `endJob`: sum rows by `job_id`. Because decision 2 provides the same query over JSONL and Postgres, this works in both modes and across every browser-driven advance.

The line must report:

- calls recorded
- credits used
- BYOK/upstream exposure separately
- calls with unknown cost
- reconciliation/write status

If the cost store cannot be queried, omit the number and say `aiCostStatus: "unavailable"`; never print zero.

**Rejected failure:** a running total on the job is a second ledger that must be updated identically in two job stores and can diverge after an ambiguous write or crash. The immutable call rows are the source of truth.

### 6. Parked questions

**Q3 — raw response:** do not store it. No pruning window is needed. Cost tracking needs metadata, not article prose, chat answers or dictated speech. Your premise needs one correction: `GET /generation` returns metadata, not content. OpenRouter now has a separate content endpoint, but it requires a management key and content must have been retained; OpenRouter says input/output logging is off by default. [Generation content API](https://openrouter.ai/docs/api/api-reference/generations/get-stored-prompt-completion-and-error-content-for-a-generation), [data-collection policy](https://openrouter.ai/docs/guides/privacy/data-collection). The rejected failure is turning a small financial ledger into the project’s largest and most sensitive data store, dependent on a pruner that can quietly stop.

**Q4 — evals:** count them, but mark `scope_kind = 'eval'`, use the dev owner, and show them separately from product spend. Prefer a dedicated eval API key. Evals currently contain direct calls outside the two application seams, so “evals count” is not true until those entry points are wrapped or migrated. The rejected failure is a permanent unexplained gap in the `/key` reconciliation.

**Q5 — cost meaning:** the primary number is **OpenRouter credits consumed**, named `credits_used_usd_nanos`. Keep upstream inference cost separately. Do not multiply every row by 1.055: OpenRouter’s fee is charged when credits are purchased, includes a minimum, and differs for crypto/BYOK, so cash belongs in a future credit-purchase ledger rather than fabricated per-call precision. [OpenRouter billing FAQ](https://openrouter.ai/docs/faq). The rejected failure is calling a derived allocation “cash” when it cannot match a bank statement.

**Q6 — month:** UTC, with half-open ranges such as `[2026-08-01T00:00Z, 2026-09-01T00:00Z)`. OpenRouter’s recurring key limits reset at midnight UTC, so this is also the only clean reconciliation boundary. [OpenRouter key reset semantics](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys). The rejected failure is totals that change with the machine timezone and DST.

## The remaining review findings

Do now, before the database contract hardens:

- **Close the Messages seam.** Stop exporting `meterStream`, the raw SDK stream and meter. Return only the operations callers need—text subscription, abort state/action and the metered `finalMessage`. Make `model` and `provider` forbidden caller fields and inject them after the body spread. Otherwise the database will create false confidence around a deliberately exposed bypass.
- **Fix abort classification.** Use error causality—stream abort state, signal reason identity, or `AbortError`—not “the signal happens to be aborted now.” [openrouter-stream.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/openrouter-stream.ts:64) already has the correct pattern.
- **Close known scan escape hatches.** Make endpoint constants private and enforce that only the two gateways import the Anthropic SDK. Do not try to detect intentionally obfuscated string assembly; the scan is a tripwire, not a security boundary.
- **Add the `openRouterReader` retry lifecycle test.** Drive a transport failure followed by success through the real reader and assert two rows, with `error` then `ok`. Its existing whole-stage tests replace the reader and therefore do not prove the claim in [pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:369).
- Add `ideas` to the refusal behavioural harness; [stop-details.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/stop-details.test.ts:100) still drives six of seven stages.

Defer the leaf-module refactor. The injected sink avoids adding the import edge that would make it necessary. Fix explain’s lost suffix as a separate small bug; it matters, but it has no bearing on ledger correctness.

## The six-month failure you have not yet covered

The `/key` check cannot be meaningful unless each row records a safe credential fingerprint and the checked key is dedicated to this workload. The repository already documents two different OpenRouter keys in use. Key rotation, evals or another tool using the same key otherwise produces a permanent discrepancy everyone learns to ignore.

Establish a reconciliation baseline per key fingerprint when tracking begins, compare the current UTC-month rows with `usage_monthly`, and create a new baseline on rotation. `/key` exposes per-key daily, weekly and monthly usage. [Current-key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)

That baseline, the call ID minted before I/O, and immediate visible handling of insert failures are the three details that separate a real ledger from a plausible table.