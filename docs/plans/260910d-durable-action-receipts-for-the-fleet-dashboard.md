# Durable action receipts for the fleet dashboard

**Status, 2026-09-10: planned; plan review round 1 came back "rework" with fourteen findings and no
P0, all taken but one half of one (§ Plan review). Round 2 pending. Nothing built.** Queue item
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
  abandon, hold release. They get no receipts of their own; they write to the receipt of the action
  they change.
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
  `<serverInstanceId>-r<n>`, the existing run-qualified convention (`instance.ts`), so unique across
  restarts. Distinct from the action vocabulary id (`compact`) and from the queue item id.
- **`requestId`** — the idempotency key, **minted by the client once per intention** and reused for
  every retry of that intention (see Stage 4 for the envelope that makes "reuse" real). Optional on
  the write routes that create an action, so existing callers keep working; an action without one
  still gets a receipt and simply cannot be deduplicated.

  The id carries its mint time: `rq-<ms since epoch, base36>-<16 to 40 chars [a-z0-9]>`. That is
  what makes the retention rule safe rather than hopeful — § Retention.

### The fingerprint (260908j's R5)

**A sha256 over the canonical JSON (keys sorted) of the validated request with `requestId` removed —
every field, not a chosen list.** That includes `declaredStatus`, `panePid`, the full question
material, the ordered broadcast recipients, and the complete preview claim and submitted material.
Anything the server observes that was not in the request (the tmux generation, this run's instance
id) is evidence on the receipt, not fingerprint input; hashing the current instance would make
replay across a restart impossible.

A genuine retry resubmits the original envelope byte for byte. A request rebuilt from refreshed
observations is a new intention and gets a new `requestId`.

Same `requestId` and fingerprint → the stored receipt comes back and **nothing happens**. Same
`requestId`, different fingerprint → `409 request-id-conflict`. **Both are decided after the body is
parsed and before the rate limiter and before any effect.**

### The actor (roadmap: "actor")

