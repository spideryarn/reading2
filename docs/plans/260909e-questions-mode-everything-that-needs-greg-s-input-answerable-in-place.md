# Questions mode: everything that needs Greg's input, answerable in place

Up: [overseer-direction.md](../project/overseer-direction.md) ·
[fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) ·
queue item `qi-25bs5ysg` · session `questions-mode` · worktree `questions-mode`

Status: **two GPT Sol rounds, both *not fit to build*, both right; rewritten again after round two
found the round-one fix rested on a source reading of mine that was false. Round three pending;
nothing built.** § What the reviews changed.

---

## What this is for

> I think I want a "Questions" mode, which just shows the things that require my input. It should
> present them nicely (e.g. if they're multiple choice, let me click, but also type and use voice
> dictation.
>
> — Greg, 2026-09-09

And the sentence the whole dashboard is judged by, the same day:

> The main thing I really want from this web dashboard interface is to have a very easy way to see
> answers to questions like: Is anything needed from me? Is anything blocked? Where do things
> stand? And right now, it is very hard to see those things!
>
> — Greg, 2026-09-09

This tab answers **the first of those three**, and answers it in the only form that finishes the
job: not *here is a list of things waiting on you* but *here is a list of things waiting on you and
here is the box you answer them in*. Today the answer is three gestures away — the Attention panel
draws the card, tapping it selects the session, and the composer is down inside `SessionDetail`.
That is a screen that informs rather than one that helps
([design-a-screen.md § 2](../reusable/design-a-screen.md), *"an answer with its action three taps
away"*).

The third quotation is the one that shapes the hardest part of this:

> Often I get asked a question and I don't understand what the question is asking, or the options,
> or how to choose between them.
>
> — Greg, 2026-09-09, the rule landed in AGENTS.md § "Explain plainly and briefly" (commit `7c59d05b`)

---

## Half one of `design-a-screen.md`, answered in prose before any stylesheet

[design-a-screen.md](../reusable/design-a-screen.md) says the three questions get answered before a
stylesheet is touched, and that doing the checklist without them produces a tidier screen that is no
easier to use. So:

### 1. The questions the reader arrives with, in his words

1. **"Is anything waiting on me right now?"** — and the answer must be trustworthy in *both*
   directions. A wrong *yes* costs him a turn; a wrong *no* leaves an agent parked for hours.
2. **"Can I clear it from here, on this phone, right now?"** — the whole reason the mode exists.
3. **"Which one first?"** — he has one attention and there may be six.

They are ranked, and the list is deliberately short. Everything else a reader might want to know
about a session — what it is doing, how long it has run, what it last said — is the Sessions tab's
job and is one tap away. **This screen supports one decision: which waiting thing to answer next,
and then answering it.**

### 2. What he does next, and whether the action is on this screen

| The answer is | What he does | On this screen? |
|---|---|---|
| a live multiple-choice dialog | picks an option | **yes** — a button per option |
| a decision handed over in prose | says which, in words | **yes** — a text box and a microphone |
| a question he cannot understand | asks for it to be rewritten | **no, and nothing can** — § The chip cannot be built |
| a queued idea awaiting his authority | authorises it | **no** — a counted link to Queued ideas |

**Two of the four finish here, and the other two cannot — for two different reasons, neither of them
a choice this plan made.** A queued idea is not answerable because the queue refuses writers other
than the Overseer by design, so a control here would be a lie about who may write; a counted pointer
is the honest whole of what this tab can offer, and it is acceptance-critical rather than optional.
A rewrite request is not sendable because the message route refuses a pane showing a dialog. The
second is a gap in the fleet's write vocabulary rather than in this tab, and it is carried to the
Overseer as such.

### 3. What the screen must never do

Written down **before** anything is made louder, because a redesign is a redistribution of attention
and what loses is whatever nobody wrote down. Each of these is a real failure this box has already
had, or a type in `wire.ts` that exists because of one.

- **Never show a ghost prompt as a question.** Claude Code renders a *suggested next prompt inside
  its own input box* after a turn, with the same `❯`, and nothing in a pane capture distinguishes it
  from something a person typed. Three appeared in a row one evening.
  [overseer.md § Things that will catch you](../project/overseer.md): *"A ghost prompt must never
  become a question you put to Greg, because answering it would be answering nobody."*
- **Never quote Greg's own last message back to him as an agent's question.** The producer's
  `readTurnTail` did exactly this once, and it is the reason `AttentionPanel` has no answer control
  today.
- **Never draw *nothing needs you* when it means *nothing was judged*.** Five distinct silences
  already have names in `wire.ts` — `not-asked`, `checkpoint-absent`, `checkpoint-unreadable`,
  `AttentionList`'s `unknown`, and `AttentionView`'s payload-level arm — and this panel must keep
  all five apart. An absence of observation may not be read as an observation of absence.
- **Never let a click land a digit in a prose prompt.** If the pane has moved off the dialog between
  render and tap, the answer must be refused, not typed. `1` at a numbered menu is an approval; `1`
  at a prompt is the character one.
- **Never flatten `dialog` and `prose` into one thing.** The first is mechanical and observed; the
  second is inferred and may be wrong. They get different controls and different words.
- **Never claim a delivery it did not observe.** `Delivery` has three arms and `partial` is the one
  where *"try again"* is the worst available advice.

### The acceptance test

Greg's own sentence, treated as the test rather than as motivation: **a screen that does not help
answer "is anything needed from me?" is not finished, however tidy it looks.**

---

## What already exists, and what this plan therefore does not build

The single largest risk to this job is building a second one of something. Almost every part of it
is already here:

| The part | Where it already is |
|---|---|
| *which sessions need Greg, ranked, with a reason* | `tools/overseer/attention-*.ts` → `Checkpoint.attention` → `tools/fleet/attention.ts` → `AttentionFeed` on the pushed payload |
| *what dialog a pane is parked on, live* | `FleetRow.question` / `FleetRow.rawQuestion`, on every row of the payload |
| *sending words to a session as Greg* | `POST /api/steer/message`, `speaker: "greg"`, `SPEAKER_PREFIX` in `actions.ts` |
| *clicking option N of a dialog* | `POST /api/steer/answer`, `steerAnswerBody(row, optionIndex)`, and `sameQuestion` / `sameMaterial` on the server |
| *the guard that a permission grant is never clickable* | `classifyGate` in `pane.ts`, enforced in `steer.ts` on a capture taken **at send time** |
| *voice dictation into a box on this page* | `useFleetDictation` + `DictationControl` + `routes-transcribe.ts` |
| *drawing what became of a send, in four arms* | `SteerReceipt.tsx`, already used by two cards outside `SessionDetail` |
| *a card that composes box + mic + send + receipt* | `MessageOverseerCard.tsx` — **the template for the question card** |

So this plan adds **one composition and one panel**, and reuses the rest. In particular it adds
**no new HTTP route and no new write path**: answering a question here is the same `SteerApi` call
`SessionDetail` already makes, from a different surface. That was the brief's instruction and it
survives contact with the code. (It was to have added a detector too; § The rule is why it does
not.)

### The one agreement this deliberately reverses, and why that is allowed

`AttentionPanel.tsx`'s header holds three agreements, and the first is:

> **(a) No answer control, on any card, in v1.** […] A `prose` item is INFERRED from a pane tail,
> and the producer's own `readTurnTail` bug proved a card could quote *Greg's own last message* back
> as an agent's question; a button beside that would have acted on his own sentence.

Greg has now asked for exactly the thing that agreement forbids, so it is superseded rather than
ignored — but **its reasoning is not**, and this plan keeps every part of it that was about safety
rather than about scope:

- The hazard it names is *acting on the wrong text*. That hazard is answered here by **binding the
  click to the live row rather than to the inbox item** (§ The join, below): an option button exists
  only where `FleetRow.rawQuestion` is present *now*, and the server re-checks it against a capture
  taken at send time. A `prose` item never gets an option button, because there is nothing
  mechanical to bind to.
- The material must be beside the answer. `AttentionPanel` deferred to `SessionDetail` for that;
  here the card draws the question, the options and the excerpt **on the card**, above the controls.
- `AttentionPanel` itself is **not changed by this plan.** It goes on being a read-only ranked list
  above the session list. Two surfaces, one of which answers, is the honest outcome; quietly adding
  buttons to the old panel would leave its header lying about itself.

**Say it as a decision rather than as a side-effect** — Fable's instruction, and it is the sentence
to hold onto: *this mode introduces a write path from a card.* That is what agreement (a) refused,
it is what Greg has now asked for, and every further control this tab grows is one more thing down a
path that now exists. So the question for anything added later is not *may a card write?* — that is
settled — but *does this control bind to something mechanical?* The option buttons do, and they are
the only control on a dialog card. The prose text box does not, and § Answering a prose item is what
that costs and what is done about it.

---

## The boundary with `decisions-mode` (plan 260909e, same letter — deliberate)

Agreed by message with that session on 2026-09-09 and restored to their plan at `84b5f63a`. Their
§ "The boundary with `questions-mode`" is the authority; it is cited rather than restated. The line:
**theirs is what no longer blocks; mine is what still blocks.** An *assumption pending Greg* lives on
their tab with `reviewed: false`, because the work carried on.

Their sentence, which is the one to remember:

> **Neither tab may quietly become the other.** The failure to watch for is a question being
> recorded as a decision to get it off the blocking list — which is the same act as calming the
> count, and is what gate 1 is about.
>
> — session `decisions-mode`, 2026-09-09

**The symmetric failure is this tab's**, and it is worth naming beside theirs: a *decision* shown as
a *question* re-blocks work that was already unblocked, and costs Greg a turn answering something
nobody was waiting for. The defence here is structural rather than a rule about reading: **a
Questions item is composed only from things that are parked right now** — a live dialog on a pane,
or a turn that ended handing over a decision — and never from a record of something that already
happened. This panel's composition function cannot reach the decision record at all.

---

## The design

**Rewritten twice.** GPT Sol returned *not fit to build* on both the first draft and the revision.
Round two found that the revision's central mechanism — a join on question identity — rested on a
**source reading that was simply wrong**, and checking it confirmed the review. The design below has
no join at all, and is smaller for it. § What the reviews changed has the whole record.

### The rule that replaces the join

> **The pane is the authority on dialogs. The inbox is the authority on prose.**
> Each source is used only for the thing it is authoritative about, and neither is asked to
> corroborate the other.

The revision tried to reconcile two observations of the same dialog — the Overseer's ranked inbox and
the collector's row — so that a card could carry the inbox's age and consequence alongside the row's
buttons. **That reconciliation cannot be built**, and the reason is worth stating exactly, because it
was asserted the other way in a committed plan:

`AttentionItem.id` is **not** a dialog fingerprint. It is `group.key`, which is
`attentionQuestionKey(o)` — a SHA-256 over `[evidence.kind, normalised topic]`, and `topic` is the
**classifying model's** canonical phrasing of the question (falling back to the raw prompt when the
model did not answer). `dialogFingerprint` exists in the same producer and is used for something
else: the classifier's cache key. It is discarded before the item is built.

So there is no question identity on the wire that `tools/fleet/` can recompute — one of its inputs is
a model output. And the fingerprint the plan wanted to borrow would have been the **wrong tool
anyway**: it hashes the material, or the prompt and labels, and omits option consequences and keys,
which `sameQuestion` compares. A cache key is allowed to be weaker than a safety check. Borrowing it
would have permitted **false matches**, so the revision's "drift fails safe" argument was wrong in
the dangerous direction.

Sol's own repair was to have the producer publish a new per-observation identity. That is a
`tools/overseer/` change, which the brief puts outside this session's file set — and it turns out not
to be needed, because the two sources do not have to be reconciled at all.

### What each source is used for

```
   the collector's rows                    the Overseer's inbox
   (every pane, ~73 s)                     (judged turn tails, ~2 min)
            │                                        │
            │ gate.kind === "conversation"           │ evidence.kind === "prose"
            ▼                                        ▼
     ┌──────────────┐                        ┌──────────────┐
     │ DIALOG cards │                        │ PROSE cards  │
     │ prompt,      │                        │ excerpt, why │
     │ options,     │                        │ waitingSince │
     │ material,    │                        │ kind (rank)  │
     │ gate         │                        │ duplicates   │
     └──────┬───────┘                        └──────┬───────┘
            │ answered by                           │ needs only an ADDRESS,
            │ POST /api/steer/answer                │ looked up by sessionId
            │ (row is already the target)           ▼
            │                              ┌─────────────────┐
            │                              │ the row, for    │
            │                              │ paneId, panePid,│
            │                              │ claudeSessionId │
            │                              └────────┬────────┘
            ▼                                       ▼
                    one list: dialogs first, then prose
```

**The inbox's own `dialog` items are not used.** They are the same dialogs, observed later and
reconstructed by another parser, and the pane is the authority. Dropping them removes the entire
class of problem round two found.

**The one sessionId lookup that remains is not a join and cannot go wrong the same way.** A prose
item says *session X ended its turn handing you a decision*; the row for X supplies *where X is*. No
question identity is involved, because a prose item has no dialog to identify. If X has no row, the
card is drawn without controls and says so; it is never dropped.

**A prose item whose row is now showing a dialog is dropped from the prose list** — the pane is the
authority, and that session's dialog is already a card. This is the one place the two sources meet,
and it is a check on *presence*, not on identity.

### Ordering, and the age a dialog card does not have

**Dialogs first, then prose in the producer's order.** Two reasons, and only the second is about
this tab: a dialog is mechanically observed and clears in one tap, so it is both the most certain
and the cheapest thing on the list; and the producer's ranking, which this must not re-sort
(`AttentionPanel` agreement (b)), covers exactly the prose items it produced.

**A dialog card carries no waiting-time in v1, and that is a real loss taken deliberately.**
`FleetRow` has no status clock — checked: it carries `startedAt` for the session and nothing for the
current status — so the honest options were to invent a first-seen memory in the dashboard or to
show nothing. Nothing is the simpler-first answer, and "which one first?" is still served by
dialogs-first ordering. If it turns out to matter, the shape to copy is `OverseerSessionHistory.since`,
whose `observed | lower-bound` arms already say *how long, and how sure we are* — a memory that dies
on restart can only ever claim a lower bound.

**Consequence ranking is not synthesised for dialog cards.** No `AttentionKind` is ever invented —
and it would have added little, since the producer itself falls back to `"other"` whenever the
classifier did not answer.

### The item arms

A settled union, not names plus prose (Sol round two). Final field names in Stage 1:

```ts
export type QuestionItem =
  /** A conversation-gate dialog on a pane, with an address. Buttons. */
  | { kind: "dialog"; groupKey: string; sessions: NonEmpty<QuestionTarget>;
      prompt: string; options: readonly FleetOption[]; material: FleetMaterial }
  /** The same, with no steerable address. Drawn, no buttons, with the reason. */
  | { kind: "dialog-unaddressable"; ...; why: string }
  /** An inbox prose item whose session has a steerable row. Words. */
  | { kind: "prose"; itemId: string; target: QuestionTarget;
      excerpt: string; why: string; waitingSince: string; attentionKind: AttentionKind;
      duplicates: readonly QuestionTarget[] }
  /** The same, with no row or no steerable address. Drawn, no controls, with the reason. */
  | { kind: "prose-unaddressable"; ...; why: string };
```

Four arms, each carrying **only what it can support**, with the capability inside the arm — so
*prose + buttons* and *dialog + text box* are states the compiler refuses. Specifically:

- **`material` is carried on the dialog arm** and `unreadable` is representable, but a dialog with
  unreadable material **cannot reach the `dialog` arm in the first place**: `classifyGate` makes such
  a pane `unknown`, and only `conversation` is admitted. Sol round two is right that hand-building a
  clickable one would test an impossible producer state — so the arm's comment says so, and the test
  is at the client parser boundary where a malformed material can actually arrive.
- **`dialog-unaddressable` is a separate arm rather than a flag**, because a row with no `paneId` or
  no `claudeSessionId` is one the server will refuse; drawing buttons on it offers a control that
  cannot work. This is the state round two found the action-bearing arms could not express.
- **No arm claims the pane is at an empty input box.** `FleetRow` does not carry `PaneSurface` and
  only the send-time capture can establish it. The prose card offers the box, the server decides, and
  a `pane-is-asking` or `input-not-empty` refusal is drawn as the server's own sentence.
- **`groupKey` is this tab's own**, computed in `tools/fleet/` over exactly `sameQuestion`'s fields —
  the prompt, the material, and every option's label, consequence and key, all of which
  `FleetQuestion`/`FleetOption` carry. It groups **our own observations of our own rows**; it is not
  an identity shared with another producer, so nothing can drift out from under it, and it is as
  strong as the check the send will make. `sessions` is a non-empty list, so a grouped card always
  names who answering will reach.

### Answering a prose item: what is guarded, what is accepted, and one thing withdrawn

Round two says the residual risk is **worse** than the revision stated, and it is right:

> A stale or misclassified card sends a real authoritative Greg message to a live agent. The agent
> may interpret it as a product decision or instruction and act on it.

That is the honest statement and it replaces *"one confusing turn"*. It is still not a permission
grant — that remains impossible here by construction — but the effects are not bounded to one turn.

**Withdrawn: the local status refusal.** Round two calls it security theatre as specified and is
right — the reconciliation and the row come out of the same payload, so comparing them is
tautological. It survives only as what it actually is: the card **freezes the row's status when a
draft begins** and warns if a later payload disagrees, which catches an observed-and-persisting
change and misses same-status tail changes, changes between polls, and leave-then-return. It is
labelled a stale-draft convenience **and explicitly not a mitigation**, so nobody later reads it as
one.

**Kept and strengthened: the draft key.** Round two is right that "session identity" was too loose.
The key is the **execution identity** — `paneId`, `panePid` and `claudeSessionId` together, which is
what `steer.ts` itself compares — plus the inbox item's id. Any change discards the draft and the
receipt.

**Kept: the excerpt drawn at full size above the box**, so the premise is on screen with the control.

**Still overruled: read-only prose.** Prose is ten of the fifteen genuinely-waiting sessions measured
on 2026-09-08, and *"let me type and use voice dictation"* is half of what Greg asked for. The real
fix is the guarded prose-answer operation — send a tail fingerprint, re-capture, refuse unless the
same ended-turn evidence is still there — which is a `steer.ts` write path outside this session's
file set. **It goes to the Overseer with Sol's finding attached**, and this plan states the risk
rather than arguing it away.

### Where the composition happens, and what it publishes

`tools/fleet/questions.ts`, pure, called from `state.ts`'s `statePayload` beside the attention feed
and off the **same single checkpoint read**.

**The signature is wider than the revision's**, because round two showed it could not establish what
it promised: it needs the collection `error` and the snapshot's freshness as well as the rows and the
feed. And **the browser is the final authority on `complete`** — only it knows whether it parsed
every row and every reference, so the server publishes what it observed and the client may only ever
*downgrade* it.

**Reference-only, and stated as a shape rather than a promise.** The items above carry the prompt,
options and material because the panel draws them. Round two's point stands: that is a copy, and
"publish a reconciliation not a copy" cannot be honoured for the dialog arm without the panel
resolving into `rows` itself. **The resolution: dialog items carry a row reference and no question
text**, and the panel reads the question off the row it already has — which is also what the *answer*
must do (`row.rawQuestion` verbatim), so the panel needs the row in hand regardless. Prose items
carry their excerpt, because the inbox is on the payload too and the same rule applies: reference the
item id, resolve against `attention`. **Every reference the client cannot resolve becomes a gap**,
never a dropped card.

That makes the added payload a list of ids and decisions rather than ~80 KB of duplicated prose
(Sol P2-1), and Stage 1 still adds the size-regression fixture.

### What the empty list has to prove before it may reassure

`complete | partial | not-observed`, with `partial.gaps` a **non-empty tuple** so it cannot be built
without saying what is missing. Round two accepted the shape and found the cause list short; it is
now Sol's, in full:

| Gap | Why it is its own cause |
|---|---|
| `AttentionFeed` is `not-asked` | this server did not look — never a claim about the box |
| checkpoint absent / unreadable | two different observations, both news |
| `AttentionList` is `unknown` | the pass ran and could not judge |
| `sessionsUnreadable > 0` | a **published, non-empty** list can still be incomplete |
| the `questions` field is absent | an older server, distinct from present-and-unreadable |
| the `questions` field is unreadable | a fact about the payload, which only the client can report |
| the last collection failed (`error !== null`) | the server keeps the previous snapshot, which may still look fresh |
| a row whose pane capture or question parse failed | the row is **present**; this is not "rows dropped" |
| a reference the client could not resolve | a malformed question parses to `null` without dropping the row |

Only `complete` may render *nothing needs you*.

### What v1 leaves out

- **Fan-out answering** to every session on a grouped card. The sessions are named; answering
  reaches the one the card says it will reach.
- **A waiting-time on a dialog card**, and consequence ranking for one — § Ordering.
- **The inbox's own `dialog` items**, which are a staler second reading of what the pane already
  shows — § The rule that replaces the join.
- **The rewrite chip**, which cannot be sent at all — § The chip cannot be built.
- Nothing else. **The queue pointer is not droppable** — § The queued ideas waiting on Greg.

### The rule, and why no detector is built

The brief asked for a detector — *an item whose question lacks goal/background/options is shown as
not yet answerable* — and told this session to settle its strictness with Fable. **Fable's answer
was to build no detector at all, and it is right.** The reasoning is one measured fact, which this
session then checked in the producer rather than taking on trust:

> **The detector cannot see the thing the rule is about.** `turn-tail.ts` is explicit: Claude Code
> draws on the alternate screen, so a capture is the last ~25–31 lines and nothing above. […] So an
> agent that wrote three paragraphs and then opened a menu has, in nearly every case, pushed its own
> explanation off the top before we look. What reaches the detector is the widget, whose labels are
> short *because the widget renders them short*. **A length threshold on that evidence measures the
> harness's UI design, not the agent's conduct.**
>
> — Fable, 2026-09-09

Checked, and it is stronger than that. Two readings, both in the producer:

- [`turn-tail.ts`](../../tools/overseer/turn-tail.ts) line 43: *"`capture-pane -S -80` returns the
  same ~25 to ~31 lines as `capture-pane`"*, and line 45 says outright that an agent that asked a
  question and then printed forty lines of a diff **has pushed its own question off**.
- For a dialog item the evidence is not a truncated screenful at all. `dialogText()` in
  [`attention-pass.ts`](../../tools/overseer/attention-pass.ts) is exactly
  `prompt + material + option labels` — **the agent's prose explanation is not in it by
  construction**, however well the agent wrote it. A detector run on that text would be measuring
  `AskUserQuestion`'s widget.

So a length-or-shape detector would flag the careful agent and the lazy one identically, and the
false-positive population is precisely the agents you least want to interrupt. Fable's second point
is the one that turns a nuisance into a defect:

> A false send-back is not "a turn": the agent re-explains, the re-explanation lands off-screen
> again, the menu reopens, the detector flags it again. That is a loop […] And each false send-back
> teaches Greg the control is wrong, after which he stops using it when it's right.

**So no detector is built, and the `QuestionRule` type this plan's first draft proposed is deleted
rather than defaulted.** Fable's proposed replacement — enforcement in one tap by the only judge
whose verdict is correct by definition, Greg, after he has failed to understand the menu — was a
canned reply chip on every dialog card. **That cannot be sent either**, which Sol found and this
session confirmed; the next section is why, and it is a better finding than the chip would have been
a feature.

**And the words *"not yet answerable"* are dropped from the design**, Fable's point and a good one:
the item *is* answerable — Greg may perfectly well understand a three-word menu whose context he set
five minutes ago. *Not answerable* is a claim about him, and this page does not get to make it.

#### If the detector decision is overruled

Recorded here so a reviewer can overrule it cheaply rather than by re-deriving it. The **only**
defensible detector is one that reports an *absence in the captured screen* rather than a length: the
dialog is an agent's own question (`AGENT_QUESTION_HEADER` — `pane.ts` already tests this and calls
the gate `conversation`), it has ≥2 options, **and** the captured lines above the widget contain no
agent prose at all. That arm is named `no-explanation-on-screen` — never `bare-menu` or
`falls-short` — because it says what was seen and cannot say the agent gave none. It is never run on
prose items: a judgement stacked on an inference is where the *quoted Greg back at himself* bug came
from. Sol reviewed the decision independently and agreed with it.

