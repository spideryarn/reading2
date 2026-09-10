Original candidate verdict: **REFUSE**, based on established P1s.  
Current worktree verdict: **ACCEPT after fixes**. No established P0/P1 remains, and nothing was committed.

## Findings

- **F17 — P1, established:** HTTP invented a caller-declared cost.
  - (a) `GET /api/admission?kind=browser&cost=light` returned `request.cost: "heavy"`, although the endpoint ignores `cost` and the wire called it requester-declared.
  - (b) `cost` is now nullable and HTTP returns `null`.

- **F18 — P1, established:** A forecast refusal looked like an actual refused run.
  - (a) Low memory put `REFUSING TO START`, `NO TESTS RAN`, and the dashboard process’s PID in generic `outcome.why`.
  - (b) It is now a distinct `would-refuse` arm with `forecastCallMessage` and `messageContext: "dashboard-forecast-call"`. The Stage 2 brief requires presenting it as raw forecast-call output.

- **F19 — P1, established:** Test-only qualifications leaked onto unrelated outcomes.
  - (a) Browser/review `not-modelled`, `not-applicable`, refusal, and `unknown` responses all carried the worker caveat; non-modelled work also carried the Vitest policy.
  - (b) `AdmissionPayload` is now a discriminated union. Non-modelled responses have no test policy, and the worker caveat exists only on numeric `would-admit`/`would-reduce` outcomes. The four nonnumeric outcomes are separate arms.

- **F20 — P1, established:** Some reader failures escaped or became blank/zero reasons.
  - (a) A throwing memory reader escaped `admissionPayload`; `new Error("")` produced blank `why`; `throw 0` produced `why: "0"`.
  - (b) All three readers now reach `unknown`, and thrown values are normalized to an explicit nonblank reason.

- **F21 — P1, established:** The documented GET route accepted writes as successful forecasts.
  - (a) `POST /api/admission` returned 200 and invoked the admission readers.
  - (b) The route now permits GET/HEAD and returns 405 with `Allow: GET, HEAD` before reading anything else.

- **F22 — P2, reasoned:** Routing errors resembled incomplete admission payloads.
  - (a) The 404 and 500 bodies were `{schema: 1, kind: "unknown", why}`, inviting a loose parser to confuse transport failure with an `unknown` outcome.
  - (b) They now use distinct `{error, why}` envelopes without admission schema or outcome fields.

- **F23 — P1, established:** Policy prose overstated its evidence and duplicated the algorithm.
  - (a) Every v1 response called the conservative fixed allowance a “measured fixed run cost” and restated the subtraction/division rule.
  - (b) The explanation now describes the calibrated model’s purpose without copying its arithmetic.

- **F24 — P1, established:** Unknown-policy prose claimed absent numbers were live.
  - (a) Policy v999 plus a throwing worker reader returned no numeric result while saying “the numbers below are live.”
  - (b) It now says only that policy wording is withheld.

- **F25 — P2, established by mutation:** Production composition could drift undetected.
  - (a) Wiring `policyVersion + 1` or changing the default clock to `() => 0` left the old tests green.
  - (b) Composition tests now assert the injected timestamp, real policy version, and default wall clock. Both mutations were watched fail.

- **F26 — P2, established:** HEAD error paths passed bodies to `res.end`.
  - (a) HEAD requests for a missing suffix or internal failure received body chunks in the handler test, although Node normally suppresses them later.
  - (b) Every HEAD path now explicitly ends without a body.

- **F27 — P3, established:** The plan still marked completed Stage 1 work “not started.”
  - (a) The stage existed in `e4a38579` while all its checklist boxes remained open.
  - (b) The checklist and status now record completion and this review.

## Required sentences

1. **“No threshold, ratio, byte figure or arithmetic rule from the gate is written down a second time…” — accurate after F23.** The explanation now names the calibrated model without restating its arithmetic.

2. **“After any call to `admissionPayload`, `VITEST_MAX_WORKERS` is exactly what it was before…” — accurate.** Present and absent states are tested on success and thrown-reader paths. Removing restoration made the new thrown-reader test fail.

3. **“A request whose `kind` is `review` or `browser` cannot reach `decideAdmission`…” — accurate.** Both `admissionPayload` and `explainAdmission` short-circuit; injected throwing readers and gate spies remain untouched.

4. **“Every way the gate can fail to be asked reaches the wire as `unknown` with a reason…” — accurate after F20/F24.** This includes worker, memory, and reserve reader exceptions. A `broken` memory snapshot remains `would-refuse`, correctly, because the gate was successfully asked.

The discarded `policyFor` lookup on the non-test path is harmless cleanup: no machine reader or gate is reached, and the result is not exposed. The duplicate recomputation is gone.

## Verification

- Four permitted suites: **74/74 passed**
- Direct typecheck: all four projects passed; **1,909 sources covered**
- Biome on changed code/tests: passed
- `git diff --check`: passed
- Full `npm test`: not run
- Port 8787: untouched
- Cross-family review: completed; its additional F24–F26 fixes were inspected and reverified

Changed files:

- [routes-admission.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/routes-admission.ts)
- [wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/wire.ts)
- [fleet-admission-explain.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-explain.test.ts)
- [fleet-admission-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-route.test.ts)
- [admission visibility plan](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md)
- [Stage 2 client task](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-stage2-client-task.md)

The three pre-existing untracked files were not changed.