---
reports: spya-vqpeyr
ending: shipped
comment: On dev. In Structure's two columns, the part you are in now flows into column B as one grey Sankey-style band, from that row's height to the whole of column B. The switch to two columns did not move.
---
# Structure's two columns: a ribbon from the part to its sections

Report `spya-vqpeyr` (#631, SPIDERYARN-READING2-KW), a suggestion from Greg
(`feedback-reporter.ts` exit 0, no addenda when re-read before this note). Overseer queue item
`qi-3b2xeqck`, session `fbvqpeyr-structure-subset-visual`.

> Somehow make it clearer visually in the UI of the Structure mode that the 2nd column is a subset
> of the 1st, kinda like a Sankey diagram. Use screenshots.

**Shipped.** In the two-column face, the marked part in column A now has a grey ground. A band of
the same grey curves from that row's full height to the full height of column B (its header through
its last row), ending in column B's bracket. That bracket now stops where column B's rows stop. So
the part and its sections read as one shape, a Sankey node and its link, rather than two lists side
by side. The orange "you are here" stays on the current section only.

There is no ribbon between parts or on a part with no sections, and none in the narrow list face or
in Expanded, whose indentation already says "inside". The switch to two columns stays at 1165px.
A wider gutter was tried first, but it would have taken the columns off an 11-inch iPad held
landscape.

Before and after screenshots, both GPT Sol reviews and the reasoning are in
[261020l](../plans/261020l-structure-columns-sankey-ribbon.md). The code review also fixed an older
gap: Structure's row-capacity measurement now re-measures when a web font arrives.
