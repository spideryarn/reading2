# Code review: a "?" answer that arrives in a burst

Reviewed commit `726025fb` on 2026-09-15.

## Findings before fixes

- **C1 — P2 — `docs/postmortems/260915a-a-store-notified-per-frame-turns-a-buffered-stream-into-an-update-loop.md:92`.** The prevention section still says the React class test uses “one unrelated pending update”, although the build proved that one update is consumed by the first Sync commit and changed the test to re-arm an update after every commit. The same paragraph says the tests and notification bound are “Being built” after both landed. This contradicts the corrected root cause elsewhere in the same postmortem and would tell the next test author to restore the vacuous version that passed on unfixed code. Evidence: `node_modules/react-dom/cjs/react-dom-client.development.js:977` is `var pendingSyncLanes = lanes & 42`; the built test's `Sibling` effect calls `setSeen(threads)` for every changed snapshot. **FIXING** narrowly in the postmortem.

- **C2 — P3 — `src/web/ChatPanel.tsx:1055`.** `awayNow.current = away` mutates a shared ref during render. StrictMode is harmless here because both render passes write the same committed state. A concurrent render that is later abandoned can, in principle, publish its speculative `away` value through the ref because ref writes are not rolled back. I found no reachable wrong-screen sequence in this component: `away` is changed only by the scroll handler and the jump button, neither is a transition; a later committed render rewrites the ref before this effect runs. **REPORTING**, not fixing without a red reproduction.

- **C3 — P3 — `src/web/chat/controller.ts:335`, `tests/chat-controller-notifies-once-per-task.test.ts:2`.** The implementation and project rule provide at most one emission in any browser task: the leading emit is in the dispatching task, while `setTimeout(0)` makes the trailing emit a later task. These two comments instead say “at most twice per browser task”, blurring the boundary the fix relies on and contradicting `docs/project/web-client.md`. The assertions exercise the right sequence; this is wording, not behaviour. **FIXING** the comments only.

- **C4 — P3 — `tests/chat-controller-notifies-once-per-task.test.ts:191`.** R2 exercises a listener throw only from the leading synchronous emit. The existing trailing re-entrancy case already locks `#openWindow()` before `#emit()`, and R2 already locks “tell everyone, then rethrow”, so the two tests compose to cover the implementation. But neither directly exercises the timer throw the review explicitly calls out: it should be rethrown globally, after the other listeners are told, while the already-opened next window remains able to flush a later change. **FIXING** with a fake-timer contract case; moving `#openWindow()` below `#emit()` made both the existing trailing-re-entrancy case and the new case red.

## What changed

- **C1 fixed:** corrected the postmortem's class-test mechanism from one pending update to one re-armed after every commit, changed 200 events to the actual 180, and marked the class test and notification bound as written.
- **C3 fixed:** corrected the controller and contract-test comments to say one emission per browser task. The leading and trailing emissions are in different tasks.
- **C4 fixed:** added a direct trailing-timer throw case. It proves the throw remains uncaught, the other listener still hears the latest snapshot, and a subsequent dirty change flushes through the window installed before the throw.

## Review conclusions

- **No subscriber can remain stale for ever.** A change inside an open window sets `dirty`; `#close` clears it, and either emits to a fresh copy of the listeners then present or, with none present, returns with the window closed. A new React subscriber reads `getSnapshot` during render and React 19.2's `updateStoreInstance` checks it again after subscription, so a change between render and subscribe also forces a render. The R1 test covers a replacement subscriber before the dirty timer; the no-listener case covers reset without another window.
- **Re-entrancy has the specified shape.** The leading path opens before emitting, so a listener dispatch becomes one trailing update. The trailing path clears `dirty` and opens the next window before emitting, so its listener dispatch becomes one update in the following timer task. The exact-count tests cover both.
- **Unsubscription is respected between emits.** Each emit snapshots the live set when it begins. As with the pre-change implementation, one listener can unsubscribe another after that snapshot and the latter may still receive that already-started emit; it receives no later emit. This is the plan's explicit fresh-copy semantics and is safe for React's subscription lifecycle.
- **A trailing listener throw is intentionally global.** `#emit` tells all listeners and rethrows the first; `#close` has already installed the next window, so the gate remains live. In production `src/web/monitoring.ts` installs Sentry's `globalHandlersIntegration`, which listens to `window.onerror` and `onunhandledrejection`; `src/web/log-buffer.ts` also records `window.error`. Swallowing it here would hide a broken subscriber. A leading throw still propagates to its caller, as before.
- **The new tests have positive controls.** The controller test asserts exact non-zero sequences; the class test asserts both the thrown value and the full controller/DOM answer; the whole-App burst asserts one POST, no failed answer row, the full 150-delta answer in the chat dialog, and an independently proven React-loop detector. Removing coalescing produced `2 failed (2)`, `6 failed | 1 passed (7)`, including `Maximum update depth exceeded` in the class test.
- **The shared settle helper is load-safe for its stated work.** It awaits real timer completion rather than a wall-clock deadline and preserves the old eight-microtask drains around four task boundaries. All thirteen migrated files passed together: `13 passed (13)`, `55 passed (55)`. The fake-timer recovery suite remains separate and advances one millisecond per round for Vitest's nested-timer rule.
- **No missed synchronous-render dependency found.** Domain decisions and follow-up operations read `controller.state` / `controller.threads`, which remain synchronous. `ChatDialog`'s target update supplies a React render that reads the current snapshot; `CandidatesPanel` already has its same-tick `asking` latch. The only direct subscription outside React is this contract test.
- **The corrected React mechanism is right.** In installed React DOM 19.2.8, `getHighestPriorityLanes` computes `pendingSyncLanes = lanes & 42`; the class test's sibling therefore re-arms a new-value state update after each changed store snapshot instead of relying on one early Default update.

## Checks

- Focused command before review edits: `5 passed (5)`, `33 passed (33)`; repeated three times with the same result.
- All thirteen shared-settle files: `13 passed (13)`, `55 passed (55)`.
- Targeted Biome lint: 2 files checked, no findings.
- Typecheck: the `npm run typecheck` wrapper could not open tsx's IPC socket in this sandbox (`EPERM /tmp/tsx-1000/14.pipe`); running the same script as `node --import tsx scripts/typecheck.ts` passed all four projects and confirmed all 2,176 source files are covered.
- Repository-wide `npm test` could not start its private lane because this sandbox refuses the local Postgres connection (`EPERM 127.0.0.1:54362`). A database-free unit sweep was also sandbox-noisy outside this stage (`overseer-store`, `overseer-reports`, and `run-codex`) and was stopped; no wider fixes were made.
- Documentation links: `1 passed (1)`, `14 passed (14)`.
- Commit/push: not possible in this managed review sandbox. The required staged-index guard could not create `.git/worktrees/fix-question-comment-react-185/index.lock` because the Git metadata is mounted read-only; no index-changing command was attempted afterwards.
- Final required command: **Test Files 5 passed (5); Tests 34 passed (34).**
