# Questions mode: everything that needs Greg's input, answerable in place

Up: [overseer-direction.md](../project/overseer-direction.md) ·
[fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) ·
queue item `qi-25bs5ysg` · session `questions-mode` · worktree `questions-mode`

Status: **plan revised after GPT Sol's round-one review returned *not fit to build*; round two
pending; nothing built.** § What the review changed.

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

**This section was rewritten after GPT Sol's plan review returned *not fit to build*.** What it
found is recorded in § What the review changed, and every claim here is traceable to one of its
numbers.

### What can actually be answered, and where — the constraint everything else follows from

The plan's first draft offered a text box on every card and a canned "rewrite this" chip on dialog
cards. **Neither can work, and the reason is one function.** `sendMessage` in
[`steer.ts`](../../tools/fleet/steer.ts) reads the screen and refuses:

```
case "dialog":
  return no("pane-is-asking",
    `pane ${target.paneId} is asking a question, and a message typed at one would answer it`);
```

`empty-input` is the only surface it proceeds on. So **free text cannot reach a session while a
dialog is open** — which is exactly when a dialog card is on screen. Verified in the source, and
verified again downstream: `queue.ts` grades a dialog-parked session `later` rather than `never`, so
a *queued* message drains only once the dialog is gone. There is no path, immediate or deferred, by
which words reach a session parked on a menu.

That is not a limitation to work around. It is the machine telling us the truth about the two cases,
and the design becomes narrower and better for taking it:

| Card | Pane is at | Controls | Route |
|---|---|---|---|
| **dialog** | a conversation-gate dialog | **one button per option** | `POST /api/steer/answer` |
| **prose** | an empty input box | **a text box and a microphone** | `POST /api/steer/message` |

Which maps exactly onto what Greg asked for — *"if they're multiple choice, let me click, but also
type and use voice dictation"* — with the two halves landing on the two kinds of card rather than
both on every card. `answerHere` as a separate axis is deleted: **the capability lives inside the
arm**, so *prose + option buttons* and *dialog + text box* are states the compiler refuses rather
than states a renderer has to avoid (Sol P1-2).

### The join, which is the one idea in this plan

Two observations of the same session, and the first draft joined them on `sessionId` alone. Sol's
P0-1 is that this **attaches one question's age and consequence to another question's buttons** —
the inbox may hold dialog A while the row holds dialog B, and the answer route's `sameQuestion`
proves only that B is still on the pane when clicked, never that the ranking belonged to B.

**The identity to join on already exists and is already on the wire.** `AttentionItem.id` is
`group.key`, and the producer says so in a comment: *"The id is the QUESTION's, not the session's."*
For a dialog it is `dialogFingerprint(q)` — `dialog:${q.material.fingerprint}` where the material was
read, else a base64 of the prompt and the option labels. And `material.fingerprint` is minted by
[`pane.ts`](../../tools/fleet/pane.ts), which is **this side of the fence**: the producer is
fingerprinting with our parser's output, so re-deriving the same string in `tools/fleet/` is four
lines over inputs we already own.

```
  the attention inbox                        the collected row
  scannedAt (~2 min)                         collectedAt (~73 s)
  ┌─────────────────────────┐                ┌─────────────────────────┐
  │ AttentionItem           │                │ FleetRow                │
  │  id  = dialog:<fp>  ────────┐   ┌────────── question.material.fp   │
  │  waitingSince           │   │   │        │  rawQuestion (opaque)   │
  │  kind (consequence)     │   ▼   ▼        │  paneId, panePid,       │
  │  duplicates             │  same fp?      │  claudeSessionId        │
  └─────────────────────────┘   │   │        └─────────────────────────┘
                          yes ──┘   └── no
                           │             │
                  matched-dialog   observations-disagree
             (ranked AND clickable)  (drawn, never merged)
```

