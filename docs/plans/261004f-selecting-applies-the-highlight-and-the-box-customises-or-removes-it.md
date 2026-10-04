# 261004f — Selecting applies the highlight, and the box customises or removes it

Reports: spya-rze8qh, spya-xhvxue (Greg). Overseer queue: qi-pzhk52ax, qi-ashkp938. This answers
`[Q-highlight-menu]` (asked in [261003e](261003e-span-highlights-with-a-colour.md)) and
`[Q-save-on-select]` (asked in
[261004a](261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md)),
which were the same question from two sides.

> Q-highlight-menu how about if selecting text automatically applies the highlight and also pops up
> the fuller box to allow the user to customise (or remove) it, and they can just click off if
> they're happy with the highlighting
>
> — Greg, 2026-10-04

A fifth option: not the box-with-dots (A) and not the small menu (B). No menu is built.

## Where things stand (on dev, deployed)

Select words and the box opens with **yellow already picked** (261004a). Save, × and Escape store
it. But the words are not painted until it is stored; clicking elsewhere on the page does not close
the box; and an untouched box that goes away any other way (another selection, leaving) stores
nothing. On touch, the box opens from the *Highlight or comment* button under the selection.

## What changes for the reader

1. **The words turn yellow the moment you let go of the drag.** The box opens beside them, as now.
2. **Click anywhere else and you are done**: the box closes and the highlight stays. So does every
   other way out (×, Escape, Save, another selection, leaving the page).
3. **One press removes it**: *Remove highlight*, where *Discard* was. The paint goes and nothing is
   kept.
4. **Copy means copy.** Pressing Copy in the box copies the words and takes the highlight off; the
   box says *"Copied. Not highlighted: pick a colour to keep it."* Closing then keeps nothing.
5. **Changing your mind about which words** leaves one highlight, not two: a new selection that
   overlaps the one whose box is still open and untouched replaces it.

```
   select ──► words go yellow, box opens
                │
                ├─ click off / × / Esc / select elsewhere / leave ──► kept
                ├─ pick a colour, write, Ask AI                    ──► kept, as changed
                ├─ Remove highlight                                 ──► gone
                ├─ Copy                                             ──► copied, not kept
                └─ re-select overlapping words (untouched)          ──► replaced by the new one
```

## The design decision: painted at once, stored when the box goes

The highlight the reader sees on letting go is **provisional**: drawn from the open box's draft,
and written to the store when the box goes away. Every way out stores it, so to the reader it was
applied at the moment of selection, which is what was asked for.

**Passed over: write the row on mouse-up and make the box an editor of a stored comment.** It is
the literal reading, and it is worse here in three ways. Every mis-drag and every copy would be a
create followed by a delete, which is exactly the create/delete race that took seven review
findings to make safe in 261003i (the `useComments` hold). The box would need three PATCH paths
(words, colour, placement) where it has one create. And Remove would leave tombstones. The
provisional version reuses the draft box, its single create, its latch and its `pagehide` write
unchanged.

**What the provisional version gives up:** a crash or a killed browser in the seconds the box is
open loses that highlight (a reload or a closed tab does not: `pagehide` writes it). Named in
`comments.md`.

## How

### The box (`src/web/AnnotateDialog.tsx`)

- **Every exit stores an untouched box that has a colour.** 261004a's split between explicit closes
  (store) and implicit ones (store only if touched) goes for a coloured draft: unmount and
  `pagehide` store it too. The rule is now one line: *a draft with something to store is stored,
  unless Removed or copy-only.* A Referee box (no default colour) is unchanged, because untouched
  it has nothing to store.
- **StrictMode.** In development React runs mount, cleanup, mount on the same instance. The cleanup
  must not store. So the unmount flush is deferred one tick and cancelled if the instance's effect
  runs again; a real unmount lets it fire. (261004a kept untouched-unmount storing nothing partly
  to avoid this; it now has to be solved.) The latch must still allow exactly one send.
