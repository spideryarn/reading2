# A live conversation that stalls says so, and one tap recovers it

Report SPIDERYARN-READING2-42, 2026-09-12 16:39Z, from Greg (an admin — trusted input), on a phone:

> I tried using the live real-time conversation in a chat. I'm on my phone walking down the street
> with sort of fancy headphones that are usually pretty good at cancelling out noise in the
> microphone, I don't know. And the real-time live conversation just kept kind of hanging,
> unexpected.

Where: `entropy-24-00930-spya-bmvfyb`, thread `spya-uwhuwv`, build `c9ab99b1` (on `dev`; the only
live-code commits since are the Live-button label and one more chat tool, neither of which touches
the session lifecycle).

The feature is [live-conversation.md](../project/live-conversation.md); the hook is
[`useLiveConversation.ts`](../../src/web/live/useLiveConversation.ts) (below, "H").

## What we could and could not see

**No production evidence was reachable from this session.** The run is on a pool account: the
Sentry and Vercel MCPs are unauthenticated, the Vercel CLI is logged out on this box, and
`DATABASE_URL` is the local Supabase, so the `realtime_sessions` row for that conversation — whose
`close_reason` would say how it ended — cannot be read. Stated rather than worked around, and it is
itself part of the finding: **if the session never ended, even that row would say nothing**, because
every stall below leaves the page `live`.

So this is a diagnosis from the code, with a second reading by Fable (2026-09-15), and the fix is
aimed at the class — *a state the outside world can put the session into, with no exit and nothing on
screen* — rather than at one guessed cause.

## The stuck states, from the code

Ranked by how well they fit "walking down the street with ANC earbuds, kept hanging".

1. **Street noise opens a turn that the page never lets close.** `speech_started` sets `hearing` and
   `midSentence` (H:870-872). `midSentence` is cleared only by `input_audio_buffer.committed` or a
   user item (H:787, H:792). While it is true:
   - the status says "Listening…" (LiveStatus.tsx `status`);
   - no tool continuation is sent (`takeContinuation(midSentence)`), and every `speech_started`
     supersedes every pending continuation (tool-responses.ts `interrupt`) — so a tool result whose
     turn was "interrupted" by noise is answered only if a later turn commits;
   - **both caps are switched off** (H:1722 returns before the idle and session checks), so a stuck
     `midSentence` is not bounded at five minutes or twenty but at never.

   Whether OpenAI's `semantic_vad` holds a segment open for long under continuous street noise is a
   guess. What is certain is the other half: `interrupt_response` defaults to true, so every
   noise-triggered `speech_started` cancels the answer being spoken — which also sounds like hanging.
2. **The phone mutes the microphone and the page keeps saying "Listening — you can speak now".**
   iOS mutes a capture track on screen lock, a Bluetooth route change, Siri or a call. The hook
   listens only for `ended` (H:1600), and the level meter treats a muted track as "know nothing" and
   simply disappears (useAudioLevel.ts, rule 2). No notice.
3. **The voice stops while the page says "Speaking…".** The `<audio>` element (H:1406) has no `pause`
   listener; `playbackBlocked` is set only from `enableAudio`, which runs once, on `ontrack`.
4. **The connection wobbles silently.** `disconnected` gets an 8 s grace with nothing on screen, and
   every `connectionstatechange` clears the deadline (H:1391), so a mobile link that flaps
   `disconnected → connected` inside 8 s, repeatedly, never fails and never says anything.
5. **A reply is owed and never comes.** The reader's turn is committed, or a tool result is sent,
   and no `response.created` follows — a dropped `response.create` on a flapping channel, or a
   continuation superseded by (1). `toolResponses.requested` resets only on `created()`, so the
   status can also sit on "Thinking…" indefinitely.

Each of these is ours in the sense that matters: the page gets into a state and neither leaves it
nor names it.

## What we are building

**One detector, one notice, one recovery.** Revised after GPT Sol's plan review (§ Review, below).

- **A pure `stallOf(facts)`** in `src/web/live/stall.ts`. The hook keeps the facts it already sees —
  the microphone track's `muted`, the connection state, when the reader's current turn opened, when
  a reply became owed, whether a response is in progress, when the last data-channel event arrived,
  whether the companion is audibly speaking, whether a tool is running — and asks, on a one-second
  tick while `live` (and at once on a mute or a connection change), which stall, if any, is
  happening now. No React, no clock of its own (`now` is a fact), so each rule is a unit test.
  Kinds, in the order the notice prefers them:

  | kind | when |
  | --- | --- |
  | `microphone-paused` | the microphone track is `muted` — the phone took the samples away |
  | `connection` | the peer connection is `disconnected` (shown at once; the existing 8 s failure stays) |
  | `open-turn` | the reader's turn has been open (`midSentence`) for 30 s straight |
  | `no-reply` | a reply has been owed for 12 s with the reader not mid-sentence and no tool running; **or** a response is in progress, not audibly playing, no tool running, and nothing has arrived on the channel for 20 s |

  **A reply is owed** from a committed turn (`input_audio_buffer.committed`, or a non-seed user
  item), from the moment the hook actually sends a tool continuation's `response.create`, and from
  `say()`'s `response.create`. It is **not** owed when a function output is sent: the continuation is
  deliberately withheld until the response and every tool have finished (tool-responses.ts), and
  counting from the output would call that deliberate wait a stall. It is discharged by
  `response.created`, and the clock runs from when it became owed — unrelated traffic proves the
  channel is alive, not that the reply came.

  The thresholds are generous on purpose: a reader holding a thought can talk for twenty seconds,
  and a slow mobile network is not a broken one. Constants at the top of the file, each with its
  reason.
