# Two components sharing one bare class name

Up: [postmortems.md](../project/postmortems.md) · report `spya-trg9kz` ·
plan: [261003l](../plans/261003l-citation-marks-break-the-line-because-a-chat-chip-class-shares-their-name.md)

Greg, 2026-10-03:

> Sometimes the formatting gets a bit messed up around footnotes, I think. Like there's weird line
> breaks.

In the prose of a paper, each clause that carried a citation sat on lines of its own, and the comma
after it began the next line.

## The real root cause

The reader's stylesheets are one global namespace, and two components had each taken the word
`cite` in it.

- The chips a model's answer cites blocks with (`Cited.tsx`) were `<span class="cite">`, styled by
  `.cite { display: inline-flex; gap: 0.2rem; margin: 0 0.1rem }` in `mode-band.css`.
- A citation's words in the prose are `<mark class="cite">` (`annotate.ts`), styled by `mark.cite`
  in `annotations.css`.

The chip's selector was bare, so it matched the mark. `mark.cite` sets no `display`, so nothing
overrode it, and the mark became an `inline-flex` box. That box is atomic: when it does not fit in
what is left of a line it moves to the next line whole, and whatever follows starts after the box.

Each rule was correct where it was written. Neither file mentions the other.

## The class, named

**Two components sharing one bare class name.** A short class picked for one component in a global
sheet is a claim on that word everywhere, and a second component that picks the same word inherits
the first one's rules without either file saying so. It is worst when the second component narrows
its own selector by tag (`mark.cite`), because then its author sees a safe selector and the reach
runs only the other way.

## Which commit introduced it

`5c8e4213e`, 2026-09-16, *Citations become the fifth kind of mark in the prose*. The chip's `.cite`
was three weeks older (`5205cd2db`, 2026-08-26, when the chips lost their `chat-` prefix so summaries
could share them). The mark's class is the `MarkKind` itself, so the name followed from the kind
and was never chosen against the sheet.

It was not seen for seventeen days because it only shows on a mark too long for the rest of its
line. `[113]` fits. A cited clause does not.

## The fix, and the one that is right for the long term

Shipped: the chip's class is `cite-chips`. Nothing in the reader's sheets says `.cite` except on a
`mark`.

The long-term answer to the class is scoped styles, where a component's class cannot reach another
component. That is a change of styling mechanism for the whole client and is not worth making for
this. The guard below covers the six names where a collision lands on the author's prose, which is
where it costs most.

## What would have caught it, ranked by ease against value

1. **A static guard: no rule names a mark's class on anything but a `mark`.** One test over the
   sheets, no browser. It fails on the old rule and names the selector. Done:
   `tests/prose-marks-stay-inline-in-chrome.test.ts` § the classes a prose mark wears. It checks
   every `MarkKind`, and a new kind fails to compile until it is added.
2. **A Chrome test that a mark flows with its sentence**, per kind, on the block from the report,
   with a control that proves the fixture can break. Done, same file. It checks the layout a reader
   sees, which is what the report was about, and it is the one that would catch a break caused some
   other way.
3. **A habit: grep the sheets for a class before taking it.** `grep -rn '\.cite\b' src/web/styles`
   would have shown the chip rule on 2026-09-16. Costs nothing, and is the only item here that
   covers classes outside the six.
4. A lint for every bare single-word class in the sheets. Rejected: there are hundreds, almost all
   harmless, and a list that long is not read.
5. CSS modules or `@scope` across the client. Rejected for now, as above.

## What the brief got wrong, and why it is worth a line

The report said "footnotes" and the brief said "find which stage introduces it", pointing at
extraction. The stored block had no break in it. The screenshot on the report's row was what showed
the break was drawn, not stored. Reproduce from what the reader saw before choosing the stage.
