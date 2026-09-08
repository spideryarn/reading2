# Overseer decision log: running the two Astra plans

Up: [plans.md](../project/plans.md). The Overseer's runbook is [overseer.md](../project/overseer.md);
gate 1 there says every decision, assumption and decline is logged, and until the real log is built
this file is where they go. One line each, newest at the bottom. *Assumption pending Greg* marks a
product default he has not yet seen; he vetoes by editing the plan or replying.

The plans being run:
[260908f-prioritised-spideryarn-codebase-improvements.md](260908f-prioritised-spideryarn-codebase-improvements.md)
and [260908f-overseer-and-fleet-improvement-roadmap.md](260908f-overseer-and-fleet-improvement-roadmap.md).

## Log

- 2026-09-08 20:15Z — **Overseer** — Checked the seven "shell busy" panes. The two 7-hour shells are
  the GPT Astra Codex sessions that wrote the two plans, finished and idle at their prompt; not hung.
  The 20-hour `npx playwright install webkit` job's worktree and log are gone; it is dead weight.
  Kill refused by the auto-mode classifier, so asked Greg to kill it. Four other shells had already ended.
- 2026-09-08 20:15Z — **Overseer** — Usage reader works: five-hour window 17% (resets 21:49Z),
  seven-day 43%, cache 83 minutes old. Will re-read each tick.
- 2026-09-08 20:20Z — **Greg** — Deferred the whole Spideryarn product plan; focus is the Overseer and
  the fleet dashboard. Recorded in [overseer-queue.md](../project/overseer-queue.md).
- 2026-09-08 20:20Z — **Greg** — Kill the two Astra sessions that wrote the plans, and anything that
  is dead weight. Astra reserved for really tricky or important calls; Sol for the rest.
- 2026-09-08 20:22Z — **Overseer** — Killed `wk-install-0116-2281848` (the 20-hour webkit install with
  no worktree and no log). The two Astra shells were already gone before the kill reached them.
