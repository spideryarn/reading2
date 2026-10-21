You are reviewing a plan in the Spideryarn repo (this working directory) before it is built. Read-only: do not edit anything.

The plan: docs/plans/261021b-investigate-takes-you-back-to-your-conversation.md. It answers a bug report from the product owner (quoted in it) about Sources › Investigate, built in docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md § Stage 2.

Code to read: src/web/InvestigatePanel.tsx; src/web/reader/Reader.tsx (search for `openClaimChat`, `openOrigin` and its `case "reception"`, `const overlay`, `investigateChats`, `handToChat`, `lensInChat`, `chatAnchors.loaded`); src/web/useChatAnchors.ts (`lensThreads`, `loaded`); src/web/modes/sources/SourcesMode.tsx (how InvestigatePanel is mounted, so what "one visit = one mount" really means); src/web/params.ts (`threadParam`); src/web/ChatDialog.tsx (what the floating dialog does on open/close, docking on narrow screens); tests/reception-lens-in-chat.test.tsx and tests/reception-lens.test.tsx.

Questions:
1. Is the arrival rule right and safe? In particular: does "once per mount of InvestigatePanel" match what a reader thinks of as a visit (does the panel remount on Back/forward, on chip changes, on a band hide/show, under StrictMode)? Could it fire on a visitor, on a cold load before summaries, or race with a handoff in flight (a press that is navigating to Chat)? Could it ever cause a chat POST or any spend?
2. Is keeping `?thread=` in openOrigin's `reception` arm correct, and does anything else rely on it being cleared (other callers of openOrigin, the floating dialog's own way-back line, Back stack)?
3. Interaction with `overlay` and with `?thread=` carried over from Chat mode when pressing the Sources chip (a browser pass saw `thread=` kept in the URL yet no dialog open in that case — is that expected?).
4. Anything better and equally small that the plan missed; any test missing.

Write findings as a numbered list, each with severity (blocker / should-fix / nit), the file:line evidence, and the concrete change. End with a one-line verdict: build as is / revise before build.
