# Escape leaves Metadata, ⌘-K from inside text fields, and a Metadata icon of its own

Up: [plans.md](../project/plans.md)

Three small reports from Greg, filed from the Feedback button on 2026-10-04 (queue item
`qi-dkd9cq76`). All three land in [`src/web/Dock.tsx`](../../src/web/Dock.tsx).

> If I hit escape while in metadata mode, sort of hide the metadata mode, as if I'd clicked on the
> metadata mode button to take me back to wherever I was before.
>
> — Greg, 2026-10-04, spya-ynx97n

> The Command-K keyboard shortcut for the command bar doesn't seem to work when the focus is already
> on the search mode input box. I don't know if this is true of other input boxes, but I want to be
> able to hit Command-K at more or less any time from within the reading view.
>
> — Greg, 2026-10-04, spya-szdjek

> Can we look for a different icon in the bottom bar for metadata mode? Because that information
> icon is the same one we use elsewhere for information about a mode, and I think they are
> different, and so it's a bit confusing to use the same icon for both.
>
> — Greg, 2026-10-04, spya-jt4gmg

The bottom bar is being decluttered
([interface-vision.md § Decluttering the bottom bar](../project/interface-vision.md#decluttering-the-bottom-bar)).
Nothing here moves or removes a button.

## 1. Escape on the Metadata page goes back to the article

**What:** a `useMetadataEscape` hook beside `useMetadataChord`, live only when `view === "metadata"`.
On Escape it calls `navigate(metadataHref)`, the same href the Metadata button and ⌘-Enter already
use there, so the three cannot disagree about where "back" is.

**Where it sits in the Escape tiers**
([the escape inventory](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md)):
a bubble-phase `window` listener, the last tier before the platform (T3). It is the page itself, so
everything in front of it gets the press first. It stands down when:

- the event is already `defaultPrevented`, or never arrives because a nearer surface stopped it (a
  hover card, a Floating UI popover, the title editor, the page-search box with text in it);
- a native `<dialog>` is open (Feedback, the command bar): the same `dialog[open]` query
  `useEscapeToClose` makes;
- **focus is in a text field** (`isTyping`): the tag editor, the page search, the sharing fields.
  A reader who presses Escape in a box means the box.
- a modifier is held, or the key is auto-repeating, or an IME is composing.

**Passed over:** `history.back()`. Arriving from a pasted link or the shelf, it would leave the
article altogether, the reason 261003c gave for the button. Also passed over: letting Escape in an
*empty* text field leave the page. It is one more rule to explain, and the cost of being wrong is a
reader thrown off a page they were editing.

## 2. ⌘-K opens the command bar from inside a text field

**What:** `useCommandBarChord` drops its `isTyping` refusal. The other refusals stay: auto-repeat,
Shift, Alt, IME composition, and an open native `<dialog>`.

**"Keep a typed ⌘-K in a text field from doing anything else":** the listener moves to the
**capture** phase on `window` and, when it claims the press, calls `preventDefault()` and
`stopPropagation()`. Capture is what makes "from anywhere" true: two containers in the live
conversation (`LiveButton`, `LiveStatus`) stop every keydown from bubbling, and a bubble listener
on `window` never hears a press made inside them. `preventDefault()` stops the browser's own
meaning (Firefox's address bar; Ctrl-K's kill-to-end-of-line in a Mac text field);
`stopPropagation()` stops the field's own `onKeyDown` from seeing it. A press it does not claim is
left entirely alone, as now.

**Why the old refusal can go.** Its reason was "⌘-K is a text-editing chord in several editors".
None of our fields binds it (grep of `src/web/` for a modified `k`: only this hook). The bar is a
native modal `<dialog>`, so the field behind it keeps its text, and closing the bar gives focus back
to the field it came from, which is the platform's behaviour for `showModal()`.

**What still refuses, and is not changed here:** a field inside another native modal — the Feedback
dialog's box, the Lightbox. Two `showModal()` dialogs would stack. Those are not the reading view's
inputs; said in the debrief.

**Passed over:** keeping `isTyping` and exempting named fields. A list of exemptions is the thing
Greg's "more or less any time" asks us not to have.

## 3. Metadata's bar icon

`Info` is the (i) of "about this mode" (`BandAbout`, and the same glyph in Quotes, Glossary,
Referee, Settings and the plan help). The Metadata button takes **`FileCog`** instead: a document
with a cog, for "the machinery behind the article", which is how the Dock's own comment describes
the page. Not used anywhere else in `src/web/`. The `-off` rule in
[icons.md](../project/icons.md) warns that composite icons can smear below 16px, so the browser
check looks at it at bar size on desktop, iPad and phone; if it smears, fall back to
`SlidersHorizontal`.

The label, the card, the position and the button itself are unchanged.

**Open, for the debrief, not blocking:** the choice of glyph is taste. Alternatives: `FileText`
(a plain document; already the shelf's and the PDF note's icon), `SlidersHorizontal` (controls;
already Profile's section icon), `TableProperties` (a property sheet).

**Decided: `FileCog` stays.** Greg, 2026-10-04, answering `[Q-metadata-icon]`:

> probably cog

## Tests, red first

- `tests/metadata-escape.test.tsx` (new): Escape on the metadata page navigates to the article href;
  not from the reading view; not while typing; not over an open dialog; not when
  `defaultPrevented`; not with a modifier.
- `tests/command-bar.test.tsx`: "does not fire while a text field has focus" is inverted — it opens
  from a textarea, an input and a contenteditable, `preventDefault`s, and a keydown listener on the
  field itself does not see the press. One more: a press inside a container that stops propagation
  still opens it. The open-dialog refusal test stays.
- A Dock test that the Metadata link no longer draws the `lucide-info` glyph.

## Docs

[keyboard.md](../project/keyboard.md) § ⌘-K (the "does not fire while focus is in an input" bullet
is rewritten) and a short § for Escape on Metadata; the Help page's keyboard topic if it says
either; `Dock.tsx`'s own comments. The feedback note names all three report ids.

## GPT Sol's plan review, and what was done with it

[The review](261004h-escape-leaves-metadata-cmd-k-from-inside-text-fields-plan-review.md): ready
with changes, five findings.

- **3, Ctrl-K in a Mac text field (P2): taken.** There it deletes to the end of the line, and Greg
  asked for Command-K. Ctrl-K without ⌘, while typing, on a Mac, is left to the field. The sentence
  in § 2 above that said `preventDefault()` should stop it is withdrawn.
- **5, the title editor saves on blur (P2): taken.** A modal opening is a blur, so ⌘-K there would
  save a half-typed title. The editor is marked `data-command-bar="off"` and the chord stands down
  in it. Simpler than suspending the blur save while the bar is open.
- **1, a command picked from the bar can discard an unsent chat question (P1): not built here.**
  True, and not new: pressing a mode button in the bar with a question typed does the same today.
  Opening and closing the bar loses nothing. Keeping chat drafts across a mode change is its own
  piece of work; it is in the debrief to the Overseer.
- **2, Escape with dictation running and focus outside the box (P1): not built.** Pressing the
  Metadata button in that state already does the same, and with focus in the box Escape is the
  box's. Rare enough to leave.
- **4, the inline Delete and sharing confirmations do not own Escape (P2): not built.** Leaving
  the page unmounts the confirmation, which cancels it; nothing is deleted or shared.

## Browser check

Sonnet, Playwright, 2026-10-04, on the working tree before commit, at 1440×900, 1180×820, 820×1180
and 390×844. Ctrl-K opened the bar from the Search input, the bar's quick search, the chat
composer, a comment draft, Remember's answer box and the Metadata page's search and tag boxes; the
text was kept and focus came back each time, and the Escape that closed the bar closed nothing
behind it. Escape on Metadata went back with the mode and place carried, and stayed put with a box
focused, a dialog open or a tooltip showing. `FileCog` reads as a document with a cog at bar size.
Not checked: a real Mac (⌘, and Ctrl-K's own meaning), Safari, a real iPad.

## Stages

One stage: it is three small edits in one file. GPT Sol reviews this plan, then the code.
