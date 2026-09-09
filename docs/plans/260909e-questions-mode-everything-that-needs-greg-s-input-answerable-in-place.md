# Questions mode: everything that needs Greg's input, answerable in place

Up: [overseer-direction.md](../project/overseer-direction.md) ·
[fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) ·
queue item `qi-25bs5ysg` · session `questions-mode` · worktree `questions-mode`

Status: **three GPT Sol rounds. Round three's blocking finding was settled by the Overseer under
gate 2 — the prose half ships read-only — and its remaining corrections are bounded Stage 1 work by
its own account. Building the dialog half now.** § A decision taken in Greg's name ·
§ What the reviews changed.

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

## A decision taken in Greg's name, which he may reverse

Recorded here at the Overseer's instruction because it was decided under gate 2 rather than by Greg,
and it changes what he gets. **Decided 2026-09-09. Adviser: GPT Sol, across three review rounds.**

### The question

Greg asked for questions to be *answerable in place* — *"if they're multiple choice, let me click,
but also type and use voice dictation"*. The things waiting on him split in two, and only one half
turned out to be safe to build:

- a **dialog** question — a session parked on a multiple-choice menu;
- a **prose** question — a session that ended its turn handing him a decision in sentences.

Prose is the larger half: on 2026-09-08, **ten of fifteen** genuinely-waiting sessions had ended
their turn in prose.

### Why the prose half is not safe

To send Greg's words to the session that asked, this tab must find that session's address. The
attention inbox identifies the asker by tmux `sessionId` alone. But `sessionId`, `paneId`, `panePid`
and `claudeSessionId` **can all stay the same while the Claude process in that pane exits and another
one starts** — which is exactly why `ExecutionToken {boot, pid, startTicks}` exists in this repo.
`CLAUDE_SESSION_ID` is pinned into the tmux environment once and never rewritten, so the replacement
claims the same conversation id and the `conflicting` arm that would otherwise catch it does not
fire.

So an old prose observation can be bound to a **different execution**, and an instruction carrying
Greg's authority delivered to an agent that never asked anything. The send-time checks prove the
target is alive; they cannot prove it is the asker. There is no check available in `tools/fleet/`:
the producer publishes no execution identity beside the item.

### The two options

**A — prose read-only in v1.** A prose card shows the excerpt, how long it has waited and its
ranking; tapping it selects the session and the existing `SessionDetail` composer does the answering.
Costs one extra gesture on the larger half. Every waiting thing is still on one screen.

**B — rescope this job to build the guarded write.** A new steer operation that sends a tail
fingerprint with the message, re-captures the pane immediately before sending, and refuses unless the
same ended-turn evidence is still there. Makes interactive prose *correctly bound* rather than merely
disclosed. It is a change to `steer.ts` and `routes-steer.ts` — outside this session's file set — and
a stage of work in its own right.

### What was decided, and why

**A, with B queued as its own item** (priority 0.7; the two producer gaps below at 0.6).

The reasoning: one extra tap on the prose half is a much smaller cost than a wrongly-addressed
instruction, and A still delivers the thing Greg actually asked the dashboard for — one screen that
answers *"is anything needed from me?"*. B is worth doing precisely because prose is most of the
volume, which is why it is queued rather than dropped.

**This plan argued the other way for two rounds and was overruled on the third by evidence, not by
caution.** The prose card says in one short line why answering is one tap away — that the address
cannot yet be proved to belong to the asker — rather than leaving it to look like an oversight.

### Two producer gaps this job found and did not fix

Both queued; neither is in this session's file set.

1. **The AGENTS.md "explain plainly" rule cannot be enforced from the dashboard for a dialog
   question.** `sendMessage` refuses a pane showing a dialog, and a *queued* message drains only once
   the dialog is gone — that is, only after Greg has answered the menu he could not understand.
2. **`AttentionItem` publishes no question identity a consumer can recompute** — `id` is a hash of
   the classifying model's `topic`. Nothing outside `tools/overseer/` can tell whether an inbox item
   and a live pane concern the same question, which is what killed this plan's first two designs.
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
| a decision handed over in prose | says which, in words | **one tap away** — the card selects the session; § A decision taken in Greg's name |
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
the only control that writes from a card in v1. The prose half was to have had a text box, and
§ A decision taken in Greg's name is why it does not.

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

