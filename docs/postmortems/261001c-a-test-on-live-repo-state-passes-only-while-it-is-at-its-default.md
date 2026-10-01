# A test on live repo state passes only while that state is at its default

**Found 2026-10-01 ~23:10 by the deploy's own test gate, which refused the deploy. Nothing reached a
reader: production stayed on `e5f60a227`. What it cost was one blocked deploy and the time to fix
the test.**

## What happened

`npm run changelog:prepare` ran for real for the first time and committed a release to
`src/web/changelog-pending.json` on dev (`c8389cf83`). The deploy gate's `npm test` then failed five
tests in `tests/changelog-runner.test.ts > plan`, all with the same message where each expected its
own:

```
expected [Function] to throw /no git sha/ but got 'src/web/changelog-pending.json holds a release —
promote it, or write it as null, before plan --deploys'
```

Log: `logs/deploy/2026-10-01T22-08-09-705Z-c8389cf8-test.log` in the primary checkout.

## The root cause

`plan --deploys` refuses while the pending file holds a release (`scripts/changelog/changelog.ts`,
in `main`). Its path comes from `--pending-file`, which **defaults to
`<repoRoot()>/src/web/changelog-pending.json`** — the committed one in whichever checkout runs the
suite. The test helper `planWork` built a fixture work dir, deploy list and history, and passed each
by flag, but not the pending file. So every `plan` test read that checkout's real pending file; in
the deploy gate, that was the gate worktree's copy of dev.

That file has two normal states, by design: `null` between deploys, and a release from
`changelog:prepare` until the deploy ships it. The plan tests and their explicit `--file` fixture
landed earlier in `49f060305`; there was no pending file or flag then. `1c6769f45` (261001q, "the
release notes are written before the deploy, so they ship in it") introduced the pending file, the
default path and the guard, but left the existing helper unchanged. The file was `null` when that
commit landed, and nothing changed it until the process ran for real. That process makes a non-null
pending file a normal pre-deploy state, so the next suite run in that state — the deploy gate — sent
all five tests through the new early refusal.

## A test on live repo state passes only while that state is at its default

The class: **a test reaches a mutable, committed file through a default path, and its assertion
holds only for the value the file had when the test was written.** It stays green until the file
takes another legitimate value. Here that was the day the new workflow was first used. It looks
hermetic because every *other* input is a fixture; the one it forgot is invisible because its
default lives in the code under test, not in the test.

It is distinct from the deliberate kind. `tests/changelog-file.test.ts` reads the real
`changelog-versions.ndjson` and `changelog-pending.json`; `tests/fleet-deploys.test.ts` and the
composition checks in `tests/fleet-deploys-route.test.ts` read the real versions file. They do so on
purpose to catch parser or wiring drift, and their assertions survive the files' normal state
changes. The question that separates the two: *is this assertion true for every state the file is
allowed to be in?*

The sweep for siblings found no other value-sensitive default-path dependency. `plan --upcoming`
passes a fixture history and does not read the pending file; the runner's `write` calls refuse on
their missing argument before repo discovery, while the direct write and promote tests pass scratch
paths or explicit texts. The plain-words wiring test passes a scratch `--work`, and `copy-inputs`
reads neither default changelog file. The deploy-gate tests call pure functions from
`deploy-checks.ts`, while the tests that mention `deploy.ts` inspect its source rather than running
it. No test executes changelog or deploy code against default `logs/changelog` or `logs/deploy`
paths.

## Why nothing went red

- **The tests were green at commit time**, because the file was `null` then. A test whose input
  never varies cannot show that it depends on it.
- **The 261001q diff changed the command but not its existing caller in the tests.** The dependency
  was an omitted flag in an unchanged helper, so the absence did not appear in the diff.
- **The gate did go red** — and that part worked: it refused the deploy. The defect is that the
  first run to exercise the other normal state was the last place before production.

## What would have caught it, ranked by ease against value

1. **The fixture passes every path flag the command reads** — done: `planWork` writes its own
   `pending.json` and passes `--pending-file`. A new test, `refuses while the pending file holds a
   release`, pins the guard itself against a fixture (it had no test), and was watched red with the
   guard disabled.
2. **When a test calls a CLI's `main()`, list the files that command reads by default, and check
   each is either a flag in the test or read by an assertion that holds for every valid value.** A
   habit, free, and aimed at the class: defaults that resolve under `repoRoot()` are where it hides.
3. **Run the suite once with each workflow-written file in its other state** before landing a
   workflow that writes one (here: a release in the pending file, then `npm test`). Cheap, once, at
   the plan stage. Worth a line in the plan-writing guide if the class recurs.
4. A global vitest setup that points `repoRoot()` at a temp copy — rejected. These tests need the
   real history (ancestry checks on real shas), and the deliberate drift checks need the real files;
   it would trade this class for a larger one.
5. Making `--pending-file` required — rejected. It changes production behaviour to suit a test, and
   the default is right for every real caller.

## The fix that is right for the long term

The patch here is the right long-term fix: the command already took the path as a parameter, so the
test now passes it. No production code changed.

## The thing I would tell myself

When a helper builds a fixture for every input but one, the one it skipped is the one the test
depends on. Read the command's flag list, not the helper's.
