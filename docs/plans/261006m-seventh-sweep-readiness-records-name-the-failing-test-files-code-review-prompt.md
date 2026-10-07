# Code review (write-capable): readiness records name the failing test files

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** commit `73d6be783` on branch `worktree-sweep7-readiness-failed-files`
(`git show --stat 73d6be783`; base `2f8edaddc`). Its plan:
`docs/plans/261006m-seventh-sweep-readiness-records-name-the-failing-test-files.md`.

**What it does.** A readiness run (`scripts/readiness-run.ts`, the wrapper that records whether a
commit passed its checks; read `docs/project/readiness.md`) now records, on a failed run, a capped
list of the vitest files that failed (`failedTestFiles: { files; total } | null` on
`FinishedRecord`), read by a streaming scanner `makeFailedTestFilesCapture` in
`tools/fleet/readiness-parse.ts`, and the fleet dashboard's Readiness tab shows them.

**The standard.** This is the Overseer's dashboard: the tool people reach for when something else
is broken, so it is held to a higher bar than the app. The properties that must hold, each of which
you should try to break rather than confirm:

1. The new field can never change a run's verdict, turn a green run red or a red run green, or
   crash the wrapper — including on hostile or enormous output (a 14 MB log, a line of 1 MB, binary
   bytes, ANSI colour, CRLF, a path with spaces or unicode, interleaved stdout/stderr chunks split
   mid-line or mid-escape-sequence).
2. "No file failed", "not known" and "a capped list" are distinguishable everywhere: on disk, in
   the parser, on the wire, and in the panel. An old record without the key reads as not known.
3. A wrong name is never shown as a fact: find an input where the scanner names a file that did not
   fail, or misses one while reporting `total` as exact. The builder's known limit: a line inside
   vitest's summary that starts exactly ` FAIL  <path>` but is part of an error message. Is there a
   realistic one (a test whose own assertion output prints vitest-style lines, e.g. tests that test
   the test runner or this very parser)? `grep -rn "FAIL " tests/ | head` is a start.
4. The fixtures under `tests/fixtures/` for this are said to be real captures. Do the assertions
   depend on anything the scanner could get right by accident?
5. The panel: the card "pools failed wrapper runs in the window on any commit". Is anything it
   says false when runs are capped, when some failed runs named nothing, or when records come from
   log reconstruction (`readiness-backfill.ts`)?
6. Record size and the store's read limit; retention; two writers.

You may run `npx vitest run tests/<file>` for the readiness and fleet test files (they need nothing
outside the tree) and `node --import tsx <script>`. A red test inside your sandbox may be the
sandbox's doing (tests that spawn a child or write a temp file): say so rather than reporting it as
a finding. Do not run `npm test`. There is no network.

**Fix what is inside this stage**, narrowly, each finding red-first with the test that reproduces
it. **Report, do not fix, anything wider** (other readiness code, the dashboard at large). Do not
commit (you cannot, in a linked worktree). Do not edit docs to attribute any decision to the
product owner: the design choices here were the orchestrator's (Claude's) and the builder's.

**Reply format.** Findings with IDs C1, C2, ...; severity P0 (wrong verdict, crash, data loss) / P1
(the dashboard states something false) / P2 (correctness with no visible effect) / P3 (tidiness).
For each: the input that shows it, whether you reproduced it, whether you fixed it (and the test).
Then: files you changed; what you ran with raw counts; a verdict (ship / ship with these fixes
applied / do not ship); wider notes.
