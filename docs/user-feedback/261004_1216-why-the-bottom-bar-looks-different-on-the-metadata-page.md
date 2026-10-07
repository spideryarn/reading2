---
reports: spya-qerga4
ending: shipped
---
# Why the bottom bar looks different on the Metadata page

Greg (admin), 2026-10-04 12:16 UTC, a suggestion, filed from
`/read/bitterlesson-spya-pbag4p`. Sentry SPIDERYARN-READING2-CK.

> Why does the bottom bar look different in metadata mode?

**Ending: Shipped**, on `dev`. Plan
[261004h](../plans/261004h-metadata-page-bottom-bar-draws-the-same-frames-as-the-reading-view.md).

**The answer.** It is one bar, drawn two ways. On the reading view the modes are buttons in
hairline boxes, because a press switches the column beside the article. The Metadata page has no
column, so each mode is a link back to the article, and those links were drawn loose, with no
boxes. The boxes were only ever added to the reading view's half.

**What changed.** The Metadata page now draws the same boxes, with the links inside them. Same
buttons, same order, same places; nothing moved or removed.

**What still differs, on purpose** (the plan's table has the reasons): no mode is filled in,
because none is open there; Comments has no count and no chevron; and there is no quick-search
box, which also leaves room for more words on the buttons at the same window width.

**Deferred, with its own queue entry** (`qi-spzcrqnw`, waiting on Greg): whether the Metadata
page's bar should offer quick search, as a ⚡ link to the article in Search, as the full box, or
not at all. The plan explains the three and recommends the ⚡ link.