Every `accepted` and `reconciled` record carries `actor: {kind, id}`, separate from `speaker` (which
is the message's authorship, rendered to the agent). The dashboard has no authentication — the CSRF
origin check is not identity — so an HTTP caller is `{kind: "client-claimed", id: <the speaker the
body claimed>}`, and a record written by the drain or by recovery is `{kind: "system", id: null}`.
Nothing is ever promoted to an authenticated actor.

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

  outcome-unknown ──► reconciled { lease-abandoned | operator-confirmed | abandoned-unknown }
```

- **Every arm names its producer.** `keys-submitted`: the coordinator's `ok`. `not-sent`:
  `nothingWasSent`, the coordinator's `held`, a queued item that can never be delivered, and the
  recovery conclusions. `withdrawn`: cancel/clear. `outcome-unknown`: the coordinator's ambiguous
  readings, a throw, recovery. `reconciled`: the abandon route (`lease-abandoned`) and the two
  existing hold-release gestures, whose names are kept exactly — `operator-confirmed` is a person
  saying they looked at the terminal, **not** what they found (`quarantine.ts:286`).
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
4. **`withdrawn`, before cancel or clear change queue memory.** If it does not land: `503
   receipt-unavailable` and the queue is unchanged. Otherwise the person is told it is cancelled, the
   restart restores it, and it is delivered (Sol F2).

Settles after an attempt stay fail-open: the durable `attempted` already prevents restoration, so a
lost outcome line recovers as `outcome-unknown`, which is conservative and true.

### Material, and sensitive text

**Every queued item's exact sendable payload is pinned**, because recovery must deliver the words
that were accepted, not the words a later deploy of the catalogue would produce (Sol F7): free text
and its speaker; a spoken catalogue action as its full `SpokenAction` snapshot. Recovery never
re-resolves an action id.

The material lives **outside the journal**: one file per receipt, `~/.fleet-holds/material/
<receiptId>.json`, 0600, written atomically before `accepted` is appended and **unlinked when the
receipt becomes terminal** — so the bytes are physically gone, not just filtered from a read (Sol F4),
and the journal itself never holds a word of any message. `what` is a description (`message (42
characters)`), the fingerprint is a hash, and nothing stores `SteerResult.sent` (the argv, i.e. the
text). Recovery deletes material with no live receipt behind it.

### Restoring the queue

At startup, before any route or drain pass exists, the journal is folded and every non-terminal
receipt is concluded or restored:

- **`attempted` with no outcome** → `outcome-unknown` (`interrupted`), written by the new run. **Not
  restored**: the never-retry rule.
- **Queued work at `accepted` or `returned`** → back in the queue **under its original item id**,
  with its `enqueuedAt`, speaker, conversation and pinned payload. The routes refuse a foreign-run
  id only when no current item has that exact id — the hold-release route's rule — so a page from
  before the restart can still cancel what it was showing (Sol F13). New items use this run's prefix,
  so no id is reused.
- **The tmux generation guards restored items.** `accepted` records the queue's known generation,
  or — before this run's first drain pass — the last generation the journal recorded. The first
  `noteGeneration` after a restore concludes as `not-sent` every restored item whose generation
  differs (`tmux-generation-changed`) or is unknown (`tmux-generation-unproven`), and removes it from
  the queue. Neither stays non-terminal holding material (Sol F14).
- **Material missing** → `not-sent` (`lost-at-restart`).
- **The hold barrier is rebuilt from receipts too** (Sol F10). Every `outcome-unknown` receipt for a
  keystroke action that nobody has reconciled installs a hold on its session unless the book already
  holds one — so a hold-ledger write that failed while the receipt's succeeded cannot leave a
  half-typed input box unguarded. A hold release writes `reconciled` on that session's unknown
  receipts; a hold rebuilt this way carries the receipt's tmux generation, so the book's own
  first-observation rule ends it if tmux restarted. Nothing in `send-coordinator.ts` changes.
- **An unreadable line fails recovery closed** (Sol F6). A complete line that is JSON with a
  `receiptId` but does not parse makes that receipt `outcome-unknown` (`recovery-blocked`), never
  restored. A line with no attributable id concludes **every** restorable queued receipt as
  `outcome-unknown` (`recovery-blocked`) — the journal cannot prove which of them were attempted —
  and says so on the status. Unreadable lines are appended to `receipts.unreadable.jsonl` before any
  compaction, so the evidence is never erased.

A re-arm (`revive`) is not journaled, so it reverts after a restart — the safe direction, and said
so. `volatile` on `QueueView` widens from `true` to `boolean`, and the warning says what is true:
durable when the journal is writing, the old sentence when it is not.

### Retention (260908j's R7)

- **Every unexpired keyed receipt is kept**, with its id and fingerprint, for 7 days from acceptance.
  **The 5,000 limit on retained keyed receipts is an admission cap, never an eviction rule**: at
  capacity a new keyed action is refused until one expires (Sol F3). Unkeyed terminal receipts may be
  dropped oldest-first past that count; nothing depends on them.
- **Non-terminal receipts are never evicted**, and there are at most 1,000; past that, a new action is
  refused with a sentence rather than accepted unrecorded.
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
  the hold barrier; the foreign-id rule; `volatile` and warning; `GET /api/actions/receipts`.
- [ ] Crash tests for queued work (below), including an unreadable mid-file `attempted` line, and an
  old page cancelling a restored item before the next drain.

**Done:** a queued message accepted before a restart is delivered once after it; one that was being
delivered when the process died comes back `outcome-unknown`, holds its session, and is not delivered
again; a cancel that was answered 200 stays cancelled across a restart; the hold ledger's suite is
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
| between the text and the Enter | `outcome-unknown`; a hold, from the hold ledger or from the receipt |
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
  receipt of the action they change.
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
| F10 | A receipt can survive where the hold-ledger write failed, leaving no barrier | Taken, without touching `send-coordinator.ts`: unknown unreconciled receipts rebuild holds |
| F11 | "Per press" re-mints the id on the retry it exists for | Taken: a retained envelope and an explicit retry |
| F12 | Stage 1's conclusions are invisible until Stage 4 | Taken: minimal read endpoint in Stage 1 |
| F13 | New ids for restored items break the old page's cancel | Taken: original ids, hold-route foreign-id rule |
| F14 | Generation-null restored items stay non-terminal for ever | Taken: journal generation metadata; conclude as `not-sent` |
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
