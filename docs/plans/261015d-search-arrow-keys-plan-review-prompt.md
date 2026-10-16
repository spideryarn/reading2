You are reviewing a plan, read-only, for the Spideryarn repo (this working tree). Do not edit files.

Plan: docs/plans/261015d-search-arrow-keys-step-the-results.md

Read it, then check it against the code: src/web/keynav.ts (useArrowNav, the horizontal handler seam and its guards), src/web/key-chord.ts (isTyping), src/web/reader/Reader.tsx (around quoteKeys/useArrowNav, found/openHit, bandJump), src/web/QuotesPanel.tsx (stepQuote, the follow effect), src/web/OutlinePanel.tsx (its follow arithmetic), src/web/modes/search/SearchMode.tsx (useSearchMode, onOpen, usePassageLifecycle), src/web/SearchPanel.tsx (Results, Hit, SortBar), docs/project/keyboard.md, docs/project/search.md.

Look for: wrong assumptions about where the list/open key live; cases where the step and a row press would differ; focus or typing cases that would steal keys from the search box, slider, checkboxes, colour popover, hover card; streaming/re-ordering of results mid-step; visitor vs owner; narrow window; anything that makes the URL or history wrong; a simpler design.

Write your answer as a numbered list of findings, each with severity (P1/P2/P3), the evidence (file:line), and the fix. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
