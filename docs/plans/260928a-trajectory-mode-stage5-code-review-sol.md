Verdict: **accept after fixes**. Four findings were fixed; no wider issues found. No commit was made.

### Findings

- **F37 — P1 — Deep-link flash re-armed after remount. Fixed.**  
  The one-shot token lived inside the Trajectory band, so switching modes and returning could flash the retained `?stop=` again. It now belongs to `Reader` and is consumed once across band remounts: [Reader.tsx:337](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/reader/Reader.tsx:337), [TrajectoryMode.tsx:378](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:378).  
  Red→green: the remount test initially observed two arrivals; it now observes one. StrictMode, re-render, delayed data, later stepping, and fallback-to-first cases are covered at [trajectory-panel.test.tsx:887](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/tests/trajectory-panel.test.tsx:887).

- **F38 — P1 — Client freshness race could omit stale Quotes. Fixed.**  
  A current-looking client read could omit `quotes` while revalidation was in flight. Every Trajectory request now names Quotes as an unforced prerequisite, leaving freshness to the server: [useTrajectory.ts:153](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/useTrajectory.ts:153).  
  This is not a no-op: Quotes’ stamp includes its current article fingerprint, prompt and model [pipeline.ts:3191](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/pipeline.ts:3191); `stepIsDone` returns false on a stamp mismatch [pipeline.ts:1045](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/pipeline.ts:1045), and jobs consult it for every unforced step [jobs.ts:1000](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/jobs.ts:1000).  
  Red→green: current-Quotes ensure and regenerate tests previously sent only `trajectory`; both now send `["quotes", "trajectory"]`.

- **F39 — P1 — Unresolvable movements changed the URL without moving. Fixed.**  
  Stepping while Quotes were unavailable, or toward a stale block ID, could update `?stop=` without scrolling or flashing. Movement now resolves a block present in the article before changing route state: [TrajectoryMode.tsx:279](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:279), [TrajectoryMode.tsx:303](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:303).  
  Red→green: the loading-Quotes test initially returned success and changed the route; it now returns false with no URL change, scroll, or flash [trajectory-panel.test.tsx:943](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/tests/trajectory-panel.test.tsx:943).

- **F40 — P2 — Stop positions rescanned the article per row. Fixed.**  
  Position calculation was `O(stops × blocks)` per relevant render. A memoized map now computes every midpoint in `O(blocks)` and rows use constant-time lookups: [trajectory-route.ts:198](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/trajectory-route.ts:198), [TrajectoryMode.tsx:419](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:419).  
  Red→green: the new linear-read test failed before `positionsOf` existed and now passes [trajectory-route.test.ts:212](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/tests/trajectory-route.test.ts:212).

### Confirmed without further findings

- A cancelled scroll does not flash, and each new movement drops any held predecessor [TrajectoryMode.tsx:501](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:501), covered at [trajectory-panel.test.tsx:822](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/tests/trajectory-panel.test.tsx:822).
- Regeneration sends `force: ["trajectory"]` only; `useStepJob` never widens force to prerequisites [useStepJob.ts:544](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/useStepJob.ts:544).
- The position track is decorative visually and expressed in screen-reader text [TrajectoryPanel.tsx:77](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/TrajectoryPanel.tsx:77).
- Dock order has one source through `visibleModes`; the command bar consumes that order, and `keepLabel` remains attached only to Plain. No old-order dependency was found.

### Verification

- Requested suite: **103/103 passed**.
- Dock/command-bar regression suite: **236/236 passed**.
- Focused Biome lint: exit **0**, with two pre-existing Reader complexity advisories.
- `npm run typecheck`: exit **1** because the sandbox refused tsx’s `/tmp` IPC socket (`EPERM`).
- Equivalent `node --import tsx scripts/typecheck.ts`: exit **0**, all **2,291** source files covered.