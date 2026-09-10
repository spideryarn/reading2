# Gradual recovery: resume selected interrupted work, one at a time

The roadmap stage is
[260908f § Stage: Gradual recovery](260908f-overseer-and-fleet-improvement-roadmap.md#stage-gradual-recovery-resume-selected-valuable-work):
its four checkboxes and its acceptance paragraph are the spec, and this plan does not restate them.
Queue item `qi-pphwbz23`, session `gradual-recovery`, worktree `.claude/worktrees/recovery-resume`,
dispatched by the Overseer on 2026-09-10. It consumes two things built today:

- **[the recovery inventory](260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md)**
  (on `dev` at `3dc65697`). After a reboot the Overseer tab lists interrupted sessions, with the
  evidence for each: directory, transcript, classification, and whether resume is `supported`.
  Nothing on it acts.
- **the launch protocol** (plan `260910f-launch-protocol-…`, session `launch-protocol`, **not yet on
  `dev`**). This is the one crash-safe way the daemon starts a session. It has an occurrence per
  origin, attempts, an admission owner, and reconciliation after a crash.

## What this is for, in plain words

After a reboot, Greg opens the Overseer tab and sees, say, nine interrupted sessions. He wants to
bring back the three that matter, **one at a time**, so the box is not flattened by nine Claude
sessions starting at once. For each, he wants to see what it was doing and what we cannot be sure
of before he taps. Tapping twice, or losing the page's answer and tapping again, must not start two
copies. **Nothing resumes on its own.**

```
 Greg taps Resume ─▶ request file ─▶ daemon queue ─▶ gates ─▶ revalidate ─▶ launch protocol ─▶ tmux
 (dashboard)        (pending/<id>)   (oldest first)  health   dir, transcript,  (one occurrence  claude
                                                     usage    not already live   per candidate)   --resume
                                                     pace     nothing changed
                                      ◀──────────── the next one waits until this one is VERIFIED ───┘
                                                    (the daemon's existing `resumed` disposition)
```

## Measured before designing

- **The inventory already proves a resume happened.** Its `resumed` disposition is derived by the
  daemon when a live, verified execution holds the candidate's verified conversation **under a new
  run token** (`recovery.ts` `deriveDispositions`). That is exactly "metadata, pane and transcript
  identity verified": the fleet read `CLAUDE_SESSION_ID` from tmux, the process's own
  `--session-id`/`--resume` from `/proc`, and the pane. So the pace rule needs no new verifier. It
  waits for that disposition.
- **`gjd-remote new-claude` cannot resume today.** The job script always mints a new
  `--session-id` (`scripts/gjd-remote.ts` ~2769). Resume needs a new mode on the session-creation
  path, and that path is `launch-protocol`'s this week (see §6).
- **`claude --resume` semantics** are being measured by a spike (same session id or a new one;
  which directory it must run in; what a missing id does). The results go under "Spike" below,
  before Stage 3 relies on them.
- **The daemon holds both gate inputs.** Every accepted snapshot carries `health` (opaque JSON,
  `tools/fleet/health.ts` `Verdict.level`: `ok | strained | critical | unknown`), and the daemon
  keeps the latest `UsageReport` (`verdict.level`, `activeLimit.resetsAt`).
- **The fleet side may not import the store's graph** (`tests/fleet-attention.test.ts`, "imports
  only the Overseer modules that were argued for"). `recovery-inbox.ts` imports `diff.ts` and
  `recovery.ts`, so the route cannot reuse it. The request format has to live in a leaf.

## The design

### 1. A resume request is a file named by its candidate

The leaf is `tools/overseer/recovery-resume-request.ts`. It imports node builtins only, and both
the fleet route and the CLI use it: one definition of the format, and one new argued-for entry in
the fleet-attention allowlist. It works on `~/.overseer/recovery-resume/`:

```
recovery-resume/
  pending/<candidateId>.json   written O_CREAT|O_EXCL: the FILE NAME is the request-layer idempotence key
  done/<candidateId>.json      moved here by the daemon once the launch protocol has an answer
  refused/<candidateId>-<ms>.json   moved here, with the reason, when revalidation or the protocol refuses
```

A request is `{ v: 1, candidateId, requestedAt, actor: "dashboard" | "cli", nonce, seen }`.
`seen` is `{ checkedAt, conversationId, dir }`: what the person was looking at when they tapped.
A second tap while the first is pending gets `EEXIST`, and the route answers 200 *already
requested*, with the state. A tap after `done/` exists answers *already launched as `lo-…`*. It
writes nothing, and even if it did, the launch protocol would answer `not-launchable` for the same
occurrence. **Three layers stop a second copy: the file name, the occurrence id, and the pace
gate.** A refused request frees the name, so Greg can tap again after fixing the cause.

`scripts/overseer-recovery.ts` gains `resume <id>`, through the same leaf. It is the CLI twin of
the button, and it is what the drill drives.

### 2. The daemon's resume pass: one request per tick, gated, revalidated, launched

`tools/overseer/recovery-resume.ts` holds a pure decision and a thin pass.

```ts
decideResume(input) →
  | { kind: "defer";  why: string; until?: string }   // stays in pending/, the reason shown on the page
  | { kind: "refuse"; why: string }                   // moved to refused/, the reason shown; a re-tap is allowed
  | { kind: "launch"; spec: ResumeSpec }              // handed to the launch capability, same synchronous turn
  | { kind: "settled"; occurrence: OccurrenceSummary } // the protocol already has it: moved to done/
```

The daemon calls `recoveryResumeTick()` beside the existing `recoveryTick()`. It looks at **the
oldest pending request only** (`requestedAt`, then id). The checks run in this order, and the first
that fails decides:

1. **The capability**: the launch capability is not composed (before Stage 3), or the launch journal
   is `history-lost` → `defer`. Pending requests are kept, not refused, so that nothing Greg asked
   for is lost to a deploy order.
2. **The occurrence already exists** in the launch fold for `recoveryOrigin(candidateId)`. Then
   `settled` → `done/`. This is the lost-response and crash-after-launch path: the request is still
   pending, but the launch happened.
3. **Pace**, meaning one at a time. Another recovery occurrence is `launching`, `observed-running`
   or `outcome-unknown`, and its candidate is not yet `resumed` → `defer` ("waiting for *X* to be
   verified running"). There is no timeout that lets the next one through. An unverified launch
   blocks until the daemon verifies it, or Greg dismisses the candidate or disposes the launch, and
   the page says which. Also `defer` within `RESUME_SPACING_MS` (2 minutes) of the last
   verification, so each session's startup load lands before the next starts.
4–5. **Health and usage, through one shared gate.** `tools/overseer/launch-gate.ts` exports
   `launchGate({ usage, health, nowMs, onUnknown, usageStaleAfterMs }) → { kind: "clear"; notes }
   | { kind: "held"; why; until }`. A usage reading older than `usageStaleAfterMs` counts as
   unknown. The scheduler passes 30 minutes; recovery passes 15, which is three missed five-minute
   usage passes. It is a pure leaf: no I/O, no clock, types-only imports. It is agreed with
   `scheduled-dispatch`, which imports it rather than writing a second one, and it is built in
   Stage 1.
   - **Positive evidence always holds**: usage `limited` holds until `activeLimit.resetsAtMs`; usage
     `approaching` holds; health `critical` holds.
   - `strained` is clear, with a note.
   - **Unknown evidence goes to `onUnknown`.** That covers no usage pass yet, an unreadable report,
     and `unknown` or unparseable health. **Recovery passes `"hold"`; the scheduler passes
     `"clear"`.** For recovery this matches `routes-new.ts`'s rule for a hand-started session (Sol's
     F12 there: `unknown` health is the symptom). Resuming everything onto an unknown quota is the
     load spike the acceptance forbids. The scheduler's jobs run through `run-claude`, which records
     a usage refusal in `exit.json` anyway.

   See the question for Greg.
6. **Revalidation at execution**, all against the current state, never the view the person saw:
   - the record exists and is unresolved;
   - `classifyRecord(record, currentInventory)` is `interrupted`, recomputed now rather than read
     from the last view;
   - the inventory is trusted;
   - the harness is `claude-code` and there is a verified conversation;
   - `seen.conversationId` and `seen.dir` still match. If not → `refuse` ("changed since you
     looked");
   - no live row holds the conversation. If one does → `refuse` "already resumed elsewhere"; the
     existing derivation disposes it `resumed`;
   - the directory exists;
   - the transcript is found for the verified conversation. If not → `refuse` "the transcript is gone
     since the preview".
   The transcript search is async and bounded (the existing locator in `recovery-view.ts`). **The
   last step is synchronous**: a `statSync` of the found transcript path and of the directory,
   immediately before the launch call, with no `await` between them. So nothing can change between
   "checked" and "launched" except what a single event-loop turn allows.
7. `launch` → the launch capability, `LaunchProtocol["launchOccurrence"]`, from
   `composeLaunchProtocol` (`launch-protocol`'s correction: no consumer sees `LaunchParts` or a
   launcher). The request is `{ origin: recoveryOrigin(id), launcherKind: "tmux-resume",
   resume: { conversationId, dir }, material: <the nudge>, admissionClass: "recovery-resume" }`.
   The outcome maps onto the request:
   - `invoked` and `not-launchable` → `done/`;
   - `failed-before-launch`, `refused` and `conflict` → `refused/`, with the protocol's reason;
   - `waiting` → stays pending, deferred with the owner's reason;
   - `not-launched` → stays pending; reconciliation settles it, and the next tick sees case 2.

**The nudge** (the material) is fixed text with two values in it. Greg sees it before he taps:
*"This session was interrupted (the machine restarted at ‹time›). Re-read your plan and your last
messages, check `git status` in your worktree, and carry on from where you stopped. If you cannot
tell what you were doing, say so and stop."* It is the first thing typed. It grants nothing, and
the agent's permissions are what its settings say.

**Partial success across a list.** Greg taps three. The first launches and is verified. The second
is refused, because its transcript is gone. Two minutes after the first verification, the third
launches. Each request has its own state on the page, and one refusal never blocks the rest.

### 3. The page is fed by a second projection, not a change to `recovery.json`

The daemon writes `~/.overseer/recovery-resume.json` on each resume tick that changed something.
It holds the queue in order, each request's state, the current gate verdict and its reason, the
launch summary for each recovery occurrence, and a **preview** for each first-page record whose
resume is `supported`. It is a separate file because `recovery.json`'s schema and its strict fleet
parser are the inventory's contract, which shipped today. A new daemon with an old dashboard, or
the reverse, then shows "no resume data" and not "index unreadable".

**The preview is the previous objective and the uncertainty.** It holds:

- **the brief**: the first user message of the verified transcript. It is read from a bounded head
  (256 KiB) and capped at 600 characters;
- **where it got to**: the last assistant text. It is read from a bounded tail (256 KiB) and capped
  at 600 characters;
- **the title** it last had;
- **the uncertainty**: sentences derived from the record, never from prose, for example
  "`lastActivity` is only a floor", "the transcript was found by scanning, not at the expected
  slug", "the worktree name is display text, not a checked path", "the dashboard run could not be
  compared", "resuming continues a conversation whose last turn may have been cut off mid-action:
  it may redo or half-redo that step". Plus the fixed caveat that **a resume is not proof the work
  will finish**.

The transcript text is labelled as a quotation, and it is never a command and never a grant. The
reads are cached on `(path, size, mtime)`, so an unchanged transcript costs a `stat`.

### 4. The route

`tools/fleet/routes-recovery-resume.ts` handles two requests:

- **`GET /api/recovery/resume`**: the projection, parsed at the fleet boundary with its own
  validator, in the `recovery-feed.ts` arms `published`, `absent`, `unreadable` and
  `unsupported-schema`;
- **`POST /api/recovery/resume`**: `{ candidateId, seen }`. It gets `routes-new.ts`'s
  `checkRequest`: a same-origin `Origin` and a JSON content type, which is the CSRF defence on a
  tailnet-only server. The candidate id is checked against the leaf's regex, and the request is
  written through the leaf. The answer is 202 *queued*, or 200 *already requested / already
  launched*, each with the projection's state for that id.

The route **never launches, and never reads tmux or the launch store**. The daemon does both.
`tools/fleet/server.ts` needs one dispatch branch, which is outside my file set and **asked of the
Overseer** with the plan sha. `tools/fleet/wire.ts` gets one appended block of types, and no
imports.

The dashboard's action receipt journal (`action-receipts`) is not used. The request file is itself
the durable receipt, and idempotence comes from the candidate id, not from a client key. Named so
the reviewer can disagree.

### 5. The panel's first control

In `RecoveryPanel.tsx`, an `interrupted` record whose resume is `supported` gets **Resume…**. It
opens an inline confirmation, not a dialog (house rule: no dialogs on this page). The confirmation
shows the brief, where it got to, the uncertainty list, the nudge that will be typed, the directory,
and one line: *"Starts one session. Any others you pick wait until this one is seen running."* Its
button is **Resume this session**.

After the tap, the card shows the request's state from the projection:

- queued, with its position;
- deferred, with the gate's reason and `until`;
- launching;
- running, unverified;
- **resumed**, the existing disposition;
- refused, with the reason and **Resume…** offered again.

Records whose resume is `not-supported` or `manual` get **manual instructions** instead of a
button. For a Claude conversation with a verified id, whose resume the harness path cannot take:
`gjd-remote ssh`, then `cd ‹dir›`, then `claude --resume ‹uuid›`, built only from a uuid that
matches the regex and a directory that is shell-quoted. For a shell or manual job: the host and the
directory, as today. `unknown`, `present-but-unmatched` and `ended-before-reboot` records get
neither. **Unchanged unknowns stay visible and untouched.**

The footer changes from "Read-only. Nothing on this page starts, resumes or dismisses anything." to:

> The one control here is **Resume**: it asks the Overseer to start that one interrupted Claude
> session again, after checking the box, the quota and the session's evidence. Others you pick wait
> their turn. Nothing resumes on its own, and nothing here dismisses anything.

### 6. The launcher (Stage 3, after `launch-protocol` Stages 1–2 are on `dev`)

This was agreed with `launch-protocol`, 2026-09-10:

- **A launcher kind `tmux-resume`.** Its `PlanRequest` arm carries
  `resume: { conversationId: uuid; dir: absolute }`. The arm is recorded in `planned` and in
  `intent.json`, and it is part of F5's conflict check. Their Stage 2 makes `PlanRequest` a union
  keyed on `launcherKind`, so I add one arm, and the compiler lists every switch to extend.
- **The adapter** runs `gjd-remote new-claude … --resume-conversation <uuid> --dir <dir>
  --launch-id … --launch-dir …`. The material is the nudge alone; the adapter never parses it.
- **`scripts/gjd-remote.ts` gets `--resume-conversation <uuid>`**, a small targeted edit on the
  session-creation path. It is mutually exclusive with minting a `--session-id`, and it still sets
  `CLAUDE_SESSION_ID=<uuid>` in `-e` at creation. It keeps Stage 2's `start.json` first line and its
  `exit.json` line after `claude`. The job runs `claude --resume <uuid> --permission-mode auto --
  "$(cat prompt)"`, or whatever the spike shows is correct.
- **What `launch-protocol`'s Stage 2 settled** (`3858a4a9` on its branch, 2026-09-10; it reaches
  `dev` after its Stage 1b fixes):
  - `PlanRequest` is a union keyed on `launcherKind`. `run` is required for `headless` and
    `tmux-headless`, and forbidden for `tmux`. The `tmux-resume` arm adds `resume: {
    conversationId, dir }` the same way.
  - gjd-remote's launch pieces are pure functions in `scripts/gjd-remote-launch.ts`:
    `parseLaunchFlags`, `launchBoxCheck`, `launchStartLines`, `launchExitLines` and
    `launchTmuxFlags`. `gjd-remote.ts` has four small insertions behind `--launch-id`.
    `--resume-conversation` goes beside them, with `start.json`'s line kept ahead of the directory
    guard, and `exit.json`'s right after `_gjd_claude_status=$?`.
  - gjd-remote's stdin is a complete regular file (the material plus a newline), not a pipe. The
    adapter refuses anything over gjd-remote's 96 KB prompt cap; the nudge is far below it.
  - The tmux adapter answers `started` once gjd-remote has a pid. A later gjd-remote failure
    surfaces as `outcome-unknown`, through reconciliation.
  - **A new tmux session takes its environment from the client that creates it, not from the
    server.** The daemon, through gjd-remote, therefore passes its own environment into a resumed
    session, and Stage 3 composes the launchers with a deliberate `env`. For a pinned account, the
    config directory comes from `--account`'s `CLAUDE_CONFIG_DIR` prefix, never from whatever the
    daemon happens to have.
- **What `launch-protocol`'s Stage 1b settled** (`9662df2f` on its branch, on top of Stage 2; not on
  `dev` until its checks finish):
  - `OccurrenceSummary` is `{ occurrenceId, state, attempt, reservationHeld, disposed, endedAt,
    completion }`. It is a frozen copy: mutating one throws. `attempt` is the latest attempt made,
    null before any.
  - `LaunchProtocol` gains `inspect(origin)` and `inFlight(originKind)`. "In flight" is `planned`,
    `waiting-admission`, `reserved`, `launching`, `observed-running` or `outcome-unknown`, **plus
    any record whose reservation is still held**.
  - `failed-before-launch` carries `reservation: released | held`, the actual release result.
  - `usesTmux(kind)` is an exhaustive switch; `tmux-resume` adds its arm there.
  - `admissionPolicy("recovery-resume")` is `{ capacity: 1, holdUntil: "observed-running" }`. The
    release happens when reconciliation records `observed-running`, even after a crash between the
    record and the release.
  - `AttemptRef` no longer carries `artefactDir`.
  - **`inspect` answers `null` for an occurrence carried over a history reset**, and `inFlight`
    omits it, yet `launchOccurrence` still refuses it as `not-launchable`. So Stage 3's port adapter
    must read **a `null` inspect followed by a refusal as "held by a history reset"**, which is a
    `refused` request that names the reset and never counts as free to launch. A test says so.
