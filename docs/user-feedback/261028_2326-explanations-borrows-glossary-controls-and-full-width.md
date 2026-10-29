---
reports: spya-ay3u4w
ending: shipped
comment: On dev: four orders, a prioritised default with Glossary's threshold, Find more, and the full width of the band. Untried with a real model until the AI key resets on 1 Nov, so the 0.10 bar is Glossary's and not yet tuned.
---
# Explanations borrows Glossary's controls, and uses the band's full width

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-28 23:26 UTC, reading *Consciousness in
Artificial Intelligence* (`arxiv-2308-08708-spya-xax6v4`) in Explanations mode. Sentry
SPIDERYARN-READING2-PT, event 1047fcc35ea64675a29b765c86770b88. Session
`fbay3u4w-explanations-layout-font`. No addenda when re-read, both before acting and before this note.

> For the explanations mode, I suggested that you borrow from the glossary UI. So I was expecting
> different orderings and a prioritized default with thresholding and an option to find more. And
> also, it's not using the full width of the sidebar, so it's wasting a bunch of space on the
> right-hand side. Take screenshots and you'll see.

**Shipped** on dev. The plan is
[261029e](../plans/261029e-explanations-borrow-glossary-controls-full-width-and-a-calmer-reader-face.md)
§§ 2–3. GPT Sol reviewed both the plan and the code.

- Prompt `explanations/2` scores each place for difficulty and centrality. The panel has
  Glossary's four orders (prioritised, reading order, hardest, most central), its threshold slider
  starting at 0.10, and a Find more that adds places without rewriting the list. The order and the
  bar are kept in the URL (`?explby=`, `?explbar=`).
- The width: `.tl-scroll` kept the corner button's room (about 30px) all the way down the list.
  Now only the top row keeps it. Measured against a canned list, rows sit 11px from the left and
  12px from the right; before, the right-hand gap was 31px.

**What waits for 1 November** (the box's AI key is over its limit): a real `explanations/2` run,
seeing how the scores spread, tuning the 0.10 bar for Explanations, and a real Find more.
Lists already in production are `explanations/1`. They count as outdated, so their button says
"Write a new list" until rewritten, and they have no scores, so they survive any bar.
