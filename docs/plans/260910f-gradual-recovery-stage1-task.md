# Stage 1 task: the request, the decision, the daemon pass, the projection

You are implementing Stage 1 of
`docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md` in the
worktree `/home/greg/code/spideryarn2/.claude/worktrees/recovery-resume` (branch
`worktree-recovery-resume`).

**Read the whole plan first.** Its section **"Review dispositions: Sol, plan round 1" overrides
§1–§7 wherever they differ**, and this brief follows the dispositions. Then read the review itself
(`docs/plans/260910f-gradual-recovery-plan-review-sol.md`, G1–G10) and the inventory this builds
on:

- `tools/overseer/recovery.ts`, `recovery-view.ts` and `recovery-inbox.ts`;
- the recovery parts of `daemon.ts`: `recoveryTick`, `buildRecoveryView`, `viewInventory`,
  `drainRecoveryInbox`, and how `recoveryEvidence` is built;
- the recovery parts of `store.ts`: `parseRecoveryFile`, and where `recovery.json` is written with
  its `view`;
- `tests/overseer-daemon-recovery.test.ts`, for the scripted-source harness you will reuse.

**Rules of the tree.**

- Work only in this worktree.
- Do not commit, push, or run any git command that changes state (checkout, restore, stash, reset,
  clean).
- Another subagent is building Stage 2 (`tools/fleet/…`, the panel) in this same worktree at the
  same time. Do not edit its files.
- A full typecheck is red in `tools/fleet/recovery-feed.ts` until Stage 2 adds the new `resume`
  field of `RecoveryFeed`. That red is expected and not yours. Every other error is.
- Read files outside the worktree only through Bash, never the Read tool.
- Never touch `~/.overseer`, the live dashboard (8787), the live daemon, or the default tmux server.
  Everything runs against temp directories.

## What this stage is for

Greg taps **Resume** on an interrupted session, and a request file lands. The daemon then:

1. coalesces requests by candidate and takes the oldest candidate, one per tick;
2. does its async work: locating the transcript, reading its tail, building the preview;
3. **in one synchronous stretch**, recaptures the latest accepted observation and repeats every
   check (the occurrence table, pace, gate, revalidation, account);
4. hands a launch to the launch protocol;
5. writes the resume projection into `recovery.json`, beside `view`.

**In this stage the launch protocol is not on `dev`**, so the launch goes through a port
(`ResumeLaunchPort`, below). Production composes it as `unwired`, so requests queue and nothing
launches. Tests drive a fake that keeps the protocol's rules: one occurrence per candidate, and the
retry rule.

## Files (yours)

**`tools/overseer/recovery-resume-request.ts`** (new). **A leaf**, node builtins only, because
`tools/fleet/` imports it and must not reach the store's graph (`tests/fleet-attention.test.ts`
~425).

- `RECOVERY_RESUME_DIR = "recovery-resume"`, with `pending/`, `done/`, `refused/`, `processing/`
  and `junk/` as you need.
- **Request files are nonce-named** (G10): `pending/<candidateId>--<nonce>.json`. The daemon
  coalesces by candidate. **The launch occurrence is the only duplicate-launch guarantee**; the
  file name guarantees nothing.
- `ResumeRequest = { v: 1; candidateId; requestedAt; actor: "dashboard" | "cli"; nonce; seen: {
  checkedAt; conversationId; dir } }`.
- `CANDIDATE_ID_PATTERN`, the same pattern `recovery-inbox.ts`'s `isCandidateId` enforces. Make
  `recovery-inbox.ts` use the leaf's pattern rather than keep a second copy (a small targeted edit).
- `writeResumeRequest(root, input) → { kind: "written"; path } | { kind: "refused"; why }`. The
  write is atomic (temp, fsync, link or rename under `O_EXCL`, fsync the directory), and never
  leaves a torn file under its final name.
- `pendingFor(root, candidateId)`: whether a pending request exists. The route uses it for its
  courtesy answer.
- `parseResumeRequest(text)`: strict, and it never throws.
- A bounded lister, applying the lessons of `recovery-inbox.ts` F18 and F22: `O_NOFOLLOW`, a
  bounded read, a scan limit with an overflow count, and quarantine only for positively identified
  junk.

**`tools/overseer/launch-gate.ts`** is on `dev` (`ce633d8c`). Use `launchGate` with
`onUnknown: "hold"` and `usageStaleAfterMs: 15 * 60_000`. **Do not change it**: `scheduled-dispatch`
imports it.

**`tools/overseer/recovery-resume.ts`** (new) holds the port, the account port, the decision, the
verification, the nudge and preview, the pass, and the projection.

**The port.** Stage 3 adapts `composeLaunchProtocol`'s `launchOccurrence`, `inspect` and
`inFlight` to it. Keep it that thin.

