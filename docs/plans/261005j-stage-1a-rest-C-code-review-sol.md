No P0 or P1 runtime defect found. I made prose corrections only; nothing was committed.

- **C1 — P3, established, fixed:** The new comments, docs and test names incorrectly describe the command line as having no queue window. `scripts/stage.ts` uses `advanceJob`, so it receives and drives the extra windows. Direct calls without `window` retain the fallback.
- **C2 — P3, established, fixed:** The arithmetic script’s assumptions still described the root being asked once and claimed stage 1a did not change time or labels behavior. Corrected those explanations. The new formula is correct under its stated independence assumptions; the root contributes a floor of **p²** to the third figure.
- **C3 — P2, reasoned, runtime unchanged:** A required call that always exceeds its cap can repeat in all three windows before producing the same fallback. A hanging slice can therefore take roughly **12 minutes instead of 4**, excluding overhead. I clarified this consequence in the doc. I would distinguish call-cap exhaustion from lease exhaustion in follow-up work; changing that policy exceeds this narrow review because stage C explicitly chooses both as hand-back triggers.
- **C4 — P3, established, not fixed; wider:** Older comments still describe `runJob` and filesystem adapters that no longer exist. These predate the candidate.

The four endings match the deadline branch:

| Ending | Result |
|---|---|
| `requeued` | Same row and draft; counter incremented; step pending without error; reservation remains open. |
| `stale` | No terminal writes by the former claimant; returns the lost-claim response. Calls and checkpoints already recorded remain. |
| `cancelled` | Stop wins; draft discarded; published revision preserved; reservation released. |
| `budget-spent` | Retryable interruption; no fallback publication; draft discarded; reservation released. |

`runStep` keeps the interruption narrative in memory for refused pauses. A successful pause derives clean pending steps from the stored row. It does not call `captureFailure`, report to Sentry, settle as blocked, or commit a structure product. The draft’s running step marker correctly prevents `stepIsDone` from skipping the next attempt.

Postgres is the only production job-store implementation. Its locked pause and expiry paths share `requeues` and `REQUEUE_BUDGET`, so repeated hand-backs are bounded. Keep `!stopped`: it correctly classifies an already-aborted step and avoids an unnecessary pause request, even though the store also protects Stop.

There is no live `runJob` path. The production caller of `generateStructure` is the pipeline; its window comes from the walk that catches the signal. Direct callers without a window cannot throw this signal. During retries, an ordinary first import remains unpublished; an import opened early retains its awaiting tree; an existing article retains its published tree. Queued structure jobs still count as “building,” and publication still controls labels and main-mode successors.

Charging follows the existing deadline settlement path. **The supplied test’s first import has no paid reservation**, so its ledger assertions prove AI-call accounting, not paid-slot settlement. The settlement code nevertheless preserves the reservation on pause and releases it on unsuccessful endings.

Verification: requested tests passed **15/15**; post-edit tests plus doc links passed **31/31**; B1 regression suite passed **50/50**. Typechecking passed via `node --import tsx`; lint reported warnings only. The registry’s subprocess was sandbox-blocked; its scan ran separately, found no registry holes, and confirmed the correct `private-postgres` lane. Postgres evidence is yours; I did not rerun it.

**Verdict: land with the fixes made.**

Files changed: `src/another-window.ts`, `src/pipeline.ts`, `src/structure.ts`, `docs/project/structure-step.md`, `tests/structure-step-another-window.test.ts`, `evals/long-structure/fallback-arithmetic.ts`.