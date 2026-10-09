# The digest spike

Can Sonnet 5.5 or Haiku 5.5, handed an Opus 5.5 "digest" of an article as well as the article,
match Opus 5.5 on Summary (Fuller), Ideas and chat? Plan
[261009a § Stage 3](../../docs/plans/261009a-latest-model-versions-haiku-5-5-and-an-opus-digest-spike.md).
This directory is the **generation** half; judging is done elsewhere, from the outputs in
`evals/results/digest-2026-10-09/`.

## Running it

```
npx tsx evals/digest/run.ts --preflight          # every call enumerated, estimated and bounded; spends nothing
npx tsx evals/digest/run.ts --run                # digests, then the cells; resumes, skipping finished cells
npx tsx evals/digest/run.ts --run --with-q2      # also the second chat question, if the cap still has room
npx tsx evals/digest/run.ts --report             # rebuild costs.json / costs.md from the cell files
```

`--out <directory>` starts a separate run. Resuming verifies the frozen questions,
stored requests (including hashes of the article and digest) and effort before
reusing results. Failures are kept too; retry them in a separate run so old costs
and judgements are not overwritten. `--report` needs only the saved files.

It refuses any `DATABASE_URL` that is not loopback and prints the `Target:` line first. It reads
the three articles from the local store and writes one ledger row per call there (job `eval`,
scope `eval`). Nothing else is written to the database.

The spend cap is $6.00, kept in `budget.json` across invocations (`evals/dig-deeper/budget.ts`):
each call reserves its worst case (one input token per request byte, plus `max_tokens` at the
output price) before it is dispatched and waits while the cap has no room; with nothing in flight
and no room, the run stops. If the preflight estimate is over $5, the second chat question is
dropped from the first pass.

An abandoned reservation or missing cost stops the run for inspection. Each call
has one transport attempt; workers drain before the budget lock is released.

`tally.ts --dir <judging-directory>` requires both judges' complete score files
and a bijective key. Optional `exclusions.json` records the conditional writing
comparison: each excluded cell must match its saved output hash. A fresh run
inherits no exclusions from this draw, and the all-lineup table is always retained.
For a separate generation run, build its blind packets with
`lineups.ts --results <run-directory>`. It refuses changed questions or changes
to packets/key already scored by a judge, before overwriting anything.

## What each call sends

- **Summary (Fuller) and Ideas: production's own request, captured.** `capture.ts` runs
  `generateSimpleSummary` and `generateIdeas` with `fetch` replaced, records the first
  Messages-wire request each sends, and answers it locally with a 400. Nothing goes over the
  network and the rows go to a sink that drops them. The captured system blocks, user message,
  `max_tokens` and output schema go out on the chat wire through `openRouterJson("eval", …)`, with
  the schema as `response_format: json_schema`. Answers are checked by production's own
  validators: `buildLevel("fuller")` and `buildIdeas`, so an answer production would reject is a
  failure here.
- **Chat: `buildConverseMessages` (kind `chat`, no history, position or profile), no tools**, at
  production's `max_tokens` of 4,000. Production chat can also search the web and the reader's
  library; this does neither.
- **The digest**: `prompts.ts` (`DIGEST_SYSTEM`), Opus 5.5, the article bytes Summary and Ideas
  send, then the instructions. It asks for a block-indexed **map** (claims, structure, evidence and
  qualifications, criticisms, confusing passages, terms, traps), not a prose synopsis, so that it
  does not pre-write the Summary or Ideas the cheaper model is being tested on.
- **"+ digest" arms** add one block, `digestBlock(digest)`: after the article and before the task's
  instructions (Summary, Ideas), or as a second part of the article message (chat). Everything else
  is byte-identical to the same model's no-digest arm.
- The article is marked for caching in every arm.
- The chat questions are in `questions.json`, frozen before any digest was written.

## Effort, which this route does not let you choose

Job `eval` is a `providerDefault` row in `CHAT_REASONING` (src/ai-call.ts), so the gateway strips
any `reasoning` the caller sends. Opus 5.5 gets `high` from `wireEffort`; Sonnet 5.5 and Haiku 5.5
get nothing and run at their defaults, `high` and `medium`. Production asks `high` of Summary and
Ideas, so Haiku runs one level below it, and the digest runs at `high` rather than `medium`.
`costs.md` records the effort of every arm. Each model runs at the same effort in its digest and
no-digest arms.
