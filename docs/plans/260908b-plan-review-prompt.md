# Review request: the Overseer's store and clock (plan stage)

You are reviewing a **plan**, before any code exists. Nothing has been built. The deliverable is a
judgement on whether this plan is worth building as written.

## What to read

Repository: `spideryarn2` (this worktree). Everything named is committed at revision
`2a7ca6f2c35232bf738771a2f28b501ad768fece` — read it from git, not from any temp path.

- **The plan under review:** `docs/plans/260908b-overseer-store-and-clock.md`
- **The standing direction:** `docs/project/overseer-direction.md` — the constraints, the
  horizon, and the seam with the fleet dashboard. Read this second; it explains the plan's context.
- **The code the plan builds on, all of which exists and works:**
  - `tools/fleet/status.ts` — `statusOf`, `statusesOf`, `triageRank`. The plan changes this.
  - `scripts/gjd-remote-tmux.ts` — `Session`, `SessionState`, `sessionState`, `parseSessions`,
    `META`. The plan changes the `unknown` arm of `SessionState`. This file is shared with
    `gjd-remote`, the box's session-management CLI, so a change here is not local.
  - `tools/fleet/collect.ts`, `tools/fleet/server.ts`, `tools/fleet/health.ts`,
    `tools/fleet/steer.ts` — the fleet dashboard, built by a different agent in parallel with this
    work. The plan consumes its HTTP API and must not modify it.
  - `docs/plans/260907e-agent-fleet-dashboard.md` — that agent's plan, for context on what is
    landing beside this.

## Context you need

The box is a Hetzner server running ~36 Claude Code sessions in tmux across ~15 git worktrees. A
"fleet dashboard" (another agent, in flight) serves a live page showing what is running. This plan
adds an "Overseer": a long-running daemon that records what the fleet does **over time**, because
nothing currently does. It is stage one of several; later stages add attention triage, reboot
recovery, usage-limit visibility and a job scheduler. This stage deliberately builds none of those.

Two facts that constrain the design and are measured, not assumed:
- A fleet collection costs ~12 seconds of grepping multi-megabyte transcripts. The box frequently
  runs at load 33–41 against 16 cores with 18–23 GB of swap in use, and hit load 391 with the OOM
  killer firing on 2026-09-08. So a second collector is a real cost.
- Session identity lives only in the tmux environment, so a reboot erases it. Nothing on disk records
  which sessions were alive.

## Severity scale — use exactly these

- **P0** — will cause data loss, corruption, or a wrong result that nothing would catch.
- **P1** — a real defect or a design choice that will have to be undone later at significant cost.
- **P2** — worth fixing, but the plan survives without it.
- **P3** — a preference or a nit.

**Give every finding an ID** (`F1`, `F2`, …), a severity, the file or plan section it concerns, and
a concrete consequence — the sequence of events that produces a bad outcome. A finding I cannot act
on because it names no mechanism is worse than no finding.

## What I most want judged

1. **Is the staging right?** Four stages (O1a pure functions + a shared-type change, O1b the source,
   O1c the daemon, O1d systemd and restart). Does each genuinely end at a committable, working
   stopping point? Is O1a doing too much by bundling the `SessionState` change with the diff logic?

2. **The `SessionState.unknown` change.** The plan adds a machine-readable `cause` alongside the
   existing human `why`, and switches `statusOf`'s internal comparison from prose to structure. That
   file is shared with `gjd-remote`. Is this the right fix, is it correctly scoped, and does the plan
   miss any consumer that would break? Is there a simpler option that gets the same property?

3. **The admissibility rules.** The plan refuses to diff a snapshot unless `error` is null,
   `collectedAt` has advanced, and `rows` is non-empty. Are those the right three? Are they
   sufficient to prevent spurious `session-gone` events, and do they wrongly discard evidence in any
   case I have not considered?

4. **Is JSONL-with-events the right store**, or is the plan storing up a migration it will regret?
   The plan names the condition that would force SQLite. Is that condition the right one?

5. **The coupling.** The Overseer consumes the dashboard's HTTP/SSE API rather than collecting for
   itself, which means it depends on a process it does not control. The plan's mitigation is two
   clocks in the output file and a slow local fallback. Is that adequate, and is the trade correct
   given the resource numbers above?

6. **Is anything here not worth building at all?** Reframing, reducing or dropping a stage is a
   legitimate and welcome conclusion. If a smaller version gets most of the value, say what it is.

## Constraints on the work being planned

- **Do not change any file.** This is a read-only review.
- Nothing new in `package.json` — the project's stated preference, and `node:http` is being used
  deliberately over a framework.
- TypeScript with `strict` and `noUncheckedIndexedAccess`. The project prefers discriminated unions
  over bags of optionals and wants wrong states to be uncompilable rather than caught by tests.
- The project's house style is that a state nobody could determine must look different from a state
  that was determined — see the long comments in `scripts/gjd-remote-tmux.ts`.

## My own suspicions, last and deliberately so

Do not anchor on these; find what I have missed. But these are where I am least confident:

- The three admissibility rules may be insufficient. Specifically: SSE and polling can both deliver,
  so I may see the same `collectedAt` twice by design, and I am not certain `collectedAt` advancing
  is enough to prove the underlying fleet was re-observed rather than the payload re-serialised.
- Restarting the daemon rebuilds its fold from **today's** file only. A restart just after midnight,
  or a daemon down across a day boundary, may lose the fold or produce a spurious burst of
  `session-seen` events.
- `session-gone` may be wrong as a concept: a tmux session that is killed and one whose Claude exited
  are different, and I may be flattening them.
- I have not thought hard about what happens when two Overseer daemons run at once — after a botched
  restart, or in two worktrees. The append is `O_APPEND` so lines will not tear, but the fold and
  `current.json` would fight.