- **An admission class `recovery-resume`**, capacity 1, **released on `observed-running`**. From
  there it is an ordinary interactive session, and its hours of life must not block the scheduler's
  `claude-session` class. `launch-protocol` is building this in its next fix round. My pace rule
  (§2.3) governs everything after that point.

### 7. Drills, in a disposable store and on an isolated tmux socket

`scripts/overseer-recovery-drill.ts` is **extended, not forked**. After its existing
G1 → empty → G2 run, a `--resume` phase runs against the drill's scratch store with a scratch
launch store and a private tmux socket (`tmux -L <drill>`). A fake `claude` on that socket writes
a transcript line and sets the session environment the collector reads. The phase:

- requests two candidates;
- asserts one launch, a defer until verification, then the second launch;
- **kills the daemon between the launcher's invocation and the move to `done/`**, restarts it, and
  asserts no second invocation;
- taps a third twice and asserts one request;
- deletes a transcript after the preview and asserts the refusal.

Every count is independent of the protocol's own counter: the marker the fake writes on the
socket. It never uses the default tmux server or `~/.overseer`, and it never reboots the box.

## Review dispositions: Sol, plan round 1 (these override §1–§7 wherever they differ)

[The review](260910f-gradual-recovery-plan-review-sol.md) is read-only, at `e1615d30`. Its verdict
was *not ready*: eight established P1s (G1–G8) and two P2s (G9, G10). **All ten are accepted.** I
checked each against the code before accepting it, and G4 turned out to be wider than Sol stated.
The sandbox refused Sol's findings file, so the answer file is the whole record.

