# Recovery inventory: show interrupted work without resuming it

The roadmap stage is
[260908f § Stage: Recovery inventory](260908f-overseer-and-fleet-improvement-roadmap.md#stage-recovery-inventory-show-interrupted-work-without-resuming-it);
its six checkboxes and its acceptance paragraph are the spec, and this plan does not restate them.
Queue item `qi-z4q4rkg3`, dispatched by the Overseer on 2026-09-10. **Zero sessions are started by
anything in this plan, and there is no execute button.** Resuming is the next roadmap stage
(Gradual recovery), which consumes what this one records.

## What is wrong today, in one paragraph

The register is "what is running now": `foldEvents` in `store.ts` *deletes* an entry on
`tmux-session-gone`. After a reboot, the dashboard's first accepted collection has no tmux server,
so it arrives as `rows: []` with `tmuxServerPid: null`. `diff()` treats an empty fleet with an
unreadable generation as comparable, and closes every session as `absent-from-snapshot`. The fold
deletes all of them in the same append. From that moment `current.json` holds nothing about the
work that was interrupted. The facts recovery needs are then spread across the log — the working
directory, the conversation claim, the last verified run, the last status — and nothing gathers them
back up. The live log has had one tmux server since it began (0 of 561 gone events are
`tmux-server-changed`), so this has never happened for real. That is also why nobody has noticed.

**Measured, 2026-09-10 ~13:00 UTC, read-only:** `~/.overseer/events.jsonl` is 812 KB, 2,059 events,
561 `tmux-session-gone`, all `absent-from-snapshot`. The register holds 19 entries.

## The design

### 1. A candidate is written before the removal it explains, in the same append

A new event, `recovery-candidate`, is added to `OverseerEvent`:

```ts
// tools/overseer/recovery.ts (the new module) — the event arm is re-exported through diff.ts's union
type RecoveryCandidateEvent = {
  kind: "recovery-candidate";
  at: string;                    // the gone event's `at`
  id: RecoveryCandidateId;       // see "Idempotency" below
  entry: RegisterEntry;          // the FINAL COMPLETE entry, from the register before this batch folds
  lastSeen: RecoveryLastSeen | null; // from the baseline row, when the daemon had one; null otherwise
  disappearance: {
    goneWhy: GoneReason;
    /** The accepted collection that removed it: `(instance, inventory)` when stamped, else its `collectedAt`. */
    observation: string;
    /** The entry's world against the snapshot that removed it. `changed` also when the host's boot id changed. */
    generation: "same" | "changed" | "unverifiable";
    bootChanged: boolean;
    /** Whether the dashboard run changed between the baseline and this snapshot (the 260910d stamp). */
    producerRun: "same" | "changed" | "cannot-tell";
    /** False when this came from `goneWhileAway`: the daemon had no baseline, so nobody watched it go. */
    watched: boolean;
  };
};

type RecoveryLastSeen = {
  statusKey: string;              // e.g. "working", "no-claude", "shell:true"
  title: string | null;           // capped at 200 chars; for reading only, never a command
  harness: HarnessKind | null;    // from a verified execution, else null
  executionToken: string | null;
  conversation: ConversationReading | null;
  collectedAt: string;            // the baseline's clock: when this was last true
};
```

**The daemon writes it, not `diff()`.** `diff()` stays pure and knows nothing about the register,
but the final complete entry lives in `store.register`. One pure function,
`withRecoveryCandidates(events, register, baselineRows, context)`, inserts each candidate
immediately before its `tmux-session-gone` in the batch `take()` is about to append. It runs over
`goneWhileAway`'s events too. The register has not folded the batch yet, so `register.get(key)` is
still the last complete entry. One `store.append` is one `write` + `fsync` (store.ts § `append`),
so the candidate and its removal go into the log in a single write.

**Which disappearances get a candidate — every one except a watched, same-world close.** A candidate
is written unless *all* of these hold: the generation relation is `same` (both readable and equal);
the producer run is `same`; and the daemon had a baseline (`watched`). That rule catches:

| Case | generation | producerRun | watched | Candidate? |
|---|---|---|---|---|
| A session ends while the box carries on | same | same | yes | **no**: an ordinary close, recorded by its gone event as today |
| The tmux server is replaced (a reboot with sessions already back) | changed | changed | yes | yes |
| **The first empty snapshot after a reboot** (no tmux server yet) | unverifiable | changed | yes | yes |
| `tmux kill-server` under a running dashboard | unverifiable | same | yes | yes (`unknown`: indistinguishable from the next row — Sol F1) |
| The last session closes and tmux exits on its own | unverifiable | same | yes | yes (`unknown`, which it genuinely is) |
| A reboot where tmux happens to get the same pid | changed (boot id) | changed | yes | yes (see "The host's boot id" below — Sol F5) |
| The dashboard restarts and a session happens to end meanwhile | same | changed | yes | yes (`unknown`, not `interrupted`) |
| The daemon was down (`goneWhileAway`) | — | — | no | yes |

Writing a candidate on every close would add about 280 records a day at ~1.5 KB each, roughly a third
of the log's daily growth, so that option was passed over. Nobody would read any of it: a close
the daemon watched under a live tmux server and an unchanged dashboard run is not something
recovery can act on.

**Idempotency (revised on Sol's F3).** The id is a hash of two things. The first is the previous
execution: `(key, entry.tmuxServerPid, entry.startedAt, entry.verifiedExecution?.token ?? "none")`.
The second is the accepted collection that produced the disappearance: `disappearance.observation`.
That is `(producer.instance, producer.inventory)` for a readable stamp, else the collection's
`collectedAt`. The arrival-time `at` is excluded. So two distinct disappearances of one run get
different ids. The first draft keyed on the run alone, which let a later real reboot hash onto an
earlier dismissed `unknown` and vanish. Two crash paths re-derive a disappearance, and each is
closed by a different rule:

- **The append completed** (the process died before the baseline write). The gone is in the log, so
  the register no longer holds the entry. **A candidate is only ever built from an entry the register
  still holds**, so the re-derived gone brings no second candidate.
- **The candidate line is complete and the gone line after it is torn.** `openStore` truncates the
  torn line, and the register still holds the entry. The restart may re-derive the gone from a
  *later* collection, and so under a different id. **The fold merges it:** a candidate for a session
  key whose previous candidate has not yet been followed by its gone is the same disappearance, and
  the first record, with its id, is kept.

**The host's boot id (Sol's F5).** `tmuxServerPid` is only a pid, and a fresh boot can hand tmux the
same number. The daemon runs on the box, so it reads `/proc/sys/kernel/random/boot_id` itself and
keeps it in `recovery.json`. On the first accepted collection under a different boot id, before
`diff()`, it closes **every** register entry as `tmux-session-gone` (`why: "tmux-server-changed"`,
each with its candidate, `bootChanged: true`), and diffs that collection against no baseline, so
every row is new. An unreadable boot id concludes nothing, and the pid rule applies as today. It is
never taken as equal. Putting the boot id on the wire would be producer work, outside this plan;
this is the smaller fix, and it is the daemon's own fact about its own host.

### 2. A daemon-owned recovery register, with its own checkpoint

A third fold over the same events, beside `foldEvents` and `foldOccurrences`: `foldRecovery` in
`recovery.ts`. It keeps one `RecoveryRecord` per candidate id: the candidate, plus its disposition.
It is persisted in its own file, **`~/.overseer/recovery.json`**, with its own byte cursor:

- **Not inside `current.json`.** Every dashboard poll parses that file already (110 KB today).
  After a reboot the index is ~40 records at ~1.5 KB each, and it only grows until Greg
  dismisses things. The recovery file is written only when the fold or the view changed. A reader
  asks for it only when the section is open.
- **Its own cursor, so crash order stays the register's argument.** The writes go in this order:
  events, baseline, `current.json`, `recovery.json`. On open, the recovery fold restores from
  `recovery.json` and replays the log from *its* cursor, so a crash before the recovery write
  replays the tail. Any other order would be an index claiming events that were never written.
- **Opened by `openStore`, held by `Store`**, like the other two folds, and written by
  `store.checkpoint()` through the same `writeAtomically`. The daemon stays the single writer.
- **Rebuilt once at startup, never on a page request.** The route reads the file; nothing on the
  request path folds or scans a log.

**Dispositions, each an event, never a mutation.** A `recovery-disposition` event
`{ id, disposition, at, evidence }`:

- `unresolved`: the default, never written.
- **A candidate's verified conversation** is `lastSeen.conversation.id` for `verified`,
  `lastSeen.conversation.observed` for `conflicting`, and none otherwise. The stored
  `claimedConversationId` is shown only as a claim: it outlives its conversation
  (`observation.ts`), so it matches nothing (Sol's F2).
- `resumed`: a live verified execution in an accepted inventory has the candidate's non-null
  verified conversation, **and its token differs** from the candidate's last verified token. The
  evidence records both tokens. The same conversation under the same token is `already-live`, but it
  is not disposed as resumed. A candidate with no verified conversation can never become `resumed`.
  **Derived by the daemon.**
- `superseded`: a newer candidate has the same non-null verified conversation. A claim alone never
  supersedes. The evidence is the newer candidate's id. **Derived by the daemon.**
- `dismissed`: an operator's decision, with their sentence. **Written only from a request.** See §5.

**Unresolved records never expire.** Resolved records older than 30 days are dropped from the
**index** but stay in the journal. That is the retention policy the spec asks us to state, and v1
deletes no journal history.

**Caps, and what happens past them — the evidence is never dropped silently:**

- **Record size**: a candidate whose serialised size is over 16 KB goes into the index as a stub
  `{ id, key, name, at, oversize: true }`, and the view says the full record is in the journal. The
  event itself is written whole. `RegisterEntry` is bounded, and `lastSeen.title` is capped at
  construction, so this is a guard, not a path we expect to hit.
- **Capacity**: 500 unresolved records. Past that, new candidates still go into the journal. The
  index counts them in `overflow` and does not hold them, and the page puts that count at the top.
  Evicting unresolved records to make room would be exactly the silent expiry the spec forbids.
- **The first page** is 100 records: unresolved first, newest disappearance first, then resolved.
  It carries `olderCount`. There is no pagination API in v1. The CLI lists every record the index
  retains. When `overflow > 0`, neither the page nor the CLI claims to list the omitted records:
  both give the exact count, and say those events survive only in `events.jsonl` (Sol's F10).

### 3. Logs that predate the event: a one-time startup replay

When `recovery.json` is absent, or its schema is unknown, `openStore` scans the log once from byte
0, bounded by the existing `REPLAY_CEILING_BYTES`. It folds `session-*` events through a scratch
register, so each `tmux-session-gone` can be joined to the entry it removed. Then:

- Every `recovery-candidate` and `recovery-disposition` already in the log is folded as usual.
- **A legacy candidate is derived only where the log itself proves a world change.** That means:
  a `tmux-session-gone` with `why: "tmux-server-changed"`; or a run of `absent-from-snapshot`
  gones sharing one `at` that emptied the scratch register, where the next `session-seen` names a
  different `tmuxServerPid`. That second pattern is also exactly what `goneWhileAway` writes, so it
  proves a world change and not an interruption. **Candidates derived from it are always
  `watched: false`, and so classify `unknown`.** Only an explicit historical
  `why: "tmux-server-changed"` means the daemon compared two baselines, and so may carry
  `watched: true` (Sol's F6). Derived candidates get `producerRun: "cannot-tell"` and
  `lastSeen: null`.
- **Missing evidence becomes `unknown`, never a fabricated entry.** A gone whose key the scratch
  register never saw (the log began mid-life, or an earlier cold start lost the prefix) yields a
  stub with `entry: null`. It is classified `unknown`, with "no register entry survives for this
  session". So the in-memory record type is `entry: RegisterEntry | null`, null only for a legacy
  stub. The live event's `entry` is never null (Sol's F7).
- **Legacy candidates are derived straight into the fold and written only to `recovery.json`**, not
  appended to `events.jsonl`. There is no replay-done event (Sol's F9: the original session events
  are already the durable evidence). Their ids are deterministic, a hash of the original gone
  event and its position within its same-`at` batch. So a rebuild after `recovery.json` is lost
  derives the same records, and later disposition events reattach to them. A gone that already has
  a live `recovery-candidate` before it is never derived a second time.
- **Over the ceiling, or across a hole, the replay does not run.** The index then says
  `replay: { kind: "not-run", why }`, which the page shows. It does not show an empty list.

On today's log this finds nothing (0 world changes), and the page will say exactly that.

### 4. The view: evidence against the current verified inventory

`recovery-view.ts`, run by the daemon, **never on a request**. It runs after any change to the fold,
after each accepted inventory, and at most once a minute in any case. Classification is pure. The
filesystem checks are async and bounded to the first page.

**Classification, per unresolved record, first match wins:**

1. **`unknown` — the inventory cannot be trusted right now.** No inventory has been accepted in
   this daemon's life; or the latest payload was refused, or failed, or was held since the last
   accept; or the record has no entry. *An empty list from a failed collection is not evidence of
   interruption*, and nothing in this arm looks at rows.
2. **`already-live`**: a row in the accepted inventory with a verified execution that has the
   candidate's verified conversation. When the token differs, the daemon also appends `resumed`.
   When the token is the same, the run was never gone, and the record stays `already-live`
   (Sol's F2).
3. **`present-but-unmatched`**: a row with the same `claimedConversationId`, or the same `name` and
   `meta.dir`, that is not proven to be the same conversation. It is shown with both rows' facts.
4. **`ended-before-reboot`**: `watched` is true, `lastSeen` exists, and that last accepted
   observation said `no-claude` or `shell:false`. The page phrases it as "last observed stopped
   before the world change", with the observation's clock. `entry` alone, a replay record, or any
   `watched: false` record cannot establish this (Sol's F4).
5. **`interrupted`**: `watched` is true, and either `generation` is `changed`, or `generation` is
   `unverifiable` and `producerRun` is `changed`. And none of the above matched (Sol's F1).
6. **`unknown`**: everything else. That includes `unverifiable` with an unchanged or unreadable
   producer run, which cannot be told apart from the last session closing normally; every
   `watched: false` record; and the dashboard-restart row in the table. The page shows the sentence
   saying why.

**Evidence, per record on the first page, with one clock for the whole pass (`checkedAt`):**

- `dir`: `entry.meta.dir`, `stat`ted. `exists` / `missing` / `not-recorded` (legacy meta).
- `worktree`: `entry.worktree` is display text, never something to `stat`. A worktree is recorded
  only when `meta.dir` itself is under `.claude/worktrees/<entry.worktree>`, and then `dir` above
  already covers it. Otherwise it is `not-recorded`; a path is not reconstructed (Sol's F8).
- `transcript`: `findTranscript(~/.claude/projects, <verified conversation>, meta.dir)` from
  `tools/fleet/transcript.ts`, reused rather than rewritten (it already handles the `EnterWorktree`
  relocation). On `found`, the returned path is `stat`ted once for its mtime. `findTranscript`
  itself does not return one. When only a claim survives, a transcript found under the claim is
  shown, **labelled unverified**, and `resume` stays `not-supported`.
  `found` / `found-under-claim` / `not-found` with its reason / `no-conversation`.
- `lastActivity`: the later of `entry.lastSeenAlive` (a floor, and labelled as one) and the
  transcript's mtime.
- `resume`: `supported` only when the harness is `claude-code`, there is a verified conversation,
  and its transcript was found. Otherwise `not-supported` with the reason — `codex-*` ("resume not wired
  in v1"), `claude-headless`, `unknown`, missing transcript. Shells and manual jobs (`shell`, or
  meta kind not `claude`) get **`manual`**, with the SSH path: the host name and `cd <dir>`.
- **No command is synthesised, from a title or from anything else.** The page shows facts. The next
  stage turns them into a launch. The roadmap's rule rules out a title as the source of a command;
  building one from a uuid and a path invites the same copy-paste into a terminal, and nothing in v1
  needs a command at all.
- **No filesystem read is evidence that work was completed.** A missing directory is a missing
  directory: it is never a disposition. `worktree:check` is not called.

### 5. Operator dismissal, without a second writer to the store

`scripts/overseer-recovery.ts` (new): `list` reads `recovery.json` read-only;
`dismiss <id> --why "<sentence>"` writes one request file, named by a fresh request id, into
**`~/.overseer/recovery-inbox/`**. This is the same drop-directory shape `work-reports` (plan
260910e-work-reports…) uses for `report-inbox/`; one shape for "somebody asks the single writer to
write", not two. On each tick the daemon reads the inbox and checks each request against the index.
It appends a `recovery-disposition` event, carrying the request id, for a valid one, and then deletes
the file. After a crash between the append and the delete, the same request comes round again. The
fold ignores a disposition whose request id it has already applied. A request for an unknown or
resolved id is recorded as refused, in a daemon note with its reason, and never applied. The daemon
stays the only thing that appends events.

There is no dismiss button in v1: that would be an action route, and action routes belong to
`action-receipts`.

### 6. The page

- **`tools/fleet/wire.ts`**: one appended block of types (`RecoveryFeed` and its record and
  evidence shapes). Types only, no imports.
- **`tools/fleet/recovery-feed.ts`** (new): reads `recovery.json` **asynchronously**, and parses it at
  the fleet boundary with its own validator. It does not import `tools/overseer/`: fleet parses the
  daemon's files itself. It returns `published` / `absent` / `unreadable` /
  `unsupported-schema`, and never an empty list standing in for one of those.
- **`tools/fleet/server.ts`**: one `GET /api/recovery` branch, modelled on `/api/decisions`
  (approved by the Overseer, 2026-09-10).
- **`tools/fleet/web/src/recovery-client.ts`** + **`RecoveryPanel.tsx`** (new): a self-contained
  section, polled only while mounted. Records are grouped by classification, with interrupted first.
  Each shows the name, the recorded directory and worktree (with existence), transcript existence,
  last activity (with the floor marked), latest evidence, resume support, and the manual SSH path
  for shells. Overflow, replay-not-run and unknown-inventory banners go at the top. **No buttons.**
- **`tools/fleet/web/src/App.tsx`**: one line mounting `<RecoveryPanel/>` below `<OverseerPanel/>`
  in the `overseer` arm (approved; `schedule-preview` is told where). A
  `tests/fleet-recovery-wiring.test.ts` guard pins the mount and the route, because a missing mount
  is invisible to every other test (Overseer's condition).

## Stages

Each stage is implemented by an **Opus subagent** in this worktree, not Codex (the brief: Codex's
weekly window is the tighter one). Each stage ends with **one** GPT Sol review, write-capable, run
at `--effort high --timeout-minutes 30`. I commit each stage. I tell the Overseer before any second
review round.

### Stage 0: this plan, reviewed

- [x] Plan reviewed by GPT Sol (read-only), 2026-09-10: *not ready*, four established P1s, two
  reasoned P1s and four P2s, no P0. All ten were checked against the code and accepted, and folded
  into the sections above. F3 and F5 take a different fix from the one proposed; see Findings.
  **No second plan round:** Codex is the tighter budget, and the Stage 1 code review tests every
  one of these against real code. [The review](260910e-recovery-inventory-plan-review-sol.md).

### Stage 1: the journal and the fold

Files: `tools/overseer/recovery.ts` (new: event types, id, candidate rule, `withRecoveryCandidates`,
`foldRecovery` with the pending-merge rule, caps, legacy derivation), `tools/overseer/diff.ts` (the
two new arms in `OverseerEvent` only), `tools/overseer/jobs.ts` and `tools/overseer/status-cli.ts`
(each handles the two new arms explicitly in its exhaustive switch; one line each, outside the
brief's file set by necessity — Sol's F7), `tools/overseer/store.ts` (`parseEvent` for the new kinds;
the third fold; `recovery.json` write/restore; **two bounded replays after the single torn-tail
repair** — one from `current.json`'s cursor, one from `recovery.json`'s, so the recovery fold never
gets only the tail chosen for `current.json`; `OverseerStore.recovery`), `tools/overseer/daemon.ts`
(the candidate insertion before `store.append` in `take()`, and the boot-id close-out — **merge
first, re-read before editing; the usage pass is web-260910's**), and new tests
`tests/overseer-recovery.test.ts` and `tests/overseer-daemon-recovery.test.ts`.

Tests, red first, through the real parser, gate, differ and store, driven by a scripted source:

- **The first accepted empty post-reboot snapshot**: run A with sessions under generation G1, then
  run B with `rows: []` and a null generation. Every session gets a candidate immediately before its
  gone, in the same append. The register is empty afterwards. **The index still holds every
  candidate**, with the final entry intact.
- **Generation change with sessions back**: G1 → G2 with rows. There is a candidate for every G1 row
  (`changed`), and none for the G2 rows.
- **An ordinary close** (same generation, same run, watched): **no** candidate.
- **The daemon was down** (`goneWhileAway`): a candidate, with `watched: false`.
- **Crash before candidate append**: the process dies before `append`. The restart re-diffs, and
  there is exactly one candidate.
- **Crash between candidate and removal**: the log ends with a complete candidate line and a torn
  gone line. `openStore` truncates the tail. The restart re-derives both, and the index holds one
  record (a duplicate id is folded once).
- **Crash before the recovery checkpoint**: `recovery.json` is one batch behind while `current.json`
  is up to date. `openStore` replays the recovery tail from its own cursor, and the index matches a
  fold from byte 0.
- **Distinct disappearances of one run (Sol's F3)**: a candidate is dismissed; the identical row
  comes back; a later collection removes it again. That yields a new, unresolved id.
- **A reboot that reuses the tmux pid (Sol's F5)**: a stored boot id B1, then a collection under B2
  with the same `tmuxServerPid` and the same handle. Every old entry gets a candidate
  (`bootChanged`), and its gone. An unreadable boot id changes nothing.
- **Old schema**: a log and `current.json` from before this plan, with no `recovery.json`. The
  derivation runs, `recovery.json` is written, and the second start restores it rather than scanning.
  Deleting `recovery.json` and restarting derives identical ids. A log with a `tmux-server-changed`
  batch yields `watched: true` records. The `goneWhileAway`-shaped signature yields
  `watched: false` records. A gone with no surviving entry yields an `entry: null` stub. A log with
  no world change yields none, and the index says so.
- **Caps**: a 17 KB candidate goes in as an `oversize` stub with the event intact, and 501
  unresolved records give `overflow: 1` with none evicted.
- **The live-log check, read-only**: a frozen copy of `~/.overseer/events.jsonl` taken at stage
  start goes through the new parser and the replay in a scratch root. It must refuse 0 lines and
  derive 0 candidates. It fails outright if it read fewer events than the copy holds.

- [x] Implementation (**Opus subagent**), tests red → green (44 red, then 44 green; five
  mutations, each turning the intended tests red), typecheck exit 0, 26 focused files / 748 tests
  green. Live-log check on a frozen copy (2,081 lines, sha256 `21130318…`): 2,081 parsed, 0
  refused, 0 world changes, 0 candidates.
- [x] Sol review (*accept*, three P1s fixed red-first in the stage, one P2 left for me); gates
  re-run on the fixed tree; commit.

Status, 2026-09-10: **done.** [Sol's review](260910e-recovery-inventory-stage1-review-sol.md):

- **F11, P1, fixed: a boot change did not close the old world when the new populated snapshot's
  tmux generation was unreadable.** `diff()` returned `held`, and the close-out never ran. The held
  arm now appends the old world's closures with their candidates, forgets the old baseline, records
  the boot id and checkpoints. The new world stays un-baselined until a readable generation arrives.
- **F12, P1, fixed: an orphaned pending candidate could swallow a later real disappearance.** An
  unchanged sighting writes no session event, so "any other event ends the wait" (decision 3 below)
  was not enough. Candidates now carry the collection behind their last sighting
  (`lastSeen.observation`), and only a candidate from the same sighting merges.
- **F13, P1, fixed: after a refused recovery-tail replay, `checkpoint()` moved the recovery cursor
  past the unread range**, which would skip valid candidates for good. The cursor now stays at the
  last range the fold accepted. `replay.not-run` records whether to retry the whole log or the tail,
  and the earlier verdict is restored once the range reads.
- **F14, P2, not changed — overruled by me.** When `recovery.json` is absent or unusable, the
  whole-log derivation starts with no boot id, so a reboot before the first later collection,
  with tmux reusing its pid *and* its handles, would go unseen. Sol's fix would close the whole
  restored register once, as "boot unverifiable", on every upgrade and every loss of the index,
  putting spurious `unknown` records in front of Greg. That noise is certain, and the miss needs
  three rare things together, so I kept the design. A P2, so it does not go to Fable or Greg.

Decisions the implementer made, recorded so the review could check them:

1. **An unstamped producer counts as the same run** in the candidate rule (`needsCandidate`). Read
   literally, the rule would write a candidate on every close from a dashboard without stamps.
2. **Candidates carry `hostBootId`**, so the fold can recover a newly recorded boot id after a crash
   between the append and `recovery.json`. A whole-log derivation deliberately does not recover it,
   because that could close out a live new world.
3. **Any other event for a pending key ends the pending wait**, so an orphaned candidate cannot
   swallow a real disappearance later.
4. **`recovery.json` is also written once the log is 1 MiB past its cursor**, so a quiet month cannot
   push the recovery replay past the 64 MiB ceiling.
5. An empty fold over an empty log writes no file.
6. A recovery tail that cannot be read keeps the restored records, and marks the index `not-run`.
7. `withRecoveryCandidates(events, register, context)`, with the baseline inside `context`.
8. **The 30-day retention of resolved records moves to Stage 2**, where the dispositions are.

**A narrow window, documented rather than closed:** if the process dies after the append and before
`recovery.json` is written, *and* the old register was empty, the next start closes the new world's
sessions a second time. That is noise, not lost evidence.

### Stage 2: the view, the dispositions and the CLI

Files: `tools/overseer/recovery-view.ts` (new), `tools/overseer/recovery.ts`,
`tools/overseer/daemon.ts` (the view pass on its triggers; derived `resumed` and `superseded`
appends; reading the request inbox), `tools/overseer/store.ts` (the view in `recovery.json`),
`scripts/overseer-recovery.ts` (new), and tests `tests/overseer-recovery-view.test.ts` and
additions to `tests/overseer-daemon-recovery.test.ts`.

Tests, red first (the spec's list, plus the spec's failed-collection rule):

- **Missing directory**: `dir: missing`. The record stays `interrupted` and is not resolved.
- **Transcript absent**: `transcript: not-found`, `resume: not-supported`, with the reason.
- **Valid Claude transcript** in a temp `projects/<slug>/<uuid>.jsonl`, including one relocated
  to a worktree slug: `found`, `resume: supported`.
- **Already-live matching execution**: `already-live`, and one `resumed` disposition event is
  appended with the new token. A second view appends nothing.
- **Empty rebooted fleet** (accepted, `rows: []`, readable new generation): every candidate is
  `interrupted`, or `ended-before-reboot` where `no-claude`.
- **A failed or refused collection after the reboot**: every record is `unknown`, whatever the
  rows said.
- **Present-but-unmatched**: a same-name, same-dir row without a verified matching conversation.
- **A shell session**: `manual`, with the SSH path, and no resume claim.
- **Dismissal**: a valid request yields one disposition event. A duplicate request, or one for an
  unknown or resolved id, is refused with a reason. The CLI never touches `events.jsonl`.
- **Superseded**: two candidates for one **verified** conversation leave the older one `superseded`,
  naming the newer. Two that share only a claim do nothing. That is §2's rule after Sol's F2; this
  line first said "claim" and contradicted §2, and the implementer followed §2.

- [x] Implementation (**Opus subagent**). Tests red first: both new files failed at import before
  the code existed, and five mutations afterwards (trust rule, same-token resumption, replayed
  request, retention of unresolved, a refused payload in the daemon) each turned exactly their
  tests red. Green: 53 of 53 on the two Stage 2 files; 26 focused files / 773 tests `EXIT=0`;
  typecheck exit 0. On the manager's own run: typecheck exit 0, and the three recovery suites 89 of 89.
- [x] Sol review, round 1 (timed out, fixes salvaged) and round 2 (read-only); an independent Opus
  check; the review fixes; a narrow Sol check of the four P1 fixes; Fable's settle of F22; commit.
  **Done, 2026-09-10.** The commits, in order: `730aec9d` the stage, `defba055` round 1's salvage,
  `c91c35cf` the review fixes, `2ce27ca5` F22b, `f938b023` the merge from `dev`, `b3475059` F22c and
  the reports-timer test. The merge result differs from `dev`'s tip only in this branch's own files.
  All 29 lines it deletes are this branch superseding its own older lines, or `dev`'s inline timer
  clearing now inside `stopTimers()`.

**Sol's round 1 timed out, and left fixes but no verdict.** The writable review (`--effort high`,
30 minutes) was killed at 1,800 s (`EXIT=1`) before it wrote an answer. No Codex process survived
it. It had already made coherent, red-first fixes in the tree. Its six new tests name what it
found, numbered here because the run never did:

- **F15:** an older, trusted view pass finishing after a failed collection could overwrite the
  failed collection's `unknown` view. Fixed: each pass carries a revision, and a stale pass is
  discarded.
- **F16:** a request with a malformed `requestedAt` was normalised into a valid dismissal. Fixed:
  it is refused.
- **F17:** while a recovery replay is `not-run`, the fold is stale, so a crash-replayed dismissal
  could be applied twice. Fixed: the drain and the derived dispositions do nothing while the replay
  is `not-run`, requests stay pending, and the view is untrusted.
- **F18:** the drain's scan was unbounded, and a path swapped for a symlink after the request was
  claimed could be followed. Fixed: a scan limit that counts junk names; `O_NOFOLLOW`; a bounded
  read; a claim into `processing/`, so a crash cannot strand or overwrite a request; and the drain is
  async, off the tick.
- **F19:** `already-live` depended on row order, and could invent a resumption without the previous
  token. Fixed.
- **F20:** the transcript search was unbounded over `~/.claude/projects`. Fixed: a directory limit,
  with a `cannot-tell` arm that makes `resume` not-supported.

With them in: typecheck exit 0, and the three recovery suites 95 of 95 (the manager's run). **These
fixes are committed as unreviewed code.** A **second round, read-only and findings-only**
(`--sandbox review`, 30 minutes), reviews the whole stage including them. Beside it, an
**independent read-only Opus agent** checks the salvaged hunks against the plan's contract. An Opus
subagent then fixes whatever either finds. All of this is on the Overseer's terms, given before the
round: 30 minutes, not 45 ("length has never been what saved one"), plus the Opus salvage check,
which caught a latent P1 in another session's salvage the same day. If Sol times out again, the
fallback is Fable, recorded as not cross-family.

**The Opus salvage check, 2026-09-10.** It reverted each hunk alone in a scratch copy, and every one
of F15–F20's tests went red without its fix. F15, F16, F18, F19 and F20 are sound, three of them
with a caveat. **F17 was only half done:**

- **O1, P1, established by a reproduction.** While the replay is `not-run`, the drain was blocked,
  but `take()` still appended *derived* dispositions from the stale fold. One accepted collection
  gave two `resumed` events for one record. Fix: `appendDerived` does nothing while `not-run`.
- **O2, P2:** the `not-run` hold is silent to whoever ran `dismiss`, and it can outlive every restart.
- **O3, P2:** F20's bound of 100 project directories is too low for this box (63 today). F20 also
  reimplemented `findTranscript` rather than reusing it. That departs from §4, and is recorded here
  once the fix settles it.
- **O4, P2:** the inbox scan stops silently at its limit.
- **O5, P3:** the view can be starved by trusted-to-trusted invalidations.
- **O6, P3:** a claimed request file that cannot be read is logged every tick, never refused.

All six go to an Opus subagent in one pass with Sol's round-2 findings
([the brief](260910e-recovery-inventory-stage2-fixes-task.md)).

**Sol's round 2, read-only, 2026-09-10: *refuse*, on four established P1s**
([the review](260910e-recovery-inventory-stage2-review-r2-sol.md)):

- **F21, P1:** the same defect as O1, found independently. Two reviewers from two model families
  reached it by different routes.
- **F22, P1, reproduced:** the bounded inbox scan spent its whole budget on junk in `processing/` and
  restarted on the same junk every tick, so a valid request was never reached. O4 had tried this and
  not reproduced it. Fix: quarantine the junk it has examined, so every pass makes progress.
- **F23, P1:** a daemon stopping on an exception could loop forever in `settleInFlight`, because the
  ticks kept requesting views. That would hold the lock and block systemd from replacing it. Fix:
  stop the timers first.
- **F24, P1:** retention pruned the fold in `checkpoint()` after the view had been built, so
  `view.page` could show a record that `records` no longer held. Fix: the same predicate, shared,
  in the view.
- **F25, P2:** a malformed `view` crashed `list`. Fix: runtime checks.
- **F26, P2:** the duplicated transcript locator. **Kept, and not extracted:** the extraction needs
  `tools/fleet/transcript.ts`, which is outside this plan's file set. The local copy says why in its
  header, and **a shared bounded locator is a named follow-up**.
- Sol also judged F15, F16, F19 and F20 sound; F17 not sound (F21); and F18 not sound overall
  (F22). It found no route from the F11 boot-change held path to trusted classification.

**Discovery closes here, after two rounds.** F21–F24's fixes were not in the snapshot round 2 read,
so the engineering-manager rule applies: a narrowly scoped check of those four fixes, and nothing
wider. **The Overseer's call:** Sol, read-only, 20 minutes, one prompt scoped to F21–F24, with the
reproductions handed over as raw output
([the prompt](260910e-recovery-inventory-stage2-fixcheck-prompt.md)). If that times out, Fable,
recorded as not cross-family, and no further round.

**The fix pass (an Opus subagent), 2026-09-10.** O1–O6 and F21–F25 were each fixed red-first; F26
was kept, as decided above. Red before any fix: 12 failed and 58 passed. Green: the three recovery
files pass 106 of 106 (the manager's own run agrees); 28 focused files / 835 tests `EXIT=0`;
typecheck exit 0; biome 0 errors. Deviations worth knowing:

- F22's quarantine is a new `recovery-inbox/junk/` directory, never scanned and **never cleaned**.
  It grows only through hostile or accidental writes.
- O6: a claimed file that vanished (`ENOENT`) is logged, not refused, because there is nothing left
  to refuse.
- O2's daemon line is `RECOVERY REQUESTS HELD`, kept apart from the existing
  `SCHEDULED JOBS ARE HELD`.
- **F24 left two short windows**, each needing `store.ts`, outside that brief: a record expiring
  between the view pass's clock and the checkpoint's. **Closed by the same subagent at the single
  write point**, on my authorisation for that one change in `store.ts`, again red first.

**Sol's narrow check of the four P1 fixes, 2026-09-10, read-only, 20 minutes**
([the answer](260910e-recovery-inventory-stage2-fixcheck-sol.md)): **F21/O1, F23 and F24 closed.
F22 not closed.** The starvation is fixed, but the quarantine is too broad. A correctly named
request whose `open()` fails for any reason other than absence (a transient `EMFILE` or `EACCES`)
was moved into `junk/`, losing an operator's dismissal silently. Fix, as Sol proposed: `lstat`
positively identifies request-named symlinks and non-regular entries, and only those are
quarantined. A regular request that cannot be opened is logged and left for a later pass. Applied
red-first by the same subagent. Under the engineering-manager rule (a check after round two that
comes back still open is settled through Fable or Greg, not waved through) and the Overseer's
"no further Sol round", **Fable confirms the settle**, recorded as not cross-family.

**Fable's settle check, 2026-09-10: F22 closed** (`2ce27ca5`). It checked all four paths:

- **A transient open failure:** the request is left in place and logged, never junked.
- **The race between `lstat` and `open`:** only the symlink that was swapped in is moved.
- **A claim that then fails to open:** the request stays in `processing/`.
- **The scan bound:** an unopenable request delays the drain, and is never lost.

It also confirmed that the regression test was really red first, running as uid 1000, so `chmod 000`
genuinely took effect.

**One adjacent residual, closed as well.** The claimed-first sort's comment promised that an inbox
copy could never overwrite a crash-left copy of the same name in `processing/`. F22b had defeated
that: an unreadable `processing/` copy dropped out of the scan's list, so a same-uuid inbox file
would be renamed over it. The tooling never makes two files with one uuid (`dismiss` mints a fresh
one every time), but the comment claimed a guard the code no longer had. The fix is to `lstat` the
destination before the rename and leave the inbox copy for a later pass. Red first.

**Stage 2 is then done:** the stage, three review passes (round 1 salvaged, round 2 read-only, the
narrow check), an independent Opus check, and Fable's settle.

**The second merge from `dev`, 2026-09-10 ~16:12: a real conflict, shown as a proposal first.**
Stage 3's start-of-stage `git merge origin/dev` conflicted in four hunks of `daemon.ts`. On the
other side were `work-reports`' reports drain (`313b6bf5`) and `schedule-preview`'s daemon-written
`schedule.json` (`6b5ce4a9`…`f597c7d0`). The resolution was sent to the Overseer before any edit,
and approved:

- **Imports:** both kept, with `dev`'s superset for `schedule-plan` and `scheduler`.
- **The block before the ticker:** both kept, unchanged. Ours was renamed to `recoveryEvidence`, so
  that no use of `evidence` in `dev`'s code can read it.
- **The ticker:** `recoveryTick()`, then `dev`'s one-reading, one-headline checkpoint exactly.
- **The `finally`:** ours (`stopTimers()`, Sol's F23), **and `stopTimers` now clears `dev`'s
  `reportsTicker`.** That is the one real catch. Taking ours as it stood would have left the reports
  timer running after a stop; taking `dev`'s would have dropped F23's exception-path guarantee. On
  the Overseer's condition this is a behaviour change to `work-reports`' code, so it gets a
  red-first test on both exit paths, and `work-reports` is told.

My bare `checkpointUpdate()` in the recovery view follows `dev`'s own pattern in `take()`: with no
evidence, `schedulerStandingNow()` reads the documents itself, and does not fail closed. The 19
test files that import the daemon, reports, schedule-preview or recovery code all pass. The one red,
`fleet-reports-route`, was the known missing built client, and it passes 13 of 13 after
`npm run build:fleet`.

What landed, beyond the brief: `tools/overseer/recovery-inbox.ts` (new), one leaf that both the CLI
and the daemon use, so the request format lives in one place. Decisions the implementer made:

1. **Retention counts 30 days from resolution**, not from disappearance.
2. **A replayed dismissal is refused** as "already applied", into `recovery-inbox/refused/`, not
   dropped quietly.
3. **The view is not carried over a daemon restart.** Its classification was made against an
   inventory the previous process trusted, so `view` is `null` until the new daemon's first pass,
   and every record is `unknown` until a collection is accepted.
4. **`manual` records the host and the directory as two facts.** No `cd` string is built.
5. **A departure from §5:** a refused request is recorded in `refused/<id>.json`, with its reason
   and a log line, not in a daemon note. A note needs a new kind in `notes.ts`, which is outside
   this stage. A named follow-up if the Overseer wants refusals in `overseer notes`.

Status, 2026-09-10: implemented, awaiting its Sol review. **One merge conflict, which I
resolved myself:** the `origin/dev` merge at the start of the stage (schedule preview's Stage 1,
`18f64a04`) conflicted in one hunk of `daemon.ts`. The two sides were adjacent import lines,
`./recovery.js` and `./schedule-plan.js`, importing different names from different modules. I kept
both. There was nothing to weigh between them, so the house rule of showing Greg a merge conflict as
a proposal first was not needed for it. Merge commit `d45cac60`. After it, typecheck exited 0 and
the two recovery suites passed 49 of 49, before any Stage 2 edit. There is no shared inbox-drain
helper on `dev` (`work-reports` has not landed one), so Stage 2 writes its own small drain.

### Stage 3: the fleet boundary and the page

Files: `tools/fleet/wire.ts` (appended block), `tools/fleet/recovery-feed.ts` (new),
`tools/fleet/server.ts` (the route, approved), `tools/fleet/web/src/recovery-client.ts` and
`RecoveryPanel.tsx` (new), `tools/fleet/web/src/App.tsx` (the mount, approved), and tests
`tests/fleet-recovery-feed.test.ts` and `tests/fleet-recovery-wiring.test.ts`.

- **The feed's arms**: absent, unreadable, unsupported schema, and published. There is no path from
  a failure to an empty list.
- **The simulated-reboot acceptance**: a disposable store built by driving the real daemon through
  G1 (four sessions: a Claude that was working, one whose Claude had exited, a shell running a job,
  one with a missing directory) → an empty post-reboot snapshot → G2 with one session resumed. It
  is served by a fixture-backed fleet server on its own port. **A browser check by an Opus
  subagent** (the Sonnet budget is exhausted until 2026-09-12) at desktop and phone widths, via
  Playwright on this box, against a disposable server started by the subagent. It must not touch
  the shared 8787 dashboard, and must kill only its own PID.
- `npm run build:fleet`; the full suite through `scripts/tmux-job.ts`; typecheck; lint the touched
  files.

- [x] Implementation (**Opus subagent**). Red first was shown by mutation, because the code was written
  before its tests. Each mutation turned exactly its tests red:
  - the feed skipping a malformed record;
  - the inventory sentence repeated on every row;
  - a POST let through;
  - the `App.tsx` mount removed.

  Gates:
  - typecheck exit 0;
  - `build:fleet` exit 0;
  - 27 focused files / 1,283 tests `EXIT=0`;
  - the new suites: feed 20, route 13, panel 23, wiring 6;
  - on the manager's own run, typecheck exit 0, and the five suites 67 of 67.
- [x] **The acceptance, shown.** `scripts/overseer-recovery-drill.ts` drives the real daemon through
  boot B1 / generation G1, with four sessions. Then comes an empty post-reboot snapshot under B2,
  then G2 with one session back under a new run. The page was served from that disposable store on
  a server of the subagent's own (port 8791; the shared 8787 was untouched). The manager looked at
  the screenshots, at 1280 px and 400 px:
  - *Interrupted*: `drill-dir-deleted`, with its directory **missing** and its transcript not found.
    `drill-shell-job`, marked manual, "on spideryarn-box, in …".
  - *Stopped before the world change*: `drill-claude-exited`, last seen `no-claude`.
  - *Resolved*: `drill-claude-working`, resumed, with both run tokens.

  The page has no buttons, no links and no command text. Its footer reads "Read-only. Nothing on
  this page starts, resumes or dismisses anything." Nothing wider than the screen at 400 px. No
  console errors.
- [ ] Sol review; commit; full suite; push.

**Sol's review, read-only, 2026-09-10: *refuse*, on seven established P1s; no P0**
([the review](260910e-recovery-inventory-stage3-review-sol.md)):

- **F27:** the 16 MiB ceiling was `stat` then `readFile`, so a growing file defeats it.
- **F28:** the drill's guard for the live store was beaten by a symlinked ancestor, and it ignored
  an absolute `OVERSEER_STORE_DIR`.
- **F29:** the fleet parser did not require the fields that must agree to agree, so one session's
  evidence could attach to another record.
- **F30:** the browser parser had no whole-payload check, so contradictory claims rendered side by
  side.
- **F31:** the view's age came from the browser's clock.
- **F32:** some rows omitted evidence the plan requires.
- **F33:** the empty-state sentence contradicted the overflow banner.

Two P2s: F34 (parsing 16 MiB synchronously), which is **measured, not rebuilt**, and F35 (the
wiring guards were text searches), where the page side renders the real `App` and the server side
stays a stronger source check. All of them go to one Opus fixer
([the brief](260910e-recovery-inventory-stage3-fixes-task.md)).

**The Overseer's terms for what follows.** One read-only Sol check of the seven P1 fixes only: 20
minutes, raw red/green handed over, findings to a separate file. If it times out, Fable, recorded as
not cross-family, and no further round.

- **F29 and F30 are handed over with the most care.** A parser that never checks the fields that
  must agree is the "true number under a label claiming more" class. One session's evidence
  rendered on another's record is the one output this page may never produce.
- **The drill's live-store guard (F28) is not to be trusted until it resolves real paths and
  honours an absolute `OVERSEER_STORE_DIR`.** Until the fix is checked, run the drill only with a
  target that is plainly a fresh scratch directory.

**The full suite on `bcd11529`** (`npm test` through `tmux-job`): 1,019 files passed, 3 failed,
1 skipped. The three:

- **`cold-start-lazy-imports` and `pdf-bundle-trace`**: the known environment failures of a worktree
  with no `api-dist/`.
- **`fleet-attention` › "imports only the Overseer modules that were argued for"**: not this plan's.
  The `dev` snapshot merged at `f938b023` had `schedule-preview`'s `schedule-wiring.ts` importing
  `tools/overseer/store.ts`. That pulled `store.ts`'s whole graph onto the fleet side, and since
  Stage 1 that graph includes `recovery.ts` and `recovery-view.ts`. None of this plan's fleet files
  imports anything from `tools/overseer/`. `schedule-preview` fixed it on `dev` in `b8505d8b` (16:39,
  "keep the dashboard off the Overseer's module graph"). The final merge picks that up, and the
  test is re-run on it.

**The fixes (an Opus subagent), 2026-09-10.** F27–F33 went red first, for the intended reasons, and
then green. F35 is a check-only change, so it was shown red by mutation: the old check passed a
mutant `App` and Sol's `if (false)` server mutant, and the new one refuses both.

Gates:
- the four recovery suites, 95 of 95;
- typecheck exit 0;
- `build:fleet` exit 0;
- `fixture-ids` 5 of 5;
- a fresh 400 px browser check on the implementer's own server (8796).

Worth knowing:

- **F28:** the drill's guard now covers both `~/.overseer` and an absolute `OVERSEER_STORE_DIR`. It
  resolves the nearest existing ancestor's real path, refuses a dangling link, and refuses a store
  inside the target. It rechecks immediately before creating anything, and confirms the new root
  by `realpath`.
- **F29, one deliberate deviation from the brief.** A view item that says `unresolved`, beside a
  record the file now holds as resolved, is **accepted and ignored**, not refused. The daemon
  writes exactly that state: `appendDerived` appends the disposition, and the next checkpoint writes
  the new records beside the view it already held. The record's own resolution decides its state,
  so none of the stale item's evidence is drawn. Every other resolution mismatch is refused.
  Strict equality would have raised a "view unreadable" alarm after every resume. The narrow check
  is asked about this by name.
- **F34, measured, not rebuilt.** The files were in the producer's shape, and each figure is the
  median of 5 runs at a load average of about 9.5:
  - 500 unresolved records at the 16 KB cap: 8.09 MiB, blocking the event loop for **27 ms**;
  - the same plus 493 resolved, just under the ceiling: 15.98 MiB, **45 ms**.

  Both are under 100 ms, so the ceiling stays at 16 MiB and there is no worker.
- **F35:** the page side renders the real `App` on `#overseer`. The server side parses `server.ts`
  with `@babel/parser`, and checks that the dispatch is a direct top-level statement of `handler`,
  with no earlier branch that would take `/api/recovery`. What it cannot see: what other routes'
  `handle` methods claim; computed conditions; and whether the server runs.

Status, 2026-09-10: implemented, reviewed (refused), fixed; the narrow check comes next. The shared-file hunks:

- `server.ts`: the three approved lines.
- `App.tsx`: the approved mount line, **plus its import line**. The mount cannot exist without it,
  and the Overseer was told.
- `wire.ts`: 17 `Recovery*` types, appended after `work-reports`' block.

Decisions the implementer made, recorded so the review can check them:

1. **One malformed record makes the whole index `unreadable`**, and the page names the record. It
   never shows a shorter list. That is how the store itself restores the file.
2. **The first page is the 100 records the daemon's view pass checked**, in its order, then grouped
   with interrupted first, so old unchecked records cannot push classified ones off the page.
3. **GET and HEAD** only, like `routes-decisions`.
4. **A 16 MiB input ceiling**, checked on the open file before any read.

## What this deliberately does not do

- **Start, resume or offer to resume anything.** No command text, no button, no route that acts.
- **Read `worktree:check`, or any filesystem state, as proof that work finished.**
- **Mark a candidate resolved because its directory is gone.**
- **Add the recovery index to `current.json` or to `/api/state`.** See §2.
- **Emit a candidate for ordinary watched closes.** See §1.
- **Paginate beyond the first page in the UI.** The CLI lists everything.
- **Change `diff()`'s behaviour.** It stays pure. The empty post-reboot snapshot still closes
  every session, which is now safe, because the evidence goes into the log first.

## The simpler options passed over

- **Keep gone entries in the register, marked closed**, rather than adding a fold. Every register
  consumer (attention, work, the Overseer panel, `known` executions) would then have to learn to
  skip them, and `current.json` would grow for ever. A separate index keeps "what is running" and
  "what was interrupted" as two facts.
- **Reconstruct candidates from the log on every page request.** That is simple, and it is exactly
  what the spec rules out: the log is unbounded, and the request path must not fold it.
- **Have the fleet server classify against its own live inventory.** It is fresher. But
  interpretation is the Overseer's under the roadmap's ownership contract, and the fleet cannot
  tell "the Overseer refused that collection" from "that collection was fine".
- **A candidate on every gone.** About 280 records a day that nobody would read. See §1.

## Findings

### Stage 0: plan review, GPT Sol, 2026-09-10 (*not ready*)

Each finding was checked against the code before it was accepted.

- **F1, P1, established: an ordinary last-session close was classified `interrupted`.** Accepted:
  `unverifiable` counts as interrupted only when the producer run also changed.
- **F2, P1, established: `resumed` matched a stale claim, and did not require a new execution.**
  Accepted: matching is on the verified conversation from `lastSeen`, and needs a different token.
  A claim never resolves anything.
- **F3, P1, established: the id conflated two disappearances of one run.** Accepted, with the
  collection identity in the id. **Plus a rule Sol did not propose.** An id that names the removing
  collection can be re-derived from a *later* collection after a crash that leaves a candidate line
  in the log and tears the gone line after it. So the fold merges a candidate whose predecessor for
  the same key never saw its gone, and a candidate is built only from an entry the register still
  holds.
- **F4, P1, established: `ended-before-reboot` trusted state from before an unwatched gap.**
  Accepted: only a watched `lastSeen` establishes it.
- **F5, P1, reasoned: a reboot can reuse the tmux pid.** Accepted, **with a different fix**: the
  daemon reads its own host's boot id, rather than a new wire field (which would be producer work
  outside this plan), and closes the whole old world on a change.
- **F6, P1, reasoned: the legacy reboot signature is also `goneWhileAway`'s shape.** Accepted: those
  records are `watched: false`, and so `unknown`.
- **F7, P2: types and files that would not build.** Accepted: `entry` is nullable in the fold only;
  `jobs.ts` and `status-cli.ts` join Stage 1; two independent replays.
- **F8, P2: `worktree` is not a path, and `findTranscript` returns no mtime.** Accepted.
- **F9, P2: synthetic replay events were unneeded.** Accepted: legacy records are derived into the
  fold with deterministic ids, and there is no marker event.
- **F10, P2: the overflow wording promised the CLI could list omitted records.** Accepted.

## Status

2026-09-10: plan reviewed (Stage 0 done), Stage 1 next.
