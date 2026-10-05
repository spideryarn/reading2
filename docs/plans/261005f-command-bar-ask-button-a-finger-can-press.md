# The command bar's "ask what you meant" gets a button a finger can press

Up: [plans.md](../project/plans.md)

Report `spya-qem46c` (Greg, an admin; `feedback-reporter.ts` exit 0), Overseer queue qi-5ehfmgf5,
filed 2026-10-05 07:32 UTC from an iPhone:

> I'm on an iPhone. I tried the voice input to the command bar to ask a question, and it said,
> Nothing matches. Press enter to something something. But there was no way to kick off that action
> on an iPhone because I don't have an enter key.

## What is wrong

Since 261003k, a sentence that matches no row can be sent to a fast model that picks a command. The
only way to send it is the Enter key: `CommandBar.tsx` calls `ask()` from the input's `onKeyDown`
and from nowhere else, and the empty line is plain text, *No command matches. Press Enter to ask what
you meant.*

On a phone that key is the on-screen keyboard's Go key, and it exists only while the keyboard is up.
A reader can dictate without touching the box. In the reported iPhone run, the hook's attempt to
restore the box's focus after the microphone press did not leave a keyboard on screen. So the
sentence was in the box, the bar said to press a key, and there was no key. The rows of the bar never
had this problem, because a row is pressed with a finger.

The class: **an action with only a keyboard route**, in a bar that has had a microphone since the
day the action arrived.

## The change

One file of behaviour, `src/web/CommandBar.tsx`. The empty line, when the offer is made
(`offerToAsk`, unchanged), becomes:

```
No command matches.  [ Ask what you meant ]  or press Enter
                      ^ a real <button>       ^ hidden when the main pointer is a finger
```

- **The button calls `ask()`**, the same function Enter calls. One path, so every guard already in
  it holds for the press: signed in, something typed, nothing in flight, the microphone not busy.
- **It is `disabled` while `ask()` would refuse**: while the microphone is listening or its words are
  on their way (`dictationBusy`), and while a sentence is already out (`said.kind === "asking"`) or
  a run is starting (`"pending"`). A button that looks pressable and does nothing is the bug again.
- **`onMouseDown` prevents default**, so pressing it does not take the focus out of the box. At a
  desk the arrows and Enter go on working on the *Did you mean* rows; on a phone the keyboard stays
  as it was, up or down.
- **"or press Enter" is hidden under `pointer: coarse`** (Tailwind's `pointer-coarse:` variant, the
  primary pointer, as the size rules in touch.md use). An iPad with a keyboard loses three words and
  nothing else; Enter works whether or not the words are drawn.
- **Sized for a finger**: `pointer-coarse:min-h-10`, the height the bar's neighbours already use.
- `ASK_HINT` is replaced by two exported constants, `ASK_LABEL = "Ask what you meant"` and
  `ASK_OR_ENTER = "or press Enter"`, so the tests compare against what is drawn.

Nothing about what is asked, when it runs without a second press, or what is sent changes. No
server change, no prompt change, no schema.

## What it does not do

- ~~No retry button under *Couldn't tell what you meant*.~~ **Reversed by the plan review, below**:
  the button is there as *Try again*.
- **No asking automatically when a dictation lands on nothing.** It would save the press, but it is
  a guess made without being asked, which is the thing Greg's call 3 on the bar rules out, and it
  would send every mis-heard phrase to a model.
- **Signed out**: unchanged, no offer and so no button.

## The simpler option passed over

Change the words only, to something like *Press Go*. It names a key that is not on screen in exactly
the case reported, so it fixes nothing.

## Tests, red first

In `tests/command-bar-pick.test.tsx` (it already fakes the pick route):

1. A sentence that matches nothing draws a `button.cmdbar-ask`; **clicking it posts the sentence
   once**, and the answer is handled as Enter's is. Red today: there is no button.
