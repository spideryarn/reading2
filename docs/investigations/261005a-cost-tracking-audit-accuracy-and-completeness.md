# Cost-tracking audit: is the ledger accurate, and is it complete?

Up: [investigations.md](../project/investigations.md)

Plan: [261005a](../plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md),
§ The audit. The machinery audited is described in
[cost-tracking.md](../project/cost-tracking.md) and [ai-gateway.md](../project/ai-gateway.md).

## What was asked

> check that our cost-tracking machinery is accurate and complete, and that we have good
> docs/reusable machinery so that new modes and functionality will always get cost-tracked.
>
> — Greg, 2026-10-04

The **ledger** is the table `spideryarn.ai_calls`, one row per model call. Every number below says
which database it came from. "Production" means the production database, read on 2026-10-05 inside
a read-only transaction that was rolled back. Nothing was written anywhere.

## The verdict

- **What the ledger records, it records correctly.** 49 of 49 comparable production rows matched
  OpenRouter's own figure to the nano-dollar, tokens included, and all 59 rows we price ourselves
  recompute exactly.
- **It is short by a known $2.11 (2.3% of $90.80), in two places.** Dictation's transcription calls
  are never priced (264 rows, really $0.79), and calls that were stopped or failed are recorded
  with no money although OpenRouter charged for them (17 rows, really $1.32).
- **$5.91 of it (51 web-search rows) could not be checked**: OpenRouter's record for the id we
  stored is empty. The ledger's figure may well be right; nothing here proves it.
- **Two owners is true to life.** Every independent trace of paid work in production (jobs, step
  runs, chat messages, searches, voice sessions) belongs to the same two accounts.
- **Completeness cannot be proven from here.** The one check that could (the production key's
  month against the production ledger) cannot be run from this box, and calls that wrote no row
  leave only a log line that is kept for about a day. New work is guarded by a tripwire that
  catches the obvious route round the gateway and passed eight of the ten others tried.

## What cannot be proven, said once

- **The monthly key reconciliation is not a completeness proof.** `npm run cost -- --reconcile`
  compares one key's month with OpenRouter's total. It needs the key and the database of the same
  deployment, and a key nothing else spends on. Neither held for any run made here.
- **A call that wrote no row leaves nothing in the ledger to count.** A failed insert, a call made
  outside every collector, a call that finished after its collector closed, and a call with no
  owner each produce one warning in the server log and a counter in the memory of a serverless
  process. So no query over the ledger can show historical completeness.
- **Vendor prices were not checked.** The price tables in `src/pricing.ts` were compared with the
  rows, not with OpenAI's price list, which could not be read offline.

## 1. Accuracy against the provider

**Method.** A stratified sample of production rows that carry a `generation_id`: for each
combination of wire, model, BYOK flag and ok/not-ok, the two most expensive rows and two picked by
hash, plus the oldest row on each wire. Each was looked up with
`GET https://openrouter.ai/api/v1/generation?id=…` (free, read-only).
Script: `audit-accuracy-sample.ts`; per-row results: `audit-accuracy-result.json`.

| | rows |
|---|---:|
| sampled | 70 |
| lookups that failed (could not check) | 0 |
| ledger has money, OpenRouter agrees to 1 nano-dollar | 49 |
| ledger has money, OpenRouter's record says zero cost and zero tokens | 7 |
| ledger has **no** money, OpenRouter has a record | 14 (13 of them with a charge) |

