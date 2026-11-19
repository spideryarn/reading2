# Send while dictating stops the microphone and sends, in every box

Report `spya-gjcyq3` (#747), a suggestion from Greg (admin: `feedback-reporter.ts --report-id`
exit 0), 2026-11-03 11:24 UTC, from the landing page:

> I noticed that someone was using the voice dictate button (perhaps in a Chat), and then they
> tried to click the "Send" button while it was still recording. They got some kind of message, but
> the better thing would have been for it to automatically click the Stop Dictating button + click
> the Send button for them in one fell swoop. This should ideally be true for all existing voice
> dictate buttons (at least where it makes sense) and going forwards.

## What is there already

The machinery exists and two boxes use it. `useDictationField` has `finishThenDone()` (plan
[261010f](261010f-feedback-dialog-send-after-dictation-and-a-saved-draft.md)): it records a wish to
run the box's `onDone`, stops the microphone if it is on, and runs `onDone` from an effect once a
real transcript has landed — never after a failure, an empty answer or a moved `doneKey`. Feedback's
Send and Search mode's box call it. Every other box that sends refuses while `dictate.busy` and
draws its button disabled (Chat: `aria-disabled`, so the Send card — *"Send · Enter to send"* —
opens over a press that does nothing; that card is the likeliest "some kind of message" Greg saw;
elsewhere a greyed button and no message at all).

## The change

**One entry point, in the shared field: `dictate.submit()`.** Busy → `finishThenDone()`; idle →
`onDone()`. A box wires its Send button, its form's `onSubmit` and its Enter key to `submit`, and
keeps its own send (its `onDone`) with its existing `if (dictate.busy) return` as the inner refusal,
so the double press and the effect-run `onDone` are unchanged. Feedback and Search move onto it
too, so there is one way, not three.

**The button stops refusing for the microphone.** Each box drops `dictate.busy` from its Send's
disabled condition, and its *empty* refusal becomes `!dictate.busy && empty`: on Safari and Firefox
the box is empty until the words land, and the words are what the press is for. Every other
refusal (an answer still streaming, too long, marking) still disables.

**Saying what happened.** The strip already says *"Turning that into text, then sending…"* once the
wish is taken (`sendingAfter`). New: when a wish to send ends without sending — the upload failed,
`[mic-silent]`, too short, the transcript refused — the field sets `unsent`, and the strip adds
**"Nothing was sent."** after the failure's own sentence. It clears when a transcript lands (a Try
again that works), when a new dictation starts, on a new press of `submit`, and on a new `doneKey`.

**Edge cases, all from the existing rules.**

- *Second press while finishing*: `finishThenDone` again — the wish is already set, the microphone
  already off; nothing new happens, nothing is sent twice (one ending, one send).
- *The reader presses Stop themselves*, before or after Send: Stop then Send = Send during
  `transcribing`, a wish on the words already on their way; Send then the microphone button = that
  button is disabled during the gap. A Stop held for its 300 ms second press and then Send: `submit`
  clears the hold (`finishThenDone` does).
- *Failure or nothing heard*: no send, the box keeps what it had, the strip says the failure and
  "Nothing was sent."
- Nothing new is streamed.

**Going forwards — a ratchet.** `tests/dictation-boxes-send-through-submit.test.ts`: every
component that passes `onDone` to `useDictationField` must use `.submit`; every component with a
field and no `onDone` is listed with its reason. It is discovery, not proof: whether each Send is
live while dictating is the box's own behavioural test. dictation.md § Adding it to a box says to
wire `submit`.

## Each box, decided

| Box | Gets it | Note |
|---|---|---|
| Chat composer (Send, Enter) | yes | the reported one |
| Comment follow-up (Ask in chat) | yes | `doneKey` is the comment |
| Annotate (Save) | yes | `onDone` only once loaded, as today |
| Quiz answer, Margin quiz (Answer) | yes | `doneKey` is the question |
| Feedback (Send), its reply box (Send reply) | yes | Feedback moves onto `submit` |
| Help's box (Ask) | yes | |
| Command bar (Enter) | yes, Enter only | a click on a *row* while dictating stays refused: it names an action other than the words |
| Search mode | yes | already did; moves onto `submit` |
| Candidates' scope, Referee's new criterion, Skim's purpose | yes | already take the double press |
| Illustrated's note (Repaint) | **no** | a paid repaint on words the reader has not seen; the double press there already waits on Greg's yes (`qi-wd4mg6p6`) — asked again as a question |
| Comment's own note | no | it has no Send: it saves itself when the words land |
| Profile boxes, the add page's two | no | no Send; they save themselves, and the add page holds its exits while busy |

