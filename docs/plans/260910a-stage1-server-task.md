# Task: Stage 1 — the server side of admission visibility

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree),
branch `worktree-admission-visibility`. TypeScript + ESM, `tsx` to run, vitest to test. Node 22.

**Read first, in this order:**

1. `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md` — the plan.
   It is the spec, and its §§1–6 are the design decisions you are implementing. Read all of it.
2. `docs/plans/260910a-admission-visibility-plan-review-sol.md` — your own review of that plan, and
   the plan's "Review dispositions" section, which says which findings were taken. **The plan text
   as it stands now wins over anything in the review that was not taken.**
3. `vitest-admission.ts` — the gate. **You do not change this file.**
4. `tools/fleet/routes-health-history.ts` and `tools/fleet/health-wiring.ts` — the structural
   exemplars. Copy their shape: a payload function that is pure given its deps, an exactly-matched
   path, a composition root in its own module so a test can drive the same function `server.ts`
   calls.
5. `docs/project/fleet-dashboard-modes.md` — house rules for anything on this dashboard. The
   sections that bind you: *Where the panel's data comes from*, *Absence is stated, never drawn*,
   *The test*.
6. `docs/reusable/silent-success.md` — the standing rule about checks that cannot fail.

## What to build

Only the server half. **No client files in this stage** (`tools/fleet/web/` is Stage 2).

### `tools/fleet/wire.ts` — types only, appended at the end

Re-read the file immediately before editing it; three other sessions are live in `tools/fleet/`
tonight and it must merge cleanly. **Types only — no runtime values, no imports.** That is this
file's hard rule and `tests/fleet-compile-guards.test.ts` enforces parts of it.

Add the request shape from plan §5 (`AdmissionKind`, `AdmissionCostClass`, `AdmissionOwner`,
`AdmissionRequest`) and the payload shape: an outcome union of exactly the five outcomes in plan §1's
table, the policy pair from §2, the enforcement label from §3, the replay summary from §6, and a
`schema: 1`. **Do not add anything to the pushed `FleetState` payload** — this route is on-demand,
and an optional top-level key on the pushed type is refused by `fleet-compile-guards`.

### `tools/fleet/routes-admission.ts` — the route

`ADMISSION_PATH = "/api/admission"`. Export, and keep pure:

- `parseAdmissionRequest(url: string, nowMs: number): AdmissionRequest` — reads `kind`, `cost`,
  `session`, `worktree`, `pid` from the query string. Unrecognised or missing values take the
  documented defaults (`kind=test`, `cost=heavy`), never throw, never NaN. A `pid` that is not a
  positive integer is `null`, not `0`.
- `explainAdmission(deps)` — the whole decision, given values a test hands in: the memory snapshot,
  the reserve (as a result, see below), the nominal worker count, the gate's policy version, and the
  request. It calls `decideAdmission` from `../../vitest-admission.js` and maps its union onto the
  five outcomes. **No threshold, ratio or byte figure may be written in this file.** Every number
  on the payload comes out of the gate's return value or its message string.
- `replayRefusals(samples, deps)` — plan §6. Pure over already-read samples.
- `admissionPayload(deps, request)` — composes the above, including reading the history store.
- `admissionRoute(deps)` — `{ handle(req, res): boolean }`, exact path match with the 404 arm and
  the try/catch 500 arm that `routes-health-history.ts` has, for the same reasons it gives.

Reading the machine (`readReserveBytes`, `readMemorySnapshot`, `resolveParallelWorkers`) happens in
the *deps*, not inside the pure functions, so tests hand values in.

**`readReserveBytes` and `resolveParallelWorkers` throw** — on an empty, unreadable or non-numeric
file. That is the `unknown` outcome in plan §1, and it is the one arm you have to construct yourself
rather than get from the gate. Catch narrowly, at the read, and carry the error's message into the
payload's `why`. A thrown error must never reach the response as a blank or as a healthy value.

**`resolveParallelWorkers` has a side effect: it deletes `process.env.VITEST_MAX_WORKERS`.** Read
`scripts/readiness-loop.ts`'s `nominalWorkers()` — it puts the variable back for exactly this reason,
and its comment explains why. Do the same, and say why in a comment that cites that precedent. A
dashboard that silently ate an agent's env var would be a real bug and a very quiet one.

### `tools/fleet/admission-wiring.ts` — the composition

One exported function that builds the deps and the route, so a test drives the same function
`server.ts` calls. `health-wiring.ts`'s header says why this file has to exist and what the test
that did *not* catch a dead feature looked like; read it before writing this.

It takes the already-open health history store (the one `makeHealthRetention` produced) rather than
opening a second one.

