## Findings

- **P3-1 — The feedback note says “shipped” before the change is on `dev`.** The policy defines shipped as landed on `dev`, but the candidate remains uncommitted at the base commit. Update [the status line](/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings/docs/user-feedback/260907_1917-exact-time-and-duration-on-the-step-rows.md:4) when it is pushed.

- **P3-2 — The prose incorrectly says the feature is “two disclosures deep.”** There is one disclosure: `Technical details`; `What we did to it` is an ordinary `h3` inside it. Correct [the feedback note](/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings/docs/user-feedback/260907_1917-exact-time-and-duration-on-the-step-rows.md:32) and [the test comment](/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings/tests/metadata-step-timing.test.tsx:147).

- **P3-3 — The plan’s stage recipe retains names from the abandoned duplicate implementation.** It says `took + formatDuration` in `Metadata.tsx`; the built code is `tookFor` plus shared `howLong`. Update [the plan](/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings/docs/plans/260908a-exact-time-and-duration-on-the-metadata-step-rows.md:136).

No P0, P1, or P2 findings.

The code itself is sound:

- All formatter transitions round consistently; I found no `1000ms`, `60.0s`, or `Nm 60s` path.
- The metadata card cannot reach `an unknown time`: `Wrote` validates the finish, while `tookFor` rejects missing, invalid, and later starts before calling `howLong`.
- A running row remains intentionally silent because it has no finish to display or subtract from.
- `startedAt` is mapped from the correct column. The fenced write path and carry-forward query preserve both stamps from one run.
- No production `StageState` constructor was missed.
- Tweets has no unnamed behaviour change: only subsecond formatting and the corrected 60-second boundary differ.
- Exporting `tookFor` is a reasonable test seam; it keeps the metadata-specific validity decision beside its caller.

The test layering is good. The fixture tests would pass with the feature absent; Tweets tests only protect the shared formatter; pure formatter tests would pass if the card never called it; store tests would pass if the UI were broken. The positive card test and store test close those respective gaps. `cardText` does locate the intended stage tooltip portal.

Verification:

- `25/25` tests passed across the requested two files.
- Typechecking passed via `node --import tsx scripts/typecheck.ts`; the normal wrapper was blocked only by the sandbox’s IPC restriction.
- Targeted Biome reported only existing, unrelated diagnostics in `pg.ts`.

**Verdict: land with these prose changes.**
---

*Reviewed the live pre-commit tree at base `8e78a20e`. That tree became commit `44743fe9`, which
landed on `dev` in `f9bdf3d6` — the three P3s above were applied before it was committed.*
