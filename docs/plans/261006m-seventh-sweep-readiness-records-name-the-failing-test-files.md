# Readiness records name the failing test files

Item 9 of [261006j § For Greg](261006j-sixth-codebase-sweep-umbrella.md), asked for by Greg and the
Overseer on 2026-10-06. The area is [readiness.md](../project/readiness.md).

## Goal

A readiness record says a run failed and how many files failed, and not which. The nomination
([261006j N1](../investigations/261006j-sixth-sweep-breadth-nominations.md)) counted 22 failed runs
and could not say whether that was one test red for six hours or 22 different flakes without digging
21 raw logs out of another worktree. After this, the record carries the names, and the Readiness tab
shows, per file, how many of the day's failed runs it failed in.

## What vitest really prints (measured, 2026-10-06)

37 real logs: the loop's eleven failing run logs under the runner worktree's
`logs/readiness-runs/`, and the primary's `logs/tmux-jobs/`.

- The names are in vitest's failure summary, printed once, after the last test and before the
  `Test Files` footer: a ruled heading `Failed Suites N` and/or `Failed Tests N`, then one line per
  failure, ` FAIL  <project>  tests/x.test.ts > describe > test`, or
  ` FAIL  <project>  tests/x.test.ts [ tests/x.test.ts ]` for a file that would not load.
- **The heading and the `FAIL` lines go to stderr; the `Test Files` footer goes to stdout.** Probed
  with a one-line failing test and each stream discarded in turn.
- The project badge is ` unit ` in colour and `|unit|` without, and absent with one project.
- In a full `npm run check` the summary sits about 96,000 lines into a 14 MB log. The wrapper keeps
  the first 8 KB and the last 64 KB, so **the names are in neither window**. That is why the count
  for a `check` run is the summary table's `test FAILED` row and nothing finer.
- In all 35 logs that reached a footer, the distinct paths on `FAIL` lines after a heading equal the
  footer's `N failed` exactly, and no `FAIL <path>` line appears anywhere outside the summary. The
  two that did not agree have no footer (a deploy log printing `FAIL test`, which names no path).

## The shape

One field on the finished record, in memory `FailedTestFiles | null`, on disk optional:

    failedTestFiles: { files: [string, ...string[]]; total: number } | null

- `files` — repo-relative paths as vitest printed them, distinct, sorted, at most 20
  (`FAILED_TEST_FILES_CAP`), each at most 200 characters. Sorted so that two capped runs list the
  same twenty, and "the same files as last time" stays a comparison of like with like.
- `total` — how many distinct files failed. Greater than `files.length` only when the cap cut it.
- `null` — the names are not known: an older record, a run that did not fail, a failure with no
  vitest summary (typecheck, a killed run), or a summary this parser could not read with certainty.

**There is no empty list.** `files` is non-empty by type and by the record parser, so the field can
say "these failed" or "not known" and cannot say "none failed". Whether none failed is the tally's
and the exit status's to say, and a list that could be empty would be a second, weaker place to say
it.

**It cannot move a verdict.** Nothing in `readiness-verdict.ts` reads it. The record parser drops a
malformed value to `null` and keeps the record — the opposite of what it does for a tree stamp,
deliberately: an unreadable record forces the headline to `unknown`, and a list of names is not
worth that. The parser also drops it on any record that is not `fail`, so a pass can never be drawn
with failing files beside it.

**All or nothing.** Inside the summary, a ` FAIL ` line whose path cannot be read with certainty
makes the whole result `null`, as does any exception in the scanner. A partial list with a confident
total is the one output worse than no list.

## How it is read

A streaming scanner beside `makeAdmissionRefusalCapture`, which exists for the same reason: the
sentence that matters passes through the middle of the output. One line buffer and one "have seen
the heading" latch per stream, one shared set of paths. The latch is what keeps the megabytes of
test output before the summary — where any test may print anything — from being read at all.

