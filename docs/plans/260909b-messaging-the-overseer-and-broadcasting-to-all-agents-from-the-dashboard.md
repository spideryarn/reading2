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

### D2. The claim is read off the rows — and **`verifyTarget` does not check the role**

`Header.tsx` computes `overseerClaim(state.rows, completeness(state, fresh))` — the full trust
apparatus, because the header **reports** who the Overseer is, and a confident wrong answer there is
the harm `overseer-claim.ts` was written against.

This card **sends**, which is a different question. The first draft of this decision leaned on that
difference too hard, and claimed a stale row *"cannot cause a mis-delivery — it can only cause a
refusal"*. **That is false, and the review found the path:**

> `verifyTarget` checks pane, tmux session, pane PID, Claude UUID and competing Claude processes,
> then returns success; **it never reads `GJD_ROLE`.**
>
> 1. Snapshot says session A is Overseer. 2. A releases the role, or B acquires it, without
> restarting A's Claude. 3. The page remains stale. 4. A still has the same pane/session/PID/Claude
> UUID and an empty input. 5. Every `verifyTarget` check passes and `sendMessage` types into A,
> which is no longer the Overseer.
>
> — GPT Sol, 2026-09-09

The verification is of the **address**, not of the **role**. What it rules out is *right words, wrong
pane*; what it does not rule out is *right pane, wrong occupant of a role*. So:

**Stated, not claimed away.** A message addressed to the Overseer can reach the session that held
the claim when the snapshot was taken. The window is one collection interval — the card recomputes
the claim from live props on every render, so the row is the freshest one the page has at the moment
of the click, not one from when the panel mounted — and the card names the session it is about to
speak to, so a person watching sees which one it was. The harm is a line of direction reaching an
agent that has stopped supervising, not a keystroke in a stranger's pane.

**Not built, and named so somebody can decide it later**: a server route that re-reads the live claim
off tmux and then delegates to `sendMessage`. Sol's own framing — *"that is another caller, not
another transport"* — is the right shape. It is out of scope for a first version of a text box, and
it is the fix if this ever matters.

**The half that IS closed.** Sol also noted that `overseerClaim(rows)` defaults to `COMPLETE`, so a
payload that dropped rows could hide a second claimant and the card would happily send to the one it
could see. That has nothing to do with staleness and nothing downstream catches it, so the panel now
takes `unreadableRows` off the snapshot and refuses while it is non-zero. It is one clause of
`Header.tsx`'s rule rather than a copy of it: the staleness clause is covered by the page-wide STALE
banner and by the send-time address check, and the unreadable-rows clause is covered by nothing else.

*Still passed over:* exporting `completeness` from `Header.tsx` and threading it through. One keyword,
defensible, and outside this session's file set; the header remains the one place that reports the
claim with the whole rule applied.

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

### D5. A working session is QUEUED, not skipped — **reversed after review**

**What this said first, and why it was wrong.** `drainGate` returns `later` for a working session, on
a measured claim: *"keystrokes sent to a busy Claude do not queue themselves anywhere useful"*. The
existing ease-off broadcast skips them, so this one did too, and the plan called enqueue-for-working
a v2 "blocked by ownership".

GPT Sol refused both halves of that, and was right on both:

> `drainGate` correctly returns `later` for working sessions, but that is an argument for enqueueing
> static free text, not dropping it. […] **Do not call it a broadcast to all agents while
> intentionally omitting the busiest ones.**
>
> — GPT Sol, 2026-09-09

On this box most sessions are working most of the time. A fan-out that omitted them reached about a
third of the fleet under a control labelled *broadcast to all agents* — a **lie rather than a
limitation**, which is a different and worse category. And it was not blocked: Sol pointed out that
`ActionsUi.api.queueMessage` already reaches `/api/actions/session` from the browser today, whose
limiter is 12 accepted writes per 10s rather than the steer route's 6.

**What it does now.** `drainGate` makes three cuts. `now` → typed at the pane. `later` → put in that
session's own queue, drains at its next prompt. `never` → skipped, carrying `steerableStatus`'s own
sentence. Every row comes back saying which.

The queue is reached through **one narrow additive export**, `enqueueSharedMessage` in
`routes-actions.ts`, written exactly like the `drainSharedQueues` beside it and for the reason that
function's comment already gives: *two `SteeringQueue`s would be two queues, and the one the page can
see would be the one nothing delivers from.* Added with the owning session's explicit agreement, and
narrow on purpose — a broadcast route has no business reaching `settle`, `release` or the quarantine
surface.

Two things that fall out of it and are easy to get wrong:

- **The queue is handed the RAW line.** It stores what it is given and the drain renders the
  speaker's prefix at delivery; an already-prefixed string arrives as *"Greg says: Greg says: …"*.
  The send path is the opposite and takes the rendered one, because `sendMessage` renders nothing.
- **Queueing to a quarantined session is correct and is not an oversight.** A hold blocks at
  `next()`, not at enqueue, so items accumulate and drain once a person releases it. Refusing to
  queue would throw away the instruction, which is the thing the quarantine exists to protect.

