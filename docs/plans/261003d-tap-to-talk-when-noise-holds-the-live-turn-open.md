# Tap to talk, offered when noise holds the live turn open

Report spya-kzdmhb ([SPIDERYARN-READING2-42](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-42)),
queue item `qi-8k6vjbzz`. Greg, on his phone, walking down the street in noise-cancelling headphones:

> the real-time live conversation just kept kind of hanging, unexpected.

[260915b](260915b-live-conversation-stalls-visible-and-recoverable.md) made each stall visible, with
a Reconnect button and a Sentry `LiveStall-<kind>` event. It left making noise *harmless* to Greg,
and on 2026-09-24 the answer was "wait for data"
([awaiting-approval.md § Answered 2026-09-24](../user-feedback/awaiting-approval.md)).

## The data

Read on 2026-10-03.

- **Sentry: one `LiveStall` event in all, and it is `open-turn`.**
  [SPIDERYARN-READING2-6Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6Y), 2026-09-30
  03:47:00 UTC, Greg, release `f9ac22eb`, placement `laptop`. Tally: `speech_started` 1,
  `committed` 0, responses 0, mutes 0, disconnects 0.
- **Production `realtime_sessions` since 2026-09-15: five sessions, all Greg's** (read-only query).
  The stalled one connected at 03:46:23, so the turn opened within about two seconds of connecting
  (30 s threshold + 5 s dwell = 03:47:00). It was still open when he hung up at 03:47:37 (`reader`).
  That is 74 seconds, the session's only turn, and it never closed.

This is **consistent with continuous sound, and the best fit to the report, but it is not proof.**
`semantic_vad` closes a turn within a few seconds of the sound stopping, so a turn that stays open
for over a minute most likely means the detector heard something continuous as a person still
speaking. That is `open-turn`, which 260915b's comment in `stall.ts` describes as "the voice detector
hearing a street as somebody who has not finished". GPT Sol's plan review points out what the
evidence cannot exclude. The tally does not count `speech_stopped`, so a `speech_stopped` followed by
a missing commit would look identical. So would a media-path failure that never moved
`connectionState`. Telemetry gains a `speech_stopped` count, so the next event can tell these apart.
One event is thin, but it is the only stall seen, it matches the report, and nothing points
elsewhere. The placement was `laptop` at 23:47 local time, so this one was probably not a street.
Noise from a room fan holds a turn open just as well.

Reconnect, the only answer on screen today, does not help with this one. A fresh call goes into the
same street.

## What we build: tap to talk, for this call, when the reader asks for it

When the `open-turn` notice shows, it offers a **Tap to talk** button beside Reconnect. Pressing it
switches *this call* to OpenAI's documented push-to-talk. The voice detector is turned off, and the
reader says when each turn starts and ends:

```
 hands-free (today, unchanged)          tap to talk (opt-in, from the notice)
 ────────────────────────────           ─────────────────────────────────────
 mic always sent; the detector          nothing sent ──[Talk]──▶ sent ──[Done]──▶ committed, answered
 decides when you start and stop,       noise between turns never reaches the service,
 so noise can hold the turn open        and no detector is listening for it
```

