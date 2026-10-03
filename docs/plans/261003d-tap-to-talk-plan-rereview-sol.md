Verdict: **approve with changes**. No P0 findings.

The rewrite fixes the original rejection’s central problem. OpenAI documents this exact GA update shape:

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "audio": {
      "input": {
        "turn_detection": null
      }
    }
  }
}
```

Only supplied fields are changed, so instructions, tools, transcription, and noise reduction remain intact. OpenAI also documents `clear → capture → commit → response.create` for WebRTC push-to-talk. A commit creates a user message, emits `input_audio_buffer.committed`, and starts configured transcription. [Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events), [Realtime push-to-talk](https://developers.openai.com/api/docs/guides/realtime-conversations#push-to-talk).

1. **P1 — Done needs an explicit finishing/awaiting-reply state.**

   At [plan:72](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md:72>), Done returns the UI to `tap-idle` before the 300 ms tail expires and before `response.created`. During that gap, none of thinking, speaking, or tool-running is necessarily true, so Talk can become available and violate the walkie-talkie rule.

   There is also a data-loss/stale-timer race: Stop or Reconnect during the tail can close the old channel before commit, or a delayed callback can accidentally address a replacement session if it uses the hook’s current channel.

   **Change:** add a synchronous `finishing`/`awaiting-response` latch. It must:

   - refuse Talk from Done until the reply lifecycle has taken over;
   - bind the tail callback to the originating epoch and data channel;
   - make Stop/Reconnect wait for the Done commit to be dispatched, because the reader already declared that turn finished;
   - remain unavailable throughout response, playback, and tool continuation.

   Add tests for rapid Talk after Done, Stop during the tail, and Reconnect during the tail.

2. **P1 — the existing reply-debt protection does not cover manual turns.**

   The current late-event protection records that a response already started only when `midSentence` is true ([useLiveConversation.ts:1312](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:1312>)). The plan deliberately keeps `midSentence` false in tap mode. Therefore, if `response.created` arrives before the commit/item acknowledgements, those later events can call `accountUserReply` and re-owe a response that already happened, producing a false `no-reply` stall.

   The ledger also needs the committed user item before attributing the response. The protocol’s documented order is reassuring, but this hook already defends against late lifecycle events and should not make manual turns the exception.

   **Change:** track a manual turn from commit until its user item and response have been correlated, independently of `midSentence`. Add the adversarial fake-wire sequence:

   `response.created → input_audio_buffer.committed → conversation.item.added`

   Verify that it neither re-owes the reply nor misattributes/drops the exchange, and that the completed reader transcription and answer reach the stored thread.

3. **P2 — 300 ms is a useful cushion, not a transport guarantee.**

   WebRTC audio and control use separate channels. Disabling the track and waiting 300 ms makes it likely that locally queued audio reaches OpenAI before commit, but no official documentation promises that 300 ms drains RTP under every mobile-network condition. `clear` on the next Talk removes late audio that has already arrived, but cannot categorically prevent a severely delayed frame from arriving after that clear.

   **Change:** keep the delay only as a measured cushion and strengthen the real-session check at [plan:151](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md:151>). Use two recognizable, back-to-back utterances with distinctive final words. Verify:

   - each final word appears in the correct transcription;
   - no tail from turn one appears in turn two;
   - both exchanges persist, not merely that the model replies once.

4. **P2 — correlated errors are documented, but recovery must be event-specific.**

   For a client event that directly causes an error, OpenAI documents that its client-generated `event_id` is passed back. It is not guaranteed on unrelated session/provider errors, so the plan is right to leave uncorrelated errors on the existing fatal path. For Realtime, the correlation is `error.event_id`; the top-level event ID identifies the server event.

   The test wording at [plan:140](</home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md:140>) is ambiguous, and only the rejected entry update has defined recovery.

   **Change:** use the real envelope in tests:

   ```json
   {
     "type": "error",
     "error": {
       "event_id": "spya-tap-…",
       "message": "…"
     }
   }
   ```

   Also define the other cases: a failed Talk `clear` must disable the track and return to Ready rather than recording onto an unknown buffer; commit/response failures must clear the finishing latch and leave an actionable notice. An error without a matching nested ID must still end the session.

5. **P2 — several findings from the first review remain absent from the plan’s tests.**

   **Change:** add explicit coverage for:

   - `quietInput` as well as the visible meter while Ready—the meter clone remains enabled;
   - `say()` while `tap-talking`, which otherwise creates a response beside uncommitted audio;
   - reconnect from both `tap-idle` and `tap-talking`, including picker-triggered reconnects;
   - a ref as the synchronous mode authority, with no track mutation inside a React state updater and a StrictMode test;
   - the current GA item spelling, `conversation.item.added`, while retaining the existing compatibility handler for `conversation.item.created`.

The evidence wording, telemetry addition, caps, device-mute priority, copy, action-button semantics, no automatic switch, and no Hands-free return now address the corresponding first-review findings. I made no file changes.