# Questions mode: everything that needs Greg's input, answerable in place

Up: [overseer-direction.md](../project/overseer-direction.md) ·
[fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) ·
queue item `qi-25bs5ysg` · session `questions-mode` · worktree `questions-mode`

Status: **plan written, not yet reviewed, nothing built.**

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
| a question he cannot understand | asks for it to be rewritten | **yes** — a canned reply chip (§ The rule) |
| a queued idea awaiting his authority | authorises it | **no** — a link to Queued ideas (§ What v1 leaves out) |

Three of the four finish here. The fourth cannot: the queue refuses writers other than the Overseer
by design, so a button here would be a lie about who may write.

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
settled — but *does this control bind to something mechanical?* The option buttons and the rewrite
chip do; that is why both are on dialog cards only.

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

### The join, which is the one idea in this plan

There are two readings of the same fact and they are **not interchangeable**:

```
  the attention inbox                      the live payload row
  (Overseer, ~2 min old, judged)           (collector, ~73 s old, mechanical)
  ┌──────────────────────────┐             ┌──────────────────────────┐
  │ AttentionItem            │             │ FleetRow                 │
  │  sessionId  ────────────────── join ────── id                     │
  │  waitingSince  (FIRST seen)│            │  question   (live)      │
  │  kind (consequence)       │             │  rawQuestion (opaque)   │
  │  evidence: dialog | prose │             │  paneId, panePid,       │
  │  answerability            │             │  claudeSessionId        │
  └──────────────────────────┘             └──────────────────────────┘
        ↓ supplies                                ↓ supplies
   WHY it matters, HOW LONG                  WHAT MAY BE CLICKED
   it has waited, and the words              and the ADDRESS to click it at
```

**The inbox says why it matters. The row says what may be clicked.** An option button is drawn from
`FleetRow.question` and answered with `steerAnswerBody(row, index)`, which passes `row.rawQuestion`
through untouched — never anything rebuilt from the inbox's copy, which is up to two minutes old and
was reconstructed by a different parser. `steer-client.ts`'s header is emphatic about this and the
reason bites later: the server is adding a field describing *what is actually being approved*, and a
client that re-derived the object would drop it silently.

Consequences, each of which is a rule the code will hold:

- An inbox item whose session has no row in this payload is **not dropped** — it is drawn without
  option buttons and with a line saying the row could not be found. Dropping it would turn a join
  failure into a quiet reduction of the count Greg is reading.
- An inbox item that says `dialog` but whose row carries no live question gets **no buttons**, and
  says so: *the dialog it was parked on is no longer on the pane*. That is the ghost-prompt and
  moved-on case, refused at the surface as well as at the server.
- A row with a live question and **no** inbox item still appears. The inbox is a ~2-minute judgement
  and a dialog that opened forty seconds ago is genuinely waiting; leaving it out would make the
  list's freshness the Overseer's cadence rather than the collector's. It is drawn with
  `kind: "other"` and no waiting-since from the inbox.

### Where the composition happens: the server

Pure function, `tools/fleet/questions.ts`, called from `state.ts`'s `statePayload` beside the
attention feed. The precedent is `QueueRow.ready`/`why`:

> **`ready` and `why` are computed on the SERVER**, and that is not an optimisation. […] a second
> implementation of it in browser TypeScript would be a second answer to *"may this go out?"*

Same argument. *Is this answerable, and is it well-formed?* must have one answer.

