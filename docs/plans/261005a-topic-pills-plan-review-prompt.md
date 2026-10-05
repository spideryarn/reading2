Review this plan before it is built. Read-only: do not edit files.

Plan: docs/plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md

It answers a report from Greg (an admin): "On the logged in home page, for each article show its
topic-pills. If there's lots, then maybe only show the first three."

The code it changes or leans on: src/web/ShelfTerms.tsx (`topicsBySlug`, `topicHueStops`),
src/web/ShelfTermChip.tsx, src/web/PaperCard.tsx (`PaperTopic`), src/web/ShelfEntry.tsx
(`ShelfCard`), src/web/library-columns.tsx (`TitleCell`, `libraryColumns`), src/web/ShelfTags.tsx,
src/web/Library.tsx, src/web/useShelfTerms.ts, src/web/ShelfPublicSection.tsx. The feature docs are
docs/project/shelf-terms.md and docs/project/library.md. That list is where to start, not a limit.

First, an independent pass: read the code, not the plan's account of it, and attack the plan. In
particular say whether each of these holds:

- that nothing new is needed from the server, and the per-article lists are correct for archived
  articles, copies of one work, and articles in the Include public section;
- that a React context is the right way to reach the table's cells, and cannot cause the render
  loop of docs/postmortems/260827e-shelf-render-loop.md or stale cells (TanStack cell memoisation);
- that lifting the hue computation into Library.tsx keeps it to once per terms answer;
- that the pills cannot break the card's stretched link, the touch behaviour of the action row, or
  the table row card on the title;
- that tests/eager-client-graph.test.ts and the /admin and /design users of ShelfCard are unaffected;
- accessibility: what a screen reader hears on a card now, and whether `+N` with a hover card is
  acceptable;
- that the tests listed would actually go red without the change.

Then, my own suspicions, which are worth less than what you find yourself:

1. Non-pressable pills that look like the pressable ones above may read as broken. Is "labels, not
   buttons" the right simplest version, or is pressable clearly what was asked for?
2. The layout shift when the pills land after the cards.
3. Whether "+1" in place of a fourth pill is silly enough to special-case.
4. Whether correcting the /help Topics paragraph belongs in this change.

Severity, by consequence: P0 data loss, exploitable security, wrong charging, service unusable;
P1 user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose or comment defect. Give every finding an id (F1, F2…).

End with one verdict line: `VERDICT: build as planned` / `VERDICT: build with changes` /
`VERDICT: do not build`.
