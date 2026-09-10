# Durable action receipts for the fleet dashboard

**Status, 2026-09-10: plan settled after two rounds of GPT Sol review (both "rework", no P0) and a
Fable arbitration on the one contested call — F10 withdrawn, so F15 falls with it (§ Plan review).
Discovery is closed. Stage 1a next. Nothing built.** Queue item
`qi-zabqe99q`, dispatched by the Overseer. This is the roadmap stage
[260908f § Durable action receipts — restart without guessing or repeating a write](260908f-overseer-and-fleet-improvement-roadmap.md#stage-durable-action-receipts--restart-without-guessing-or-repeating-a-write),
and it absorbs [260908j § Stage 5 — request ids and receipts](260908j-delivery-receipts-and-honest-outcomes-for-the-fleet-dashboard.md#stage-5--request-ids-and-receipts),
which was specified as instance-scoped and never built. This plan makes it durable.

## What the job is for

The dashboard accepts actions — a queued message, a direct steer, an answer to a dialog, a
broadcast, a kill, a worktree removal — and today nothing written down can say afterwards whether
an accepted action happened once, twice or never. The queue is memory (`queue.ts`,
`PERSISTENCE_WARNING`), so **a restart discards acknowledged work and records nothing**, and the
dashboard on this box restarts several times an hour. A phone that loses a response and presses
again sends a second message, because nothing recognises the first.

The acceptance sentence from the roadmap is the whole contract:

> restarting cannot silently drop acknowledged queued work or send an ambiguous message again. A
> receipt explains what is proven and unknown.

And the rule it sits under, from 260908j: *observed, inferred, claimed, unknown and not supported
remain distinguishable all the way to the browser. `keys submitted` is not `read`.*

This is the middle of Greg's three standards (2026-09-08): *"Briefly broken is fine for dev, have a
slightly higher standard for the orchestrator and its web interface, and a higher standard still
for keeping things working in prod."*

## The ground, measured

- **Every keystroke goes through one door**, `send-coordinator.ts`, which checks the quarantine book
  and writes a hold-ledger `attempt` record before calling the transport. A throw is never resolved,
  so a restart rebuilds a hold. That already covers *the session* after a crash; nothing covers
  *the action* — which request it was, whether it was queued, whether it finished.
- **The transport never observes reception.** `sendMessage` succeeds when its `send-keys` calls
  complete (`steer.ts:1381`); nothing afterwards reads the pane to see the message arrive. So the
  strongest proven state for a message is **keys submitted**. See § What this does not build.
- **Three kinds of producer**, with different shapes of effect:
  - *queued work* — `POST /api/actions/session` in `enqueue` mode, and the queued half of
    `POST /api/broadcast` via `enqueueSharedMessage`. Delivered later by `drain.ts`.
  - *direct keystrokes* — `POST /api/steer/message`, `/api/steer/answer`, and the send half of a
    broadcast. Synchronous (`execFileSync`).
  - *enacted plans* — `remove-worktree` and `kill-session` (session route, `runPlan`), and the box
    kills (`killRoute`). Async, with external effects outside any conversation. Behind
    `FLEET_ACT_ENABLED`, which stays off; built and tested with fake `ActionIo`.
- **Five command gestures mutate an existing action rather than being one**: cancel, clear, revive,
  abandon, hold release. They get no receipts of their own; cancel, clear and abandon write to the
  receipt of the action they change, revive and hold release do not (§ Restoring says why).
- **Outside callers exist.** The Overseer posts to `/api/actions/box` (dry run only,
  `tools/overseer/rule-work.ts:172`) and its CLI posts to `/api/steer/message`
  (`tools/overseer/cli-state.ts`). `scripts/fleet-restart-plan.ts` reads the queues from
  `GET /api/actions` to report what a restart would discard. None is in this file set.
- **The web client ignores `volatile`** and renders `queue.warning` verbatim
  (`actions-client.ts:413-426`, `ActionButtons.tsx:1581`), and it builds a queue item field by field
  from the wire type — so the warning's sentence can change without a client edit, and **a new
  required field on `QueuedItem` cannot** (the compile guard would stop the client building).
- **There is a proven store to copy.** `hold-ledger.ts`: append-only JSONL in `~/.fleet-holds/`
  (0700), one writer by `tools/overseer/lock.ts`, a torn last line repaired at open by
  `jsonl.ts`'s `truncateToLastLine`, a `stillOurs` check before every append, compaction through
  `writeAtomically`, and fail-open on write failure. Sixteen mutations, sixteen caught.

## The design

### Two ids, and neither is the other

- **`receiptId`** — the durable action instance id, minted by the server at acceptance:
  `<serverInstanceId>-r<n>`, the existing run-qualified convention (`instance.ts`) — collision-
  resistant rather than intrinsically unique, and made safe against a repeated run token by the
  reservation rule in § Restoring. Distinct from the action vocabulary id (`compact`) and from the
  queue item id.
- **`requestId`** — the idempotency key, **minted by the client once per intention** and reused for
  every retry of that intention (see Stage 4 for the envelope that makes "reuse" real). Optional on
  the write routes that create an action, so existing callers keep working; an action without one
  still gets a receipt and simply cannot be deduplicated.

  The id carries its mint time: `rq-<ms since epoch, base36>-<16 to 40 chars [a-z0-9]>`. That is
  what makes the retention rule safe rather than hopeful — § Retention.

### The fingerprint (260908j's R5)

**A sha256 over the canonical JSON (keys sorted) of a `WireIntent` — the client-supplied fields
exactly as sent and shape-validated, with `requestId` removed — every field, not a chosen list.**
That includes `declaredStatus`, `panePid`, the full question material, the ordered broadcast
recipients, and the complete preview claim and submitted material. **Nothing the server derives goes
in**: not the catalogue `Action` a parse resolves an id to, not a preview entry, not the tmux
generation or this run's instance id. Those are evidence on the receipt; hashing any of them would
make an identical retry conflict with itself after a deploy or a restart.

A genuine retry resubmits the original envelope byte for byte. A request rebuilt from refreshed
observations is a new intention and gets a new `requestId`.

**The order in a route (Sol F16):** check the origin, read the body, validate its JSON shape and the
`requestId` — a present but malformed id is refused, never downgraded to an unkeyed request — compute
the fingerprint, and **look the id up before catalogue resolution, preview freshness, rate limiting
or any other check about executing now.** Same `requestId` and fingerprint → the stored receipt comes
back and **nothing happens**, even if the action has since been removed from the catalogue or its
preview has expired. Same `requestId`, different fingerprint → `409 request-id-conflict`. Only an
unknown id goes on to the current validation.

### The actor (roadmap: "actor")

Every `accepted`, `withdrawn` and `reconciled` record carries `actor: {kind, id}`, separate from
`speaker` (which is the message's authorship, rendered to the agent). The dashboard has no
authentication — the CSRF origin check is not identity — so:

- where the body claims a speaker: `{kind: "client-claimed", id: <that speaker>}`, and `speaker` is
  kept separately;
- where it claims nobody — `/api/steer/answer` and a box `run` have no speaker field (Sol F18):
  `{kind: "unattributed-http", id: null}`;
- a record written by the drain or by recovery: `{kind: "system", id: null}`.

`speaker` is nullable and operation-specific, never invented. Nothing is ever promoted to an
authenticated actor.

### The receipt's states

```
                  ┌──── returned (proven nothing sent; queued work goes back) ────┐
                  ▼                                                               │
  accepted ──► attempted ──► keys-submitted   (every send-keys completed)          │
     │             │     ├─► completed        (an enacted plan passed every gate)  │   [Stage 3]
     │             │     ├─► plan-stopped     (a gate refused at step k)           │   [Stage 3]
     │             │     ├─► not-sent ─────────────────────────────────────────────┘
     │             │     └─► outcome-unknown  (partial, unknown, threw,
     │             │                           none-contradicted, lease-abandoned)
     │             └─ crash ──► outcome-unknown (interrupted), written by the next run at open
     ├─► withdrawn   (cancelled or cleared before it was attempted — proven not sent)
     └─► not-sent    (undeliverable, lost-at-restart, tmux-generation-unproven or -changed,
                      recovery-blocked)

  outcome-unknown ──► reconciled { lease-abandoned }        (Stage 4 adds its own gesture's arms)
```

- **Every arm names its producer.** `keys-submitted`: the coordinator's `ok`. `not-sent`:
  `nothingWasSent`, the coordinator's `held`, a queued item that can never be delivered, and the
  recovery conclusions. `withdrawn`: cancel/clear. `outcome-unknown`: the coordinator's ambiguous
  readings, a throw, recovery. `reconciled`: the abandon route (`lease-abandoned`), which is about
  one leased item. **The hold-release gestures do not write receipts** — a receipt never ends a hold
  and a hold never rewrites a receipt (§ Restoring, the barrier bullet); Stage 4's reconciliation
  gesture for an enacted plan adds its own arms, labelled as a person's statement.
- **A reconciliation never turns unknown into proven.** It records who looked and when.
- **Terminal is terminal.** The journal refuses (and counts) a transition the machine does not
  allow, rather than writing it.
- **There is no automatic retry, anywhere.** `returned` is the existing `queue.release` hole —
  nothing was typed — and nothing else.

### The stores, and who owns them

**The physical JSONL machinery** — lock, torn-line repair, `stillOurs` before each append,
checkpoint replacement through `writeAtomically`, `status()` — is extracted from `hold-ledger.ts`
into `tools/fleet/journal-file.ts`, **limited to bytes, locking, repair and replacement**. Parsing,
the transition rule, fail-open/closed, retention and folds stay in the two domain stores. The hold
ledger's own tests pass unchanged across the extraction; that is the proof it preserves behaviour.

**One writer claim for both stores.** `~/.fleet-holds/writer.lock` — the hold ledger's existing lock —
is taken once at startup and both stores are opened under it: `holds.jsonl` and `receipts.jsonl`.
Two locks could let two starting dashboards each win one. The composition is an explicit
`openFleetActionStores()` returning the book and the journal, called from `server.ts` above
`createServer` in place of `openSharedQuarantine()`. **The Overseer authorised that one line on
2026-09-10**, with conditions: that line only; `tests/fleet-hold-wiring.test.ts`'s source guard must
pin that **both** stores open above the listener, so the receipt journal cannot later be moved below
it; merge `origin/dev` and re-read `server.ts` before editing (another session may touch its wiring);
name the file in the commit message.

`~/.fleet-holds/` is already *"the dashboard's record of its own actions"* by its own header, 0700,
single-owner, and outside every worktree; the Overseer's `~/.overseer/` is never written.

### Records

All `schema: 1`: `accepted` (receiptId, requestId, fingerprint, op, origin, actor, speaker, target
{sessionId, paneId, claudeSessionId, tmuxGeneration}, what, serverInstanceId, queue {itemId,
enqueuedAt} | null), `attempted`, `returned`, `progress` (Stage 3), `outcome`, `reconciled`,
`withdrawn` (**one record naming every receipt a clear affects**, so the mutation is all-or-nothing),
and `generation` (the latest tmux generation this dashboard has observed — § Restoring).

### Write-ahead, and when a failed write stops the action

The hold ledger fails open, and for **unkeyed** actions this keeps that: a journal that will not
open, is locked out, or cannot write does not stop an action; the response and the queue's warning
say the work is not durable, and `status()` and the log say why.

**Four writes fail closed, because without them the acceptance sentence is false:**

1. **A keyed action's `accepted`.** If it does not land: `503 receipt-unavailable`, no effect.
   Otherwise the effect runs, the response is lost, the restart finds no reservation, and the retry
   sends again (Sol F1).
2. **`attempted`, for any action whose `accepted` is durable.** It must land before any queued send,
   direct keystroke, broadcast recipient or plan step; if not, no effect, and a queued item stays
   queued, held with reason `not-durable`. Otherwise a crash after the send leaves a file that says
   *still queued*, and recovery delivers it again. **So for such an action, `accepted` without
   `attempted` is proof it was not attempted.**
3. **`enqueue`**: `accepted` and its material land before the item enters queue memory or a 200 is
   returned — or the enqueue is unkeyed-and-fail-open, and its response says `durable: false`.
4. **`withdrawn`, before cancel or clear change queue memory.** If it cannot land for a durably
   accepted item: `503 receipt-unavailable`, and that item is unchanged. Once it lands, the item is
   removed and the answer is success; recovery sees `withdrawn` and does not restore it. Without the
   ordering, a person told *cancelled* would see it restored and delivered after a restart (Sol F2).

Settles after an attempt stay fail-open: the durable `attempted` already prevents restoration, so a
lost outcome line recovers as `outcome-unknown`, which is conservative and true.

### Material, and sensitive text

**Every queued item's exact sendable payload is pinned**, because recovery must deliver the words
that were accepted, not the words a later deploy of the catalogue would produce (Sol F7): free text
and its speaker; a spoken catalogue action as its full `SpokenAction` snapshot. Recovery never
re-resolves an action id.

The material lives **outside the journal**: one file per receipt, `~/.fleet-holds/material/
<receiptId>.json`, 0600, written atomically before `accepted` is appended, so the journal itself never
holds a word of any message. `what` is a description (`message (42 characters)`), the fingerprint is
a hash, and nothing stores `SteerResult.sent` (the argv, i.e. the text).

**Material liveness is separate from receipt liveness (Sol F17).** Material is needed only while the
item may still be sent — at `accepted`, `attempted` (because a proven-unsent attempt `returned`s the
item to the queue) and `returned`. **Every outcome and every `withdrawn` ends that**, including
`outcome-unknown`: a reconciliation never needs the text. When such a record lands, the material file
and any temporary sibling `writeAtomically` may have left are deleted. Startup deletes every material
file, final or temporary, that does not belong to a receipt at `accepted`, `attempted` or `returned`.
A deletion that fails is reported by `status()`, retried at startup and compaction, and the receipt
says *material deletion pending* rather than claiming the bytes are gone. So the bytes are physically
gone, not just filtered from a read (Sol F4).

### Restoring the queue

At startup, before any route or drain pass exists, the journal is folded and every non-terminal
receipt is concluded or restored:

- **`attempted` with no outcome** → `outcome-unknown` (`interrupted`), written by the new run. **Not
  restored**: the never-retry rule.
- **Queued work at `accepted` or `returned`** → back in the queue **under its original item id**,
  with its `enqueuedAt`, speaker, conversation and pinned payload. The routes refuse a foreign-run
  id only when no current item has that exact id — the hold-release route's rule — so a page from
  before the restart can still cancel what it was showing (Sol F13). New items use this run's prefix
  and skip every reserved id (below), so no id visible in the retention window is reused.
- **The tmux generation guards restored items.** `accepted` records the queue's known generation,
  or — before this run's first drain pass — the last generation the journal recorded. The first
  `noteGeneration` after a restore concludes as `not-sent` every restored item whose generation
  differs (`tmux-generation-changed`) or is unknown (`tmux-generation-unproven`), and removes it from
  the queue. Neither stays non-terminal holding material (Sol F14).
- **Material missing** → `not-sent` (`lost-at-restart`).
- **The hold barrier is the hold ledger's alone. A receipt never installs, extends or ends a hold.**
  If the receipt's `attempted` landed and the hold ledger's did not, a crash leaves an unknown receipt
  and no hold — the hold ledger's documented fail-open (Stage 4b, `hold-ledger.ts` § IT NEVER STOPS A
  SEND), which this job neither widens nor closes. For durable actions the fail-closed `attempted`
  narrows it, because a disk that cannot write stops the send before either file is touched.
  `GET /api/actions/receipts` names the condition `unknown-without-hold` per session so a person can
  see it. Closing it is a hold-ledger decision for Greg (§ Needs Greg). **Why not a second barrier**:
  two barrier sources with independent resolution writes resurrect an acknowledged release or a
  proven supersession on a crash between them (Sol F15) — a new bug, worse than the narrowed old one.
  With one barrier, writes between the two files go one way and no crash ordering can change what is
  held.
- **An unreadable line fails recovery closed, as far as it could hide an attempt** (Sol F6, F20).
  The envelope (`schema`, `kind`, `receiptId`) is parsed separately from the domain fields. An invalid
  record whose envelope is trustworthily `generation` blocks only the generation inference, so every
  restored item is concluded `tmux-generation-unproven`. An invalid action record with a trustworthy
  `receiptId` makes that one receipt `outcome-unknown` (`recovery-blocked`), never restored; if no
  valid `accepted` precedes it, it is reported as orphan evidence rather than given an invented
  target. **Only malformed bytes, or an action envelope that cannot be attributed, conclude every
  restorable queued receipt** as `outcome-unknown` (`recovery-blocked`), because any one of them may
  hide an attempt; the status says so. Unreadable lines are appended to `receipts.unreadable.jsonl`
  before any compaction, so the evidence is never erased.
- **Ids are collision-resistant, not intrinsically unique** (Sol F19): a run token is 32 random
  bits. At startup every queue item id and receipt id in the retained records is reserved; this run's
  sequences start above any retained suffix carrying its own token and skip any occupied id; two
  retained records claiming one id for different receipts fail recovery closed. So a repeated run
  token still cannot reuse an id visible in the retention window.

**Cancel, clear and abandon durably change the receipts they affect. Hold release changes only the
hold ledger**, for the one-barrier rule above. **Revive is deliberately memory-only**: it resets the
live queue's clock, writes no receipt transition, and reverts after a restart — the safe direction. `volatile` on `QueueView` widens from `true` to `boolean`, and the warning says what is true:
durable when the journal is writing, the old sentence when it is not.

### Retention (260908j's R7)

- **Every unexpired keyed receipt is kept**, with its id and fingerprint, for 7 days from acceptance.
  **The 5,000 limit on retained keyed receipts is an admission cap, never an eviction rule**: at
  capacity a new keyed action is refused until one expires (Sol F3). Unkeyed terminal receipts may be
  dropped oldest-first past that count; nothing depends on them.
- **Non-terminal receipts — `accepted`, `attempted`, `returned` — are never evicted**, and there are
  at most 1,000; past that, a new action is refused with a sentence rather than accepted unrecorded.
  **`outcome-unknown` is an outcome, and so terminal for retention**: it is kept for 7 days like any
  other, and a later `reconciled` is an annotation on it, not a reason to keep it longer (Sol F17).
- **A retained id is looked up before any freshness check**, so it replays for its whole retention.
  **An id not found is accepted only if its mint time is within ±1 hour of the server clock.** Since
  a receipt is only dropped 7 days after acceptance, and was accepted within an hour of its mint
  time, every id that could have been forgotten is older than 7 days − 1 hour and is refused as
  `request-id-expired` — never treated as new, without a tombstone kept for ever.
- **Compaction** rewrites the journal to the retained receipts at open, when the oldest terminal
  receipt passes retention, and when the file passes max(1 MiB, twice its size after the last
  compaction). Retention means bytes on disk.

### Reading receipts

**Stage 1 ships a minimal read-only `GET /api/actions/receipts`** — recent receipts, every
non-terminal one, and the journal's status (durable, never opened, locked out, last failure,
unreadable lines, recovery conclusions) — so no recovery conclusion exists only in a file or a log
(Sol F12). Stage 4 adds the `ReceiptView` a person reads (proven, unknown, reconciled — in fields,
not one label), `?sessionId=`, and the component.

## Stages

Each stage lands useful on its own. Implementation by GPT (`scripts/run-codex.ts`, workspace-write,
in this worktree) from a written brief, which says which stages Codex implemented; review by GPT Sol,
write-capable, at the end of each stage.

### Stage 1 — the stores, and queued work survives a restart

Two Codex runs, committed separately.

- [ ] **1a** `journal-file.ts` extracted; the hold ledger over it with its tests unchanged;
  `receipt-journal.ts` with records, strict parse, the transition rule, material files, retention,
  recovery and status; `openFleetActionStores()` under one lock. No wiring.
- [ ] **1b** The queue takes the journal as a required option and writes its own receipts at every
  item transition — enqueue, cancel and clear write-ahead; `beginDelivery` (the drain's `attempted`,
  fail-closed); settle, `release` (`returned`), `quarantineLeased`, the drain's throw, abandon — so no
  enqueue path, HTTP or broadcast, can skip it. Restore under original ids; the generation guard;
  the foreign-id rule; `volatile` and warning; `GET /api/actions/receipts` with the
  `unknown-without-hold` flag; `openFleetActionStores()` in `server.ts` and its source guard.
- [ ] Crash tests for queued work (below), including an unreadable mid-file `attempted` line, and an
  old page cancelling a restored item before the next drain.

**Done:** a queued message accepted before a restart is delivered once after it; one that was being
delivered when the process died comes back `outcome-unknown`, is not delivered again, and its session
is held by the hold ledger (or flagged `unknown-without-hold` if that write failed); a cancel that was answered 200 stays cancelled across a restart; the hold ledger's suite is
unchanged and green.

### Stage 2 — request ids and replay, on the steer and enqueue routes

- [ ] `requestId` parsed on `/api/steer/message`, `/api/steer/answer` and `/api/actions/session`
  (enqueue); format and freshness; lookup and conflict before the limiter; keyed accept fail-closed.
- [ ] Receipts for direct steer and answer: `accepted` then `attempted` (both fail-closed when keyed)
  before the coordinator, outcome after, `not-sent` for a held session.
- [ ] Replay: `200 {ok: true, op: "receipt", replay: true, receipt}` (the receipt says whether it is
  still pending); `409 request-id-conflict`; `409 request-id-expired`; `503 receipt-unavailable`.
- [ ] Crash tests for direct steer, and a duplicate HTTP request after a restart.

**Done:** the same id and body posted twice, across a restart, sends once and returns one receipt
twice; a different body is refused before any effect.

### Stage 3 — enacted plans and the broadcast

- [ ] Receipts for `remove-worktree`, `kill-session` and the box kills on `/api/actions/session` and
  `/api/actions/box`: `accepted` before the first `await`, `attempted` before `runPlan`, a `progress`
  record per completed step, `completed` / `plan-stopped` / `outcome-unknown`. A crash mid-plan
  comes back unknown **with the steps known to have completed**.
- [ ] `/api/broadcast`: one parent receipt carrying the `requestId`, and a child receipt per
  recipient (a direct send, or the queued item's own receipt).
- [ ] Crash tests including a duplicate HTTP request after a restart for a kill and a worktree
  removal, on fake `ActionIo`.

**Done:** a confirmed kill or worktree removal whose response was lost cannot be run a second time
by re-posting it, before or after a restart.

### Stage 4 — reading receipts, and the clients keeping envelopes

- [ ] `ReceiptView` in `wire.ts`; `?sessionId=`.
- [ ] A reconciliation gesture for an unknown receipt of an enacted plan — the person's statement,
  labelled as theirs, never as proof.
- [ ] `ReceiptList.tsx`, self-contained, with its test.
- [ ] **Each client constructs and keeps an immutable `{requestId, body}` envelope before sending.**
  A network failure or a missing definitive response leaves the envelope pending and offers an
  explicit *retry / check* that resubmits the same id and identical body — never a silent retry of a
  keystroke. Only a deliberate new action after a definitive response mints a new id (Sol F11). Test
  a lost response followed by the person's retry, with a dashboard restart in between.
  `actions-client.ts`, `steer-client.ts`, `broadcast-client.ts` — **coordinated with
  `session-continuity` before editing**, since `useActions` is theirs; mounting the list in a host
  component is theirs too.

**Done:** a person on a phone can see, for recent actions, which were proven, which were withdrawn,
which are unknown, and which unknowns somebody has since looked at — and pressing retry after a lost
response does not send twice.

## The crash points, and how a test crashes

A crash is simulated by **freezing the disk**: the journal's injected `writeLine` (the hook
`hold-ledger.ts` already has for tests) drops every write after the named point, and the fake
transport records keystrokes only up to it. Then every object is discarded and a fresh composition
is opened over the same directory — `tests/fleet-hold-restart.test.ts`'s shape, where the only thing
that crosses the boundary is bytes on a disk. A thrown error is not a crash: `catch` blocks run after
it and write things a dead process could not.

| Point | After restart |
|---|---|
| before `accepted` lands | no receipt; keyed: nothing happened and the request got a 503 or nothing; the retry is accepted as new, correctly |
| after `accepted`, before `attempted` | queued work: restored and delivered once. Durably-accepted direct send or plan: proven not attempted, `not-sent` (`interrupted-before-attempt`) |
| after `attempted`, before the coordinator | `outcome-unknown` (`interrupted`) — nothing was typed, and the receipt says it cannot tell |
| between the text and the Enter | `outcome-unknown`; a hold from the hold ledger, or none if its write failed — then flagged `unknown-without-hold` |
| after the send, before the outcome line | `outcome-unknown` — indistinguishable from the row above, and says so |
| during the outcome line (torn) | repaired at open; the last whole record decides, so `outcome-unknown` |
| an unreadable complete `attempted` line mid-file | that receipt `outcome-unknown` (`recovery-blocked`), not restored |
| after the outcome, before the HTTP response | the terminal receipt; a retry with the same `requestId` gets it back and sends nothing |
| after `withdrawn`, before the 200 | withdrawn; not restored |

## What this does not build

- **`observed-reception`.** The roadmap lists it; nothing on this box can produce it, because the
  transport does not read the pane after sending. An arm no code can reach is decoration on a
  contract (260908j). The strongest message state is `keys-submitted`, and the type's comment says
  where `observed-reception` goes the day something observes it.
- **Exactly-once with tmux.** Impossible, and not claimed in code or on the page.
- **Receipts for command gestures** (cancel, clear, revive, abandon, release). They mutate the
  receipt of the action they change, or nothing.
- **A second barrier.** The hold ledger stays the only thing that holds a session (§ Restoring).
- **A second writer of `~/.overseer/`**, or any product-database table.
- **Unifying the hold ledger into the receipt journal.** They share a lock and a core; merging the
  records rewrites the proven file's fold for no behaviour anybody needs today.

## Not mine, and what it needs

- `server.ts`: one call, authorised by the Overseer with the conditions in § The stores.
- `scripts/fleet-restart-plan.ts` will over-report "discarded" queued items once Stage 1 lands,
  because it does not read `volatile`. Safe direction; the Overseer should update it.
- The Overseer's CLI and `rule-work.ts` can send `requestId`s once Stage 2 lands; `tools/overseer/`.
- A dashboard restart is needed for any of this to be live.

## Plan review

### Round 1 — GPT Sol, 2026-09-10, verdict "rework"

[The review](260910d-durable-action-receipts-plan-review-sol.md); [the prompt](260910d-durable-action-receipts-plan-review-prompt.md).

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 | Fail-open lets a keyed request's effect run with no durable reservation, so a retry repeats it | Taken: keyed `accepted` and durable `attempted` fail closed |
| F2 | Cancel/clear change memory before `withdrawn` lands, so a restart undoes an acknowledged cancel | Taken: write-ahead, one `withdrawn` record per clear |
| F3 | The 5,000 cap evicting early breaks the expiry proof | Taken: admission cap, lookup before freshness, ±1 h for unknown ids |
| F4 | Compaction only past 1 MiB leaves text and expired receipts on disk | Taken, differently: material in per-receipt files unlinked at terminal; compaction on expiry |
| F5 | The fingerprint omits body fields, so a changed body can replay an old receipt | Taken: the whole validated body minus `requestId` |
| F6 | Skipping an unreadable line can drop an `attempted` and re-send | Taken: fail recovery closed; unreadable lines kept |
| F7 | Queued catalogue actions re-resolved by id after a deploy change their words | Taken: pin the full `SpokenAction` |
| F8 | `released-as-sent`/`-not-sent` have no producer | Taken: the existing gesture names only |
| F9 | No actor | Taken: `actor {kind, id}`, `client-claimed` or `system` |
| F10 | A receipt can survive where the hold-ledger write failed, leaving no barrier | **Declined** — taken in round 1, withdrawn on F15 after Fable's arbitration: it asks receipts to be a second barrier, which changes Stage 4b's decision rather than this job's contract. Named in § Restoring, flagged `unknown-without-hold`, and sent to Greg |
| F11 | "Per press" re-mints the id on the retry it exists for | Taken: a retained envelope and an explicit retry |
| F12 | Stage 1's conclusions are invisible until Stage 4 | Taken: minimal read endpoint in Stage 1 |
| F13 | New ids for restored items break the old page's cancel | Taken: original ids, hold-route foreign-id rule |
| F14 | Generation-null restored items stay non-terminal for ever | Taken: journal generation metadata; conclude as `not-sent` |
| — | Composition inside `openSharedQuarantine()`; one writer claim; memory-only default | See the last row of this table |

### Round 2 — GPT Sol, 2026-09-10, verdict "rework"

[The review](260910d-durable-action-receipts-plan-review2-sol.md); [the prompt](260910d-durable-action-receipts-plan-review2-prompt.md).
Discovery closes here, per the house rule; what follows is decided, not reviewed again at plan stage.

| ID | Finding | Disposition |
|----|---------|-------------|
| F15 | The two journals cannot durably agree on releasing a hold; a crash between their writes resurrects it | **Taken, by removing the second barrier.** Fable, asked to arbitrate between declining F10, one unified journal, and Sol's `receiptId`-threading: *"Take (A): one barrier, receipts as evidence only, the declined hole named in the plan and flagged on the endpoint."* The unified journal contradicts § What this does not build and reopens the proven file; threading makes the two-source fold permanent, so every future write to either file is a new F15 candidate |
| F16 | Replay depends on the current catalogue and preview | Taken: `WireIntent` fingerprint; lookup before catalogue, preview and limiter |
| F17 | Material liveness undefined for `outcome-unknown`; temporary siblings; failed unlinks | Taken, corrected: material lives through `attempted` too (a `returned` item needs it) — Sol's wording deleted it there |
| F18 | Answer and box-run routes have no speaker | Taken: `unattributed-http`; `speaker` nullable |
| F19 | 32-bit run tokens can collide | Taken: reserve retained ids; sequences above them |
| F20 | The unattributable-line rule is broader than its proof | Taken: envelope-first parse |
| F21 | Two sentences contradicted the design | Taken |

### The composition row, carried from round 1

| — | Composition inside `openSharedQuarantine()`; one writer claim; memory-only default | One claim and `openFleetActionStores()` taken (server.ts pending the Overseer). **Memory-only as a default is kept**, because it is exactly the book's existing pattern (`sharedQuarantineBook()` without a ledger), a source guard keeps `server.ts` calling the opener, and the status reports `never opened` rather than staying silent. |

## The simpler options passed over, and why

- **Keep the volatile warning.** The roadmap's own simpler option, acceptable for v1, and what
  260908j chose. Not enough now: the Overseer is about to take broader unattended actions, and the
  box restarts the dashboard several times an hour.
- **Instance-scoped receipts** (260908j Stage 5 as written). Makes a repeat safe within one server
  lifetime, which is the case a phone hits most — but not the case this stage exists for, a response
  lost to a restart.
- **Checkpoint the queue's whole state on every change** instead of journalling events. Simpler for
  the queue alone, but it records no receipt and has no record of the window between "attempting"
  and "done", which is the one the crash table is about.
- **Material inside the journal, filtered at compaction.** One file fewer, but the text stays on
  disk until the next rewrite, which is what F4 caught.
- **Tombstones for every request id for ever**, instead of ids that carry their mint time. No clock
  in the id, but a file that grows without bound.
- **SQLite or Postgres.** Refused by the roadmap's storage contract: *"JSONL + atomic checkpoints
  remain sufficient."*

## Needs Greg (decided by default, reversible)

- **Queued work now survives a dashboard restart and goes out after it without anyone re-arming
  it**, unless the tmux server changed or the item went stale. That is what the acceptance asks for,
  and it is a change in what the page promises.
- **Receipts are kept for 7 days** in `~/.fleet-holds/receipts.jsonl`, and **the exact text of a
  queued message is kept on disk, in its own 0600 file, until it is delivered, withdrawn or
  concluded**, then deleted.
- **Not decided, and Greg's to decide: whether the hold ledger should stop failing open for durable
  sends.** Today a hold-ledger write that fails lets the send go ahead (Stage 4b's judgement: a full
  disk must not stop the tool you reach for when things are broken). The narrow case that leaves
  behind — a partial send, then a crash, with no hold afterwards — is unchanged by this job and is
  now visible as `unknown-without-hold`. Closing it means `noteAttempt` refusing the send when its
  write fails, for actions whose receipt is durable.