### What round three changed, and the one decision that left the branch

Round three accepted that deleting the dialog join removed the original defect, and found that the
**prose address lookup had inherited an equivalent one**. Three things follow, and the first is the
only one that is not bounded Stage 1 work.

**1. Prose is read-only in v1, and interactive prose is escalated.** The inbox identifies an asking
session by tmux `sessionId` alone. `sessionId`, `paneId`, `panePid` and `claudeSessionId` can *all*
stay fixed while the Claude process in that pane exits and another starts — which is precisely why
`ExecutionToken {boot, pid, startTicks}` exists in `wire.ts`, whose comment says so at length. And
`ExecutionReading.conversation`'s `conflicting` arm does not rescue it: `CLAUDE_SESSION_ID` is pinned
into the tmux environment once and never rewritten, so a replacement in the same pane claims the same
id and does not conflict.

So **an old prose observation can be bound to a different execution**, and Greg's authoritative
instruction delivered to an agent that never asked anything. The send-time checks prove the target is
live; they cannot prove it produced the excerpt on the card. There is no check available in
`tools/fleet/`: the producer publishes no execution identity beside the item, and `startTicks` cannot
be compared against `waitingSince` without a boot wall-clock.

This plan argued for interactive prose across two rounds and was talked out of it on the third, on
evidence rather than on caution. **v1: a prose card shows the excerpt, the age and the ranking, and
tapping it selects the session so the existing `SessionDetail` composer answers.** One extra gesture,
and every waiting thing is still on one screen. The guarded write — a tail fingerprint sent,
re-captured and compared before the keystrokes — is the right fix, is a `steer.ts` change outside
this file set, and is **escalated to the Overseer as a scope decision** with Sol's three findings
attached.

*Everything below is bounded Stage 1 work, per round three's own last paragraph.*

**2. A prose item is never suppressed by a row dialog.** The revision dropped a prose card whenever
its session showed a dialog, on the theory that the dialog card stood in its place. **Both halves are
wrong.** A dialog does not prove an earlier prose decision was superseded — prose A can be followed
by unrelated dialog B — and for a `permission` or `unknown` dialog there *is* no dialog card, so the
prose item would vanish with nothing in its place. With the identity join deleted there is
deliberately no evidence that two observations concern the same question, and presence cannot supply
it. **Both cards are kept.**

**3. `questionGroupKey` is withdrawn, and v1 is one dialog card per row.** It is an excellent
stale-answer *safety* comparison and an unsound *semantic* grouping: two sessions can show an
identical prompt, material and options while asking about different repositories — a false merge,
since session context is excluded — and `sameQuestion` deliberately treats a moved cursor as
different because option keys change, which is a false split. Safe where false negatives are cheap;
not safe as *"these sessions are asking the same thing"*. One card per row needs no identity at all.

**4. The inbox's dialog items are still discarded, but the loss is stated honestly.** The revision
called them *"strictly a staler reading"* and that is false: the two collectors run independently so
either may be newer, both use the same `parsePane`, and the inbox item uniquely carries
`waitingSince`, the classifier's ranking, `answerability` and the producer's duplicates. Discarding
them is an accepted simplification — the pane is the authority on what is on the pane *now* — and its
cost is that a dialog observed by the inbox and missed by the collector is not shown. That case
raises a completeness gap, so it cannot produce a false *nothing needs you*.

**5. The union narrows and grows a mixed-member representation.** A grouped item may contain both
addressable and unaddressable sessions, which no whole-group arm could express; with one card per row
(3 above) that dissolves for dialogs, and for prose the duplicates list carries per-member
addressability rather than a bare `QuestionTarget[]`. And `material` on the dialog arm is **narrowed
structurally to the `read` arm**: `classifyGate` requires `material.kind === "read"` before returning
`conversation`, so `unreadable` and `no-material` conversation dialogs are impossible on the server
path — but the **client parses `gate` and `material` independently** and will accept a
`{kind: "conversation"}` beside either. That cross-field inconsistency is a **gap**, detected in the
resolver, not an ordinary item.

