# Delivery receipts and honest outcomes for the fleet dashboard

**Status:** planned 2026-09-08 22:15, reviewed and reordered 22:30. **Stage 1 landed**; stages 2-6
specified and not started. Baseline `d9f4dcc4`, 692 fleet tests green, typecheck clean across 1,743
files.

This is stage **v0.2c** of [260907e](260907e-agent-fleet-dashboard.md) — Astra's A11 — and the
**Delivery uncertainty** stage of
[260908f](260908f-overseer-and-fleet-improvement-roadmap.md), which are the same work under two
names. Agreed with the Overseer session 2026-09-08 22:05: this session takes Delivery uncertainty
whole and the `wire.ts` half of Box contracts; the preview-envelope and kill-identity half of Box
contracts stays with the Overseer to dispatch, with `FLEET_ACT_ENABLED` treated as staying off
throughout. That matches the ownership table agreed across six sessions at 13:00, which already
assigns "delivery receipts (A11)" here along with `queue.ts`, `drain.ts`, `SessionDetail.tsx` and
`wire.ts`.

## What the job is for

The dashboard sends keystrokes into other people's sessions. **A send that may have landed is not a
send that did not**, and the difference is not recoverable afterwards — there is no way to take a
keystroke back, and a retry is a second message rather than a repair. So the outcome vocabulary has
to carry uncertainty all the way to the phone, and the machinery has to make a repeat safe.

The roadmap states the contract this serves, and it is the one to hold onto:

> Observed, inferred, claimed, unknown, and not supported remain distinguishable all the way to the
> browser. `keys submitted` is not `read`, and `read` is not `obeyed` or `completed`.

This is the middle of Greg's three standards, 2026-09-08: *"Briefly broken is fine for dev, have a
slightly higher standard for the orchestrator and its web interface, and a higher standard still for
keeping things working in prod."*

## The ground, measured rather than remembered

Two mapping passes on 2026-09-08 22:00, both spot-checked by hand before being written down here.

**The steering path is already honest, at one granularity.** `Delivery = "none" | "partial" |
"unknown"` (`steer.ts:347`) is produced by `fire()` (`steer.ts:1238-1287`) from the index reached
and a `mayHaveLanded` test, propagated verbatim by `sendMessage` and `answerQuestion`, and put on
the failure body by the route (`routes-steer.ts:1087`). The browser widens it to four arms by adding
`not-told` for a value it did not receive or did not recognise (`steer-client.ts:128-132`), and
`SessionDetail` renders all four from a total record (`SessionDetail.tsx:319-336`). **None of this
needs rebuilding.** It needs extending, and it is the model for the parts that are missing.

**The box-actions path does none of it.** `ActionOutcome`'s failure arm is
`{ok: false; code; why; status; from: "server" | "client"}` (`actions-client.ts:864`) — no
`delivery` — and `ActionButtons.tsx:231` prints **"Nothing happened."** above it unconditionally.
The arm already carries `from: "client"`, so **the code knows the reply never arrived and says the
request had no effect anyway**. Three arms above it, the same file's comments cite
`docs/postmortems/260908b` on not flattening several facts into one label. This is the first thing
to fix and it is small.

**There is no action id anywhere on the write path.** `SteerTarget` (`steer.ts:211-220`) and
`SteerTargetBody` (`steer-client.ts:67-73`) carry none; `parseMessageBody` and `parseAnswerBody`
(`routes-steer.ts:690-735`) accept none. The "nonce" in `260907e` is the E2E probe's, not shipped
code. The rate limiter (`routes-steer.ts:765-826`) keys on pane and wall clock, so **two identical
requests two seconds apart both pass** — it is a burst guard, not a dedup key, and the plan already
says so at `260907e:805`. There is no automatic retry anywhere on this path, which is correct and
must stay true.

**Queue ids come round again after a restart, and it is already written down.**
`queue.ts:616-618` mints `q${++this.seq}` from a per-process counter, and `queue.ts:609-615` states
the defect and the fix in place. Four routes accept an id from a client and match it by string
equality — cancel, revive and abandon at `routes-actions.ts:1305-1428`, and **`clear` at `:1461`**.
**None of the four is protected against this.** `clear`'s `itemIds` comparison guards *concurrent
list drift*, which is a different hazard: an old `[q3]` posted against a restarted queue that also
holds one item called `q3` passes it exactly. A phone left open across a restart can abandon a `q3`
nobody ever saw.

