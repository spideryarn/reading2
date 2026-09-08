# Prose needs an empty input box, not merely a box

**Status as of 2026-09-08: built, reviewed and merged to dev.** The defect below was reproduced end to end against a
throwaway session of my own, and against two pinned fixtures that had been in the corpus since
before the bug was known — one of which the suite explicitly asserted as a screen we should send to. Evidence is in
[§ The measurement](#the-measurement); the fixture is
`tests/fixtures/fleet-panes/none-typed-numbered-message-in-input-box.txt`.

This is Astra's **A10** in
[overseer-direction.md § The backlog](../project/overseer-direction.md#the-backlog-after-the-wide-review),
and it is the half of A10 that Stage v0.2e did not cover. It gets its own doc rather than a fifth
`### Stage` in [260907e](260907e-agent-fleet-dashboard.md) because two agents are editing that file
today; a one-line stage entry there points here.

## Goal

**Sending prose into somebody else's agent session must stop being established by absence.**

Today `sendMessage` in [`tools/fleet/steer.ts`](../../tools/fleet/steer.ts) concludes that a pane
will accept a typed message from three facts: `parsePane` did not recognise a dialog, there is a `❯`
on the screen, and it has a box border above it and another within four lines below. Two of those
are positive and one is an absence — and none of them reads what is *in* the box.

So the page offers **Send** on a session that has a half-typed message sitting in its input box, and
tmux appends ours to theirs and presses Enter on the concatenation. The agent receives one user turn
that neither person wrote.

Astra's sentence for it:

> A live Claude descendant does not prove an **empty input box owns the keystrokes** — the text may
> append to a draft, hit a modal, or reach a foreground program. Make arbitrary prose a narrower
> capability than answering a recognised dialog.
>
> — GPT 6 Astra, 2026-09-08

Of those three, **the draft is the one that is happening now**; the modal is largely covered by
`parsePane`; and the foreground program is the one this doc got wrong twice and settled at
[§ What we are not building](#what-we-are-not-building) — not closable by anything the kernel or
tmux will tell us, and not by the application's own status field either — that guard was built and
removed the same day, on a premise read out of the Claude Code binary.

## The measurement

Taken 2026-09-08 with `tmux capture-pane -p`, read-only, across every pane on the box. Seventeen
held a Claude session with a `❯` on screen. **Thirteen were empty. Four were not, and three of those
were live drafts between the input box's two borders:**

```
%218   ❯ yes, shut it all down                 (code/hellozenno, auto mode on)
%2082  ❯ push it to dev once both are green    (worktree-command-bar-commands-and-place)
%351   ❯ send those two messages for me        (code/spideryarn2)
```

Each of those three returns `{ ok: true }` from `inputSurface` today. A Send of `check the tests` to
`%218` types `check the tests` immediately after `down`, and the second `send-keys` submits
**`yes, shut it all downcheck the tests`** to an agent running in auto mode.

### This is A9's bug arriving through the prose door

The reading that matters, and it is not the one this doc started with:

> `%218` is sitting on "yes, shut it all down" in a session running in auto mode. A Send to it
> concatenates and our Enter submits, so the dashboard would deliver an approval nobody wrote — the
> words are Greg's, the intent is Greg's, and the submission is ours, minutes or hours later,
> against whatever question is on screen by then. That is not "prose lands in the wrong place"; it
> is the approval-binding bug of v0.2b arriving through the prose door instead of the dialog door.
>
> — `claude-agents-dashboard`, 2026-09-08

Greg typed those words at some point, at a terminal, meaning them about something. He did not press
Enter. **Our Enter is the act**, and it happens at a moment we choose against a screen we have not
read, which is precisely what A9 spent a day making impossible on the dialog path: an approval bound
to a sentence rather than to the material it is about. The two doors are the same bug, and the
narrowing below is the same fix — the act must bind to what is actually on the screen now.

That also settles a design question the next section would otherwise have to argue: the draft is not
noise to be worked around, it is somebody's unfinished decision, and appending to it is not a
delivery failure but an authorship one.

### Reproduced live, end to end, against a session of my own

The survey above says `inputSurface` *accepts* those panes. It does not say what a send would do, and
those are different claims — a check that answers the weaker question is how this repo has spent
most of its recent bad days. So it was done properly, on a throwaway session created for it
(`ab-dummy-target`, `%2433`) and never on another agent's:

```
draft typed into the box, not submitted:   ❯ DRAFT-ALPHA
sendMessage(target, "OMEGA-SENT-BY-DASHBOARD", …)  →  { ok: true, verified: {…}, sent: [2 calls] }
the box, immediately after:                ❯ DRAFT-ALPHAOMEGA-SENT-BY-DASHBOARD
```

and four seconds later the agent had answered it:

> ● I don't have anything that defines DRAFT-ALPHAOMEGA-SENT-BY-DASHBOARD — it's not a command …
> What would you like me to do with it?

**The dashboard returned a green tick for a user turn neither half of which anybody wrote.** That is
the defect, not an inference about it.

### The placeholder, which nearly broke the fix

A session that has **never been messaged** draws a greyed hint in its box — `❯ Try "fix lint
errors"` — which an emptiness rule reads as a draft. Found by creating the dummy session above,
which is the only reason it was found at all: every one of the seventeen live panes had been used,
so the survey could not have shown it.

Three things were measured before choosing what to do:

- **The hint is dim (SGR 2) and typed text is not** — on a freshly created session. So colour looked
  like the structural answer.
- **It is not.** `%218`'s eleven-hour-old `yes, shut it all down` is *also* dim, and so is `%2082`'s,
  while text sent into my own dummy stayed bright. Dim does not mean "hint": it appears to follow
  the pane's focus rather than the text's authorship, and a rule built on it would call a real draft
  a hint — the one direction that costs a send. **Colour is abandoned**, and with it the `-e`
  capture and the fixtures it would have needed.
- **The hint never comes back.** After the session's first turn the empty box is bare `❯` forever,
  on every capture taken. So the state that would be wrongly refused is exactly *a session that has
  never been messaged at all*.

**The decision, and it is a product decision rather than an engineering one.** Refuse any box with
anything in it, hint included, and take the cost — which is that the very first message to a
never-used session cannot be sent from the phone. That cost is close to zero in practice, because
the dashboard's own New Session flow **requires** a prompt (`routes-new.ts`: *"Only `prompt` is
required"*), so a session it created has already taken a turn by the time anyone would steer it;
only a session made by `gjd-remote new-claude` with no `-p` is affected. The alternative was to
recognise the hint by its wording, which is matching on one build's marketing copy inside the guard
that decides whether to type into somebody's terminal. **Taking the small product loss removes all
of the hard engineering**, which is the trade this project asks to be offered rather than to inherit
(vision.md § Simpler first). The refusal names the case, so a person who meets it is not left
puzzling over an empty-looking box.

Two things the survey settles that reasoning would not have:

- **The feature survives the fix.** Thirteen of seventeen were empty, so requiring emptiness costs
  availability on roughly a quarter of panes at any instant, and that quarter is exactly the quarter
  where sending is wrong.
- **A USED Claude Code input box, once empty, is bare.** The prompt line is `❯` followed by a single
  U+00A0 and nothing else, on every one of the thirteen and on both empty-box fixtures. That is not
  true of a session which has never been messaged — see the placeholder section above, which is the
  thing this survey could not have found and a throwaway session did.

**And one thing it does not settle.** Whether `%218`, `%2082` and `%351` hold genuine unsent drafts
is an inference, not a measurement: `%218`'s text answers, word for word, the question its agent
asked at 2:11 AM, which is what an unsent reply looks like. But a hint and a draft are
indistinguishable in a capture, so the honest claim is the one proved on `%2433` — **a send onto
text in the box concatenates and submits** — and the three panes are evidence that the state is
common rather than proof of what any one of them holds. The fix does not depend on the difference.

`none-typed-numbered-message-in-input-box.txt` reproduces it with no tmux: it is a pane with a
three-line draft in the box, and `inputSurface` returns `ok` at line 20. That fixture was added for
an unrelated reason — to prove a numbered list *typed by a person* is not a dialog — and it has been
quietly documenting this defect ever since.

### Why it stayed invisible

`INPUT_BOX_LINES = 4` means a draft of five or more visual lines already pushes the closing border
out of the window, and `inputSurface` refuses it as "no box border within 4 lines below". So the
long drafts — the ones somebody would notice — were refused for an unrelated reason, and only the
short ones got through. The guard that made this rare is not a guard against this.

## References

- [`tools/fleet/steer.ts`](../../tools/fleet/steer.ts) — `inputSurface`, whose own comment already
  names this ("**A box with a draft in it is still a box** … That is a real defect and it is not
  this function's — it wants a product decision about what to do, not a tighter predicate"). This
  doc is that product decision. Also `sendMessage`, `answerQuestion`, `SteerResult`, `RefusalCode`.
- [`tools/fleet/pane.ts`](../../tools/fleet/pane.ts) — `parsePane`, `cleanLines`, `isInputPrompt`,
  `PaneQuestion`, `PaneMaterial`, `PaneGate`. The parser, and where the new type belongs.
- [260907e § Stage v0.2e](260907e-agent-fleet-dashboard.md) — the *dialog* half of A10, landed. Read
  it before touching `PaneGate`: `conversation` is the only arm reached by positive evidence and
  `unknown` is refused alongside `permission` on purpose. **Nothing here changes it.**
- [260907e § Stage v0.2b](260907e-agent-fleet-dashboard.md) — A9, which the doc still shows as 🔴 and
  which is in fact three-and-a-half boxes built. Corrected in the first stage below.
- [`tools/fleet/routes-steer.ts`](../../tools/fleet/routes-steer.ts) — `REFUSAL_STATUS`, a `Record`
  keyed by the union, so a new refusal code will not compile until it has a status.
- [`tools/fleet/drain.ts`](../../tools/fleet/drain.ts) — read, not edited. Owned by the
  `claude-agents-dashboard` session.
- [overseer-direction.md](../project/overseer-direction.md) and
  [260908b-whole-approach-review-astra-v2.md](260908b-whole-approach-review-astra-v2.md) — A9, A10,
  A11 and the review they came from.
- [silent-success.md](../reusable/silent-success.md) — the reason every acceptance criterion below
  says what the check prints when it is defeated.

## Principles and key decisions

**Prose becomes a positively-established act, not a residual one.** Answering a dialog already
requires a positive identification — `parsePane` recognised a specific dialog, `classifyGate` earned
the `conversation` arm, and `sameQuestion` re-checked the material's fingerprint against a fresh
capture. Prose required "we did not recognise anything, and there is a box shape". After this, both
require a positive reading of the screen, and prose requires **strictly more**: the box must exist
*and* be empty. That is what "narrower capability" means here, and it is enforced by which arm of a
union each entry point accepts rather than by a rule each caller remembers.

**One reader of the screen, in the module that reads screens.** `inputSurface` lives in `steer.ts`
and re-parses the pane that `sendMessage` has already parsed. Two functions reading the same capture
is the drift this module warns about in three separate comments ("Two regexes for one thing drift,
and the direction this one would drift in is 'types a message into a permission dialog'"). So
`inputSurface` **moves into `pane.ts`** and widens into `paneSurface`, which returns one union
answering one question: *what is this pane showing, and what may be sent to it?* `steer.ts` calls it
once and switches. This deletes a `parsePane` call rather than adding one.

**A refusal, not an override.** The simpler option considered and rejected: let the page send anyway
behind a confirmation ("there is a draft; send regardless"). Rejected because the draft belongs to
somebody else — the agent typed it, or Greg typed it in the terminal and walked away — and no
confirmation on a phone can tell those apart. If an override is ever wanted it should arrive with a
reason, not as the default shape.

**The draft's text does not cross the wire.** The refusal says *how many lines* are in that box and
not what they say. This file's header promises that nothing here logs a word of what people say to
their agents, and putting one agent's unsent sentence onto Greg's phone would be that promise broken
by the guard that exists to protect it. The simpler option — show the draft so Greg can judge — is
named and passed over; it can be added later as a deliberate decision.

**A queued message that hits a draft waits rather than dies.** `no()` in `steer.ts` returns
`delivery: "none"` and `sent: []`, so the new refusal reaches `drain.ts` on the path that calls
`queue.release` with `nothingWasSent()` evidence and puts the item back at the head of its queue. No
change to `queue.ts` or `drain.ts`, and the never-auto-retry rule is untouched: nothing was sent, so
there is nothing to retry. This is the correct behaviour by accident of good design next door, and
it is asserted rather than assumed.

## What we are not building

**A FOREGROUND GUARD BUILT ON THE KERNEL OR ON tmux — and this section originally said "no
foreground guard at all", which Sol was right to call an overbroad conclusion from a sound
measurement.** What follows disproves `tpgid`; the paragraph after it is what got built instead.

`steer.ts`'s header says
`#{pane_current_command}` is `bash` for every Claude session and so cannot tell a Claude pane from a
shell pane. That is true, and the reason is worse than the note implies. Measured on 2026-09-08
across `%1999`, `%2085` and `%2166`, reading `/proc/<pid>/stat`:

```
pid=503078  comm=bash    pgrp=503078 sid=503078 tpgid=503078
pid=503092  comm=claude  pgrp=503078 sid=503078 tpgid=503078
```

Claude, the pane's bash, and anything Claude shells out to are **all in one process group**, and the
tty's foreground process group id is that group. So `tpgid` carries no more information than tmux's
field did: there is no kernel-level signal on this box that distinguishes Claude from a child it has
shelled out to. A check built on one would read strong and mean nothing, which is the failure class
this project keeps writing postmortems about. The gap stays named in `steer.ts`'s KNOWN GAPS, with
the measurement attached so the next person does not re-derive it.

**What got built on that reasoning, and then removed the same day.** Claude Code keeps its own note
— `~/.claude/sessions/<pid>.json` — whose `status` field reads `shell`, and I read that name as
meaning a program of Claude's is in front of the tty. **It does not.** Sol read the installed 2.1.263
binary and found the expression that writes it, `_D==="idle"&&ZQr?"shell"` — that is
`baseStatus === "idle" && hasUnfinishedLocalBash`, and `local_bash` counts a **backgrounded** task.
So `shell` is true of the commonest healthy state on this box: Claude at an empty prompt, ready to be
messaged, with a dev server or a test run behind it.

Two things that cost, and both are worth more than the guard would have been. **A signal's name is
not its meaning**, and this one belongs to another application whose vocabulary is not ours; I
inferred it rather than reading what produced it. And **the argument for shipping it was false** —
*"it can only ever ADD a refusal, so it cannot break anything"*. It cannot cause an unsafe send. But
a long-running background job would have refused every message to that session indefinitely, and
`drain.ts` would have put the same queued item back on every pass until it aged out. A guard that
only refuses can still destroy availability, and this one would have starved the queue. The binary's
expression is now in `steer.ts`'s KNOWN GAPS so nobody rebuilds it from the same wrong premise.

**So the foreground gap is open, and stays named.** Nothing on this box can say who is reading that
tty.

**~~A `clipped` signal out of `materialAbove`~~ — this one was wrong, and it is kept here rather
than quietly deleted because the reasoning is a trap worth recognising.** The argument was: no
fixture triggers it, and one constructed by deleting the lines above a fixture's top border produces
a *correct* body, so the guard's trigger cannot be demonstrated, so it would be an untested guard.
Every step of that is true except the one that matters — **I had constructed the harmless case and
concluded the dangerous one did not exist.** Sol built the dangerous one in a sentence, and it is
now `dialog-clipped-at-a-solid-separator.txt`, which silently loses `Edit file` and `notes.md` from
an otherwise perfect-looking dialog. Built. See [§ What the review changed](#what-the-review-changed).

**`PaneGate`, `classifyGate`, `sameQuestion`, `sameMaterial` and the answering path.** Landed,
tested against 23 captures, and out of scope. The two things Stage v0.2e deliberately left open —
the TOCTOU window and the unreachable `arrows` branch of `keysFor` — are decisions with reasons, and
nothing here argues with either.

## Stages

### ✅ Stage A: A9 is built; the doc says it is not, and the refusal does not say what to do instead

The smallest thing, and it lands first so something is true by the end of the hour.

Stage v0.2b in [260907e](260907e-agent-fleet-dashboard.md) is marked 🔴 with four unticked boxes.
Three and a half of them shipped this morning and the doc never caught up: `material` with its
sha256 fingerprint and three arms (`6fbb1f56`), `sameMaterial` where `unreadable` never equals
anything including another `unreadable` (`688bd699`), and the client's `Material` component and
`Consequence` pill with the `CONSEQUENCE_TONE` inequality holding `unknown` at least as loud as
`persistent` (`44f60619`).

The half-box genuinely open is the handoff. When the material comes back `unreadable` the card takes
the buttons away and says *"Answer it in the terminal."* — which is correct and useless, because it
does not say how to get to that terminal. Astra asked for `gjd-remote resume <name>`, and the
command exists (`scripts/gjd-remote.ts`, and the tool prints that exact line itself at two places).

- [x] `Material`'s `unreadable` arm in `tools/fleet/web/src/SessionParts.tsx` renders the actual
      command, `gjd-remote resume <session name>`, as **selectable** monospace text — the person
      reading it is on a phone and is about to paste it into a terminal somewhere else, so a
      sentence they have to retype is barely better than no sentence. The session's **name**, never
      its id: that is what the command takes. Needs the name threaded through `QuestionCard`; that
      is a one-line prop at the call site in `SessionDetail.tsx`, which belongs to the other
      session — **ask before adding it**.
- [x] Tick the three built boxes in 260907e § Stage v0.2b, mark the stage ✅ with the three commits
      named, and move "BLOCKS v0.4" — v0.4 shipped.
- [x] Prove it in a browser: a pane whose material is `unreadable` shows no option buttons and does
      show the resume command. Screenshot.

### ✅ Stage B: `paneSurface` — one reading of the screen, with an arm for an occupied box

The safety property. Everything after this is presentation.

- [x] **Red first.** A test in `tests/fleet-steer.test.ts` that drives `sendMessage` with an `io`
      whose `capture` returns `none-typed-numbered-message-in-input-box.txt` and asserts a refusal.
      **Watch it fail**, and record what it printed when it failed — it must fail with `ok: true`
      and two `send-keys` calls in `sent`, because a test that goes red for the wrong reason (a
      malformed fake, a fixture that does not load) proves nothing.
- [x] `PaneSurface` in `pane.ts`, four arms, no optionals:
      `{ kind: "dialog"; question: PaneDialog }` · `{ kind: "empty-input"; promptLine: number }` ·
      `{ kind: "drafted-input"; promptLine: number; draftLines: number }` ·
      `{ kind: "unrecognised"; why: string }`. `PaneDialog` is the existing
      `Extract<PaneQuestion, { kind: "question" }>`, exported from `pane.ts` so `steer.ts`'s
      `SeenQuestion` becomes an alias of it rather than a second spelling.
- [x] `paneSurface(capture): PaneSurface` in `pane.ts`, absorbing `inputSurface` verbatim — same
      three conditions, same `isBoxBorder`, same `BORDER_TITLE_INDENT`, same "last prompt line"
      rule — and calling `parsePane` **once**, whose result becomes the `dialog` arm.
- [x] Emptiness: the prompt line is empty when everything after the `❯` trims to nothing, and every
      line between it and the closing border does too. U+00A0 is whitespace to `String.trim`, which
      is what an empty box actually contains; there is a test that keeps that true, because a
      `trim` that stopped folding NBSP would turn every empty box into a drafted one and the
      feature would vanish silently.
- [x] `inputSurface` is deleted from `steer.ts`, not left beside its replacement. **This touches
      `steer.ts`, which is shared — tell `claude-agents-dashboard` first.**
- [x] `sendMessage` switches on `paneSurface` with a `never` in the default: `empty-input` proceeds,
      `dialog` → `pane-is-asking` (unchanged), `drafted-input` → the new code, `unrecognised` →
      `not-at-input` (unchanged, carrying `why`).
- [x] New `RefusalCode`: `input-not-empty`. Adding it makes `REFUSAL_STATUS` in `routes-steer.ts`
      fail to compile until it is given a status — **409, not 400**: the request was fine and the
      box is not what the client thought, and the same client may legitimately retry once that agent
      has sent its own draft.
- [x] `answerQuestion` takes its dialog from the same `paneSurface` call, so the two entry points
      cannot come to different conclusions about one capture.
- [x] The whole fixture corpus re-classified, printed as a table in the test output: every
      `dialog-*` fixture must be `dialog`, `none-typed-numbered-message-in-input-box` must be
      `drafted-input`, the two bare/blank panes `unrecognised`, and the rest `empty-input`. A count
      per arm, asserted, so a change that silently moves one fixture between arms goes red.
- [x] Assert the drain's behaviour rather than assume it: a test that the refusal carries
      `delivery: "none"` and `sent: []`, which is what `nothingWasSent()` requires before
      `queue.release` will put the item back.
- [x] `npm test` and `npm run typecheck`.

### ✅ Stage C: the person who pressed Send learns what happened

A refusal a phone cannot act on is a refusal that teaches Greg to stop reading them.

- [x] `input-not-empty` gets a client-side sentence in the steer client that says the specific
      thing: there is already text in that session's input box, a message sent now would be added to
      the end of it and submitted as one, and the fix is to wait or to open the session. Not the
      generic refusal rendering.
- [x] **Make it refuse in a real browser.** Start a throwaway `claude` in a tmux session of my own,
      type a few words into its input box without pressing Enter, and press Send from the dashboard.
      Watch the refusal arrive, screenshot it, and confirm by `capture-pane` that the draft is
      **unchanged** — the screenshot proves the message; the capture proves the safeguard. Then
      clear the draft and send again, and watch it succeed, because a guard that has never let
      anything through is a guard that is simply off.
- [x] Never against another agent's session. `capture-pane` only on those, `send-keys` never.

### Stage D (deferred, and named rather than done)

The page could show the draft state *before* Send is pressed — the same principle as commit
`18800ff6`, "the page stops offering a button it knows the server will refuse". That wants
`surface` on the wire and computed by the collector, which lands in `wire.ts` and `collect.ts` while
`wire.ts` is being written by somebody else today. Deferred deliberately: Stage B is the safety and
Stage C is the explanation, and both stand without this.

## Made to refuse in a real browser, and then made to allow

**A green suite is not evidence that a person can see a thing, and it is emphatically not evidence
that a safeguard fires.** Four features in this repo were built, tested, routed, shipped and dead —
the page sent `dryRun` and the route has only ever parsed `mode`, so every box action ever pressed
was a dry run reported as "Done."
([260908b](../postmortems/), and `renderSpoken` in this very directory was called from its tests and
from nowhere else). So this was driven from Chrome against the running server, on a throwaway
session of my own.

**The refusal.** A draft `❯ DRAFT-BRAVO-still-being-written` left in `%2433`'s box; Send pressed
from the page with `HELLO-FROM-THE-BROWSER`. The card, verbatim:

> **Nothing was sent.**
> pane %2433 has 1 line of text already in its input box; a message sent now would be added to the
> end of it and submitted as one
> `input-not-empty` · HTTP 409 · said by the dashboard server
> Refreshing will not help — the box is not empty, and only that session can empty it. Wait for it
> to send what it has, or go and look:
> `gjd-remote resume ab-dummy-target`

**And the box was then read back**, which is the half that matters: `capture-pane` showed
`❯ DRAFT-BRAVO-still-being-written`, unchanged, with no `HELLO-FROM-THE-BROWSER` appended. The
screenshot proves the message; the capture proves the safeguard.

**Then made to allow, because a guard that has never let anything through is a guard that is simply
off.** The box was cleared, the page reloaded, and the same Send succeeded — a green *Sent.* card
printing the two `send-keys` calls, and the agent replied in its own terminal. Both halves, or
neither is evidence.

**And A9's client half, proved the same way rather than assumed.** A dialog was provoked on the same
throwaway session — an agent's own `AskUserQuestion` with five options — and the card drew all of it:
a *"What you would be approving"* box holding the material, the sha256 fingerprint under it with the
sentence about what the server compares before it types, the five options as buttons with their
keystrokes, and a consequence badge on **every one** reading
`UNCLASSIFIED — ASSUME IT IS FROM NOW ON`, with a working tooltip. Nothing here was inferred from a
passing test.

**A design finding that came out of that screenshot and is NOT fixed here**, because it is a
judgement rather than a defect. On an `AskUserQuestion` every option is `unknown` by construction —
an agent writes its own labels and none of them says "yes" — so the card draws five identical
full-width red badges on a 390px phone. The rule they enforce is right and must not be softened:
`unknown` is drawn at least as loudly as `persistent`, held by an inequality over `CONSEQUENCE_TONE`
that the suite asserts, because the alternative is the conservative default becoming the mildest
badge on screen. But the tone was calibrated for a **permission dialog**, where some options are
`once` and some `persistent` and the badge tells them apart. **A badge that appears on every option
in a card distinguishes nothing within that card**, and five maximum-alarm pills on a benign question
is how a reader learns to stop seeing them. The honest fix is probably one line of prose at the card
level for the all-`unknown` case rather than per-option pills — but that is a design call for Greg,
and weakening the tone table to get there would be the guarantee traded for the aesthetics.

**One thing the browser found that no test would have.** The first Send returned
`declared-not-steerable`, not `input-not-empty` — the collector had briefly failed to read the
session, so the page was honestly offering Send on a row whose status was stale. That is not this
stage's bug and it did not stop the proof (a Refresh and a retry produced the expected refusal), but
it is a reminder that the refusal a person actually meets is whichever guard fires first, and the
ordering of them is a product decision nobody has made deliberately.

## What the review changed

**GPT Sol reviewed the plan before a line was built** —
[the answer](260908f-prose-needs-an-empty-input-box-not-merely-a-box-review-sol.md), and its verdict
was *"do not build Stage B exactly as written"*. Four of its seven findings changed the code and two
changed what this doc claims. It is worth reading in full; this is what came of it.

**The blocker, and it was one.** `cleanLines` replaces every character in `DECORATION` with a space,
so a box holding `■` or `────` cleans to a line that trims to nothing — Sol reproduced the step, and
`❯■`, `❯────` and a genuine `❯ ` all clean to exactly `❯`. An emptiness rule written against `text`
would have called those empty and appended to them. **Occupancy is read off `raw` instead**, which
is the same capture with only the ANSI removed, and `Line` has carried both fields since it was
written. The test asserts the trap as well as the fix, so nobody has to take the comment's word for
it. Sol's second half of the same point — a decoration-only draft line can masquerade as the box's
closing border — has its own test; the prompt line is occupied in that case anyway, so it is a belt
rather than the braces.

**The arm is `occupied-input`, not `drafted-input`.** Sol: *"Calling it `drafted-input` claims
provenance the parser does not possess."* Correct, and it is the same discipline as `PaneGate`'s
`unknown`. A capture cannot tell a person's half-typed reply from a suggestion the harness offered
or the hint a never-used session draws. What is true of all three is that the box is not empty.

**The corpus is 24, not 23, and TWO fixtures have occupied boxes.**
`none-working-with-prose-decisions-list.txt` ends `❯ do all three`, which this doc had not noticed
and the suite had listed under *"sends to every real screen that does have one"* alongside the other
one. So the acceptance criterion as written could not have passed. There is now a table of all 24
with a count per arm, and a fixture that arrives without being classified deliberately fails.

**The `clipped` guard is built after all, and the reason I had for deferring it was wrong.** I said
its trigger could not be demonstrated; the construction I had tried was the harmless one — delete
the lines above a real outer border and the body that comes back is correct, because it is. Sol
supplied the dangerous one: take `dialog-edit-diff.txt`, make its first *inner* separator solid as
the hypothesised future renderer would, and begin the capture there. What that drops is precisely
`Edit file` and `notes.md` — **the operation and the destination path** — leaving a readable diff
that looks like a whole dialog. `materialAbove` now refuses a body whose top border is line 0. The
cost is a dialog that genuinely begins at row 0, and a test asserts we pay it.

**"Cannot be built at all" was too strong about the foreground.** The process-group measurement
disproves `tpgid`; it does not disprove every guard. Claude Code writes
`~/.claude/sessions/<pid>.json`, whose `status` reads `shell` while a session has shelled out —
checked, and pid 1471795 under `%2085` was in that state while this was being written. It is now a
last check in `sendMessage`, and it is **fail-open by design**: `shell` refuses, while a missing
file, unparseable JSON, an unknown status or a read that throws all proceed. That is the opposite of
this module's usual bias on purpose — it is another application's undocumented private state, and a
guard that refused on its absence would stop every message on the box the day the format changed. It
can only ever ADD a refusal, and there is a test whose job is to stop somebody "hardening" it later.
**It is a supplement, not a closure**, and the stage does not claim to have shut the foreground gap.

**The drain test was testing the wrong thing.** Asserting `delivery: "none"` and `sent: []` on the
`SteerResult` proves ELIGIBILITY for `nothingWasSent`, not that `drain.ts` called `release`, kept
the item, cleared its lease or left it at the head — a mutation that settled every refusal would
have left it green. It is asserted at the drain now. Said precisely: **the item is retried on a
later pass; the keystrokes are not**, which is the distinction `queue.release` and its
`UnsentFailure` brand exist to hold.

**And one claim in this doc was overstated.** The union gives exhaustive routing enforced by the
compiler, on evidence `sendMessage` mints itself from a capture it takes — it is **not** a
capability token. Sol found no bypass in the production call graph (route, drain and broadcast all
go through `sendMessage`, and `fire` is private), but a caller could pass a `SteerIo` whose
`capture` lies while its `sendKeys` is real. Making that impossible means making the transport
private and tying it to internally minted evidence, which is a bigger change than this stage and is
not pretended to have happened.

**Left alone, deliberately.** Sol's finding 4 — the browser drops `delivery`, so a `send-partial`
renders as *"Nothing was sent."* — is real and is A11b's consumer flattening an honest union. It
belongs to the delivery-receipt owner and has been handed over rather than quietly fixed here.

## What the SECOND review changed, and it was more than the first

**Sol reviewed the built code and said "do not ship this exact version."** Weighted higher than the
plan-stage pass on purpose, and it earned it: a plan-stage review cannot find a comment that lies
about the code beneath it.
[The answer](260908f-prose-needs-an-empty-input-box-not-merely-a-box-review2-sol.md).

**The blocker, and it was my comment that was wrong before the code was.** I wrote that a
continuation line is counted *before* the border test, "so a draft line made only of decoration
cannot end the scan while it is still somebody's text". The code returned at the rule first and did
exactly what the comment denied. Claude Code takes multiline input on Ctrl+J, so a box holding an
empty first line, then `────────`, then `  caption` came back `empty-input` with `caption` never
read — Sol ran the construction rather than describing it. **And the test I had written for that
very case passed with the bug present**, because its prompt line was already occupied: a test that
passes for a reason other than the one it was written for, which is the class of the postmortem
sitting beside this file.

Reversing the two statements is not the fix, which is the trap — the genuine closing border is also
a rule with nothing on it, so counting first would call every empty box occupied. It is measured
instead: in all seven real captures the closing border has **exactly the top border's width and
indent** (122 columns on one pane, 150 on another, indent 0 on both), because Claude Code draws the
box as a matched pair. A rule typed into a draft is short, or indented, or both. Wrong in the safe
direction if a build ever draws them mismatched: the scan runs off the window and the pane comes
back `unrecognised`.

**`shelledOut` is gone, and it should never have been built.** Sol read the installed Claude Code
2.1.263 binary and found what writes that field — `_D==="idle"&&ZQr?"shell"`, i.e.
`baseStatus === "idle" && hasUnfinishedLocalBash` — and `local_bash` includes a **backgrounded**
task. Verified here against the same binary. So `status: "shell"` is true of the commonest healthy
state on this box: Claude at an empty prompt, ready to be messaged, with a dev server or a test run
behind it. I had inferred the field's meaning from its name without checking what produced it.

**And the argument I shipped it on was false.** *"It can only ever ADD a refusal, so it cannot break
anything"* — it cannot cause an unsafe send, but a long-running background job would have refused
every message to that session indefinitely, and `drain.ts` would have put the same queued item back
on every pass until it aged out. **A guard that only refuses can still destroy availability**, and
this one would have starved the queue. The expression from the binary is now in `steer.ts`'s KNOWN
GAPS so the next person does not rebuild it.

**Three smaller ones, all fixed.** The drain test queued one item, so "put back at the head" and
"put back at the tail" were the same state and a mutation moving it to the tail would have passed —
it queues two now and asserts which one the next pass attempts. The `input-not-empty` join was
correct at every hop and entirely unprotected, because the client models a refusal code as an
arbitrary `string`; there is a browser test now, and mutating the comparison by one character makes
it red. And `Handoff` assumed every tmux name is a safe shell word — it quotes, and withholds the
command entirely for a name it cannot quote, because a command that runs and resumes the *wrong*
session is worse than no command.

**One thing Sol did not find, which the fix for its last point did.** Writing `/[\x00-\x1f]/` into
`SessionParts.tsx` put a literal NUL byte in the source, which made `grep` treat the whole file as
binary and return nothing for every pattern — including the component's own name, so it appeared to
have been deleted. `steer.ts` already carries the rule (*"a control character in a SOURCE file is a
byte grep cannot see and a reviewer cannot read, and this repo has been bitten by writing one"*) and
the fix here is the same code-point loop, with the story attached.

## Risks

- **A build of Claude Code that draws a placeholder in an empty box** turns every pane into
  `drafted-input` and the Send button stops working everywhere at once. Loud, safe, and fixed by
  teaching the rule that shape. Named here so the next person recognises it in one minute rather
  than thirty.
- **A torn redraw** — a capture taken between the box being cleared and the draft being repainted —
  reads empty when it is not. Unchanged from today and not closable without a compare-and-send tmux
  does not have; it is in the module's KNOWN GAPS already.
- **Moving `inputSurface` conflicts with concurrent work in `steer.ts`.** Mitigated by asking first
  and by keeping the move verbatim: the body of the function does not change in this plan, only its
  address and its return type.
