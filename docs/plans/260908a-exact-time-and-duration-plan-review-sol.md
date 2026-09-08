## Findings

- **P1-1 — The touch ruling is wrong.** [`mouseOnly: false`](/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings/src/web/Tooltip.tsx:175) allows Floating UI’s hover logic to react to touch; it does not make the card persist after a tap. The touch sequence includes `mouseenter`, then `mouseleave`, then `click`; `mouseleave` closes the uncontrolled tooltip before the no-op click. The repo’s own comment says exactly this. Floating UI documents only that `mouseOnly: false` permits touch/pen input, while the Pointer Events specification puts `mouseleave` before `click`. [Floating UI](https://floating-ui.com/docs/usehover), [Pointer Events](https://w3c.github.io/pointerevents/#mapping-for-devices-that-do-not-support-hover)

  The exact time is therefore reachable by mouse and keyboard, but not reliably by a finger. Since the duration will exist only in that card and iPad use is an explicit product concern, it is worth fixing here. Make this particular trigger explicitly press-open—controlled state plus a non-mouse press handler, with `Tooltip`’s controlled `mouseOnly` behavior preventing compatibility hover events from undoing it. This is one-tap reveal, not reveal-then-commit, because the button has no other action. Verify it with a real CDP touch event, not jsdom.

- **P2-1 — The tests stop short of the new store seam and carry-forward contract.** The proposed component tests can pass with a fabricated `startedAt` even if [`articleMetadata`](/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings/src/store/pg.ts:2821) maps the wrong column. Add a database-level assertion that metadata exposes the stored `startedAt`, and extend the carry-forward test to assert that both timestamps survive unchanged. Also document `startedAt` beside `ranAt` in `StageState`, including its null and carry-forward meanings.

- **P2-2 — Malformed and rounding-boundary cases are unspecified.** An invalid `startedAt` should suppress only the duration, leaving the valid exact finish time visible. Pin formatter boundaries such as `999 ms`, `59,999 ms`, and `60,000 ms`; naïve `toFixed(1)` otherwise produces `60.0s`.

## Direct answers

1. The exact-time tooltip already exists structurally: every relative time rendered by [`Wrote`](/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings/src/web/Metadata.tsx:2815) is inside that same tooltip. Missing or invalid `ranAt` renders neither, correctly. Stale/carried rows with a finish time still show “last wrote” and the card. Touch is the sole accessibility exception described above.

2. The timestamps cannot become accidentally paired across runs through the current paths:

   - `beginStepRun` overwrites `startedAt` and clears `finishedAt`.
   - `finishStepRun` is fenced by revision, step, attempt, and `running` status.
   - Carry-forward copies both columns from one MVCC row in one `INSERT … SELECT`.
   - `recordStepRun` replaces both fields together; omitted fields become null. It currently has no production callers.

   The schema does not prove callers supplied a truthful pair, but nothing currently splices one run’s start onto another’s finish.

3. A carried duration is not a new lie. The copied step-run row is provenance for the carried artefact; `ranAt` already reports that previous run. The duration describes the same recorded run. “That run took 8.4s” would make this especially explicit, but is not required.

4. Touch behavior belongs in `tooltips.md`/`touch.md` if changed. The timestamp contract belongs in the `StageState` and store comments. `copy.md` does not own this non-error prose.

The duplicate `exactly()` functions do not bear on this change: Metadata deliberately gives seconds and a zone, while `relative-time.ts` gives medium-date/short-time precision.

**Verdict: build with these changes.**
---

*Reviewed the plan doc before any code existed. P1-1 (touch) was overruled on measured evidence —
the plan's § What we checked has the captured event stream and the one contaminated run that agreed
with Sol. P2-1 and P2-2 were taken. The work landed on `dev` in `f9bdf3d6`.*
