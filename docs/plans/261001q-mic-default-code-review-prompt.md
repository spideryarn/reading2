Code review of commit 051a9810c (run `git show 051a9810c`) in this worktree. The plan, rewritten after your plan review, is docs/plans/261001q-mic-follows-the-system-default-and-says-which.md; your plan review is docs/plans/261001q-mic-default-plan-review-sol.md.

The evidence for the constraint choice: a spike on this box (Chrome with --use-fake-device-for-media-stream, profile preference media.default_audio_capture_device=fake_audio_input_1) showed { audio: true } and { deviceId: { ideal: "default" } } both opened "Fake Audio Input 1", while { deviceId: { exact: "default" } } opened "Fake Default Audio Input". The table is in the plan.

You may edit files to fix what you find, inside this change's scope (src/web/mic-devices.ts, src/web/useDictation.ts beginCapture, src/web/live/useLiveConversation.ts capture, src/web/DictationStrip.tsx, src/web/live/LiveStatus.tsx, src/web/styles/profile.css, and their tests). Do not commit. Report anything wider for me to decide.

Look especially at:
1. beginCapture: the new await on enumerateDevices sits between the probe and getUserMedia. Does it break the stillWanted / mic-lock / stale-session invariants, or iOS/WebKit's handling? Is `honoured` still right when the default fails and we fall back?
2. Live conversation: the new await and stale() check, the shared deviceMissing replacing `instanceof DOMException`, and the notice now only on a chosen device. There is no Live test for the default path; add one if it is cheap (tests/live-session-flow.test.tsx or tests/chat-live-handoff.test.tsx have mediaDevices fakes).
3. DictationStrip: the new "Microphone:" line. Is "(your choice)" right in every state (deviceUnavailable with a fallback, the same-device verdict that adopts a new id, chooseDevice mid-dictation)? Is there anything else in the strip or picker that depended on the old placement?
4. Anything that still asks for { audio: true } literally where it should go through audioConstraint.

Run the relevant tests (npx vitest run tests/dictation-phases.test.ts tests/mic-devices.test.ts tests/dictation-quiet-warning.test.tsx tests/live-session-flow.test.tsx tests/chat-live-handoff.test.tsx tests/chat-live-dictation.test.tsx tests/live-mic-lock.test.tsx) and npm run typecheck after any edit. Check the conclusions, not just the reasoning. Report findings ranked P0/P1/P2, saying what you changed for each.
