# Dictation asks for the microphone inside the press

Report `spya-wembb7` (Greg, admin, 2026-10-24 16:40 UTC, from the iPad home-screen app, in chat on
`arxiv-2308-08708-spya-xax6v4`):

> Every time I click on the dictate button in a chat, it asks me for permission to use the
> microphone, whereas somehow the feedback dialog seems to remember permission. Is there anything
> we can do about that? And in general, is there anything we can do for it to ask permission to use
> the microphone for dictate less often? I'm on an iPad. […]

Session `fbwembb7-dictation-permission`. Prior work this builds on, and does not repeat:
[261008d](261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md) (the WebKit grant
rules, and the stale-id fix) and
[260910g](260910g-dictation-asks-for-the-microphone-twice-on-iphone.md) (the probe kept off WebKit).

## What the evidence says

**Chat and Feedback run the same code.** Both use `useDictationField` → `useDictation.start()` →
`beginCapture`. Nothing about the permission differs between the two boxes: same constraints, same
order of calls, same hook. Chat's `toggleDictation` adds a wait only while Live is running.

**Production logs, 2026-10-24** (`dictation transcribed` and the chat routes, Vercel runtime logs).
The times are when each recording started, worked out from when it was transcribed and how long it
was:

| started | box | gap since the last capture ended | prompted? |
|---|---|---|---|
| 16:32:29 | chat | first of the page | yes (expected) |
| 16:35:14 | chat | 2.7 min | yes, per Greg |
| 16:39:08 | chat | 3.6 min | yes, per Greg |
| 16:39:28 | **feedback** | **~10 s** (a chat send at 16:39:22 in between) | **no** |

WebKit's rule (`UserMediaPermissionRequestManagerProxy::hasGrantedRequest`, read on `main`
2026-10-24): once the page holds a grant, a `getUserMedia` that **is not gesture-privileged** is
prompted again once capture has been idle for more than
`inactiveMediaCaptureStreamRepromptWithoutUserGestureIntervalInMinutes`, which is **1 minute on
iOS and iPadOS** (`WebPreferencesDefaultValues.cpp`, unless the idiom is desktop). A
gesture-privileged one reuses the grant until the 10-minute watchdog clears it.

So the table is **consistent with our request not being counted as a gesture**: the two chat
presses 3 minutes apart were prompted, and the Feedback press 10 seconds after a chat dictation
was not. Feedback did not remember anything. It was simply used within a minute of the
last dictation. The chat send between the two did not reset the grant either, which rules out
"something chat does wipes it".

**Why the request may not count as a gesture, though 261008d read the source as saying it does.**
`computeUserGesturePriviledge` asks whether there is a current user-gesture token when
`getUserMedia` is called. Ours is called after at least two awaits: the page-wide microphone lock
(`claimMicrophone`) and `enumerateDevices` (`defaultInputListed`, and `chosenInputListed` when a
microphone was picked). On `main`, the gesture is kept across `enumerateDevices` (its callback
re-enters the token with `ShouldPropagateToMicroTask::Yes`). A promise reaction, though, gets a
gesture-carrying dispatcher only when the token's `shouldPropagateToMicroTask` flag is set
(`JSGlobalObject::queueMicrotaskSlow`), and that flag defaults to false (`CrossTaskToken.h`). The
microtask drain that runs while the click is still being handled also sees the click's token. So
`main` probably does carry it, but whether it does depends on exactly when that drain runs. And
the code doing this is recent; which version is in the iPadOS on Greg's iPad, nobody here can say.
**The source cannot settle it. The logs are consistent with the gesture being lost**, and GPT Sol's
review adds that they would also fit the page or its web process being recreated between presses,
which nothing here can rule out. Sol read `main` as more firmly carrying the gesture than this plan
did: `enumerateDevices` re-enters it and propagates it to the promise's microtask, logic dated
20 May 2025. Either way, the request inside the press makes the version question irrelevant.
**What would tell us:** the iPadOS build, and two chat dictations 70 to 120 seconds apart without
leaving the app or using Live. After this change they should not prompt the second time.

## What we will do

**Ask for the microphone inside the press, before any await, whenever doing so is safe.** A
`getUserMedia` called synchronously from the click handler is gesture-privileged on every WebKit,
however promise propagation is implemented. That is the one thing a page can do.

`start()` already runs synchronously inside the click (Chat's `toggleDictation` adds a wait only
while Live is running or connecting; see below). It now does this, in order:

