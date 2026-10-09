# Dictation: a double press on Stop also sends

Up: [dictation.md](../project/dictation.md)

Report `spya-rp8676` (Sentry SPIDERYARN-READING2-CP, a suggestion from Greg, admin, on
`bitterlesson-spya-pbag4p` in Remember mode). Overseer queue item `qi-j2cqq6dn`.

> If I'm dictating with my voice and I double click the stop button, then it should automatically
> also trigger whatever the kind of done action is for that whole section. So, for example, if I'm
> in a feedback report and I double click the stop button, then it should also click send afterwards
> for me. And if I'm in chat or whatever and I double click the stop button, then it should
> automatically send that message after it's finished transcribing, obviously.
>
> — Greg, 2026-10-04

## What it is for

Today a dictation ends in two steps: press Stop, wait about two seconds for the words, press Send.
The second press is the one Greg wants to give in advance. Press Stop twice quickly and the box
sends itself once the real transcript is in it.

## Prior work

None. `docs/plans/`, `docs/user-feedback/`, `git log origin/dev` and `gjd-remote ls` were searched
for dictation, stop and double on 2026-10-05; the only session carrying this report is this one.
[261004g](261004g-four-small-touch-and-narrow-window-fixes-structure-list-card-band-about-double-press-glossary-band-comes-back-shelf-copy-notice.md)
is about a double press on a different button.

## The one hard fact

**The second press cannot reach a `disabled` button.** `DictationButton` goes `disabled` the moment
the first press stops the microphone (deliberately: a press there used to mean "start again" and
threw the dictation away). A browser sends no `click` to a disabled button, and whether it sends
`pointerdown` to it or to a wrapper differs between browsers. So `onDoubleClick`, and a listener on
a wrapper, are both unreliable. GPT Sol's plan review agreed with this much.