- **The notice** is a line in `LiveStatus` beside the existing ones. `LiveApi` gains
  `stall: LiveStall | null` and `reconnect(): void`.
- **Reconnect is stop-then-start on the same thread**, which is what the microphone picker already
  does. The hang-up drains the ledger and writes what was said (marked interrupted), and the new
  session is seeded from the saved conversation. **It carries an intent token**: any other `stop`
  (Send, Continue typing, a thread switch), an unmount, or a new start cancels the pending restart,
  so a reader who presses Reconnect and then chooses to type is not dragged back into a call. It does
  not restart after a teardown that failed (an append refused), which already shows an error and
  Retry. It is offered **while `live` only** — during `connecting` the existing Cancel is the
  control. The ending names itself: `reconnect-<kind>`, or `reconnect` with no stall showing. The
  button is **always there while live**, not only with a notice, because the stall we did not think
  of is the one that will happen next.
- **Two display flags reconcile on terminal events.** A committed turn or a user item clears
  `hearing` as well as `midSentence`, so a lost `speech_stopped` cannot pin "Listening…".
- **The audio element's `pause`** sets `playbackBlocked` (which already shows **Enable sound**) only
  when it is still this session's element, the epoch is current, the session is not closing, and it
  has a stream — our own `pause()` in `stop()` queues its event asynchronously, so an old player's
  event can arrive after a reconnect has begun.
- **One Sentry event per stall kind per session**, once the stall has lasted 5 s (a sub-second
  Bluetooth mute is not worth a report), through `captureClientFailure`. The error's **name** is
  `LiveStall-<kind>`: `sanitise` withholds any message without a registered code and keeps the name,
  and Sentry's dedupe compares type and value, so one name for every kind would drop the second.
  Tags only: the kind, the placement, and counts so far of `speech_started`, `committed`,
  `response.created`, cancelled responses, microphone mutes and disconnects. No words, no device
  label, no thread, article or session id. Not anonymous: the monitoring scope already carries the
  signed-in reader's id, as every client report does.
- **The caps are unchanged.** "Never in the middle of a sentence" stays: lifting it after 30 s could
  end a genuine long utterance at the session cap, which is a product decision rather than a fix.

### Not built, and why

- **A "noisy place" setting, push-to-talk, or `interrupt_response: false`.** Each changes how the
  conversation behaves, so each is Greg's call rather than a fix. They are the only things that make
  street noise *structurally* harmless rather than visible: `server_vad` with a raised `threshold`,
  or `semantic_vad` with `eagerness: "low"`, plus `interrupt_response: false` so noise cannot cut the
  companion off; or push-to-talk (`turn_detection: null`, commit on release), which makes noise
  irrelevant at the cost of a held button. Written up for Greg in the report's note; this plan builds
  none of them.
- **"Reset listening" by sending `input_audio_buffer.clear` or `.commit`.** It would discard the words
  of a reader who was genuinely talking, and any provider `error` event currently fails the whole
  session (H:889), so a clear or commit at the wrong moment turns a stall into a failure. Reconnect is
  one mechanism, already exercised by the microphone picker, and loses nothing a hang-up keeps.
- **An automatic reconnect**, and **a hard bound on a turn held open for ever.** Deciding for the
  reader that a long open turn is noise is the guess this plan declines to make. A notice and a
  button first; automate once Sentry shows which stall actually happens.
- **The remote output track's `mute`/`ended`.** Whether a quiet companion's track reads as muted is
  unknown, so it would be a notice firing between answers. The `pause` listener and the
  always-present Reconnect cover the output side for now.
- **A "flapping connection" rule** (three disconnects a minute). Cut on review as the part with the
  least evidence behind it; each disconnect already shows `connection` while it lasts, and the tally
  goes to Sentry.
- **Recording the tally in the journal row.** It needs a column; the 64-character `close_reason` is
  the wrong home. Sentry carries it for now.
- **The `AudioContext` `interrupted` state.** That context drives only the level meter; playback is
  the `<audio>` element.

