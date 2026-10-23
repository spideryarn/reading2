Review this plan before it is built. Read-only: do not edit any file.

Plan: docs/plans/261023a-reading-column-cap-a-middle-value.md
Context: docs/plans/261022d-reading-measure-in-real-characters.md (§ Stage 2, held), the question docs/user-feedback/questions/q-z3j0ep.md, and the code in src/web/layout.ts (PROSE_ALONE_MAX_REM, proseAloneMaxPx, fitMargin, fitBoth, fitMode, bandWidth, spareBeyondTheMeasure, shiftForCard, chatCard). Tests touching it: tests/layout.test.ts, tests/layout-margin.test.ts, tests/text-alone-centring.test.ts, tests/gutter-target-size.test.ts, tests/prose-centred-in-its-cell.test.ts. The measure counter: scripts/measure-line-length.ts.

Check, with the arithmetic:
1. Are the band and Tweets numbers in the plan's table right at a 16px root (rail 12px)? Is "42 is the smallest whole value at which the iPad-landscape standard band stays under Tweets' 496" right?
2. Are the two invariant fixes (Tweets lower bound max(standard, spare); spare against max(cap, PROSE_MIN)) correct and sufficient? Does any other invariant break at 42: at roots 9-24px, with/without the rail (?spine=0), roomy (Summary) and structure bands, fitBoth (band + Marginalia), the chat card shift from 1600px, overflow, prose below MODE_PROSE_FLOOR, cap clipping the 56ch measure at any root or text size (Large/Largest text sizes scale --reading-size, check whether the cap scales with them or only with the root)?
3. Is PROSE_MIN the right floor for fix 2, or MODE_PROSE_FLOOR? Say which, and why.
4. Anything the plan misses: other readers of proseAloneMaxPx, CSS that assumes the cap, docs that quote 1220/1364/808.
5. Is a simpler route available?

Answer with: verdict (go / go with changes / no), then numbered findings, each with file:line and a concrete failure scenario. Be brief.