**The mechanism is the documented one**
([Realtime conversations § Push-to-talk](https://developers.openai.com/api/docs/guides/realtime-conversations#push-to-talk)),
**not** an assumption about how the detector treats silence. The first draft rested on
`micTrack.enabled = false` making the detector close the turn. GPT Sol's plan review rejected that,
because nothing documents it. Semantic VAD may keep waiting after an unfinished-sounding sentence,
and a disabled track over WebRTC may send nothing at all rather than silence.

- **Entering** sends `session.update` with `audio.input.turn_detection: null`, then
  `input_audio_buffer.clear`, and disables the track. The turn the noise was holding open is
  **dropped, not answered**. The reader has just been told that sound is holding their turn open,
  and answering 30+ seconds of street is worse than asking them to say it again. The hook's local
  turn state (`midSentence`, `turnOpenSince`, `hearing`) resets with it, and so does the stall's
  Sentry dwell.
- **Talk** sends `input_audio_buffer.clear` and enables the track. It is not offered while the
  companion is answering (thinking, speaking, or a tool running). This is a walkie-talkie: talking
  over a reply would need `response.cancel`, `output_audio_buffer.clear` and the interruption
  bookkeeping that `speech_started` does today, and that waits until someone asks for it.
- **Done** disables the track and moves to **`tap-sending`**. It waits `TAP_TAIL_MS` (300 ms) for
  the last frames already in flight, then sends `input_audio_buffer.commit` and owes a reply
  (`owe()`). **`response.create` goes out when `input_audio_buffer.committed` comes back**, not
  beside the commit, so a refused commit does not produce an answer to nothing. `tap-sending` ends
  at `response.created`. Until then Talk is refused, because nothing else says the companion is
  busy in that gap (GPT Sol, re-review). The tail timer is bound to its session, and a hang-up
  inside the tail drops the turn. The existing `committed` and `conversation.item.added` handlers
  take it from there: ledger, transcription, thread. A Done less than `TAP_MIN_MS` (500 ms) after
  Talk sends a clear instead of a commit, so a double tap commits nothing. The 300 ms is a cushion,
  not a guarantee: WebRTC audio and the data channel are separate paths. The clear on the next Talk
  removes any late frames that have already arrived.
- **A provider error caused by one of these events does not end the call.** Every client event this
  mode sends carries an `event_id` with a `spya-tap-` prefix. An `error` event whose `error.event_id`
  has that prefix shows its message as a notice, and does not call `failSession`. Today *any*
  provider error ends the session (`useLiveConversation.ts`, `type === "error"`), and an empty-buffer
  commit or a refused `session.update` must not hang up on the reader. If the refused event was the
  entry `session.update`, the mode goes back to hands-free and the track is re-enabled. If it was
  any other tap event (a clear, a commit or a reply), the track goes off, the mode returns to
  Ready, and the owed reply is released. An error with no tap `event_id` still ends the call.
- **No way back to hands-free within the call.** It lasts for the call and survives a Reconnect,
  including the reconnects the microphone and noise-reduction pickers trigger. The new session is
  minted with `semantic_vad` as usual, so tap mode is re-sent as a `session.update` once seeding
  finishes, and the track stays off. A reconnect from `tap-talking` comes back as `tap-idle`. A Live
  start the reader makes themselves is hands-free. A Hands-free button would need the client to know
  the server's turn-detection settings, a second copy of `src/live.ts`'s, for a case nobody has
  asked for.
- **Stalls.** In tap mode the detector is off, so no `speech_started` arrives and `open-turn` cannot
  fire. `midSentence` stays false, so the idle and session caps are never bypassed. Talk and Done set
  `lastHeard`, so a forgotten Done ends at the five-minute idle cap like any quiet call. `no-reply`
  works unchanged off `owe()`. `microphone-paused` still outranks everything: Talk cannot help while
  the device has the microphone.
- **Hang-up while Talk is on** drops the unfinished turn. The grace window waits on `midSentence`,
  which tap mode never sets, so the hang-up is immediate. That is honest about a turn the reader had
  not finished.
- **The status line** reads state word **Ready**, sentence "The conversation isn’t listening. Tap
  Talk, speak, then tap Done." While talking: **Listening**, "Listening — tap Done when you’ve
  finished." The level meter is shown only while talking, because otherwise it would show a street
  the conversation cannot hear. Talk and Done are plain action buttons whose labels change, not an
  `aria-pressed` toggle.
- **Telemetry.** Every `LiveStall` event gains `live_tap_to_talk` (0/1) and `live_speech_stopped`
  (a count). The second answers GPT Sol's point about the one event we have.

### Why this and not the other three

Each option in 260915b § Not built changes **every** live conversation, and Greg declined to choose
one without data:

- `eagerness: "low"` or a raised `server_vad` threshold: makes every reader's turns slower to end,
  and does not stop continuous noise, which is what the event shows.
- `interrupt_response: false`: stops noise cutting a reply off, but noise still holds the turn open.
  It also removes interrupting by voice, for everyone.
- Push-to-talk for everyone: a held button for a problem most calls do not have.

Tap to talk is the third option offered only to the call that has just shown the problem, by the
notice that names it. Nobody else's conversation changes.

**Not "switch noise reduction to Headphones" in the notice either**, which GPT Sol suggested as the
evidence-directed option because the event said `laptop`. That label was probably right: it was
23:47 local time, on an article read at a desk. `near_field` is the *lighter* filter, made for a
microphone at the mouth. It is not a stronger defence against a street, and no filter setting stops a
detector that hears continuous sound as speech.

**The simpler option passed over: a different sentence on the `open-turn` notice** (for example
"try somewhere quieter"). It costs nothing, but walking down a street it leaves the reader with no
way to talk at all. **The other one passed over: an automatic switch after the stall.** It decides
for the reader that the sound is noise, which is the guess 260915b declined.

## The spike: OpenAI's real server, 2026-10-03

[`scripts/spike-live-push-to-talk.ts`](../../scripts/spike-live-push-to-talk.ts) runs over a
WebSocket against `gpt-realtime-2.1`, with the session configured exactly as `liveSession`
configures a reader's (laptop placement). The events are the same as over the browser's WebRTC data
channel; only the audio transport differs. Two runs:

- **A. What noise does to the detector.**
  - **Rumble alone opened no turn at all.** That was fifteen seconds of brown noise at a third of full
    scale, and `far_field` noise reduction removed it entirely.
  - **Rumble plus other people's voices, quieter than a reader's, did everything the report
    describes.** A bystander was taken for the reader and the turn was committed. The companion then
    *answered the bystander* ("…are you just venting about the week?"). That reply was cut off 0.1 s
    later by the next bystander words. The next turn was then **held open for eleven seconds, until
    the voices stopped**. A real street does not stop. This is the noise case, reproduced: it is
    people, not traffic.
- **B.** The partial `session.update` with `turn_detection: null` is accepted. The echoed session
  keeps the same instructions, transcription and noise reduction.
- **C.** An empty commit is refused with `code: input_audio_buffer_commit_empty`, and
  `error.event_id` is the `event_id` we sent.
- **D.** A turn of noise, then a spoken sentence, then noise, committed by hand: `committed`, then
  `conversation.item.added`, then a correct transcription ("What does the author mean by entropy in
  the second section?"), then a reply (a `show_passage` call, which is normal). With the detector
  off, no `speech_started` arrived at all.

## Review

- **GPT Sol, plan review (`--sandbox review`): reject.** The first draft disabled the track and
  relied on the detector closing the turn on the silence. Nothing documents that, and the hang-up's
  version of the same assumption is itself unmeasured. Taken: the documented push-to-talk; the
  evidence reworded as a best fit rather than proof; `speech_stopped` in the telemetry; the meter
  and quiet notice hidden together; plain action buttons; honest copy (Ready, not "Mic off"). Not
  taken: suggesting Headphones noise reduction (§ Why this). Answered by the spike rather than
  argued: B, C and D above.
  [261003d-tap-to-talk-plan-review-sol.md](261003d-tap-to-talk-plan-review-sol.md).
- **GPT Sol, plan re-review: approve with changes.** Taken: `tap-sending`; the tail bound to its
  session; per-event error recovery; tests for a reconnect from Ready and from Talking, `quietInput`,
  a tap turn written into the thread, and an error that names no event. On reply debt: the reply is
  requested only after `committed`, so `response.created` cannot precede its own commit, and a test
  drives a whole tap turn into the thread without re-owing it. Not done: the two-utterance WebRTC
  check for late frames. The box has no microphone, and the spike's WebSocket has no transport
  delay to measure.
  [261003d-tap-to-talk-plan-rereview-sol.md](261003d-tap-to-talk-plan-rereview-sol.md).

## Stages

1. **Red tests first.** In `tests/live-session-flow.test.tsx`, against the fake wire, each watched
   to fail before the fix:
   - entering tap to talk sends `session.update` with `turn_detection: null` and a clear, disables
     the track, and clears an open turn;
   - Talk sends a clear and enables the track; Done disables it and, after the tail, sends
     `commit` then `response.create`; a Done within 500 ms sends a clear and no commit;
   - Talk is refused while a response is in progress;
   - an `error` whose `event_id` is a tap event shows a notice and leaves the call live; an error
     against the entry `session.update` returns to hands-free; any other error still ends the call;
   - a Reconnect from `tap-talking` comes back as `tap-idle`, re-sends the `session.update` after
     seeding and keeps the track off; a fresh start is hands-free;
   - setting the mode outside a live call does nothing.
   In `tests/chat-live-handoff.test.tsx`: the notice offers Tap to talk only on `open-turn`; Talk and
   Done call the hook; Talk is disabled while the companion is answering; the meter is hidden while
   Ready.
2. **Build** in `useLiveConversation.ts` and `LiveStatus.tsx`. Gates: the scoped tests,
   `npm run typecheck`, `npm run lint` on the touched files, a GPT Sol code review
   (workspace-write), and one full suite through `scripts/tmux-job.ts`.
3. **OpenAI's real server.** This was planned as a browser call with Chrome's fake microphone, but
   that microphone does not exist on this box
   ([browser-testing-playwright.md](../project/browser-testing-playwright.md), "There is no
   microphone"). So it became the WebSocket spike above, which tests the protocol the browser would
   send. What only a phone can check, the WebRTC audio path itself, is Greg's: in a street, with
   headphones.
4. **Docs and the report.** A row in [live-conversation.md](../project/live-conversation.md); a
   note in `docs/user-feedback/` for spya-kzdmhb; `scripts/feedback-endings.ts`; mark the queue item
   done.

## Not built

- **A tap-to-talk switch shown before any stall.** It would add a control to every call, after
  261002j deliberately took controls away. Revisit if readers go looking for it.
- **A keyboard shortcut for Talk.** Phone first.
- **Lowering `OPEN_TURN_MS`.** Thirty seconds is a long time to wait in a street, but a shorter
  threshold would fire on a reader who is thinking aloud. The data so far is one event.