**The simpler option passed over:** only the Reconnect button, no detector. It makes every stall
recoverable but none visible — the reader still has to guess that the silence is a fault rather
than the companion thinking, which is the complaint.

## Review

GPT Sol, plan review, 2026-09-15 (`--sandbox review`): **approve with changes**. Taken: the
reconnect intent token (a restart after the reader chose to type), the owed-reply seam (count from
the `response.create` actually sent, not the function output), a rule for a response that started
and went silent, reconciling `hearing` on commit, guarding the `pause` listener by identity and
epoch, one Sentry name per kind with a dwell, and dropping both the cap change and the flap rule.
Not taken: remote-track `mute`/`ended` (above).

## Stages

1. **Red tests first**, in `tests/live-session-flow.test.tsx` against the fake wire, each watched to
   fail on the current code:
   - a muted track shows `microphone-paused`, and unmuting clears it;
   - a `disconnected` connection shows `connection` at once, before the 8 s failure;
   - a `speech_started` that never commits shows `open-turn` after 30 s;
   - a committed turn with no `response.created` shows `no-reply` after 12 s;
   - a response that was created and then went silent shows `no-reply`; a continuation deferred
     behind a slow tool does not;
   - Reconnect pressed and then Continue typing does not start a new session;
   - Reconnect stops and starts on the same thread, and the ending reason is `reconnect-<kind>`;
   - the `<audio>` element pausing shows Enable sound.
   Plus `tests/live-stall.test.ts` for the pure rules, including the negative cases: a reader
   talking for 20 s is not a stall; a slow tool is not `no-reply`; a flap that recovers once is not
   `connection` after it has recovered.
2. **Build**: `stall.ts`, the hook wiring, `LiveStatus`, the Sentry event. Then the gates:
   scoped tests, `npm run typecheck`, `npm run lint` on the touched files, GPT Sol code review
   (workspace-write), one full suite through `scripts/tmux-job.ts`.
3. **Docs and the report**: [live-conversation.md](../project/live-conversation.md) § The lifecycle
   gains the stall rows and the Reconnect ending; a postmortem naming the class; the note in
   `docs/user-feedback/`.

## Done looks like

Each of the five states above, reproduced on the fake wire, ends in a sentence on screen and a
button that works — and the next time it happens to a real reader, Sentry holds a tally that says
which one it was.

## Results

**Stage 1, `dff07ebb`.** Eleven new tests — ten in `tests/live-session-flow.test.tsx` § "a stall says
so, and Reconnect recovers it", plus the pure file `tests/live-stall.test.ts` — were run against the
unchanged code and failed, each because the stall or Reconnect did not exist; the existing 58 in the
flow file stayed green. After the build: 131 tests across the live and doc files pass, typecheck
exit 0, and lint shows only the four complexity advisories on `start` and `stop`, which were already
long.

**GPT Sol code review** (`--sandbox workspace-write`, findings written before any edit). Two
findings, both real, both fixed by the reviewer with a test watched red first:

1. **A false "No reply yet".** There was one owed-reply clock, owed by every commit and user-item
   event and cleared by any `response.created`. So a turn whose item event arrived *after* its
   response had started, or arrived under both spellings, re-owed a reply that was already under way.
   The debt is now counted once per user item id, and a response that began during the turn
   discharges it.
2. **Continue typing was disabled while `closing`**, and a reconnect is `closing`, so the control that
   cancels a pending reconnect could not be pressed. The hook test called `stop()` directly, which is
   why nothing went red. It stays enabled now, and pressing it joins the hang-up.

After the fixes, checked here rather than taken from the reviewer: 176 tests across the live and doc
files pass, and typecheck exits 0. The reviewer's own typecheck hit a sandbox `EPERM` on tsx's IPC
socket and was re-run by hand.

**Full suite, once, through `scripts/tmux-job.ts`, at `e0d93f7b`:** 1121 files and 24272 tests pass;
**6 files and 5 tests fail, none of them in live code** — this branch touches only `src/web/live/`,
the live tests and docs. Each was re-run on its own:

- `cold-start-lazy-imports`, `pdf-bundle-trace`: this worktree has no `api-dist/`. They are the two
  reds `worktree:setup` predicts for a tree that has not been built.
- `fleet-decisions-route`, `fleet-reports-route` (`process.exit(2)` in `tools/fleet/server.ts`) and
  `fleet-composed-access` (all 76 skipped): the same missing build. `ENOENT` on
  `tools/fleet/web/dist/assets`.
- `overseer-daemon-usage-pass` › "`keep-stored` still carries the DISCARDED fresh report": red on
  its own too. Its fixtures carry fixed `collectedAt` dates of 2026-09-08, a week before this run, so
  it looks dependent on the clock. Not investigated further, because it is in overseer code this
  branch does not touch.

Postmortem: [260915b-live-conversation-stalls-silently.md](../postmortems/260915b-live-conversation-stalls-silently.md).
