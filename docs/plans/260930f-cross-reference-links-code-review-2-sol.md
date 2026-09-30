Stage 2 is sound after two client fixes. One pre-existing security issue remains deferred to Greg as planned.

### Findings

- **D3 — P0 — reported only:** Article HTML can still forge a genuine block-preview card using `data-block-link`. The delegated selector and target lookup trust that attribute at [BlockLinkCard.tsx:134](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/BlockLinkCard.tsx:134) and [BlockLinkCard.tsx:146](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/BlockLinkCard.tsx:146). This predates Stage 2 and was not widened by it. Working xrefs remain unforgeable: [xref.ts:48](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/xref.ts:48) checks the per-load nonce and obtains `to` only from the artefact. Closing the general preview forgery requires the forbidden sanitizer/security-defence edit, so I did not touch it. Ordinary author `<a>` links can intentionally jump; forged xrefs cannot.

- **D1 — P1 — fixed:** A fresh response containing an artefact for another slug was accepted under the requested slug. Stable IDs could therefore make foreign links appear valid. [useCrossrefs.ts:60](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/useCrossrefs.ts:60) now checks the payload’s slug as well as request generation and freshness. The regression at [xref-prose.test.tsx:484](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/tests/xref-prose.test.tsx:484) went red with one foreign mark drawn, then green with none.

- **D2 — P1 — fixed:** Native Tab focus could scroll an xref behind the fixed bottom dock. Document padding provides scrollable room but does not define focus-target visibility. [annotations.css:246](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/styles/annotations.css:246) now gives xrefs the dock’s permanent clearance through `scroll-margin-block-end`. The CSS contract test at [xref-marks.test.ts:132](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/tests/xref-marks.test.ts:132) went red with computed value `0`, then green. A live-browser recheck was unavailable because Chrome cannot launch in this sandbox.

- **D4 — P3 — fixed:** “Stage 2 as built” still claimed there was no completed-job revalidation and that dock-obscured focus was unfixed. The plan now describes the quiet subscription and focus fix at [the plan:322](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:322) and [the plan:379](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:379). Documentation-only; no executable red applies.

I found no further defect in F2/F4–F8. In particular:

- Server and client use the same rendered-text and unique-occurrence rule for entities, `<br>`, split markup, and maths.
- C1 fingerprints the exact rendered article and skeleton request strings; generation and freshness use the same helper.
- C2 uses the same bounded Temml transformation as the browser.
- Mouse, touch, selection and author-link precedence are correct.
- Visitors do not mount `useCrossrefs` or make its authenticated request.
- The quiet job subscription does not buy an idle polling cadence.
- The xref arrays and per-block marks remain identity-stable; unrelated renders do not rebuild 2,500 prose blocks.
- The xref and glossary rules differ in CSS channel, thickness, offset, cursor, focus and hover—not only colour.

Verification:

- 12 relevant test files, **294 tests passed**, including all three requested files.
- Full coverage-aware typecheck passed: **2,414 source files**.
- Production build passed.
- Touched TypeScript files pass Biome; `git diff --check` passes.
- Full `npm test` could not start its database lanes because Docker/Postgres is unavailable in this sandbox.

No commit was made.

Verdict: **approve with these fixes**. The deferred D3 sanitizer defence remains necessary before treating the wider forgery boundary as closed.