**`drainGate` cannot express a quarantine.** It is a pure function of `FleetStatus`
(`queue.ts:155-191`) with no target parameter; `deliveryGate` wraps it and differs in one arm
(`queue.ts:216-239`); `next()` calls the latter (`queue.ts:761`). A per-session hold has to be state
on the `SteeringQueue` consulted inside `next()`. The queue has **no per-session state at all**
today — `bySession` maps a session id to an item array and nothing else (`queue.ts:405`) — so this
is the first such field. The nearest existing shapes are per-item `invalidated: string | null`
(`wire.ts:159-173`), which is a sentence rather than a boolean, and the fleet-wide
`generation` (`queue.ts:412`).

**What happens after an uncertain delivery today.** `drain.ts:375-381`: `nothingWasSent(result)`
puts the item back; anything else settles it `refused`. So a `partial` or `unknown` send does **not**
produce a duplicate — that part is already safe. What is missing is the consequence for the *next*
item: it drains into a session that may be holding half-typed text, and nothing stops it.

**The actions catalogue is an admitted twin.** The client's `ClientAction`
(`actions-client.ts:105-160`) is hand-written, and its comment says it "mirror[s] `Action` in
tools/fleet/actions.ts" (`actions-client.ts:99-104`). `SpokenAction` is in `wire.ts` already;
`EnactedAction`, `BroadcastAction`, `Stagger`, `ActionScope` and the id unions are not. **No test
asserts the two agree**, and the catalogue parse tests run against hand-written fixtures
(`tests/fleet-web.test.tsx:4946-4990`) — the twin-fixture failure mode `wire.ts`'s own header
describes.

## Sol's review, round one, and what it changed

Reviewed at `d9f4dcc4` before anything was built — fifteen findings, five P0. It verified every
other cited line, ran `fleet-queue` itself (43/43), and changed no files. **Accepted almost whole**,
including both places where it caught me asserting something false. The verdict in its own words:
*"Do not build Stages 3-4 as currently specified."*

**Two facts I got wrong.**

- I wrote that the four id-accepting routes are at `routes-actions.ts:1305-1428`. That range covers
  cancel, revive and abandon; **`clearRoute` is at `:1461`**.
- I wrote that `clear` is "protected, and only incidentally". **It is not protected against this
  hazard at all.** Its `itemIds` comparison guards *concurrent list drift* — an item queued between
  the confirmation being drawn and the tap — which is a different thing. An old `[q3]` posted against
  a restarted queue that also holds one item called `q3` passes the comparison exactly.

**The correction that matters most**, and it was my own stated suspicion, confirmed:

> There is no honest producer for `reception observed` today.

`sendMessage()` captures the pane only *before* sending and returns as soon as `tmux send-keys`
completes (`steer.ts:1326-1381`); `answerQuestion()` does the same (`:1481-1528`). That proves keys
were submitted to tmux. It does not prove Claude received, read, obeyed or completed them. **The arm
is cut** rather than shipped always-empty. It comes back only if a target-side acknowledgement ever
carries the request id; a human check is labelled *confirmed by Greg* — operator-claimed, never
system-observed.

**And the outcome list was wrong in the other direction too:** my five dropped `partial`, which
`fire()` already distinguishes and which the roadmap explicitly requires steering to preserve. So
the vocabulary is a transient phase and four terminal states:

    pending/accepted  →  refused-before-effect | keys-submitted | partial | outcome-unknown

**Where I have not simply complied:** Sol's R4 says the plan does not take Delivery uncertainty
"whole" — `killRoute` reports every intended pid as `killed` even when `run.completed` is false
(`routes-actions.ts:1670-1673`), and broadcast maps throws, `partial` and `unknown` alike to
`outcome: "refused"` (`:1798-1823`). It offered "add a stage or stop claiming the roadmap stage
whole". **Adding the stage**, because the Stage 1 implementer independently reported the broadcast
half from the other side of the code, and two independent findings of one defect is not a P2.

## Stages

Reordered on Sol's R13: the concrete unsafe behaviour should not wait behind the least-specified
stage. Quarantine does not need receipts — `Delivery` already exposes `partial` and `unknown`.

Each ends with the suite green and the tree safe to commit. Every stage is red-first: the test goes
in and is watched failing before the fix, and the finished code is mutated at the end of the stage to
check the suite notices. **New wire types go into `wire.ts` in the stage that introduces them**
(R12), not deferred to the catalogue stage.

### ✅ Stage 1 — "Nothing happened." is a claim the client cannot support (landed 2026-09-08)

