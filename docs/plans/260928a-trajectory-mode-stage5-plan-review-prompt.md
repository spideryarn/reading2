# Plan review — Trajectory stage 5 (plan 260928a)

You are reviewing a **plan**, read-only. Do not change any file. Candidate: commit `fffa54cc` on
branch `worktree-trajectory-flash-position-0928`; the plan text is the section **"Stage 5 — flash,
position, order, promotion, regenerate, and the card's sources"** at the end of
`docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md` (`git show fffa54cc`).

Background: Trajectory mode (docs/project/trajectory.md) is built (v1 + v2 on dev). Greg asked for
six more things, quoted verbatim at the top of the section.

Start with these, but do not limit yourself to them:

- `src/web/flash.ts`, `src/web/keynav.ts` (`beginJump`), `src/web/scroll.ts` (`scrollToBlock`)
- `src/web/modes/trajectory/TrajectoryMode.tsx`, `src/web/TrajectoryPanel.tsx`,
  `src/web/useTrajectory.ts`, `src/web/useStepJob.ts`, the auto-run hook, `src/web/activation.ts`
- `src/web/Dock.tsx` (`MODES_UI`), `src/mode-catalog.ts`, `src/web/visitor.ts`,
  `docs/project/experimental-features.md`, `docs/project/new-mode.md`
- `src/web/stop-card.ts`, `src/web/useIdeas.ts`, `useFaq.ts`, `useTimeline.ts`, `useGlossary.ts`
- the job route and `enqueue` in `src/jobs.ts`, `stepIsDone`, and whatever limits how many jobs
  an owner may have queued (docs/project/billing.md)

## What to attack

1. Is anything in the plan false about the code (a claimed existing mechanism that does not exist
   or does not behave as described)?
2. 5a: does every step path (‹ ›, ← →, row press, door, go round again, depth change that moves,
   deep link on load) actually reach a flash with the plan's approach, exactly once, and not while
   the band covers the prose on a narrow window? Any double flash (a row press already goes through
   `beginJump`)?
3. 5d: which of the three cases (no Quotes, a Quotes run in flight, stale Quotes) actually breaks
   today? Reason from the code: e.g. does `enqueue` dedupe a `quotes` job in flight against a
   `["quotes","trajectory"]` job, and does a stale-Quotes route get planned on the stale set?
4. 5f: after promotion, can a non-owner (shared link, public shelf) trigger a paid run by any path?
   What else did `experimental: true` gate beyond the button (command bar, auto-run, last-view)?
5. 5g: is queueing the card's sources as separate unforced jobs on the first automatic open the
   simplest correct design? Concurrency or limits on several jobs per article? Does each read hook
   actually revalidate when another hook's job finishes, or does the card stay empty until reload?
   Is "only on the automatic first run" well defined given the auto-run hook?
6. Anything simpler that gets Greg most of what he asked for.

Severity: P0 data loss / security / incorrect charging / broadly unusable; P1 user-visible wrong
behaviour or a contract violated; P2 design risk, nothing wrong today; P3 prose. Give every finding
an ID starting at **F28**, a severity, the evidence (file:line), and a concrete fix. End with a
verdict: approve / approve with changes / rethink.

## My own suspicions (already mine, worth less — spend most of the run elsewhere)

- 5g's "read hooks revalidate when a job for their step finishes" may be false: the read-only hooks
  were split out precisely to have no job machinery.
- The flash on a narrow window: the band steps aside (`band-away`) on a row press but not on ‹ ›.
