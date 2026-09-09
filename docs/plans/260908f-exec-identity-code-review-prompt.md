# Review: execution identity for the agent fleet dashboard / Overseer

You are reviewing a finished stage of `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md`
(section **"Stage: Execution identity — distinguish a running process from an old launch claim"**).
Repo: `/home/greg/code/spideryarn2`, worktree `.claude/worktrees/260908f-exec-identity`, branch
`worktree-260908f-exec-identity`. Read files in the worktree directly; the scoped diff is at
`docs/plans/260908f-exec-identity-review-diff.txt` and the two new files are listed at its end.

## The problem this stage exists to solve

A tmux pane outlives the things that run in it. When a pane's `claude` exits and another starts in
the same job shell, **every identity the fleet carried is unchanged**: `tmuxServerPid`, `paneId`,
`panePid` (the pane's shell never died) and `claudeSessionId` — the last because
`CLAUDE_SESSION_ID` is pinned into the tmux environment by `tmux new-session -e` BEFORE Claude runs
and is never rewritten. `tools/overseer/diff.ts` documents this and cannot fix it: its
`session-replaced` fires on a changed claim (which almost never changes) and its
`session-pane-replaced` fires on a changed pane pid (which a claude restart does not change).

So a consumer holding any of those ids cannot tell yesterday's conversation from this morning's, and
`tools/fleet/wire.ts`'s `OverseerRegister` says in as many words that the register may not be joined
onto fleet rows for exactly this reason.

## What was built

1. `tools/fleet/wire.ts` — new types at the END of the file (types only; that file is compiled a
   second time by a DOM-only project and may hold no imports and no runtime values):
   `ExecutionToken` (`boot` = `/proc/sys/kernel/random/boot_id`, `pid`, `startTicks` =
   `/proc/<pid>/stat` field 22), `ConversationReading` (4 arms), `ExecutionUnknownCause` (8 arms),
   `ExecutionReading` (`verified` | `claimed-only` | `unknown`).
2. `tools/fleet/execution-identity.ts` (NEW) — `readExecutionIdentity` (pure, injected readings),
   `executionTokenText`, `continuityOf`, `identityWriteGate`, `readBootIdentity`,
   `readProcessStart`, `parseProcStat`. It REUSES `probeProcessTable` (`tools/overseer/work-probe.ts`)
   and `classifyPaneHarness` (`tools/overseer/harness.ts`) rather than writing a second probe; that
   was an explicit instruction, since both had zero non-test callers.
3. `tools/fleet/collect.ts` — `FleetRow.execution`, defaulted to `unknown`/`not-probed` in `toRows`,
   filled in by a new `readExecutions` pass (one `ps` and one boot-id read for the whole fleet, one
   `/proc/<pid>/stat` per row).
4. `tools/fleet/web/src/types.ts` — `parseExecution` + `parseConversation`, browser side.
5. `tools/overseer/observation.ts` — `ObservedRow.execution` and a second, independent
   `parseExecution`. Two parsers is the roadmap's stated design ("independent runtime validation …
   in their owning modules"), not an oversight.
6. `tools/overseer/diff.ts` — new `session-execution-changed` arm, emitted only when BOTH readings
   are `verified` and their tokens differ.
7. `tools/overseer/store.ts` — `RegisterEntry.verifiedExecution` (sticky), its parser, the fold arm,
   and a fifth `ENTRY_FIELD_OWNERS` class.
8. `tools/overseer/jobs.ts` and `scripts/overseer.ts` — one arm each, forced by exhaustive switches.

## Decisions I want you to attack specifically

- **The token.** Is `boot:pid:startTicks` actually sufficient to distinguish two runs on this box?
  Consider: pid namespaces, a process re-execing, `boot_id` stability, `startTicks` monotonicity,
  the `/proc` read racing the process's exit, and a checkpointed/restored process. Is there a case
  where two DIFFERENT runs mint the SAME token, or one run mints two? The first is much worse.
- **`parseProcStat`** parses from the LAST `)`. Is that right for every real `/proc/<pid>/stat`?
  Is field 22 = index 19 after the close-paren correct? Is there any way a truncated or racing read
  yields a plausible-but-wrong number rather than a refusal?
- **The `verified` / `claimed-only` / `unknown` split.** `claimed-only` is used ONLY for "the walk
  ran and could not name what it found" (`unrecognised-pane-process`, `ambiguous-harness`);
  every way of failing to look is `unknown` with a cause. Is any mapping in `readExecutionIdentity`
  wrong, in particular in the direction of being too reassuring?
- **The differ's rule and its admitted gap.** `verified(A) → unknown → verified(B)` emits no event.
  I argue this is a gap in the HISTORY and not in the GUARANTEE, because continuity is decided by
  `continuityOf` comparing a stored token to the current reading, and a comparison has no sampling
  gap. Is that argument sound? Is there a consumer that would in fact rely on the event?
- **`RegisterEntry.verifiedExecution` is sticky** (moves on a first sighting and on a proven change,
  never on a blind collection) and the fold resets `statusSince` to a `lower-bound` on a change.
  Are either of those wrong? Does resetting `statusSince` break any existing consumer?
- **Schema compatibility.** No bump on `OBSERVATION_SCHEMA` (1) or `STORE_SCHEMA` (2). In
  `parseRegisterEntry`, an ABSENT `verifiedExecution` is forgiven (→ `null`) while a MALFORMED one
  fails the checkpoint whole. Is that pair defensible, and is the absent case really unable to
  produce a wrong answer downstream?
- **`identityWriteGate`** allows a write only on verified execution AND verified conversation. Is it
  too strict (does it refuse something legitimate), or not strict enough anywhere?
- **The new fleet → overseer import direction.** `tools/fleet/execution-identity.ts` imports
  `tools/overseer/harness.js` and `work.js`; `tools/overseer/diff.ts` and `store.ts` import
  `executionTokenText` back from `tools/fleet/execution-identity.js`. Is there a cycle, or a
  layering problem that will bite? (`tools/fleet/health-history.ts` already imports
  `tools/overseer/jsonl.js` and `lock.js`, so the direction is not new. The one hard rule is that
  fleet must not import `tools/overseer/store.ts`.)
- **Cost.** `readExecutions` adds a `spawnSync` `ps` (~40 ms over ~1000 processes, measured in
  `work-probe.ts`) to a collection that already takes 8–12 s and already blocks the event loop in
  two other places. Named in the source as work for the Responsive collection stage. Reasonable?

## Evidence

- Full suite result: see `docs/plans/260908f-exec-identity-suite.txt` (raw tail).
- `node --import tsx scripts/typecheck.ts` exits 0.
- Focused suites green: `fleet-execution-identity` (33), `overseer-store`, `overseer-diff`,
  `overseer-observation`, `overseer-cli`, `fleet-collect`, `fleet-refresh`, `fleet-drain`,
  `fleet-web`, `fleet-overseer-panel`, `fleet-overseer-status`, `overseer-daemon`,
  `overseer-source`, `fleet-imports`, `overseer-jobs`, `fleet-compile-guards`.
- Live box, read-only, 2026-09-09 00:40 UTC, through the production `readExecutions` path: 11 of 11
  tmux sessions `verified`, 0 `claimed-only`, 0 `unknown`. The `Overseer` session's token
  `96e5c266-4bf6-412b-b762-6e020d640558:4039575:72055933` matches a hand-rolled `/proc` walk taken
  90 minutes earlier — two independent derivations agreeing.
- A read-only census at 2026-09-08 22:46 UTC over all 11 sessions: 7 claudes with tmux claim ==
  live `--session-id`, **0 conflicting**, 4 shells with no claim. The blind spot is LATENT, not
  currently firing.

## What I want back

Findings ranked P0/P1/P2, each with the file and line, the concrete failure it produces, and the
smallest correct fix. **Check my conclusions as well as my code** — in particular the claim that the
differ's sampling gap is harmless, the claim that the token cannot collide, and the claim that no
schema bump is needed. If any of those is wrong, say so plainly; an overruled P0 goes back to the
person who briefed this stage rather than past them.

Please also say explicitly whether you think anything here is over-built for what it buys.
