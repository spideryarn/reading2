# Plan review: 260910e work reports and decisions

You are reviewing a **plan**, read-only. Do not change any file.

The plan: `docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md` (committed on
this branch). Its spec is the roadmap stage in
`docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Work reports and decisions — a
small event vocabulary" (five checkboxes and an acceptance paragraph) — read both in full.

The code the plan builds on, which you should read rather than trust the plan's account of:

- `tools/overseer/decisions.ts` — the decision record (fold, parser, `appendEvents`, init marker).
- `scripts/overseer-decisions.ts` — its CLI.
- `tools/fleet/decisions-view.ts`, `tools/fleet/routes-decisions.ts`, `tools/fleet/web/src/decisions-client.ts`,
  `tools/fleet/web/src/DecisionsPanel.tsx` — its projection, route, client and panel.
- `tools/overseer/store.ts` (header, `OverseerStore`, `RegisterEntry`) and `tools/overseer/daemon.ts`
  (`DaemonOptions`, the interval passes in `runOverseer`) — the daemon and its store.
- `tools/overseer/lock.ts`, `tools/overseer/jsonl.ts`.
- `tools/overseer/standing-jobs.ts` (`AUTHORISED_HASHES`) and `tools/overseer/dispatch.ts`.
- `docs/project/overseer.md` § "1. Never hide who decided".

## What to answer

1. Does the plan meet the roadmap stage's five checkboxes and acceptance? Name any it misses or meets
   only on paper.
2. **The ownership design** — a file-drop inbox the daemon drains, with the daemon the only writer of
   `reports.jsonl`. Is it sound? Crash points, duplicate submission, a daemon that is down for hours, a
   second daemon, an inbox flooded by a runaway agent, symlinks or odd filenames in the inbox directory.
   Is there a simpler design that still satisfies "clients submit to the owner rather than append
   directly"?
3. **The decisions reconciliation** — schema 2 with `author` separate from `by`, session decisions
   written into `decisions.jsonl` by the daemon's drain, command id `report:<eventId>` joining the two
   logs. Does anything here let an agent's decision look like the Overseer's or Greg's, or look reviewed?
   Does an older reader really refuse a schema-2 line rather than misread it? Is "unknown consequence
   ranks as high" the right default?
4. **Stale execution** — is "`submittedAt` earlier than the register's verified `since` for that name"
   a sound and sufficient test, given the register's `verifiedExecution` is sticky through observations
   that cannot verify? What does it get wrong?
5. **Untrusted text** — summary, `needs`, artefact paths and ids. Anything that could reach a shell, a
   URL, or HTML unescaped?
6. Anything in the stage split, the file set or the test list that you would change.

**The finding I would least like to be wrong about**: that routing a session's decision through the
daemon into the shared `decisions.jsonl` keeps gate 1 intact — nobody's decision appears as someone
else's, and nothing but Greg makes one look reviewed.

## Format

Findings with an ID (`WR-P1`, `WR-P2`…), a severity (P0 blocks the plan, P1 must change before
building, P2 should change, P3 optional), the file and section, what is wrong, and what you would do
instead. Then a one-paragraph verdict.