**6. The gap list grows again**, with the causes round three found still missing: `collectedAt ===
null` (no snapshot has ever completed); a stale fleet snapshot; a stale checkpoint; a stale scan;
`sessionsScanned === 0`, which the existing panel already treats as a broken probe; client
`unreadableRows > 0`; and **a view that was complete when parsed and has since aged past its
threshold in the browser**. The composer takes `refreshMs` so it applies the dashboard's own
cadence-derived staleness rule rather than inventing a second threshold. And the downgrade **cannot
happen only in `parseFleetState`** — freshness changes while the page is open, so a derived selector
re-applies it against current client time on every render.
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

**A prose item whose row is now showing a dialog is kept, not dropped.** An earlier draft dropped
it on the theory that the dialog card stood in its place; round three showed both halves are wrong —
a dialog does not prove an earlier prose decision was superseded, and a `permission` or `unknown`
dialog produces no card at all, so the prose item would have vanished with nothing in its place.
With no identity join there is deliberately no evidence that two observations concern the same
question, and presence cannot supply it.

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
*prose + buttons* is a state the compiler refuses. Specifically:

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

### The prose card, and what it does not do

**Settled by the Overseer under gate 2 on 2026-09-09** — the full record, with both options and the
trade-off, is in § A decision taken in Greg's name, which he may reverse. In short: a prose card
carries the excerpt, how long it has waited and its ranking, and **nothing on it writes**. Tapping it
selects the session, and the `SessionDetail` composer that exists today does the answering, with its
text box and its microphone.

The card says so itself, in one short line, because an absent control that looks like an oversight
gets reported as a bug and an absent control with a reason does not: **the address cannot yet be
proved to belong to the asker.**

Three things about this are worth keeping when somebody comes to lift the restriction.

**Why it is not merely cautious.** The inbox names the asker by tmux `sessionId`; `sessionId`,
`paneId`, `panePid` and `claudeSessionId` all survive one Claude process exiting and another starting
in the same pane. `ExecutionToken` exists in `wire.ts` precisely because of that, and its comment
says so. So a prose observation can be bound to a **different execution**, and the send-time checks —
which prove the target is alive and its input box empty — cannot tell the difference. The risk is not
the *"one confusing turn"* this plan first wrote: in GPT Sol's words, *"a stale or misclassified card
sends a real authoritative Greg message to a live agent, [which] may interpret it as a product
decision or instruction and act on it."*

**What was tried and does not work.** A local check comparing the row's status against the status the
item was composed from is tautological — both come out of the same payload — and round two was right
to call it theatre. `ExecutionReading.conversation`'s `conflicting` arm does not help either:
`CLAUDE_SESSION_ID` is pinned into the tmux environment once and never rewritten, so a replacement
claims the same id and does not conflict. And `startTicks` cannot be compared against `waitingSince`
without a boot wall-clock. There is no check available in `tools/fleet/`.

**What would lift it**, queued as its own item: a guarded prose-answer operation that sends a tail
fingerprint with the message, re-captures the pane immediately before sending, and refuses unless the
same ended-turn evidence is still there. That makes the operation *correctly bound* rather than
disclosed. It is a `steer.ts` and `routes-steer.ts` change, outside this session's file set.

**Card state is still keyed by `row.execution.token`**, even though v1 sends nothing from a prose
card. The key costs nothing now and is the thing a later interactive version must have — and putting
it in while the reasoning is fresh is cheaper than rediscovering, a third time, that a pane's handles
are not a run's identity.

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
unmeasured**. Past the last fit rung the row scrolls rather than clipping, which is the honest
stopgap.

**The reading is split rather than duplicated, settled by message with `decisions-mode` on
2026-09-09.** They take **nine**, because their own Stage 4 gating check is a direct `#decisions`
load at 390 × 844 and they have to measure it anyway; this session takes **ten**, which only it can
take once `questions` exists. Two details, both of which decide whether the number means anything:

- **The tenth is simulated with `decisions-mode`'s real label**, not a stub. A mode's width is its
  glyph plus its label, so a tenth called `Temp` measures a shorter bar than the one that will
  exist. The reading is taken with a local tenth entry labelled exactly *Decisions*, then reverted —
  and the note that goes back says the tenth was simulated rather than merged, so nobody later reads
  it as a measurement of a shipped state.
