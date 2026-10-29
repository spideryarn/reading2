You are reviewing a plan before it is built, in the repo you are running in (read-only).

The plan: docs/plans/261029e-explanations-borrow-glossary-controls-full-width-and-a-calmer-reader-face.md

Read it, then check it against the code it names. The most relevant files:

- src/explanations.ts (the step: prompt, schema, validation, fingerprint), src/pipeline.ts § `explanations:` (the step runner, ~line 5340) and § `quotes:` (~line 4737, the append it copies), src/quotes.ts § `existingFor`, `previousQuotesFrom`, `buildQuotes` append handling.
- src/store/pg.ts § loadExplanations and the `explanations` cases; src/routes.ts § GET /api/explanations; `withProfileChanged`.
- src/web/ExplanationsPanel.tsx, src/web/useExplanations.ts, src/web/styles/explanations.css, src/web/styles/mode-band.css (`--band-about-room`), src/web/styles/glossary.css (`.gloss-more`, `.gloss-sort`), src/web/styles/faq.css.
- The pieces it reuses: src/web/GlossaryPanel.tsx (orders, threshold, run row), src/web/faq-order.ts, src/web/threshold.ts, src/web/OrderGroup.tsx, src/web/ThresholdSlider.tsx, src/web/params.ts (`?faqby=`, `?faqbar=`).
- Docs: docs/project/explanations.md, docs/project/glossary.md § The scores / § Finding more, docs/project/fonts.md, docs/project/controls.md § Controls that do the same job look the same.
- tests/self-hosted-faces.test.ts.

What I want from you:

1. Anything in the plan that is wrong about the code (a claim that does not hold), especially: that changing only the system prompt leaves `inputFingerprint`/`isStale` unchanged and makes old lists `outdated` not `stale`; that the client's `!stale && !outdated && !profileChanged` matches what a server-side `existingFor(onDisk, sourceHash, profileHash)` would decide in every case (high-powered AI / generator, a reader with no profile, a rollback to an older build); that the right-hand space is caused by the `.tl-scroll` padding rule as described.
2. Design problems: the append path (job force semantics, `FORCE_ONLY_WHEN_NAMED`, how a forced run reaches the step, whether the step can read the previous artefact the way Quotes does), the two scores and which product to gate on, the URL params, the margin, anything that would silently succeed while doing nothing.
3. Places where a simpler design would do.
4. The font choice: is there a reason in the code (sizes, line-height, auto-sizing textareas, italic use, the voices tests) that Kalam (static 300/400/700, no italic) would be a problem?

Number findings P1 (must change before building), P2 (should change), P3 (nit). For each: the claim, the evidence (file:line), and the change you suggest. Be concrete and brief. Do not edit any files.