So, **only on a box that has a done action, and only for the 600 ms in which a second press
counts**, the button stays an ordinary enabled button, named for what pressing it does ("Send when
the words arrive"). Its only press there is the second press; it never starts a dictation. When
the 600 ms pass, or the press is taken, it is `disabled` exactly as it is today.

The first draft of this plan kept the button `aria-disabled` for the whole two-second gap. GPT Sol
(F3) was right that this tells a screen reader the button cannot be used at the one moment it can.
The timed window is also less: the button is different from today for 600 ms, not two seconds.

## The design

```
 press Stop ──▶ toggle()        microphone off, phase "transcribing"; the window opens (600 ms)
 press again ─▶ again()         offered only while the window is open
                                → wantSend = { what the box is about now }; the window closes
 transcript ──▶ onTranscript    put() succeeded?  → delivered = true
 ending ──────▶ onEnd           wantSend && delivered && the box is still about the same thing?
                                → setSendTick(n + 1)
 next render ─▶ effect          → onDone()   (the box's own send)
```

1. **`useDictationField` takes an optional `onDone`** — the box's own send function, unchanged —
   and an optional **`doneKey`**, what the box is about when that can change under it (a comment's
   id, a quiz question's). It returns `again` (present only while a second press would count) and
   `sendingAfter` (true from an accepted second press until the dictation ends).
2. **`DictationButton` takes `again` and `sendingAfter`.** With `again` it is enabled while
   transcribing, named "Send when the words arrive", and a click calls `again()` and never
   `toggle()`. With `sendingAfter` its name is "Turning your words into text, then sending".
3. **`DictationStrip` takes `sendingAfter`** and says "Turning that into text, then sending…" in the
   strip and its live region, so the reader knows the second press was taken.

**The send runs in an effect, one render after the ending, and that is the load-bearing choice.**
Every box's send is a closure over that render's `value` and refuses while `dictate.busy`. Called
inside `onEnd` it would see the value from before the transcript and `busy: true`, and refuse
silently. The hook sets the phase to idle and calls `onEnd` in the same tick, so one state bump in
`onEnd` produces a render in which the value has the transcript and `busy` is false; the effect
then calls the latest `onDone` through a ref. GPT Sol traced this against the real hook: on the
ordinary and the in-parts success paths the transcript is delivered before `onEnd`; the no-tape
and failed endings call `onEnd` without delivery; a retry calls it again; a superseded or unmounted
session does not call it.

**It sends only what was really transcribed, and only where it was said.** The wish is honoured only
if this ending delivered a transcript into the box (`put` returned true) and `doneKey` is what it
was at the second press. So none of these send: a failed upload, an empty transcript
(`[mic-silent]`), a recording under two seconds, a transcript refused because the box changed, a
later **Try again**, a quiz answer whose question has changed, a follow-up whose comment has
changed, and a Feedback draft whose dialog was shut. The wish is cleared at every ending and every
new press. The box's own send still applies its own rules — empty, too long, already sending — so
a double press can never send something a single Send press would have refused.

**A press after the dictation has ended is an ordinary press.** The first draft swallowed it, or
sent on it; GPT Sol (F6) pointed out that the button visibly says "Dictate" by then. Dropped: the
window closes at the ending.

### Which boxes

| box | done action | in this plan |
|---|---|---|
| Feedback dialog | Send, and only while open | yes |
| chat composer | Send | yes |
| comment follow-up | Ask in chat, keyed by the comment | yes |
| quiz answer | Answer, keyed by the question | yes |
| annotate box | Save (what ⌘+Enter does), not Ask AI; only once the comments have loaded | yes |
| both profile boxes | saved at the end of every dictation already | nothing to do |
| note under an Illustrated picture | repaints the picture: slow and paid | deferred |
| command bar | runs whichever row the phrase matched | deferred |
| fleet dashboard's message boxes | send to a session | deferred |

## The simpler option passed over

**A "send when done" tick-box or a second button beside the microphone.** No timing, and
discoverable. Passed over because it is not what was asked for and it adds a control to nine boxes;
the double press adds none. It is the fallback if the double press turns out to misfire in use.

**`onDoubleClick` on the button** is simpler still and does not work: see § The one hard fact.

## Complexity this adds, named

- A 600 ms timer in the field hook, and a button that is enabled for that long after Stop on five
  boxes where it used to be disabled at once.
- `doneKey`, one more optional parameter, used by three boxes.

## GPT Sol's plan review, and what was done with it

[The review](261005a-dictation-double-press-on-stop-also-sends-plan-review-sol.md): build with the
fixes. Seven findings.

- **F1 (P1), taken.** The comment dialog and the quiz panel reuse one mounted box, so a double press
  could have sent an answer to the next question. `doneKey`. The older half of this — the
  *transcript itself* landing in the next comment's or question's box on a browser with no live
  words — is not new and is not fixed here; it has its own queue entry (§ Deferred).
- **F2 (P1), taken.** Feedback stays mounted when shut. Its `onDone` checks `open`, and shutting it
  changes its `doneKey`, so shutting it withdraws the wish even if it is opened again.
- **F3 (P1), taken.** No `aria-disabled`; see § The one hard fact.
- **F4 (P1), taken in part.** The strip must not promise a send the box will refuse. Annotate now
  offers the double press only once its comments have loaded. **Overruled for the rest**: a
  transcript that takes Feedback over its length, or arrives while a picture is still being
  prepared, is refused by `send` — but that cannot be known when the press is taken, and in both
  cases the reader is left looking at the box, with its counter or its "Adding the picture", and a
  Send button they can press. Nothing is lost and nothing is hidden.
- **F5 (P1), taken.** `touch-action: manipulation` on the button, so two taps are two presses.
- **F6 (P1), taken** by deleting the rule it objected to.
- **F7 (P2), handed to the code review.** The field tests stub `useDictation`. Sol confirmed the
  real hook's ordering by reading it; the code-review brief asks for one test over the real hook.

## Stages

One stage; it is small and none of it is useful alone.

1. Tests in `tests/dictation-double-stop-sends.test.tsx`: the field hook with a stubbed
   `useDictation`, and `DictationButton`. **Not red-first, and that is said rather than hidden**:
   the tests were written before the code but first run after it. Each rule was then mutated out
   in turn (the `delivered` check, the window, the key check) and the suite went red each time.
2. `useDictationField.ts`, `DictationStrip.tsx`, three CSS rules, then the five boxes.
3. Docs: [dictation.md](../project/dictation.md) (a section, and the adding-a-box recipe), the
   reader's `/help` page.
4. Gates: `npm test`, `npm run typecheck`, lint on touched files.
5. GPT Sol code review (write-capable), then a Sonnet browser check at desktop, iPad and phone
   widths, with a fake media stream so that Stop can really be pressed twice.

## What landed

Commits `4c59b9d9c` (the stage) and `fb5b6809a` (the code review's fixes and the note).

**GPT Sol's code review** of `4c59b9d9c`
([answer](261005a-dictation-double-press-on-stop-also-sends-code-review-sol.md)): ship with the
fixes it made. It fixed four things red-first — a target that changes in the same batch as the
ending (C1), a change of target now closing the window and withdrawing a wish already taken (C2),
a test over the real `useDictation` (C3), `/help` naming the comment follow-up (C4) — and reported
the older transcript-placement bug (C5), which is queue item `qi-cfrv4spd`.

**Browser check** (Sonnet, Playwright with Chrome's fake microphone and `/api/transcribe` answered
by the test after 1.5 s; nothing reached a real server), on `4c59b9d9c`, at 1440, 820 and 390 px
wide, the last two by touch:

- Feedback and chat, all three widths: a double press sends exactly once with the transcript; a
  single press leaves the words unsent; a second press at 900 ms does not land and sends nothing.
- By touch, the page did not zoom and the second tap was taken.
- The annotate box, at 1440 only: a double press saves once.
- The longer strip sentence fits on one line at 390 px in Feedback and chat.
- **Not exercised**: the quiz answer and the comment follow-up in a browser (unit tests only);
  annotate by touch; a real iPhone or iPad. The check ran before the code review's fixes, which
  changed no rendering.
- One thing seen and not chased: at 390 px the button showed a blue fill in the screenshot taken
  just after the second tap. No rule of ours fills it; it is most likely Chrome's own tap highlight
  caught mid-fade. Worth a glance on a real phone.

## Done looks like

In Feedback, chat, the comment follow-up, the quiz answer box and the annotate box: dictate, press
Stop twice quickly, and the box sends by itself when the words arrive, having said that it will.
Press once and nothing changes from today.

## Deferred, each with its own queue entry

- **The Illustrated note and the command bar.** Both have a done action whose cost of a misfire is
  higher: one starts a paid repaint, the other runs a command chosen by a phrase the reader has not
  yet read. Worth a yes from Greg first.
- **The fleet dashboard's boxes.** They share the hook and not the button, and the dashboard is on
  a higher robustness bar.
- **Telling the reader it exists.** Nothing on screen says a double press does this until Stop has
  been pressed once; `/help` says it. A hint on the button is a separate small design. (A keyboard
  user has the double press already: the button is a real, focusable button, and Enter twice is two
  presses.)
- **A transcript can land in the next comment's or question's box** (F1's older half): on Safari
  and Firefox, move to another comment or quiz question while the words are on their way and they
  arrive in the new box. A bug, older than this plan. Fixed by
  [261009a](261009a-dictation-transcript-lands-in-the-next-box.md): the words are offered back on
  the strip (`[mic-moved]`) and land when the reader is back where they said them.

## Open question for Greg (not blocking)

**Should the Illustrated note and the command bar take the double press too?** In Illustrated it
would start painting a new picture (about a minute, and it costs money) with whatever was heard; in
the command bar it would run the command the dictated phrase matched, before you have read the
phrase. Yes gives one rule everywhere. No (what is built) keeps the double press to boxes where the
worst case is a message you would have sent anyway. Recommendation: no for the command bar, yes for
Illustrated only if you find yourself wanting it.

**Decided: yes for the command bar** — Greg, 2026-10-05:

> Q-double-stop-elsewhere yes for the command bar

Illustrated stays as built (no double press). Dispatched to session `command-bar-double-stop`.

## The command bar, built (queue item `qi-wd4mg6p6`)

**The done action is Enter itself.** `CommandBar.tsx` had the key's two lines inline (take the
selected row, or with none, ask what the sentence meant). They are now one function, `enter`, called
by the key and by the field's `onDone`, so the double press cannot run anything Enter would not:

```
 words arrive ─▶ a row matches?  ── yes ─▶ that row, as Enter runs it (writes and generates included)
                                 ── no ──▶ ask the fast model  ─▶ sure, and only moves the reader? go
                                                               ─▶ otherwise "Did you mean", and wait
```

Nothing new was built in the hook. The only shared change is the words: the bar does not "send", so
`DictationButton` and `DictationStrip` take `done="enter"` and say *"Press Enter when the words
arrive"* and *"Turning that into text, then pressing Enter…"*. "Enter" rather than "run" because it
stays true when the phrase matches nothing and the bar asks instead (the plan review's F4: do not
promise what the box will not do).

- **Shut bar**: it stays mounted, so `onDone` checks `open` and `doneKey` is whether it is open, as
  Feedback's is. Shutting it withdraws the wish even if it is opened again.
- **Not offered while a run is `Starting…`**, when Enter is refused.
- **The simpler option passed over**: reusing the "send" wording unchanged. One prop fewer, and a
  strip that says "then sending…" over a box that sends nothing.
- **Complexity added, named**: one optional prop (`done`) on the button and the strip, with a
  two-row table of words.

Tests: `tests/command-bar-double-stop.test.tsx`, over the real bar, field and button with only
`useDictation` stubbed. Red first: five of its eight failed before the wiring. The other three are
"nothing runs" cases, which pass with no wiring at all; of those, the shut-bar one was made to fail
by removing the bar's `open` check and `doneKey`. The one-press and no-transcript cases pin rules
that live in the shared hook and were mutated there in the first stage.

**GPT Sol's code review** of `8ac1d0f6d`
([answer](261005a-dictation-double-press-command-bar-code-review-sol.md)): ship with the fixes made,
and no production change. One finding, D1 (P2), fixed: the no-transcript test started from an empty
box, so an Enter pressed in error would have had nothing to run and the test could not tell.
It now leaves live words that name a row, and removing the hook's delivery check turns it red
([postmortem](../postmortems/261005i-a-refusal-test-gives-the-forbidden-action-nothing-to-act-on.md)).
Sol also added eight cases around the sentence it was asked to break — a selection moved off the
first row, an old proposal on screen, a run still starting, shut and reopened, unmounted, signed
out — and all held.

**Browser check** (Sonnet, Playwright with Chrome's fake microphone, `/api/transcribe` and
`/api/command-pick` answered by the test; nothing reached a real server), on `8ac1d0f6d`, at 1440 px
by mouse and 390 px by touch. The box was badly overloaded at the time, so gaps between presses
drifted by about 300 ms, and the check was cut short when the Overseer asked for heavy work to stop.

- Both widths: a double press with "structure" shows "Press Enter when the words arrive" in the
  window, then "Turning that into text, then pressing Enter…", then the bar closes and Structure
  opens, once. One press leaves the word in the box and runs nothing. A second press about a second
  after Stop is not taken.
- 390 px: a sentence that names nothing posts once to the picker and its answer is drawn under
  "Did you mean", with nothing run. The page did not zoom on the two taps and nothing overflowed
  sideways.
- 1440 px: Escape after the second press, and nothing runs when the words arrive.
- **Not exercised**: "Did you mean" seen at 1440 (the one run there used a wrong row id); Escape at
  390 (the second tap landed late); whether the longer strip sentence fits on one line at 390 (no
  screenshot survived); 820 px; a real iPhone or microphone. The unit tests cover the first two.

**Gates.** Typecheck, and fifteen test files around the change (the bar's, dictation's, `/help`'s,
the Enter-key sweeps, `doc-links`), all green on the tree merged with dev. **The full `npm test` was
not run to the end**: the box was overloaded and the Overseer asked every session to stop full
suites and leave that to the readiness and deploy runs.
