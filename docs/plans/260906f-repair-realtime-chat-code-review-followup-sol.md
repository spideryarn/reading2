# READY

No P0/P1 findings remain in the bounded scope.

- **F1 — RESOLVED.** Provisional ownership survives conflict or uncertain-write repair; matching requires the canonical adjacent pair after the claimed tail, including server-normalized metadata. The recovered answer—not later unrelated messages—becomes Live’s expected tail. Repair is bounded and restores the Live copy on failure. See `src/web/chat/controller.ts:487`, `src/web/chat/controller.ts:506`, `src/web/chat/project.ts:82`, `src/web/chat/reduce.ts:1273`, and `src/web/chat/effects.ts:263`.

- **F2 — RESOLVED.** Chat, Remember, and fallback dictation all await Live shutdown before claiming the microphone. See `src/web/ChatPanel.tsx:1910`, `src/web/ChatPanel.tsx:2064`, and `src/web/ChatPanel.tsx:2139`.

- **F3 — RESOLVED.** Failed, cancelled, and incomplete provider responses are persisted with `interrupted: true`; the saved UI describes an answer ending early, and `recentHistory` excludes the incomplete pair. See `src/web/live/exchanges.ts:348`, `src/types.ts:2564`, and `src/converse.ts:1265`.

- **D1 — RESOLVED.** The data-channel close callback writes the ending reason only through `failSession` after its ownership checks. The delayed-close regression is at `tests/live-session-flow.test.tsx:1435`.

- **D2 — ACCEPTED.** The two additional Chat profile reads follow from StrictMode mounting the empty-list composer. The exact 18-request trace and historical note agree; Plain and Ideas remain unchanged. See `tests/the-ideas-extraction-changed-no-requests.test.tsx:709` and `docs/plans/260905h-traces.md:3`.

Local review run: `tests/live-session-flow.test.tsx`, **57/57 passed**.

Evidence note: `docs/plans/260906f-repair-realtime-chat-final-validation.md` predates the last F1 refinements; the later final-state evidence is the **225/225 focused suite plus 1,426-source typecheck** in `docs/plans/260906f-repair-realtime-chat-runtime-results.txt:2395`. The full gate remains correctly unclaimed and under root ownership. Browser evidence also correctly avoids claiming physical microphone capture or audible playback.