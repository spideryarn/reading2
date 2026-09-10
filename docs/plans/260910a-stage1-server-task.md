# Task: Stage 1 — the forecast and the wire

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree),
branch `worktree-admission-visibility`. TypeScript + ESM, `tsx` to run, vitest to test. Node 22.

**Read first, in this order:**

1. `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md` — the plan, and
   the spec for this task. **Read all of it, including both "Review dispositions" sections**, which
   say what two rounds of review changed and why. The plan text as it stands wins over anything in
   either review that was not taken.
2. `vitest-admission.ts` — the gate. **You do not change this file.**
3. `vitest.config.ts` § `workersForThisRun` — the one place the gate is enforced, and the source of
   the `--maxWorkers` caveat the payload has to carry.
4. `tools/fleet/routes-health-history.ts` and `tools/fleet/health-wiring.ts` — the structural
   exemplars. Copy their shape: a payload function pure given its deps, an exactly-matched path, and
   a composition root in its own module so a test drives the same function `server.ts` calls.
5. `docs/project/fleet-dashboard-modes.md` §§ *Where the panel's data comes from*, *Absence is
   stated, never drawn*, *The test*.
6. `docs/reusable/silent-success.md`.

## Scope: this stage is the forecast only

Stage 1 builds §1, §2, §3 and §5 of the plan. **Not** §4 (the census), **not** §6b (the journal),
**not** §7's repeating task — those are later stages and their types need not exist yet. No client
files: `tools/fleet/web/` is Stage 2.

### `tools/fleet/wire.ts` — types only, appended at the end

Re-read the file immediately before editing; other sessions are live in `tools/fleet/` and it must
merge cleanly. **Types only — no runtime values, no imports.** Add:

- `AdmissionKind`, `AdmissionCostClass`, `AdmissionRequest` exactly as §5 gives them, including
  `owner: ExecutionToken | null` (the type is already in this file — reuse it, do not introduce a
  raw-pid ownership vocabulary) and `requestedAtClientMs: number | null` documented as diagnostic
  only and never sorted on.
- The forecast payload: `schema: 1`, the five outcomes of §1's table under the names
  `would-admit` / `would-reduce` / `would-refuse` / `not-applicable` / `unknown`, the policy pair of
  §2, and the label of §3 — whose values are `forecast`, `observed`, `not-modelled`, and **never
  `enforced`**.

**Do not add anything to the pushed `FleetState` payload.** This route is on-demand, and an optional
top-level key on the pushed type is refused by `tests/fleet-compile-guards.test.ts`.

### `tools/fleet/routes-admission.ts`

`ADMISSION_PATH = "/api/admission"`. Exported and pure:

- `parseAdmissionRequest(url, nowMs)` — reads `kind` only. **`cost` is not accepted by the
  endpoint** (§5): it is on the type for the next stage, and a query parameter that cannot change
  the answer is not offered. Unknown or missing `kind` defaults to `test`. Never throws, never NaN.
- `explainAdmission(deps)` — the whole decision over values a test hands in: the memory snapshot,
  the reserve, the nominal worker count, the gate's policy version, and the request. It calls
  `decideAdmission` from `../../vitest-admission.js`. **No threshold, ratio or byte figure may be
  written in this file** — every number comes from the gate's return value or its message.
- `admissionPayload(deps, request)` and `admissionRoute(deps)` — `{ handle(req, res): boolean }`,
  exact path match with the 404 arm and the try/catch 500 arm `routes-health-history.ts` has.

Four things that are easy to get subtly wrong, all of them findings from the reviews:

- **`kind=review` and `kind=browser` answer `not-modelled` and must not reach `decideAdmission`.**
  Passing them through a vitest cost model gives a small review and a large browser job the same
  advice off a test suite's arithmetic. A test should assert the gate is not called for them.
- **The nominal worker count must not eat the dashboard's environment.** `resolveParallelWorkers()`
  deletes `VITEST_MAX_WORKERS`. Save and restore it around the call, exactly as
  `scripts/readiness-loop.ts`'s `nominalWorkers()` does, and cite that precedent in a comment. The
  reported number is **the machine's default ask**, and the payload says so — a future run's shell
  may set its own.
- **The policy explanation is a version-indexed map that fails closed** (§2). An unrecognised
  `ADMISSION_POLICY_VERSION` yields no prose and a payload saying the wording is withheld; the
  numbers stay, because they come from the gate. Take the version as a dep so a test can supply an
  unknown one without touching the gate.
