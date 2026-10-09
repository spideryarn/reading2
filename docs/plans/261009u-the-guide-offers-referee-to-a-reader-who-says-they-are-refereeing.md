# 261009u — The guide offers Referee to a reader who says they are refereeing

Owned by [plans.md](../project/plans.md). Report `spya-h5aypq` (#519, SPIDERYARN-READING2-FZ),
Overseer queue item `qi-8g2tr5bt`, session `fbh5aypq-peer-review-research`. The research behind it
is [261009b](../research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md).
Runs beside [261009s](261009s-peer-review-becomes-sources-all-the-way-down.md) (Peer review becomes
Sources), which owns every Sources name; this plan uses those names and stays off its rows.
**Status: built, GPT Sol on the plan and the code, measured 14/14
([261009d](../investigations/261009d-the-guide-offers-referee-to-referees-measured.md)), on `dev`.
Not deployed. Four product questions for Greg in
[q-fkq30v](../user-feedback/questions/q-fkq30v.md).**

## What Greg asked for

> P.S. I mean, if the reader says in their Guide chat or their Why You're Reading This that they are
> a referee, that should obviously present tools for the Referee mode etc.
>
> — Greg, 2026-10-09 (report `spya-h5aypq`)

And the line between the two modes, which the research works out at length:

> referee is more like making a decision on the paper itself. Obviously, that still requires you to
> look at where it's situated in terms of peer review, but referee is more about making a decision
> and therefore sort of having information highlighted suggests that perhaps the reader evaluates.
>
> — Greg, 2026-10-09 (same report)

## What was there, and why it fell short

- **The guide already hears both places Greg names.** Every guide turn carries the reader's *Why
  you're reading this* and About you, fresh from the store (`profileSection`, src/converse.ts), and
  it reads their messages. So "say it in the guide or in the reason" is already one place: the
  guide's prompt.
- **But it could not offer Referee as a button to most readers.** Referee is behind the experimental
  switch (`MODE_CATALOG.referee.experimental`). The guide's list of modes (`modeWordsSection`,
  src/guide.ts) gave an experimental mode no button: *"name it in words"*. The chips' door
  (`chipModes`, src/web/reader/Reader.tsx) held only what the bar shows. Measured before the change
  ([261009d](../investigations/261009d-the-guide-offers-referee-to-referees-measured.md), v0): the
  guide never mentioned Referee to a referee, and twice sent them to *Peer review › Claims* instead.
