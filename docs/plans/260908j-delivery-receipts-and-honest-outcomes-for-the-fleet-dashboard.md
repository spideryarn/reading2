# Delivery receipts and honest outcomes for the fleet dashboard

**Status:** planned 2026-09-08 22:15, not started. Baseline `d9f4dcc4`, 692 fleet tests green,
typecheck clean across 1,743 files.

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
equality — cancel, revive, abandon, clear (`routes-actions.ts:1305-1428`). **Only `clear` is
protected**, and only incidentally, because it compares the whole list and refuses `stale-view`. A
phone left open across a restart can abandon a `q3` nobody ever saw.

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

## Stages

Each ends with the suite green and the tree safe to commit. Every stage is red-first: the test goes
in and is watched failing before the fix, and the finished code is mutated at the end of the stage
to check the suite notices.

### Stage 1 — "Nothing happened." is a claim the client cannot support

The smallest and the most user-visible. Give `ActionOutcome`'s failure arm the same
`DeliveryReading` the steer path already has, send it from the routes that can know it, and render
it. A `from: "client"` failure — a fetch that threw, a body that would not parse — must say it does
not know, never that nothing happened.

**Done:** a fetch throw on an enacted action renders an unknown-outcome card; every arm of the
reading has a distinct sentence; no path can reach "Nothing happened." without server-stated
`delivery: "none"`.

### Stage 2 — a queue id minted by a dead process must not resolve in this one

Prefix every id with a per-process instance token, and have cancel/revive/abandon refuse an id whose
instance is not this one with a **distinct** refusal code, so the page can say *that was a previous
server* rather than *no such item*. Fix the defect where it is already documented.

**Done:** a client id from instance A does not resolve in instance B, and the refusal names why;
`clear`'s existing `stale-view` protection is unchanged.

### Stage 3 — action ids and receipts

The client mints an id per send; the server keeps a bounded, instance-scoped receipt table; a repeat
of the same id **retrieves the receipt rather than sending again**. Outcomes become the five the
plan named: accepted, keys submitted, reception observed, refused, outcome-unknown.

**Never an automatic retry** — the receipt makes a *deliberate* repeat safe; nothing repeats on its
own. Restart-safe deduplication is explicitly not claimed, in the code and on the page.

**Done:** the same action id posted twice sends once and returns the same receipt twice; a receipt
survives within the process and says so; the five outcomes are distinguishable in the browser.

### Stage 4 — quarantine a session after an uncertain delivery

Per-session hold on `SteeringQueue`, set when a drain ends `partial` or `unknown`, consulted in
`next()` before the gate. Later items do not drain into an input buffer whose state is unknown. The
held item and its target generation are preserved for inspection; a person may confirm or abandon,
with a warning. **Not an automatic retry.**

**Done:** a partial first message stops the second being submitted on the next drain; the queue UI
shows the hold as its own state, distinct from `stuck`; releasing it is a deliberate gesture.

### Stage 5 — the actions catalogue joins `wire.ts`

Move `EnactedAction`, `BroadcastAction`, `Stagger`, `ActionScope` and the id unions into the
import-free leaf; have the client **derive** via the established `Omit<…> & {…}` idiom rather than
re-declare, keeping its `unrecognised` arm, which is the point of a client type and is not a
duplicate. Add the compile guard.

**Done:** `ClientAction`'s three real arms are derived; a new required field on the server arm stops
the client compiling; `tests/fleet-compile-guards.test.ts` covers it. Then steer/new/messages/rename
if the stage has room; they are mechanical and can slip to their own stage without loss.

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