- **Click off.** A `pointerdown` outside the box closes it through the same path as ×. Inside means
  the box and anything it portals (the dictation strip, a tooltip). The press that closes it is not
  swallowed: a click on a link still follows the link, and a drag that starts in the prose still
  becomes the next selection.
- **Remove highlight** replaces *Discard*: same behaviour, a name that says what it does, styled
  as a button rather than a text link, and still set apart on the left. In Referee mode, where
  there is no highlight, it stays *Discard*.
- **Copy** sets the draft copy-only: the colour row goes to *No colour*, the provisional paint
  goes, and the hint line says so. Picking a colour or typing afterwards makes it a highlight
  again. This extends 261004a's `copied && !isTouched` rule to every exit and makes it visible.
- **The colour is lifted** so the prose can paint it: the box reports its draft's colour (and
  copy-only, and removed) to Reader through one callback.
- **Focus.** With a mouse the textarea keeps its autofocus (type at once, as now). **From the touch
  button it does not**: focusing a text field on an iPad raises the keyboard over the passage just
  highlighted, for a reader who most often wants nothing more. The box takes focus on its
  container instead.
- The hint under the buttons: *"Highlighted. Click away to keep it. Nothing is asked unless you
  press Ask AI."*

### The prose (`Reader.tsx`, `TableView.tsx`)

- While a box is open with a colour, Reader adds one **provisional mark** to what the prose draws:
  the box's anchor and colour, under an id that is not a comment's. It goes to the mark path only,
  never to the gutter count, the drawer, the margin or Quotes, which read stored comments.
- A press on the provisional mark does nothing (its box is already open).
- When the draft is stored, the optimistic row `create` adds takes over; the provisional mark is
  dropped in the same render, so the words do not flicker.
- **Overlap means correction.** In Reader's `onSave`, a draft that arrives from an untouched box
  being replaced (not closed) is dropped when the new box's anchor is in the same block and its
  range overlaps. Both anchors are selections, so their `start`s are the same offset space.
- The browser's own selection is cleared once the box is open: the paint now shows which words,
  and on touch this also puts away the OS handles and callout.

### Touch

**Selecting is the long-press plus the *Highlight or comment* button, as now; the button press is
what applies the highlight.** The page does not highlight every OS selection by itself: on an iPad
the same long-press is how a reader copies, looks up or shares through the system callout, and the
handles are still being dragged when a selection first exists. After the press: the words are
painted, the selection and its handles are cleared, the box opens without the keyboard, and a tap
anywhere else keeps it. `[Q-touch-auto-highlight]` below.

## Tests (red first)

`tests/annotate-dialog-keeps-a-draft.test.tsx` and the Reader-shaped harness:

- Untouched: unmount stores yellow; `pagehide` stores yellow; another (non-overlapping) selection
  stores the first and opens the second.
- StrictMode: mounting stores nothing; a later real unmount stores once.
- Click off: a pointerdown outside stores and closes; inside (textarea, swatch, dictation) does not.
- Remove highlight: nothing stored by it or by the unmount after it; provisional mark gone.
- Copy: colour row shows No colour, hint changes, every exit stores nothing; then a colour press
  and an exit stores it.
