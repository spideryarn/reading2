# A microphone in Search mode's box

Report `spya-ubbygh` (#746), suggestion, from Greg (admin), 2026-11-02 23:07 UTC, on
`/read/constitution?mode=search`:

> Search should have a microphone dictation button

## Background

Dictation is one shared machine: `useDictationField` (src/web/useDictationField.ts) plus
`DictationButton` and `DictationStrip` (src/web/DictationStrip.tsx), on seventeen boxes
([dictation.md § Adding it to a box](../project/dictation.md#adding-it-to-a-box)).

The house rule ([controls.md](../project/controls.md), Greg's yes on `q-ccv9qq`, 2026-10-20) gives
the microphone to a box for *"more than a few words of the reader's writing (not a URL, a search or
a title)"*, and Greg said then *"not … the search bar on the homepage. So use your judgment"*. This
report is Greg asking for the exception by name: Search mode's meaning matcher takes a description
(*"describe what to look for…"*), which is prose, unlike the shelf's filter. The shelf's search box
stays without one. The controls.md row is a rule, so its wording is not changed here; the exception
is recorded in dictation.md and search.md, which own it.

## What the box does today

`Box` in src/web/SearchPanel.tsx is one `<input>` over two sources of truth: in **words** mode the
text is `?find=` (hits follow every keystroke); in **meaning** mode it is a draft shared with the
bar's box, and each edit feeds the **typing session** (`TypingControls.edit`) which asks a quick
search after a 600 ms pause and revises the same row on later pauses. Enter or *find* flushes the
session (quick now, then thorough). Blur for longer than a pause ends the session.

## The change

1. **The same control.** `useDictationField` on the box (`context: {kind:"article", slug}`,
   `report: dictationReporter("search")` — a new `DictationSurface`, `keep:
   keepDictation(\`search:${slug}\`)`), `readOnly={dictate.readOnly}` on the input, a
   `DictationButton` to the right of the field (hidden where unsupported, as everywhere), and a
   `DictationStrip` under the field. The panel already takes `slug`; it is passed down to `Box`.
   In both matchers: the box is one input, and a mic that came and went with the toggle would be a
   control that moves. Words-mode dictation simply lands in `?find=`.
2. **Half-heard words never ask a search.** The hook's `onChange` writes the draft (or `?find=`)
   but does **not** call `session.edit`; Chromium's live phrases would otherwise trigger a paid
   quick search on rough guesses at every 600 ms pause. When the dictation ends (`onCommit`, which
   the hook calls only at a dictation's end), meaning mode calls `session.edit(<landed words>)`
   once, so the dictated words then behave exactly like typed ones: a quick search after the
   pause, revised by later edits.
3. **Enter and find, while the microphone is busy, stop and search when the words land** —
   `dictate.finishThenDone()`, Feedback's pattern ([dictation.md](../project/dictation.md) §
   Adding it to a box: "goes one better than disabled"), rather than a refused press. `onDone` is
   the box's own `ask` (Enter's function), so a **double press on Stop** does what Enter does
   (`done="enter"` on button and strip, like the command bar). In words mode `ask` does nothing,
   which is what Enter does there besides putting the keyboard away.
4. **Layout.** A new `.srch-line` flex row holds `.srch-field` and the microphone, so the cross
   and spinner (absolutely positioned inside `.srch-field`) are untouched. On a phone the band is
   the full width; the mic is the same 28–32px control every other box has.

## Considered and not done

- **Mic only in meaning mode** (as *find* is). Simpler to reason about words mode, but a control
  that appears and disappears with the toggle, and a mid-dictation switch would unmount it.
- **Auto-asking the full meaning search the moment dictation ends.** That is what a double press
  is for; a single Stop leaves the words to edit, as every other box does, and the pause-asks-quick
  behaviour already gives a first answer.
- **The bar's quick-search box in the Dock**: not asked for, and on a touch screen it is not drawn.

## After GPT Sol's plan review

[261103a-…-plan-review-sol.md](261103a-microphone-in-the-search-box-plan-review-sol.md), seven
findings. Taken:

- **The landed words, and only on success.** Not `onCommit` (it runs before the render, and also on
  a failed ending): `heard` holds the latest words, and an effect on the busy edge hands them to the
  session only if `dictation.error` is null. A failed transcription leaves the rough words for an
  edit or Retry.
- **Keys typed while armed** wait in `heard` too, rather than calling `session.edit`.
- **Busy before `ready`**, in Enter and *find*: on Safari the box is empty while recording.
- **`doneKey: matcher`**, so a words-mode wish cannot turn into a paid meaning search after a
  toggle.
- **Words-mode completion puts the keyboard away**, as Enter does there.
- **`ask` clears `heard`**, so a double press's flush is not followed by an edit into a second
  session.
- The touch target is the shared 40px, not 28–32px (the plan text was wrong; the control is the
  shared one, unchanged).

Not taken, as the shared hook's existing behaviour on every box: a blur longer than a pause (a
click on *find* mid-dictation) ends the open typing session, so the landed words start a new row
rather than revising one typed earlier — the same as typing, clicking away and coming back; and an
outside write to the shared draft (↺, the command bar) while dictating is refused by the hook's span
check, its `[mic-moved]`-style guard everywhere else.

## After GPT Sol's code review

[261103a-…-code-review-sol.md](261103a-microphone-in-the-search-box-code-review-sol.md). Sol fixed
three P2s in place, each with a test it saw fail first:

- **`dictation.error === null` did not prove delivery**: an empty or refused transcript ends with
  no error, and a successful one can keep a warning. `useDictationField`'s `onCommit` now receives
  `delivered` (its stale comment, which said it also ran on blur and ⌘+Enter, corrected); the
  other callers ignore the argument.
- **Clearing the box mid-dictation** left the words queued for the session; the cross and Escape
  now drop them.
- **A matcher switch still let a words-mode wish become a paid search through `edit`**, not only
  through `onDone`; the hand-off now happens only in the matcher the dictation started in.

And Help's sentence was made exact about timing, then reworded without "transcript".

## Tests (red first)

`tests/search-box-dictation.test.tsx`, with `useDictation` stubbed as in
tests/comment-note-dictation.test.tsx:

- the box has a microphone;
- live phrases while armed change the box but call no `typing.edit`; the end of the dictation
  calls it once with the landed words;
- Enter while armed asks nothing then, and asks once the words land;
- a double press on Stop (`onDone`) asks with the landed words.
