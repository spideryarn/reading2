# Plan re-review: tap to talk when noise holds the live turn open

You reviewed the first draft of docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md
and rejected it; your review is docs/plans/261003d-tap-to-talk-plan-review-sol.md. The plan has been
rewritten (§ The data, § What we build, § Why this, § Stages) to use OpenAI's documented
push-to-talk: session.update turn_detection null, input_audio_buffer.clear on Talk, commit +
response.create on Done, event_id-tagged client events whose errors become a notice instead of
ending the call, a walkie-talkie rule (no Talk while the companion answers), no Hands-free return,
reconnect re-sends the session.update after seeding.

Read-only. Re-read the plan and the same code (src/web/live/useLiveConversation.ts — the error
handler, seeding barrier, owe/accountUserReply, committed/item.created handlers, caps effect, hang-up
grace window, reconnect; src/web/live/LiveStatus.tsx; src/live.ts liveSession). Note the working tree
already holds an earlier, first-draft implementation (track.enabled only, readerHoldsTurn in
stall.ts) which will be replaced — review the plan, not that code.

Check especially, against current OpenAI Realtime GA docs:
1. The exact `session.update` shape for turning turn_detection off on a GA `type: "realtime"`
   session over WebRTC (is `session: { type: "realtime", audio: { input: { turn_detection: null } } }`
   right, and does a partial update leave instructions/tools/noise_reduction/transcription intact?).
2. Whether `error.event_id` is reliably populated with the client event's `event_id`.
3. Whether a commit after turn_detection null produces `input_audio_buffer.committed` and
   `conversation.item.created` (role user) and input transcription, so the existing ledger path
   handles it; and whether `response.create` right after `commit` is the documented order.
4. Whether a disabled WebRTC track during Done's 300 ms tail, then commit, is sound, or whether
   frames could still be lost/landed in the next turn (and whether the clear on Talk handles that).
5. Anything in your first review not addressed, or new problems the rewrite introduced.

Verdict (approve / approve with changes / reject) and numbered findings, P0–P3, each with the change.