**Drift here fails safe, which is what makes the second implementation acceptable** — normally this
repo's answer to a second reader is *it will drift and a fixture cannot tell you it has*
([fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md#ask-this-before-you-design-the-panel-may-the-fleet-touch-what-your-tab-is-about)).
Here a disagreement between the two fingerprint implementations produces `observations-disagree`,
which withholds the ranking and keeps the buttons bound to the live row. Drift makes this tab more
conservative, never less. The test is nevertheless the strong one that section demands: **import the
producer's `dialogFingerprint` in the test** — legal, since `fleet-imports.test.ts` walks the graph
rooted at `tools/`, not at `tests/` — and assert the two agree over the real fixture panes, so the
day they part is the day a test goes red.

**Neither clock is assumed newer.** The first draft called the row "live" and the inbox "~2 minutes
old", and Sol is right that this is not guaranteed: `scannedAt` and `collectedAt` fail independently,
and either can lead. So both are carried, both are drawn, and **`dialog-gone` is not inferred from
the row's silence** — that arm is deleted. An inbox dialog with no matching row question is
`observations-disagree` when the row observation is newer, and *"the inbox saw this after our last
collection"* when it is not.

### The item arms

One arm per kind of item, each carrying only what it can support (Sol P1-2). Final wording in
Stage 1; the shape is settled:

- **`matched-dialog`** — the inbox and the row agree by fingerprint. Ranked, aged, and **clickable**:
  one button per option, answered with `steerAnswerBody(row, index)`, which passes `row.rawQuestion`
  through untouched. Carries the **material** as well as the prompt and options — Sol P1-2, and it is
  the finding with the sharpest edge, because `sameMaterial` refuses an `unreadable` material against
  *anything, including another unreadable*, so an item whose material could not be read is one whose
  buttons are guaranteed to be refused. Such an item is drawn **without buttons and with the reason**,
  rather than with controls that cannot work.
- **`row-dialog`** — a dialog on the pane that the inbox has not ranked. **Admitted only when
  `question.gate.kind === "conversation"`** (Sol P1-3, and it is the one that would have shipped a
  real defect): the producer *deliberately* excludes permission-class dialogs — `grantsPermission` in
  `attention-pass.ts` counts them into `permissionDialogs` and makes no item — because
  [a permission dialog is a launcher regression, not a question for Greg](../project/overseer.md).
  The first draft would have published every one of them into "needed from me" wearing a fabricated
  `kind: "other"`. **No `AttentionKind` is ever synthesised**; unranked is its own state.
- **`attention-prose`** — the inbox's inferred prose item, with the row at an empty input box. Words
  only. The excerpt is drawn **above** the box, at full size, because it is the thing Greg must check
  before he answers.
- **`observations-disagree`** — both sides have something and they are not the same thing. Drawn,
  never merged, never silently resolved to one side. Both observations and both clocks on the card.
- **`attention-item-without-row`** — the inbox has an item and no row in this payload carries it.
  Drawn without controls. Never dropped: a join failure must not quietly reduce the count Greg reads.

**Duplicates are kept** (Sol P1-4). `AttentionItem.duplicates` is other sessions parked on the same
question, and dropping the field would hide blocked sessions. **One grouped card listing every
waiting session**, with the controls targeting the named primary explicitly — *"Answering sends to
`fb2p-quotes`; three other sessions are waiting on the same question."* Fan-out answering stays out
of v1, but the sessions are visible, which is the part that was going to be lost.

**Card state is keyed by session identity plus question identity, never by `AttentionItem.id`**
(Sol P0-2, second half). That id is the *group's*, and the primary session changes when the previous
primary disappears — so a draft begun for session A could stay mounted while the card starts
targeting session B, and the server would verify B and return a green receipt. Any change to either
identity discards the draft and the receipt rather than carrying them across.

### Answering a prose item: what is guarded, and what is accepted

Sol's P0-2 is that the prose text box still violates `AttentionPanel`'s agreement (a): the free-text
send binds to a *destination row*, not to the *excerpt that caused the card to exist*, and nothing
verifies that an agent asked anything at all. **This is partially accepted and partially overruled,
and the disagreement goes to the Overseer rather than past it** (the brief's rule for an overruled
P0).

**Accepted, and built:**

- The draft-keying fix above, which is a real defect and was going to ship.
- A **local staleness refusal**: the card will not send if the row's status is no longer the one the
  item was composed against. A session that has started working, or opened a dialog, since the card
  was drawn is one whose prose question is no longer on screen — and that is checkable from the
  payload, without a route change.
- The excerpt drawn at full size above the box, so the premise is on screen with the control.

**Overruled, with the reason stated:** Sol's remedy is either read-only prose cards or a new guarded
prose-answer operation that re-captures and compares a tail fingerprint at send time. Read-only prose
guts the feature — prose is *ten of the fifteen* genuinely-waiting sessions measured on 2026-09-08,
and *"let me type and use voice dictation"* is half of what Greg asked for. The guarded operation is
the right long-term answer and is **not this session's to build**: it is a new write path in
`steer.ts` and `routes-steer.ts`, which the brief puts outside this file set.

The residual risk, stated plainly rather than argued away: **if the classifier presents Greg's own
words back as an agent's question, this card invites him to reply to nobody.** What that costs is one
confusing user turn in an agent's context and one of Greg's answers — recoverable, visible, and not
in the same class as answering a permission dialog, which remains impossible here by construction.
What would close it is the tail-fingerprint guard, and it is carried in the debrief as work this
session identified and did not own.

### Where the composition happens: the server

Pure function, `tools/fleet/questions.ts`, called from `state.ts`'s `statePayload` beside the
attention feed, off the **same single checkpoint read**. The precedent is `QueueRow.ready`/`why`:

> **`ready` and `why` are computed on the SERVER**, and that is not an optimisation. […] a second
> implementation of it in browser TypeScript would be a second answer to *"may this go out?"*

**It is I/O-free but it is not free**, which the first draft got wrong and Sol measured (P2-1). It
adds no capture, subprocess, file read or model call — but a pushed field would duplicate data
already on the payload, and prose evidence is capped at 4,000 characters, so twenty prose items is on
the order of **80 KB before JSON overhead, every cycle, to every reader**. Not a problem at ~20
sessions; not "nothing" either. So:

- the composition publishes **a reconciliation, not a copy**: source references, the match or
  conflict decision, and the clocks — with the panel rendering the `attention` and row records that
  are already on the payload beside it;
- and Stage 1 adds a **payload-size regression fixture**, so the day this stops being cheap is a day
  a test says so rather than a day a phone gets slow.

### What the empty list has to prove before it may reassure

Sol's P0-3, and it is the finding that most changes the type. The first draft's `list` arm could
render `items: []` as *nothing needs you* without establishing any of: that a collection completed,
that no rows were dropped, that the snapshot is fresh, that the checkpoint and the scan are fresh,
that the scan judged every session, or that the client parsed the new field at all.

```ts
export type QuestionsView =
  /** Every source was observed and complete. THE ONLY ARM THAT MAY SAY "nothing needs you". */
  | { kind: "complete"; items: readonly QuestionItem[]; observed: QuestionsObserved }
  /** Some items, and a non-empty list of what we could not establish. */
  | { kind: "partial"; items: readonly QuestionItem[]; gaps: readonly [QuestionGap, ...QuestionGap[]] }
  /** Nothing was observed. Never an empty list. */
  | { kind: "not-observed"; cause: QuestionsNotObserved };
```

`gaps` is a non-empty tuple, so `partial` cannot be constructed without saying what is missing, and
each gap keeps its **exact** cause rather than being folded into one word: checkpoint absent,
checkpoint unreadable, list `unknown`, the client's own field unreadable, rows never collected, rows
dropped, source stale. `inbox-unavailable` and `rowsOnly` are gone — Sol's point that `rowsOnly`
"gives the shape of a complete answer" is right, and the replacement is a `partial` whose copy says
what it is: *"Live-dialog observations only — prose questions and ranking are unavailable."*

### What v1 leaves out

- **Fan-out answering** across `duplicates`. The sessions are shown; answering targets one.
- **The rewrite chip.** § The rule.
- Nothing else. **The queue pointer is no longer droppable** — § The rule's last paragraph.

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

- [ ] `wire.ts`: one additive end block — `QuestionItem`'s five arms, `QuestionsView`'s three, the
      gap and observed vocabularies. Every arm's name and comment says what was **observed**.
- [ ] `tools/fleet/questions.ts`: `composeQuestions(rows, attentionFeed, collectedAt) →
      QuestionsView`, pure, no I/O, no clock beyond one injected `now`. Includes the re-derived
      dialog fingerprint.
- [ ] Wired into `state.ts` beside `attention`, off the **same single checkpoint read**.
- [ ] `web/src/types.ts`: the client's parser, and its own arm for *this payload's field was present
      and unreadable* — which is a `gap`, not a silence.
- [ ] A **payload-size regression fixture** (Sol P2-1).

Tests, each **watched red first**. Sol's P2-2 is that the first draft's list omitted every dangerous
case, so it is replaced by his rather than extended:

- [ ] dialog A in the inbox against dialog B on the row → `observations-disagree`, never a merge;
- [ ] prose in the inbox against a dialog on the row, and the reverse;
- [ ] **either source newer**, both ways round, with `dialog-gone` never inferred;
- [ ] a **permission**-gate and an **unknown**-gate row-only question → admitted by neither, and a
      malformed gate likewise;
- [ ] material `unreadable` → drawn without buttons, with the reason;
- [ ] an inbox item with no row; a row with no inbox item;
- [ ] every `gap` cause, and `not-observed`; and **a genuinely empty but partial observation**, which
      must not say *nothing needs you*;
- [ ] the two fingerprint implementations agreed field by field against the real fixture panes, by
      importing the producer's `dialogFingerprint` in the test;
- [ ] the composition asserted through the same `statePayload` composition `server.ts` calls, never
      a graph the test rebuilds.

**Delegated to Codex** (`gpt-5.6-sol`, `--sandbox workspace-write`). Status: *not started.*

### Stage 2 — the panel, the answering, and the registrations

- [ ] `QuestionsPanel.tsx`, modelled on `MessageOverseerCard.tsx`: per item, who is asking, how long
      it has waited, what the work is for, then the question; option buttons on a `matched-dialog`
      or a `row-dialog`; a text box with `DictationControl` on an `attention-prose`; `SteerReceipt`
      for the outcome. One arm per item kind, with a `never` default.
- [ ] The submit rule at the action boundary, not only on the button: `dictate.sendBlocked` guards
      the send, or Enter mid-sentence sends the rough live guesses (or, on Safari and Firefox,
      nothing that was said).
- [ ] Card state keyed by **session identity plus question identity**, never `AttentionItem.id`,
      and discarded when either changes (Sol P0-2).
- [ ] The **local staleness refusal** on prose cards: no send once the row's status has moved off the
      one the item was composed against.
- [ ] The six registrations, plus the custom-property fix if agreed.
- [ ] The four tests from
      [§ The test](../project/fleet-dashboard-modes.md#the-test), driven through `SteerApi`'s seam
      rather than a stub of `fetch`; and three that are this tab's own: **a click on an option sends
      the row's `rawQuestion` verbatim and refuses when the row no longer carries one**; **a draft
      does not survive a change of primary session**; and **a successful, a `partial` and an
      `unknown` send each leave the card's controls in the right state** rather than inviting a
      retry that would append to half-sent text.
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

## What the review changed

GPT Sol reviewed the first draft on 2026-09-09 and returned **not fit to build** —
[`260909e-questions-mode-plan-review-sol-r1.md`](260909e-questions-mode-plan-review-sol-r1.md).
The verdict was right and the plan above is the revision. Every finding was checked in the source
rather than accepted on the review's word, per
[an unchecked brief claim becomes a source comment](../reusable/silent-success.md); the three that
changed the design most were each confirmed, and one was found to be understated.

| # | The finding | Checked | Outcome |
|---|---|---|---|
| P0-1 | Joining on `sessionId` attaches one question's ranking to another's buttons; and neither clock is guaranteed newer | `steer.ts` § `sameQuestion`; `attention.ts:268` | **Accepted.** Join on the question fingerprint, which was already on the wire as `AttentionItem.id`; `dialog-gone` deleted |
| P0-2 | Prose free text binds to a row, not to the excerpt; and card state keyed by the grouped `AttentionItem.id` can target the wrong session | `attention.ts:257` | **Split.** Draft-keying accepted and fixed; read-only prose overruled — § Answering a prose item |
| P0-3 | `items: []` could reassure without establishing anything | — | **Accepted.** `complete` / `partial` / `not-observed`, with a non-empty `gaps` tuple |
| P1-1 | The text box and the rewrite chip cannot be sent while a dialog is open | `steer.ts:1351`, `queue.ts:222` | **Accepted, and understated.** Also true of a *queued* copy, so there is no deferred path either — § The chip cannot be built |
| P1-2 | `ask` × `answerHere` is an invalid Cartesian product; the dialog arm omits `material` | `web/src/types.ts:137`, `steer.ts` § `sameMaterial` | **Accepted.** One arm per item kind, capability inside the arm, material carried |
| P1-3 | A row question with no inbox item may be a *deliberately excluded* permission dialog | `attention-pass.ts:163` | **Accepted.** This would have shipped a real defect: permission dialogs republished into "needed from me" wearing a fabricated `kind` |
| P1-4 | `duplicates` dropped, hiding other blocked sessions | — | **Accepted.** One grouped card listing every waiting session |
| P1-5 | A droppable queue pointer makes the tab's promise knowingly false | — | **Accepted.** Acceptance-critical |
| P2-1 | "Costs nothing" is false — ~80 KB of duplicated prose per cycle | `state.ts:175` | **Accepted.** Publish a reconciliation rather than a copy, plus a size fixture |
| P2-2 | The test list contradicted the detector decision and missed every dangerous case | — | **Accepted.** Stage 1's list replaced with Sol's |

Sol independently agreed that **dropping the automatic rule detector is correct**, having read
`dialogText()` itself. That is the one place where two models and one human reading of the source
converged, and it is the decision this plan was least sure of going in.

### The one finding this plan overrules

**P0-2's remedy, not its diagnosis.** Sol would make prose cards read-only, or gate them behind a new
tail-fingerprint operation. The diagnosis is accepted in full and three of its consequences are
built; the remedy is refused because read-only prose removes half of what Greg asked for and *ten of
the fifteen* genuinely-waiting sessions, and because the guarded operation is a `steer.ts` write path
outside this session's file set. The reasoning, the residual risk and what would close it are in
§ Answering a prose item, and the disagreement goes to the Overseer in the debrief rather than past
it — the brief's rule for an overruled P0.
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
- **GPT Sol**, round one, 2026-09-09 —
  [`260909e-questions-mode-plan-review-sol-r1.md`](260909e-questions-mode-plan-review-sol-r1.md).
  Verdict *not fit to build*; § What the review changed. Round two follows this revision, and
  the built code goes back at the end of every stage.

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