- **Their arithmetic is a prediction this measurement is entitled to falsify**, and they said so
  first. Their own correction, 2026-09-09: an earlier *"≥360px at nine"* counted the 40px button
  floors alone and understated it; with Refresh, the active mode's retained label, the two `0.15rem`
  gaps and the gutters it is nearer 480px. Whether the ruler confirms or contradicts it, the number
  and the method go back — a prediction that was checked and held is worth more in the joint question
  to Greg than one nobody tested.

**One constraint on the share-count fix, from `decisions-mode`, 2026-09-09:** their edge fades are
CSS **masks on `.dock`**, not child elements, *deliberately* — `fit.ts` picks its rung from
`scrollWidth`, so anything that contributes width feeds back into the measurement and the ladder can
oscillate. `--dock-mode-count` is therefore a custom property set in the `style` of the existing
`.dock-modes` element and a `var()` inside the existing `flex` declaration: no new element, no
padding, no margin. **Read the diff for that specifically** — a wrapper `div` is the plausible wrong
move and nothing in the suite would notice.

Two things follow from the dock being full:

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
2. **ANSWERED BY GREG, 2026-09-09 — a scrolling strip, and none of the rest.** His words:
   *"Re dock, use a scrolling strip - borrow/follow/reuse from Spideryarn"*. No More-menu, no
   grouping, no tab dropped. **So the option this session asked to have added was rejected**: Queued
   ideas, Decisions and Questions stay three tabs, and the bar stays at ten. Recorded here rather
   than only in the joint draft because this plan is what proposed the merge.

   **And it needs no build, which is the part worth checking before somebody starts one.** The
   referent is [`src/web/styles/dock.css`](../../src/web/styles/dock.css) — checked, because
   `mode-band.css` also matches a grep for horizontal scrolling and is a vertical panel shell rather
   than a tab strip. The fleet dock is already a **port** of that file, and everything the answer
   names is on `dev`: `overflow-x: auto` at every width rather than inside a media query
   ([narrow-windows.md](../project/narrow-windows.md) says why that distinction cost a release),
   `scrollbar-width: none` and the webkit rule so there is no trough, `.dock-gap` collapsing so the
   buttons close up and the row scrolls, the measured fit ladder dropping labels *before* it
   scrolls, and `decisions-mode`'s scroll-into-view and edge fades on top. Greg's answer also
   matches his own call on the product on 2026-08-28 — *"maybe also row scrolls sideways if it
   doesn't fit horizontally"* — which is the quote attached to that CSS.

   **What the answer does not settle, and it is not this tab's to carry:** Refresh is off screen at
   eight, nine and ten modes, including at `scrollLeft: 0`. A scrolling strip answers *the bar is
   full*; it does not answer *a control is unreachable at rest*. Going to Greg separately, via the
   Overseer.

   The original framing, kept because the reasoning outlives the answer:

2. **Whether the dock should become something else** was **a product question and Greg's**. It
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
- [ ] two rows showing the same question → **two cards**, one per row (grouping is withdrawn in v1;
      § What round three changed, 3);
- [ ] a `conversation` dialog on a row with no `paneId`, and one with no `claudeSessionId` →
      `dialog-unaddressable`, with the reason, never buttons;
- [ ] an inbox **prose** item whose row is now showing a dialog → **both cards kept**; and the same
      with a `permission` dialog, where there is no dialog card to stand in its place;
- [ ] an inbox prose item whose row's execution has been replaced under the same handles → the card
      still says *one tap away*, and nothing on it writes;
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

**Delegated to Codex** (`gpt-5.6-sol`, `--sandbox workspace-write`) from
[the task](260909e-questions-mode-stage1-codex-task.md).

**Status: built, reviewed, fixed, green.** Five suites and the
four-project typecheck pass, run by this session rather than taken from the implementer's claim:
Codex was killed by its 45-minute timeout *while waiting on a reviewer it had started itself*, so
there is no implementer's report and nothing it said about its own work is evidence.

Two things happened that the plan did not anticipate.

**The task prompt introduced a defect.** It said not to edit anything already in `wire.ts`, so rather
than adding a required `questions` key to `FleetState`, Codex added
`FleetStateWithQuestions = FleetState & { questions }` and re-pointed four files at it. That leaves
two names for one payload and a plain `FleetState` that does not require the field — and moves
`tests/fleet-compile-guards.test.ts` onto the alias, so the guard would not have caught the drift
either. Fixed by this session: the field is on `FleetState`, the alias is gone, and the comment
records why it briefly existed. **The lesson is about the prompt, not the implementer** — "do not
edit anything already there" is right for an append-only vocabulary and wrong for a payload type
whose whole contract is that consumers cannot miss a field.

