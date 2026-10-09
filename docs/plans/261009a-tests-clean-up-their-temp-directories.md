# Tests clean up their temp directories (qi-4b5598e2)

**Status:** done, 2026-10-09. Queue item qi-4b5598e2, found by the box rebuild (261006m).

Greg, 2026-10-09, on the Overseer's list naming this item:

> Those three bugs that you mentioned all look good to fix

> You are definitely authorised to fix bugs any time you notice them.

## The problem

Test runs `mkdtemp` under `/tmp` and mostly never remove what they made. The box rebuild found
about 50,000 directories a day arriving, `/tmp` at 150 GB and 806,000 entries, and `/` held at
84–89%. Plan 261007j's seven-day age-out on `/tmp` is a sweep after the fact; this is the source.

## What is there

- **No shared helper to fix.** 243 test files call `mkdtemp` themselves, 441 call sites; 30 of
  those files have no `rm` at all, and many of the rest remove only on the happy path. A handful of
  helpers under `tests/helpers/` also mkdtemp, but they are a small share.
- **Every one of them asks `os.tmpdir()`**, which on POSIX reads `TMPDIR` on each call, and every
  child process a test spawns inherits the environment unless it is given its own.

## The fix

**One temp root per run, made by the config and removed when vitest exits.** `vitest.config.ts`
already edits `process.env` before any worker exists (the account-routing variables), and workers
and their children inherit it; tests/account-neutral-env.test.ts is the proof the mechanism works.
So:

1. `tests/setup/run-temp-root.ts` exports `makeRunTempRoot()`: `mkdtempSync` a directory
   `syv-<pid>-XXXXXX` under the current `os.tmpdir()`, set `process.env.TMPDIR` to it, and remove it
   recursively on the main process's `exit`.
2. Before making its own, it removes any sibling `syv-<pid>-*` whose pid is no longer alive — the
   runs that were killed (SIGKILL, OOM, a closed terminal) and so never reached `exit`. A live pid,
   ours or a reused one, is left alone: the cost of a mistake that way is one directory kept, the
   other way is deleting a running suite's files.
3. `vitest.config.ts` calls it once, at the top, beside the account-variable scrub.

**The path must stay short.** tsx puts an IPC socket in `TMPDIR` (`tsx-<uid>/<pid>.pipe`), and a
Unix socket path is capped at 108 bytes on Linux, 104 on macOS. The first baseline measurement
here, run with `TMPDIR` set to a session scratchpad, failed the private lane's migrator with exactly
that. So the prefix is short (`syv-`), and the root sits directly under the existing temp dir —
macOS's `/var/folders/…/T/` is ~49 bytes, which leaves room.

### Simpler options passed over

- **Fix each call site** (an `afterAll` rm in 243 files): the "right" local fix, but it is 441
  edits, and the next new test leaks again; a per-run root catches tests that do not exist yet.
- **No stale sweep, rely on the box's 7-day age-out:** that exists only on the box; the Mac has
  nothing. The sweep is ~15 lines.
- **A root-level `globalSetup` teardown instead of `process.on("exit")`:** teardown does not run
  when setup or the config throws, which is exactly when the admission check refuses a run; `exit`
  runs either way.

## What it cannot catch

- A test that writes to a literal `/tmp/...` path (179 lines mention one; most are fake path
  strings in fixtures, not writes — the after-measurement says which, if any, still leak).
- A child spawned with an `env:` that drops `TMPDIR`.
- `npx tsx` scripts outside vitest (`scripts/*` that mkdtemp) — out of scope; they are run by hand.

## Tests

- **Red first:** a unit test, from inside a worker, that `os.tmpdir()` is a `syv-<pid>-` directory
  whose pid is vitest's main process — fails on today's tree.
- `makeRunTempRoot` in a child process: makes the root, writes into it, exits; the root is gone.
  A dead-pid sibling is swept; a live-pid sibling is kept.

## Measurement

One full suite before and after, counting what is left under the temp dir (run with `TMPDIR` at a
fresh short directory so other agents' noise on `/tmp` does not count). Results below.

## After the plan review

GPT Sol's review is [261009a-plan-review-sol.md](261009a-plan-review-sol.md): build with changes.
These override the sections above.

- **The config is evaluated more than once per run.** tests/vitest-worker-caps.test.ts calls
  `createVitest()` with the real config inside a worker, and watch mode reloads it. Each would have
  nested a new root inside the old and added an exit listener. So the root is named in
  `SPIDERYARN_RUN_TEMP_ROOT`; when that equals `TMPDIR`, `makeRunTempRoot()` returns it and changes
  nothing. Only the process that made a root removes it.
- **The dead-pid sweep is dropped.** A dead owner pid does not prove a detached child is not still
  writing, another user's matching directory may be unremovable, and the box already ages `/tmp`
  out at seven days. A killed run now leaves one directory, not thousands.
- **Two tests did write literal `/tmp` paths**, with fixed names that also collide between
  concurrent suites: tests/run-codex.test.ts (`/tmp/unused`, `/tmp/unused-stdin`,
  `/tmp/run-codex-gc.txt`) and tests/run-claude.test.ts (`/tmp/run-claude-env-probe.txt`). Both
  moved: run-codex's into a per-test directory under `tmpdir()`, run-claude's into a shell variable.
- `exit` runs on a passing run, a failing one, a config or setup error, and Ctrl-C/SIGTERM (vitest
  turns those into `process.exit()`); not on SIGKILL, OOM or SIGHUP. Written into the helper's
  header as its limit.
- Socket paths: Sol traced a fleet-child tmux socket path at ~113 bytes under a macOS temp dir —
  over the limit. That path already nests under `tmpdir()` today; the root adds 18 bytes
  (`syv-<pid>-XXXXXX/`). Not reproduced on a Mac; recorded here as the thing to check if a
  fleet-child test fails there with `ENAMETOOLONG` or a socket error.

The code review is [261009a-code-review-sol.md](261009a-code-review-sol.md): land with its fixes
(a stale "sweep" sentence in testing.md, and a test that a nested evaluation leaves the owner's
root alone). It also found two more escapes, both fixed here: tests/skim-cue-pairs.test.ts spawned
`tsx` with an `env:` that dropped `TMPDIR`, and tests/fleet-receipt-journal.test.ts mkdtemp'd under
a literal `/tmp`.

## Results

One full `npx vitest run` on the box, each with `TMPDIR` pointed at a fresh empty directory, so
what is left there afterwards is what the run leaked and nothing from the other agents on `/tmp`:

| | files | left behind (top level) | recursive | size |
|---|---|---|---|---|
| before (dev at fa0d744f7) | 1871 passed, 1 skipped | **674** | 4,160 | 111 MB |
| after | 1872 passed, 1 skipped | **1** (`node-compile-cache`, one fixed name reused by every run) | 538 | 2.6 MB |

The biggest leakers before were `launch-fixture-` (87), `fleet-transcript-` (60), `fake-codex-`
(58), `run-codex-` (52) and `run-claude-` (37). During the 40 minutes of the after-run, 4,154 new
entries appeared at the top of the box's `/tmp` from other trees' suites, still on the old code —
which is the leak, at about the rate the box rebuild measured.

**Seen red first:** the in-worker test (`tmpdir()` is a `syv-<ppid>-` root) failed on the tree
before the config line was added, and Sol confirmed it fails again with the line removed.