- **`readReserveBytes` and `resolveParallelWorkers` throw** on an empty, unreadable or non-numeric
  file. That is the `unknown` outcome, and it is the one arm you construct rather than receive.
  Catch narrowly at the read and carry the message into the payload's `why`. A throw must never
  reach the response as a blank or as a healthy value.

### `tools/fleet/admission-wiring.ts`

The composition, so a test drives the same function `server.ts` calls. Read `health-wiring.ts`'s
header first — it exists because a join test that built its own deps would have stayed green while
the server wired something else. No timer in this stage; just the deps and the route.

### `tools/fleet/server.ts`

The mount, beside the existing `retention.route.handle(req, res)` call (~line 716), and the
composition beside `makeHealthRetention` (~line 170). Nothing else in this file. Re-read first.

## The tests — red first, every one

New files: `tests/fleet-admission-explain.test.ts`, `tests/fleet-admission-route.test.ts`. Do not
add cases to another session's test file.

1. Low available memory → `would-refuse`, carrying the gate's own message including
   `NO TESTS RAN AND NOTHING WAS VERIFIED`. Assert against the gate's output, not a string you type.
2. Unreadable `/proc/meminfo` on an opted-in Linux box → **`would-refuse`**, not `unknown`, with the
   broken-check reason. §1 explains why; a test asserting `unknown` here asserts the opposite of the
   design.
3. No reserve file → `not-applicable`. Empty or garbage reserve file → `unknown` carrying the thrown
   message. A bad worker-count file → `unknown` likewise.
4. Capacity below the nominal ask → `would-reduce`; capacity at or above it → `would-admit`.
5. An unrecognised policy version withholds the prose and keeps the numbers.
6. `kind=review` and `kind=browser` → `not-modelled`, and `decideAdmission` is not called (inject a
   spy or a throwing stub — this is the assertion that catches a future refactor re-wiring them).
7. `VITEST_MAX_WORKERS` is present in `process.env` after a forecast, and two successive forecasts
   agree. Both must have been red against a version that calls `resolveParallelWorkers()` naively.
8. No field on any payload is the string `enforced`, and the forecast carries the `--maxWorkers`
   caveat sentence.
9. `parseAdmissionRequest` on: no query string, unknown `kind`, `cost` supplied (ignored), junk.
10. The route: exact path match — `/api/admission/x` is a 404, `/api/admission?kind=test` is not —
    and the 500 arm.
11. A **comment-stripped** source guard on the `server.ts` mount. `fleet-dashboard-modes.md` § The
    test explains why the naive version passes with the mount commented out. **Comment the mount out
    and watch your guard go red before you rely on it.**
12. A wiring test that drives `admission-wiring.ts`'s exported function and would go red if the
    server built its own deps instead.

**Every test must have been red before it was green.** Report what each failure looked like.

## What you may and may not touch

**You may edit this worktree.** In scope: `tools/fleet/wire.ts` (types only, appended),
`tools/fleet/routes-admission.ts` (new), `tools/fleet/admission-wiring.ts` (new),
`tools/fleet/server.ts` (two lines), `tests/fleet-admission-*.test.ts` (new).

**Do not touch:** `vitest-admission.ts`, `vitest.config.ts` (its turn is Stage 3),
`tools/fleet/collect.ts`, `routes-actions.ts`, `routes-new.ts`, `health.ts`, `health-history.ts`,
`health-wiring.ts`, `actions.ts`, anything under `tools/overseer/` or `tools/fleet/web/`,
`scripts/gjd-remote.ts`, `scripts/claude-accounts.ts`, or the readiness files. If the stage cannot
be done without one, **stop and say so** rather than editing it.

**Do not commit.** I read the diff and commit.

**Do not start, restart or connect to the fleet dashboard on port 8787.** It is live.

## Running things

- Focused: `npx vitest run tests/fleet-admission-explain.test.ts tests/fleet-admission-route.test.ts`
- Typecheck: `npm run typecheck` — judge by its **exit code**. It writes `✓` to stdout and `✗` to
  stderr and its last two lines are always `✓`, so a tail or a stdout-only capture reads clean over
  a red run.
- Do **not** run the full `npm test` — ~26 minutes on this shared box. I run it.

## At the end

List every file you changed. For each test, say what you saw it fail with before it passed. Say
explicitly whether anything in the stage's scope is unimplemented, and why.