### D5a. "Submitted", not "heard"

> A successful steer means the tmux calls completed; even `verified` is explicitly a pre-send
> identity reading, not a delivery receipt.
>
> — GPT Sol, 2026-09-09

The plan said the card's headline would be *"N of M heard this"*. Nothing on this box can establish
that an agent read a line — there is no receipt for a keystroke. The counts are named
`submitted`, `queued`, `skipped`, `notReached`, and the page's sentence has to use those words.

### D6. One delivery vocabulary — but scheduling is not delivery

The condition, from `claude-agents-dashboard` and right: every receipt this branch renders uses
`steer-client.ts`'s `SteerOutcome` and its `DeliveryReading` — `none`, `partial`, `unknown`,
`not-told` — parsed by that file's own functions. Three separate delivery vocabularies have already
had to be removed from this dashboard, one of them introduced by the stage removing the previous one.

**Where that condition was first applied wrongly, by both of us.** The instruction was to make a
skipped recipient *"a refusal carrying `drainGate`'s own sentence with `delivery: "none"`, rather
than a new arm"*, and I agreed. Sol refused it:

> `working/later`, dry-run, and deadline expiry are **orchestration states, not steer refusals**.
> `later` has no refusal code, and no existing steer code truthfully means "fan-out deadline
> expired". Encoding these as `{ok:false, code, delivery:"none"}` **creates the second vocabulary
> while claiming not to.**
>
> — GPT Sol, 2026-09-09

The owner withdrew the condition on reading it, and named it as the same mistake it had spent the
night removing — a keystroke vocabulary describing something that is not keystrokes — *"twice, one
day apart, by me, in the direction of reuse"*.

**So the union splits in two.** An outer arm says what the fan-out did with the row —
`would-send` · `would-queue` · `attempted` · `queued` · `skipped` · `not-reached` — and **only
`attempted` carries a delivery reading**, embedded as the steer route's own response body, whole.
Scheduling above, delivery below, one vocabulary in each, and the condition's actual purpose met.

Requirements that follow, rather than notes:

- **The steer response is embedded, not rebuilt.** The browser's complete reading lives in a private
  `post()` inside `steer-client.ts` and includes `status` and `from`; a recipient carrying only
  `verified` and `delivery` would make the page invent the rest. *"A private parser copied is a twin
  with a delay fuse."*
- **`delivery` is never swallowed.** It reaches the wire verbatim, because the quarantine needs every
  producer to carry it out.
- **This route opens quarantine holds itself**, on `partial`, `unknown`, `threw`, and on a
  `delivery: "none"` that `nothingWasSent` refuses to certify. Asked of `nothingWasSent` rather than
  of `delivery` directly — that function is the one audited place that reads both the summary and the
  list of tmux calls that completed.

### D6a. A kill switch, and the body limit

Two more from the same review, both taken:

- **`FLEET_BROADCAST_ENABLED`.** *"A kill switch that has to be added under pressure is one that does
  not exist"* — `routes-steer.ts`'s words about its own. Default on; only an explicit `0` turns it
  off; **a dry run is never gated**, because seeing what a broadcast would do is exactly what
  somebody deciding whether to switch it back on needs.
- **The body cap is the box route's 64 KiB, not the steer route's 16 KiB.** Eighty addresses is
  around 10 KB, so with the smaller cap the recipient limit was unreachable — and the first version
  of the test for it "passed" by hitting 413 instead. Both limits now have a test, one either side.

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

- [x] `SteerReceipt.tsx` (new): renders one `SteerOutcome` — the verified address, the refusal code
      and sentence, the delivery arm. Imports `SteerOutcome`, `DeliveryReading`, `checkLanding` from
      `steer-client.ts`; declares no vocabulary of its own (D6). Offered to the dashboard's Stage 5,
      not wired into `SessionDetail.tsx`.