- **Behind the switch is about clutter, not access.** `?mode=referee` opens for anyone
  ([experimental-visibility.ts](../../src/web/experimental-visibility.ts): *"hidden means hidden
  from the controls, not unreachable"*; nothing on the server reads the switch). A button offered
  to the one reader who said they need it is not clutter.

## What was built

**One allowlist names the experimental modes the guide may offer, to whom, and what to say.**
`OFFERED_BEHIND_THE_SWITCH` in src/mode-catalog.ts, deny by default, with `{ audience, guidance }`
for each mode, and `offeredBehindTheSwitch(key)` to read it by catalogue key (`mode:referee` and
`submode:referee:criteria` are both Referee's). Today it holds Referee alone. Three things read it:

1. **The written guide's list of modes** (`modeWordsSection`, src/guide.ts). Referee's line reads
   `Referee (experimental; offer it only when <audience>. When you offer it: <guidance>.)` and
   carries its button. Each sub-mode's line points back to it rather than repeating the paragraph. One
   sentence in the section's preamble says such a mode is hidden from the reader's bar, so offer it
   only to its audience and otherwise do not mention it. Every other experimental row is
   unchanged. The spoken guide's list is unchanged. A voice has no button, and its section already
   says an experimental mode needs the switch.
2. **The press rule** (`modeActsAlone`, src/acts-alone.ts). Such a mode is always a *Button*, never
   *Opens at once*, on the prompt's side and the page's alike. The offer rests on the model's reading
   of who the reader is, which the reader confirms by pressing. A planted paragraph claiming the
   reader is a referee cannot move them into a hidden mode (GPT Sol's F3).
3. **The guide's chip door only** (src/web/chip-door.ts). `chipDoorRows` is chat's rows, moved out of
   Reader.tsx's `useMemo` unchanged. `guideDoorRows` adds each offered mode and all its sub-modes,
   each key once. Reader.tsx builds a door from each. `withModeDoor` (src/web/command-runners.ts)
   makes a `guide` twin of each chat executor (`CommandExecutor.guide`). `ChatCommandsFor`
   (CommandChip.tsx), wrapped round ChatPanel.tsx's `Conversation`, hands a guide thread the twin
   and every other thread the ordinary one. So a Referee token in ordinary Chat stays plain text
   with the switch off (GPT Sol's F1). The bar, the Dock and the command bar are untouched.

**What the guide says with the offer** is the `guidance`. It suggests Referee for the close read and
the reader's own notes, and the mode for what the piece cites and what others say about it (named by
its description, which survives the Sources rename) for the literature around it. And it says, in
one sentence and in the past tense, that this article's text was already sent to an AI provider
when it was added, and that Referee's Notices button says what journals' rules are on that. The
research finds confidentiality decides whether a referee can use any of this (GPT Sol's F2).

**Referee's own words** (src/mode-catalog.ts). The description is now *"Refereeing it? What to weigh
before you decide: your criteria, its claims, and a second look at your notes"*, Greg's *making a
decision*. The `how` gains a last sentence pointing anyone who wants where the piece sits among
other work to the mode for that. Sources' row and Referee's aliases are 261009s's, and were not
touched.

### Passed over

- **Take Referee out of the switch.** It is the simplest code (one boolean), but it puts a mode still
  being built in every reader's bar. That is the clutter the switch exists to prevent, and it is
  Greg's product call: Q3 in [q-fkq30v](../user-feedback/questions/q-fkq30v.md). If he says yes,
  Referee leaves the allowlist and nothing else changes.
- **A keyword hint on the reason box** ("refereeing? try Referee" when the text matches). It is a
  second mechanism beside the guide. A regex would misfire on "reviewing it for a magazine", and it
  would miss "I've been asked to assess this for Nature". The guide already reads the same words,
  with judgement, and the eval's magazine case shows it tells the two apart.
- **Let the guide offer any experimental mode.** That is broader than asked, and it would turn the
  switch off for anything the model fancies. A named audience per mode keeps it a decision.
- **One widened door for every chat** (the first draft of this plan). Sol's F1: Chat and the guide
  share one executor, so it would have made a Referee token a working button in ordinary Chat too.

## GPT Sol on the plan

[261009u-plan-review-sol.md](261009u-plan-review-sol.md); prompt alongside it. Verdict: *revise
before build*. All eight findings were taken:

| # | Finding | What was done |
|---|---|---|
| F1 P1 | The widened door reaches ordinary Chat | Guide-only door and executor twin, by thread kind |
| F2 P1 | The confidentiality line is a pointer, not the past-tense fact, and is not scored | `guidance` says the text was already sent; the eval fails a wanted offer without both halves |
| F3 P2 | A non-generating Referee token would open by itself | `modeActsAlone` makes offered modes a press, prompt and page |
| F4 P2 | The spoken guide | Unchanged, and on purpose: its section already says experimental modes need the switch, so its words are true |
| F5 P2 | Do not put Dock/CommandBar reachability into command-runners.ts | `chip-door.ts`, a leaf only Reader.tsx imports |
| F6 P2 | Tests stop short of the press | `tests/guide-offers-behind-the-switch-door.test.tsx`: real rows, doors, runners, thread swap and chip |
| F7 P3 | Research overstates "every policy" and the idea ranking | Reworded in 261009b |
| F8 P3 | The record's stated rationale was wrong; mixed concerns in one string | Rationale is now "an auditable allowlist"; `{ audience, guidance }` |

## Tests

- `tests/guide-offers-behind-the-switch.test.ts`: the allowlist holds only experimental modes. The
  lookup takes a mode and its sub-modes and nothing else (`constructor` included). Referee's line
  carries its audience, its guidance and a *Button*, and so does every sub-mode. Diagram still has no
  button. The spoken list is unchanged. `modeActsAlone` is false for every Referee key and still
  true for Structure.
- `tests/guide-offers-behind-the-switch-door.test.tsx`: with the switch off, chat's door lacks
  Referee and the guide's has it and its sub-modes. With the switch on, no key is doubled. A guide
  thread draws the chip, and a press opens Referee armed through the Dock's activator. A sub-mode
  press opens Criteria. The answer's act never opens it. Ordinary Chat draws the same token as plain
  text.
- Both seen red: with `offeredBehindTheSwitch` returning nothing and `ChatCommandsFor` swapped the
  wrong way round, 8 of the 16 fail, each on its own assertion.
- Updated: `tests/chat-command-chips-prompt.test.ts` (the guide's buttons are the ordinary modes
  plus the allowlist) and `tests/guide-kind.test.ts` (Diagram is the plain experimental example now).

## Measured

[261009d](../investigations/261009d-the-guide-offers-referee-to-referees-measured.md): before, 4/7
(every referee case failed). After, 14/14 over two runs, and 7/7 offers say both that the text was
already sent and where Notices are. The magazine reviewer, the reading group and a planted paragraph
got no Referee. $0.57 in all.
