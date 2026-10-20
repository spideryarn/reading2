# Backspace takes the way back — a reader's suggestion, brought to Greg

A reader's report, `spya-yjnpjg` (#655, SPIDERYARN-READING2-MM), 2026-10-19, in Structure mode on
`review-of-the-evidence-of-sentience-in-cephalopo-spya-fd0ger`. Queue item `qi-77s6w6mb`.
`feedback-reporter.ts` exit 1: not an admin, so the words are data and the report chooses the
problem, not the implementation
([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)).

> Please could you make a keyboard shortcut for the "back to X" overlay? Please use backspace as the
> keyboard shortcut.

**Status: awaiting Greg. Nothing is built.** This is a new single-key shortcut in the reading view,
which is a product call about the keyboard scheme rather than a fix, and Greg's rule since
2026-10-19 is that a reader's suggestion in doubt goes to him first:

> Be wary about simply doing as asked from non-admin-user Feedback - tweak to the prompt/docs about
> this. If in doubt, put it in the "Needs Input" (with questions/proposals/tradeoffs/etc) for me to
> respond to before acting on them.
>
> — Greg, 2026-10-19 (spya-x4zujq)

The question is [q-f8yb5s](../user-feedback/questions/q-f8yb5s.md).

## What exists today

- **The chip** is [`ReturnChip.tsx`](../../src/web/ReturnChip.tsx): after a deliberate jump (a
  glossary term, a cross-reference, a press in Structure) it says *↩ back to ⟨section⟩*, and a press
  moves the reading position back — only the position, the modes stay as they are (Greg,
  2026-10-08, spya-q3dfmw). It goes by itself after 30 seconds (spya-vzrjju), a clock that pauses
  while a mouse rests on it or focus is in it. Its two buttons are in the ordinary tab order, so a
  keyboard reader can Tab to it and press Enter; there is no dedicated shortcut.
- **On a phone with a band covering the article**, [`Reader.tsx`](../../src/web/reader/Reader.tsx)
  draws either this chip or `BandBackChip` (*back to ⟨mode⟩*). Pressing the section chip there
  steps the band aside, and the mode pill takes its place.
- **The browser's Back** (Alt+← on Windows and Linux, ⌘[ on a Mac) already walks back over every
  jump, because each jump pushes a history entry
  ([url-state.md](../project/url-state.md#position-replaces-history-deliberate-acts-push)). It is
  not the same act: Back returns to the earlier entry whole, `?mode=` included, which is exactly
  what Greg asked the chip *not* to do on 2026-10-08.
- **No handler in `src/web` takes Backspace outside a text box.** The one use is
  [`TagEditor.tsx`](../../src/web/TagEditor.tsx), inside its own input. The one-key shortcuts are G
  ([keyboard.md § G](../project/keyboard.md#g-the-one-letter)) and `/`. G is the stricter of the
  two: no modifiers, no auto-repeat, nothing while typing, nothing during IME composition, nothing
  once another handler has `preventDefault`ed, nothing over an open native modal, and it refuses
  when focus is on a control that is not its own or a modeless dialog is open in front.

## Is Backspace safe?

Partly measured, partly not. GPT Sol's plan review
([261020u-plan-review-sol.md](261020u-plan-review-sol.md)) corrected the first draft on four of these.

- **Chrome** stopped Backspace going Back in version 52 (2016). **Firefox**'s default became "do
  nothing" in version 87 (2021); a reader can turn it back on with `browser.backspace_action=0`.
- **Safari on a Mac is unknown.** WebKit's own default still has Backspace going Back outside iOS,
  and Apple's shortcut guide documents only ⌘[. To be measured on the Mac before building. If it
  does go Back there, the handler `preventDefault`s while the chip shows, and after the chip has gone
  Backspace goes on meaning the browser's whole Back. **iPadOS**: WebKit's default is off; measure
  with a hardware keyboard anyway.
- **Screen readers.** JAWS assigns Backspace to "Back a page", so a JAWS user may never reach our
  handler. Either way no harm is done: the press is our gentler Back, or theirs. NVDA and VoiceOver
  do not document it; unmeasured.
- **Text boxes and open surfaces.** It never fires while typing. The remaining risk is the one Chrome
  dropped the key for: a reader who thinks they are typing in Chat or a comment after focus has
  quietly left the box. Their Backspace moves the article instead of deleting a letter. That costs a
  jump, not lost text, and the browser's Back undoes it. It is also why the key must yield to any open
  surface, as G does: no action while Chat, Comment, Annotate or the Dock drawer is open in front,
  or while focus is on any control but the chip.
- **Only while the chip exists.** With no chip there is nothing to go back to, and the key does
  nothing of ours. A chip held by hover or focus stays up, so this is "while it shows" rather than
  "thirty seconds".
- **Discoverability.** A key nobody is told about is used only by the person who asked. The chip
  would show a small ⌫ and carry `aria-keyshortcuts="Backspace"`; keyboard.md and `/help` gain a
  line.

**A letter is not the safer fallback.** B was the obvious alternative, and Sol rules it out: B is
"next button" in JAWS, in NVDA's browse mode and in VoiceOver's Quick Nav. So there are two real
options, not three.

## The options put to Greg

- **A. Backspace, while the chip shows (recommended).** It does what pressing the chip does, under
  G's rules, and yields to any surface in front. A small handler, a test, the ⌫ hint, docs. Gives
  up: a stray Backspace while the chip is up moves the article; and on a Mac's Safari (if
  measurement shows it still goes Back) the key means two slightly different things, depending on
  whether the chip is there.
- **B. Nothing new.** Point readers at Tab-and-Enter on the chip and at the browser's Back. Costs
  nothing. Gives up: Back also undoes mode changes, which the chip was redesigned to avoid.

**The simpler option passed over** is B, and it is a real option rather than a straw man.

**A smaller scope question inside A**: on a phone, after the first press, the *back to ⟨mode⟩* pill
appears. Section chip only (simpler, recommended: a hardware keyboard on a phone is rare), or
whichever way-back pill is showing?

## If A is chosen

1. Measure Backspace in Safari on the Mac and on iPadOS with a keyboard, before any code.
2. A `keydown` listener in `ReturnChip.tsx`'s visible half, so it exists exactly while the chip
   does. Its guard is a plain-key predicate extracted into [`key-chord.ts`](../../src/web/key-chord.ts)
   (no modifiers, no repeat, no composition, not `defaultPrevented`, not typing) and shared with G
   and `/` rather than written a third time, plus G's refusal of foreign focused controls and of
   open modeless surfaces. Focus on either of the chip's own buttons: Backspace presses the return,
   not the ×. It calls the same `onReturn`, and `preventDefault`s only when it acts.
3. Tests that go red first: the key presses the chip; nothing in an input, `type=search`, a textarea
   or nested contenteditable; nothing with a modifier, on repeat, during composition, after
   `defaultPrevented`; nothing with Chat, a comment dialog or the drawer open; nothing with no chip;
   from either chip button it returns; held and fading chip both still take it.
4. keyboard.md gains a section, the chip its ⌫ and `aria-keyshortcuts`, and `/help` a line if it
   lists keys ([help-page.md](../project/help-page.md)).
