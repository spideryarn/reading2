# OpenRouter spend the ledger does not record (qi-5baq4mhn)

Up: [plans.md](../project/plans.md). The findings, with every figure and its source, are in
[261007c](../investigations/261007c-openrouter-spend-the-ledger-does-not-record.md); this is
the work that follows from them.

## What was asked

Greg, 2026-10-06, asked what the OpenRouter key had been spent on: about $400 to $483 over five
weeks. The ledger accounted for about $350 of it ($263 of evals, $75 of job steps). Find the rest,
and fix any call path that spends without recording, red first. The queue entry says
`cost-tracking.md` claims new AI work gets tracked for free, and asks where that is false.

## What the investigation found, in one paragraph

The key is the dev key, fingerprint `66c3cdfc178e`, not production's. On 2026-10-07 OpenRouter put
it at $579.13 lifetime and $396.38 for October. The box's ledger holds $353.43 and $276.70. That is
a gap of $225.70 lifetime and $119.68 in October. Rows recorded with no money cover only about $2.20 of it.
The largest named share, **about $79 of October's $120**, is evals and probes that went through the
gateway, so the call was metered, and still wrote no row. There are three shapes of it:

1. **No collector at all.** The gateway's `recordSpend` finds no scope, logs one warning line,
   and drops the row. This is about $32 in October, from `paperwork/modes.ts`,
   `quiz-reading-goal.ts`, `glossary-citations.ts`, `citations-influence*.ts`, `arc-length` and
   others. `src/spend-declarations.ts` already has a kind for it, `unscoped`, with three dictation
   evals declared under it.
2. **A collector with no `sink`.** It counts the calls for the eval's own printed total and writes
   nothing. That is twelve call sites, about $15 in October.
3. **A sink that only keeps the rows in memory.** These evals record into their own results file
   instead. `evals/long-structure/*` and `evals/long-documents/*` come to $35 in October.

The first two can be refused without knowing anything about the eval. The third passes any check
that asks only whether a sink is there, so it is converted by hand. **A gateway call made by a
script or an eval, with no collector open that will write a row, is the bug every time.** A call
in a request, a job step or a test is not.

## Stages

### Stage 1: refuse, red first

In `src/ai-spend.ts`, `beginSpend` runs before a byte goes over the wire. It now throws
`UnrecordedSpendRefused` when both of these hold:

- no collector that writes rows is open (`persistingSpend()` is false: no scope, a scope with no
  sink, or a closed one);
- the process's entry file is under `evals/` or `scripts/` (`process.argv[1]`, relative to the
  repo root).

The message names the job and the model, and gives the one-line fix: `withLedger("eval", main)`
from `src/cli-ledger.ts`, or a `sink`.

Why the entry file, and not "anything that is not the server": the dev server runs under Vite and
production under Vercel. A test runs under vitest, and its provider calls are already blocked by
`tests/setup/no-provider-calls.ts`. In each of these a refusal would break a reader's feature or a
test, not stop a leak. A server path that ever calls with no collector stays as it is: one warning
and a counter (`unscopedCalls()`). The 2026-10-05 audit found none in a day of production logs. An
entry file is a fact the process already has. It is not a flag somebody has to remember to set.

Tests, in `tests/ai-spend.test.ts` or beside it, written first and watched go red:

- entry under `evals/`, no collector → throws, before the provider is asked;
- entry under `scripts/`, a collector with no sink → throws;
- entry under `evals/`, a collector with a sink → no throw;
- entry is Vite, vitest or nothing → no throw (unchanged behaviour);
- a closed collector, entry under `evals/` → throws.

The entry is read through one small function with an override for the test. Tests do not
reassign `process.argv`.

### Stage 2: the evals that would now refuse

- The twelve sinkless call sites get a sink and the environment owner.
- `long-structure`'s and `long-documents`' in-memory sinks keep their rows and also write them to
  `costStore`.
- The October no-collector evals named in the investigation get `withLedger("eval", main)`.
- The three dictation evals declared `unscoped` are left alone. See the review below.
- Two comments that say every call writes a row, in `evals/glossary-citations.ts` and
  `evals/plain-words/run.ts`, become true.

An older one-off eval left unconverted is not a leak any more. It now stops at its first call, for
nothing, and says what to add.

### Stage 3: docs

