## Findings

- **T1 — P1 — fixed:** A check could start after the pointer left at 1.999 seconds because the card remained mounted during close/warm-swap grace. [`useHoverCard.ts:416`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/useHoverCard.ts:416) now records whether the card is still engaged; [`ProseHoverCard.tsx:915`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/ProseHoverCard.tsx:915) mounts the check only while engaged.

- **T2 — P1 — fixed:** A press racing an automatic pre-`begin` request was swallowed when that request failed, hit a cap, or returned an adoptable 409. [`cite-check.ts:296`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/cite-check.ts:296) now resolves waiters with explicit `open`, `start`, or `cancelled` decisions; [`Reader.tsx:2903`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/reader/Reader.tsx:2903) follows the decision.

- **T3 — P1 — fixed:** A deliberate cross-tab press ignored a 409’s existing thread, particularly under StrictMode because synthetic cleanup erased the refusal callback. [`chat/controller.ts:517`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/chat/controller.ts:517) gates callbacks by actual attachment without deleting them during StrictMode cleanup; [`ChatDialog.tsx:1025`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/ChatDialog.tsx:1025) replaces the rejected local guess, keeps the real thread resolvable, and reloads it.

- **T4 — P2 — fixed:** “Elsewhere” polling continued after the card closed, and transient read failures could suppress all later reads. [`cite-check.ts:227`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/cite-check.ts:227) tracks mounted watchers; [`cite-check.ts:428`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/cite-check.ts:428) bounds polling, stops off-card, retries transient failures, and remains fenced by reader generation.

- **T5 — P2 — fixed:** Cached answers could survive an off-card deletion; a summary naming a missing full thread left the card blank. [`cite-check.ts:459`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/cite-check.ts:459) refreshes stale summaries, while [`cite-check.ts:514`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/cite-check.ts:514) clears deleted or expected-but-absent threads.

- **T6 — P2 — fixed:** A kept cap/stale line could outlive its allowance window or obscure a successful manual Chat/Learn handoff. [`cite-check.ts:244`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/cite-check.ts:244) expires retained refusals conservatively; [`Reader.tsx:1215`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/reader/Reader.tsx:1215) immediately bridges manual cite-check handoffs into chat summaries.

- **T7 — P2 — fixed:** `byTouch` remained stale after a mouse took over a touch-open card. [`useHoverCard.ts:433`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/useHoverCard.ts:433) now records the mouse takeover, while touch-only opens still cannot auto-spend.

- **T8 — P3 — reported, not fixed: wider:** The server uses rolling one-hour/24-hour windows but its refusal supplies only `reason`, not the exact oldest-event expiry. [`effects.ts:144`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/chat/effects.ts:144), [`pg-rate-limit.ts:169`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/store/pg-rate-limit.ts:169). The client now retries after the maximum possible window, but may retain the line longer than strictly necessary. An exact retry requires a stage-1 `retryAt`/`retryAfter` field.

No credible in-flight-slot leak or reader-isolation leak remained. Rendering is safe: answer text goes through `CitedMarkdown` at [`ProseHoverCard.tsx:2630`](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/ProseHoverCard.tsx:2630), inheriting Chat’s scheme and credential checks. The moved pointer-inside-card check does not regress other card types.

## Verification

- Requested suites: **71 passed**
- Hover/touch/marginalia suites: **184 passed**
- Chat lifecycle/unmount suites: **55 passed**
- Typecheck: all four projects passed; all **3,978** TypeScript files covered
- `git diff --check`: clean
- Full `npm test` could not start because the sandbox could not reach the private Postgres lane; no full-suite tests ran.
- No commit made.

Verdict: **stage 2 is ready with these working-tree fixes; only T8 remains as a wider protocol precision issue.**

Modified files:

- `src/web/ChatDialog.tsx`
- `src/web/ProseHoverCard.tsx`
- `src/web/chat/controller.ts`
- `src/web/cite-check.ts`
- `src/web/reader/Reader.tsx`
- `src/web/useChat.ts`
- `src/web/useHoverCard.ts`
- `tests/cite-check-card.test.tsx`
- `tests/cite-check-loader.test.ts`
- `tests/glossary-and-bibliography-ask-in-chat.test.tsx`