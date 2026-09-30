No findings.

- `AddPage`: `claimed` is checked before reset, and the deciding effect does not depend on `phase`, so entering `saving` cannot rerun it. StrictMode’s second setup sees the same claimed key and exits. Retry retains the draft, adopts the new job ID, and opens after the save.
- `TrajectoryPurpose`: failures and unmounts release `planning`; success replaces the form with the saved-purpose display. The `live` fence is safe because clicks can only occur after StrictMode’s synchronous setup-cleanup-setup cycle.
- Tests: 46/46 passed.

**Verdict: Approve — C1–C3 are correctly fixed.**