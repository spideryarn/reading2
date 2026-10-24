---
reports: spya-kaxamm
ending: shipped
comment: On dev, behind the experimental switch. Structure's third chip, Hover, looks like Fisheye, but resting the mouse on a row in either column goes there, with no click and no tooltip cards. Or open ?structure=hover.
---
# Structure's Hover sub-mode: pointing at a row goes there

Report `spya-kaxamm` (#677), a suggestion from Greg (`feedback-reporter.ts` exit 0, no addenda when
re-read before this note), passing on a friend's wish to move around Structure by hovering instead
of clicking. Session `fbkaxamm-structure-hover`.

> in this hover submode, it looks like fisheye submode, but the interactions with hovering with a
> mouse are different, and that hovering is like clicking, in which case hovering on the second
> column with the subsections would also be like clicking on them.

**Shipped, as an experiment.** A third chip after Fisheye and Expanded, **Hover**
(`?structure=hover`), behind the experimental-features switch so ordinary readers don't see it.
A shared link still opens it for anyone. It draws exactly what Fisheye draws. In the two columns,
resting the mouse on any row for 150ms moves the article there, as a click would, and column B
follows. Rows have no tooltip cards, as you suggested. Fisheye is unchanged.

The choices made on your behalf:

- **The text moves on hover** ("go all the way"). But a hover is a quiet scroll, not the click's
  jump. It adds no Back entry and does not flash the landing, so sweeping down a column does not fill
  your history. A click still jumps, as before.
- **It moves instantly, and lands centred.** A smooth glide would walk column B through every part
  in between.
- **It is careful about the mouse.** A short wait stops a diagonal path from column A to column B
  jumping to every part it crosses. A row that slides under a still mouse after the text moves sets
  nothing off. A click made during the wait wins.
- **Two columns only.** On a narrower window, Structure is a list that scrolls itself to follow you,
  so a hover there would move the list under your mouse. There, Hover behaves as Fisheye, and the
  chip's card says so.

If moving text proves too much, the next thing to try is hover as a preview: column B shows the
hovered part, and the text moves only on a click. Reverting is one line plus what the compiler then
points at ([structure.md § Hover](../project/structure.md#hover-an-experiment)).

Checked in a browser on an eight-part article, with screenshots. Column B followed each hovered
part, and the article landed on that part every time. A still mouse caused one move and then
nothing. A sweep across column A caused no jumps. Hovers added no history, and there were no
console errors. The plan, both GPT Sol reviews and what changed for them are in
[261024k](../plans/261024k-structure-hover-submode.md).