`ActionOutcome`'s and `BoxOutcome`'s failure arms both gained a **required** `delivery:
DeliveryReading`, and both failure cards render all four arms. Only a server-stated `none` may say
nothing happened.

**Sol's R3 was already satisfied when the review arrived.** It found that `ActionButtons.tsx:231`
was not the only path to the sentence — the box panel has its own copy at `:1447`, on the *kill*
path, which is the worse instance. The implementer found the same thing independently and fixed
both; `grep` now shows one live occurrence, inside the `none` arm. **My brief named only one path**,
so this was caught by the implementer reading past it rather than by me specifying it.

`routes-actions.ts` was deliberately left alone: no `ok:false` body on that file's routes knows a
delivery, every refusal is reached before any keystroke, so the route sends nothing and the client
reads `not-told`. Inventing a value at the route would have been the opposite of the point.

#### The code review found three P0s, and the first is this stage committing the class it closed

Reviewed at `c0453d0c`. The narrow claim held — the only literal `"Nothing happened."` was the
`none` arm, and every parse path had to produce `none` to reach it. **The semantics did not.**

**S1: `"Nothing happened."` is stronger than `delivery: "none"`.** The server's `Delivery` type is
*about keystrokes*: `none` means nothing left the box for the pane. It does not establish that an
action did nothing to a queue, a worktree or a process. So reusing that vocabulary for
`ActionOutcome`/`BoxOutcome` gave the **safe-looking arm** the power to make a false whole-action
assertion — a lossy join, inside the stage built to fix one. Worse, the arm is **unreachable on the
action path today** (no action route sends a delivery on failure), so it was an unreachable arm
making the boldest claim.

Fixed by narrowing rather than by inventing an action-wide effect type, which needs a server
contract that does not exist: `No keystrokes went out.` — and a comment on the arm saying it speaks
only for keystrokes, is unreachable today, and must not be widened without that contract. **The
comment is the real guard**: when Stage 3 adds whole-action effect, the temptation will be to reuse
this arm rather than add one.

**S2: the `partial` body asserted something the server contradicts.** `fire()` reaches `partial`
down two roads and only one of them knows the remainder failed (`steer.ts:1253-1255`):

    "Part of the sequence arrived" +
      (mayHaveLanded(e) ? " and the rest cannot be accounted for" : " and the rest did not")

The card said *the rest did not*, printed directly above that verbatim sentence. **I had already
hand-edited this body once and changed the wrong half** — swapping "landed" for "took effect" while
leaving the false clause. The rewrite asserts only what is true on both roads.

**S3: two headings a reader cannot act on differently.** `parseDelivery` maps *absent field* and
*present-but-unrecognised* both to `not-told`, so "the server did not say" is false when the server
said `"half-ish"` and this page failed to understand it. The copy collapses to one shared constant;
**the type keeps both arms**, because they are genuinely different facts and useful for diagnosis.

**And my stated reason for that decision was false.** I wrote that the `code · HTTP nnn · from`
footer "already exposes which one happened". It does not: it separates the client-side readings
(`unreachable`, `not-json`) from a server refusal, but a server body carrying an unrecognised
`delivery` and one carrying none produce an **identical** footer. The implementer checked and said
so. That is not a reason to keep two headings — it is a second reason the heading must claim
neither, and it is the version now written into the code.

**S4: a surviving mutation that restored the exact bug.** Flipping the invalid-JSON branch from
`unknown` to `none` left the suite green — the tests covered a thrown `fetch` but nothing drove the
real client with a response whose `json()` rejects. Now covered on both the session and box paths.

**Six mutations at the end, all caught.** The bodies had been materially underconstrained — only
fragments of one were asserted, so the others "could be replaced with most false advice without
failing the suite", which is exactly how S2's false sentence shipped. Each body now pins its
load-bearing clause, plus a standing `not.toContain("the rest did not")`.

**One repair the implementer made beyond the brief:** the box failure footer never rendered
`HTTP nnn`, only the session card did — which made the new comment about the footer false *on the
path with `kill` on it*.

### ✅ Stage 2 — a queue id minted by a dead process must not resolve in this one (landed 2026-09-08)

New leaf `tools/fleet/instance.ts`; ids become `<instance>-q<n>`; a new `other-instance` refusal
(409) on all four routes, `clear` included, checked **before** both its empty check and its
`stale-view` comparison. `stale-view` survives for its own case — deleting the `clear` guard failed
with *expected `other-instance`, received `stale-view`*, which is the conflation this stage was
warned about, caught by its own test.

