# Testing: the history moved out of the reference doc

Moved verbatim from [docs/project/testing.md](../project/testing.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

## Testing

### One of the three build-dependent suites skipped a missing build

(Until 2026-10-06 one of the three skipped instead.)

## A run is not the only thing on the machine

### Why the config takes that variable away from vitest

#### The worker override that changed the singleton lane

It had already been typed in good faith: 260906f records
`VITEST_MAX_WORKERS=4 npm run check` as a "reduced-contention full gate".

## Three lanes, and which one your test is in

### Storage tests missing from the lane scan

GPT Sol found four by reading the map against `src/store/blobs.ts` (one of them,
`upload-acquire`, calls `pgReady(`, so the scan sees it and it is not on the list); poisoning
`SUPABASE_URL` found the other two on its first full run — including one that names no store at all
and reaches the bucket through the pipeline's own acquire step, which nothing but running it could
have caught.

`tests/health.test.ts` was the fifth and is not one any more: it reached Postgres through the health
handler's own `getDb()` until it was given a real `pgReady(` gate, which the scan sees — so the
exemption went stale the moment the fix landed, and the guard said so before anybody had to.

### Storage is **not** isolated

#### The six Storage test files before 2026-09-04

They were in the `unit` lane until 2026-09-04, reaching the real shared bucket while that lane's
documentation said it had no database; the poison covered `DATABASE_URL` and Storage is chosen from
`SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`. GPT Sol found four of them reviewing T-D and the
new poison found two more the first time it ran, which is the argument for a semantic backstop in
one sentence.

### With Docker off, `npm test` is red — and was before the lanes existed

Worth writing down because two documents claimed otherwise. Files that go through `pgReady` skip
loudly; a dozen private-lane files do not, because their fixtures reach the database outside any
gate. Measured 2026-09-04 with `DATABASE_URL` pointed at a dead port: **12 files failing** under the
three-lane config, and **9 of the same 10 sampled** under the single-project config from before the
lanes, for identical reasons. The lanes did not cause it. `tests/health.test.ts` was the one file
the lanes could have been blamed for, and it now has a gate.

#### The skip policy on 2026-09-04, before a database became mandatory

Only "the stack is not running" turns into a skip, and it has to say so itself: the factory raises
`StackUnreachable` from the three places that can mean nothing else, and
[`private-db-global.ts`](../../tests/setup/private-db-global.ts) skips on that class alone. Until
2026-09-04 it skipped on *any* error, so a failed dump, a failed restore, a cluster mismatch or a
failed migration all printed "no private database" and skipped ninety suites.

## What we test, and what we don't

### Missing DOM and cascade coverage on 2026-08-25

The paragraphs below are the 2026-08-25 measurement of that gap, when there were
no DOM tests at all.

  **The gap is bigger than "no DOM tests" sounds, and 2026-08-25 measured it.** Adopting Tailwind
  produced three bugs the whole suite was blind to: a generated `.outline` utility drawing a border
  round the table, unlayered CSS outranking every utility we meant to write, and `dark:` rules that
  applied or not depending on the *viewer's* OS setting
  ([web-client.md § Four guards](../project/web-client.md#four-guards-all-in-tailwindcss)). Every one produced
  valid CSS that rendered. None of them could have gone red here, because nothing renders React and
  nothing computes a style — and the third could not have gone red in a DOM test either, since jsdom
  has no OS to ask.

  So that was the moment to reconsider `@testing-library/react` (we went without), and to be honest
  about its ceiling: it would have caught the class names, not the cascade.

## What a brand-new test file owes the two registries

Written down on 2026-09-08 after a new
route test tripped two of them inside twenty minutes of being committed.

## Evals are not tests, and live in their own folder

### The structure-whole-document eval

It earned its keep on the first run: vocabulary retention caught the batch prompt turning the
author's "technorati" into "technologists", which every other check was happy with.

## A test that spawns a process needs its own timeout

On 2026-08-28 all four cases in `tests/store-export-fails-closed.test.ts` went red at
`Test timed out in 5000ms`, each taking 11-19 seconds. Nothing was wrong with the code or the tests:
the machine had a load average of **108** and 56 vitest workers alive, because six sessions were
sharing one laptop. The same file passes with a realistic ceiling, and a mutation still reddens
exactly the cases it should — so the ceiling did not weaken anything.

The cost of that red was not the failure, it was the **wording**. "Timed out" reads like a hang, so
it gets investigated as one. Half an hour went on a number.

### The reference doc predicted five-second failures on busy machines

**And the paragraph's own prediction came true on 2026-09-03.** A `npm run check` run on a box
carrying eleven worktrees came back with seven failures. Six were 5-second timeouts in suites that
pass in isolation; the seventh was a real regression that a guard had caught. Telling them apart cost
a second full pass, and the expensive half was not the re-run — it was that the noise and the signal
were indistinguishable until it finished.
[260903d](../plans/260903d-improve-the-codebase-second-sweep.md) § T1.2.

On 2026-09-03 three full runs produced 22, 2 and 2
failures and all but three assertions passed in isolation — and those three were real, hiding in a
batch of twenty.

## A green run here proves less than it looks like

### Run the suite in tmux, because a killed run and a passing run look the same

On 2026-09-08 three sessions reported the same `fixture-ids` red to its owner after the fix
had merged, one of them from a tree that already held it.

This
section used to give the raw incantation with `-s gate` hard-coded in it, and both halves drifted:
the second agent to run it in a minute got `duplicate session` and improvised a name, and agents who
had lost a one-shot session to a quoting mistake made a bare `bash -l` session and typed into it
instead. On 2026-09-05 eight of those husks were sitting on the box
under names nobody recognised — `gateA`, `stageDbase`, `stage2base` — one of them fifteen hours old.

### A scoped run answers a smaller question than it looks like

On 2026-09-10 a change to a
box-action request body passed eight scoped suites and typecheck, while
`tests/fleet-quarantine.test.ts`, which posts to the same route and was in nobody's diff, lost
three guarantees; only the full suite saw it.

## A suite that cannot run, and how to make it say so

**Failing instead of skipping was the wrong fix at the time** — it reddened the suite for everyone
without a local Postgres, when a missing database was a fact about a laptop. That stopped being true
on 2026-09-05, when the database became mandatory: the next section is where the failing went.

**Until then most of the Postgres suites skipped in silence**, because they warned with
`console.warn`.

### When a skip is not acceptable: never, since 2026-09-05

That is a change of policy, and the thing it replaced is worth knowing. A hundred-odd suites used to
take themselves out when the database was missing, in the one part of the summary nobody reads: a run
could pass, or fail for something else entirely, with every one of them absent.

## One database, many suites: the three shared resources

**Measured 2026-08-30.** Two concurrent `npx vitest run` processes over the seven job-slot files,
with the key neutralised so the lock excludes nobody: **23 to 50 failures per run** across four runs,
four to six of the seven files red, where every one of those files is green alone. With the lock
taken by all of them: **0 failures**, across four concurrent pairs and a wider nine-file set, and 162
passed / 162 passed on an independent second reading.

The spread is the point. The first version of this paragraph said "39 failures in each" — a
suspiciously equal pair, taken before a change to the teardown — and it was replaced after
re-measuring.

### Six job-slot failures: the clock and the assertion

On 2026-08-30 six cases failed at 20,468 / 20,438 / 20,589ms and
the duration was read as though it were the failure. It was not — the assertions were ordinary diffs
like `expected 'running' to be 'error'`, and the 20 seconds was the wait in front of them.

### The running-slot holder behind those failures

That day's holder was a job left
`running` by an *aborted teardown*: `store-jobs-parity`'s `afterAll` deleted articles before jobs, the
foreign key refused, the first delete threw, and the rest of the teardown never ran. The fix was
to delete jobs first and key the teardown by slug rather than by minted ids.

### The filtered record of those failures

The only record of those six failures came through
`… | grep -E "FAIL|× |Tests |not to contain|to contain" | head -8`, which does not match
`AssertionError`, `expected` or `Received`. The timings survived and the assertion text did not, so
weeks later the transcript could still prove *how slow* the failures were and could no longer say
*what they claimed* — and two plausible explanations for them could not be told apart.

## Mint a fixture id randomly, not by counting

`tests/find-article.test.ts` took
`…c4`, `…f1` and `…f2` on 2026-08-31 and collected three collisions at once — with `source-store`,
`chat-anchor` and `publish-session-cleanup-log`. Only the `…f1` pair could actually destroy a row;
that is not a distinction worth relying on, and the file now uses random ids.
