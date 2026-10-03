# Plan review: tap to talk when noise holds the live turn open

You are reviewing a plan, read-only. The plan is docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md.
Read it, then read the code it will change: src/web/live/stall.ts, src/web/live/useLiveConversation.ts
(especially the onEvent handler, `checkStall`, the hang-up's "Zero: let a sentence in progress finish",
`openTheMicrophone` / the seeding barrier, `start` and `reconnect`), src/web/live/LiveStatus.tsx,
src/live.ts `liveSession`, and tests/live-session-flow.test.tsx (the fake wire). Background:
docs/plans/260915b-live-conversation-stalls-visible-and-recoverable.md and
docs/plans/261002j-live-voice-chat-cleanup.md, docs/project/live-conversation.md.

The evidence (the plan's § The data) is one Sentry LiveStall-open-turn event plus a read-only
production query; take it as given, but say if the conclusion drawn from it does not follow.

Answer, with file:line references:
1. Does the conclusion follow from the data? Is "the sound never stopped" the right reading of a
   74-second open turn with zero commits, or is there another explanation (e.g. a lost event,
   speech_stopped arriving without a commit, transcription-only mode) that would make tap to talk
   the wrong fix?
2. Is `micTrack.enabled = false` a sound way to end a turn under semantic_vad over WebRTC? Is there
   anything in this codebase or in OpenAI's Realtime docs you know of that says the detector will
   close and commit a turn on the silence a disabled track sends? What happens in tap mode if the
   reader taps Done mid-sentence and semantic_vad thinks the sentence is unfinished?
3. Interactions the plan misses: the seeding barrier enabling the track, the hang-up grace window,
   the meter clone, quietInput, the idle cap (lastHeard), microphone-paused (track.muted), the
   mic/noise pickers' reconnect, typed turns via `say`, the stall's Sentry dwell, StrictMode.
4. Is there a simpler change that would plausibly help a reader in a noisy street, without
   changing every live conversation?
5. Anything else wrong: the UI copy, the state word, the test list.

Give a verdict (approve / approve with changes / reject) and a numbered list of findings, each with
severity P0–P3 and the change you would make.
