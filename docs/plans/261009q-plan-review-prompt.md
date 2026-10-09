You are reviewing a plan, read-only, for the Spideryarn repo (this checkout). Read the plan first:
docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md

Context to open as needed: src/chat-tools.ts (CHAT_TOOLS, GUIDE_TOOLS, toolsFor, runTool, ToolOutcome),
src/converse.ts (GUIDE_SYSTEM, the tool loop around `const finished: ToolRun`), src/types.ts (ToolRun,
MAX_PURPOSE_CHARS, MAX_PROFILE_CHARS, normaliseProfileText), src/live.ts (liveTools, LIVE_SERVER_TOOLS),
src/web/ChatPanel.tsx (Turn, ToolStrip, GuideKeepReason wiring), src/web/GuideGreeting.tsx,
src/web/guide-greeting.ts, src/web/purpose.ts, src/web/useProfile.ts, src/routes.ts (GET/PATCH /api/reader,
resolveProfileParts, parseSpokenTools), src/store/pg-chat.ts (tools jsonb), docs/project/security-map.md
(§ Where the defences physically live), docs/project/chat-tools.md, and the prior plan
docs/plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md.

The admin's decision (trusted): the guide should have a tool to save to "why you're reading" or About you,
staying very close to the reader's wording; it must be a press by the reader (an unpressed save is a
security-map exception this run may not make).

Review for: correctness holes (state races, Undo semantics, stale offers on reload, the read-before-write),
whether the tool/ToolRun/jsonb approach has a flaw (anything that strips or validates ToolRun fields,
export/MCP/public paths that would now leak an offer, the spoken path), whether removing "Keep this as why
you're reading" is right, the prompt design, security (prompt injection via the article -> the offer; is
anything here an edit to a listed defence), and anything simpler. Also list every file/test you think the
plan forgot.

Answer with: a verdict (build / build with changes / rethink), then numbered findings each with
severity P1/P2/P3, the evidence (file:line), and the change you would make. Be concrete and brief.
