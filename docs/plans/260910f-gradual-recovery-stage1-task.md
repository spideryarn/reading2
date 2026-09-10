# Stage 1 task: the request, the decision, the daemon pass, the projection

You are implementing Stage 1 of
`docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md` in the
worktree `/home/greg/code/spideryarn2/.claude/worktrees/recovery-resume` (branch
`worktree-recovery-resume`). **Read the whole plan first**, including its "Review dispositions"
section if one is present, which overrides the sections above it. Then read the inventory it builds
on: `tools/overseer/recovery.ts`, `recovery-view.ts`, `recovery-inbox.ts`, and the recovery parts
of `daemon.ts` (`recoveryTick`, `buildRecoveryView`, `viewInventory`, `drainRecoveryInbox`), plus
`tests/overseer-daemon-recovery.test.ts` for the scripted-source harness you will reuse.

**Rules of the tree.** Work only in this worktree. Do not commit, push, or run any git command that
changes state (checkout, restore, stash, reset, clean). Another subagent is building Stage 2
(`tools/fleet/…`, the panel) in this same worktree at the same time: do not edit its files, and
expect its half-finished files to show up in a full typecheck. Read files outside the worktree only
through Bash, never the Read tool. Never touch `~/.overseer`, the live dashboard (8787), the live
daemon, or the default tmux server. Everything runs against temp directories.

## What this stage is for

Greg taps **Resume** on an interrupted session. A request file lands. The daemon takes the oldest
request, one per tick, checks the gates and the pace rule, revalidates everything against the
current state, and hands a launch to the launch protocol. It then writes a projection the page can
draw. **In this stage the launch protocol is not on `dev`**, so the launch goes through a port
(`ResumeLaunchPort`, below). Production composes it as `unwired`, so requests queue and nothing
launches. Tests drive a fake that keeps the protocol's rules.

## Files (yours)

- `tools/overseer/recovery-resume-request.ts` (new): **a leaf**, node builtins only, because
  `tools/fleet/` will import it and must not reach the store's graph
  (`tests/fleet-attention.test.ts` ~425). The format and the writer:
  - `RECOVERY_RESUME_DIR = "recovery-resume"`, with `pending/`, `done/` and `refused/` beneath it;
  - `ResumeRequest = { v: 1; candidateId; requestedAt; actor: "dashboard" | "cli"; nonce; seen:
    { checkedAt; conversationId; dir } }`;
  - `CANDIDATE_ID_PATTERN` (the same pattern `recovery-inbox.ts`'s `isCandidateId` enforces). Make
    `recovery-inbox.ts` use the leaf's pattern rather than keep a second copy, as a small targeted
    edit;
  - `writeResumeRequest(root, input) → { kind: "written" } | { kind: "already-pending" } | { kind:
    "already-done"; occurrenceId?: string } | { kind: "refused"; why }`. It writes
    `pending/<candidateId>.json` with `O_CREAT|O_EXCL`, **the file name being the request-layer
    idempotence key**. It writes temp-then-link or temp-then-rename in a way that never leaves a torn
    file under the final name. It fsyncs the file and the directory;
  - `parseResumeRequest(text)`, strict, never throws;
  - a bounded lister for the daemon and the route (scan limit and overflow count, the
    `recovery-inbox.ts` lessons F18 and F22: `O_NOFOLLOW`, a bounded read, quarantine only positively
    identified junk).
- `tools/overseer/launch-gate.ts` and its test are **already built** by another subagent. Use its
  `launchGate` with `onUnknown: "hold"` and `usageStaleAfterMs: 15 * 60_000`. Do not change its
  signature: `scheduled-dispatch` imports it.
- `tools/overseer/recovery-resume.ts` (new):
  - the port:
    ```ts
    export type ResumeLaunchPort =
      | { kind: "unwired"; why: string }
      | {
          kind: "wired";
          /** The launch fold's record for recoveryOrigin(candidateId), or null. */
          occurrenceOf(candidateId: RecoveryCandidateId): ResumeOccurrence | null;
          /** Every recovery-origin occurrence not yet terminal (launching, observed-running, outcome-unknown, …). */
          inFlight(): readonly ResumeOccurrence[];
          /** Synchronous. Mirrors the launch protocol's LaunchOutcome arms (read it: git show worktree-launch-protocol:tools/overseer/launch-protocol.ts, ~1155). */
          launch(request: ResumeLaunchRequest): ResumeLaunchOutcome;
        };
    ```
    `ResumeOccurrence` is `{ candidateId, occurrenceId, state: RecoveryResumeLaunchState, attempt,
    at }`, using the type in `tools/fleet/wire.ts`. `ResumeLaunchRequest` is `{ candidateId,
    conversationId, dir, nudge }`. Stage 3 adapts `composeLaunchProtocol` to this port; keep the port
    that thin.
  - `decideResume(input) → defer | refuse | launch | settled`: pure, exactly §2's order (capability,
    existing occurrence, pace, gate, revalidation). It is handed the *fresh* facts: the record from
    `store.recovery`, a classification recomputed with `classifyRecord` against the current
    inventory trust, the current live rows, a transcript reading, the dir and transcript `stat`
    results, the gate result, the pace facts, and the request's `seen`;
  - the **pace rule**: one recovery occurrence in flight and not yet `resumed` in the inventory
    defers everything, with no timeout. `RESUME_SPACING_MS = 120_000` after the last verification;
  - **the nudge**, per §2: fixed text, with the interruption time filled in;
  - **the preview**, per §3: brief (the first user message), last words (the last assistant text),
    title and uncertainty. Bounded reads: 256 KiB from the head and 256 KiB from the tail, each
    quote capped at 600 characters, cached on `(path, size, mtimeMs)`. Read the transcript JSONL
    shape from a real file under `~/.claude-gregmindstone/projects/` through Bash (read-only). User
    and assistant lines carry `message.content` as a string or an array of `{type:"text", text}`
    parts. Skip tool results and meta lines. Only for first-page records whose `resume` is
    `supported`;
  - **the pass**, `runResumePass(deps)`. It lists pending requests (bounded), takes the head by
    `(requestedAt, candidateId)`, does the async transcript locate, and then **in one synchronous
    stretch**: `statSync` dir and transcript, `decideResume`, `port.launch`, and the file move
    (`pending/` → `done/<id>.json` with `{ occurrenceId, outcome, at }`, or `refused/<id>-<ms>.json`
    with the reason). A crash between `launch` and the move leaves the request pending, and the next
    pass answers `settled` from `occurrenceOf`;
  - the projection writer: `recovery-resume.json` in the store root, via `jsonl.ts`'s
    `writeAtomically`, and only when its content changed. Its shape is `RecoveryResumeProjection` in
    `tools/fleet/wire.ts` (already written; follow it exactly, and if it truly needs a change, make
    it and say why). Refused entries are the newest per candidate, keeping the newest 50 overall.