### The chip cannot be built, and that is a finding worth carrying

Fable's replacement for the detector was a canned *"Rewrite this so I can choose"* chip on dialog
cards. **Sol found that it cannot be sent, and the finding survives checking:** `sendMessage` refuses
a pane showing a dialog with `pane-is-asking`, and `queue.ts` grades such a session `later`, so a
queued copy drains only once the dialog is gone — that is, only once Greg has already answered the
menu he could not understand. The chip is refused exactly when it is relevant.

So **v1 ships no chip**, and the honest statement of what that means is worth more than the control
was:

> **The AGENTS.md rule cannot currently be enforced from the dashboard for a dialog question.** If an
> agent opens a menu Greg cannot act on, there is no way — from the phone, immediately or deferred —
> to ask it to explain itself. His only routes are to answer the menu anyway or to go to a terminal.

That goes to the Overseer in the debrief. It is not a gap in this tab; it is a gap in the fleet's
write vocabulary, and the shape of the fix is a new operation that leaves a dialog safely and then
sends — which is a `steer.ts` change and outside this session's file set.

A chip **on prose cards** would work, since the message route accepts an empty input box. It is not
built: it would be a second way to say what the text box on that same card already says, and § Prefer
simple says not to add one. If Greg wants a one-tap version later it is a `SPOKEN` vocabulary entry,
reviewed once, rather than a string assembled at a call site.