## Passed over

- **Making `busy` itself stop refusing inside each box's send** (Feedback's pattern: the first line
  of its send calls `finishThenDone`). Every entry point would work without wiring, but it is a
  per-box line to remember, which is the thing the report asks us not to need. `submit` plus the
  ratchet makes forgetting fail a test.
- **Auto-submitting without a press** (sending whenever dictation ends). Not asked for, and it
  would send words nobody has read.

## Tests, red first

- `tests/dictation-submit.test.tsx` (real hook harness from `dictation-finish-then-done`): `submit`
  idle calls `onDone`; `submit` while armed stops and sends once, after the words; a second
  `submit` while transcribing sends once; a failed upload sends nothing and sets `unsent`; Try again
  that lands clears `unsent` and sends nothing; a held Stop then `submit` sends.
- The strip shows "Nothing was sent." with `unsent`.
- Chat: Send pressed while armed is not `aria-disabled` and sends the transcript
  (`the-enter-key-really-sends.test.tsx` is updated: it asserted the refusal).
- The ratchet above.

## After GPT Sol's plan review

Five findings, all taken.

1. **P1, a Send during a Try again that fails was never answered**, and would have sent on the next
   Try again that worked: the hook's retry path goes idle without `onEnd` on failure. Fixed in the
   field rather than the hook: a wish still standing when the phase reaches idle is cleared and
   counts as unsent, because every ending that *has* an `onEnd` calls it in the same synchronous
   step as going idle (`useDictation.ts` § `done`, the retry's success branch). Red-first test in
   `dictation-finish-then-done.test.tsx`. This was true of Feedback's Send before this work too.
2. **P2, Annotate's Ask AI** shares `waiting` with Save but is not the done action. Kept refused
   while busy; only Save goes live (`saveWaiting`).
3. **P2, the command bar's *Ask what you meant*** is Enter's touch twin. While busy it calls
   `submit`, which presses Enter once the words land (Greg's yes for Enter, 2026-10-05). Rows stay
   refused.
4. **P2, Skim's "unchanged" refusal** lived inside `canPlan`. `PurposeAsk` now takes `canPlan`
   (save, route, banner) and `hasWords` (not empty, changed) apart, and only `hasWords` is relaxed
   while dictating; each `plan` still refuses an empty or unchanged draft itself.
5. **P2, the ratchet** as first written would have refused correct code (`!dictate.busy && empty`)
   and Referee's preset buttons. It checks wiring only; the behaviour is in the box tests
   (`the-enter-key-really-sends.test.tsx` for Chat and the comment follow-up). Seen red before the
   wiring: eleven boxes listed.

Also: Referee's Run is `aria-disabled`, which stops no press, so its form returns before `submit`
when Run is dead, rather than letting a dead-looking button stop the microphone.

## After GPT Sol's code review

No rough-word, double-send or idle-race path found; the five plan-review fixes confirmed present.
Two findings, both fixed here rather than by the reviewer:

1. **Words that land and are then refused by the box** (too long for Help or a quiz, a Skim purpose
   left unchanged) said nothing. `onDone` may now return `false` for "refused", and the field sets
   `unsent`. Help's `ask`, both quiz `submit`s and Skim's done action return it; a box that returns
   nothing is taken as having sent. Red-first in `dictation-finish-then-done.test.tsx`.
2. **Nine older tests asserted the refusal** (Help, Referee, Candidates, Skim). Rewritten to the new
   behaviour. One of them exposed that the idle check read a stand-in hook's render between "idle"
   and `onEnd`; the check now runs a microtask later, so a render in that gap (a `flushSync`) cannot
   take a wish its ending is about to answer. Skim's stand-in Stop now goes to `transcribing`, as the
   real hook does.

Browser check (Sonnet, Playwright on the box, fake microphone, `/api/transcribe` routed): in Chat,
Send while recording, Enter while recording, a failed transcription ("… Nothing was sent.") and a
fast double Send each gave exactly one chat request or none. Feedback and the quiz boxes were not
driven in a browser.