### `tools/fleet/server.ts` — the mount

One line beside the existing `retention.route.handle(req, res)` call (~line 716) and one composition
call beside `makeHealthRetention` (~line 170). Nothing else in this file. Re-read before editing.

## The tests — red first, every one of them

New files: `tests/fleet-admission-explain.test.ts`, `tests/fleet-admission-route.test.ts`.
Do not add cases to another session's test file.

The four the roadmap asks for by name, plus the ones the plan's own design needs:

1. **Low available memory** → `refused`, and the payload carries the gate's own message, including
   the `NO TESTS RAN AND NOTHING WAS VERIFIED` sentence. Assert against the gate's output, not
   against a string you typed.
2. **Missing probe** — `/proc/meminfo` unreadable on an opted-in Linux box → **`refused`**, not
   `unknown`, carrying the broken-check reason. Plan §1 explains why this is deliberate; a test that
   asserted `unknown` here would be asserting the opposite of the design.
3. **Concurrent visible jobs** — several attribution groups present. (Stage 1's half of this is that
   the payload does not claim anything about jobs it cannot see; the rendering is Stage 2.)
4. **Policy version mismatch** — the gate's version differs from `EXPLAINED_POLICY_VERSION`, and the
   payload says the explanation was written for the older one. This must be reachable from a test
   without editing the gate: pass the gate's version in as a dep.
5. `reduced` when capacity is below the nominal worker count, and `admitted` when it is not.
6. No reserve file → `not-applicable`; empty or garbage reserve file → `unknown` with the thrown
   message; a bad worker-count file → `unknown` likewise.
7. Each of `kind=test|review|browser` gets the right enforcement label, and the review/browser
   answers state in words that nothing consults them.
8. `parseAdmissionRequest` on: no query string, an unknown `kind`, an unknown `cost`, `pid=abc`,
   `pid=-1`, and a `pid` that is fine.
9. The replay over a fixture history that contains a reading, a gap, a `collector-failed` line, a
   `sample-omitted` line, and a sample whose `memory` reading is `kind: "unknown"`. **None of those
   may become a healthy value or a zero**, and the summary must distinguish *observed and would not
   have refused* from *not observed*.
10. The route: exact path match (`/api/admission/x` is a 404, `/api/admission?kind=test` is not),
    and the 500 arm.
11. A **comment-stripped** source guard on the `server.ts` mount. `fleet-dashboard-modes.md` § The
    test explains why the naive version passes with the mount commented out — strip comments, and
    check it goes red by commenting the mount out before you rely on it.
12. A wiring test that drives `admission-wiring.ts`'s exported function, and would go red if the
    server built a second store or passed a different directory.

**Every test must have been red before it was green.** Write the test, run it, see the failure, then
write the code. Where you cannot make a test red because the code does not exist yet, that counts —
what does not count is a test written after the code that was never observed failing.

## What you may and may not touch

**You may edit this worktree.** Files in scope: `tools/fleet/wire.ts` (types only, appended),
`tools/fleet/routes-admission.ts` (new), `tools/fleet/admission-wiring.ts` (new),
`tools/fleet/server.ts` (two lines), `tests/fleet-admission-*.test.ts` (new), and a fixture directory
under `tests/fixtures/` if the replay test needs one.

**Do not touch:** `vitest-admission.ts`, `vitest.config.ts`, `tools/fleet/collect.ts`,
`tools/fleet/routes-actions.ts`, `tools/fleet/routes-new.ts`, `tools/fleet/health.ts`,
`tools/fleet/health-history.ts`, `tools/fleet/health-wiring.ts`, anything under `tools/overseer/`,
`scripts/gjd-remote.ts`, `scripts/claude-accounts.ts`, the readiness files, or anything under
`tools/fleet/web/`. If the stage genuinely cannot be done without one of them, **stop and say so** in
your answer rather than editing it.

**Do not commit.** I read the diff and commit.

**Do not start, restart or connect to the fleet dashboard on port 8787.** It is live and other
people depend on it.

## Running things

- Focused: `npx vitest run tests/fleet-admission-explain.test.ts tests/fleet-admission-route.test.ts`
- Typecheck: `npm run typecheck` — judge it by its **exit code**; it writes `✓` to stdout and `✗` to
  stderr, and its last two lines are always `✓`, so a tail or a stdout-only capture reads clean over
  a red run.
- Do **not** run the full `npm test` — it takes ~26 minutes on this shared box and I will run it.

## At the end

List every file you changed, and for each test say what you saw it fail with before it passed. Say
explicitly whether you had to leave anything in the plan unimplemented, and why.