1. Reads whether anybody holds the microphone (`microphoneFree()`, new in `mic-lock.ts`: any claim
   taken and not yet released, Live's included).
2. Takes its own claim. `claimMicrophone` installs the claim before its first await, so it is
   taken synchronously and awaited later. The lock's rule, the claim before `getUserMedia`, holds.
3. **If nobody held it and this is not Chromium**, calls `getUserMedia` there and then. That is
   the **early request** (`earlyRequest` in `useDictation.ts`). On Chromium the probe has to run
   before any device opens, the system default is asked for by name after a listing, and the site's
   permission is kept anyway, so Chromium is unchanged. Firefox gets the early request too.

**A picked microphone is asked for as `ideal`, not `exact`** (`idealConstraint` in
`mic-devices.ts`). That was Sol's suggestion, and it replaces the remembered device listing this
plan first proposed. `exact` for an id that has gone is refused without a prompt and spends the
press's one privileged request (261008d). Checking the list first is an await, which is exactly
what this change is avoiding, and a remembered list can be stale in either direction. `ideal` is
one request whatever happened. Its one known fault is on Chromium, where it lost to Chrome's own
choice (261001q), and this path never runs there. **Measured on WebKit 26.5** (Playwright with its
four mock microphones, 2026-10-24): `ideal` opened the named device 4 of 4 times, and an `ideal`
for a missing id still opened a microphone rather than failing. Firefox is not measured; the box
has no Firefox build. Whether the pick was honoured is read off the opened track's id, and when it
was not, the same name check (`judgeFallback`) runs as after a fallback today. A remembered id
that changed but names the same microphone is adopted silently; a microphone that has gone is
reported.

`beginCapture` hands an early request to `adoptEarly`, which awaits it and does nothing else: no
probe, no listing, no fallback request. **The session owns the request until it adopts the track**
(`Session.early`). `finish` cannot stop a track that has not arrived yet, so a session that ends
while its request is pending (a Stop, an unmount, or a newer claimant asking it to stop) stops the
track when it arrives, and **only then releases the claim**. A second box pressed during that
window therefore waits for the first box's microphone to be truly off. The old path freed the
claim at once in the same situation.

**Still not inside the press: dictating while Live is running or connecting in chat.**
`toggleDictation` waits for `live.stop()` before starting dictation. Sol suggested a Live API that
cancels a ticket synchronously before Live owns the microphone, so dictation could start in the
same click. That is a new contract on another hook, for a press most readers never make. The path
works as it did before this change, so a sitting that goes from Live to dictation may still see
one prompt. It is written in dictation.md rather than built.

## What it will and will not change, on an iPad or iPhone

- **Will:** no prompt on a press within 10 minutes of the last dictation in the same sitting. That
  is the case in Greg's table.
- **Will not:** the prompt on the first press after the home-screen app starts or is reloaded by
  iOS, or after 10 minutes with the microphone idle. Those are WebKit's (261008d; WebKit bug 280394).
  Keeping the microphone open between dictations would avoid the second one. We passed on that
  again: the orange dot would stay on while nobody is dictating.
- **Not observed on a device.** The box has no iPad. Greg's next sitting is the test: two
  dictations a few minutes apart should prompt once.

## The simpler options passed over

**Drop the awaits altogether on WebKit**: no lock, no listing, `getUserMedia` first every time.
Fewer moving parts, but without the lock a press while another box holds the microphone opens a
second capture, and WebKit kills or reroutes the first. The early request keeps the lock and
skips it only when there was nobody to wait for.

**A remembered device listing** (this plan's first draft) to keep `exact` for a picked microphone.
Sol's plan review showed it could recreate the stale-id failure in both directions, and `ideal`
needs no listing at all. Review: [261024z-plan-review-sol.md](261024z-plan-review-sol.md).

**Live conversation** has the same shape (`claimMicrophone`, then `enumerateDevices`, then
`getUserMedia`) and is not changed here. It is not dictation, a start there goes through a ticket
fetch before capture anyway, and widening the change doubles what has to be reviewed. It is noted
in dictation.md as the next place to apply the same idea.

## Tests (red first)

`tests/dictation-phases.test.ts`, § the request inside the press. "Inside" is asserted within the
same synchronous `act` callback as `toggle()`, before any microtask runs.

- Safari, nothing picked: `getUserMedia` called inside the press. **Red before the change**
  (0 calls), green after. Also on the second press of a sitting, and on Firefox.
- Chromium: not inside the press. The probe still comes first.
- The claim is already taken when the request is made.
- Another box holding the microphone: not inside the press; it waits as before. Measured red by
  removing the `microphoneFree` condition.
- Stop pressed before the request lands: its track is stopped and nothing listens. Two boxes
  pressed in one gesture: the second does not ask until the first's track has been stopped.
- A refusal: one request, `[mic-refused]`, and the claim released.
- A picked microphone: asked as `ideal` and honoured; gone, with one request and the warning;
  under a new id, adopted silently.

The fixture now returns one track per stream from both `getAudioTracks` and `getTracks`, and a
second `stop()` on an ended track no longer counts. Before, each call minted a new track, so a test
could "stop" a track the hook never had (Sol, item 5). One older test now holds the first device
listing rather than the third, because the early path makes no listing before capture.

`tests/mic-devices.test.ts`: `idealConstraint`.

## Checked in a real WebKit

A Sonnet subagent drove this worktree's dev server in Playwright's WebKit (mock microphones) and,
as a control, Chromium, 2026-10-24. A capture-phase click listener on `window` marked
`inClick: true` and a bubble-phase one cleared it, so a `getUserMedia` called synchronously by
React's handler records `true`:

| Run | `getUserMedia` | listening |
|---|---|---|
| WebKit, chat, press 1 | 1 call, `inClick: true`, `{ audio: true }` | yes ("Mock audio device 1") |
| WebKit, chat, press 2 after Stop | 1 more, `inClick: true` | yes |
| WebKit, Feedback dialog | 1 call, `inClick: true` | yes |
| Chromium, chat | 1 call, `inClick: false`, `exact: "default"` | yes, unchanged path |

Caveat: that WebKit build has no `MediaRecorder`, so the check stubbed one (without it there is no
button at all). The capture and its timing are WebKit's own; recording and transcription on an iPad
are not exercised. Whether the iPad stops prompting is still Greg's next sitting to tell.
