# Sweep cluster 22: the live conversation's tap-to-talk policy as a pure function

Cluster 22 of the fifth codebase sweep
([umbrella](261003f-fifth-codebase-sweep-umbrella.md), § The clusters). Item **WC-W10, tap only**:
[the web-client audit](../investigations/261003b-fifth-sweep-web-client.md) (§ W10) and
[GPT Sol's review of it](../investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md),
which called the broad extraction overstated and kept only this part: *"Extracting a substantial tap
transition policy may help."*

## What this is for

Tap to talk is the walkie-talkie mode a reader in a noisy street is offered when sound holds their
turn open ([261003d](261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md),
[live-conversation.md](../project/live-conversation.md) § the *Tap to talk* row). Its rules live
inside `src/web/live/useLiveConversation.ts`, a 2,471-line React hook, in four places:

1. **What a refused tap event leaves behind** (the `error` handler, around line 1227). Four
   branches turn *(which event was refused, which mode we are in)* into *(next mode, microphone on
   or off, whether the owed reply is forgotten, the sentence the reader sees)*.
2. **Whether Talk may open the microphone** (`talk`, around 2398).
3. **What Done does**: nothing, discard a double tap, or send (`doneTalking`, around 2409).
4. **Which mode a new call starts in** (`start`, around 1684): tap to talk survives a Reconnect and
   nothing else.

Each is a decision over a handful of plain values, with the hook's refs and timers wrapped round
it. They are tested today only through the whole hook, with a fake data channel
(`tests/live-session-flow.test.tsx` from line 2232), which covers five of the sixteen
*(event kind × mode)* cells of rule 1 (the first draft of this plan said three; Sol counted). Nobody can read the whole table in one place, and the next
person to add a mode or an event kind has no compiler or test that says which cells they left out.

A second copy of rule 2 lives in `LiveStatus.tsx`: the Talk button's `disabled` expression restates
the handler's gate from different sources. Nothing holds the two together.

**No live defect was known when this was written.** The audit traced three suspected paths and each
was guarded. The plan review then found one (§ After the plan review), so this is no longer a pure
no-behaviour-change extraction.

## The change, as first planned

**Superseded by GPT Sol's plan review; kept so the reasoning survives. What was built is under
§ After the plan review.**

A new pure sibling, `src/web/live/tap.ts`, beside `stall.ts`, `tail.ts` and `mic-placement.ts`,
which are the same move made earlier for other decisions. It holds:

- `TalkMode` and `TapEventKind` (moved; `useLiveConversation.ts` re-exports `TalkMode`, so no
  importer changes) and the two timing constants.
- `tapRefusal(kind, mode, message)`, rule 1. Returns a discriminated union: `{ keep: true }` (the
  late `clear` error after a refused entry, which must change nothing) or
  `{ keep: false, mode, mic, dropDebt, notice }`. The `switch` over `kind` ends in a `never` check,
  so a fifth event kind fails to compile until it is given a row.
- `mayTalk({ live, mode, tailPending, companionBusy })`, rule 2. Called by the handler with its
  refs and by `LiveStatus` with the rendered state, so the button and the handler share one rule.
- `doneVerdict({ live, mode, heldMs })`, rule 3: `"refused" | "discard" | "send"`.
- `modeOnStart(keep, mode)`, rule 4.

The hook keeps everything that is not a decision: sending events, the microphone track, the timer,
the refs, React state.

One honesty fix rides along, from the audit's smells: `doneTimer` is cancelled by `start` but not
by `stop` or unmount; a guard makes the late callback a no-op. `stop` gets the `clearTimeout`, so
the code says what the guard was implying.

New test: `tests/live-talk-mode.test.ts`. The full sixteen-cell table for `tapRefusal`, written out
as literal expected values rather than computed; the gate and the Done verdict at their boundaries
(`TAP_MIN_MS - 1`, `TAP_MIN_MS`). Written first, and seen red against the missing module.

## What was passed over, and why

- **The simpler option: leave it.** The hook tests exist and pass. Passed over because they cover
  three cells of sixteen, because the button's copy of the Talk rule is held to the handler's by
  nothing, and because Sol's review judged this one part worth extracting. It is a close call and
  the review may still say drop it.
- **A full reducer (`tapStep(state, event) → state + effects`).** The audit's (b). Passed over: the
  effects (send, track, timer, stall bookkeeping) differ per action, so a reducer would return an
  effect list the hook then interprets, which is a second small language for four call sites.
- **The caps tick, the hang-up grace and the connection-state policy** (W10 c–e). Out of scope by
  the umbrella: Sol judged them indirection without removing the lifecycle tests.
- **GPT-Live** (`src/web/live/gpt-live/`). Tap to talk is not offered on that engine; its three
  actions are `notOffered`. Untouched.

## Stage (one)

1. Test first, red. 2. `tap.ts`. 3. The hook and `LiveStatus` call it. 4. `npm test`,
`npm run typecheck`, lint on touched files. 5. Browser check at phone and iPad widths: Talk, Done,
the disabled Talk while the companion answers. No paid session: the hook tests' fake channel is
the behaviour check, and the browser check is that the panel still renders and the buttons are the
same. 6. GPT Sol code review, write-capable. 7. Commit, push, umbrella row.

Done means: the four rules are in `tap.ts` and nowhere else; the hook tests pass unchanged; the
new table test passes and was seen red.

## After the plan review

[GPT Sol's review](261004e-sweep-cluster-22-plan-review-sol.md) refused the plan on one established
P1 and said to do less. All four findings were checked and accepted.

**F1 (P1), a live defect: a late refusal strands a turn that has already been sent.** Talk sends a
buffer clear; Done, 300 ms after it is pressed, sends the commit. If the service's refusal of that
clear arrives after the commit has gone, the old handler treated it like any refused clear: back to
Ready, reply debt forgotten, and the "a commit is awaited" flag cleared. The commit's
acknowledgement then arrived and asked for no reply, with the voice detector off, so the reader's
turn sat unanswered. A late refusal of the entry `session.update` cleared the same flag. Reproduced
as two failing hook tests before the fix.

The fix is one more fact for the rule: **`submitted`**, true when the mode is `tap-sending` and
Done's tail has run. A refused clear against a submitted turn changes nothing. Only the outcome
that returns to Ready forgets the awaited commit; the entry refusal no longer does, so a submitted
turn is still answered after it.

**F2 (P2): the Talk button and the `talk` action disagree for up to 300 ms.** A clear refused
inside Done's tail put the mode back to Ready while the tail's timer was still pending, so the
button was enabled and the action refused it. Sharing `mayTalk` would not have fixed that, because
the button cannot see the timer. Fixed at the cause instead: returning to Ready cancels the tail.
Red-first, a third hook test. `LiveStatus.tsx` is untouched.

**F3 (P2): three of the four functions fail the deletion test.** `mayTalk`, `doneVerdict` and
`modeOnStart` are one condition each with one caller; moving them relocates a line and adds an
import. Dropped. They were built, then removed.

**F4 (P3):** five cells covered, not three. Corrected above.

**What landed:**

- `src/web/live/tap.ts`: `TalkMode`, `TapEventKind`, and `tapRefusal(kind, { mode, submitted },
  message)`, returning `{ keep: true }` or `{ keep: false, mode, mic, forgetTurn, notice }`. The
  `switch` ends in a `never` check.
- `useLiveConversation.ts`: the `error` handler's tap branch applies that value; `stop` clears
  Done's tail (Sol confirmed this is neutral for the hang-up grace).
- `tests/live-talk-mode.test.ts`: the full table, four kinds by five states (`tap-sending` is two:
  in the tail, and commit gone), as literal values.
- `tests/live-session-flow.test.tsx`: three new tests, each seen red on the baseline hook.

**Known and left:** a refused clear cannot be tied to the turn that sent it, so a clear refusal
that arrives after the reply has begun, or during the *next* Talk, is still read as being about the
current state. Closing that needs a turn number on every tap event. Not built: a refused
`input_audio_buffer.clear` has never been observed, and it needs that plus a delay of seconds.

**Browser check** (Sonnet subagent, Playwright on the box, a faked `RTCPeerConnection` and ticket
route, no paid call), at 390×844 and 820×1180 with touch: the open-turn notice, Tap to talk, Talk,
Done, Sending with Talk disabled, and the double tap that sends no commit all behaved and read as
documented; no overflow; no console errors from this code. It exercised the happy path only, and
it ran while the tree was being narrowed after the review; the happy path's code is the same in
both versions. The refusal paths are covered by the hook tests, not the browser. Shots:
`261004e-shot-phone-tap.png`, `261004e-shot-ipad-tap.png`.

## Log

- 2026-10-04 — plan written against dev at `0a98b28ab`. Greps re-run: the tap regions have moved
  about 75 lines up since the audit (GPT-Live landed in its own folder and did not touch them).
- 2026-10-04 — plan review back: refused on F1, do less. Rebuilt narrower; F1 and F2 fixed red-first.
