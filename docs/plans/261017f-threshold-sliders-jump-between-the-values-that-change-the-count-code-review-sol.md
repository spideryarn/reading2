C1 — medium — `src/web/StopRange.tsx:67`: pointer state could remain true after release outside the input, while touch without Pointer Events was never classified as dragging. Later assistive changes could snap incorrectly or do nothing. FIXED with window-level release/cancel/blur cleanup, mouse/touch fallbacks, and regression tests including controlled-thumb restoration.

C2 — medium — `src/web/params.ts:586`: Quotes’ raw stops were serialized to two decimals, so closely spaced scores could reload onto a different stop, changing the thumb, result count, and prose marks. FIXED by preserving exact stops in `?bar=`, making `barToReveal` return the exact score, and adding round-trip tests.

C3 — low — `src/web/QuotesPanel.tsx:232`, `src/web/threshold.ts:44`: comments still described Quotes’ old index track and incorrectly claimed there was no zero stop. FIXED to describe the linear score track and distinguish synthetic from genuine zero.

C4 — low — `src/web/SearchPanel.tsx:1932`: an old or malformed meaning-search whose hits all lack confidence still shows an inert slider with no stops. REPORTING: normal results are validated and Words mode has no slider; deciding whether legacy data should suppress the control or fall back from prioritised order is wider than this stage.

Checks: 13 scoped suites passed, 355 tests. The normal typecheck wrapper was sandbox-blocked by `tsx` socket creation; the same typecheck script run without wrapper IPC passed all 3,764 covered source files.

SHIP AFTER MY FIXES