**It costs nothing new on the refresh path.** The composition is pure over two things `statePayload`
already has in hand — `deps.snapshot`'s rows and `checkpoint.attention` from the single checkpoint
read. No file is opened, no session is fanned out over, no subprocess is spawned. That is the rule
in [fleet-dashboard-modes.md § Where the panel's data comes from](../project/fleet-dashboard-modes.md#where-the-panels-data-comes-from-the-end-to-end-path)
satisfied by construction rather than by measurement.

The field goes on the wire as a **required** key, per that doc and
`tests/fleet-compile-guards.test.ts`.

### The wire type

One additive end block in `tools/fleet/wire.ts`. Sketch (final wording in Stage 1):

```ts
/** Why we are showing this, and what may be done about it. Named after what was OBSERVED. */
export type QuestionAsk =
  /** A live dialog on the pane right now. Mechanical. `optionCount` is what may be clicked. */
  | { kind: "dialog"; question: string; options: readonly string[] }
  /** The turn ended handing Greg a decision in prose. INFERRED — it may be wrong. */
  | { kind: "prose"; excerpt: string; why: string }
  /** The inbox says a dialog, and the row no longer carries one. NOT a dialog with zero options. */
  | { kind: "dialog-gone"; question: string; why: string }
  /** We have an item and cannot say what it is asking. Never rendered as an empty question. */
  | { kind: "unreadable"; why: string };

/** Whether the option buttons may be drawn, and if not, whose refusal it is. */
export type QuestionAnswerHere =
  | { kind: "options"; count: number }
  | { kind: "words-only"; why: string }
  | { kind: "not-addressable"; why: string };

export type QuestionItem = {
  /** Stable across snapshots, so a card cannot move under a finger. */
  id: string;
  sessionId: string;
  sessionName: string;
  /** From the inbox when there is one. `null` means we only know it is waiting NOW. */
  waitingSince: string | null;
  /** What the work is for — the session's description, or the plan it names. */
  about: string | null;
  kind: AttentionKind;
  ask: QuestionAsk;
  answerHere: QuestionAnswerHere;
};

export type QuestionsView =
  | { kind: "list"; items: readonly QuestionItem[]; /* …the inbox's positive controls… */ }
  | { kind: "inbox-unavailable"; why: string; rowsOnly: readonly QuestionItem[] }
  | { kind: "not-asked" };
```

Four things about that shape are the point of it, and each is an honest arm the brief asked for:

- **`dialog-gone` is a separate arm from `dialog` with no options.** `types.ts` already refuses a
  `dialog` with an empty question or empty options at the parse boundary, for exactly this reason:
  *"A `dialog` with no question and no options must not cross into the renderer wearing the first
  arm's name."* This arm is where such an item goes instead of vanishing.
- **`answerHere` is separate from `ask`.** *We know what it is asking* and *you may click it from
  here* are two facts, and the second can be false for reasons that have nothing to do with the
  first — a row with no `paneId`, no `claudeSessionId`, or a permission-class gate. Merging them
  would make "no buttons" indistinguishable from "no question".
- **`inbox-unavailable` still carries `rowsOnly`.** When the Overseer's judgement is missing, live
  dialogs are still observable facts and are still shown — with the list saying plainly that the
  ranking and the prose items are missing. A total blank would be the worst outcome of the
  Overseer's own outage.
- **`waitingSince: null` is expressible.** A row-only item genuinely does not know when it started
  waiting, and inventing "now" would draw a fresh-looking card over an unknown age.

### The rule: enforcement is one tap, not a machine's verdict

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

**What is built instead.** The rule is enforced at the surface, in one tap, by the only judge whose
verdict is correct by definition — Greg, after he has failed to understand the menu. Every **dialog**
card carries a canned reply chip, *"Rewrite this so I can choose"*, which sends the AGENTS.md
sentence to that session **as the Overseer** (`speaker: "overseer"`, the existing prefix) — not as
Greg, because nobody may mint his authority for a sentence he did not write, which is A12.

Its value over typing the same thing is real and small, and worth being honest about: one tap on a
phone, and it sends the canonical wording rather than whatever "explain it properly" comes out of
dictation. Its cost is one chip — **no wire arm, no threshold, no new state, and no false-positive
loop.** The `QuestionRule` type this plan's first draft proposed is deleted rather than defaulted.

**The chip is on dialog cards only in v1.** `AttentionPanel`'s agreement (a) exists because a prose
card may quote Greg's own sentence back at him, and a chip on such a card could tell a session to
rewrite a question it never asked. Dialog evidence is mechanical; prose evidence is inferred. It
moves to prose cards once answering-in-place on prose has been used for a while and that bug has
stayed dead.

**And the words *"not yet answerable"* are dropped from the design**, Fable's point and a good one:
the item *is* answerable — Greg may perfectly well understand a three-word menu whose context he set
five minutes ago. *Not answerable* is a claim about him, and this page does not get to make it.

#### If this is overruled

Recorded here so a reviewer can overrule it cheaply rather than by re-deriving it. The **only**
defensible detector is one that reports an *absence in the captured screen* rather than a length: the
dialog is an agent's own question (`AGENT_QUESTION_HEADER` — `pane.ts` already tests this and calls
the gate `conversation`), it has ≥2 options, **and** the captured lines above the widget contain no
agent prose at all. That arm is named `no-explanation-on-screen` — never `bare-menu` or
`falls-short` — because it says what was seen and cannot say the agent gave none. It is never run on
prose items: a judgement stacked on an inference is where the *quoted Greg back at himself* bug came
from.

### No badge, in either direction