- [x] `MessageOverseerCard` in `OverseerPanel.tsx` (new card, replacing the "There is still nothing
      here to send a message to." card): four arms off `overseerClaim(rows)` — `one` draws the input,
      `none` / `contested` / `cannot-tell` each refuse with the reason named.
- [x] Keep the distinction the old card was protecting: the **daemon** publishes a checkpoint and
      reads no inbox; the message goes to the Overseer's **Claude session**, as keystrokes at its
      pane. A card that blurred those would be the lie the old card existed to avoid.
- [x] Tests: `tests/fleet-overseer-message.test.tsx` — each claim arm, a send through a fake
      `SteerApi`, a refusal rendered, a `partial` delivery rendered as such.

**Status:** done.

### Stage 2 — The broadcast route

- [x] `tools/fleet/routes-broadcast.ts` (new). `POST /api/broadcast`, body
      `{text, speaker, mode: "dry-run" | "run", confirm, recipients: [{…target, status}]}`.
- [x] Recipients come **from the client, verbatim off the rows it displayed** — the same rule the box
      route already keeps. The server must not choose recipients from its own snapshot, or the count
      in the confirmation is not the count that got the message.
- [x] Guards, each mirroring an existing one rather than inventing a rule: origin and content-type
      (`checkOrigin`), body cap (`readBody`, `MAX_BODY_BYTES`), a recipient cap, `drainGate` per
      recipient, a cooldown, a deadline with the event loop handed back between sends,
      `renderMessage` for attribution.
- [x] Imports only. No edits to `steer.ts`, `routes-steer.ts`, `actions.ts`, `routes-actions.ts`,
      `queue.ts`, `drain.ts`. `parseTarget` may move under the dashboard's Stage 5 — accept the
      conflict, do not fork it.
- [x] One additive mount line in `server.ts`, beside `handleSteerRequest`.
- [x] **Open a quarantine hold on every ambiguous outcome** — `partial`, `unknown`, `threw`, and a
      `delivery: "none"` that `nothingWasSent` refuses to certify, through `sharedQuarantineBook()`.
      It does **not** check for a hold before sending; see D9 for why that is deliberate and whose
      it is.
- [x] **A composition test, because every other test here injects its own `enqueue`.** Two calls
      through `enqueueSharedMessage` must land in one queue — `position: 2` on the second is the
      whole assertion, since a second queue would answer `1` again. Written after
      `claude-agents-dashboard` retracted a coverage guarantee for exactly this blind spot: unit
      tests with injected fakes cannot see whether the real thing is wired together, and that
      blindness is invisible in a green suite. Confirmed by mutation: `shared ??=` → `shared =`
      turns it red and turns nothing else red.
- [x] Tests: `tests/fleet-broadcast-route.test.ts` — a fake `sendMessage`, so no keystroke reaches a
      real pane. Dry run vs run distinguishable in the response; skipped recipients carry
      `drainGate`'s own sentence; the deadline stops early and names what it never reached; the
      cooldown refuses a second broadcast; `delivery` survives to the response.
      **The quarantine assertion goes through `queue.next()`, never through the book** — a book that
      agrees with itself proves nothing about whether this route reached it. Shape copied from
      `tests/fleet-quarantine.test.ts`.

**Status:** done.

### Stage 3 — The broadcast UI

- [x] `broadcast-client.ts` (new): the `SteerApi`-shaped seam, so a test drives it without a network.
- [x] `BroadcastCard` in `OverseerPanel.tsx`: the text, the recipient count, the Overseer opt-in
      (D7), a dry-run preview, a confirmation naming how many sessions will receive it **and what
      that costs** — every line is a turn of a paid model, and steering costs the target its context.
- [x] Receipts table afterwards: one row per session, verified / refused-with-code / unknown, and the
      headline counts what was measured — `submitted`, `queued`, `skipped`, `notReached` — and never says "heard" (D5a).
- [x] `MODE_TIPS.overseer` in `Dock.tsx`: *"Nothing on that panel is live, and it says so"* is out of
      date and gets replaced.
- [x] Tests: `tests/fleet-broadcast-card.test.tsx`.

**Status:** done.

### Stage 4 — Docs, review, land

- [x] A section in `docs/project/overseer-direction.md` or a line in the dashboard doc pointing at
      this plan, and D4 recorded where the next person will find it.
- [x] GPT Sol review of the whole diff, second round, then land on `dev`.

**Status:** in progress — the Sol code review is running against the branch sha.

### D9. The quarantine is recorded here and enforced elsewhere — and not yet on this path

This route **opens** a hold on `partial`, `unknown`, `threw` and a `delivery: "none"` that
`nothingWasSent` refuses to certify. It **does not check** for one before sending, and that is
deliberate rather than missed.

`claude-agents-dashboard` retracted two guarantees on 2026-09-09, unprompted, after its Stage 4
review:

- *"a fourth producer added without a hold is a red test"* — **false**: every producer test injects
  its own book, nothing joins the real mounted compositions, and the tests enumerate today's
  producers rather than requiring tomorrow's.
- the hold is enforced **only** in `SteeringQueue.next()`. Direct steering and broadcast record holds
  and never consult them, so **today a held session can still be typed at** by either.

The fix is a single mandatory send coordinator immediately before the synchronous transport call,
with direct messages, answers, broadcast recipients and drain delivery all going through it. It is
being built in that session's files. Writing a hold check here against today's shape would have to
be unpicked, so this route stays unaware and gets threaded through the coordinator when it lands.

**What this branch owes that gap: silence about it in the copy.** Nothing the card says claims a hold
is respected, and given the above that omission is load-bearing rather than lucky. The queued half is
unaffected — `push` does not consult the book, and queueing to a held session is correct, because
refusing would throw away the instruction the whole mechanism exists to protect.

## Open, for the debrief

- **D5's limitation is a product call Greg may want differently**: on a busy box, a broadcast reaches
  only the sessions at a prompt. The fix exists (enqueue for working sessions) and is one export
  away, in another session's file.
- **A restart of the fleet dashboard is needed** for the new route to be live; the Overseer arranges
  it.
