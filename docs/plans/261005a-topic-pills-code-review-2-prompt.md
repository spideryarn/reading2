A narrow second look. Read-only: do not edit files.

Your first review (docs/plans/261005a-topic-pills-code-review-sol.md) was of commit `cfd0b3bdc`.
Since then the working tree has your five fixes, which I read and kept, and **one change you have
not seen**, made after a real-browser check: in the shelf's table the topics under a title are now
running text instead of bordered pills, because the Article column is about 250px wide and bordered
pills stacked one to a line.

The unreviewed change is the `plain` prop: `git diff cfd0b3bdc -- src/web/ShelfRowTopics.tsx
src/web/library-columns.tsx tests/shelf-topics.test.tsx` shows it mixed with your own fixes; the
`plain` parts are mine. The docs for it are one bullet in docs/project/shelf-terms.md § On each
card and table row and the plan's § The browser check, and what it changed.

Check only this change:

1. Is the `plain` branch correct: classes, the list semantics of a `<ul>` whose items are
   `display: inline`, the `+N` item, what a screen reader hears, and that the card's form is
   unchanged?
2. `tw:wrap-anywhere`, `tw:align-middle`, `tw:mr-2.5`: are these real utilities under this repo's
   Tailwind v4 `tw:` prefix (the first is used elsewhere in library-columns.tsx)?
3. Does the new assertion in "shows the same in the table" actually fail without `plain`? Is
   `not.toContain("tw:border")` on the line's outerHTML a sound check or a brittle one?
4. Is anything the plan and docs now say about the table untrue of the code?

You may run `npx vitest run tests/shelf-topics.test.tsx tests/shelf-row-topics.test.ts` (no network
needed).

Severity, by consequence: P0 data loss, exploitable security, wrong charging, service unusable;
P1 user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose or comment defect. Number findings D1, D2….

End with one verdict line: `VERDICT: ship` / `VERDICT: ship with changes` / `VERDICT: do not ship`.