- `tools/overseer/daemon.ts`: **small targeted edits only. Re-read the region immediately before
  each edit, and never rewrite a block.** Other sessions own the usage pass. Add a
  `recoveryResume?: { port: ResumeLaunchPort; … }` option, defaulting to `{ kind: "unwired", why:
  "the launch protocol is not composed into this daemon yet" }`. Add a `recoveryResumeTick()` called
  right after `recoveryTick()`, which does nothing while a previous pass is still running (the same
  guard pattern as the other passes) and nothing while the recovery replay is `not-run`. Add
  `stopTimers()` coverage if you add a timer. The gate's inputs are the daemon's own `usage`
  variable and the latest **accepted** snapshot's `health`; find where the daemon holds that.
- `scripts/overseer-recovery.ts`: `resume <id>`, through the leaf, `actor: "cli"`. `seen` is taken
  from the current `recovery.json` view item, and the command refuses if the record has no
  supported resume evidence. `list` also shows each record's resume state from
  `recovery-resume.json` when present.
- Tests: `tests/overseer-recovery-resume.test.ts` (the leaf, the decision, the preview) and
  `tests/overseer-daemon-recovery-resume.test.ts` (through the real daemon with a scripted source, as
  `tests/overseer-daemon-recovery.test.ts` does).

**Not yours:** `tools/fleet/**` (Stage 2 is there, except the `wire.ts` block, which you may amend
with a reason), `launch-gate.ts`, `store.ts`, `recovery.ts`'s fold (if you truly need a change
there, stop and say so), `scheduler.ts`, `infra/`, `scripts/gjd-remote.ts`.

## Red first: the plan's Stage 1 list, every item

Write each test, run it and **see it fail for the intended reason**, then implement. Every item in
the plan's Stage 1 "Red first" list is required: two taps; launch succeeded but the response was
lost; already resumed elsewhere; missing transcript after preview; partial success across a list
(exactly two invocations); the gates; changed since you looked; unknowns stay put; the unwired
capability; the preview bounds. Add: a daemon restart with requests pending (they survive, and the
queue order is kept), and a `not-run` recovery replay holding the pass.

Count invocations with the fake port's own counter **and** with an independent marker the fake
writes to a temp file, so a no-op cannot pass. After everything is green, **mutate** the finished
code and confirm the suite notices. Report which tests each mutation turned red, and revert it. The
mutations:

- drop the pace check;
- make the gate use `onUnknown: "clear"`;
- skip the `occurrenceOf` settled check;
- remove `O_EXCL`.

Do not copy any uuid literal from another test file (`tests/fixture-ids.test.ts`).

## Gates

- the focused suites, plus `tests/overseer-daemon-recovery.test.ts`, `tests/overseer-recovery*.test.ts`
  and `tests/fixture-ids.test.ts`: report the exit codes;
- `npm run typecheck`: read the **exit code**. It writes errors to stderr; do not trust a piped
  tail;
- `npx biome lint` on your files (never `--formatter-enabled`).

## Report back

Briefly: the files, the red→green counts, the mutations and what they turned red, the gate exit
codes, every decision the plan did not settle, and anything you needed outside your file set. Do not
paste code.