**One suspected defect is with the reviewer rather than fixed.** `composeAttentionItem` raises an
`attention-dialog-not-in-rows` gap whenever the inbox holds a dialog the rows do not show. The inbox
scans every ~2 minutes and the collector every ~73 seconds, so a dialog answered in between is
**ordinary operation** — which would put a permanent caveat on the page and downgrade `complete` to
`partial` nearly always. That is A17, which § What the screen must never do forbids. It was not
fixed on this session's own judgement because the obvious alternative is not obviously right:
silence there discards the one case where the inbox genuinely knows something the rows do not, which
§ What round three changed, 4 says is the accepted cost of discarding inbox dialog items.

### Stage 2 — the panel, the answering, and the registrations

- [x] `QuestionsPanel.tsx`, modelled on `MessageOverseerCard.tsx`. One arm per item kind with a
      `never` default: **buttons** on `dialog`; **the excerpt, the age, the ranking and a tap that
      selects the session** on `prose`, with one short line saying why answering is one tap away;
      **the reason and no control** on the two `unaddressable` arms. `SteerReceipt` for the outcome
      of a dialog answer.
- [x] Card state keyed by **`row.execution.token`** — `{boot, pid, startTicks}`, the only thing in
      this payload that identifies a *run* rather than a *pane* — plus the item's own id, and
      discarded when either changes. **Not** `paneId + panePid + claudeSessionId`, which round three
      showed is exactly the tuple that survives one Claude exiting and another starting.
- [x] The six registrations, plus the `--dock-mode-count` custom property (agreed with
      `decisions-mode`).
