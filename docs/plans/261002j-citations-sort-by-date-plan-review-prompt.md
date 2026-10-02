You are reviewing a small plan before it is built, in the repo at the current directory. Read-only.

Plan: docs/plans/261002j-citations-sort-by-publication-year.md
Relevant code: src/web/CitationsPanel.tsx (workByLine, effectiveOrder, orderWorks, orderOptions, OrderBar),
src/web/params.ts (CITE_ORDERS, citeOrderParam), src/web/debate-order.ts (Debate's date order, for consistency),
src/web/faq-order.ts (effectiveOrder fallback), tests/citations-panel.test.tsx, docs/project/citations.md, docs/project/url-state.md.

Check: is the design right and the simplest that works? Anything that would break (other users of CiteOrder or
CITE_ORDERS, exhaustive switches, last-view.ts, visitor/public rendering, the prioritised threshold UI shown only
for prioritised)? Is the year parsing sensible? Is oldest-first the right default? Anything missing from the tests?
Also check the conclusion: is a date order genuinely what the report asked for?
Reply with numbered findings, each with severity (P0-P3), file:line evidence, and a concrete fix. Be concise.