2. The button is disabled while the microphone is armed, and a click then posts nothing.
3. The button is disabled while the sentence is out, and a second click posts nothing more.
4. Signed out: no button.
5. Under *Couldn't tell what you meant*: no button (the existing rule, now stated for the button).

The existing assertions on the empty line's words move to the new constants
(`tests/command-bar.test.tsx`, three in `command-bar-pick.test.tsx`).

## Docs that state the old sentence

- `docs/project/reading-view-overview.md` § The command bar
- `docs/project/dictation.md` (a dictated sentence "takes the typed one's path: Enter asks")
- `docs/project/touch.md`: one line, that an action offered in words needs something to press
- `src/web/help/help-topics.tsx`: the Help page's sentence gains "or the **Ask what you meant**
  button"
- `evals/README.md`: names the hint in passing; updated to the button's label

## Not checked on a real iPhone

The check is jsdom tests and a Playwright look at a phone-sized window on the box. Whether iOS keeps
the keyboard down after `useDictationField`'s delayed scripted refocus is inferred from Greg's
report, not observed directly. The button does not depend on the answer.

## Stages

One stage: the button, its tests, the docs. GPT Sol reviews this plan before, and the code after.

## GPT Sol's review of this plan, 2026-10-05

No P0 or P1; *changes needed*. All five taken, so parts of the plan above are superseded:

- **The retry is the same defect** (P2). *Couldn't tell what you meant* is also a timeout or a
  dropped connection, and Enter was its only retry. **Built**: the same button, saying *Try again*,
  which does not contradict the refusal the way the offer did. This replaces "No retry button" under
  § What it does not do.
- **More guard tests** (P2): the microphone transcribing as well as armed, another row's run
  starting, and a sentence over `MAX_SENTENCE`, which is refused out loud and not silently. Added;
  the code review then gave that deterministic refusal its own explanation and no *Try again*.
- **The note in `docs/user-feedback/`** (P2) was missing from the docs list. It is
  `261005_0732-iphone-command-bar-says-press-enter.md`.
- **A postmortem** (P3), since the class has a name:
  [261005f](../postmortems/261005f-an-action-offered-in-words-that-only-a-key-can-take.md), with a
  sweep test for contiguous product-control strings outside Help that say *press Enter*.
- **44px, not 40** (P3): `pointer-coarse:min-h-11`, the current finger floor. And the tests now
  assert the two `pointer-coarse` classes, since jsdom cannot evaluate them.

The review found that preventing default on `mousedown` keeps focus without suppressing the click,
and that `pointer: coarse` is an acceptable proxy since the button is there either way. That was not
observed on a real iPhone.

**One change of my own while building**: the button is `aria-disabled`, not `disabled`. A disabled
button receives no `mousedown`, so a press on it would have pulled the focus out of the box, which is
the thing the handler is there to prevent. `ask()` stays the lock, as it is for the rows.

## GPT Sol's review of the code, 2026-10-05

No P0 or P1; *approve*, with six things it fixed in the stage and I read and kept:

- Enter or Space on the focused button left the focus on a button that goes away when suggestions
  arrive. A keyboard press now hands the focus back to the box; a finger does not, so the phone
  keyboard is not raised.
- An over-long sentence got *Try again*, which could only repeat the refusal. It now has its own
  sentence, *That sentence is too long. Shorten it and try again.*, and no button until the box
  changes. **A new reader-facing sentence, for Greg to reword if he wants.**
- The sweep test parsed comments by hand and could swallow code. It now walks the Babel AST.
- The docs said a dictation *never* raises the keyboard. `useDictationField` does try a delayed
  refocus, so they now say a dictation can finish with no keyboard on screen, which is what the
  report establishes.
- Help said Enter was the only way to choose a *Did you mean* row.
- Two declarations I had joined onto one line.

A Sonnet subagent looked at it in Chrome on the box with an iPhone 13 device profile: the button is
44px high, *or press Enter* is hidden, a tap posts once and the box keeps the focus.
