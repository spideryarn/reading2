## Review outcome

The committed candidate is **refused as written**: F9, F10, F11, F12 and F13 are established P1s under your rubric. All five now have red-first fixes in the uncommitted worktree; I found no remaining established P0/P1.

### Findings

- **F9 — P1, established: truncated work looked complete.** `groupsDropped` survived storage and projection but was never rendered.
  - (a) The new test supplies one retained group with `groupsDropped: 2`; at `15ab391f` no omission appears.
  - (b) Render the omitted count beside that scan. Fixed in [WorkHistory.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/WorkHistory.tsx:212).

- **F10 — P1, established: omission records bypassed rotation.** `sample-omitted` used the common writer, but rotation lived only in the ordinary-sample branch. Repeated oversized reports could grow `health.jsonl` without bound.
  - (a) Prefill to just below 8 MiB, then append an oversized report. Candidate result: **8,388,721 bytes**, 113 over the ceiling, with no rotation.
  - (b) Put both line-size and file-size enforcement at the single write boundary. Fixed in [health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health-history.ts:704). This bypass predates the range, although stage 3 modified its call site.

- **F11 — P1, established: the page claimed an exact five-minute cadence.**
  - (a) Render one historical scan; candidate text says “Sampled every five minutes” despite startup sampling and process-local cadence state.
  - (b) State the real scope: approximately five minutes during one uninterrupted run, plus startup. Fixed at [WorkHistory.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/WorkHistory.tsx:51).

- **F12 — P1, established: an oversized health reading discarded work that still fit.** The code degraded `workTurn` before establishing which half of the composite caused the overflow, then reused that degraded value in `sample-omitted`.
  - (a) Append an enormous health reason with a small valid due scan. Candidate stores `checkpoint-unavailable`; the scan fits beside the omission record.
  - (b) First serialize the omission with the original work result, degrading it only if that record remains oversized. Fixed at [health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health-history.ts:840).

- **F13 — P1, established: disk colours and boundary prose disagreed.** Disk becomes amber/red **at** 90/97, but its chart explanation said “past 90 / past 97.”
  - (a) Render a disk reading of exactly 90; candidate text says “past 90.”
  - (b) Carry inclusive/strict boundary semantics in `SeriesSpec`, rather than applying one generic word to every metric. Fixed in [history-series.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/history-series.ts:206) and [HealthHistory.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/HealthHistory.tsx:468).

- **F14 — P3, established: three source claims contradicted the code or evidence.**
  - (a) Source inspection: the policy header called every non-memory boundary inclusive although load is strict; HealthHistory still described four plots; the seed called an unwritten interval “nothing was running.”
  - (b) Correct those comments. All three are fixed; notably the seed now calls it a gap and says the record cannot determine what happened.

## The guarantee’s floor

As committed, the statement is too strong. The failing phrase is **“no reading exists.”** In F12 a reading did exist but was unnecessarily discarded; in F9 a bounded scan omitted groups without saying so.

This is accurate after the fixes:

> Every displayed scalar and exact count comes from a retained reading. When a reading is missing or was discarded, the display states that fact or leaves a gap. A successful work scan says that its retained groups were observed at its own `scannedAt`; if lower-ranked groups were dropped, it says how many. It makes no claim about the health sample’s instant or the interval between samples. Repeated carriers of one source timestamp count as one observation.

That wording should be scoped to live-produced history; synthetic seeded data is not measurement evidence.

## The specific doubts

1. **Restart cadence:** acceptable. A restart writes another honest point observation, and rotation still bounds the file. A crash loop is a louder operational failure. The exact UI cadence claim was nevertheless false and is fixed by F11.

2. **Seeded `not-due`:** it is less misleading than an empty successful scan or legacy absence because it does not claim idle work, but twenty hours of it still invents a scheduling history. A dedicated synthetic/unmodelled state would be cleaner if seed fidelity matters; I did not widen the production union for a demo fixture.

3. **Borrowed `checkpoint-unavailable`:** its name is narrower than its documented contract, but the contract explicitly includes a scan the store could not accept, and the displayed reason names the size rejection. That use is truthful. F12 was the real defect: carrying that fallback into an omission record where the original scan fit.

4. **`currentWork`:** genuinely live, not history-derived. The composition test starts at `statePayload(readCheckpoint().work)`, crosses parsing and `App`, and renders against empty history. The inverse test supplies historical work with no live checkpoint. Together with your mutation, this proves the thread rather than merely a prop.

5. **Disk:** numeric drawing and tile tones agree at 90 and 97. Candidate wording did not; F13 now preserves “past” for strict load/memory boundaries and “at” for inclusive swap/disk/IO boundaries.

**F4:** the 4 KiB projection limit measures exact UTF-8 bytes of its JSON value. The envelope is separately covered by the exact serialized full-line limit. The stronger rotation test constructs 1,440 actual `sampleLine` records, including 288 due work records and their envelopes. F10 was a separate write-path bypass, now closed.

**F7:** the three-arm timing union is the better design. “Known among 5 of 6 jobs” preserves measured evidence while explicitly counting the unknown job. Nulling both aggregates would erase valid measurements without making the result more truthful.

## Verification

- Focused health/work suites: **149 passed**
- End-to-end current/history and disk-boundary tests: **3 passed**
- All three TypeScript projects: **exit 0**
- `git diff --check`: clean
- Lint: my changed logic/tests are clean. Whole touched-path lint still reports the pre-existing `noArrayIndexKey` at `HealthHistory.tsx:560`; that code was not changed.
- No commit made.

Files I changed:

- [tests/fleet-health-history.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-health-history.test.ts:849)
- [tests/fleet-web.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-web.test.tsx:1905)
- [tests/fleet-work-history.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-work-history.test.tsx:140)
- [tools/fleet/health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health-history.ts:704)
- [tools/fleet/resource-policy.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/resource-policy.ts:59)
- [tools/fleet/seed-health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/seed-health-history.ts:68)
- [tools/fleet/web/src/HealthHistory.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/HealthHistory.tsx:9)
- [tools/fleet/web/src/WorkHistory.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/WorkHistory.tsx:51)
- [tools/fleet/web/src/history-series.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/history-series.ts:195)

The already-modified `docs/plans/260910a-code-review-prompt.md` was not mine and was left untouched.