- Overlap: untouched box, overlapping re-selection → the first is not stored, the second is open.
  Touched box, overlapping re-selection → both stored (it had the reader's words).
- Provisional mark: present in the prose with the box's colour while open; follows a colour change;
  absent for *No colour*, copy-only and Referee; not counted in the gutter or the drawer; no
  duplicate mark in the render after the draft is stored.
- Touch entry: no textarea focus; selection cleared.
- Referee: untouched exits store nothing, as now.
- The 261004a cases that assert "untouched unmount / another selection / pagehide: nothing" change;
  list each one changed in the report.

## Stages

One stage. GPT Sol reviews this plan, then the code. Browser check by a Sonnet subagent at desktop,
an iPad profile (Chromium and WebKit) and a phone width. Then the bookkeeping that closes
spya-rze8qh, spya-xhvxue and qi-pzhk52ax: one note naming both reports, `feedback-endings`, the
queue. `comments.md` § The box a selection opens is rewritten around the new rule; `touch.md`'s
section and the help topics are corrected.

## Deferred, by name

- The small colour menu at the selection (option B). Greg chose otherwise.
- Stepping, spine strip and visitor rows for highlights in Quotes (261003h's list).
- A highlight across two paragraphs.

## Questions for Greg

**[Q-touch-auto-highlight]** On an iPad or phone, should words be highlighted as soon as you select
them, with no button press?

Background: with a mouse, letting go of the drag is a clear end to selecting, so the highlight is
applied then. A finger has no such moment: you long-press, then drag two handles, and the same
selection is how you copy, look up or share with the iPad's own menu.

- **A (as built, recommended): one tap on *Highlight or comment*** applies it and opens the box.
  The iPad's own copy / look-up menu keeps working for selections you did not mean as highlights.
- **B: highlight automatically** about half a second after the handles stop moving. No tap. Costs
  about half a day. It gives up the iPad's own menu for anything but highlighting (every selection
  becomes a highlight you must remove), and a pause while dragging the handles would highlight a
  half-made selection.

What would decide it: if on the iPad you only ever select in order to highlight, B saves a tap
each time; if you also copy or look words up, A.

Still open from 261004a, not changed here: `[Q-ask-ai-colour]` (should a word you only asked about
also stay highlighted). With this plan the word is painted on selection, so it stays yellow unless
*No colour* is picked.

## GPT Sol's plan review, 2026-10-04: build with changes — and the design changed

[261004f-apply-on-select-plan-review-sol.md](261004f-apply-on-select-plan-review-sol.md). Six P1s,
two P2s. **This section replaces "The design decision" and "How" above.** "What changes for the
reader", the touch section and the question stand.

Four of the P1s (E1 a closed box no longer protects an unsent create; E2 a tick-deferred unmount
flush races page exit; E5 the paint vanishes while the create is held; E6 the provisional mark
needs a real representation) are all costs of *painted now, stored later*. Sol's closing note was
that the design this plan passed over is cheaper than it claimed, and on checking, it is:

**The row is written on selection, and the box that opens is `CommentDialog`**, the box a click on
any highlight already opens. It has the words field (`onEdit`), the colour row (`onRecolour`),
*Ask the AI about this…*, and Delete; it focuses its close button, not a text field, so it raises
no keyboard on an iPad. This is the gutter bookmark's pattern (`bookmarkBlock` in `Reader.tsx`:
create, then open the box on the row), applied to a selection. My reasons for passing it over were
wrong on two counts: the box does not need three new PATCH paths, because `CommentDialog` already
has them and they already share one write queue; and the create/delete race is the one 261003i's
reviews made safe, with tests. What it costs is a create and a delete for a mis-drag or a copy.

So:

- **`selectProse`, outside Referee mode**: `create({ …anchor, colour: "yellow" })` and open the
  comment's box as soon as its row exists (at once when the list has loaded; after the opening read
  when it has not, which is the first seconds of a page, and named in the docs). The paint is the
  ordinary mark of an ordinary row. No provisional mark, no unmount flush.
- **Referee mode keeps `AnnotateDialog`** exactly as it is: a draft, no default colour, placement.
- **A fresh box** is one opened by the selection that made its comment. While fresh:
  - **click off closes it** (a `pointerdown` outside the box and anything it portals; never
    swallowed). An ordinary comment box, opened from a mark or the drawer, does not gain this.
  - Delete is labelled **Remove highlight**.
  - A hint: *"Highlighted. Click away to keep it."*
  - **Copy.** A button, *Copy, don't highlight*: copies the words and deletes the row. The same
    happens on a native copy (⌘C) of the still-live selection. Only while the row is **pristine**
    (yellow, no words, no conversation, no placement); once the reader has changed it, Copy just
    copies. The removal follows the clipboard write's real outcome, not the press (E7).