### No badge, in either direction

This survives the detector's removal and is worth stating as its own rule, because it is what the
card must not grow later. **There is no "✓ meets the rule" marker and no "not judged" caveat.** The
first would be a fabricated positive — `AttentionList`'s comment, *"a positive control proves the
step it wraps and nothing above it"* — and the second is the permanent caveat that
`sessionsUnreadable` is deliberately rendered only when non-zero, because a caveat on every card is
read as noise within a day. That is A17, healthy operation spending most of its time alarming.

### The queued ideas waiting on Greg, which are acceptance-critical rather than droppable

`QueueItemWait`'s `needs-greg` arm is genuinely *needed from me*, and it is **not answerable here**:
`overseer-queue.ts` refuses writers other than the Overseer by design, so any control on such a card
would be a lie about who may write. The first draft made a counted pointer to them the droppable part
of Stage 3.

**Sol's P1-5 is that this makes the tab's own promise knowingly false**, and it is right. A tab that
answers *"is anything needed from me?"* while silently excluding a whole class of things needed from
him is worse than one that does not exist, because he will stop checking the other place. Two ways
out, and this plan takes the first:

1. **Make the counted pointer acceptance-critical.** One fetch on entering the tab, through the seam
   `queue-client.ts` already exposes — an on-demand read, not a new field on the refresh path. If it
   cannot be shipped, the tab does not ship.
