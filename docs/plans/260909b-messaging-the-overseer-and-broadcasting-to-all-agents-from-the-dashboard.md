# Messaging the Overseer, and broadcasting to all agents

Two controls on the dashboard's Overseer tab: a line to the one session that holds the Overseer
claim, and a line to every agent on the box at once.

> there should be a way to send messages directly to the Overseer in the Overseer tab, and also to
> broadcast to all agents
>
> — Greg, 2026-09-08

Session `overseer-tab-messaging`, dispatched by the Overseer. Prior art and the contract everything
here builds on: [overseer-direction.md](../project/overseer-direction.md),
[overseer.md](../project/overseer.md),
[agent-fleet-dashboard.md](../reusable/agent-fleet-dashboard.md), and
[260907e-agent-fleet-dashboard.md](260907e-agent-fleet-dashboard.md), which is where the steer path
and the action vocabulary were built.

## What this is not

**It is not a second way to type at a pane.** `tools/fleet/steer.ts` is the only channel and stays
the only channel; both controls here are callers of it. Nothing in this plan adds a delivery
mechanism, a refusal code the page invents, or a second reading of who may be spoken to.

**It is not an inbox.** No message history, no threads, no drafts that survive a reload. Anything
that outlives the branch — a stored field, a schema, a table — is out of scope and goes to the
Overseer as *needs Greg*.

## The two things being built

1. **Message the Overseer** — a one-line input on the Overseer tab that steers into the session
   holding the claim, as speaker `greg`, with the delivery result rendered rather than a "sent".
2. **Broadcast to all agents** — one line to every live Claude session, behind a confirmation that
   names the count and the cost, with a per-session receipt table afterwards.

---

## The decisions, and what each one passed over

### D1. "Message the Overseer" needs no server code at all

`steer-client.ts` already exposes `httpSteerApi.message(row, text)`, which takes a `FleetRow` and
returns a `SteerOutcome`. The Overseer is a Claude session in a pane like any other. So feature 1 is
a component that picks one row and calls that function.

*Passed over:* a `/api/overseer/message` route that resolves the claim server-side. It would move the
claim resolution to where the person cannot see it, and it would be a second write path to audit.
The simpler version is a client that says *which* session it is about to speak to and lets the
existing route do every check.

### D2. The card resolves the claim from `rows` alone, and does not plumb `ReadingCompleteness`

`Header.tsx` computes `overseerClaim(state.rows, completeness(state, fresh))` — the full trust
apparatus, because the header **reports** who the Overseer is, and a confident wrong answer there is
the harm `overseer-claim.ts` was written against.

This card **sends**. That is a different question, and the difference is the whole of this decision:
`steer.ts` re-checks paneId, sessionId, the Claude uuid and the pane pid against live tmux in the
moment before the keys go out, so **a stale row cannot cause a mis-delivery — it can only cause a
refusal**, which the card renders. What must still refuse here is `contested` (two claimants: picking
one is how both go on believing they are the Overseer) and `none`, and both come out of
`overseerClaim(rows)` from the rows by themselves.

*Passed over:* exporting `completeness` from `Header.tsx` and threading it through `App.tsx`. It is
one keyword and it would be defensible, but `Header.tsx` is outside this session's file set, and the
alternative — a second copy of the trust rule in this panel — is a worse bug than the one it fixes.
The header remains the one place that reports the claim with completeness applied.

### D3. The broadcast is a new server route, not a client loop over `/api/steer/message`

A client-side fan-out would need no server code, which is the attractive part. It is refused by
arithmetic: `routes-steer.ts` carries a whole-box ceiling of `BURST_MAX = 6` sends per
`BURST_WINDOW_MS = 10_000` and a `MIN_INTERVAL_MS = 1_500` floor per pane. A broadcast to thirty
sessions through that route either gets `429` after the sixth recipient or paces itself over a
minute — and while it paces, it has spent the whole box's allowance, so Greg's own next message to
one session is refused. The limiter is protecting exactly the right thing and the broadcast is not
the shape it was written for.

