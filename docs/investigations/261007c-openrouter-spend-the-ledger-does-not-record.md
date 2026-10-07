# OpenRouter spend the ledger does not record

Up: [investigations.md](../project/investigations.md). Queue item `qi-5baq4mhn`. The fix is
[plan 261007o](../plans/261007o-openrouter-spend-the-ledger-does-not-record.md). The machinery is
described in [cost-tracking.md](../project/cost-tracking.md); the previous audit, which checked
the rows that *were* written, is
[261005a](261005a-cost-tracking-audit-accuracy-and-completeness.md).

## What was asked

Greg, 2026-10-06, asked what the OpenRouter key was spent on: about $400 to $483 over five weeks.
The ledger accounted for about $350 ($263 of evals, $75 of job steps), so about $130 was
unaccounted for. The queue asked where it went, and for a red-first fix to any call path that
spends without recording.

## The answer

- **The key is the dev key.** Its fingerprint is `66c3cdfc178e`, and it is in `.env.local` on the
  box. Production's key (`49a901286417`) has spent $95.25 in its lifetime, and production's ledger
  agrees with it to within the 261005a audit's known $2. The gap is all on the dev key.
- **The gap, read on 2026-10-07 at 18:24 UTC:**

  | | OpenRouter (`GET /api/v1/key`) | box ledger, same key | gap |
  |---|---:|---:|---:|
  | lifetime | $579.13 | $353.43 | **$225.70** |
  | October (UTC month to date) | $396.38 | $276.70 | **$119.68** |
  | before October | $182.75 | $76.73 | $106.02 |

  Greg's $350 is the box ledger's lifetime figure: $263.13 of `eval` rows and $78.67 of `job_step`
  rows. The account as a whole has used $694.66, across these two keys and others.
- **Most of October's gap, about $79 of $120, is evals and probes.** They called a model through
  the gateway, so the call was metered, and wrote no row. The gateway meters every call. A row is
  written only if a collector with a `sink` is open, and nothing made an eval open one.
- **What is left, about $40 of October**, is not attributed by anything readable from this box.
  The candidates are below, with what each is known to be worth.

## Where it went, October

All figures are UTC. "Read" means from a record the eval itself wrote: a results file's cost
field, or a figure printed in a plan or investigation at the time. "Estimate" means derived.

### 1. Evals with no collector at all: about $32

The gateway's `recordSpend` finds no scope, logs one warning (*"a model call was made with no spend
collector open"*), and drops the row.

| Eval | Day | $ | How known |
|---|---|---:|---|
| `evals/paperwork/modes.ts` | Oct 3 | ~12 | estimate, [261003d](../plans/261003d-paperwork-in-every-whole-piece-mode.md) |
| `evals/glossary-citations.ts` | Oct 3 | ~8 (7 to 20) | estimate: 83 glossary calls at ~$0.09 |
| `evals/quiz-reading-goal.ts` | Oct 1 | ~7 | $5 read for 20 runs ([261002l](261002l-quiz-prompt-evals-easier-build-up-reading-goal-and-profile.md)); 28 runs extrapolated |
| `evals/citations-influence.ts`, `-dig.ts` | Oct 3 | ~3.7 | estimate from tokens, [261003f](261003f-citations-influence-unknown-unless-confident-before-and-after.md) |
| `evals/arc-length/run.ts` | Oct 2 | ~1.8 | estimate: 25 calls |

`evals/glossary-citations.ts` and `evals/plain-words/run.ts` both say in their headers that every
call writes a row. Neither opens a collector.

### 2. Collectors with no sink: about $12

`collectSpend` without a `sink` counts the calls into the eval's own printed total and writes
nothing. The option is optional and its absence is silent. There are twelve call sites,
all touched in October. Script: [`sinkless-collectors.ts`](../../evals/cost/unledgered-261007/sinkless-collectors.ts).

| Eval | Day | $ | How known |
|---|---|---:|---|
| `scripts/eval/skim-coverage-eval.ts` | Oct 3, Oct 6 | 6.52 | read, eleven results files |
| five `scripts/probes/261001*` probes | Oct 1 | 2.86 | read, their plans and `.jsonl` files |
| `evals/guide/run.ts` | Oct 7 | 1.21 | read, `results/v1.json`, `v2.json` |
| `scripts/eval/quotes-spread-eval.ts` | Oct 2 | 0.75 | read, results file |
| `evals/pdf/minimal-metadata/score.mts`, `preview-shelf.ts` | Oct 1, Oct 3 | ~0.1 | read and estimate |

### 3. Sinks that keep the rows in memory: $35

These evals write their own ledger into a results file instead of `ai_calls`.

| Eval | Day | $ | How known |
|---|---|---:|---|
| `evals/long-structure/{arms,calls,judge}.ts` | Oct 5 | 32.31 | read, [261005c](261005c-long-document-structure-top-level-first-against-slices-and-one-call.md) |
| `evals/long-documents/{spike-parts,spike-followups,note-comparison}.ts` | Oct 5 | 2.73 | read, [261005a](261005a-long-documents-structured-in-slices.md) |

### 4. Spend that is recorded, at nothing: $2.21