**I briefed this stage sceptically and the scepticism was wrong.** The brief asked whether the prefix
changes any outcome at all, given the queue is volatile and empty after a restart — offering
*"no, this only improves the message"* as an acceptable answer. It is not the answer:

> **The volatility argument is the trap.** A restart does empty the queue — and then the *counter*
> restarts too, so the very next enqueue re-issues `q1` to different work. Emptiness is a state that
> lasts until the first tap, not a protection.

Measured, not argued, by driving the real `cancelRoute`: a dead run's `q1` (a `pull`) posted at a
fresh run **removed that run's `q1`, which was a `push`** — different work, queued by somebody else
— and answered `200 {"ok":true,"op":"cancelled"}`.

**And the window is reachable rather than theoretical**, which is the part that makes this worth
building tonight. `useActions.ts:90` skips polling entirely while the tab is hidden — its own comment
says *"Greg leaves this open on a phone"* — and a failed poll deliberately keeps the last good feed
on screen, because *"a queue you cannot currently read is not an empty queue"*. So across a restart
the phone goes on rendering the dead run's ids **with live buttons**, during exactly the window in
which the new process is re-minting them.

**Three arms, not a boolean**, and this was the implementer's call rather than the brief's:
`idOrigin` returns `this-instance | other-instance | not-instance-qualified`. A garbled or legacy id
is **not** evidence of a previous server, so it falls through to the existing `no-such-item` instead
of earning a second confident sentence that might be false. The brief did not ask for that
distinction and should have.

**Done:** ✅ all four routes refuse a foreign id with a distinct code; `stale-view` still fires for
its own case; the id stays opaque to the client (never rendered, only a React key and a callback
argument). 194 tests green across six files, and the full fleet suite at 1,390.

### Stage 3 — process and broadcast outcomes stop claiming more than they know

The stage added on R4, and the one that makes "takes Delivery uncertainty whole" true.

- `killRoute` labels intended pids `killed` regardless of `run.completed` (`:1670-1673`). Report
  **attempted versus observed** separately; a command that exited is not an effect that happened.
- Broadcast collapses throws, `partial` and `unknown` into `outcome: "refused"` (`:1798-1823`) —
  the same Class B defect as Stage 1's, in the `ok: true` arm, so Stage 1's fix does not reach it.
  Preserve delivery **per recipient** and render per-state counts.

**Done:** a kill whose plan did not complete cannot render as a completed kill; a broadcast recipient
whose send came back `partial` is not reported as refused; both are visible per recipient.

### Stage 4 — quarantine a session after an uncertain delivery

Sol confirmed `SteeringQueue.next()` as the enforcement seam, and found four things missing.

- **Every ambiguous send creates the hold, not only a drain's** (R8). Direct steering and broadcast
  call `sendMessage()` too and leave the same uncertain input buffer. One coordinator injected into
  drain, direct steer and broadcast, with a route-to-queue integration test so this cannot become the
  missing-join half of the same taxonomy.
- **Creating the hold and disposing of the leased item is one atomic queue method**, not `settle()`
  followed by `hold()`.
- **A complete release protocol** (R9), because today `abandon` applies only to a leased item after
  `leaseMs` and a `partial` result is settled and removed — so a hold could outlive every gesture
  that could clear it. Two gestures, **neither of which sends anything**: *I looked at the terminal
  and saw it* records an operator confirmation; *abandon the uncertainty* releases with a warning and
  **does not claim non-delivery**. Idempotent, keyed by a reconciliation id, so a lost HTTP response
  is recoverable by repeating it. Available even if the session is gone or has no later items.
- **Generation semantics** (R10). Bind the hold to server instance, tmux generation, pane/session
  identity and a hold version. A proven tmux-generation change proves the old input buffer is gone:
  stop blocking the new generation, keep the old record as superseded. A stale phone must not release
  a newer hold.

**Visibility is part of the stage, not a follow-up** (R11): `FleetQueues` filters to
`items.length > 0` (`ActionButtons.tsx:1158`), so a hold with no remaining item is **invisible**.
Include a queue when it has items, unreadable contents, or a quarantine. The blanket *"None of it has
been sent yet"* (`:1177-1179`) is false in the presence of leased or held items and goes.

**Done:** a partial first message stops the second draining; the hold is visible with no items left;
both release gestures work and neither sends anything; a tmux generation change releases it
automatically and the old record survives as superseded.

### Stage 5 — request ids and receipts

Built only after the state machine is written down, which is what Sol refused the first version for.