2. Rename the tab *Agent questions* and say in its own copy that queued authority requests are
   excluded. Rejected: it answers a narrower question than the one Greg asked, and the dock is not
   short of tabs that answer narrow questions.

---

## Where the tab goes, and the dock problem that is bigger than this tab

`questions` is registered in the six places
[fleet-dashboard-modes.md § The registrations](../project/fleet-dashboard-modes.md#the-registrations)
lists, **appended** to `MODES` rather than placed first — nobody owns the tab list, each session adds
its own entries and never edits another's, and reordering would move every other mode's position for
everybody.

**The panel is written as a self-contained component that takes props and renders**, so the tab is
one mount and the queued landing surface (`qi-thd98yqw`) can be another with no change here. That is
what "design so the two compose" means concretely: no data fetched in the panel's own effects that a
host would have to duplicate, and no assumption that it is the whole page.

**The dock is out of room and this is not this tab's problem to solve.** Two claims, kept apart
because one is a reading and the other is arithmetic — agreed in that form with `decisions-mode`,
which had it as a single derivation until asked:

- **Observed**, by `readiness-tab` at 390px coarse, 2026-09-09 06:12Z: at eight modes the buttons fit
  only as icons and Refresh sits past the edge.
- **Derived**, by `decisions-mode` from `tailwind.css`: `.dock-btn { min-width: 2.5rem }` under
  `@media (pointer: coarse)` is the 40px floor; the active mode keeps its label at the last rung; and
  `.dock` also carries Refresh, two `0.15rem` gaps, a left gutter and a `.dock-tail`. That puts eight
  at roughly **440px** against a **390px** viewport, each further mode adding about **41px** — so ten
  lands near **520px**.

They agree at eight, which is the only count either session can currently check; **nine and ten are
unmeasured**. This session is at 390 in Stage 3 anyway, so it takes the reading and sends the number
back to replace the arithmetic. Past the last fit rung the row scrolls rather than clipping, which is
the honest stopgap. Two things follow:

1. **The coarse-pointer share count.** `.dock-modes { flex: 8 0 auto }` hard-codes the mode count in
   CSS where no type and no test can see it, and its own comment says *"CSS cannot read a TypeScript
   array; if you add a mode, add one here"*. Two sessions each bumping that literal is the
   silent-merge shape. **Proposal, agreed with `decisions-mode` before it lands:** `Dock.tsx` sets a
   custom property from `MODES.length` and the stylesheet reads it — the fix
   [§ What this costs](../project/fleet-dashboard-modes.md#what-this-costs) already asks for. **Agreed
   with `decisions-mode`, 2026-09-09**, along with the ordering, so neither session waits on the
   other: if this lands first the literal is gone and they drop their bump; if theirs lands first
   this replaces a `flex: 9` rather than a `flex: 8`. Their scroll fix does not touch that
   declaration at all, so it merges cleanly against either state.
2. **Whether the dock should become something else** is **a product question and it is Greg's**. It
   is being put to him **once, jointly** — drafted by `decisions-mode` at `45a202f3` § *The joint
   question for Greg: the dock is full*, and carried by whichever of the two sessions debriefs
   second. It is not asked twice from two halves. The option this session asked to have added, and
   the one that draft now leads with, is that **a full bar may be a symptom rather than the problem**:
   ten peers implies ten equally important things, and they are not. The first candidate is these two
   tabs and their neighbour — **Queued ideas, Decisions and Questions are three views of one thing**
   (what the Overseer is going to do, what it did in Greg's name, what it needs from him), which
   takes the bar from ten to eight and is the only option that stops the problem recurring rather
   than postponing it. Our own two are offered first deliberately: it is easier to propose merging
   your own tab than someone else's, and if Greg takes it we are the ones who should absorb it.

**The gating check, adopted from `decisions-mode`:** on a direct `#questions` load at 390 × 844 the
active tab is visible and reachable. If it is not, the tab does not ship and it goes to Greg as
important work left.

---

## The stages

Each ends with a GPT Sol review of the scoped diff and the raw test output, exit code *and* a fresh
non-empty answer file both checked. Implementation is delegated to Codex per the brief; this session
writes the task prompts, runs the tests and the typecheck, reviews, and commits.

### Stage 1 — the contract and the composition (server side, all pure)

- [ ] `wire.ts`: one additive end block — `QuestionItem`'s four arms, `QuestionsView`'s three, the
      gap vocabulary and `QuestionTarget`. Every arm's name and comment says what was **observed**.
- [ ] `tools/fleet/questions.ts`: `composeQuestions({rows, attentionFeed, collectionError, collectedAt, now})
      → QuestionsView`, pure, no I/O. The signature carries the collection error and freshness
      because the view promises things the rows alone cannot establish (Sol round two).
- [ ] `questionGroupKey(q: FleetQuestion)` in the same file, over exactly `sameQuestion`'s fields —
      prompt, material, and every option's label, consequence and key. **This tab's own key over its
      own rows**, never an identity shared with the Overseer's producer.
- [ ] Wired into `state.ts` beside `attention`, off the **same single checkpoint read**.
- [ ] `web/src/types.ts`: the client's parser; its own gap for *this payload's field was present and
      unreadable*; reference resolution against `rows` and `attention`; and the **downgrade** — the
      client may lower `complete` to `partial` and never raise it.
- [ ] A **payload-size regression fixture** (Sol P2-1), which is meaningful now that items carry
      references rather than question text.

Tests, each **watched red first**, and each **routed to the boundary where its state can actually
occur** — Sol's round-two correction, which is why several of the round-one list are gone:

*Server composer, over real pane fixtures:*

- [ ] a **`permission`**-gate and an **`unknown`**-gate dialog → neither becomes a card;
- [ ] a `conversation` dialog with `no-material` → a card with buttons (the `/loop` menu shape);
- [ ] two rows on the same question → **one grouped card naming both sessions**; two rows whose
      options differ only in a `consequence` or a `key` → **two cards**, which is the assertion that
      pins `questionGroupKey` to `sameQuestion`'s strength;
- [ ] a `conversation` dialog on a row with no `paneId`, and one with no `claudeSessionId` →
      `dialog-unaddressable`, with the reason, never buttons;
- [ ] an inbox **prose** item whose row is now showing a dialog → dropped from the prose list, the
      dialog card standing in its place (the pane is the authority);
- [ ] an inbox prose item with **no row at all** → `prose-unaddressable`, never dropped;
- [ ] **every gap cause in the table above**, each on its own, and `not-observed`;
- [ ] **a genuinely empty but partial observation** → must not say *nothing needs you*;
- [ ] asserted through the same `statePayload` composition `server.ts` calls, never a graph the test
      rebuilds.

*Client parser, where a malformed payload can actually arrive:*

- [ ] a malformed `gate`, and a malformed `material` → a gap, not an ordinary item;
- [ ] a dangling row or attention reference → a gap, never a dropped card;
- [ ] an absent `questions` field (an older server) and a present-but-unreadable one → two different
      gaps.

**Delegated to Codex** (`gpt-5.6-sol`, `--sandbox workspace-write`). Status: *not started.*

### Stage 2 — the panel, the answering, and the registrations

- [ ] `QuestionsPanel.tsx`, modelled on `MessageOverseerCard.tsx`. One arm per item kind with a
      `never` default: **buttons** on `dialog`, **a text box with `DictationControl`** on `prose`,
      **the reason and no control** on the two `unaddressable` arms. `SteerReceipt` for the outcome.
- [ ] The submit rule at the action boundary, not only on the button: `dictate.sendBlocked` guards
      the send, or Enter mid-sentence sends the rough live guesses — or, on Safari and Firefox,
      nothing that was said at all.
- [ ] Card state keyed by the **execution identity** — `paneId`, `panePid`, `claudeSessionId` — plus
      the item's own id, and discarded when any of them changes (Sol round two).
- [ ] The **frozen-status stale-draft warning**, labelled as a convenience and **not** as a
      mitigation; § Answering a prose item says why that label is load-bearing.
- [ ] The six registrations, plus the `--dock-mode-count` custom property (agreed with
      `decisions-mode`).
- [ ] The four tests from
      [§ The test](../project/fleet-dashboard-modes.md#the-test), driven through `SteerApi`'s seam
      rather than a stub of `fetch`; and four that are this tab's own: **a click sends the row's
      `rawQuestion` verbatim**; **it refuses when the row no longer carries a question**; **a draft
      does not survive a change of execution identity**; and **a successful, a `partial` and an
      `unknown` send each leave the controls in the right state**, rather than inviting a retry that
      would append to half-sent text.
- [ ] `answeringEnabled` in both its `false` and its not-reported readings, drawn as two different
      things.

**Delegated to Codex.** Status: *not started.*

### Stage 3 — see it, and the queue pointer

- [ ] Browser verify at **1280 × 800** and **390 × 844**, in a Sonnet subagent, against a throwaway
      server on a free port confirmed from its bind line — never `:8787`, whose process is not to be
      touched. Screenshots land in the repo root, are copied out, and are deleted.
- [ ] **The screenshots are looked at by this session, not only reported on.** Delegated
      descriptions of a layout are wrong often enough to distrust on their own.
- [ ] Every state from § 3 above forced and looked at individually — including each silence.
- [ ] The queue pointer with a real count, through `queue-client.ts`'s seam. **Acceptance-critical**
      (Sol P1-5): without it the tab's own promise is knowingly false, so if it cannot ship, the tab
      does not.
- [ ] `docs/project/` — a line under the entry point that owns it, and this plan kept matching the
      code.

Status: *not started.*

---

## What the reviews changed

Two rounds with GPT Sol, both returning **not fit to build**:
[round one](260909e-questions-mode-plan-review-sol-r1.md) ·
[round two](260909e-questions-mode-plan-review-sol-r2.md). Both verdicts were right. Every finding
was checked in the source rather than accepted on the review's word.

### Round one

| # | The finding | Outcome |
|---|---|---|
| P0-1 | Joining on `sessionId` attaches one question's ranking to another's buttons; neither clock is guaranteed newer | Accepted — and the *fix* was then wrong; see round two |
| P0-2 | Prose free text binds to a row, not to the excerpt; card state keyed by the grouped id can target the wrong session | Split — diagnosis accepted, remedy overruled |
| P0-3 | `items: []` could reassure without establishing anything | Accepted — `complete` / `partial` / `not-observed` |
| P1-1 | The text box and the rewrite chip cannot be sent while a dialog is open | **Accepted, and understated** — also true of a queued copy, so there is no deferred path. § The chip cannot be built |
| P1-2 | `ask` × `answerHere` is an invalid Cartesian product; the dialog arm omits `material` | Accepted — capability inside the arm |
| P1-3 | A row question with no inbox item may be a *deliberately excluded* permission dialog | Accepted — **this would have shipped a real defect**: permission dialogs republished into "needed from me" wearing a fabricated `kind` |
| P1-4 | `duplicates` dropped, hiding other blocked sessions | Accepted |
| P1-5 | A droppable queue pointer makes the tab's promise knowingly false | Accepted — acceptance-critical |
| P2-1 | "Costs nothing" is false — ~80 KB of duplicated prose per cycle | Accepted |
| P2-2 | The test list contradicted the detector decision and missed the dangerous cases | Accepted |

Sol independently agreed that **dropping the automatic rule detector is correct**, having read
`dialogText()` itself — the one decision this plan was least sure of going in, and the one two models
and a source reading converged on.

### Round two, which found the round-one fix was built on a false reading

**The finding that matters, and it was mine.** The revision claimed `AttentionItem.id` **is**
`dialogFingerprint(q)`, and built the whole reconciliation on it. It is not. The chain is
`id` → `group.key` → `attentionQuestionKey(o)` → a SHA over `[evidence.kind, normalised topic]`,
where `topic` is **the classifying model's** phrasing. `dialogFingerprint` is the classifier's cache
key and is discarded before the item is built.

The evidence for the false claim was `id: group.key` and a comment one line away saying *"The id is
the QUESTION's, not the session's"* — both true, and the middle hop was never traced. **A comment
tells you what a field means, never what it equals.** And the borrowed hash would have been the wrong
tool regardless: it omits option consequences and keys, which `sameQuestion` compares, so it permits
**false matches** — the "drift fails safe" argument was wrong in the dangerous direction.

| # | Round-two finding | Outcome |
|---|---|---|
| P0-1 | The join argument is unsound | **Accepted. The join is deleted** — § The rule that replaces the join |
| P0-3 | The outer shape is right; the gap causes are short | Accepted — the gap table is now Sol's, in full, and the browser is the final authority on `complete` |
| P0-2 | The local status check "buys essentially nothing"; the draft key needs execution identity; the residual risk is understated | Accepted on all three — the check is withdrawn as a mitigation, the key is now execution identity, the risk is restated in Sol's words |
| P1-2 | The arms still contain contradictions and missing states | Accepted — a settled four-arm union with `dialog-unaddressable`, and no arm claiming an empty input box |
| P1-4 | Per-member observation identity is missing | Dissolved — with no cross-producer identity, grouping is over this tab's own rows |
| P2-1 | Reference-only is achievable but needs an explicit contract | Accepted — dialog items carry a row reference and no question text |
| P2-2 | Several tests cannot be written at the stated boundary | Accepted — each test routed to the boundary where its state can really occur |
| P1-1, P1-3, P1-5 | — | Confirmed fixed |

**Sol's own repair for P0-1 was to have the producer publish a new per-observation identity.** That is
a `tools/overseer/` change and outside this session's file set — and it is not needed, because the
two sources never had to be reconciled. Round two's last line agrees: *"No `steer.ts` write-path
change is required for those corrections."* The same is now true of `tools/overseer/`.

### The one finding this plan still overrules

**Round one's P0-2 remedy, not its diagnosis** — read-only prose cards, or a new guarded
prose-answer operation. Round two sharpened the diagnosis and this plan accepted every part of it,
including that the risk is worse than first written. The remedy is still refused: read-only prose
removes half of what Greg asked for and ten of the fifteen genuinely-waiting sessions, and the
guarded operation is a `steer.ts` write path the brief puts outside this file set.

**It goes to the Overseer with Sol's two findings attached rather than summarised**, per the brief's
rule for an overruled P0.
---

## The simpler option this passed over

**Adding answer controls to the existing `AttentionPanel` and shipping no new tab.** It is a much
smaller diff: the panel already draws the ranked list, and the controls are the same ones. It was
rejected for three reasons, in order of weight.

1. **It cannot do the job.** The inbox is a ~2-minute judgement, so a dialog that opened forty
   seconds ago is not in it. A surface that answers *"is anything waiting on me?"* off that alone is
   wrong for up to two minutes at a time, and wrong in the reassuring direction. The join with the
   live rows is the substance of this plan and it does not fit inside a panel whose contract is
   *renders the Overseer's judgement and makes none of its own*.
2. **It would leave that file's header lying about itself.** Its three agreements are quoted
   evidence of a decision taken carefully; editing the code out from under them, or deleting them,
   loses the reasoning that is the most valuable thing in the file.
3. **Greg asked for a mode.** Not decisive on its own — he asks for the thing he can picture, and
   the job is to find what he needs — but here the thing he pictured is also the thing that works.

The second simpler option, **one list with a filter instead of two tabs with `decisions-mode`**, was
settled by that session's § The boundary: the two tabs answer two different questions of Greg's, and
a filter would make *what is blocking* and *what was decided in my name* one pile.

---

## Who was consulted

- **Fable**, 2026-09-09, on the rule detector's strictness and on how the check is shown. It
  overturned this plan's first position on both, and § The rule is its answer rather than a
  compromise with it. The producer readings it rests on were then checked in
  `turn-tail.ts` and `attention-pass.ts` by this session, per
  [an unchecked brief claim becomes a source comment](../reusable/silent-success.md) — the claim was
  right, and stronger than stated.
- **Session `decisions-mode`**, 2026-09-09, by `SendMessage`: § The boundary, the dock arithmetic,
  and the ordering on `tailwind.css`. Their § The boundary is the authority for the split and is
  cited rather than restated.
- **GPT Sol**, rounds one and two, 2026-09-09 —
  [`…-sol-r1.md`](260909e-questions-mode-plan-review-sol-r1.md) ·
  [`…-sol-r2.md`](260909e-questions-mode-plan-review-sol-r2.md). Both *not fit to build*, both
  right; § What the reviews changed. Round two is the one that earned its cost: it found that this
  plan's central mechanism rested on an equality its author never traced. The built code goes back
  at the end of every stage.

## Open, and going to Greg rather than being decided here

- **The dock's shape at ten tabs** — joint with `decisions-mode`, drafted by them (§ Where the tab
  goes).
- **There is no way to ask a session to rewrite a question Greg cannot act on.** The AGENTS.md rule
  landed this morning and the dashboard cannot enforce it for a dialog question, because the message
  route refuses a pane showing a dialog and a queued copy drains only after he has answered. His
  routes are to answer the menu anyway or to go to a terminal. Closing it needs a new fleet write
  operation — leave the dialog safely, then send — which is a `steer.ts` change outside this
  session's file set. **To the Overseer**, since it is a fleet capability rather than a product call.
- **The prose-answer guard this plan overrules Sol on.** A tail fingerprint sent with the message and
  re-checked against a fresh capture would close the residual risk in § Answering a prose item. Same
  file set, same reason. **To the Overseer**, with Sol's finding attached rather than summarised.

Anything else that outlives this branch and turns up during the stages is added here and carried in
the debrief as *needs Greg*, per the brief.