So: `tools/fleet/routes-broadcast.ts`, with its own cooldown rather than the per-pane limiter. That
is the same choice `broadcastRoute` in `routes-actions.ts` already made for the ease-off broadcast,
and for the same reason.

### D4. There will be two fan-out loops after this, and here is which one should absorb the other

The brief asks whether the Overseer's ease-off broadcast (`resource-broadcast`, a standing job in its
runbook) should use the same server path, so there is one broadcast mechanism. **It should, and not
tonight.**

The end state is one server-side fan-out — recipients in, a `render(index, total) => string` in, a
cooldown, a deadline, an event-loop yield between sends, one receipt per recipient out — with **two
callers**: this route (whose renderer is a constant function returning the typed line) and the
ease-off action (whose renderer is `renderBroadcast`, producing a different pause per recipient).
The generic case is the free-text one; the staggered one is a special case of it.

Three reasons it is not done in this branch, and the third is the deciding one:

- `actions.ts` and `routes-actions.ts` are owned by `claude-agents-dashboard` tonight, and its
  Stage 4 is in progress inside them.
- The stagger is a genuine second requirement, not an accident. Building the shared abstraction
  with only one caller able to adopt it is guessing at its shape.
- **The ease-off broadcast cannot currently deliver at all**, so "converge on it" would be
  converging on an untested path — see the finding below.

What this branch owes the convergence: `routes-broadcast.ts` is written so its fan-out loop is a
single function taking the render callback it would need as the shared one, so the extraction is a
move rather than a rewrite.

### D5. `working` sessions are skipped, and the receipts say so loudly

`drainGate` (queue.ts) returns `later` for a working session, on a measured claim: *"keystrokes sent
to a busy Claude do not queue themselves anywhere useful"*. The existing ease-off broadcast skips
them. This one does too.

That is a real limitation on a box where most sessions are working most of the time, so the receipts
name every skipped session and why, and the card's headline is *"N of M heard this"* rather than
"Sent." A broadcast that silently reached nine of thirty-four would be the exact failure the whole
steer path is written against.

**The v2 is enqueue-for-working, and it is blocked by ownership rather than by design.**
`queue.ts` already has `enqueueMessage(target, text, speaker)` and takes free text; a working
session's line would sit in its queue and drain when it next reaches a prompt. It cannot be done
from here: the queue is state, mounted as a singleton behind `handleActionRequest`, and reaching the
same instance needs an export from `routes-actions.ts`, which is not this session's file. Doing it
from the client instead runs into D3's limiter on the enqueue route. So it is named here and handed
on.

### D6. One delivery vocabulary, imported rather than declared

At `claude-agents-dashboard`'s condition, and it is right: every receipt this branch renders is a
`SteerOutcome` from `steer-client.ts`, with its `DeliveryReading`'s four arms — `none`, `partial`,
`unknown`, `not-told` — parsed by that file's own `parseDelivery` and `parseVerified`. Nothing here
declares a second word for what became of a send. Three separate delivery vocabularies have already
had to be removed from this dashboard, one of them introduced by the stage that was removing the
previous one.

Consequences that fall out of it, and are requirements rather than notes:

- Each recipient in the broadcast response carries **the same fields the steer route already
  sends** — `{ok:true, verified, sent}` or `{ok:false, code, why, delivery}` — so the client parses a
  recipient with the same functions it parses a single steer with.
- **`delivery` is never swallowed.** `sendMessage` returns `partial` and `unknown` for real reasons,
  and the dashboard's Stage 4 quarantine (held sessions after an ambiguous send) needs every producer
  to carry it out. This route is the fifth producer.
- A skipped or unreached recipient is a **refusal**, not a new arm: `drainGate`'s own `why`, with
  `delivery: "none"`, which is true — nothing left the box.

