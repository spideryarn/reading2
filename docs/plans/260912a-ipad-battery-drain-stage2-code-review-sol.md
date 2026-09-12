Accepted. No P0/P1 findings and no code-behavior regression.

### Findings

- **F13 — P3 — Established, fixed.** The plan log said fifteen callers watch the queue, but the source census has fifteen external callers: fourteen watchers and one quiet caller. The sixteenth occurrence is `useStepJob` forwarding its caller’s choice to `useJobs`.
  - **(a)** Run `rg -n '= use(?:Jobs|StepJob)\\(' src/web --glob '*.{ts,tsx}'` and separate the internal forwarding call at [useStepJob.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/web/useStepJob.ts:364).
  - **(b)** I corrected the count and explained the forwarding occurrence in the [plan log](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/docs/plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md:273).

### Review conclusions

- All production callers were found independently: fourteen explicitly use `"watches-queue"`; [useArc.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/web/useArc.ts:155) alone uses `"quiet"`. These match their pre-commit behavior.
- The choice cannot be omitted through a default, overload, options spread, or forwarding wrapper. Both hooks require `QueueCadence`.
- I separately mutated each hook to default to `"watches-queue"`. Both mutations made the tests-project typecheck fail with an unused `@ts-expect-error` and the parameter-type assertion. The original source was restored and typechecks cleanly.
- `useSyncExternalStore` receives stable identities: `subscriberFor` returns either `jobEngine.subscribe` or `jobEngine.subscribeQuietly`, both stable object-method references. It only changes identity when the cadence choice changes.

### Hover card

`"watches-queue"` is the correct choice for this stage because the explicit requirement is no behavior change.

For the deferred F3 follow-up, the eventual change appears cheaper than “quiet until pending”: [WithAddToShelf](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/web/ProseHoverCard.tsx:769) can probably remain `"quiet"` throughout. Before a local press it has no job ID with which to use cross-tab queue state; after a press, `queue.add()` creates a reconciliation obligation, and an active job supplies the busy cadence while quiet subscribers still receive snapshots. That deserves its own red test before changing this stage’s preserved behavior.

Verification:

- Targeted review suite: 10 files, 66 tests passed.
- Direct TypeScript checks: all four projects passed.
- Production client and API builds passed.
- `git diff --check` passed.
- Full `npm test` could not start because the sandbox forbids access to the local PostgreSQL port.
- Lint reported existing complexity and `dangerouslySetInnerHTML` findings in touched files, none on candidate lines.

Changed by this review:

- [docs/plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/docs/plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md:273)

No commit made. The pre-existing untracked feedback note was untouched.