- `cost-tracking.md` rule 2, and the line under it about scripts, says what is refused and where.
- `ai-gateway.md`'s list of what writes no row.
- The investigation doc.

## What GPT Sol's plan review changed

[261007n-plan-review-sol.md](261007n-plan-review-sol.md). The verdict was "revise before
building". It found the choke point sound: every wire calls `beginSpend` before `send`, and
the retry loops rethrow the refusal rather than retrying it. These changed:

1. **A sink that does not persist still passes.** `persistingSpend()` asks whether a sink is
   present, not whether it reaches the database. An in-memory or no-op sink gets through. The
   claim is narrowed to *requires an open sink*, and stage 2 converts the in-memory sinks we know
   of. Telling a ledger sink from a report-only one would need a shared marker on every sink.
   That is a bigger change, left out.
2. **The dictation declarations stay.** `gate-models.ts` also makes raw diagnostic requests that
   `withLedger` cannot meter, and the other two still name a credential, so deleting their
   `unscoped` entries would fail `tests/no-undeclared-spend.test.ts`. They are left as they are.
   Their gateway calls are now refused, and the declaration's comment says so.
3. **The long-structure dry run must stay free.** `evals/long-structure/dry.ts` drives the same
   collectors with a fake provider that reports invented costs. The ledger write is for real runs only.
4. **The refusal has to survive the callers that rename errors.** `src/transcribe.ts` turned any
   unknown error into "the transcription service could not be reached", and
   `src/structure-slices.ts` turned it into a failed slice. Both rethrow `UnrecordedSpendRefused`
   now, each with a test. `evals/paperwork/modes.ts` still records the error as a result and moves
   on. It spends nothing doing so.
5. **Wrapping needs care.** An inner collector shadows an outer `withLedger`, so a sink goes on
   the inner one. A `process.exit` stays after `await withLedger(…)`.
6. **Symlinks.** The entry path and the repository root are both resolved with `realpath`.

## Not doing, and why

- **Recording the call instead of refusing it.** A process-wide fallback sink would let an
  unscoped eval record under the environment owner without the eval changing. But it needs every
  process to know its owner, every exit to wait for the writes, and tests kept out by a rule of
  their own. A refusal costs nothing at the moment it fires, needs none of that, and the fix it asks
  for is one line. This is the simpler option, and the reason we took it.
- **A row written before the call starts**, so that a process killed mid-call still leaves a
  trace. `src/ai-spend.ts` § `PendingCall` already defers it. The job table shows one lost worker
  in October, so it is not where the money went.
- **A scan test over `collectSpend(` call sites.** The refusal catches the missing collector and
  the missing sink at the first call, for nothing. The scan would only catch them earlier, and a
  sink that does not persist defeats a scan as surely as it defeats the refusal.
- **The ~$40 of October not named here.** The Overseer's classifier (under $2), the fleet's
  describer and dictation (pennies), stopped calls recorded at $0 ($2.20), and whatever else is left.
  That needs OpenRouter's activity export. It is a question for Greg in the debrief.

## Result

- **Stage 1 and 2 landed in `f3367eed1`.** `beginSpend` refuses; `src/transcribe.ts` and
  `src/structure-slices.ts` pass the refusal on; about thirty evals and probes record. The new
  tests were seen red first. The long-structure dry run was run after the change: 13,780 rows in
  `ai_calls` before and after, and no fake rows.
- **GPT Sol's code review** ([261007n-code-review-sol.md](261007n-code-review-sol.md)) found one
  real defect and fixed it. Several of the converted evals ran paid calls in parallel under
  `Promise.all`. One failing task closed the collector while its siblings were still buying, and
  their rows were dropped as late. They now drain with `allOrStop` or `allSettled` before
  rethrowing, and two new tests went red before the fix.
  [Postmortem 261007s](../postmortems/261007s-a-failed-parallel-task-closes-accounting-before-its-siblings-finish.md)
  names the class. The review also corrected a test that checked the wrong state, and fixed stale
  comments.
- **`preview-shelf.ts`** keeps a sink that writes nothing, on purpose, with a comment. It reads
  production, and a ledger row there would be a write to production.
- **Not attributed: about $40 of October.** Closing it needs OpenRouter's per-generation
  activity, which neither key can read. It is a question for Greg.