- [x] The four tests from
      [§ The test](../project/fleet-dashboard-modes.md#the-test), driven through `SteerApi`'s seam
      rather than a stub of `fetch`; and four that are this tab's own: **a click sends the row's
      `rawQuestion` verbatim**; **it refuses when the row no longer carries a question**; **card
      state does not survive a change of `row.execution.token`**; and **a successful, a `partial` and
      an `unknown` send each leave the controls in the right state**, rather than inviting a retry
      that would append to half-sent text.
- [x] **No prose card renders anything that writes** — the assertion that keeps v1's decision from
      being undone by a later edit that looks harmless.
- [x] `answeringEnabled` in both its `false` and its not-reported readings, drawn as two different
      things.

**Delegated to Codex** (`gpt-5.6-sol`, high, `workspace-write`, 75 minutes — Stage 1's run was killed
at 45), from [the task](260909e-questions-mode-stage2-codex-task.md). Its report is
[here](260909e-questions-mode-stage2-report.md) and the review it ran on itself
[here](260909e-questions-mode-stage2-review-sol.md).

**Status: built, and green on checks this session ran rather than took from the implementer's
claim** — seven suites, 509 tests, and `node --import tsx scripts/typecheck.ts` at `EXIT=0` across
all four projects. Every box above is done. Codex's own GPT Sol pass found one P1 in its first
attempt — a retained dialog item whose current row had lost its `paneId` still drew two enabled
option buttons — reproduced it red, and closed it by requiring current-row addressability and exact
row/target agreement at the action boundary.

**Two defects this session found that neither Codex nor its reviewer did, both in one place, and
both watched red before they were fixed.**

**1. The answering notice spoke for a server that had not spoken.** `App.tsx` defaults
`answeringEnabled` to `ANSWERING_NOT_REPORTED`, which is right — silence must never become `false` —
but that arm's sentence is *this server did not report whether answering works*, and **before the
first payload arrives no server has said anything at all**. So the tab drew *No Questions payload has
arrived yet* and, underneath it, a paragraph attributing a silence to somebody who had not spoken.
That is the same fabrication the default exists to prevent, one level along. The notice is now drawn
only when there is a view, because it explains why cards have no buttons and with no view there are
no cards.

**2. The share-count fix replaced one unchecked register with another.** `--dock-mode-count` removes
the hand-kept `8` from `tailwind.css` — but `var(--dock-mode-count, 8)` has a **fallback**, so if the
property never reaches the element (a refactor to a wrapper, a value React declines to write) the bar
looks exactly as it did while it was wrong. **A fallback that hides its own failure needs a test that
reads the DOM.** There is now one, asserting `.dock-modes`'s inline custom property against
`MODES.length` rather than against a literal, so the next session to add a mode inherits a check that
is still true rather than one that has to be edited. Watched red by removing the `style` prop:
`expected '' to be '9'`.

**Kept from `decisions-mode`'s constraint**: the property is set in the `style` of the **existing**
`.dock-modes` element. No wrapper, no padding, no margin — nothing that contributes width, because
`fit.ts` picks its rung from `scrollWidth` and anything that adds width feeds back into the
measurement.

**One requirement carried forward from Stage 1's code review, and it is not optional.** GPT Sol's
second P1: `questionsAtTime` in `web/src/types.ts` recomputes all three clocks against a supplied
instant and is correct, but its only production caller is the parser. **So a view does not yet go
stale while the page sits open** — the plan requires that, and Stage 1 could not deliver it because
there was no render path to hang it on. When `QuestionsPanel` mounts, derive its prop with
`questionsAtTime(feed.state, now)` on **every render**, off `App.tsx`'s existing ticking clock, and
add a DOM test that **advances time without delivering another payload** and watches the panel leave
`complete`. A selector that is only ever called at parse time is the shape of a check that cannot
fail.

#### Five decisions this session took before writing the task, each with the thing it refused

Written down here rather than discovered in the diff, because four of the five are the kind of
choice that reads as arbitrary afterwards.

**1. The answering-state notice is drawn once at the top, not on every card.** `SessionDetail.tsx`
has `HeldBack`, which is three paragraphs per dialog explaining why the buttons are withheld — right
there, where one dialog fills the screen, and wrong here, where six cards would carry six copies of
one server-wide fact. `answeringEnabled` is a claim about **the server**, so it is stated once,
above the list, and the cards simply have no buttons under it. The per-card sentence that stays
per-card is the server's own refusal (`answering-disabled`, `grants-permission`), because that one
is about *that* send.

**`HeldBack` is deliberately not lifted, imported or copied.** It lives in `SessionDetail.tsx`,
which session `claude-agents-dashboard` is live in; moving it would be an edit outside this file
set, and copying its words would make a third home for a sentence this repo has already had to
de-duplicate twice. The notice here is shorter and says a different thing in a different place —
which is the honest version of *not a second vocabulary*.

**2. The gate cases `HeldBack` exists for cannot arise on this tab.** A `permission` or `unknown`
gate never becomes a `QuestionItem` at all (§ The item arms), so the panel needs no arm for them and
must not grow one — an arm for an impossible state is a branch no test can ever make true, and the
comment on it becomes the only evidence anyone reads.

**3. `QuestionCard` from `SessionParts.tsx` draws the dialog, unchanged.** It already takes
`onAnswer`, `busy` and `sessionName`, already refuses to make buttons out of `unreadable` material,
and already carries the *"a long menu scrolls, so there may be more below"* line. Reusing it is the
house rule and it costs nothing here; a second question renderer would be the *"second way to do the
same thing"* § Prefer simple forbids, and the two would drift on the day one of them learned about a
new `FleetOption` field.

**4. A dialog whose row reference did not resolve is drawn as a stub card, not dropped and not
crashed.** The client resolver already raises `dialog-reference-unresolved` for it, so the gap is
said; the card is still drawn, saying that a session was observed showing a dialog and its row could
not be read on this side. **A gap without a card would be a card silently missing from a list whose
whole promise is that nothing is missing from it** — and the panel must not index into `rows` and
render whatever `find` returned.

**5. Card state is keyed by the item's own id and `row.execution.token`, and a row with no verified
execution keys as `"unverified"`.** `ExecutionReading` has three arms and only `verified` carries a
token; `claimed-only` and `unknown` carry none. The choice is between refusing to hold state on such
a row and holding it under a constant. Holding it under a constant is right and is the smaller
claim: the state being kept is *what the server said about the last tap*, which is discarded on any
change of key — and a row that never has a token simply never invalidates on that axis, which is the
same position every other surface on this page is already in. Refusing would withhold the receipt
from exactly the rows whose sends are most worth reading.

### Stage 4 — closing the independent review

[GPT Sol's independent review](260909e-questions-mode-stage2-review-sol-r2.md) of what actually
landed, run after Codex's own pass because a model reviewing its own diff on a pre-fix state is the
weaker check. **No P0; three P1s and two P2s, every one reproduced rather than reasoned.** The task
is [here](260909e-questions-mode-stage4-codex-task.md).

| ID | The finding | Checked |
|---|---|---|
| QM2-01 | `canAnswer` admits rows the answer route refuses — `no-material`, and non-steerable statuses | **Real, and wider than the review.** `steer.ts § steerableStatus` refuses **four** statuses (`waiting`, `no-claude`, `shell`, `unknown`), so the fix is an allow-list with a `never`, not a block-list of the one case found |
| QM2-02 | The card key carries no question identity, so a new dialog on an unchanged row inherits the old receipt and its dead buttons | Real. This is the **safe** use of the `sameQuestion` fields — a staleness comparison, not the semantic grouping § What round three changed, 3 withdrew |
| QM2-03 | **The browser never checks for OMITTED items.** A payload with a live dialog row and `items: []` kept `complete` through parse, the ticking clock and the renderer, and printed *Nothing needs you.* | Real, and the most important of the five: the plan's own promise is that the client is the final authority on `complete`, and `resolveQuestionReferences` only ever validates items that are **present** |
| QM2-04 | The prose no-write guard checks for controls, not for what the click does — a `steer.message` added to it left all 14 tests green | Real |
| QM2-05 | The answering notice shows on empty and prose-only lists | Real, and its reason is better than mine: on a prose-only list answering happens in Sessions as a **message**, which an answer-hold does not affect, so the banner is misleading rather than merely redundant |

**Two of this session's suspicions were disconfirmed, which is worth as much as the findings.** A
future `waitingSince` is already corrected by `shiftToBrowserClock` in `parseQuestionItem`, so the
clock-skew worry was unfounded; and no duplicate-gap path could be reproduced. Dialogs-first
ordering is held by the server composition test, so a later reversal fails there rather than
silently.

**The merge resolution was checked by the reviewer independently and is correct** — both sides'
registrations, both icons, both React imports, `--dock-mode-count` and the overflow classes all
retained.

#### The dock reading, taken and replicated — 2026-09-09

Both sessions measured on `692fd230` at 390 × 844 coarse, after the fit rung settled. Nine is
`decisions-mode`'s, ten is this session's with their real label on the tenth.

| load | rung | scrollWidth @9 | scrollWidth @10 | clientWidth | active button | Refresh |
|---|---|---|---|---|---|---|
| `#sessions` | `dock-fit-2` | 479 | 519 | 390 | on screen | **off screen** |
| `#deploys` | `dock-fit-2` | 475 | 515 | 390 | on screen | **off screen** |
| `#questions` (last of ten) | `dock-fit-2` | — | 526 | 390 | on screen, flush | **off screen** |

**The prediction held: ~41px predicted, 40px measured, on two loads independently.**

**Why that subtraction is trustworthy, which is not obvious and belongs in the joint draft.**
`scrollWidth` moves with *which tab is active*, because the active button keeps its label under the
fit ladder — an 11px spread here, 9px there. So a delta between two different active tabs would be
one mode's width plus or minus a label, and unreadable. Both subtractions hold the active tab fixed,
so the label cost is identical on each side and cancels. That is why two loads agreeing at 40 is a
replication rather than the same number twice: they sit at different scroll positions and different
bar totals and still agree. **The natural-looking comparison — `#decisions` at nine against
`#questions` at ten — is the one that cannot be done.**

Equal rungs turned out to be the *condition* for the comparison rather than a threat to it: their 41
was derived from `.dock-btn { min-width: 2.5rem }` plus the hairline, so it was always an icon-width
figure, and two fully-compacted bars is exactly the case it was computed for.

**Refresh is off screen at eight, nine and ten, and neither tab caused it.** `readiness-tab` had it
past the edge at eight; `decisions-mode` measured it off screen at the scroll origin at nine; it is
off screen on every load at ten. A pre-existing dock defect both tabs make one notch worse — so Greg
is not being asked to choose between them. Their counterfactual is the strongest number either
session has, and the dock section should lead with it rather than with any table: with the scroll
disabled and the client rebuilt, `#deploys` at nine reads an active right edge of **416 against a 390
viewport**. Tables show a crowded bar; that shows a button that disappears. **The fix trades
Refresh's reachability for the active tab's** — the right trade, and still a trade.

That fact lives in their draft at `45a202f3`, not here.

### Stage 3 — see it, and the queue pointer

- [ ] Browser verify at **1280 × 800** and **390 × 844**, in a Sonnet subagent, against a throwaway
      server on a free port confirmed from its bind line — never `:8787`, whose process is not to be
      touched. Screenshots land in the repo root, are copied out, and are deleted.
- [ ] **The ten-mode dock reading, in the method agreed with `decisions-mode`** — § Where the tab
      goes has the split and the simulated tenth. Their two corrections, both adopted:
      - **Three loads, not one, and the last mode is the worst case.** Their own gating check was a
        direct `#decisions` load, and they found it proves almost nothing: `decisions` sits seventh
        of nine, and the tab furthest from the scroll origin is the one that tests whether
        scroll-into-view works. At ten the order is `sessions … deploys, questions`, so **this tab
        is the worst case** — measured at `#sessions`, `#deploys` (the load both readings share, so
        the two can be checked against each other) and `#questions`.
      - **Read after the fit rung has settled**, never during first paint: the rung changes button
        widths, so a `scrollWidth` sampled early is a different bar. If the two sessions' numbers
        disagree, this is the first thing to check before believing either.
      - **`scrollLeft` beside `scrollWidth` and `clientWidth`.** Those three together are the only
        thing that separates *the bar overflows and we scrolled to the right place* from *the bar
        overflows and the active button is off screen*. **Overflow on its own is expected** and is
        the honest failure mode the dock was built to have; reporting it as a fault would be the
        wrong number.
- [ ] **The shared `#deploys` load's prediction, written down before either session measures.**
      `decisions-mode` proposed the shared load as a cross-check and read a matching pair as *one of
      us sampled before the fit rung settled*. That names one cause for a symptom with at least
      three, and the other two are likelier: **one of us measured a tree with the wrong mode count**
      (which produces identical numbers for the honest reason that it was the same bar twice), or
      **the rung is the same at nine and ten** because both are past the last one, in which case the
      per-mode delta is icon-width rather than glyph-plus-label. So a matching pair says something
      is wrong and not which thing. What makes it diagnostic is the prediction, agreed 2026-09-09
      and binding on both readings:
      - `clientWidth` on `.dock` must be **identical** in both (390 at coarse). If it is not,
        somebody is not at 390 × 844 coarse and nothing else in the two readings is comparable.
      - `scrollWidth` at ten must exceed nine by **one mode's width** — their arithmetic says about
        41px, **and that is the number under test.** A delta near zero means one of us measured the
        wrong tree; a delta far from 41 falsifies the per-mode figure in the joint draft, which is a
        result worth having on its own.
      - The **fit rung** at each, reported as a rung rather than as a description. Equal rungs mean
        the expected delta is icon-width, and that is said rather than the 41 being called wrong.
- [ ] **Which half of that reading depends on `decisions-mode`'s fix, said on the reading itself.**
      Reachability at the last tab is a property of their scroll-into-view, which is on their branch
      and not on `dev`. So the **overflow** half (`scrollWidth` vs `clientWidth`, the fit rung,
      Refresh past the edge, bar height) is taken whenever, and the **reachability** half
      (`scrollLeft`, active button on screen) is taken only against a tree that contains their fix —
      merging their branch locally to measure and reverting, if they have not pushed — with the
      commit named on every number. Otherwise a failing `#questions` load measures the absence of
      their fix and gets reported as a dock finding, which is the shape of wrong number that ends up
      in a question to Greg.
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

- ~~**The dock's shape at ten tabs**~~ — **answered 2026-09-09: a scrolling strip, reusing the
  product's, which is already what the fleet dock is.** § Where the tab goes has his words and the
  evidence that it needs no build. **What came out of it and is still open is a different question**,
  now with Greg via the Overseer: *Refresh is off screen at eight, nine and ten modes, including at
  rest.* The strip answers the crowding; it does not answer that.
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
