# NOT READY

Three established P1 findings remain. No P0 findings.

## Established findings

- **F1 — P1 — A successful spoken turn can reappear as an “unsaved” duplicate.**  
  Order: the first `/spoken` request commits but its response is lost; the retry receives the expected 409; the controller starts repair but immediately resolves the live waiter as failed ([controller.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/chat/controller.ts:502)); the hook restores and labels the live copy unsaved ([useLiveConversation.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/live/useLiveConversation.ts:578)); repair then reloads the already-stored pair ([reduce.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/chat/reduce.ts:1273)). The reader sees the same exchange twice, with one copy falsely described as unsaved.  
  Smallest adjustment: keep transcript ownership provisional through conflict repair. After repair, suppress the live copy if the attempted adjacent pair is present; restore it only if absent.  
  Witness: simulate commit-plus-lost-response, 409 retry, then repair returning that pair. Assert exactly one visible copy, no unsaved warning, and the repaired answer ID becomes the resume tail. Existing conflict tests only assert shutdown.

- **F2 — P1 — Clicking the normal Dictation button during Live startup can be overridden by the older Live attempt.**  
  The composer’s Dictation buttons call `dictate.toggle` directly and remain enabled while Live is connecting ([ChatPanel.tsx](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/ChatPanel.tsx:2048)). Live does not claim the microphone until after placement and ticket awaits ([useLiveConversation.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/live/useLiveConversation.ts:1347), [useLiveConversation.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/live/useLiveConversation.ts:1527)). Therefore: start Live with a deferred ticket, start dictation, then resolve the ticket—the stale Live attempt becomes the newest microphone claimant, stops dictation, and continues connecting. This contradicts the promised switch to dictation.  
  Smallest adjustment: route both ordinary Dictation buttons through the same stop-then-toggle handoff already used by “Use dictation.”  
  Witness: defer the Live ticket, click Dictation, resolve the ticket, and assert dictation remains armed while Live is cancelled and creates no peer connection.

- **F3 — P1 — A failed provider response is persisted as an apparently complete answer.**  
  `ExchangeLedger` settles every tool-free `response.done` regardless of status ([exchanges.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/live/exchanges.ts:320)); the hook commits it before handling `status: "failed"` ([useLiveConversation.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/live/useLiveConversation.ts:810), [useLiveConversation.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/src/web/live/useLiveConversation.ts:940)). After reload, the partial assistant row is `done` with no interruption/failure marker.  
  Smallest adjustment: persist failed-response partials using an existing incomplete/interrupted marker, with reader-facing copy broad enough not to claim the reader caused it.  
  Witness: extend the existing failed-response test at [live-session-flow.test.tsx](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/tests/live-session-flow.test.tsx:1157) to require the stored partial answer to carry that marker.

## Reasoned risks and evidence limits

- Physical microphone capture and audible speaker output remain unverified, correctly distinguished from the synthetic provider/browser runs.
- Playback recovery also consults the input-meter `AudioContext` state after `HTMLAudioElement.play()` succeeds; a browser where those policies diverge could leave a false “paused output” warning.
- The permitted runtime suite passed locally: **52/52** after directing Vitest’s temporary directory to `/private/tmp`. The first attempt discovered zero tests because the default macOS temp directory was blocked.
- Recorded route, targeted runtime, UI, and synthetic-provider evidence is substantive. The recorded full `npm test`, typecheck, and static-analysis gates remain pending.