This survives the detector's removal and is worth stating as its own rule, because it is what the
card must not grow later. **There is no "✓ meets the rule" marker and no "not judged" caveat.** The
first would be a fabricated positive — `AttentionList`'s comment, *"a positive control proves the
step it wraps and nothing above it"* — and the second is the permanent caveat that
`sessionsUnreadable` is deliberately rendered only when non-zero, because a caveat on every card is
read as noise within a day. That is A17, healthy operation spending most of its time alarming.

### What v1 leaves out, named rather than discovered later

- **Queue rows waiting on Greg.** `QueueItemWait`'s `needs-greg` arm is genuinely "needed from me",
  and it is **not answerable here**: `overseer-queue.ts` refuses writers other than the Overseer by
  design, so any control on this card would be a lie about who may write. Stage 3 adds a
  **pointer with a real count**, fetched through the seam the Queued ideas tab already has
  (`queue-client.ts`) on entering the tab — an on-demand read, not a new field on the refresh path.
  If Stage 3 runs out of budget this is the thing that is dropped, and the tab ships without it
  rather than with a countless link, because a pointer that cannot say whether anything is behind it
  fails Greg's own question.
- **Answering several sessions at once.** `AttentionItem.duplicates` exists and *answer once, apply
  to all* is a real want. It is a fan-out write, it is the shape that goes wrong at scale, and it is
  not what was asked for. Named here so it is a decision rather than an omission.
- **Editing the ranking.** The producer sorts and this must not re-sort —
  `AttentionPanel`'s agreement (b), which is not superseded.

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

- [ ] `wire.ts`: one additive end block, the types above, each arm's comment saying what was
      *observed*.
- [ ] `tools/fleet/questions.ts`: `composeQuestions(rows, attentionFeed) → QuestionsView`, pure, no
      I/O, no clock beyond one injected `now`.
- [ ] Wired into `state.ts` beside `attention`, off the **same single checkpoint read**.
- [ ] `web/src/types.ts`: the client's parser and its own fifth arm for *this payload's field was
      present and unreadable*.
- [ ] Tests, each **watched red first**: the join in both directions; `dialog-gone`; a row with no
      inbox item; an inbox item with no row; every silence arm; the detector's flag and its silence;
      and the composition asserted through the same `statePayload` composition `server.ts` calls,
      never a graph the test rebuilds.

**Delegated to Codex** (`gpt-5.6-sol`, `--sandbox workspace-write`). Status: *not started.*

### Stage 2 — the panel, the answering, and the registrations

- [ ] `QuestionsPanel.tsx`, modelled on `MessageOverseerCard.tsx`: per item, who is asking, how long
      it has waited, what the work is for, then the question; option buttons where `answerHere` is
      `options`; a text box with `DictationControl` on every item; `SteerReceipt` for the outcome.
- [ ] The submit rule at the action boundary, not only on the button: `dictate.sendBlocked` guards
      the send, or Enter mid-sentence sends the rough live guesses (or, on Safari and Firefox,
      nothing that was said).
- [ ] The *"Rewrite this so I can choose"* chip, `speaker: "overseer"`, **on dialog cards only**.
- [ ] The six registrations, plus the custom-property fix if agreed.
- [ ] The four tests from
      [§ The test](../project/fleet-dashboard-modes.md#the-test), driven through `SteerApi`'s seam
      rather than a stub of `fetch`; and one more that is this tab's own: **a click on an option
      sends the row's `rawQuestion`, verbatim, and refuses when the row no longer carries one.**

**Delegated to Codex.** Status: *not started.*

### Stage 3 — see it, and the queue pointer

- [ ] Browser verify at **1280 × 800** and **390 × 844**, in a Sonnet subagent, against a throwaway
      server on a free port confirmed from its bind line — never `:8787`, whose process is not to be
      touched. Screenshots land in the repo root, are copied out, and are deleted.
- [ ] **The screenshots are looked at by this session, not only reported on.** Delegated
      descriptions of a layout are wrong often enough to distrust on their own.
- [ ] Every state from § 3 above forced and looked at individually — including each silence.
- [ ] The queue pointer with a real count, through `queue-client.ts`'s seam. **Droppable**; if
      dropped, said so in the debrief.
- [ ] `docs/project/` — a line under the entry point that owns it, and this plan kept matching the
      code.

Status: *not started.*

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
- **GPT Sol** reviews this plan before Stage 1, and the built code at the end of every stage.

## Open, and going to Greg rather than being decided here

- **The dock's shape at ten tabs** — joint with `decisions-mode`, drafted by them (§ Where the tab
  goes).
- Nothing else yet. Anything that outlives this branch and turns up during the stages is added here
  and carried in the debrief as *needs Greg*, per the brief.
