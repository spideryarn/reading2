---
reports: spya-rze8qh, spya-xhvxue
ending: shipped
---
# Span highlights: select words, and they are highlighted

Two reports from Greg (admin), the same ask from two angles. Overseer queue items `qi-pzhk52ax` and
`qi-ashkp938`.

`spya-rze8qh`, a suggestion, 2026-09-29, on
`https://www.spideryarn.com/read/dongetal25-spya-vfmvmm?…&mode=debate…`:

> We currently allow sort of bookmarking blocks, but we don't allow the user to highlight sort of
> particular sections or sentences or words or whatever. So maybe it would be nice if there was a
> way to do that. I don't know how complicated this would be, but if possible, I want to be able to
> drag to select a section, and then maybe there's a context menu that pops up and I can say
> highlight this and choose a color and perhaps add a comment to it. So I guess I'm talking about
> span-level comments. If this is complex, then just research and plan it, don't implement. If you
> think it's straightforward, maybe with a third-party library or whatever, then have a crack at a
> v1.

`spya-xhvxue`, 2026-10-02, in Structure mode on the Entropy article:

> I want to be able to highlight/comment on sentences. May need discussion before implementing

**Ending: Shipped**, on `dev`, in four plans over two days.

## What a reader can do now

Drag over words in an article and **they turn yellow at once**. A box opens beside them where you
can change the colour (yellow, green, blue, pink, or none), write a note, ask the AI about them, or
press **Remove highlight**. **Click anywhere else and you are done**: the box closes and the
highlight stays. On an iPad or phone, select the words and tap **Highlight or comment** under them.

- *Copy, don't highlight* in the box (or ⌘C on the still-selected words) copies them and takes the
  highlight off, so selecting a sentence only to copy it leaves nothing behind.
- If you missed a word and select again over the same words straight away, the second selection
  replaces the first.
- Your highlights are rows in Quotes mode, marked *yours*, and every row there says who made it
  and when.
- Shared links and exports carry the colours.

## How it got here

1. **The discussion he asked for.** Selecting words already made a span-level comment (since
   2026-08-28), anchored to the block id plus the exact words, with overlaps already drawn
   correctly. What was missing was a colour, a visible highlight and a lighter gesture. No library
   was needed. [261003e](../plans/261003e-span-highlights-with-a-colour.md): a highlight is a
   comment with a colour.
2. The question put to him, `[Q-highlight-menu]`: colour dots in the existing box (A), a small menu
   at the selection (B), or A now and B later (C).
3. His answer was a fifth option:

   > Q-highlight-menu how about if selecting text automatically applies the highlight and also pops
   > up the fuller box to allow the user to customise (or remove) it, and they can just click off if
   > they're happy with the highlighting
   >
   > — Greg, 2026-10-04

   Built as [261004f](../plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md).
   No menu was built.

Along the way: an iPad could not highlight at all at first, and a draft could vanish
([spya-ma5h9b](261003_0929-highlighting-on-an-ipad-and-highlights-in-quotes.md),
[spya-pnnamg](261003_1942-a-comment-draft-vanished-and-ask-ai-should-be-a-button.md)); yellow became
the default ([spya-ur8kum](261003_1807-highlight-defaults-to-yellow-and-closing-saves-it.md)).

## Limits, said plainly

- **One paragraph at a time.** A selection that runs into the next paragraph keeps the first.
- **Referee mode is unchanged**: selecting there opens the older draft box with no colour, because
  a selection there is for placing a passage on a criterion.
- **The first seconds of a page.** Until the page has loaded its comments, a selection is not
  painted; it appears when they land. Leave the page in that moment and it is not stored.
- **A mis-drag is a save and a delete.** That is the price of storing on selection.
- **Not tried on a physical iPad.** Checked in Playwright with an iPad profile.

## Questions

**[Q-touch-auto-highlight]** On an iPad or phone, should words be highlighted as soon as you select
them, with no button press?

With a mouse, letting go of the drag is a clear end, so the highlight is applied then. A finger has
no such moment: you long-press, then drag two handles, and the same selection is how you copy, look
up or share with the iPad's own menu.

- **A (as built, recommended): one tap on *Highlight or comment*** applies it and opens the box.
  The iPad's own copy and look-up menu keeps working for selections you did not mean to highlight.
- **B: highlight automatically** about half a second after the handles stop moving. About half a
  day. Every selection becomes a highlight you must remove, and a pause while dragging the handles
  would highlight a half-made selection.

What decides it: if on the iPad you only ever select in order to highlight, B saves a tap each
time; if you also copy or look words up, A.

Still open, from the yellow-default note: `[Q-ask-ai-colour]` (should a word you only asked about
stay highlighted). Since selecting now paints it at once, it stays yellow unless you pick *No
colour*.
