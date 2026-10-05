# An action offered in words that only a key can take

Up: [postmortems.md](../project/postmortems.md)

Report `spya-qem46c`, Greg, on an iPhone, 2026-10-05:

> I'm on an iPhone. I tried the voice input to the command bar to ask a question, and it said,
> Nothing matches. Press enter to something something. But there was no way to kick off that action
> on an iPhone because I don't have an enter key.

The command bar's offer to send an unmatched sentence to a model could be taken only with the Enter
key. A reader who dictated the sentence had no keyboard on screen, so the feature could be seen and
not used. Nothing was lost and nothing was sent; the cost was one feature that did not exist on a
phone for two days. The fix is plan
[261005f](../plans/261005f-command-bar-ask-button-a-finger-can-press.md).

## The root cause

`ask()` in [`CommandBar.tsx`](../../src/web/CommandBar.tsx) had one caller, the input's `onKeyDown`.
The offer itself was a string in a `<p>`. Every other thing the bar does is a row, and a row has
always had an `onClick`, so the bar looked finger-ready and nobody asked the question of the one
action that was not a row.

Two things made that easy to miss:

- **The bar is described as a keyboard instrument**, in its own header and in keyboard.md, and it
  was first built for ⌘K. Its hints were written from that seat.
- **The microphone arrived the same day as the ask** (261003f and 261003k, both 2026-10-03), in
  separate plans. Dictation is what removes the keyboard: the reader taps the microphone, speaks,
  and never focuses the box with a finger, so iOS never raises a keyboard and its Go key never
  exists. Each plan was right alone. The test for the pair, *takes a dictated sentence down the
  same path*, put the words in the box and then called `press("Enter")`, which a test can always do.

## The class

**An action offered in words that only a key can take.** The screen tells the reader to press a
key, and the key handler is the only route. It is invisible at a desk, and invisible in jsdom, where
a key event is as easy to dispatch as a click.

Its nearest relation here is a hover-only control on a touch screen
([touch.md](../project/touch.md)): an affordance that assumes an input device the reader may not
have. The difference is that this one *says* which device it assumes, in the sentence, which is what
makes it findable.

## The commit

`75f6927f4`, 2026-10-03, *261003k stage 2: the command bar asks a fast model what a sentence meant*.
It added `ASK_HINT = "Press Enter to ask what you meant."` and the `else ask()` in the key handler.
The plan's review asked about held keys, stale answers and paid double-presses, and not about what
presses it on a phone.

## The fix, and the one for the long term

Shipped: the offer is a button that calls the same `ask()`, with *or press Enter* beside it where
the main pointer is not a finger, and *Try again* in the state where Enter used to be the only
retry.

For the long term the same thing is right, stated as a rule: **`ask` has no caller that is a key
without a caller that is a press.** There is no deeper redesign waiting. Making the offer a row in
the list would also have done it, and was passed over: a row is a match for what was typed, and this
is the admission that nothing matched.

## What would have caught it, ranked by ease against value

1. **A sweep for on-screen words that say *press Enter*, each listed with what a finger presses
   instead.** Done: `tests/words-that-name-a-key-have-something-to-press.test.ts`. Two lines in the
   client say it today. It is aimed at the part of the class that announces itself, and it fails on
   the next hint written from a desk.
2. **The habit, for a plan review of anything in a box with a microphone: what does a reader who
   only spoke press next?** Free. Written into
   [dictation.md](../project/dictation.md), where the next box to gain a microphone is read.
3. **A test that dictates and then presses nothing but what is on screen.** Done for this bar
   (`tests/command-bar-pick.test.tsx` § the button that asks). As a general rule it is the same as 2.
4. Trying every new feature on a real iPhone before it lands. Rejected as a gate: agents on the box
   have no phone, and Playwright's touch emulation does not reproduce iOS's refusal to raise the
   keyboard for a scripted focus, which is the whole of this bug.
5. A lint rule that every `onKeyDown` branch has a matching `onClick`. Rejected: most key handlers
   here are arrows and Escape, whose finger route is a different gesture, and the rule would be all
   exceptions.

## What the sweep does not see

A key-only action that says nothing on screen. The Enter that retries after *Couldn't tell what you
meant* was one, found by GPT Sol's review of the plan and not by any check. There is no cheap
mechanical test for it; item 2 is what covers it.