- **`requestId`, not `actionId`** — `actionId` already means a catalogue action such as `compact`.
- **The id binds to a fingerprint** (R5): operation, full target identity, tmux generation and server
  instance, speaker, text or question/option, declared precondition. Same id **and** same
  fingerprint returns the receipt; same id, different fingerprint is `409 id-conflict`, refused
  before rate limiting and before any effect. Without this, one client bug returns message A's
  receipt for message B — suppressing a real send *and* misattributing an outcome.
- **Reserve before the effect, not after** (R6): install `{fingerprint, acceptedAt, state: pending}`
  atomically first. The owner sends; a repeat gets `202 pending` and polls, or joins the same
  promise. An exception finalises as `outcome-unknown` and **never deletes the reservation**. The
  repeat check runs **before** the rate limiter, or a promised receipt comes back as a 429
  (`routes-steer.ts:1017-1037`). Note steering is synchronous `execFileSync` today, so no handler can
  interleave during `fire()` — that removes the race, not the state requirement, and an externally
  readable in-flight receipt would require making it asynchronous first.
- **A stated capacity policy** (R7), because "bounded" and "safe for the process lifetime" cannot
  both stay vague: retain every accepted id until exit, never evict a pending entry, refuse new
  writes at a hard capacity. If time expiry is ever used, an expired id must be **recognised and
  refused**, never treated as new.
- **Store a sanitised outcome, not `SteerResult.sent`**, which contains the full message text
  (`steer.ts:367-371`).
- **Never an automatic retry.** The receipt makes a *deliberate* repeat safe; nothing repeats itself.
  Restart-safe deduplication is not claimed, in the code or on the page.

**Done:** the same id and body posted twice sends once and returns one receipt twice; the same id
with a different body is refused before any effect; a repeat during an in-flight send does not start
a second one; the capacity policy is stated in the code and tested at its boundary.

### Stage 6 — the actions catalogue joins `wire.ts`

Narrowed on R12 and R15: the receipt, outcome and quarantine types went into `wire.ts` in their own
stages, so this is catalogue hardening alone.

Move `EnactedAction`, `BroadcastAction`, `Stagger`, `ActionScope` and the id unions into the leaf;
the client **derives** via the established `Omit<…> & {…}` idiom while keeping its `unrecognised`
arm, which is the point of a client type rather than a duplicate.

**Moving the types is not enough to close the fixture hole** (R15): the hand-written fixtures at
`tests/fleet-web.test.tsx:3848-3898` would go on compiling against nothing. Type the valid fixture
builders with `satisfies` against the shared type, and keep one explicitly named malformed-fixture
escape hatch so the parser can still be tested against garbage.

**Done:** the three real arms are derived; a new required field on the server arm stops the client
compiling; valid fixtures are typed; the compile guard covers it. **Sol's advice taken:** the
opportunistic "steer/new/messages/rename if there is room" tail is dropped — it is a separate job
and bolting it on is how a stage stops being able to stop.

## The simpler options passed over, and why

- **Just add an id, and stop.** Rejected for the same reason the roadmap rejects the equivalent for
  Box contracts: it fixes today's symptom and leaves the ambiguity. But note the inverse is also
  true and is why Stage 1 is first — *most* of the honesty win here is one small render change, and
  it should land before the machinery rather than behind it.
- **Persist receipts and the queue to disk.** Deliberately not. The roadmap's storage contract says
  JSONL plus atomic checkpoints are sufficient and not to introduce more; the queue already declares
  itself volatile and warns on the page (`queue.ts:39-44`, `425-430`). Instance-scoped receipts make
  a repeat safe *within* a server lifetime, which is the case a phone actually hits. Durable
  receipts are a later stage if something shows they are needed.
- **Make the client retry on an ambiguous failure.** Refused outright, and the plan says so in two
  places. A retry is a second message.
- **Rebuild the steer outcome vocabulary from scratch.** Unnecessary — `Delivery` and
  `DeliveryReading` are right and are already rendered. Extend them.

## What this stage does not touch

`FLEET_ACT_ENABLED` stays absent from the systemd unit in every form; repairing this code does not
turn it on, and turning it on is Greg's. The preview envelope, `previewId`/`serverInstanceId`/
`actionRevision`, the bounded preview table and kill candidate-identity are the Overseer's half of
Box contracts. `OverseerPanel.tsx`, `state.ts` and `attention.ts` belong to the Overseer's
dispatched status agent until its debrief; any `wire.ts` addition here goes in a new block at the
end rather than reorganising existing types.
