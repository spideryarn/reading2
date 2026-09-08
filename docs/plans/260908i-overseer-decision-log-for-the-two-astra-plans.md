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
- 2026-09-08 20:50Z — **Overseer** — Messaged the two peers building Overseer machinery
  (`claude-agents-dashboard`, `overseer-md-agent-coordinator`) through the steer route to ask which
  files they hold. Delivery reported ok for both.
- 2026-09-08 20:55Z — **Overseer** — Dispatched wave 1 of the roadmap: `260908f-roadmap-baseline`
  (Baseline stage: census table, freshness tests, two client repairs) and
  `260908f-roadmap-failure-containment` (refresh single-flight, SSE backpressure, source.ts body
  bound). File sets disjoint from each other; the rest of the roadmap waits on the peers' replies and
  Baseline's census. Wave 2 candidates: Overseer status card, Delivery uncertainty, Execution identity.
- 2026-09-08 21:05Z — **Overseer** — Peers replied: the dashboard agent holds no `tools/fleet/` files
  tonight; the 260908g agent holds only `tools/overseer/{jobs,rules,rule-jobs,rule-work,scheduler,
  daemon,store}.ts`, `scripts/overseer.ts`, `scripts/overseer-pins.ts` and their tests, and
  `current.json` stays schema 2 under its Stage 3a. Dispatched `260908f-roadmap-overseer-status`
  (status card: fleet-owned reader of the two clocks, `OverseerPanel.tsx`). Suggested to the dashboard
  agent that it take the roadmap's Box contracts and Delivery uncertainty stages with its next slice,
  because they are its files; awaiting its answer before dispatching anyone else onto them.
- 2026-09-08 21:05Z — **Overseer** — *Assumption pending Greg*: Execution identity waits until 260908g
  Stage 3a lands, because its daemon-side propagation touches `store.ts`, which that agent holds.
- 2026-09-08 21:05Z — **Greg-queued, not yet dispatched** — local-time display (London and Athens)
  in the usage and status commands; waits for `scripts/overseer.ts` to be free of the 3a agent.
- 2026-09-08 21:08Z — **Overseer** — Cheap tick every 20 minutes from this session (`ov-tick.sh`:
  daemon status, usage, my sessions' last turns). No model call unless something changed.
- 2026-09-08 21:30Z — **Greg** — Prefer SendMessage between Claude sessions, tmux steering as the
  fallback. Rename this session `Overseer`, and find a way to mark the singleton Overseer.
- 2026-09-08 21:32Z — **Overseer** — Renamed my tmux session to `Overseer` (it was no longer
  provisional, so the rename sticks). SendMessage still lists me as `spideryarn2-a6` until Greg runs
  `/rename Overseer` in this session; I cannot issue a slash command myself. Dispatched
  `overseer-singleton-claim`: a `gjd-remote` claim verb writing a role into the tmux environment,
  read by `ls`, the collector, the dashboard and `overseer status`; it will claim this session and
  tell the 260908g agent where the role lives so the scheduler's prod can find me.
- 2026-09-08 21:32Z — **Overseer** — Channel rule from here on: SendMessage to Claude sessions where
  ListAgents shows them; the dashboard steer route for Codex sessions or when SendMessage cannot
  find the target. Told the dashboard agent the old rule; will correct it when it next replies.
- 2026-09-08 21:45Z — **dashboard agent, with Greg's go-ahead** — It owns the roadmap's Delivery
  uncertainty stage in full (its own plan calls it v0.2c) and the `wire.ts` arms for actions, steer,
  new, messages and rename. The preview envelope and kill candidate-identity half of Box contracts
  stays with the Overseer to dispatch later, with `FLEET_ACT_ENABLED` treated as staying off.
- 2026-09-08 21:10 UTC — **Greg** ran `/rename Overseer`; `ListAgents` now prints this session as
  `Overseer [c9ad18]`, so peers can address it by role. The tmux session had the same name already.
  Baseline session went idle at 22:05 local mid-job (two background jobs still running); not a
  debrief, no action. Load 6.4, five_hour 31% (resets 21:50 UTC), seven_day 45%.
- 2026-09-08 22:20 UTC — **overseer-singleton-claim** debriefed FINISHED (dev 90631416, plan
  260908j). Verified by me: the commit is on origin/dev; `gjd-remote ls` ends `— overseer:
  'Overseer'` after merging dev into the primary; `npm run worktree:check` said SAFE TO REMOVE.
  **I** killed the session (debrief received first) and removed its worktree. Two brief deviations
  taken by the agent on Sol's evidence and accepted by me: the role is a standalone
  `SESSION_ROLE_ENV` rather than a fifth META variable, and nothing in `wire.ts` was touched.
  **Pending Greg:** the one-paragraph runbook addition (below). **Pending the dashboard agent:**
  who restarts `fleet-dashboard.service` so the badge goes live; until then `overseer status`
  fail-closes to "Overseer unknown". Suite: 896/901 with the four reds accounted for (two are the
  api-dist fresh-worktree pair); the full suite was not re-run on the merged tree.
  - Proposed runbook text, § "You are the Overseer", between that paragraph and "Your context is a
    cache, not the record" — awaiting Greg's yes: *"Check that you are the claimed Overseer before
    you do anything else. One live session holds the claim — a role in its own tmux environment —
    and `gjd-remote ls` prints who under the table, as does the `overseer` line of
    `npx tsx scripts/overseer.ts status`. If it names a session that is not you, stop and tell
    Greg: two Overseers is the failure this role cannot recover from itself, and every reader
    deliberately refuses to pick between them. If it says nobody holds it — which is what a reboot
    leaves, since the claim dies with the tmux server — and you are meant to be it, take it with
    `gjd-remote claim-overseer <your session name>`."*