```ts
export type ResumeLaunchPort =
  | { kind: "unwired"; why: string }
  | {
      kind: "wired";
      inspect(candidateId: RecoveryCandidateId): ResumeOccurrence | null;
      /** planned, waiting-admission, reserved, launching, observed-running, outcome-unknown, or any with its reservation held. */
      inFlight(): readonly ResumeOccurrence[];
      /** Synchronous. Mirrors LaunchOutcome (git show worktree-launch-protocol:tools/overseer/launch-protocol.ts ~1155),
       *  including failed-before-launch's new `reservation: { kind: "released" } | { kind: "held"; why }`. */
      launch(request: ResumeLaunchRequest): ResumeLaunchOutcome;
    };
```

- `ResumeOccurrence` is `{ candidateId } & RecoveryResumeLaunchWire`, from `tools/fleet/wire.ts`.
- `ResumeLaunchRequest` is `{ candidateId, conversationId, dir, account: { name, configDir },
  nudge }`.

**The account port (G4).** A resumed conversation must run under the account whose config
directory holds its transcript, because `--resume` only finds its own config directory's
conversations.

- `ResumeAccountPort.resolve(transcriptPath) → RecoveryResumeAccount`, and `gate(accountName) →
  the inputs launchGate needs`.
- Research on how to implement both is under way; the facts go into the plan's G4 disposition.
  **Build the port and its uses now, with a production implementation that answers
  `{ kind: "unknown", why: "the account a transcript belongs to is not established yet" }`.**
  Until then, every record is manual-only.
- **Widen the transcript locator's roots now**, because this is certain: the inventory searched
  only `~/.claude/projects` (`recovery-view.ts` ~172). Make `projectsDir` a list of roots:
  - `$CLAUDE_CONFIG_DIR/projects` when set;
  - `~/.claude/projects`;
  - `~/.claude-*/projects`;
  - `~/.claude-accounts/*/projects`, if such directories exist.

  Keep the whole search bounded by the existing limit, and **record which root a transcript was
  found under**. That is what the account port will map to an account.
- Do not guess an account from a directory name: an unknown account means manual only.

**`decideResume(input) → defer | refuse | launch | settled`.** Pure.

- **The occurrence table** is the dispositions' G1 table exactly, as a `switch` with a `never`
  check. A released, undisposed `failed-before-launch` continues into attempt 2. A held one
  defers.
- **Pace** (G2, G8): any **undisposed** in-flight recovery occurrence that is not **verified**
  defers everything, with no timeout. The `why` names the blocker, and when it is
  `outcome-unknown` or holds a stuck reservation, it gives the exact `dispose` command. Dismissing
  the candidate does **not** waive pace. After the last verification,
  `RESUME_SPACING_MS = 120_000`.
- **The gate**: `launchGate`, for the resume's account (via the account port). An unknown account
  never reaches launch.
- **Revalidation**, all of §2.6 plus: the harness is `claude-code`; the account is `pinned`; and a
  G3 capability check that stays a no-op stub in Stage 1 (it always passes). Stage 3 adds the
  capability. Name the hook `producerCanVerifyResume(snapshot)`, returning `true`.

**Verification (G2).** `verificationOf(occurrence, record, transcriptReading) →
RecoveryResumeVerification`. It needs all four:

- the inventory's `resumed` disposition for the candidate;
- `observed-running` in the launch record;
- the transcript's size and mtime past what revalidation recorded at launch;
- a bounded tail (64 KiB) holding a line with that `sessionId` whose timestamp is after the launch.

Persist what revalidation recorded (the transcript's size, its mtime, and the launch's instant) in
`done/<candidateId>--<nonce>.json`. The next pass needs it to judge growth.

**The nudge** is §2's fixed text. **The preview** is §3: brief, last words, title, uncertainty and
account. Bounded reads: 256 KiB from the head and 256 KiB from the tail, quotes capped at 600
characters, cached on `(path, size, mtimeMs)`.

- Read the transcript JSONL shape from a real file under `~/.claude-gregmindstone/projects/`
  through Bash (read-only).
- User and assistant lines carry `message.content` as a string, or as an array of
  `{type:"text", text}` parts. Skip tool results and meta lines.
- Previews are built only for first-page records whose `resume` evidence is `supported`.

**The pass, `runResumePass(deps)`. The order is load-bearing (G5).**

1. List pending requests (bounded), coalesced by candidate. The head is the oldest `requestedAt`,
   then the candidate id.
2. Do all the async work: locate the transcript, read the tail, build the preview.
3. Then, **in one synchronous stretch with no `await`**:
   - recapture the latest accepted observation (the daemon's current inventory trust, rows and
     health);
   - recompute `classifyRecord` and the resolution;
   - check that no live row holds the conversation, and check `seen`;
   - `statSync` the directory and the transcript;
   - run the gate, pace and the occurrence table (`port.inspect` and `port.inFlight`);
   - call `decideResume`, then `port.launch`;
   - move the request files: all of the candidate's pending files go to `done/`, holding
     `{ occurrenceId, outcome, launchedAt, transcriptSizeAtLaunch, transcriptMtimeAtLaunch }`, or to
     `refused/` with the reason.

