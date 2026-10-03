# Plan review: 261003l — Tweets becomes Summary's Thread

You are reviewing a **plan**, read-only. Do not change any file.

**Candidate**: `docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md`, a live
pre-commit file in this worktree (base: the worktree's HEAD). Nothing is built yet.

**What it is for**: Greg (the owner) finds the reading view has too many top-level modes. The v1 he
asked to try: the Tweets mode stops being a bar button and becomes a third choice inside Summary,
whose three-stop slider (Brief · Simple · Fuller) becomes a three-way segmented control
Brief | Fuller | Thread. He asked for the simplest version first.

**Read first** (this does not limit scope): the plan; `docs/project/mode.md` (§ Retiring a mode
above all); `src/modes.ts`; `src/web/activation.ts` (`MODE_TARGET`, `subModeTarget`, `bandTarget`,
the `arrival` kind); `src/web/useAutoRun.ts`; `src/web/useTweets.ts`; `src/web/last-view.ts`
(`REMEMBERED`, `NEEDS_AN_EXPLICIT_PRESS`); `src/web/modes/summary/SummaryMode.tsx`;
`src/web/Tweets.tsx`; `src/web/sub-modes.ts`; `src/web/command-match.ts`; `src/web/layout.ts`
§ `bandShapeFor`; `src/web/visitor.ts` § `POLICY`; `src/web/auto-modes.ts`; `src/web/router.ts`
§ `liftLegacyTweets`; `src/web/shared-inventory.ts`.

You may run one test file (`npx vitest run tests/<one>.test.ts`) or a script
(`node --import tsx <script>`); not `npm test` or `npm run typecheck`. You have no network and no
Postgres.

## What I want

An independent attack on the plan first: what does it get wrong, what will it break that it does
not name, what place that names `tweets` as a *mode* will be missed, and is there a smaller version
that gets the same result? In particular, find any way the change could **spend money without a
press** or **leave an armed token unclaimed**, and any way a visitor on a public article loses a
stored thread they can read today.

Severity, by consequence: **P0** data loss, security, incorrect charging, service unusable ·
**P1** user-visible wrong behaviour or an authoritative contract violated · **P2** design or
maintainability risk, no wrong behaviour today · **P3** prose defect. Mark each finding
*established* (direct evidence, no material inference) or *reasoned*. Give every finding an ID,
`F1`, `F2`, …. End with a one-line verdict: build as written / build with changes / do not build.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Decision 6 (the thread moves from write-on-arrival to write-on-press) against the passed-over
  option of leaving `useAutoRunOnArrival` in place. Which is really fewer parts?
- A press on the Summary bar button while `?summary=thread` is in the address: does the delegated
  row plus `bandTarget` cover it, and what else needs `PressContext.summary`?
- `?summary=simple` in a remembered last view or an old link degrading to `brief`.
- The add page's queue losing the `tweets` step silently.
- Whether keeping the Simple level generated but unshown hides a cost or a correctness problem.
