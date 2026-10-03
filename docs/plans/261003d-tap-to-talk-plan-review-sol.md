Verdict: **reject**. No P0 findings, but the plan’s central end-turn mechanism is neither established by the evidence nor supported by OpenAI’s documented WebRTC push-to-talk flow.

1. **P1 — `track.enabled = false` gates audio, but is not a documented way to finish a turn.**

   A disabled media track supplies silence, so it is suitable for keeping between-turn noise away from the service. It does not follow that OpenAI will promptly close and commit the current semantic-VAD turn. The plan asserts that guarantee at [plan:50](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md:50>), based on the existing hang-up code at [useLiveConversation.ts:1326](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:1326>), but that code is another assumption, not evidence; it waits only 1.2 seconds ([useLiveConversation.ts:270](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:270>)).

   Official OpenAI documentation says semantic VAD may wait when an utterance sounds unfinished. Its documented WebRTC push-to-talk procedure is instead: set `turn_detection: null`, clear the input buffer when starting, then send `input_audio_buffer.commit` and `response.create` when finishing. [Voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad), [Realtime conversations: Push-to-talk](https://developers.openai.com/api/docs/guides/realtime-conversations#push-to-talk).

   If the reader taps Done mid-sentence, semantic VAD can therefore keep waiting. If they tap Talk again before a commit arrives, both utterances may become one turn. The same race exists immediately after entering tap mode from the stalled turn.

   **Change:** either:

   - add a real Realtime/WebRTC spike proving that disable reliably produces `speech_stopped` and `committed`, including an unfinished sentence and continuous background noise; or
   - implement documented manual turn control, including response cancellation/output clearing when Talk interrupts the companion.

   In either design, add a `finishing` state and prevent another Talk until the previous turn is committed or visibly fails.

2. **P1 — the evidence supports continuous noise as a hypothesis, not the conclusion “the sound never stopped.”**

   `open-turn` establishes only that the browser saw `speech_started` and still had `midSentence` set when the threshold and dwell elapsed ([stall.ts:109](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/stall.ts:109>), [useLiveConversation.ts:711](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:711>)). The tally does not count `speech_stopped`, and that event only clears the display’s `hearing`; it does not clear `midSentence` or `turnOpenSince` ([useLiveConversation.ts:1141](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:1141>)). Thus `speech_stopped` followed by an absent/omitted commit produces exactly this stall.

   A normally configured data channel is reliable, so isolated network packet loss is not the leading explanation. But the evidence cannot exclude a missing server lifecycle event, handler/API-shape problem, or a media-path failure that did not move `RTCPeerConnection.connectionState`.

   Transcription-only mode is not a plausible explanation: this is a `type: "realtime"` speech-to-speech session with semantic VAD and output voice; the nested transcription model is only the auxiliary transcript ([live.ts:543](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/live.ts:543>), [live.ts:550](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/live.ts:550>)).

   **Change:** rewrite [plan:26](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md:26>) as “consistent with continuous noise, and the best fit to the report,” and add `speech_stopped` to future stall telemetry.

3. **P1 — reconnect preservation conflicts with the existing seeding/start lifecycle.**

   The seeding barrier unconditionally enables the newly acquired microphone when it lifts ([useLiveConversation.ts:1798](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:1798>)). Meanwhile, `start` resets session state ([useLiveConversation.ts:1521](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:1521>)), and reconnect calls that same `start` after clearing its reconnect token ([useLiveConversation.ts:2229](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:2229>)).

   This needs an explicit distinction between a fresh reader start and a reconnect. A reconnect begun while `tap-talking` must reopen as `tap-idle`, not resume sending street noise. This also applies to the microphone and noise-reduction pickers, which reconnect at [LiveStatus.tsx:181](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/LiveStatus.tsx:181>) and [LiveStatus.tsx:202](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/LiveStatus.tsx:202>).

   **Change:** pass an explicit initial talk mode into an internal start operation: fresh starts use hands-free; all reconnects from tap mode use tap-idle. Test reconnect from both tap-idle and tap-talking, including both picker-triggered reconnects.

4. **P1 — suppressing `open-turn` removes the remaining safety signal while both caps are already disabled.**

   The idle/session-cap effect returns immediately whenever `midSentence` is true, before checking either cap ([useLiveConversation.ts:2138](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:2138>)). The proposed `readerHoldsTurn` rule then suppresses `open-turn` too ([plan:66](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md:66>)).

   A forgotten Done button, or a Done that never commits, can consequently remain live until OpenAI’s server limit, with no notice and no client cap.

   **Change:** never bypass the hard session cap. Rather than suppressing `open-turn` outright, turn it into a tap-mode-specific reminder such as “Talk is still on — tap Done when you’ve finished,” with appropriate telemetry.

5. **P1 — the meter, `quietInput`, and “Mic off” copy disagree with the proposed state.**

   Production normally meters an independently enabled clone, even while the transmitted track is disabled ([useLiveConversation.ts:532](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:532>), [useLiveConversation.ts:1989](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:1989>)). Merely hiding `<MicLevel>` leaves that clone capturing and can still produce the “No sound detected” notice at [LiveStatus.tsx:131](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/LiveStatus.tsx:131>) and [LiveStatus.tsx:145](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/LiveStatus.tsx:145>).

   `track.muted` is also a separate device condition and currently outranks every other stall ([stall.ts:109](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/stall.ts:109>)). The plan must say what a device mute means while tap-idle.

   **Change:** suppress metering and `quietInput` together while tap-idle, and define the device-muted presentation. Unless capture itself is stopped, use honest copy such as **Ready — The conversation isn’t listening. Tap Talk, then tap Done when you finish**, rather than “Your microphone is off.”

6. **P2 — several lifecycle interactions and failure boundaries are missing.**

   - `say()` sends `response.create` without considering an open audio turn ([useLiveConversation.ts:2089](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:2089>)). It is currently a test/preview seam rather than the normal composer path, but its behavior should be defined: tap-idle must remain off, while tap-talking should be rejected or finished first.
   - Stop or reconnect immediately after Done can pay both the settle and grace windows because `midSentence` remains true until a server commit ([useLiveConversation.ts:1340](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:1340>)).
   - Switching mode must reset `stallSeen` synchronously or the five-second Sentry dwell can report the old hands-free stall as occurring in tap mode ([useLiveConversation.ts:729](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:729>)).
   - A mode setter must not change tracks from inside a React state updater; StrictMode may invoke that updater twice. The existing test harness is not wrapped in StrictMode ([live-session-flow.test.tsx:271](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/tests/live-session-flow.test.tsx:271>)).

   **Change:** make a ref the synchronous authority, keep state updates pure, and add explicit tests for these paths.

7. **P2 — the test list proves boolean toggling, not the central end-turn claim.**

   The fake microphone only exposes `enabled`, `muted`, and `stopped`, while `addTrack()` does nothing ([live-session-flow.test.tsx:49](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/tests/live-session-flow.test.tsx:49>), [live-session-flow.test.tsx:178](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/tests/live-session-flow.test.tsx:178>)). It cannot show that silence reached OpenAI or caused a commit. Existing hang-up tests manually deliver the server events they need, which likewise does not validate the transport assumption ([live-session-flow.test.tsx:1039](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/tests/live-session-flow.test.tsx:1039>)).

   **Change:** add the real-session spike first. Then add tests for delayed/missing commit after Done, repeated Talk before commit, Talk while the companion speaks, reconnect from tap-talking, picker reconnects, meter/quiet behavior, device mute, both caps, `say`, Sentry dwell/tagging, hang-up immediately after Done, and StrictMode.

8. **P2 — there is a materially simpler, evidence-directed intervention.**

   The one event says `live_placement=laptop` even though the report says headphones ([plan:17](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md:17>)). Placement selects OpenAI’s near-field versus far-field noise reduction before VAD ([mic-placement.ts:1](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/mic-placement.ts:1>), [live.ts:561](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/live.ts:561>)).

   **Change:** first surface the existing noise-reduction choice directly in the `open-turn` notice—e.g. “Using headphones? Switch Noise reduction to Headphones and reconnect”—or provide a one-tap action that does that. This affects only a reader who has hit the stall, uses existing supported machinery, and addresses the only concrete configuration mismatch in the evidence.

9. **P3 — the proposed toggle semantics and copy need tightening.**

   A button whose visible name changes from Talk to Done should ordinarily be an action button, not an `aria-pressed` toggle. If `aria-pressed` is retained, use a stable accessible name. Also explain the two-step interaction before switching; “Tap to talk” can be read as either toggle-to-record or press-and-hold.

   **Change:** use **Talk** → **Done** without `aria-pressed`, plus explicit state text: “Tap Talk, speak, then tap Done.” While active: “Listening — tap Done when you’ve finished.”

I used the openai-docs workflow to verify the current Realtime/VAD behavior. I made no file changes.