A crash between `launch` and the move leaves the requests pending. The next pass finds the
occurrence through `inspect`, and the table settles it.

**The projection.** Compute a `RecoveryResumeProjection` (`tools/fleet/wire.ts`: follow it exactly,
or change it with a stated reason) and **write it as an optional `resume` field beside `view` in
`recovery.json`**, through the same checkpoint that writes `view`. Change `store.ts` only as much
as it takes to carry the field: `store.ts`'s recovery write is recovery's own code. Keep the change
small and targeted, re-read the region before each edit, and never rewrite a block. Refused entries
are the newest per candidate, and the newest 50 overall. The request states are the full
`RecoveryResumeRequestState` union; the page draws `needs-greg`'s `disposeCommand`.

**`tools/overseer/daemon.ts`**: small targeted edits only. Re-read the region immediately before
each edit, and never rewrite a block. Other sessions own the usage pass.

- Add a `recoveryResume?: { port: ResumeLaunchPort; accounts: ResumeAccountPort; … }` option,
  defaulting to `unwired` plus the unknown-account port.
- Add a `recoveryResumeTick()` right after `recoveryTick()`. It does nothing while a previous pass
  is running (the same guard pattern the other passes use), and nothing while the recovery replay
  is `not-run`.
- Cover it in `stopTimers()` if you add a timer.
- The gate's inputs are the daemon's own `usage` variable and the latest **accepted** snapshot's
  `health`. Find where the daemon holds that snapshot.

**`scripts/overseer-recovery.ts`**: add `resume <id>`, through the leaf, with `actor: "cli"`. `seen`
comes from the current `recovery.json` view item, and the command refuses a record with no
supported resume evidence. `list` shows each record's resume state from the `resume` field.

**Tests**: `tests/overseer-recovery-resume.test.ts` covers the leaf, the decision, verification,
the preview and the locator roots. `tests/overseer-daemon-recovery-resume.test.ts` goes through the
real daemon with a scripted source.

**Not yours:**

- `tools/fleet/**`, except the `wire.ts` block, which you may amend with a reason;
- `launch-gate.ts`;
- `recovery.ts`'s fold (if you truly need a change there, stop and say so);
- `scheduler.ts`, `infra/` and `scripts/gjd-remote.ts`.

## Red first: every item, from the plan's Stage 1 list and from the dispositions

Write each test, run it and **see it fail for the intended reason**, then implement. The plan's
list:

- two taps (now: two nonce files, one invocation);
- launch succeeded but the response was lost;
- already resumed elsewhere;
- missing transcript after preview;
- partial success across a list;
- the gates;
- changed since you looked;
- unknowns stay put;
- the unwired capability;
- the preview bounds.

And from the dispositions:

- **G1**:
  - retry after a released failed-before-launch (attempt 2);
  - a held release defers;
  - `not-launched` in each folded state;
  - `completed` before verification shows `ended-unverified`.
- **G2**: a live `resumed` process whose transcript does not grow stays unverified, and it blocks
  the next request.
- **G5**: pause the transcript locate, inject a newer accepted snapshot with a live matching
  execution, and assert zero invocations.
- **G8**: a disposed blocker releases pace; a dismissed candidate does not.
- **G9**: `recovery.json` with the `resume` field is still restored by `parseRecoveryFile`, and a
  malformed `resume` never breaks the restore.
- **The locator**: finds a transcript under a second root, and records which root.

Also a daemon restart with requests pending: they survive, and the queue order is kept.

Count invocations with the fake port's own counter **and** with an independent marker the fake
writes to a temp file, so a no-op cannot pass. After everything is green, **mutate** the finished
code and confirm the suite notices. Report which tests each mutation turned red, and revert it.
The mutations:

- drop the pace check;
- make the gate use `onUnknown: "clear"`;
- treat every existing occurrence as settled;
- skip the synchronous recapture;
- drop the transcript-growth requirement.

Do not copy any uuid literal from another test file (`tests/fixture-ids.test.ts`).

## Gates

Report each command's exit code:

- your two suites, plus `tests/overseer-daemon-recovery.test.ts`, `tests/overseer-recovery*.test.ts`,
  `tests/overseer-launch-gate.test.ts` and `tests/fixture-ids.test.ts`;
- `npm run typecheck`: read the **exit code** and list every error. Only the Stage 2
  `recovery-feed.ts` error is expected;
- `npx biome lint` on your files (never `--formatter-enabled`).

## Report back

Briefly:

- the files you created or changed;
- the red→green counts;
- the mutations, and which tests each one turned red;
- the gate exit codes;
- every decision the plan did not settle;
- anything you needed outside your file set.

Do not paste code.