- **Overlap means correction** (E3), decided in `selectProse` where both anchors are known: the
  fresh row is remembered for the gesture that closes its box (set on the click-off `pointerdown`,
  cleared by the next `pointerdown`), and a selection completed in that gesture, in the same block
  with an overlapping range, removes the fresh row if it is still pristine. Mouse only; by touch a
  second selection needs the first box closed, and both are kept.
- **E4**: the mouse's selection is left alone, as now (the click that ends a drag reads it to avoid
  following a link). Touch clears it on the button press.
- **E1**, the part that survives the redesign: a create that has not yet been sent (held behind the
  opening read, or waiting on a token) is replayed with the keepalive writer on `pagehide`, from
  `useComments`, with the same id. This is general, not specific to the box.
- **E8**: the fresh flag carries `input: "mouse" | "touch"` only if something needs it; with
  `CommentDialog`'s focus on its close button nothing does. Portals inside the box count as inside.
- A create that fails removes its row, and with it the paint and the box; the Dock says the write
  failed, as for any comment. Nothing is shown as highlighted that is not stored or being stored.

**What `AnnotateDialog`'s draft machinery (261003i, 261004a) is now for:** Referee mode only. It is
not deleted here; whether Referee should follow is a separate question, and removing a working path
in the same change as replacing it is how regressions hide.

Tests follow the new design: selection creates a yellow row and opens `CommentDialog` on it
(mounted, Reader-shaped harness, plus source assertions on `Reader.tsx` as the other tests do);
click-off closes a fresh box and not an ordinary one; Remove highlight; Copy on pristine deletes
after a successful write and not after a refused one; ⌘C the same; overlap correction keeps a
touched row and removes a pristine one; Referee still opens `AnnotateDialog`; the held-create
`pagehide` replay in `useComments`; a failed create leaves no box.

## As built, 2026-10-04: five things the section above did not say

The design above is what was built. Building it against the whole app
([`tests/selecting-applies-the-highlight.test.tsx`](../../tests/selecting-applies-the-highlight.test.tsx)
mounts `App`) turned up five things that follow from *the row is painted between `mouseup` and
`click`*, each now in code and in [comments.md § The box a selection opens](../project/comments.md#the-selection-box):

1. **The paint collapses the mouse's selection.** `annotateHtml` goes in through `innerHTML`, the
   paragraph's nodes are replaced, and a range over removed nodes collapses. So "the mouse's
   selection is left alone" (E4) needed work to be true: `selectAnchor` in `selection.ts` puts it
   back over the new mark. Without it, select-then-⌘C copied nothing, and the native-copy rule had
   no selection to recognise.
2. **So E4 needed the latch after all.** The click that ends a drag can no longer ask the live
   selection whether a drag just ended. `TableView` remembers that the last `mouseup` completed a
   selection, for the one click that follows.
3. **The same words still selected are not a second selection.** A press on a gutter icon does not
   clear the selection, so its `mouseup` re-read the same anchor. That only re-opened a draft box
   before; now it would have written the highlight twice. `TableView` remembers the anchor it last
   reported until the next press in the prose.
4. **A click on the words just highlighted is a click away.** Its `pointerdown` closes the fresh
   box; its `mouseup` lands on that highlight's own mark and would have opened it straight back.
5. **The press arrives before the blur.** Words typed in the fresh box and not yet committed are
   committed by taking focus off the field before the box closes.

E1 was built as Sol worded it: **every unsettled create** is replayed on `pagehide`, not only ones
known to be unsent. The hook cannot see past `fetchOk` to tell a held request from one waiting on a
token, and the store answers a repeated id with the same anchor and colour as the same comment
(`pg-comments.ts` § `create`), so the cost is one redundant `POST` for a request already on the
wire.

**Not built, and not decided:** the fresh box says nothing after *Copy, don't highlight* succeeds,
because the box and the paint go; the earlier section's *"Copied. Not highlighted: pick a colour to
keep it."* belonged to the provisional design, where the box stayed. And the hint reads *Click away*
by touch too.

