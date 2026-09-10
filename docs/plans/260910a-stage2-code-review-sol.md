Review and in-scope fixes are finished. `fe5d78a9` is **REFUSE as committed** because six established P1s were reproduced. The corrected, uncommitted working tree has no open P0/P1 from this pass.

## Findings

- **F28 — P1, established.**  
  (a) A valid `would-refuse` payload with `computedAtMs: 1e300` became browser-owned `no-answer`, discarding the outcome.  
  (b) Make the timestamp nullable independently of the outcome and render the answer as undated.

- **F29 — P1, established.**  
  (a) With `health: null`, opening Box health made zero forecast requests and rendered no admission section.  
  (b) Keep the independently fetched admission section mounted outside the health-data conditional.

- **F30 — P1, established.**  
  (a) Mounting under the production `StrictMode` made two forecast calls.  
  (b) Coalesce an API’s pending forecast in a `WeakMap`; each mount retains its own unmounted-state guard.

- **F31 — P1, established.**  
  (a) `would-reduce` said the gate “would ask the config” for workers—the control flow is the reverse—and both worker outcomes could read as settled worker counts.  
  (b) Say the gate answers the machine-default request and the config asks Vitest for the returned count.

- **F32 — P1, established.**  
  (a) With the browser five minutes ahead, Box health said its times were corrected while the forecast printed the uncorrected server time.  
  (b) Pass the already-measured skew into the section and use the shared clock-shift helper.

- **F33 — P1, reasoned.**  
  (a) `would-admit`, `would-reduce`, and `would-refuse` used the page’s live green/amber/red status language; `not-modelled` used idle grey. Colour therefore implied a current incident or reassurance before the forecast wording was read.  
  (b) Give forecasts a neutral label and `not-modelled` the established unknown treatment.

- **F34 — P2, reasoned.**  
  (a) A withheld policy explanation had the same faint styling as valid policy prose, while its client type permitted both explanation fields to be null.  
  (b) Restore the discriminated policy union and render withheld policy as an explicit violet “Policy explanation unavailable” warning.

- **F35 — P1, established.**  
  (a) A readable HTTP 500 rendered “This browser never got an answer it could read,” attributing a server failure to the browser.  
  (b) Discriminate browser-owned and server-owned `no-answer` states and render each in its own voice.

## The four statements

1. **Accurate.** Every valid arm states its outcome or named absence; none manufactures a zero, blank number, or empty bar.
2. **Inaccurate in the candidate; accurate after F28 and F35.**
3. **Accurate.** The raw message is immediately introduced as output from the dashboard’s forecast call, with its imperative wording and PID explicitly attributed to that call.
4. **Inaccurate in the candidate; accurate after F29 and F30.** The existing `alive` guard already prevented stale state writes, but null health caused zero requests and StrictMode caused two.

On your suspicions: 1 and 2 were F33; 3 is accurate transitive shorthand and remains unchanged; 4 was a real presentation/type risk, fixed as F34.

Verification:

- Required suites: **452 passed**
- Sandbox-safe typecheck: **all four projects passed; 1,912 source files covered**
- Targeted lint: no errors in the admission section/client/tests
- Including `HealthPanel.tsx` reports only its pre-existing array-index-key error at line 121
- No full test run, browser access, dashboard access, or commit

Changed files:

- [AdmissionSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/AdmissionSection.tsx)
- [admission-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/admission-client.ts)
- [HealthPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/HealthPanel.tsx)
- [fleet-admission-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-panel.test.tsx)