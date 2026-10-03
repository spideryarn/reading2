# 261003i — The comment box never loses a draft, and Ask AI is a button

Report: spya-pnnamg (Greg, 2026-10-03 19:42, on the Entropy article), relayed by the Overseer.
Follows [261003e](261003e-span-highlights-with-a-colour.md) (colours, and the touch button) and
bears on its open question `[Q-highlight-menu]`.

> I highlighted a word I didn't understand and clicked highlight or comment, and then I ticked the
> save and ask AI, and then clicked something else, and I don't know what happened, but it
> disappeared. So maybe save and ask AI should be a button, or I think it should auto-save, and so
> then ask AI would be a button. And it's just generally a bit confusing.
>
> — Greg, 2026-10-03 (spya-pnnamg)

## What happened to him

The box a selection opens (`AnnotateDialog`) holds everything as a draft in React state until its
primary button is pressed. Nothing is stored before that, and **five things throw the draft away
without a word**:

1. **Cancel**, 2. the **×**, 3. **Escape** — all `onCancel`, which is `setAnnotating(null)`.
4. **Another selection in the prose.** `selectProse` replaces the anchor, and the box's own effect
   on the anchor resets the words, the colour and the tick-box. A two-character skid of the mouse
   across a paragraph is enough. On touch, selecting again and pressing the button does the same.
5. **Leaving** — another article, another route, a reload.

And the tick-box (*"Also ask the AI about it"*) does nothing when ticked. It only changes what the
primary button will do. He ticked it, reasonably took that for the action, and went elsewhere.
Which of the five took his draft is not knowable from the report; all five are closed here.

## What gets built

**1. Ask AI is a button.** The tick-box goes. The box ends in:

```
   Discard                                  [ Ask AI ]  [ Save ]
```

- **Save** stores the comment (a bookmark if nothing was written), as now.
- **Ask AI** stores it and opens the conversation on those words, as the ticked box did. One press,
  and it says what it does. It is the only control that costs a model call.
- **Discard** (was *Cancel*) throws the draft away. It is the only thing that does.

**2. Every other way out saves a draft that has something in it.** "Something in it" means any of:
words in the box, a colour picked, a Referee placement made. Then the ×, Escape, another selection,
and the box unmounting for any reason all store it as a comment first, exactly as Save would, and
never ask the AI. A box nobody touched stores nothing, so selecting a sentence to copy it still
leaves no trace.

The textarea's own first Escape, which clears the words the reader typed, stays: that is the
reader removing their words, not the box losing them.

### How

All inside `AnnotateDialog`, which is the one place every exit passes through:

- `dirty` = `body.trim() !== "" || colour !== null || mark !== NO_MARK`.
- One `flush()` that calls `onSave(draftId, body, false, mark, colour)` at most once per draft (the
  existing `sending` latch, and the draft id that is minted once per anchor, which is what makes a
  repeated create idempotent on the server).
- Called from: the × and Escape (in place of `onCancel` when dirty), the anchor-change effect
  **before** it resets the fields (so the old passage's draft is stored against the old anchor),
  and an unmount cleanup.
- `onSave` today reads the anchor from Reader's `annotating` state, which has already moved on by
  the time an anchor-change flush runs. So **the box passes the anchor it was drafted against** to
  `onSave`, and Reader stops reading its own state there. Reader also stops calling
  `setAnnotating(null)` unconditionally in `onSave`: a flush caused by a new selection must not
  close the box that selection just opened.
- **Dictation.** Save refuses while the microphone is armed or the field is read-only, because the
  text is not final. A flush in that state stores the last settled text; it must not store live
  guesses. If there is no settled text and no colour, it stores nothing.
- **The opening read (`loaded`).** Save waits for the comment list because that read's answer
  replaces the list ([260908c](../postmortems/260908c-an-opening-read-can-erase-a-later-write.md)).
  A flush cannot wait: the box is going away. The row is safe on the server either way; the risk is
  the tab forgetting it until a reload. Ask the reviewer whether `useComments.create` should hold a
  create until the read lands (which would fix the race at its root and let Save stop gating), or
  whether the flush should simply go and accept the rare tab-side miss.

### What is not changed

- A selection still opens the box on mouse-up, and the touch button still opens it on a tap.
- Nothing is stored for an untouched box. **This is the one place the build is narrower than
  "it should auto-save" read literally**: storing a bookmark the moment the box opens would leave a
  mark behind every time a reader selects words to copy them, which is the complaint of 2026-09-05
  ([comments.md § Copying the passage](../project/comments.md#copying-the-passage)) made worse.
- The simpler option passed over: **only** make Ask AI a button. It fixes the confusion he named
  and not the loss; exits 1 to 5 would still eat a typed note.
- Live autosave on every keystroke (create on first change, then patch) was also passed over: it
  needs a create-then-edit ordering the store does not have for a comment not yet created, and
  saving on the way out gives the same guarantee with one call.

## Tests, red first

Mounted (`AnnotateDialog` alone, and with the Reader-shaped harness the touch tests use):

- Typed words, then ×: `onSave` called once with those words and `ask: false`. Same for Escape (with
  the box's Escape, not the textarea's first one), and for a colour and no words.
- Typed words, then the anchor prop changes: saved against the **old** anchor; the box now shows the
  new passage, empty; the new passage is not saved.
- Typed words, then unmount: saved once.
- Untouched, then each of the exits: nothing saved.
- Discard with words typed: nothing saved.
- Ask AI: saved with `ask: true`, once; then an unmount does not save a second time.
- Save then unmount: once.
- Dictation armed with live text: the flush stores the settled text only.
- The tick-box is gone; the tab order test (`tab-traversal-in-chrome`) still walks out.

## Stages

One stage: the box, Reader's `onSave`, the tests, `comments.md` (§ What a comment is now, and the
header comment of `AnnotateDialog.tsx`, which argues for the tick-box and must now say why it went),
the feedback note. GPT Sol reviews this plan first and the code after. Browser check by a Sonnet
subagent on desktop, an iPad profile and a phone width.

## What this says about `[Q-highlight-menu]`

His last sentence is the larger finding: *"it's just generally a bit confusing."* The box asks a
reader who only wanted to mark a word to read a quote, a colour row, a text field and three
buttons. Option B of that question (colour dots at the selection, one press, the box only for
*Comment…*) removes the box from the common case altogether. This plan makes the box safe; it does
not make it light. The recommendation for B stands, and this report is evidence for it.
