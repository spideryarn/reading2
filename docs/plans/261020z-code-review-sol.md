# 261020z code review, GPT Sol (gpt-5.6-sol, effort high, workspace-write), 2026-10-20

The reviewer fixed findings 1–5 inside the stage; I read its diff and ran the gates outside its sandbox.

1. **Should-fix — fixed:** [button-tone.css](../../src/web/button-tone.css:45) applied transparent hover globally, making Annotate Save’s `var(--page)` face disappear on hover. The override is now limited to shadcn outline/ghost buttons and Chat icons, with regression coverage in [feedback-dialog-styles.test.ts](../../tests/feedback-dialog-styles.test.ts:106).

2. **Should-fix — fixed:** [stylesheets.ts](../../tests/helpers/stylesheets.ts:221) left resolved `@import` lines in `readerCss()`. Every naive `([^{}]+)\{` scanner could therefore misread the first tone selector, not only Feedback’s scanner. Imports are now removed centrally; the local workaround was deleted.

3. **Should-fix — fixed:** Added rendered coverage for the three missing callers:

   - Chat Rename Save/Cancel: [chat-composing-keys.test.tsx](../../tests/chat-composing-keys.test.tsx:202)
   - Profile “Close without saving”: [profile-panel.test.tsx](../../tests/profile-panel.test.tsx:438)
   - AddShareLink Create/Cancel, including outline variant: [add-page-sharing-section.test.tsx](../../tests/add-page-sharing-section.test.tsx:594)

   Reset’s outline variant is now asserted too. These assertions fail if the rendered class or variant disappears.

4. **Low — fixed:** `/design` claimed to demonstrate admin pills but did not render one. [DesignPage.tsx](../../src/web/DesignPage.tsx:1643) now uses the real shared admin button class and shows its green/red pair. **Reverted afterwards:** importing `admin-vouchers-parts` into the lazy `/design` route pulled `useJobs` and `useShelf` (and nine modules behind them) into both the reader's startup and the route, which `eager-client-graph.test.ts` refuses. The shadcn outline samples already show the tone beating the utilities, so the admin pill sample went rather than a new module.

5. **Low — fixed:** Updated stale “primary/orange” caller comments, the stylesheet map’s obsolete “four positions” count, the plan’s hover description, and the feedback note that still said Greg’s answer was pending. Examples: [AccessSharing.tsx](../../src/web/AccessSharing.tsx:613), [design-css-overview.md](../../docs/project/design-css-overview.md:24). `controls.md` was not changed.

6. **Informational — no change required:** The production build emits `properties, theme, base, app, utilities, tone`. Tone intentionally overrides family text/border and native-disabled opacity with `0.45`. Shadcn’s 3px focus ring survives although its one-pixel focus border remains toned; `aria-disabled:opacity-50` also survives because tone only sets opacity for native `:disabled`. No current toned button is `aria-invalid`. Every changed caller has the correct green send/red back-out and outline/ghost treatment; the plan’s left-alone controls remain neutral. No wider decision is needed.

Test results:

- `npx vite build --outDir <tmp>`: passed; compiled layer order and scoped tone selectors verified.
- Stage-focused Vitest run: **20 files, 1,010 tests passed**.
- All changed tests plus every stylesheet-helper consumer: **1,937 passed**; eight sandbox failures only—seven browser launches could not create IPC sockets, and `styles-entry-is-imports-only` could not spawn nested `git`. Its other seven assertions passed; a direct scan confirmed only `main.tsx` statically imports CSS.
- `npm run typecheck`: wrapper hit sandbox `listen EPERM`; equivalent `node --import tsx scripts/typecheck.ts` passed all projects and all 3,876 covered files.
- `npm test`: blocked before discovery because the sandbox could not reach the private Postgres lane or query Docker.
- `git diff --check`: passed.
- Scoped Biome lint found only the pre-existing `DesignPage.tsx:1400` `dangerouslySetInnerHTML` error and two existing complexity notices.

**Verdict: APPROVE — stage defects fixed, callers and cascade are sound, with no wider decision outstanding.**