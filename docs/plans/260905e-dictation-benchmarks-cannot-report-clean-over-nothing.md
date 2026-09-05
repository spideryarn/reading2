# The dictation benchmarks cannot report clean over nothing

Parent:
[260905b-feedback-reports-batch-three.md § Two findings routed into this batch's territory](260905b-feedback-reports-batch-three.md#two-findings-routed-into-this-batchs-territory).
The class and the reasoning are in
[260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md](../postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md)
— **a clean bill computed over the collection the failure emptied** — and are not restated here.

Two instances, both in `evals/dictation/`, both verified by reading the code.

1. **[`bench-models.ts`](../../evals/dictation/bench-models.ts)** — `clean` started `true` and was
   falsified only by `odd.length`, the answers naming a model other than the arm's own. An arm whose
   every call was lost has an empty map, so `odd` is empty, so nothing falsifies `clean`, and the run
   ends by printing *"every call named the model it was sent to"* over an arm that named nothing. No
   exit code either way.
2. **[`bench-vocabulary-sources.ts`](../../evals/dictation/bench-vocabulary-sources.ts)** — the
   results JSON wrote `calls: CONDITIONS.length * utterances.length * RUNS`, the **planned** count,
   under a field name that claims to say what happened. `lost` sat two lines below, so a reader could
   subtract; the artefact outlives the console output that would have told them to.

## What was done

A pure module, [`evals/dictation/coverage.ts`](../../evals/dictation/coverage.ts), shared by both
benchmarks. It takes what each arm or condition *attempted* and what came *back*, and returns a
verdict in which `clean` is a positive statement — every arm answered every call it was sent, and
every answer named the model it was sent to — rather than the absence of one specific complaint.

Both scripts then print its lines and set `process.exitCode = 1` when an arm or condition answered
nothing at all. The *reasoning* is `evals/quiz.ts`'s — a partially thin run still has something to
read, and a run that measured nothing does not — but this is an **arm-level adaptation and not a
copy**: `quiz.ts` exits 1 only when every case failed, while these exit when any one arm is silent,
because both files exist to compare arms against each other and a comparison missing one of its
sides is an absent answer rather than a thin one. ⟨GPT Sol, 2026-09-05, correcting a comment and a
sentence here that both claimed the rule was copied verbatim.⟩

The same review round added three things: `RUNS` is validated as a positive whole number where it is
read (`for (run = 0; run < RUNS; run++)` runs `ceil(RUNS)` times, so `RUNS=1.5` made two calls per
clip and recorded one and a half as attempted); the vocabulary benchmark's `none` line now names the
silent conditions rather than asking whether the run *as a whole* answered nothing; and `clean` is
computed forwards — every arm answered all of what it was sent, in whole positive numbers — so
`NaN`, which compares false to every comparison in the lists, cannot pass through it.

The results files record `calls: { attempted, answered, lost }` in both benchmarks — the planned
number kept, because a re-run needs it, but no longer able to pass for an outcome.

## Why a separate module rather than a fix in place

Both benchmarks are top-level scripts that load `.env.local`, throw without an API key and make paid
calls at import. Nothing can import one to test it, which is exactly why the previous fix in
`bench-models.ts` (GPT Sol's item 4, the comment still above the check) could relapse one block
later with no test able to notice. Moving the judgement into a function makes the zero-answers case
constructible, and [`tests/dictation-bench-coverage.test.ts`](../../tests/dictation-bench-coverage.test.ts)
constructs it.

The simpler option passed over: leave the logic inline and add `if (!seen.size) clean = false`. That
closes this instance and leaves the next one exactly as reachable — the relapse above is the
argument against it.

## What was watched go red

Written against the old inline logic first, as a standalone reproduction: an arm with an empty
`whoAnswered` map, scored the way `bench-models.ts` scored it, reports `clean === true`. Then against
`coverage.ts`: `clean === false`, the arm named as silent, and an exit code of 1. The test file keeps
that first case as `reportsCleanTheOldWay`, a copy of the old three lines, so the assertion is
against a shape rather than against a memory of one.

## The rest of the directory, swept and reported

The other six files in `evals/dictation/` were read on 2026-09-05 looking for this shape only —
`gate-models.ts`, `score.ts`, `bench-transcribers.mjs`, `bench-vocabulary.mjs`, `make-clips.mjs`,
`README.md`. **None of them has it**, and two of them are worth knowing about because they got it
right first: `bench-transcribers.mjs` and `bench-vocabulary.mjs` both filter to the calls that
succeeded and then branch on the empty case — printing a literal `FAIL` row — *before* computing any
latency or WER, so a total-failure run prints `FAIL` on every line. `gate-models.ts` prints a
per-candidate line whatever happens, including the failure.

One weak observation, **reported and not fixed**, because it does not fit the shape: `gate-models.ts`
never sets `process.exitCode`, so a run in which every candidate failed still exits 0. Nothing about
its output reads as clean, so this is a chaining inconvenience rather than a false green.

## Open questions, recorded rather than asked

- The other four instances the postmortem lists (`remember-stances.ts`, `hierarchy-structure/floor.ts`,
  `referee-mirror.ts`, `referee-claims.ts`) are untouched here and stay reported. `coverage.ts` is
  shaped for the arm-versus-attempted family, so three of the four would fit it; whether that is worth
  a sweep is Greg's call, not this job's.
