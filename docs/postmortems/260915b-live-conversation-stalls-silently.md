# Live conversation stalls silently

Report SPIDERYARN-READING2-42, 2026-09-12 16:39Z, from Greg — an admin, on a phone, walking outdoors
with noise-cancelling earbuds:

> I tried using the live real-time conversation in a chat. I'm on my phone walking down the street
> with sort of fancy headphones that are usually pretty good at cancelling out noise in the
> microphone, I don't know. And the real-time live conversation just kept kind of hanging,
> unexpected.

**Which of the states below actually caught him is not known, and cannot be found out now.** The
session ran on a pool account with no Sentry, no Vercel logs and no production database reachable,
so the `realtime_sessions` row for that conversation — whose `close_reason` would say how it ended —
was never read. And even reading it would not have settled this: every stall this file describes
leaves the page `live` with nothing wrong on screen, so the row it would have written says nothing
either. That is itself the finding, not a gap in the investigation: **this class of bug is invisible
to the evidence that would normally close a report**. The diagnosis below is from the code, in
[`useLiveConversation.ts`](../../src/web/live/useLiveConversation.ts) ("H", line numbers against the
version before the fix — `git show dff07ebb^`), read a second time by Fable on 2026-09-15, and the
fix is aimed at the class rather than at one guessed cause. The report, the diagnosis and the plan
that came from it are in
[260915b](../plans/260915b-live-conversation-stalls-visible-and-recoverable.md); the note to Greg is
[260912_1639](../user-feedback/260912_1639-live-conversation-hangs-on-a-phone.md).

## What happened

Five states, verified in the pre-fix code, each left the page saying "Listening…" or "Thinking…"
indefinitely:

1. **Street noise opens a turn the page never closes.** `speech_started` sets `midSentence.current =
   true` (H:870, confirmed by `git blame`). It is cleared only by `input_audio_buffer.committed`
   (H:787) or a `user` conversation item (H:792) — nothing clears it on a timeout. While it is true,
   no tool continuation is sent, and **the idle and session caps do not apply**: `if
   (midSentence.current) return;` (H:1722) skips both checks on every tick, so a turn stuck open is
   bounded at neither five minutes nor twenty, but at never.
2. **The phone mutes the microphone and the page keeps saying "Listening — you can speak now."** The
   only listener on the track is `"ended"` (H:1599–1601, confirmed — it is the sole
   `track.addEventListener` in the file). iOS mutes a capture track on screen lock, a Bluetooth route
   change or a call; that fires `mute`, not `ended`, and nothing was listening for it.
3. **The connection wobbles silently.** `disconnected` gets an 8-second grace period with nothing
   shown on screen, and `connectionDeadline.current` is cleared on *every* `connectionstatechange`
   (H:1391), so a mobile link that flaps `disconnected → connected` inside 8 seconds, repeatedly,
   never fails and never says anything.
4. **A reply is owed and never starts**, or starts and goes silent — a dropped `response.create` on
   a flapping channel, or a continuation superseded by (1). Nothing on screen distinguishes "the
   model is thinking" from "the model was never asked."
5. **The `<audio>` element pauses** (screen lock, a call) with no `pause` listener, so the page still
   claims to be speaking.

Each of these is a state the outside world — the phone's OS, the mobile network, ambient noise — put
the session into, that the hook had no exit from and gave no name to.

## The class: a state entered from outside with no exit and no signal

A `useState`/`useRef` flag set from an external event (a WebRTC callback, a track event, a server
message) is safe only if every path that sets it has a matching path that clears it **and** a
display that tells the reader which state they're in. Here, four flags were written this way —
`midSentence`, the disconnect grace timer, "a reply is owed" (never modelled explicitly — see below),
and playback — and every one of them had a route in with no guaranteed route out. The commit that
built the idle/session caps even says the quiet part out loud in its own comment (H:1717–1721): *"a
cap that fires while the reader is talking ends the session and takes what they were saying with
it… It will fire on the next tick, ten seconds later, which nobody will notice."* That sentence is
true for the ordinary case it was written for — a turn that commits a moment later — and silently
false for the case this report is about: a turn that never commits at all, because street noise
holds `speech_started` open without ever producing a commit.

**A reply being owed was never a tracked fact until this fix.** There was no field for "a
`response.create` was sent and nothing has come back" — so the fourth stall had no state to leave at
all; the page just kept showing whatever it had shown last. A state machine with an untracked
obligation is a sharper instance of the same class: you cannot give an exit to a fact you never
recorded holding.

## Which commits introduced it — verified, not assumed

`git blame` against `dff07ebb^` (the file as it stood before this fix) on each of the lines above:

