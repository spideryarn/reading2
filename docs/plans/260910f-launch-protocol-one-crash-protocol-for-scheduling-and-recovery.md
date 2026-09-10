# Launch protocol: one crash protocol for scheduling and recovery

Roadmap stage: [260908f § Stage: Launch protocol](260908f-overseer-and-fleet-improvement-roadmap.md#stage-launch-protocol--give-scheduling-and-recovery-one-crash-protocol).
Queue item `qi-qzpjafp7`. Session `launch-protocol`, worktree `.claude/worktrees/launch-protocol`,
dispatched by the Overseer 2026-09-10.

## What this is for, in plain words

Two things want to start a session on Greg's behalf: the scheduler (a job came due) and, later,
recovery (Greg picked an interrupted session to bring back). Starting one is several steps — decide,
get a slot, start the process, find out what happened — and the daemon can die between any two.
After a crash it must be able to tell *never started* from *started and we lost track*, and it must
never start the same thing twice because it could not tell. Today the scheduler writes
`reserved` → spawns → writes `started` into `events.jsonl`, which gets the order right but leaves
no evidence the daemon could go and find: a `gjd-remote` session that exits quickly vanishes from
tmux, and nothing a headless wrapper does is written anywhere the daemon looks.

This stage builds the foundation both consumers share. **It launches nothing for real** — no job
is scheduled, and the only occurrence driven end to end is the dry-run fixture job, on a scratch
store, a scratch daemon and a disposable tmux socket.

## Measured before designing

- **tmux 3.4 on the box: `new-session -e NAME=value` puts the variable in the environment of the
  session's first process at creation**, and `show-environment` reads it back. Probed 2026-09-10 on
  a scratch socket (`lp-tmux-probe.sh` in the session scratchpad): the pane's own `env` held
  `SPIDERYARN_LAUNCH_ID=occ-abc`. So the correlation id can be in the launcher's first external
  effect, not set afterwards.
- **A tmux session whose command exits leaves no trace** (`has-session` → `can't find session`
  0.5 s later). tmux alone cannot answer "did this ever run?"; a file written by the job itself
  has to.
- **There is no admission owner to reserve a slot from.** `routes-admission.ts` forecasts and
  reserves nothing; the roadmap's *Enforced launch admission* stage is still `proposed` and says to
  measure need first. The only reservation today is the scheduler's lease.
- `gjd-remote new-claude` already sets four `-e` metadata variables at creation (`metaFlags`) and
  writes a start marker into `starts.ndjson` one instant before Claude starts. The marker is keyed
  by the session uuid and appended to a shared file; it is the right idea in the wrong place for
  this — the daemon would have to scan a shared log and match names.

## The design

### D1. A launch store the daemon owns, separate from `events.jsonl`

`~/.overseer/launches/` (under the store root, so `OVERSEER_STORE_DIR` moves it too):

```
launches/
  launches.jsonl        the journal: one line per boundary crossed, append + fsync, one writer
  writer.lock           O_CREAT|O_EXCL, lock.ts's takeLock — the daemon holds it
  o/<occurrenceId>/     0700, one per occurrence
    material.txt        the exact prompt the child will be given, pinned before `planned`
    a1/                 one per attempt: the LAUNCHER ARTEFACT directory
      intent.json       written by the protocol before the launcher is invoked
      start.json        written by the launched side (job script or wrapper) as its first act
      exit.json         written by the launched side when the child ends
```

A separate file rather than new arms in `OverseerEvent`, because `recovery-inventory` is adding
its arms to that union and to `store.ts` right now, and because the launch history has different
retention and a different failure rule (below). It reuses `jsonl.ts` (torn-tail truncation,
`writeAtomically`) and `lock.ts` rather than copying them. It does **not** write, import or share
the dashboard's receipt journal; it borrows its concepts — evidence not optimism, an ambiguous
attempt is never retried automatically, and a record type per boundary rather than a status field.

**A launch journal that cannot be replayed whole refuses new launches.** `store.ts` may start cold
because a cold register costs history; a cold launch journal would read as *nothing is in flight*,
which is a licence to launch everything again. So a holed or unreadable journal opens in a
`history-lost` state: reconciliation still reports what the artefact directories show, `plan()`
refuses with the reason, and Greg's disposition (D8) is the way out. GPT Sol's C3 on the scheduler
(*a cold start is not permission*), applied here.

### D2. Identity

- **Occurrence id** `lo-<20 hex>`: sha256 of the canonical origin. Two origins in v1:
  - `schedule { jobId, scheduledAt, behaviourHash }` — the scheduler's existing `OccurrenceKey`;
  - `recovery { candidateId }` — `recovery-inventory`'s `RecoveryCandidateId`, consumed as an opaque
    validated string. **One occurrence per candidate**, so two taps, or a tap and a restart, are the
    same occurrence (Gradual recovery's duplicate-request test).
- **Attempt** `a1`, `a2`, …; **correlation id** `<occurrenceId>-a<n>`, regex
  `^lo-[0-9a-f]{20}-a[1-9][0-9]{0,2}$` — safe in an env var, a path and a tmux value without quoting.
- `plan()` for an id that already exists returns the existing record and appends nothing.

### D3. Records and states

The journal's event kinds, each carrying `occurrenceId` and `at`:

| event | written when | carries |
|---|---|---|
| `planned` | after `material.txt` is on disk | origin, material sha256 + bytes, launcher kind, admission class |
| `waiting-admission` | the owner said wait (once per distinct reason, not per tick) | why |
| `reserved` | the owner granted, or a lookup found, the reservation | reservation key, slot, owner id |
| `launching` | after `intent.json` is on disk, **before** the launcher is invoked | attempt, correlation id, artefact dir |
| `observed-running` | evidence of a live child | the evidence (start artefact, process identity, tmux session id) |
| `completed` | evidence the child ended | how: exit record (code, answer usable/bytes/sha256) or vanished (process gone, no exit record) |
| `failed-before-launch` | proof no external effect happened | why, and which proof |
| `outcome-unknown` | a `launching` whose evidence is inconclusive | why, what was looked at |
| `released` | the owner confirmed the reservation is gone | evidence or disposition that licensed it |
| `disposed` | Greg's attributed decision on a stuck occurrence | actor, request id, decision, why |

The fold turns these into one record per occurrence whose `state` is exactly the roadmap's eight
(`planned`, `waiting-admission`, `reserved`, `launching`, `observed-running`, `completed`,
`failed-before-launch`, `outcome-unknown`) plus two orthogonal facts: whether the reservation is
still held, and the disposition if Greg gave one. A discriminated union per state, not a status
string beside optionals.

### D4. The order, with a durable write at every boundary

```
plan ──▶ reserve (owner, keyed by occurrence) ──▶ record reserved ──▶ intent.json + record launching
     ──▶ invoke launcher ONCE ──▶ discover (start.json / exit.json / process / tmux) ──▶ record result
     ──▶ release (owner) ──▶ record released
```

Never one atomic operation. What each crash point leaves, and what reconciliation does with it:

| crash after… | journal says | reconciliation |
|---|---|---|
| material written | nothing | orphan material, harmless; the next `plan()` rewrites it |
| `planned` | planned | look the key up at the owner: found → record `reserved` (**the lost reply, recovered, no second slot**); absent → ask again with the same key |
| owner granted, reply lost | planned | same lookup, same answer |
| `reserved` | reserved | the launcher is only invoked after `launching` is durable, so **nothing external happened**: `failed-before-launch` ("restarted before launching") and release. (A scheduler occurrence is not resumed across a restart; its next due instant is a new occurrence. A recovery occurrence is re-offered.) |
| `intent.json` written | reserved | as above; the intent file is an orphan |
| `launching` | launching | look for evidence (D7). None → `outcome-unknown`, reservation **held**, never relaunched |
| launcher's external effect, before `start.json` | launching | tmux probe by correlation id finds the session → running; nothing anywhere → `outcome-unknown` |
| `start.json`, before the journal heard | launching | start artefact + process identity → `observed-running`, or `completed (vanished)` if the process is provably gone |
| child exited before first collection | launching | `exit.json` → `completed` with its code and answer check; the reservation released on that evidence |
| `completed`, before release | completed, held | release again — the owner's release is idempotent |
| owner restarted | any | the owner reopens from its own disk; every lookup above still works |

**At most one automatic attempt while ambiguous.** A second attempt of the same occurrence is
allowed only if every earlier attempt ended `failed-before-launch` with proof. `launching`,
`observed-running` and `outcome-unknown` all block it; only evidence or `disposed` moves them.
**Timeout alone is not proof** that a child stopped: a lease that runs out moves nothing here.

### D5. The admission owner: an interface, and a small local owner behind it

```ts
type AdmissionOwner = {
  reserve(key: ReservationKey, cls: AdmissionClass): Grant;   // idempotent by key
  lookup(key: ReservationKey): Grant | { kind: "none" };
  release(key: ReservationKey, because: ReleaseEvidence): { kind: "released" | "was-not-held" };
};
type Grant = { kind: "reserved"; slot: string; ownerId: string } | { kind: "wait"; why: string } | { kind: "refused"; why: string };
```

v1 is `launch-admission.ts`: a durable reservation table in `~/.overseer/admission/` with its own
lock and journal, one class (`claude-session`) and a capacity of one. A `reserve` for a key already
held returns the same grant; a full class returns `wait`.

**What it is not, named:** a box-wide admission owner. It bounds only launches made through this
protocol, and it knows nothing about memory. The *Enforced launch admission* stage decides whether
the box needs more; if it builds a host-local owner, that owner implements this interface and the
local one goes. **The simpler option passed over:** write the reservation into the launch journal
itself, so "obtain" and "record" are one append and the lost reply cannot happen. Rejected because
the roadmap asks for exactly that separation — the moment an owner lives anywhere else, the lost
reply is real — and testing it now, against a second file, costs one small module. If Sol or Fable
think it is not worth the second store, this is the first thing to cut.

### D6. Launchers carry the correlation id in their first external effect

**tmux, through `gjd-remote new-claude`** (`scripts/gjd-remote.ts`, session-creation path only):

- two new flags, `--launch-id <correlationId>` and `--launch-dir <absolute dir>`, validated before
  anything touches the box (regex; absolute; no odd bytes) and again on the box (the directory
  exists and its `intent.json` names the same id) — refused, not guessed;
- `-e SPIDERYARN_LAUNCH_ID=… -e SPIDERYARN_LAUNCH_DIR=…` added to the one `tmux new-session` that
  creates the session, beside `metaFlags` — so the id exists at creation, never set afterwards;
- the job script's **first line**, before the directory guard, writes `start.json` atomically
  (temp + `mv`): pid, the kernel's start ticks for that pid, boot id, tmux pane id, time; and after
  `claude` returns, before `exec bash -l`, writes `exit.json` with its status. A guard that fails
  still leaves `start.json`, so "created and died at once" is distinguishable from "never created";
- the shell snippets come from one generator in `tools/overseer/launch-artefacts.ts`, which is also
  the reader, so the writer and the reader cannot spell a field two ways.

**Headless, `scripts/run-claude.ts` and `scripts/run-codex.ts`**: one new flag, `--launch-dir`. The
wrapper reads the correlation id from that directory's `intent.json` (one source for the id, so the
flag and the file cannot disagree), refuses a directory that is missing, not ours, not `0700`, or
has no valid intent; writes `start.json` (its own pid, start ticks, boot id) **before** spawning
the child; passes `SPIDERYARN_LAUNCH_ID` to the child; and writes `exit.json` on **every** exit
path — the child's code or signal, whether it timed out, and the answer file's path, byte count,
sha256 and `answerIsUsable` verdict. Nothing about routing, auth, stdin, the sanitised environment
or the answer validation changes; a run without `--launch-dir` is byte-for-byte today's run.

The wrapper's own process is the identity that matters: it lives exactly as long as its child
(it waits, and its timeout kills the child's process group), so `start.json` needs no child pid.

### D7. Discovery and reconciliation

One pure function, `reconcile(fold, evidence) → decisions`, where `evidence` is read through ports
so tests can hand in any world:

- `artefacts(dir)` → each of `intent`/`start`/`exit`: present, absent, or unreadable (with why);
- `identity(start)` → `alive` (same boot, pid alive, same start ticks) / `gone` (same boot, pid dead
  or its start ticks differ) / `other-boot` (the machine rebooted, so it is not running) /
  `cannot-tell` (e.g. /proc unreadable);
- `tmux(correlationId)` → `found {sessionId}` / `absent` / `cannot-tell` — lists sessions and reads
  `SPIDERYARN_LAUNCH_ID` from each session's environment; only asked about tmux launches;
- `owner.lookup(key)`.

It runs at daemon start and on every checkpoint tick, and it is the only thing that moves a
`launching`, `observed-running` or `outcome-unknown` record. `cannot-tell` from any port keeps the
record where it is — it is never promoted to `gone`. It never invokes a launcher.

### D8. Greg's controls: inspect and dispose, without a second writer

- `scripts/overseer-launches.ts list | show <id> | dispose <id> --as <not-running|ended> --why "…"`.
  `list`/`show` read the projection (D9) and the artefact directory read-only. `dispose` writes one
  request file into `~/.overseer/launch-inbox/`, the same drop-directory shape
  `recovery-inbox.ts` and `report-inbox/` use (if a shared helper has landed by then, this uses it).
- The daemon drains the inbox each tick, validates the request against the fold (only a
  non-terminal `launching`, `observed-running` or `outcome-unknown` occurrence can be disposed),
  appends `disposed` with the actor and request id, releases the reservation, appends `released`,
  and deletes the file. A replayed request id is refused as already applied. The daemon stays the
  only writer.
- **No button in v1** — an action route belongs to `action-receipts`' vocabulary, and the recovery
  panel made the same call. The page prints the exact `dispose` command next to each stuck record.

### D9. The projection and the page

- The daemon writes `~/.overseer/launches.json` on each checkpoint, bounded: every non-terminal
  occurrence plus the newest 50 terminal ones, with the journal's replay status.
- `tools/fleet/wire.ts`: one appended block of types, `LaunchesFeed` and its shapes, no imports.
- `tools/fleet/launches-feed.ts` reads the file asynchronously with its own parser (fleet does not
  import `tools/overseer/`), answering `published` / `absent` / `unreadable` / `unsupported-schema`.
- `GET /api/overseer/launches` in a new `tools/fleet/routes-launches.ts`, **plus one branch in
  `tools/fleet/server.ts`** — outside my file set; asked of the Overseer, as recovery's was.
- `tools/fleet/web/src/LaunchesPanel.tsx` + `launches-client.ts`: non-terminal first, each with its
  state, reservation, attempts, evidence and what reconciliation last concluded, and the dispose
  command for a stuck one. **Mounting it is one line in `App.tsx`** — also outside my file set,
  also asked. If either is refused, the section ships unmounted and the debrief says so.

### D10. The scheduler keeps its path this stage

`schedulerTick`'s session arm keeps `reserved → spawn → started` in `events.jsonl`. **Scheduled
dispatch** replaces that arm with this protocol; doing it here would record every launch in two
ledgers, and no live job may launch in this stage anyway. What this stage adds for it: the
`schedule` origin, a `launchOccurrence()` entry point shaped for `launch()` to call, and the drill
(below) driving the fixture job's real `OccurrenceKey` through it. If the reviewer thinks the
adapter belongs in `scheduler.ts` now, it is a small move and I will make it.

### D11. The drill, which is the acceptance evidence

`scripts/launch-protocol-drill.ts`: a scratch store directory, a scratch admission directory and a
disposable tmux socket. It takes the fixture job's definition from `standing-jobs.ts`, builds its
occurrence, and drives it through the protocol with a tmux launcher that uses the **same**
`launch-artefacts.ts` snippets gjd-remote uses but runs `true` on the scratch socket instead of
Claude. It kills and reopens every store at each boundary in D4's table and prints, per boundary:
launcher invocations (must be ≤ 1), reservations held for the key (must be ≤ 1), and the state
reconciliation reached. No paid call, no default tmux server, no live store.

## What is deliberately not here

- No retry policy beyond "a proven failed-before-launch may try again". No backoff, no queue.
- No enforcement of memory or box-wide load — D5.
- No automatic release on lease expiry or timeout.
- No recovery launching: this stage makes the `recovery` origin and its idempotence; Gradual
  recovery calls it.
- Exactly-once execution is not claimed. What is claimed: at most one automatic attempt while the
  outcome is ambiguous, one reservation per occurrence, and evidence that outlives the child.

**Remaining ambiguity, per launcher, to be written into the module header:** tmux — a session
created and killed before its first line ran leaves no `start.json`; if the probe also finds no
session, the occurrence is `outcome-unknown`, correctly, and only Greg can say. Both — a
supervisor (job shell or wrapper) killed with SIGKILL writes no `exit.json`, and its children may
outlive it, so on the same boot that is `outcome-unknown` too (F1); only a reboot or Greg ends it.

## Review dispositions — Sol, plan round 1 (these override D1–D11 where they differ)

Review: [260910f-launch-protocol-plan-review-sol.md](260910f-launch-protocol-plan-review-sol.md),
full record [260910f-launch-protocol-plan-review-sol-findings.md](260910f-launch-protocol-plan-review-sol-findings.md).
Verdict: refuse as written, three established P1s. All thirteen accepted; each checked against the
code.

- **F1 (P1) — a supervisor's disappearance is not the child's completion. Accepted.** The recorded
  pid is the job shell or the wrapper, and Claude/Codex run as its children (the wrapper's in their
  own process group), so SIGKILL of the supervisor can leave the child running. **`completed`
  requires a valid correlation-bound `exit.json`, or `other-boot`** (a reboot ends every process of
  the recorded boot). A same-boot disappearance of the supervisor without `exit.json` becomes
  `outcome-unknown` and keeps its reservation; Greg's `dispose` is the way out. There is no
  `completed (vanished)` arm. The contrary headless-ambiguity sentence below is struck. (Not taken:
  scanning `/proc/*/environ` for the correlation id as descendant evidence — possible later, and
  worth nothing while no job launches.)
- **F2 (P1) — `history-lost` needs a real exit. Accepted.** A holed or illegal journal refuses
  `plan()` until Greg submits an attributed `resolve-history --why … --accept-hidden-launch-risk`
  request through the inbox. The daemon then preserves the old journal byte-for-byte (renamed, never
  rewritten), inventories what it can still see — parseable occurrences, artefact directories, the
  owner's reservations — and starts a fresh journal whose first record is `history-reset`, naming
  the preserved file and saying the hole may conceal a launch nobody can enumerate. Reservations the
  owner still holds stay held and are listed; each is released only by its own `dispose`. The same
  rule for the admission owner's journal.
- **F3 (P1) — the shell artefact must be durable and fail-closed. Accepted.** One checked helper,
  generated from `launch-artefacts.ts`: create the temp file exclusively (`set -C` in a subshell),
  write, `sync` the file, `mv`, `sync` the directory. Any failure goes through gjd-remote's existing
  `failTo`, so **Claude is not invoked without a durable `start.json`**. `exit.json` uses the same
  helper with `_gjd_claude_status` already saved; its failure leaves a note and never claims evidence.
  Generated-job tests inject write, sync and rename failures.
- **F4 (P2) — evidence by precedence, not a global veto. Accepted.** D7 becomes: valid `exit.json` →
  `completed`; else `other-boot` → `completed` (interrupted by reboot, no exit code); else a matching
  live identity or a tmux session carrying the id → `observed-running`; else, if any input the
  remaining decision needs is unavailable, no change; else absence is inconclusive →
  `outcome-unknown`. Weaker or unavailable evidence never overrides stronger conclusive evidence.
- **F5 (P2) — the material is bound to what launches. Accepted.** An existing id with a different
  origin, launcher kind, admission class, material size or hash is a conflict, not an idempotent
  return. Immediately before `launching`, `material.txt` is re-read and re-hashed; the launcher is
  handed those verified bytes and has no prompt parameter of its own.
- **F6 (P2) — wrappers instrument the whole invocation. Accepted.** Not `runChild`, not one credential
  attempt: `run-codex`'s read-only fallback can legitimately run twice and its write-capable
  no-fallback rule stays load-bearing. One final `exit.json`, written after the wrapper's existing
  final classification, through a synchronous outer finaliser that `fail()`'s `process.exit` also
  reaches. The id joins the already-sanitised child env; nothing else moves.
- **F7 (P2) — release after `failed-before-launch` and `disposed` too. Accepted.** A durable
  terminal or disposition record licenses reconciliation to release a still-held reservation; if
  the owner already says none, append `released`. No new attempt starts while that is unsettled.
  Crash tests after the terminal append and between owner release and `released`.
- **F8 (P2) — Stage 3 is too broad; keep D5. Accepted.** D5's separate owner stays: folding it into
  the journal would pass the lost-reply test by deleting the failure mode. `lookup` returns only a
  `reserved` grant or `none`. **The fleet route, client, panel and the `server.ts`/`App.tsx` lines
  move to Scheduled dispatch**, when there are live occurrences to show; with no production caller
  the page could only draw an empty state. That drops both out-of-set asks, and it departs from the
  brief's "one section under `tools/fleet/web/src/`" — said in the debrief. Greg's controls in this
  stage are the CLI: `list`, `show`, `dispose`, `resolve-history`.
- **F9 (P2) — the prefix that makes "reserved ⇒ never invoked" true is structural. Accepted.**
  `reserve → append reserved → write intent → append launching → invoke` is one synchronous,
  non-yielding function; the owner is synchronous; reconciliation runs in the same event loop and
  so cannot interleave. A failed `launching` append returns without invoking. Scheduler and recovery
  get only `launchOccurrence`; the concrete launchers stay inside the protocol's composition, and a
  test walks production imports to prove nothing else calls an adapter. A future asynchronous owner
  needs an explicit current-attempt guard instead.
- **F10 (P2) — the projection is bounded. Accepted.** At most 200 non-terminal records, most
  actionable first, plus the newest 50 terminal, with `totalNonTerminal` and `omittedNonTerminal`;
  crossing 200 is a visible overflow. Omitted records stay reachable through the CLI.
- **F11 (P2) — replay validates legality, not only syntax. Accepted.** An exact runtime parser per
  record; replay checks immutable fields, identity, monotonic attempts and legal transitions, and an
  unknown schema, malformed known kind, conflicting duplicate or illegal transition is
  `history-lost` with nothing folded past it. The `/proc` readers are reused from
  `tools/fleet/execution-identity.ts` (or moved to a neutral leaf), not written a second time.
- **F12 (P2) — the drill must fail on a no-op. Accepted.** Exact expected counts per boundary
  (effects 0 before invocation, 1 at and after it; exactly one matching grant while held, none after
  a licensed release), with the external marker counted independently of the protocol's own
  counter, and a negative control: a no-op launcher must make the first post-invocation row fail.
- **F13 (P2) — validation is not quoting. Accepted.** `SPIDERYARN_LAUNCH_DIR` goes through the
  existing `shq` at every layer; both new options sit before the unchanged final `-p -`; the adapter
  writes the verified material plus newline and closes stdin. Tested with a path holding a space, a
  quote and `$()`, and a newline refused.
- **Suspicion 3 — D10 stands.** Sol: defensible, since wiring now would double-record an armed path.
  Added: a test asserting `launchOccurrence` has no production caller yet, so "built but uncalled"
  is explicit.

## Stages

Implemented by **Opus subagents** in this worktree (the brief: Codex's weekly window is the tighter
one, so no Codex implementation). Each stage ends with **one** GPT Sol review at
`--effort high --timeout-minutes 30`, read-only and findings-first (`<answer>-findings.md`); an Opus
subagent fixes what it finds; a narrow 20-minute check of P1 fixes only, then Fable if anything is
still open, and no further round.

### Stage 0: this plan, reviewed

- [ ] Sol plan review, read-only.
- [ ] Plan sha to the Overseer, with the two out-of-set asks (D9).

### Stage 1: the protocol, the store and the owner

Files: `tools/overseer/launch-protocol.ts` (types, ids, fold, the ordered steps, `reconcile`),
`tools/overseer/launch-store.ts` (journal, lock, open/repair/append, material and artefact dirs),
`tools/overseer/launch-admission.ts` (D5), `tools/overseer/launch-artefacts.ts` (record types,
reader, identity check — the writers arrive in stage 2), tests
`tests/overseer-launch-protocol.test.ts`, `tests/overseer-launch-store.test.ts`,
`tests/overseer-launch-admission.test.ts`.

Red first:
- **Fault injection at every arrow of D4**, through a harness whose store, owner and launcher can
  be told to die at a named point: reopen everything, reconcile, and assert launcher invocations
  ≤ 1, reservations for the key ≤ 1, and the state D4's table names. Including: after external
  spawn before `start.json`; a child that completed before first collection; the owner restarting;
  a duplicate `plan()`; a duplicate recovery origin.
- `failed-before-launch` versus crash-after-possible-launch: a launcher that refuses before any
  effect, and one that throws after its effect.
- `outcome-unknown` holds its reservation through ten reconciliations and never re-invokes.
- A holed journal refuses `plan()`; a torn last line is repaired on open.
- Owner: `reserve` twice with one key → one slot; a second key waits at capacity one; release is
  idempotent; state survives reopen.
- `cannot-tell` from any port never moves a record.

**Status (2026-09-11): built by an Opus subagent, not yet Sol-reviewed.** Four modules
(`launch-protocol.ts` 1,671 lines, `launch-store.ts`, `launch-admission.ts`, `launch-artefacts.ts`)
and four suites, 123 tests; with `fixture-ids` 128 pass, typecheck exit 0, lint clean of errors.
**Tests were written after the code, not before** — the builder compensated by breaking seven rules
on purpose (F1, F9, reserve idempotence, fold across a hole, F4, F5, correlation binding): 32 tests
went red, each in the group written for that rule, then reverted. Departures, all accepted:

- The owner answers `lookup`/`release` with a third arm, `unavailable`, and has `inventory()`. F8's
  "only `reserved` or `none`" cannot be built fail-closed: an owner whose own journal is lost can
  say `none` only by lying, and `none` licenses a release. `inventory()` is what F2's reset lists.
- `intent.json` carries the boot id, so a reboot is provable with no `start.json` at all →
  `completed (rebooted)`, released.
- `exit.json` has a `supervisor-failed` ending (the wrapper failed on its own account, e.g. a spawn
  error); Stage 2 uses it or replaces it.
- Recovery candidate ids are validated locally (1–256 chars, no control characters): the
  `RecoveryCandidateId` brand was not in this tree when it was built. Tightened to the real regex
  in Stage 3, after the merge brings `recovery-inbox.ts`'s `isCandidateId`.
- The reservation key is the occurrence id.
- `launchOccurrence` continues from a `reserved` record, relying on `reserve`'s idempotence — which
  is how a lost reply is recovered *by the next launch call*. **Reconciliation, run first, instead
  releases a `reserved` as `failed-before-launch`** (D4's row), so after a restart a recovered lost
  reply is released rather than launched. Conservative, and the scheduler's next due instant is a
  new occurrence anyway; Gradual recovery must call `launchOccurrence` again, which is a fresh plan.
- After `disposed` the only legal record is `released`; evidence arriving later is not recorded.
- An occurrence carried across a history reset can never be planned again.
- F2 had two wordings (Sol's: dispose every visible reservation before the reset; the
  dispositions': reservations stay held and listed, each released by its own `dispose`). Built the
  dispositions'.
- The launch journal has no replay ceiling or retention (unlike `store.ts`'s 64 MiB): a later need.
- The no-production-caller test walks `tools/ scripts/ src/ api/ evals/` with an allow-list of the
  launch files; Stages 2–3 extend it deliberately.
- Open, for the stage review: `launching` records an absolute artefact path, so moving
  `OVERSEER_STORE_DIR` after a launch strands it. And the reader rejects unknown fields and wants
  `at` in exactly `toISOString()` form — Stage 2's bash writer must emit `date -u +%Y-%m-%dT%H:%M:%S.%3NZ`.

**Learned 2026-09-10, from the seam talk with `scheduled-dispatch`: a daemon child does not survive
a daemon restart.** `infra/hetzner/systemd/overseer.service` sets no `KillMode`, so systemd's default
(`control-group`) kills every process in the unit's cgroup on stop or restart. A headless wrapper
spawned directly by the daemon therefore dies with every Overseer restart and, under F1, strands
its occurrence as `outcome-unknown`. A session created on the **already running** tmux server lives
outside the cgroup. Proposed to `scheduled-dispatch`: scheduled jobs use a third adapter, **a tmux
session that runs `run-claude --launch-dir …`** (the id at creation, the wrapper's exit status and
answer in `exit.json`, survives restarts), refusing if no tmux server is running rather than forking
one inside the cgroup. The interactive `gjd-remote new-claude` adapter stays, for recovery.

### Stage 2: the launchers

Files: `scripts/gjd-remote.ts` (flags, `-e`, job-script lines — session-creation path only),
`scripts/run-claude.ts`, `scripts/run-codex.ts` (`--launch-dir`), `tools/overseer/launch-artefacts.ts`
(the writers: bash snippets and a TS writer), `tools/overseer/launchers.ts` (the tmux and headless
launcher adapters the protocol invokes), tests beside the existing ones for each script plus
`tests/overseer-launchers.test.ts`.

Red first:
- gjd-remote: a bad `--launch-id` is refused before any ssh; the generated `tmux new-session`
  carries both `-e` values; the job text writes `start.json` on its first line and `exit.json`
  before `exec bash -l`; without the flags the job text is unchanged.
- Wrappers: without `--launch-dir`, argv, env and output are unchanged; with it, a missing or
  foreign or `0755` directory is refused before spawn; `start.json` exists before the child runs;
  `exit.json` is written on success, on non-zero exit, on timeout and on an empty answer.
- A scratch-socket test: the tmux adapter creates a session whose first process sees the id,
  the probe finds it by id, and a session that exits at once still leaves `start.json` + `exit.json`.

### Stage 3: the daemon, the controls, the drill (the page moved to Scheduled dispatch — F8)

Files: `tools/overseer/daemon.ts` (open the launch store and owner at start, reconcile at start and
per checkpoint, drain the inbox, write `launches.json` — small targeted edits outside the usage
pass, merged first), `tools/overseer/launch-inbox.ts`, `scripts/overseer-launches.ts`
(`list`/`show`/`dispose`/`resolve-history`), `tools/overseer/launch-projection.ts`,
`tools/fleet/wire.ts` (appended block of the projection's types, for Scheduled dispatch's page to
read), `scripts/launch-protocol-drill.ts`, tests.

Red first: a dispose of an unknown or completed occurrence is refused; a replayed request is
applied once; a crash after `disposed` still releases (F7); `resolve-history` preserves the old
journal byte-for-byte and starts a fresh one with `history-reset` (F2); the projection's bound and
overflow count (F10); the drill's exact counts, and its no-op negative control failing (F12).

## Status

**2026-09-10 — Stage 0 done.** Plan d7f5f3c7 reviewed by Sol (read-only, one round): refused on
three established P1s, all thirteen findings accepted and folded in above. No second plan round —
the dispositions adopt Sol's own replacement wording, and the stage reviews will check the code
built from it. Stage 1 next.
