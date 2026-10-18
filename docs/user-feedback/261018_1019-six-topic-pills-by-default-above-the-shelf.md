---
reports: spya-qawppt
ending: shipped
comment: The Topics row above your shelf now shows six pills, with "All N topics" for the rest; the public shelf does the same.
---
# Six topic pills by default above the shelf

`spya-qawppt` (#605, suggestion, Sentry SPIDERYARN-READING2-JW), from Greg (admin;
`feedback-reporter.ts` exit 0 on the production row, no addenda). Filed 2026-10-18 10:19 UTC from
the signed-in shelf, `https://www.spideryarn.com/`, build 854b72c9. Queue item `qi-m6dfr3xm`.

> By default, initially just show a half dozen or so topic pills on the logged in page above the
> shelf.

**Ending: shipped** on `dev`. Plan
[261018k](../plans/261018k-six-topic-pills-by-default-above-the-shelf.md).

- **What changed.** The collapsed Topics row draws the first six topics in rank order (broad
  subjects first), plus any chosen one further down. It drew twelve before. "All N topics" was
  already there and still shows the rest. The loading placeholder has five outline pills now
  instead of eleven, so the row it stands in for is the same size.
- **The public shelf too**, per Greg's principle of 2026-10-18 (`spya-r8arjm`). It costs no AI. It
  had its own copy of the twelve, and now uses the same constant and the same function
  (`collapsedTopics` in `src/web/shelf-narrow.ts`), so the two cannot drift.
- **Weighed and dropped.** The first draft kept every finer topic of a chosen subject in the
  collapsed row. GPT Sol's plan review pointed out that a subject can have twenty finer topics,
  which would stop the row being a half dozen. So a chosen subject's finer topics fill the slots
  after it, and the rest are behind "All N topics".
- **The code review found one bug and fixed it:** once expanded, the All button now stays until
  pressed again. Before, it could vanish while the row stayed expanded, and clearing a filter then
  re-expanded the row by surprise.
- **Not touched:** queued `qi-z9qc9f3s` (the shelf jumps when topics load) is made smaller, not
  fixed, by the shorter row. Queued `qi-rysqd6xc` (a card's pill filters the shelf) is independent
  of this change.