The backfill (`readiness-backfill.ts`) does not get names. It holds a head and a tail of each log,
so it could name some failures and not know how many it missed; its records carry `null`.

## Passed over

- **Parse the retained head and tail, as the counts are.** One regex and no new state — and it finds
  nothing for a `check` run, which is 30 of the 34 failed records on disk.
- **Vitest's JSON reporter.** The honest source, and a change to how every `npm test` on the box
  runs, with an output file per run to place and clean up. The text has agreed with vitest's own
  count 35 times out of 35.
- **Reconcile the names against the footer's count, and drop them on a mismatch.** A file run under
  two projects would be one path and two failed files, and a `check` run has no footer to compare
  with. The dashboard shows the count and the names side by side instead.
- **Typecheck's failing files.** `error TS` lines carry paths too. Not asked for, and nobody has had
  to dig a log out to answer it.
- **A `{ kind: "unknown", why }` arm** instead of `null`. It would say why the names are missing; no
  reader yet wants to know.

## Stages

1. Red: tests for the scanner against two fixtures cut from real logs, the record parser, the
   client parser and the day's summary.
2. `readiness.ts` (type, parser, sentence), `readiness-parse.ts` (scanner), `readiness-run.ts`
   (wire it in, print the names), `readiness-loop.ts` (its outcome line).
3. The panel: names in a mark's tooltip, and a "Failing test files" card.
4. Mutations, gates, docs, GPT Sol review of the commit.

## Done when

- A failing `check` run's record names its failing test files, and an old record still reads.
- The tab answers "red for hours or a flake" without a log.
- The fixtures are real captures; the mutations in the commit message each turn a test red.

## Takes effect when

Nothing was restarted or deployed by this work.

- **The record**: no restart. The wrapper is a fresh process per run, and the loop starts
  `scripts/readiness-run.ts` from its runner worktree, which it fast-forwards to `origin/dev` at the
  top of every tick. The first run after this reaches `dev` writes names.
- **The dashboard**: the fleet server has to be restarted on a build that has this, in the primary —
  `git merge origin/dev`, `npm run build:fleet`, `npx tsx scripts/fleet-restart.ts restart`
  ([overseer.md](../project/overseer.md)). Until then the running server's record parser builds its
  own object from each file and leaves the new key out, so the names are on disk and not on the wire.
- **The loop's own `outcome:` line**: when the loop process is next restarted. It loaded
  `readiness.ts` when it started.

## What was built, and what the mutations showed

As planned, with one addition found on the way: a test that runs the real wrapper as a child
process against a fake `npm` whose stderr carries the real failure summary under 200 KB of noise on
each side. The scanner's own tests would all pass with the wrapper never calling it.

The **Failing test files** card counts wrapper runs only. Log reconstructions can never carry names
and most of them are an agent running one file, so counting them as "did not record which files"
would bury the number that matters.

23 mutations, each run against the tests and then put back; 20 turned a test red at once. The other
three:

- *The wrapper writes names whatever the outcome* survived, because the test read the record back
  through the parser, which drops them. The test now also reads the bytes the wrapper wrote.
- *The card never says "at least"* survived, because the note below the rows contains the same
  words. The test now reads the row.
- *The client accepts an empty list* is an equivalent mutant: the length check four lines earlier
  already refuses it. Left as two guards.

One test here was never red: *does not change the verdict by being there*. It guards a property
that was already true — nothing in `readiness-verdict.ts` reads the field — and would fail only if
somebody made it read it.

## Not done

- The backfill's records, typecheck's failing files, and a comparison with vitest's own count: see
  Passed over.
- A ` FAIL ` line that is part of a test's *error message* inside the summary — a diff of expected
  output, say — would be read as a failure if it starts at column 0 with exactly that shape. None
  of 37 real logs has one. The cost would be a wrong name on the card, never a wrong verdict.
- The panel was not looked at in a browser. The card is covered by a jsdom render test, which
  cannot see spacing or wrapping on a phone.