- **The 49.** $6.41 in total, on the messages, chat, images and decisions wires, Sonnet, Opus,
  GPT-5.6 Luna, GPT-6 Luna, Gemini and Jev, from 2026-08-30 to 2026-10-04, the largest $1.18. On
  the 14 BYOK rows among them (calls billed to our own OpenAI key through OpenRouter)
  `byok_upstream_nanos` equalled OpenRouter's `upstream_inference_cost` exactly. Output tokens
  matched on every row. Input tokens matched once the wire is allowed for: on the Messages wire
  `reported_input_tokens` **excludes** cached tokens (input + cache read + cache write = the
  provider's prompt count); on the chat wire it **includes** them.
- **The 7** are all chat-wire calls that run a web search (Debate's search calls,
  citation-investigate, upload-source-guess). See the census below.
- **The 14** are stopped or failed calls, and dictation's transcription. See the census below.
- The embeddings wire (155 rows, $0.08) stores no generation id, so no row of it can be checked
  this way.

**A census of the two odd shapes** (every such production row, not a sample).
Script: `audit-unpriced-census.ts`; results: `audit-unpriced-census-result.json`.

| Shape | rows | ledger says | OpenRouter says |
|---|---:|---:|---:|
| dictation transcription (`openai/gpt-transcribe`), outcome ok, no money | 264 | $0 | $0.7895, billed upstream (BYOK) |
| chat stopped by the reader | 7 | $0 | $0.9264 (one of the seven was free) |
| pipeline calls stopped or failed (structure, arc, quotes) | 3 | $0 | $0.3833 |
| shelf-topics stopped | 6 | $0 | $0.0095, billed upstream |
| chat failed | 1 | $0 | no record (404) |
| **all unpriced rows with a generation id** | **281** | **$0** | **$1.3098 credits + $0.7990 upstream = $2.1088** |
| web-search chat calls, ledger priced, `is_byok` null | 51 | $5.9054 | $0, zero tokens, on all 51 |

A further 20 unpriced rows have no generation id (the request failed before a response), so
nothing can be asked about them.

**The key reconciliation.** `npm run cost -- --reconcile`, run on the box, reads the **local**
database and the **local** key:

```
Against OpenRouter, key 66c3cdfc178e, 2026-10 (UTC):
  our credits       $206.2060  (7968 call(s))
  their credits   $283.715006
  our BYOK            $6.6101   their BYOK  $7.960698
  gap              $77.508968  (theirs minus ours)
```

Production's rows carry a different key fingerprint (`49a901286417`, all 2,186 OpenRouter rows), so
this says nothing about production. Locally, 27% of the key's October spend is in no local row. The
candidates are the Overseer's and the fleet dashboard's own calls, the nine declared paths that
write no row, unpriced rows, and the same key being used from another machine with its own
database; this audit did not separate them. The same response reported the local key at $283.42 of
a $300 monthly limit on the 5th of the month.

**What this does not prove.** That calls with no row do not exist. That the 51 web-search rows are
right. That the sample's agreement extends to embeddings. And the generation endpoint and the
in-band `usage.cost` both come from OpenRouter, so this is a check of our recording, not of
OpenRouter's billing.

**Computed prices** (the coordinator's addition). Every production row with
`cost_source = 'computed'` (59 rows, $1.0284, all live conversation) was recomputed from its own
token and seconds columns with the functions in `src/pricing.ts`. Script:
`audit-computed-recompute.ts`.

| event kind, model | rows | agree | stored | price version |
|---|---:|---:|---:|---|
| response, gpt-realtime-2.1 | 16 | 16 | $0.744694 | `gpt-realtime-2.1@1970-01-01` |
| transcription, gpt-live-transcribe | 13 | 13 | $0.023233 | `gpt-live-transcribe@1970-01-01` |
| voice, gpt-live-1 | 22 | 22 | $0.256667 | `gpt-live-1@1970-01-01` |
| backend, gpt-6-luna | 8 | 8 | $0.003758 | `gpt-6-luna@1970-01-01` |

This shows the arithmetic is stable, not that the prices are current: the tables say they were
last checked on 2026-09-02, and the counts are the reader's browser's.

**Raw rows against grouped totals** (the coordinator's addition). Script: `audit-prod-read.ts`
with `audit-06-sol.sql`. Production, raw: 2,245 calls, credits 84,793,839,211 nanos, BYOK
4,982,297,420, computed 1,028,351,620. The same over a `GROUP BY` of owner, article id, slug,
scope, job, step, wire, requested model, answered model, upstream, outcome and UTC day: 682 groups,
and the identical four sums.

**Log lines against rows.** Three production log lines from 2026-10-04 that carry a run id and a
cost (one chat request, two glossary steps: $0.1233, $0.0920, $0.1250) each matched one ledger row
with the same run id and the same nano-dollar figure.

## 2. The two owners

**Method.** `audit-02-owners.sql`, `audit-03-completeness.sql` and `audit-06-sol.sql` through
`audit-prod-read.ts`. Accounts are compared by **expected paid events since the ledger began**, not
by owning articles.

| Independent trace (production) | owner `001bb7a0` | owner `aa8b0dd2` | anyone else |
|---|---:|---:|---:|
| jobs with a finished model step | 46 | 3 | 0 |
| model-step runs on revisions since 2026-08-30 | 411 | 3 | 0 |
| assistant chat messages since 2026-09-03 | 66 | 0 | 0 |
| search runs since 2026-09-03 | 32 | 0 | 0 |
| live sessions that connected | 13 | 0 | 0 |
| articles | 59 | 1 | 0 |
| **ledger rows** | **2,242** | **3** | **0** |

- The second account imported one web article on 2026-10-04. Its three jobs ran three model steps
  (structure, labels, arc) and the ledger holds exactly three rows for it, with those job ids.
- A third account (`ffd43751`) has a profile and an arrival record and nothing else: no article,
  no job, no thread. It is the only account in any owner-keyed table that is not in the ledger.
- No ledger row's owner differs from its article's owner (1,966 rows with an article id, 0 differ).
- **The mechanism was read too.** A pipeline step is billed to `job.ownerId`; a request is billed
  to whoever the auth gate signed in (`ownerFor` in `src/ai-spend.ts`). A call with no signed-in
  owner writes **no row** and one warning.

**What this does not prove.** The Auth service's own list of accounts could not be read
(`permission denied for schema auth`), so "three accounts" is the count of accounts with a profile
row. And a signed-out visitor whose request reached a model would leave no row and no trace in any
table above. Whether any signed-out route can reach a model was not checked.

## 3. Completeness of recording

### (a) Every way to reach a provider

**Method.** `grep` over `src/`, `api/`, `scripts/`, `tools/` and `evals/` for provider hostnames
(a wider list than the gateway's own four), SDK imports and constructors, `RTCPeerConnection`,
`WebSocket`, subprocess spawns, shell scripts, and endpoint URLs taken from the environment. The
gateway's register was read only afterwards, to classify each hit.

| Path | Writes a ledger row? |
|---|---|
| `src/ai-call.ts`, `src/messages-stream.ts` (the two gateways, six wires) | yes |
| `src/live.ts`: mints a Realtime token (free); creates a GPT-Live session (billed) | yes, priced by us |
| Browser, direct to OpenAI over WebRTC (`useLiveConversation.ts`, `useGptLive.ts`) | yes, from the browser's report; a tab that never reports is missing |
| Web searches | inside the OpenRouter call that ran them; there is no direct search vendor |
| `tools/overseer/attention-classify.ts`, `tools/fleet/describe.ts` (plain `fetch` to OpenRouter) | no; listed in `UNMETERED_SPEND` |
| `tools/fleet/transcribe.ts` and eight eval or spike scripts | no; declared `metered: false` |
| Live-mode evals and spikes (WebSocket to OpenAI on `OPENAI_API_KEY`) | no; listed in `UNMETERED_SPEND` |
| `scripts/run-codex.ts`, `scripts/run-claude.ts` (subprocesses, on subscriptions) | no; listed in `UNMETERED_SPEND` |
| `tools/overseer/codex-usage.ts` (spawns `codex app-server` to read limits) | no; it buys nothing |
| Shell scripts (`evals/**/*.sh`) | they call the TypeScript evals above, nothing of their own |
| Endpoint from an environment variable | none found; the one `baseURL` is a constant |

**No undeclared path was found in the product.** Everything that writes no row is a developer tool
or an eval, and each is already named by `npm run cost`. Two of them spend on the same OpenRouter
account as local development, which is part of the local gap in check 1.

### (b) The paid check

`npm run test:paid`, run once against the **local** database: all eleven checks passed, three rows
(Messages, chat, embeddings), $0.000081. It does not cover transcription, images, decisions or
realtime, which is where the defects in check 1 are. The coordinator has deferred a probe per wire.

### (c) Production counts

Scripts: `audit-03-completeness.sql`, `audit-04-joins.sql`, `audit-categories.ts`.

- **Unpriced rows: 301** (the `UNPRICED_CALLS` condition). 264 are dictation transcription with
  outcome ok; the other 37 are stopped or failed calls across twelve jobs. What they really cost is
  in the census above.
- **Category `unknown`: 0 rows.** All 2,245 classify: default-step work 936 ($21.53), on-demand
  enrichment 595 ($56.98), interactive request work 655 ($11.27), voice 59 ($1.03).
- **Spend on rows that did not finish ok:** the ledger says $0.0893 over 39 rows. OpenRouter says
  at least $1.32 more.
- **Model steps with no row.** Of the model-step runs recorded on revisions since 2026-08-30, three
  have no ledger row nearby; each lasted under 0.2 seconds, which is a cache hit. Every finished
  model step in the `jobs` table has a row with its job id and step.
- **Interactive work with no row.** Since 2026-09-03 every assistant chat message and every search
  run has a ledger row for the same article at the same time (three "missing" chat messages are
  referee-candidates threads, billed under that job). Before then the request-path ledger did not
  exist in production: 33 chat messages from 2026-08-25 to 08-27 have none.
- **Live sessions:** 13 connected, 3 reported nothing (open for 0, 18 and 15 seconds).
- **Answered model differs from requested:** two pairs, both a provider's spelling of the same
  model (`voyageai/voyage-4` → `voyage-4`, 155; `typesafe/jev-1.13` → `…-20260917`, 16).
- **Log evidence of calls with no row.** Vercel's runtime logs for production, last 24 hours: no
  line containing "collector", "ledger" or "ai_calls" (a control search for `aiCalls` did return
  lines, so the search works). Logs older than about a day are not kept, and Sentry's logs
  answered 403. So: none in one day, unknown before.

## 4. Completeness of attribution

Product rows with no article, production, by job (`audit-03-completeness.sql`):

| Job | rows without a slug | Verdict |
|---|---:|---|
| shelf-topics | 45 of 45 | by design: the shelf is not an article |
| dictation, before 2026-10-01 | 163 of 163 | the known gap, closed on 2026-09-30 |
| dictation, since | 16 of 132 | by design: the handler attributes only when the dictation is going into an article |
| link-summary | 3 of 3 | all from 2026-09-11, before the fix; none since to judge by |
| every other request job, every pipeline job | 0 | |

- **52 rows ($2.74) have a slug and no article id**, all from 2026-08-30 and 08-31, across 8 slugs.
  Where the slug still exists, the call predates the current article row. The metadata page leaves
  these out on purpose.
- **Not measurable yet:** `POST /api/command-pick` declares `article: "none"`, and the command bar
  is used inside an article. It has no production rows, so whether that is a missed attribution is
  a decision, not a finding.

## 5. Will new work be tracked without anyone remembering?

**Enforced today:**

| Mechanism | What it actually catches |
|---|---|
| `tests/no-undeclared-spend.test.ts` | a file that names one of four provider hosts, one of eight paid paths or one of three credentials, or constructs the Anthropic or OpenAI SDK, and is on no list |
| `Record<AiJob, …>` in `src/cost-categories.ts` | a new job with no category: a compile error |
| the required `article` field on every route (`tests/authenticated-api-route-contract.test.ts`) | a new route that does not answer; not one that answers wrongly |
| `runStep` | attributes every pipeline step with no action from the step |
| `tests/setup/no-provider-calls.ts` | a test that would really call a provider |

**The scan was tried, not just read.** `audit-break-the-scan.ts` copies the test's matcher into the
scratchpad and hands it ten made-up files:

| Made-up file | Result |
|---|---|
| new file, bare `fetch` to OpenRouter's chat endpoint | caught |
| new file, `new OpenAI()` | caught |
| the same bare `fetch` added to `src/pdf-read.ts` or `src/embeddings.ts`, which are allow-listed as "presence check only" | **passed** |
| `fetch` to Google's Gemini API with `GOOGLE_API_KEY` (a key that is in `.env.local`) | **passed** |
| `@google/genai` SDK | **passed** |
| base URL from an environment variable plus `/v1/messages` | **passed** |
| OpenAI's `/v1/responses` on a host built at run time | **passed** |
| a search vendor, or a second voice vendor from the browser | **passed** |

The test's own header calls it a tripwire, and that is accurate.

**Only a sentence in a doc:** make the call inside a scope (a call outside one is a warning line);
answer `article` correctly; attribute by hand when the slug is in the body; check the price tables;
run `npm run test:paid` after touching the gateway.

## Defects and gaps, ranked by ease and value

1. **Dictation's transcription is never priced.** *Established.* 264 production rows, $0.79 by
   OpenRouter's records, billed to the OpenAI key outside the OpenRouter cap. The response says
   `cost: 0` with no BYOK flag, and the gateway rightly refuses to record that as free. *Smallest
   fix:* the response also carries `usage.seconds`; store it and price it from a per-minute table,
   as live transcription already is.
2. **Stopped and failed calls are recorded as costing nothing.** *Established.* 17 rows, $1.32;
   a stopped chat answer is the commonest, and adds 19% to chat's recorded $5.00. *Smallest
   addition:* have the cost analysis ask the generation endpoint about unpriced rows and print the
   shortfall. Writing it back to the row is a larger decision, since rows are never amended.
3. **Production has never been reconciled, and cannot be from the box.** *Established* (the
   fingerprints differ). *Smallest addition:* the admin costs endpoint, which runs where the
   production key and database both are, calls `GET /api/v1/key` and shows the month's gap for its
   own fingerprint.
4. **The reconcile report's caveat is out of date.** *Established.* It says the gap "holds
   everything spent on this key before the ledger existed"; it compares a month with a month. The
   sentence teaches the reader to ignore a $77 gap. *Fix:* reword it, and print the gap as a share.
5. **51 web-search rows ($5.91, 6.5% of the ledger) cannot be checked.** *Established* that
   OpenRouter's record for the stored id is empty on all 51; *reasoned* that the response header's
   id names a wrapper and the charge sits under another id. *Smallest addition:* one paid
   web-search probe (a few cents) that records every id the response carries and looks each up.
6. **An allow-listed file can grow a raw provider call unseen.** *Established* by the scratch run.
   *Smallest addition:* move the "presence check only" files from `ALLOWED` to the narrower
   `MAY_NAME` list, where a `fetch` beside the name is still an offence.
7. **A provider the scan has never heard of passes it.** *Established* by the scratch run.
   *Smallest addition:* a test that lists every hostname literal in `src/` that is passed to a
   request, against an allow-list, so a new outbound host needs a line; and a second that fails on
   a new AI SDK in `package.json`.
8. **A call that writes no row survives as a log line for a day.** *Established* (retention), and
   *reasoned* that some have happened. *Smallest addition:* send the four warnings in
   `src/ai-spend.ts` to Sentry as events, so they are counted and alert.
9. **`reported_input_tokens` means two things.** *Established* by the sample. A "tokens in" column
   or a cache-read share summed across wires mixes them. *Smallest addition:* one function that
   returns a row's total prompt tokens by wire, with a test, used by the cost cube.
10. **The paid check covers three of seven wires**, and both defects above are on the others.
    *Established.* Deferred by the coordinator, with a queue entry.
11. **Price tables have a "last checked" date nobody is asked to renew.** *Reasoned.* *Smallest
    addition:* a test that fails when the date is older than a chosen number of days.
12. **`/api/command-pick` attributes nothing to the article it was typed in.** *Reasoned*; no
    production rows yet. A decision rather than a fix.
13. **A controlled balance check on a quiet key** is the only thing that would prove completeness.
    Deferred by the coordinator, with a queue entry.

One thing that is not a tracking defect but came out of the same queries: 51 of 394 article-steps
in production were bought more than once, and those 51 hold $23.27. That is a lead for the cost
analysis.

## The scripts

All in the session scratchpad
(`/tmp/claude-1000/-home-greg-code-spideryarn2/0326b1f6-4b21-4d17-bcdc-302741834235/scratchpad/`),
none committed. The `.ts` files read `OPENROUTER_API_KEY` from `.env.local` and never print it; the
result files hold ids, models and amounts.

- `audit-prod-read.ts` — runs a `.sql` file against production, read-only.
- `audit-01-schema.sql` … `audit-06-sol.sql` — the queries, in the order above.
- `audit-accuracy-sample.ts`, `audit-accuracy-result.json` — check 1's sample.
- `audit-unpriced-census.ts`, `audit-unpriced-census-result.json` — check 1's census.
- `audit-computed-recompute.ts` — the computed-price recomputation.
- `audit-categories.ts` — categories over the production ledger.
- `audit-break-the-scan.ts`, `audit-scan-copy.ts` — check 5's attempt on the scan.