- **G1 (P1): "an occurrence exists, so it is settled" was wrong. Accepted.** §2's step 2 becomes an
  exhaustive table over the occurrence's state, whether its reservation is held, and whether it is
  disposed:

  | occurrence | the request |
  |---|---|
  | none | continue through the gates and revalidation |
  | `failed-before-launch`, reservation released, not disposed | **continue into attempt 2**, through the gates and revalidation again |
  | `failed-before-launch`, reservation still held | `defer` ("the last attempt's slot has not been released yet") |
  | `planned`, `waiting-admission`, `reserved` | `defer`, with the protocol's reason |
  | `launching`, `observed-running` | `settled`, meaning `done/`; the page shows the launch |
  | `outcome-unknown` | `settled`; the page shows it as needing Greg's `dispose` |
  | `completed` without a verified resume | `settled`, **with its own page state, "ended before it was seen running"**, and the exit code or "rebooted" |
  | disposed | `settled`, with the disposition |

  A `switch` with a `never` check, not an `if` chain. The tests cover a failed release, a retry
  after the release, `not-launched` in each folded state, and an exit before verification.
- **G2 (P1): `resumed` does not verify the transcript. Accepted.** The inventory's
  `deriveDispositions` matches a verified execution and conversation. It never reads a transcript,
  and `execution-identity.ts:44-51` says it does not establish which transcript is being written.
  **The pace rule now waits for "verified", defined as all four of:**
  - the inventory's `resumed` disposition for the candidate;
  - the launch protocol showing that occurrence `observed-running`, with its correlation evidence;
  - the transcript for the conversation having **grown since the launch's `at`** (size and mtime
    past the values recorded at revalidation);
  - a bounded tail read (64 KiB) holding at least one line after the launch instant with that
    `sessionId`.

  A live process whose transcript does not grow stays unverified, and it blocks the queue,
  visibly.
