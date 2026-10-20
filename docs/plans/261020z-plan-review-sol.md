# 261020z plan review, GPT Sol (gpt-5.6-sol, effort high, read-only), 2026-10-20

What was done with each finding is in the plan: 1, 2, 3 and 5 accepted; 4 not needed.

1. **Blocker** — the new import breaks the stylesheet manifest and its test helpers. [`styles-entry-is-imports-only.test.ts:241`](../../tests/styles-entry-is-imports-only.test.ts:241) requires `button-tone.css` in `styles.css`, while [`styles-entry-is-imports-only.test.ts:313`](../../tests/styles-entry-is-imports-only.test.ts:313) requires every file under `src/web/styles/` to appear there. Also, [`stylesheets.ts:55`](../../tests/helpers/stylesheets.ts:55) assumes only one qualified local import, and `readerSheets()` at [`stylesheets.ts:207`](../../tests/helpers/stylesheets.ts:207) will stop seeing the tone rules, breaking [`feedback-dialog-styles.test.ts:104`](../../tests/feedback-dialog-styles.test.ts:104). Move the entry-owned sheet beside `tailwind.css` or explicitly teach the manifest/helper about layer-owned sheets; then test the real compiled import graph.

2. **Should-fix** — the proposed “no wash” treatment still gains an orange wash on shadcn hover. `tone-*` sets only colour and border at [`button-tone.css:27`](../../src/web/styles/button-tone.css:27), while outline and ghost add `hover:bg-highlight/10` at [`button.tsx:59`](../../src/web/components/ui/button.tsx:59). On a dark raised surface, red over that wash falls slightly below 4.5:1. Explicitly keep toned hover backgrounds transparent and add contrast coverage for both themes.

3. **Should-fix** — three inclusions exceed the written rule and Greg’s “don’t over-use it” qualification:

   - `SkimPurpose` starts a paid model call ([`SkimPurpose.tsx:193`](../../src/web/SkimPurpose.tsx:193)), yet the plan leaves other model-call controls neutral for exactly that reason ([plan:80](../../docs/plans/261020z-green-to-send-red-to-back-out-across-the-app.md:80)).
   - `PurposePrompt`’s “Not now” still saves typed text ([`PurposePrompt.tsx:44`](../../src/web/PurposePrompt.tsx:44)), so it is not “leave without sending.”
   - Transfer deletes/reset personal state and paintings ([`AdminArticlesPage.tsx:269`](../../src/web/AdminArticlesPage.tsx:269)), unlike an ordinary send.

   Leave these neutral, or explicitly broaden and justify the rule before including them. The other include/leave-alone judgments look sound; no obvious pair is missing.

4. **Nit** — the late layer also beats `focus-visible:border-ring` and `aria-invalid:border-destructive` from [`button.tsx:47`](../../src/web/components/ui/button.tsx:47). The 3px focus ring survives, disabled opacity is deliberately replaced, and Feedback’s paint should lose; only `aria-invalid` has undesirable precedence. Preserve the destructive border for toned `[aria-invalid="true"]` buttons.

5. **Should-fix** — documentation and `/design` need more than caller names. [`design-css-overview.md:24`](../../docs/project/design-css-overview.md:24) says every sheet in that directory comes through `styles.css` and tone is last there; [`button-tone.css:22`](../../src/web/styles/button-tone.css:22) repeats it. Update both and the `tailwind.css` header. `/design` currently demonstrates only Feedback buttons at [`DesignPage.tsx:1660`](../../src/web/DesignPage.tsx:1660); show shadcn and admin-button examples too, including hover and disabled states.

The central layer claim is correct: Tailwind 4.3.3 accepts the local `layer(tone)` import with `prefix(tw)`, and outline/ghost border behaviour is otherwise safe.

Verdict: **REWORK — sound cascade approach, but blocked by the stylesheet graph/tests and hover treatment.**