### D4a. The boundary the shared fan-out must never cross

Agreed with `claude-agents-dashboard`, 2026-09-09, and recorded here because it is the thing most
likely to be lost when the extraction in D4 finally happens:

> **The shared thing is the fan-out MECHANICS, never the authority decisions.** […] A general
> fan-out is a good abstraction and an excellent place to accidentally launder authority. Keep the
> loop ignorant of who is allowed to say what; give it strings that are already rendered and already
> permitted.
>
> — session `claude-agents-dashboard`, 2026-09-09

Into the shared loop: ordering, the deadline, the event-loop yield, per-recipient outcome
collection, the quarantine hold. Staying at the caller, always: who may speak and the `Speaker`
prefix that says so; `renderMessage`'s slash-command rule; whether the text is a **reviewed
vocabulary string** or **arbitrary prose** — which is the actual difference between
`resource-broadcast` and this feature; and the confirm / dry-run / `FLEET_ACT_ENABLED` envelope.

The risk is concrete: `resource-broadcast` carries a fixed, reviewed sentence with no instruction in
it, and its gating is calibrated to that. This one carries whatever somebody typed. A loop that
owned "how a broadcast is authorised" would hand the next caller whichever gating it happened to
have.

**Timing**: the extraction happens after the dashboard's Stage 5, at its owner's request — its
per-recipient outcomes and quarantine were reviewed hours ago, and this loop should prove itself on
the general case first.

### D7. The Overseer's own row is excluded by default, opt-in by tick-box

A broadcast is for the fleet. The Overseer supervising it should not be interrupted by its own
standing job's mechanism unless somebody means it. A checkbox, off by default, and the count in the
confirmation changes when it is ticked.

### D8. A message beginning with `/` is surfaced, never stripped

`renderMessage` refuses a slash command from any speaker but `greg`, because it cannot carry the
attribution line. Both controls here send as `greg`, so a slash command from the page is permitted —
but if that ever changes, the refusal must reach the screen intact rather than being worked around by
trimming the character.

---

## A finding, already handed on

**The existing "Broadcast: ease off, staggered" button cannot deliver.** `boxActionBody()` in
`actions-client.ts` builds `{actionId, mode, confirm, speaker}` and never sets `recipients`;
`broadcastRoute` in `routes-actions.ts` refuses with `bad-request` when `recipients.length === 0`.
Found by reading the request builder against the route it posts to.

Confirmed live against the running server by `claude-agents-dashboard`, which owns those files and
has taken the fix. It matters beyond a dead button: two sessions spent an evening measuring the
selectivity of that broadcast's `drainGate` filter, on a path that is refused upstream of the filter
— the same class as `docs/postmortems/260908h`, a plan and its instrument describing different
systems.

Nothing in this branch touches it.

---

## Stages

Each stage: tests red first, then green; `npm test` and `npm run typecheck`; lint the touched files;
a GPT Sol review at the end; commit.

### Stage 1 — Message the Overseer

- [ ] `SteerReceipt.tsx` (new): renders one `SteerOutcome` — the verified address, the refusal code
      and sentence, the delivery arm. Imports `SteerOutcome`, `DeliveryReading`, `checkLanding` from
      `steer-client.ts`; declares no vocabulary of its own (D6). Offered to the dashboard's Stage 5,
      not wired into `SessionDetail.tsx`.
