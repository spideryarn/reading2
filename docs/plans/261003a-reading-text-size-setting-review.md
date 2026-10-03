1. **The bar is not established as written.** A body-paragraph setting is mechanically simple, but “every rule follows” overstates the code.

   - **Fixed JS measure:** [layout.ts:164](../../src/web/layout.ts:164) defines `49rem`; [layout.ts:210](../../src/web/layout.ts:210) converts it using the **root font**, which changing `--reading-size` does not change. Consumers include Plain (`658`), Marginalia (`546`, `562`), band-plus-Marginalia (`610`), and standard/roomy band allocation (`843`, `888`). Thus the cap’s reach exceeds the plan’s “lone column” exception. At larger sizes, band allocation can treat room the prose could use as spare.
   - **Article text that stays fixed:** headings, including the literal `1.0625rem` h3 ([prose.css:433](../../src/web/styles/prose.css:433)); figcaptions (`656`), opaque prose (`841`), caption blocks (`859`); footnote bodies ([footnotes.css:77](../../src/web/styles/footnotes.css:77)). At 21px, body text becomes larger than h2’s 20px.
   - **Live position restoration misses this change:** [Reader.tsx:579](../../src/web/reader/Reader.tsx:579) builds `layoutKey` without prose size. [useReadingPosition.ts:131](../../src/web/reader/useReadingPosition.ts:131) restores on that key changing; it has no ResizeObserver.

   **No production JS reads prose font size or line height, or assumes 17px/23.8px/1.6 for vertical geometry.** [measure.ts:153](../../src/web/reader/measure.ts:153) reads root font size and updates on window resize; Structure and band sizing legitimately consume that root value.

   Existing geometry machinery mostly handles reflow: Spine observes the body ([Spine.tsx:623](../../src/web/Spine.tsx:623)); Marginalia observes the table and notes ([MarginaliaColumn.tsx:640](../../src/web/marginalia/MarginaliaColumn.tsx:640)); reading-time reads fresh rectangles each tick ([useReadingTime.ts:239](../../src/web/useReadingTime.ts:239)). Gutter placement is CSS arithmetic ([gutter.css:135](../../src/web/styles/gutter.css:135)). Fixed gutter targets and Marginalia padding are intentional interface dimensions, though their first-line alignment is approximate.

2. **Agree with prose-only versus whole-interface scaling.** The existing token already separates body typography from chrome ([tokens.css:274](../../styles/tokens.css:274)). But call this “Article body text size”: headings, captions, footnotes and quoted passages elsewhere do not all follow it. Quiz’s wrapper follows the measure; its question text remains independently sized ([quiz.css:325](../../src/web/styles/quiz.css:325), `339`).

3. **Agree with localStorage applied before `createRoot`.** [main.tsx:217](../../src/web/main.tsx:217) provides the appropriate insertion point. It avoids the asynchronous load and account-switch machinery demonstrated by [experimental-store.ts:372](../../src/web/experimental-store.ts:372).

   **The `?at=` argument is real, but overstated.** Initial restoration happens on `at` changing ([useReadingPosition.ts:57](../../src/web/reader/useReadingPosition.ts:57)); a later font change does not trigger re-anchoring. Browser scroll anchoring may mitigate movement, so losing position is a risk, not inevitable. Account storage could also use an account-keyed synchronous cache; blocking first render is not its only possible design.

4. **Simpler design:** keep the proposed helper, one key and one root override; use a labelled native select or radio group in Settings. Accept fixed column widths and explicitly limit the setting to body text. Preserving heading proportions or 65ch everywhere would require extra work and should return to the owner.

5. **No demonstrated P0/P1 runtime defect in that narrowed design; do not approve the plan’s current evidence.**

   - The spike omits Plain and band-plus-Marginalia, precisely where the overlooked caps matter; it also omits mid-article live reflow ([plan:105](../../docs/plans/261003a-reading-text-size-setting.md:105), `122`).
   - “53ch is inside 55–70” is false (`57`). Spine bands use measured row heights, so “shares of text, unchanged” is also inaccurate ([Spine.tsx:214](../../src/web/Spine.tsx:214)).
   - Listed tests omit apply/remove behavior, throwing writes, Settings wiring and startup ordering. A mapping test cannot establish correct first-render geometry or `?at=` restoration.

**Recommendation: stop for owner agreement on the narrower scope and fixed-width behavior before building.** No files edited.