- **`94ddccd4`** (2026-08-31 14:59:39, *"The answer went to the turn that interrupted it, and my
  test used the one order that hides it"*) introduced `midSentence` itself — its set at H:870, its
  two clear sites at H:787/792, `IDLE_CAP_MS`/`SESSION_CAP_MS`, and the `if (midSentence.current)
  return;` bypass. This is **not** the first version of the file: `0bfc30fe` (2026-08-31 09:39:19,
  *"OpenAI has no realtime API, so the voice talks straight to OpenAI"*), the original spike, has no
  `midSentence`, no idle cap and no track listener at all — confirmed by reading `git show
  0bfc30fe:src/web/live/useLiveConversation.ts`. `94ddccd4` landed the same day, three commits later,
  and its own message says it was fixing a *different* bug GPT Sol had found: *"the new idle cap
  could fire mid-sentence and take the words with it."* The guard against interrupting a sentence is
  what created the open-ended sentence.
- **`7eb8f2a0`** (2026-09-06, *"Make realtime chat visible, resumable and recoverable"*) added the
  disconnect grace period and its silent 8-second window (H:1386–1399) and the microphone track's
  sole `"ended"` listener (H:1598–1601) — both confirmed absent at `94ddccd4` and present at
  `7eb8f2a0`. This is the commit the plan calls "the 2026-09-06 repair": it made startup and the
  connection failure *bounded*, but bounded-and-silent for 8 seconds is still a state with no signal,
  and it never added a `mute` listener alongside `ended`.

So the class was introduced twice, by two different, well-intentioned fixes to two different bugs —
neither one caused by carelessness, both of them narrowing what they were asked to narrow and leaving
the rest of the state's lifecycle exactly as open as they found it.

## Why nothing went red

- **No test modelled an external event with no matching response.** `tests/live-session-flow.test.tsx`
  (pre-fix) drove the fake wire through ordinary turns — commits that happen, connections that
  recover — because that is what the feature was built and reviewed against. Nothing in the suite
  asked "what does the UI show if `speech_started` fires and nothing ever follows it?" A green suite
  and a stuck reader are consistent with each other exactly because the suite never modelled the
  event this bug needed.
- **The 8-second disconnect grace was reviewed and approved as a *bound*.** GPT Sol's review of
  `7eb8f2a0` was asking whether the connection failure fires at all, not whether the wait before it
  is visible. A correct answer to "is this bounded?" is not an answer to "is this visible while it
  lasts?" — the two questions look like the same question and are not.
- **The comment at H:1717–1721 named the risk it was written to fix and stopped one clause short of
  the risk that mattered.** It reasoned about a turn that *does* commit a moment later, which is the
  case the bug it was fixing needed, and never asked what happens when the turn never commits.
- **Nothing counted these events.** `seen: Record<string, number>` on `LiveApi` already recorded
  every event type by name, but nothing compared "a `response.create` was sent" against "a
  `response.created` came back" — the fact that would have shown a reply going missing was one
  subtraction away and was never taken.

## What would have caught it, ranked by ease against value

1. **For every externally driven flag in a state machine, write down at the point it's set: what
   clears it, and what does the screen say while it's true?** A habit, free, aimed at the class
   rather than the instance — it would have caught all five states at review time, because none of
   them can answer both halves of that question. It belongs next to
   [live-conversation.md](../project/live-conversation.md) § The lifecycle, which now carries the
   stall table.
2. **A pure function from facts to stall state, tested against the fake wire with each external event
   injected and nothing following it** (a mute with no unmute, a `disconnected` with no recovery, a
   `speech_started` with no commit, a `response.create` with no `response.created`). **Done**:
   `src/web/live/stall.ts`'s `stallOf()`, unit-tested in `tests/live-stall.test.ts` including the
   negative cases (an ordinary 20-second thought is not a stall; a tool running its own 60-second
   deadline is not `no-reply`), and exercised end-to-end against the fake wire in
   `tests/live-session-flow.test.tsx` (`"a stall says so, and Reconnect recovers it"`).
3. **Never leave a bounded-but-silent window** — if something has a timeout, show it counting down
   the moment it starts, not only once it fires. Aimed at the class; the disconnect grace now shows
   `connection` at once rather than waiting out its own 8 seconds in silence.
4. **A full state-machine audit tool that proves every flag has a reachable clear-path from every
   set-path, mechanically.** Rejected for now — the codebase has one state machine this size, and a
   general prover is disproportionate to it. Item 1 is the same question asked by a person at review
   time, which is cheap enough to actually happen.

## The fix that is right for the long term

The fix on this branch (`stall.ts`, the hook's one-second tick, `LiveStatus`'s notice, a Reconnect
button, one Sentry event per stall kind per session) is the right shape, not a patch: it does not
guess which of the five states hit Greg, it makes all five visible and recoverable, and it starts
collecting the telemetry — `LiveStall-<kind>` in Sentry, tagged with counts of `speech_started`,
commits, `response.created`, cancelled responses, mutes and disconnects, no words or ids — that will
say which one actually happens in the field. What it deliberately does not do, named in the plan and
left for a product call rather than folded in here: it does not change how noise is handled
structurally (`server_vad` threshold, `semantic_vad` eagerness, `interrupt_response: false`,
push-to-talk) and it does not auto-reconnect or hard-bound an open turn — deciding for the reader that
a long open turn is noise is exactly the kind of guess this fix declines to make anywhere else.

## The thing I would tell myself

Both introducing commits were themselves fixes for real bugs a reviewer had caught — an idle cap
firing mid-word, a connection failure with no cap at all — and both were correct about the bug they
were aimed at. The mistake in each case was answering "does this stop the bad thing" and never asking
"what does the reader see while my fix is pending, and is there any way in that has no way out?" A
comment that reasons carefully about the case it was written for is not evidence about the case one
clause outside it — H:1717–1721 says so about itself, if you read the sentence it stops at rather than
the sentence it makes. Next time a fix bounds or gates a state that an external event can set, the
question is not "did I fix the bug" but "did I leave anything this flag can now get stuck in that
nobody clears and nothing shows."

---

Up: [Postmortems](../project/postmortems.md)
