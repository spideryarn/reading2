The plan should defer the full GPT-Live migration—but the spike should become Stage 0, before the Realtime-specific cleanup. GPT-Live is not a model-name swap, and parts of Stage 1 would otherwise be built twice.

I found no P0 issues.

## Findings

### P1 — Run the GPT-Live spike first; don’t migrate blindly

The central decision is mostly right: do not replace `gpt-realtime-2.1` with `gpt-live-1` without evidence. The migration is materially larger than the plan implies.

The current browser flow mints a client secret, captures audio, then sends SDP directly to OpenAI ([src/live.ts:549](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/live.ts:549), [useLiveConversation.ts:1804](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/useLiveConversation.ts:1804)). GPT-Live’s browser flow instead sends the browser’s SDP offer to your server, which creates the Live session and returns the SDP answer. It also changes history seeding, transcript ownership, completion, usage accounting, and graceful close. OpenAI’s [GPT-Live WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc) and [migration guide](https://developers.openai.com/api/docs/guides/live-migration) describe that different lifecycle.

However, the plan’s order contradicts both Greg’s “first things first” request and its own migration risk:

- Stage 1a is Realtime-only.
- Stage 1b currently assumes item/response ownership that GPT-Live transcripts do not provide.
- Stage 1c depends directly on the transport startup sequence.
- Closing and cost accounting also change.

The assertion that Stage 1 will survive migration “almost unchanged” ([plan:62](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/docs/plans/261002j-live-voice-chat-cleanup.md:62)) is therefore too strong.

**Fix:** make the measured spike Stage 0. Decide the model immediately afterwards, then implement the UI and prompt once against the chosen lifecycle. If GPT-Live fails the thresholds, continue with the Realtime cleanup.

The plan’s API reading is otherwise substantially correct:

- The 16,384-character instruction limit is correct ([f4-live-conversations.md:22](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/logs/f4eq-openai-docs/f4-live-conversations.md:22)).
- Startup input is limited to 128 messages and 8,192 combined tokens ([f4-live-conversations.md:97](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/logs/f4eq-openai-docs/f4-live-conversations.md:97)).
- “No turn IDs” should be stated more precisely: transcript deltas have no item ID and there is no completed-turn event, although delegation and other events do have IDs ([f4-live-conversations.md:191](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/logs/f4eq-openai-docs/f4-live-conversations.md:191)).
- Responses delegation is the sensible starting point when the current model selects tools, but the application still executes its custom functions. See OpenAI’s [delegation guide](https://developers.openai.com/api/docs/guides/live-delegation).
- `$0.05/minute`, billed per second, plus backend model/tool usage is correct. One omitted wrinkle: WebRTC initialization is initially charged as 15 seconds, but that amount is credited against session duration once the session runs. The plan should not call GPT-Live cheaper until the spike measures complete sessions.

### P1 — A disabled track cannot drive the connecting meter

Stage 1c is impossible as currently written.

The captured track is disabled before seeding ([useLiveConversation.ts:1851](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/useLiveConversation.ts:1851)), and it is not passed to the analyser until it is enabled ([useLiveConversation.ts:1686](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/useLiveConversation.ts:1686)). The returned level is additionally hidden unless the phase is `live` ([useLiveConversation.ts:2125](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/useLiveConversation.ts:2125)).

Even if `useAudioLevel` received the disabled track, it would sample silence. The browser standard specifies that consumers receive zero-information audio while a track is disabled ([Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)).

**Fix:** capture once and keep that track enabled for the local analyser, while gating transport separately:

1. Give the captured track immediately to `useAudioLevel`.
2. Negotiate an audio transceiver without attaching the microphone track for sending.
3. After history seeding and the tail barrier, attach it with `RTCRtpSender.replaceTrack(micTrack)`.
4. On teardown, detach/stop it with the existing epoch protections.

An alternative is an enabled analyser track plus a disabled clone for transport, but a transceiver with `replaceTrack` has fewer ownership ambiguities.

This needs a real-browser test; a fake `MediaStreamTrack` will not establish that disabled tracks produce silence or that sender replacement behaves correctly.

### P1 — Stage 1b needs exchange-owned provisional content, not the current flat `lines`

Three related failures are hidden by the present split UI.

**Late transcript ordering.** The exchange ledger correctly associates a late assistant response with the reader turn that caused it, but `put()` appends its visible line when the transcript first arrives ([useLiveConversation.ts:979](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/useLiveConversation.ts:979)). A sequence such as reader U1, reader U2, late answer R1 can therefore render U1, U2, R1 even though persistence files R1 with U1. Moving those lines into the main thread makes the contradiction more visible.

**Passage ownership.** Passage pointers are global and `LiveStatus` renders only the latest one ([LiveStatus.tsx:120](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/LiveStatus.tsx:120)). They are not owned or removed by exchange, so “move the pointer onto its provisional reply” can attach the wrong pointer or leave it behind after that reply is handed off.

**Interrupted failure.** If a drained, interrupted answer never receives `transcript.done`, a failed handoff restores its copied line with `done: false` ([useLiveConversation.ts:739](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/useLiveConversation.ts:739)). It can blink indefinitely even though the session is idle or failed.

**Fix:** expose provisional exchange groups ordered by ledger sequence, containing their reader lines, assistant lines, pointer/tool events, and interrupted state. Remove a group by its exchange identity when handed to chat. Do not use raw line insertion order.

A simpler acceptable v1 is a `LiveTail` inside `.chat-scroll`, after saved `Turn`s, while continuing to defer passage links until the exchange has entered the normal chat controller.

### P1 — “Exactly once” and scrolling need stronger implementation requirements

The existing handoff removes live lines and synchronously calls `speak()`, whose operation immediately projects provisional chat rows before the network response ([useLiveConversation.ts:715](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/useLiveConversation.ts:715), [useChat.ts:462](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/useChat.ts:462)). Consequently, the transfer should occur when those provisional controller rows are installed—not when confirmed database rows “arrive.” Waiting for persistence would duplicate the exchange for the whole request.

A 409 repair is more delicate: controller repair can remove provisional rows before the hook restores its live copy, allowing a one-frame gap across two stores.

Also, the follow-scroll effect watches saved-message content and status, but not live transcript deltas or passage growth ([ChatPanel.tsx:1113](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/ChatPanel.tsx:1113)). Its special empty-thread path can repeatedly scroll to the top while the first live exchange is growing.

**Fix:**

- Define handoff as ownership transfer to controller-provisional rows.
- Add DOM-level tests asserting one visible copy throughout normal save, delayed save, 409 repair, failed repair, and interruption.
- Include live-tail length/content and pointers in follow-scroll dependencies.
- Treat live content as conversation content when deciding whether to scroll to the top.
- Preserve the existing rule that only an actual reader scroll changes “stick to bottom.”
- Keep `hasUnsavedLines` adjacent to the unsaved tail after a 409 reload and explicitly say that its stored position is uncertain.

### P1 — Removing “Continue typing” breaks reconnect cancellation

Removing “Use dictation” is safe: the composer retains its dictation control, and starting dictation already joins live teardown first ([ChatPanel.tsx:2054](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/ChatPanel.tsx:2054)).

Removing “Continue typing” is not safe during reconnect teardown. `LiveButton` is disabled in `closing` ([LiveButton.tsx:33](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/LiveButton.tsx:33)), while the present status action deliberately calls public `hangUp()` so it can cancel a pending reconnect ([LiveStatus.tsx:147](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/LiveStatus.tsx:147)).

Failure scenario: the reader presses Reconnect, changes their mind during the 2.5-second closing/repair period, and begins typing. With the action gone, the pending reconnect can reopen the microphone while they are typing. Sending eventually tears it down, but the unwanted restart may already have happened.

**Fix:** retain a narrowly contextual “Keep typing / Cancel reconnect” action during reconnect teardown, or make the first deliberate composer interaction synchronously cancel reconnect intent. Add a reconnect → type-before-close-completes test before deleting the current action.

### P2 — The GPT-Live experiment is too small to support the proposed decision

One question, one run, and a WebSocket spike cannot establish “clearly faster or better.”

The experiment should repeat at least:

- A conversational follow-up requiring no article lookup.
- An article-grounded answer requiring delegation and `show_passage`.
- An interruption or correction while backend delegation is running.
- A normal server tool.
- Short and over-16k-instruction articles.
- Multiple turns, to expose cache/context reuse and accumulated backend cost.

Measure median and tail latency, answer correctness, passage correctness, interruption behavior, session startup, and total Live plus backend cost. Because GPT-Live can speak a backchannel immediately while delegation continues, “first output audio” is misleading; record first substantive answer audio separately.

A WebSocket spike is fine for evaluating voice and delegation, but it does not validate the browser handshake or startup lifecycle. Add a minimal WebRTC probe or explicitly keep that as a separate migration risk. Exclude synthetic TTS cost from the model comparison.

### P2 — Low reasoning is a sound starting point, but an echo check is insufficient

`reasoning: { effort: "low" }` belongs at the top level of the Realtime `session` object, alongside `model`, `instructions`, `tools`, and `audio`—in this code, near [src/live.ts:503](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/live.ts:503). `mintLiveToken` already wraps that object correctly under `session`.

Low effort is OpenAI’s recommended production starting point for voice agents, and the plan’s direct-answer, short-sentence, no-filler prompt changes align with the [Realtime prompting guide](https://developers.openai.com/api/docs/guides/voice-prompting).

The risk is grounding quality: low effort limits the model’s reasoning budget, while this companion must choose and cite the right passage. A successful request and echoed field only establish syntax.

**Fix:** compare low against the present/default behavior on representative article questions, measuring answer accuracy, `show_passage` call rate, and selected-block accuracy as well as latency. Also say explicitly that `show_passage` needs no spoken preamble; otherwise the generic slow-tool instruction can add filler before the most frequent, immediate tool call.

## Recommended plan shape

1. Stage 0: broadened GPT-Live spike and explicit migration decision.
2. Implement the chosen transport/session lifecycle.
3. Add exchange-owned `LiveTail` rendering and atomic handoff tests.
4. Add the connecting meter using capture/transport separation.
5. Apply prompt and reasoning changes with grounding evaluation.
6. Simplify controls, retaining reconnect cancellation until composer interaction safely replaces it.

No files were changed. This review used the repository’s downloaded documentation, current official OpenAI documentation, and the [OpenAI Docs skill](/home/greg/.codex/skills/.system/openai-docs/SKILL.md).