- [ ] `MessageOverseerCard` in `OverseerPanel.tsx` (new card, replacing the "There is still nothing
      here to send a message to." card): four arms off `overseerClaim(rows)` — `one` draws the input,
      `none` / `contested` / `cannot-tell` each refuse with the reason named.
- [ ] Keep the distinction the old card was protecting: the **daemon** publishes a checkpoint and
      reads no inbox; the message goes to the Overseer's **Claude session**, as keystrokes at its
      pane. A card that blurred those would be the lie the old card existed to avoid.
- [ ] Tests: `tests/fleet-overseer-message.test.tsx` — each claim arm, a send through a fake
      `SteerApi`, a refusal rendered, a `partial` delivery rendered as such.

**Status:** not started.

### Stage 2 — The broadcast route

- [ ] `tools/fleet/routes-broadcast.ts` (new). `POST /api/broadcast`, body
      `{text, speaker, mode: "dry-run" | "run", confirm, recipients: [{…target, status}]}`.
- [ ] Recipients come **from the client, verbatim off the rows it displayed** — the same rule the box
      route already keeps. The server must not choose recipients from its own snapshot, or the count
      in the confirmation is not the count that got the message.
- [ ] Guards, each mirroring an existing one rather than inventing a rule: origin and content-type
      (`checkOrigin`), body cap (`readBody`, `MAX_BODY_BYTES`), a recipient cap, `drainGate` per
      recipient, a cooldown, a deadline with the event loop handed back between sends,
      `renderMessage` for attribution.
- [ ] Imports only. No edits to `steer.ts`, `routes-steer.ts`, `actions.ts`, `routes-actions.ts`,
      `queue.ts`, `drain.ts`. `parseTarget` may move under the dashboard's Stage 5 — accept the
      conflict, do not fork it.
- [ ] One additive mount line in `server.ts`, beside `handleSteerRequest`.
- [ ] **Open a quarantine hold on every ambiguous outcome.** `tools/fleet/quarantine.ts` exports a
      `QuarantineBook`; `SteeringQueue` takes one and exposes `quarantineBook()`. A `partial` or
      `unknown` send leaves that session's input box in a state nothing can read, and a later message
      draining into it appends rather than replaces. This route is the **fifth producer** of
      ambiguous sends and must reach the book like the other four. Wired here rather than left to the
      dashboard's owner, at its request.
- [ ] Tests: `tests/fleet-broadcast-route.test.ts` — a fake `sendMessage`, so no keystroke reaches a
      real pane. Dry run vs run distinguishable in the response; skipped recipients carry
      `drainGate`'s own sentence; the deadline stops early and names what it never reached; the
      cooldown refuses a second broadcast; `delivery` survives to the response.
      **The quarantine assertion goes through `queue.next()`, never through the book** — a book that
      agrees with itself proves nothing about whether this route reached it. Shape copied from
      `tests/fleet-quarantine.test.ts`.

**Status:** not started.

### Stage 3 — The broadcast UI

- [ ] `broadcast-client.ts` (new): the `SteerApi`-shaped seam, so a test drives it without a network.
- [ ] `BroadcastCard` in `OverseerPanel.tsx`: the text, the recipient count, the Overseer opt-in
      (D7), a dry-run preview, a confirmation naming how many sessions will receive it **and what
      that costs** — every line is a turn of a paid model, and steering costs the target its context.
- [ ] Receipts table afterwards: one row per session, verified / refused-with-code / unknown, and the
      headline is *"N of M heard this"*.
- [ ] `MODE_TIPS.overseer` in `Dock.tsx`: *"Nothing on that panel is live, and it says so"* is out of
      date and gets replaced.
- [ ] Tests: `tests/fleet-broadcast-card.test.tsx`.

**Status:** not started.

### Stage 4 — Docs, review, land

- [ ] A section in `docs/project/overseer-direction.md` or a line in the dashboard doc pointing at
      this plan, and D4 recorded where the next person will find it.
- [ ] GPT Sol review of the whole diff, second round, then land on `dev`.

**Status:** not started.

## Open, for the debrief

- **D5's limitation is a product call Greg may want differently**: on a busy box, a broadcast reaches
  only the sessions at a prompt. The fix exists (enqueue for working sessions) and is one export
  away, in another session's file.
- **A restart of the fleet dashboard is needed** for the new route to be live; the Overseer arranges
  it.