Rows on this key with no money: 361 since 2026-09-01. Their generation ids were looked up one by
one: $2.11 of credits and $0.11 billed to our OpenAI key. 206 of them carry no generation id, which
means the request failed before a response. Script:
[`unpriced-lookup.ts`](../../evals/cost/unledgered-261007/unpriced-lookup.ts).

### 5. Developer tools that are declared to write no row: under about $3

| Path | October | How known |
|---|---|---|
| `tools/overseer/attention-classify.ts` | under $2, capped at $10.50 | `~/.overseer/model-budget.json` read $0.075 for 215 calls today; its ceiling is $1.50 a day; no history is kept |
| `tools/fleet/describe.ts` | pennies | five cached descriptions, `gpt-5.6-luna` |
| `tools/fleet/transcribe.ts` | pennies | ~$0.0005 per dictation |

These are already listed by `npm run cost` under *Not counted here*.

### 6. Not attributed: about $38

| Candidate | What is known |
|---|---|
| eval re-runs that left no results file | the counts above take only runs with a record |
| a process killed mid-call (Ctrl-C, a timeout) | the row is written only after the call settles (`src/ai-spend.ts` § `PendingCall`); the job table shows one lost worker in October; an eval killed mid-call leaves no trace |
| another machine using the same key with its own database | possible (Greg's Mac); not checkable from the box |
| the estimates in §1 being low | glossary-citations alone could be $7 to $20 |

Closing this needs OpenRouter's own per-generation list. `GET /api/v1/activity` answers
`403 Only management keys can fetch activity`, and neither key is one. Joined on
`generation_id`, the dashboard's activity export would name every call with no row, with its model
and its time. The gateway sends `X-Title: Spideryarn` on the chat wires. The Messages wire, the
Overseer and the evals' raw fetches send no title, so the title alone would not separate them.

**Left open on purpose.** Greg, 2026-10-07: *"If it's easy to record, great. If it's
complex/hassle don't worry too much about it."* Recording new spend is now enforced (plan
261007o); naming the last ~$38 would need his manual export, so it is not pursued unless he
exports it.

## Before October: $106

Evals that went unrecorded in September come to about $30 (range $24 to $36). Of that, $7.7 is
read: `spike-book-structure`, `spike-expand-section` and `spike-pdf-width` on Sep 4, and
`quotes-spread`, `trajectory-coverage`, `source-guess` and `quote-stop-repro`. The rest is plan
estimates for `evals/plain-words/*` ($12 to $18) and the quiz evals (~$7.5). That leaves about
$76. The box's ledger starts on 2026-09-01, so anything the key spent before that day is in the gap
by construction. How much that was is unknown from here, because `/api/v1/key` gives only a
lifetime total, a month, a week and a day.

## The live watch

A scratch script sampled OpenRouter's running total for the key (`GET /api/v1/key`, free), the
ledger's total and the list of live processes every three minutes, from 18:24 to about 19:50 UTC on
2026-10-07. Neither total moved in that window. It confirmed nothing and saw no leak, so it was not
kept. It called OpenRouter directly, which `tests/no-undeclared-spend.test.ts` rightly flags.

**What the fix does to the four kinds of loss** (described in plan 261007o, below). It stops kinds 1
and 2 for every eval, now and later: a missing collector, or a collector with no sink. Kind 3 is
stopped only where it was converted by hand. A sink that keeps rows in memory still passes the
check, because the check asks whether a sink is there, not whether it writes to the database. One
script keeps a sink that writes nothing, on purpose: `preview-shelf.ts` reads production, and
writing its row would mean writing to production. It spends about a cent a run, and its comment
says so.

## Where "tracked for free" was false

[cost-tracking.md](../project/cost-tracking.md) said a script or eval "opens its own with
`collectSpend`". That is true, and incomplete. A collector opened without a `sink` writes nothing,
and a script that opens none writes nothing either. In both cases the result is one warning or none.
The three dictation evals declared `unscoped` in `src/spend-declarations.ts` show the class was
known. What it lacked was a mechanism: by October it was costing more than all the job steps put
together.

**The fix (plan 261007o).** A gateway call from a process whose entry file is under `evals/` or
`scripts/` is refused when no collector that writes rows is open. The refusal happens before a byte
goes over the wire. A new eval that forgets the ledger now stops at its first call, for nothing,
and says what to add, instead of spending into no total.

## The scripts

All in [`evals/cost/unledgered-261007/`](../../evals/cost/unledgered-261007/). Read-only on the
database. They print no key and no generation id.

- [`local-read.ts`](../../evals/cost/unledgered-261007/local-read.ts) runs a `.sql` file against the
  local database inside `BEGIN READ ONLY`; [`q1.sql`](../../evals/cost/unledgered-261007/q1.sql)
  is the by-key, by-month and by-day breakdown.
- [`unpriced-lookup.ts`](../../evals/cost/unledgered-261007/unpriced-lookup.ts) prices the rows
  with no money by their generation ids (free).
- [`sinkless-collectors.ts`](../../evals/cost/unledgered-261007/sinkless-collectors.ts) lists every
  `collectSpend(` and whether it passes a sink.
