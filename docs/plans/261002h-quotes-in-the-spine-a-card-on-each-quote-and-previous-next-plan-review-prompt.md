You are reviewing a plan, read-only, in the Spideryarn repo (cwd). Plan: docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md

Read the plan, then check it against the real code. Key files: src/web/reader/useQuoteMarks.ts, src/web/reader/passages.ts (proseFound), src/web/reader/Reader.tsx (around lines 1150-1340 and the Spine / ProseHoverCard mounts), src/web/spine-marks.ts, src/web/Spine.tsx, src/web/styles/spine.css, src/web/ProseHoverCard.tsx, src/web/useHoverCard.ts, src/web/QuotesPanel.tsx, src/web/keynav.ts (useArrowNav horizontal seam), src/web/TableView.tsx (NOT_A_BLOCK_SELECTION), src/web/annotate.ts (data-hit/data-quote), src/web/search-hits.ts (resolveQuotes, quoteMarkKey, QUOTES_RUN, resolveSkimStop), docs/project/quotes.md, docs/project/keyboard.md, docs/project/tooltips.md.

Questions I most want answered:
1. Is the spine strip as its own element (left 2px, not a lane) right, versus a green lane? Anything in Skim mode (which publishes a quote's own Found as its passage, runId QUOTES_RUN) that breaks when hitBlocks is emptied only in quotes mode?
2. The prose card: any trap in adding `mark.hit[data-quote]:not(.xref)` to useHoverCard's selector (not tapSelector) — focus, touch, host, the card's interactive behaviour, the merged-mark cases (quote+term, quote+cite, quote inside link)? Is a per-hit longer open delay the right answer to "a quote is a whole paragraph and the pointer rests in it while reading"? Would something else be better?
3. stepQuote semantics and the choice of "list order" (markedQuotes) for both the card and the band; anything in the hiddenSelection effect in useQuoteMarks that fights stepping?
4. Anything missing: visitors, public reader, tests that pin current behaviour which will go red (e.g. tests asserting the quotes lane in the rail, every-mode-says-which-passages-it-marks), docs that state the opposite.
5. A simpler design for any piece.

Give findings ranked P0/P1/P2 with file:line evidence, and say which plan claims you verified true. Be concise.