- **G3 (P1): version skew between the daemon and the collector. Accepted.** The fleet's `/api/state`
  payload gains a `capabilities: string[]` field. The collector declares `"argv-resume-uuid"` from
  the build that reads `--resume <uuid>`. `observation.ts` parses the field as optional, with
  absent meaning none. **The resume pass defers before launching** ("the dashboard collecting this
  box cannot yet verify a resumed session; it needs a restart") until an accepted snapshot declares
  that capability. This is Stage 3, and it is a producer change in `state.ts`/`wire.ts`/`observation.ts`,
  which I will ask the Overseer to approve with the argv change. Tests: a new daemon with an old
  producer defers; an old daemon ignores the field.
- **G4 (P1): the quota gate was stale and about the wrong account. Accepted, and it is wider than
  Sol said.** The freshness half is fixed by `usageStaleAfterMs` (15 minutes, on `dev` in
  `ce633d8c`). The account half:
  - **a resumed conversation must run under the account whose config directory holds its
    transcript.** `gjd-remote` starts pool sessions with `CLAUDE_CONFIG_DIR=<account stateDir>`
    (`scripts/gjd-remote-account.ts:186`), and `--resume` only finds a conversation in its own
    config directory's `projects/` (the spike);
  - **the account is therefore pinned by where the transcript is found, never `auto`**;
  - **the quota gate is about that account.**

  The inventory's locator searches only `~/.claude/projects` (`recovery-view.ts:172`), and nothing
  the collector records names an account. So today a pool session's transcript may simply never be
  found.

  **Measured 2026-09-10** (read-only research, box state at ~19:40):
  - **Every account shares one transcript directory.** `~/.claude-gregmindstone/projects` is a
    symlink to `~/.claude/projects`, made by the account seeding (`scripts/claude-accounts.ts`
    ~714). There are 14 live `claude` processes: 8 under the `mindstone` config directory, 6 on the
    default `~/.claude`. All of their transcripts are under `~/.claude/projects`. So the inventory's
    locator does find them today, but by coincidence of layout, not by design.
  - **The account a conversation ran under is on disk.** `~/.claude-accounts/reservations.ndjson`
    maps `sessionUuid` to `accountName`, and every `gjd-remote new-claude` writes a row. Checked
    against the 13 live conversation ids: all 7 `mindstone` sessions have a row, and the 6
    default-login ones have none.
  - **An explicit `--account <name>` checks no quota** (`resolveForLaunch`,
    `scripts/claude-accounts.ts` ~1320–1350). It reserves and returns. Only `auto` reads live
    per-account usage (`readUsage`, `tools/overseer/accounts.ts:418`: two token-free HTTPS calls)
    and drops exhausted accounts. There is no cached per-account reading on disk.
  - The default login is not a registered account, and **gjd-remote cannot launch on it by name
    while pool accounts exist.**

  **So:**
  - **Finding the transcript**: the locator's roots become `~/.claude/projects` plus each registry
    account's `<stateDir>/projects`, each resolved by `realpath` and deduplicated.
  - **The account is pinned** from the conversation's last `reservations.ndjson` row, and passed
    as `--account <name>`, never `auto`, so a resumed session stays on the account it started on.
  - **No row means the default login.** That is `account: unknown` ("started on the default login,
    which gjd-remote cannot relaunch by name"), and gets manual instructions (`claude --resume`
    with no config-dir prefix). **Moving such a session onto a pool account is a product call for
    Greg**: it would work, because the transcript directory is shared, but it changes whose quota
    the session spends.
  - **The quota gate is the pinned account's own reading, taken from the daemon's `accountUsage`
    checkpoint field.** That is `StoredAccountUsage`, on `dev` since `74634fd3`, from
    [usage-per-account.md](../project/usage-per-account.md): one live reading per account,
    collected on each usage pass. Recovery makes **no network calls of its own**: a second reading
    of one subscription would disagree with the page's by a point or two, which that doc names as
    worse than either reading alone. The first draft of this entry had recovery call `readUsage`
    behind a 5-minute cache; that was superseded the same evening, before any of it was built.
    - The section used must be for the pinned registry name, in the `claude` family, **with a
      non-null provider account id**.
    - Its freshness is judged by that section's own `takenAt`, not by the pass's, with the same 15
      minutes.
    - `StoredAccountUsage` `none`, a missing section, an unproved identity, a stale `takenAt`, or
      a non-empty `problems` list naming the registry all count as unknown, and recovery holds on
      unknown.
    - It is judged by a new `accountQuotaGate(reading, nowMs, onUnknown)`, added to
      `launch-gate.ts` beside `launchGate`, with the same holding rules: a window at 100% or more
      holds until its reset; 80% or more holds; unreadable goes to `onUnknown`.
    - `launchGate` is unchanged, so it stays `scheduled-dispatch`'s contract. Recovery combines
      the health half of the gate with the account half. The ambient usage report is about the
      default login, and **is not used for a pinned pool account**.
    - `scheduled-dispatch` is told about the new export.
  - **For the Overseer, not built here:** explicit `--account` skipping the quota check is a
    gjd-remote behaviour every explicit launch inherits.
- **G5 (P1): revalidation came before an async gap. Accepted.** The pass does all of its async work
  first: the transcript locate, the tail read and the preview. Then, **in one synchronous
  stretch**, it recaptures the latest accepted observation and repeats every check: the
  classification, the resolution, the conversation, "no live row holds it", `seen`, the directory
  and transcript `statSync`, the gate, the pace and the occurrence table. Only then does it call
  `launchOccurrence`. The prose claim is narrowed: a synchronous turn freezes the daemon's own state
  and nothing else, so a person typing `claude --resume` into a shell in that window is not
  prevented. That window is what gjd-remote's on-box check (§6) and the verification (G2) are for.
  Test: pause the transcript locate, inject a newer accepted snapshot with a live matching
  execution, and see zero invocations.
- **G6 (P1): the seam had no way to read the protocol's state. Accepted.** Asked of
  `launch-protocol`: a read-only `inspect(origin)` and `inFlight("recovery")` on the composed
  `LaunchProtocol`, returning immutable summaries `{ occurrenceId, state, attempt,
  reservationHeld, disposed, endedAt, completion }`, with no journal and no `LaunchParts`.
  **Agreed by `launch-protocol`, 2026-09-10**, in its Stage 1b fix round, which lands with its
  Stages 1–2. "In flight" there also includes any record whose reservation is still held, which is
  the safe direction for the pace rule. The same round gives `failed-before-launch` a
  `reservation: released | held` result (G1), and makes `usesTmux(kind)` exhaustive (G7). Stage 1's
  `ResumeLaunchPort` already has exactly this shape (`occurrenceOf` and `inFlight`), plus the two
  flags.
- **G7 (P1): reconciliation probes tmux only for `launcherKind === "tmux"`**
  (`launch-protocol.ts:1405`, on its branch). **Accepted, and it is `launch-protocol`'s code.** I
  have asked for an exhaustive `usesTmux(kind)` that includes `tmux-resume`, and the crash test (a
  tmux effect, no `start.json`, and reconciliation reaching `observed-running`) goes in Stage 3
  either way.
- **G8 (P1): disposal did not clear the pace predicate. Accepted.** Pace blocks only on
  **undisposed** occurrences that are not yet verified (G2). **Only the protocol's `dispose` waives
  it.** Dismissing the candidate does not, because a dismissed candidate's session may still be
  running and still loading the box. The page names the exact `dispose` command for the blocker.
  Both controls are tested.
- **G9 (P2): the second projection was not needed. Accepted.** `parseRecoveryFile`
  (`store.ts:2783`) and the fleet's `projectPublished` ignore unknown top-level fields, and the
  existing `view` was added beside the fold without a schema bump. So the resume projection goes
  in as an **optional `resume` field beside `view` in `recovery.json`**, written by the same
  checkpoint. An old dashboard ignores it. A new dashboard treats its absence as "resume not
  available here" and never lets it hide the base list; a test asserts that a malformed `resume`
  leaves the records readable. **Gone:** the separate file, `recovery-resume-feed.ts`, the GET
  route and its poll. **The POST route stays**, and so does its `server.ts` branch.
- **G10 (P2): the file name was only pending-coalescing. Accepted.** Request files are
  **nonce-named** (`pending/<candidateId>--<nonce>.json`, the inventory inbox's shape). The daemon
  coalesces them by candidate, and **the launch occurrence is the only duplicate-launch
  guarantee**. A second tap writes a second file, which the pass settles against the same
  occurrence. The route still answers "already requested" when the projection or `pending/`
  already shows the candidate, but as a courtesy, not a guarantee.

**Simpler design, as Sol put it**, and adopted: an explicit inbox, nonce requests with the
occurrence as the idempotence, the projection inside `recovery.json`, one narrow inspection
capability, one post-launch transcript verifier, and an exhaustive state table.

## Deliberately not here

- **Anything automatic.** No policy resumes on its own after a reboot. See the question for Greg.
- **Codex resume, or headless resume.** These records stay `not-supported`, with manual
  instructions.
- **A bulk "resume all" button.** Greg can tap several, and they queue.
- **Retrying an `outcome-unknown`.** Only Greg's dispose (the launch CLI) ends one.
- **Per-account quota.** The usage verdict is the daemon's one report. A resumed session launches
  `--account auto` like any fleet launch. Per-account admission is a later concern.
- **A dismiss button.** Still the CLI.

## The simpler options passed over

- **Refuse instead of queue**: if a gate is closed, answer "try later" and hold nothing. That is
  simpler, but the roadmap asks for *deferral*, and after a reboot the gates are closed exactly when
  Greg is picking. He would have to come back and tap again at the right moment.
- **The queue in the launch journal**: `plan()` at tap time, the owner's `wait` as the deferral.
  That would put the queue inside a store that is not on `dev`, make revalidation a protocol
  concern, and give a refusal at revalidation no record to land in. The request files use the
  inventory's existing drop-directory shape.
- **New arms in `events.jsonl`**, for requested and refused. Every request would then touch
  `store.ts`, `diff.ts`, `jobs.ts` and `status-cli.ts`, which is what the inventory's Stage 1 had to
  do. Files already hold the state, and the launch journal is the durable record of every launch.
- **Adding the resume state to `recovery.json`**: that is a schema bump on a contract that shipped
  today, and it would turn a version skew into "index unreadable" (§3).

## A question for Greg, not built: should anything ever resume without a tap?

Today, after a reboot, nothing comes back until you pick it. A broader policy could, for example,
auto-queue every `interrupted` Claude session whose last work report was `progress` and less than
an hour old, and still start them one at a time through the same gates. It would save you the
tapping after an unattended reboot. It would also bring back sessions you might have let go, and
spend quota while you are away. **This plan builds only the tap.** If you want a policy, it would
reuse this whole path (the queue, the gates, the pace rule), and the question is only which records
qualify. My recommendation is not yet: see how often a real reboot happens, and how many sessions
you actually pick.

A smaller question sits beside it. **Should an unknown usage reading hold resumes?** This plan
says yes, failing closed (§2.5). The cost is that resumes wait whenever the usage pass has not run,
for example for five minutes after a daemon restart.

A third comes from G4. **Should a session that started on the default login be resumable onto a
pool account?** It would work, because the transcript directory is shared, but it changes whose
quota the session spends.

**The Overseer's defaults pending Greg, 2026-09-10, and built to:**
- (1) nothing resumes without a tap;
- (2) an unknown usage reading holds resumes, failing closed;
- (3) default-login sessions are manual-only in v1.

gjd-remote's explicit `--account` skipping the quota check is queued separately as
`qi-pbmemdfh`, for the launcher.

## Stages

Implemented by **Opus subagents** in this worktree. Stages 1 and 2 run in parallel, because their
file sets do not overlap: I write the `wire.ts` types first, as the contract both of them build
against. Each stage ends with one GPT Sol review (`--effort high --timeout-minutes 90`,
findings written first to `<answer>-findings.md`), then an Opus fixer, then a narrow 20-minute
check of the P1 fixes, then Fable.

### Stage 0: this plan, reviewed

- [ ] Sol plan review, read-only.
- [ ] Plan sha to the Overseer, with the one out-of-set ask (`server.ts`, one branch).

### Stage 1: the request, the decision, the daemon pass, the projection (no protocol needed)

Files:

- `tools/overseer/recovery-resume-request.ts` (new leaf);
- `tools/overseer/launch-gate.ts` (new leaf, shared with `scheduled-dispatch`: built and committed
  first, and its sha sent to them);
- `tools/overseer/recovery-resume.ts` (new: `decideResume`, the gates, the preview reader, the
  projection writer, and the `ResumeLauncher` port that stands in for the launch capability until
  Stage 3);
- `tools/overseer/daemon.ts` (one `recoveryResumeTick()` beside `recoveryTick()`, and the
  projection write; small targeted edits, merged first, away from the usage pass);
- `scripts/overseer-recovery.ts` (`resume <id>`);
- `tools/fleet/wire.ts` (the appended block, written by me first);
- tests `tests/overseer-recovery-resume.test.ts` and `tests/overseer-daemon-recovery-resume.test.ts`.

Red first, through the real leaf, the real `classifyRecord` and a fake `ResumeLauncher` that keeps
the protocol's rule (one occurrence per candidate):

- **Two taps**: the second `EEXIST` gives one pending request and one invocation.
- **Launch succeeded, response lost**: the launcher is invoked and the daemon dies before the move
  to `done/`. The restart sees the occurrence (`settled`), gives no second invocation, and moves the
  request to `done/`.
- **Already resumed elsewhere**: a live verified row holds the conversation. That gives `refuse`
  and no invocation.
- **Missing transcript after preview**: the preview was `found`, then the file is deleted. That
  gives `refuse`, and a re-tap is allowed.
- **Partial success across a list**: three requests. A is invoked; B is deferred until A is
  `resumed`. B is then refused (its directory is missing). Two minutes after A's verification, C is
  invoked. That is exactly two invocations.
- **Gates**: `critical` and `unknown` health defer; `limited` defers until `resetsAt`;
  `approaching`, and usage `unknown`, defer. `strained` and `ok` pass. A deferred request is never
  refused.
- **Changed since you looked**: `seen.dir` differs from the current entry. That gives `refuse`.
- **Unknowns stay put**: an `unknown` or `ended-before-reboot` candidate requested through the CLI
  is refused, and its record is unchanged.
- **Unwired capability**: requests defer and stay pending. Nothing is refused, and nothing is
  invoked.
- **Preview bounds**: a 10 MiB transcript reads at most 512 KiB, and the text is capped.

### Stage 2: the route and the panel (in parallel with Stage 1)

Files:

- `tools/fleet/routes-recovery-resume.ts`, `tools/fleet/recovery-resume-feed.ts`,
  `tools/fleet/web/src/recovery-resume-client.ts` (all new);
- `tools/fleet/web/src/RecoveryPanel.tsx`;
- `tools/fleet/server.ts`: one branch. **Approved by the Overseer, 2026-09-10**, as one minimal
  dispatch branch beside `/api/recovery`'s, pinned by the wiring test, for a route that writes an
  `O_EXCL` request file and never launches. Merge first: `access-review` may extract `server.ts`'s
  handler construction this evening, so re-read before the edit;
- `tests/fleet-attention.test.ts` (one allowlist entry, argued);
- tests `tests/fleet-recovery-resume-route.test.ts` and `tests/fleet-recovery-resume-panel.test.tsx`.

Red first:

- the POST refuses a missing `Origin`, a foreign `Origin` and a non-JSON body;
- a second POST answers 200 and writes nothing new;
- the feed's four arms, with no path from a failure to "nothing queued";
- the confirmation shows the brief, the uncertainty and the nudge, and the button appears only for
  `interrupted` with `supported`;
- manual instructions are never built from an id that fails the regex;
- the footer says what the control does;
- a browser check at 1280 px and 400 px by an Opus subagent, on its own fixture server and never on
  8787.

**Stages 1 and 2, 2026-09-10 ~21:00: committed together as `cfc963eb`, and on `dev` in `f72a4a7e`.**

The merge from `dev` (`bef22460`) brought in `accountUsage`. `1704334e` wires the daemon's own
reading into the pass, and swaps the local type copies for `dev`'s. On the merged tree:

- typecheck exit 0;
- 15 files / 437 tests passing;
- `build:fleet` exit 0.

**Sol's stage review, read-only and findings-only, 2026-09-10 21:13: *refuse*, on nine established
P1s** ([the review](260910f-gradual-recovery-stage1-2-review-sol.md),
[the prompt](260910f-gradual-recovery-stage1-2-review-sol-prompt.md)). All nine go to one Opus
fixer, red first. The fixer is to disagree with any it can refute in the code.

- **G11:** the account was resolved before an await, then reused inside the synchronous stretch.
  The fix: recheckable ledger and registry evidence, re-validated synchronously.
- **G12:** a transcript line from before the launch could satisfy verification. **The fix differs
  from Sol's**, so that it needs no protocol change: the matching line must *begin after the byte
  offset* recorded in `attempts/<id>.json` before invocation.
- **G13:** a `planned` or `waiting-admission` occurrence never moved again. The fix: a
  synchronous `drive(candidateId)` on the port, asked of `launch-protocol`.
- **G14:** an immediate `failed-before-launch` was refused, contradicting G1. The fix: released
  continues into attempt 2; held defers, visibly.
- **G15:** a malformed or oversized ledger row could pin the wrong account. The fix: the real
  record validator, and a truncated first fragment dropped.
- **G16:** a failed terminal move was projected as success. The fix: `headMoved` only when every
  file moved, otherwise an explicit error.
- **G17:** manual instructions for an unknown account omitted the config-directory warning. The
  fix: a reason code, with the plain command only for the proven default login.
- **G18:** a queued request for an absent candidate vanished at `store.ts`'s filter. This was my
  suspicion 1, confirmed. The fix: the route refuses an absent candidate, and orphans are
  projected, never dropped.
- **G19:** a terminal occurrence still holding its reservation blocked the queue for ever. The fix:
  it is `needs-greg`, with the dispose command, and a named pace blocker.

**The fix pass, 2026-09-10 ~21:00 (an Opus subagent).** All nine findings were checked against the
code, and none was refuted. Each was fixed red first, and each has a mutation that turns its test
red. Decisions it recorded:

- **G12:** no timestamp check at all. Only the byte offset proves a line came after the launch.
- **G14:** retries after a released failure are not capped. The plan names no cap.
- **G15:** a bounded read cannot attribute an oversized line whose id sits before the 4 MiB window.
  That case is `unknown`, and is not called the default login.
- **G17:** the reason codes are `default-login`, `ledger-unreadable`, `ledger-ambiguous`,
  `account-unusable`, `transcript-elsewhere`, `no-transcript` and `not-resolved`.
- **G18:** the route blocks only when the index is readable. A missing orphans list reads as none,
  so a new dashboard works with an old daemon.
- **G19:** `needs-greg` outranks `resumed`: a slot still held after a verified resume needs Greg.

**Landed with Stage 3a** in `325a9acc`, because they share `wire.ts`, `recovery-resume.ts` and the
resume tests. `18806dd7` clears a lint error on a Stage 1 line (`position += 1` inside an
expression). Both are on `dev`, the last pushed at `18806dd7`. The manager's run on the merged tree:

- typecheck exit 0;
- 22 files / 794 tests, including `no-raw-nul-bytes`;
- `access-review`'s new `fleet-composed-access`, 76 of 76.

One biome warning remains, pre-existing and hidden past the diagnostics limit. Lint is advice here,
not a gate.

**Sol's narrow check of the nine fixes, 2026-09-10 ~21:06, read-only**
([the answer](260910f-gradual-recovery-stage1-2-fixcheck-sol.md),
[the prompt](260910f-gradual-recovery-stage1-2-fixcheck-sol-prompt.md)): **G11–G19 are all closed.**
Sol ran one file itself, 66 of 66.

**It found one new defect that a fix introduced: G20, a P1, established.** The G12 reader read a
first 64 KiB window, dropping its cut-off last line, and read the last 64 KiB only when that tail
started past the first window. So when the file had grown by between one and two windows, the rest
went unread. A session line just past one long unrelated line was never seen, which would block
verification, and the queue, for ever.

- **Fixed by the manager, red first.** Growth that fits in two windows is now read as one
  contiguous piece. The bound stays at most two windows plus one byte.
- **Evidence:** the new test was red (`sessionLineSeen` false), then green. The file passes 67 of
  67, and typecheck exits 0.
- **Discovery closed** with the narrow check, so **Fable settles G20** (not cross-family), per the
  engineering-manager rule and the Overseer's terms.

**Fable's settle, 2026-09-10 ~21:20 (not cross-family): "G20: closed."** Fable traced the diff,
ran the file (67 of 67), and drove the real `transcriptAfter` at the boundaries, with files on disk
and a count of the bytes requested:

- **the contiguous branch** handles a file with and without a trailing newline, and a torn final
  line;
- **the non-contiguous branch** starts its tail strictly after the first window, so no line is
  read twice;
- **the bound** is exactly 131,073 bytes at both `2V+1` and `2V+2`.

**One overstatement corrected** in the code's comment. Not every transcript line carries a
`sessionId`: about 1–1.5% are `file-history-snapshot` lines without one, and 18–31 lines per
transcript are tool results over 64 KiB.

**The residual, documented rather than closed:** beyond two windows, a pass whose last 64 KiB is
one oversized tool result, or holds only snapshot lines, sees no session line. The next pass
re-reads, and a live session soon writes one. So it is transient.

**Stages 1 and 2 are then done:** built, reviewed by Sol (refused on G11–G19), fixed, and
narrow-checked. G20 was fixed and settled.

## Where this stops: Greg's reprioritisation, 2026-09-10 ~21:10

**Greg, via the Overseer:** Overseer and dashboard work drops to the bottom of the priorities, and
Spideryarn product work comes up. So this plan lands Stages 1–2, and stops. **Stage 3 is not
started.**

- **Stage 3a is already on `dev`, and has not been reviewed.** It is the argv reader's
  `--resume <uuid>` arm and the producer capability, and it landed in `325a9acc` with the G11–G19
  fixes, because they share `wire.ts`, `recovery-resume.ts` and the resume tests. It has had **no
  Sol review**, although the Overseer's condition (c) asked for one, because `claude-argv.ts` feeds
  steer's wrong-conversation guard. Its own red-first tests and its four mutations are its only
  evidence. **A decision for the Overseer or Greg:** a narrow Sol check of Stage 3a, which is the
  argv arm alone, or a revert. Until one of them happens, it is live code in the fleet's argv
  reader.
- **Stage 3b is briefed, not built.** The brief is [the 3b task](260910f-gradual-recovery-stage3b-task.md):
  - the `tmux-resume` launcher arm;
  - gjd-remote's `--resume-conversation`, with the on-box duplicate check;
  - the adapter from the port to the protocol's `launchOccurrence`, `resumeOccurrence`, `inspect`
    and `inFlight`;
  - the daemon's composition of all that;
  - the `--resume` drill.

  It needs `launch-protocol`'s Stages 1, 1b and 2 on `dev`. Until 3b exists, **the resume port is
  `unwired` in production**: a tap queues a request, the page shows it pending, and nothing
  launches. The page says so ("Resume is not available from this dashboard yet"), and gives manual
  instructions.
- **Still a question for Greg:** the capability-marker default. Stage 3a puts
  `"argv-resume-uuid"` on the observation, never in held state, as an assumption pending Greg.

**A raw NUL and a raw SOH byte shipped in `cfc963eb`.** They sat in a string literal on line 251
of `tests/overseer-recovery-resume.test.ts`: the parser test's control-character input, typed as
an escape that landed as bytes. That turned `tests/no-raw-nul-bytes` red on `dev` for every
session, and made git treat the file as binary. `access-review` reported it through the Overseer.

- **The fix**, `b9479b79`, in `7e0c300c` on `dev`, 2026-09-10 ~21:00: the same two characters,
  written as Unicode escape sequences **by a script, not by typing**.
- **How it was pushed:** on its own, from a side worktree based on `origin/dev`, because the
  fixer was mid-edit in the same file here.
- **The same accident nearly happened twice more.** The first draft of that fix's commit message,
  which named the two escapes, came out holding the raw bytes too. It was caught by a `cat -v`
  check before committing, and rewritten to describe them in words.
- **One cost of the side worktree:** switching this session into it moved the running fixer's
  isolation with it. The fixer's G11 edits were refused mid-change, and it was resumed once the
  session came back.

**Stage 1 status, 2026-09-10 ~20:05: built by an Opus subagent. Uncommitted in the worktree, and
not yet reviewed** (paused by the Overseer for the `mindstone` five-hour window).

- **What landed:**
  - `recovery-resume-request.ts` (the leaf);
  - `recovery-resume.ts`;
  - small edits to `launch-gate.ts`: `healthGate`, `accountQuotaGate`, `bothGates`, and local
    copies of `dev`'s account-usage types, replaced at the merge;
  - `recovery-inbox.ts`, `recovery-view.ts` (the multi-root locator), `store.ts` (the optional
    `resume` field), `daemon.ts` (`recoveryResumeTick`) and `scripts/overseer-recovery.ts`;
  - two suites, plus shared fakes.
- **Tests:** 60 tests. They were written after the code, so red was shown by five mutations, each
  turning its tests red.
- **The manager's own changes after the build:**
  - **codename windows**. The builder found that the live endpoint's 0%-with-no-reset codename
    windows would have held every resume for ever. `five_hour` and `seven_day` are now required,
    and a codename window counts only with a number. It went red first:
    `tests/overseer-account-quota-gate.test.ts`, 3 red and then 7 green;
  - the shared fake gained a `seven_day` window.
- **The combined tree, the manager's run:**
  - 8 files / 224 tests pass;
  - typecheck exit 0;
  - Stage 2's own gates as above.
- **Still to do at the merge:** wire `dev`'s real `accountUsage` into the pass. Until then, the
  daemon's default is "no reading", so the gate holds.

**Stage 2 status, 2026-09-10 ~20:00: built by an Opus subagent. Not yet committed** (it commits
with Stage 1, because the route imports Stage 1's request leaf) **and not yet reviewed.**

- **What landed:**
  - `routes-recovery-resume.ts` (POST only);
  - `recovery-feed.ts` parsing the `resume` section;
  - `recovery-client.ts` and `RecoveryPanel.tsx` (the control, the seven state lines, the pace
    line, manual instructions, and the §5 footer);
  - `server.ts`: one import, one construction, one dispatch line, **placed before
    `/api/recovery`'s**, because that route claims every path under it. The wiring test fails if
    the order is swapped;
  - one argued `fleet-attention` allowlist entry.
- **Red then green:**
  - feed: 7 failed, then 35 passed;
  - route: 35 failed against a stub, then 38 passed;
  - panel: 19 failed, then 37 passed;
  - wiring: 3 failed, then 15 passed.

  The browser parser was written before its tests. Mutation 5 is the proof they can fail.
- **Five mutations**, each turning its test red and each reverted:
  - a POST without `Origin`;
  - Resume… offered for an unknown account;
  - manual instructions built from a non-uuid;
  - an unreadable section blanking the records, server-side and browser-side.
- **Gates**:
  - focused suites 218 of 218, exit 0;
  - `build:fleet` exit 0;
  - typecheck exit 0;
  - lint shows no errors;
  - the manager's own re-run of `fixture-ids` and the route test is 43 of 43.

  The builder's first gate run failed `fixture-ids`, on a uuid it had copied between two test
  files. It fixed that itself.
- **The browser check**, on its own server (8795; 8787 untouched), at 1280 px and 400 px:
  - exactly one card offered Resume…, and a refused card offered it again;
  - one tap wrote exactly one `pending/` file, and a second tap said "Already requested…" and
    wrote nothing;
  - there was no overflow and no console errors.

  The manager looked at the confirmation screenshot.
- **Decisions the plan did not settle**, recorded for the review:
  - A wrong content type gets 415 (from `checkRequest`), not 400.
  - "Already launched" covers launched, resumed, needs-greg, ended-unverified and disposed.
  - `pendingFor`'s `cannot-tell` goes ahead and writes: the check is a courtesy, and the occurrence
    is the guarantee.
  - A server with no `resume` field reads "not available", not broken.
  - The confirmation has a Cancel button.
  - **The parser is stricter than the wire types, so Stage 1 must write exactly this:**
    - positions start at 1;
    - each request's `name` and the pace's `name` match the record's;
    - a preview's conversation matches the conversation its record's evidence supports.

    Any mismatch marks the section unreadable, and the records stay visible.

### Stage 3: the launch, for real (after `launch-protocol` Stages 1–2 are on `dev`)

**Split, 2026-09-10.** **3a** needs nothing from the protocol: the argv reader and the G3 capability.
It is built. **3b** is the launch itself: the `tmux-resume` arm, gjd-remote, the port adapter, the
daemon composition and the drill. It waits for `launch-protocol` on `dev`, and is briefed in
[the 3b task](260910f-gradual-recovery-stage3b-task.md).

**Stage 3a status: built by an Opus subagent, uncommitted, not yet reviewed.**

- **The argv reader.** `claude-argv.ts` reads a uuid token immediately after `--resume` as the
  conversation, and puts it into `sessionIds` beside `--session-id`'s. So steer's and the harness's
  duplicate rules apply unchanged: `--resume A --session-id B` is two conversations.
  - **Still unreadable:** a bare `--resume` (the picker), a non-uuid or uppercase value,
    `--resume=<uuid>`, `-r`, and `--fork-session`.
  - **On a ps-flattened line** the uuid counts only when nothing, or a dash-led token, follows it.
    This case is read rather than left unreadable, because the harness reads every `claude` through
    the flattened form. Left unreadable, every resumed pane would be unverifiable. The steer guard
    itself reads faithful argv only.
  - **Red first**, against a real capture taken with one paid Haiku call on a private socket:
    `["claude","--resume","723dd2cd-…","--permission-mode","auto","--model","haiku","--","Reply
    with exactly: OK4"]`, saved in `tests/fixtures/claude-argv/resumed-claude.json`.
  - **The Overseer's conditions** (a) and (b) are met, in `tests/fleet-steer.test.ts`: another
    uuid is still refused as a competing Claude; the bare picker stays unreadable; a uuid
    positional after another flag is not read. Conditions (c) and (d) are the review prompt's and
    the commit message's.
- **The capability (G3).** The `/api/state` payload carries a top-level `capabilities` beside
  `producer`, holding `"argv-resume-uuid"`. `observation.ts` parses it as an optional list: absent
  or malformed reads as none, and it never fails a snapshot. `producerCanVerifyResume` reads it
  from the latest accepted observation, and the pass defers without it.
  - **Assumption pending Greg** (the Overseer's ruling): it lives on the observation and is never
    held by the daemon. A restored baseline cannot drive a launch, because the pass needs an
    inventory accepted in the current daemon's life.
- **Outside the brief, each unavoidable:**
  - one line of `daemon.ts`'s `observe()`;
  - one `"capabilities"` entry in `tools/fleet/web/src/types.ts`'s `Omit<>`.
- **Evidence:**
  - 21 new tests went red, then 324 of 324 passed in the five fast suites; three daemon G3 tests
    went red, then green;
  - four mutations, each turning its tests red.

  Its final gate run was red only in two test files the G11–G19 fixer was editing at the same time.
  They were green on its 21:17 run.

**Stage 3a still needs a Sol review.** It is a security matcher: the Overseer's condition (c).
Rather than spending a separate Codex stage review, it goes to the **Stage 3 review**, which covers
3a and 3b together. If 3b stays blocked for long, 3a gets a narrow Sol check of its own before it
is pushed.

Files:

- the `tmux-resume` arm and adapter, in `launch-protocol`'s files and on the pattern its Stage 2
  sets, as agreed with it;
- `scripts/gjd-remote.ts` (`--resume-conversation`, including the check on the box that no tmux
  session's environment already has that `CLAUDE_SESSION_ID`);
- `tools/fleet/claude-argv.ts` and `tools/fleet/execution-identity.ts`: `--resume <uuid>` read as
  a verified conversation (see "Spike"). **Approved by the Overseer, 2026-09-10, with conditions**,
  because `claude-argv.ts` feeds `steer.ts`'s `isClaudeForSession`, which is the guard that stops a
  dashboard Send landing in the wrong conversation:
  - (a) red first, against a capture of a real resumed process;
  - (b) tests in `tests/run-claude*` or `tests/fleet-steer*` proving three things: that
    `claude --resume <OTHER uuid>` is still refused as a competing Claude; that bare
    `claude --resume` (the picker) stays unreadable; and that a uuid-shaped positional after any
    other flag is not read as the conversation;
  - (c) the Sol stage review is told in its prompt that this function is a security matcher, and is
    asked to attack the new arm specifically;
  - (d) the commit message carries a one-line note to whoever owns `steer.ts` at the time.

  Also `--resume-conversation` on gjd-remote's creation path, which is additive only;
- `tools/overseer/daemon.ts` (compose the capability, then hand it to the resume pass);
- `scripts/overseer-recovery-drill.ts` (`--resume`);
- tests.

Red first:

- the job text for `--resume-conversation` has no `--session-id <new>`, sets `CLAUDE_SESSION_ID` to
  the resumed id, and keeps `start.json` and `exit.json`;
- a non-uuid is refused before ssh;
- the drill's counts (§7), including the kill between invocation and `done/`, and a no-op launcher
  as a negative control that must make the drill fail.

## Spike: `claude --resume`

Measured 2026-09-10 against `claude` 2.1.267 on the box, with Haiku and five paid calls, in a
scratch directory on a private tmux socket (scripts and outputs in the session scratchpad,
`spike-resume/`):

- **The same id, the same transcript.** `--resume <uuid>` appends to `<uuid>.jsonl`, keeps
  `session_id`, and remembers the history. So the inventory's verified-conversation match holds
  across a resume.
- **A prompt after `--` is submitted automatically**, and the interactive session opens with its
  history on screen. There was no trust dialog and no permission dialog. **But it came up in manual
  mode**, so the job must pass `--permission-mode auto` explicitly, as `new-claude` already does.
- **The CLI does not check the directory.** A resume from an unrelated directory succeeds, runs in
  that directory, and keeps writing to the original project's transcript. **We set the cwd**
  (gjd-remote's `cdGuard` on the recorded `dir`), and revalidation checks that the directory
  exists.
- **Nothing stops a double resume.** Two processes resumed one id at once, and both wrote to one
  `.jsonl`. So §2's "not already live" check is load-bearing. It is also repeated at the last moment
  on the box: `gjd-remote --resume-conversation` refuses when any tmux session's environment already
  has `CLAUDE_SESSION_ID=<uuid>`.
- **A missing id** prints `No conversation found with session ID: …` and exits 1. `exit.json` then
  records it, and the protocol settles `completed`.
- **`--resume` together with `--session-id` is refused** unless `--fork-session` is given, and a
  fork would mint a new id that nothing could match. So the argv of a resumed session carries **no
  `--session-id`**, only `--resume <uuid>`.

**The consequence for Stage 3:** the fleet's verified conversation comes from the process argv
(`tools/fleet/execution-identity.ts` through `claude-argv.ts`). If that reader does not recognise
`--resume <uuid>`, a resumed session reads as `claimed-only`. The `resumed` disposition would then
never be derived, and the pace gate would wait for ever. Stage 3 teaches the argv reader the one
shape this repo produces (`--resume <uuid>`, with a uuid-shaped value), red first against a capture
of a real resumed process.

**Today the reader refuses it, by design.** `claude-argv.ts` lists `-r, --resume [value]` among the
optional-value flags whose value "cannot be read from argv alone", because `--resume foo` could be
"resume foo" or "resume, then the prompt foo". The spike answers that for the CLI:
`claude -p --resume <uuid> "Reply…"` resumed `<uuid>` and took the next word as the prompt. So the
value is the token right after `--resume`. The narrow extension is: a uuid-shaped token immediately
after `--resume` on faithful argv is the conversation; anything else stays unreadable. The
simpler option passed over was to verify by our own launch artefacts instead: the tmux session
found by correlation id, `CLAUDE_SESSION_ID` at creation, and the transcript growing after launch.
Then the inventory would never see a *verified* resumed conversation. The record would read
`present-but-unmatched` for ever, and the page would contradict the launch.

## Status

2026-09-10: plan written; Stage 0 in progress.
