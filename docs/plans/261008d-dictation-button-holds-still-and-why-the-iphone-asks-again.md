# Dictation: the button holds still for the second press, and why the iPhone asks again

Up: [dictation.md](../project/dictation.md)

Two reports from Greg (admin, provenance proven by `feedback-reporter.ts`, exit 0), batched as
Overseer queue item `qi-t6tn7q4y`. Report `spya-pd9fnc` is split, and this is its second part. Its
chat half went to session `fbpd9fnc`, which landed as plan 261008c.

> I have Spidey on on my phone. I've shared it to my home screen. Every time I try and use the
> microphone voice dictation button, for example in a feedback report, after having opened it, it
> asks me for permission. Is there any way to get it to remember that I've given permission for the
> microphone?
>
> Use Sonnet for web research.
>
> — Greg, spya-btjtbb, 2026-10-08 07:16 UTC

> Finally, I was trying to use the voice dictate button, and I was hoping to double-click to save
> what I just said and send in one go. But the button moves as soon as it gets pressed because it
> switches to "turning into text", and so I couldn't double-press it fast enough.
>
> — Greg, spya-pd9fnc (part 2 of 2), 2026-10-08 07:32 UTC, on `?mode=chat`

## Prior work

- [261005a](261005a-dictation-double-press-on-stop-also-sends.md) built the double press: for 600 ms
  after Stop, a second press on the same button means "send when the words arrive". It assumed the
  button stays where it was. In Chat it does not (below).
- [260910g](260910g-dictation-asks-for-the-microphone-twice-on-iphone.md) and its note
  [260908_1745](../user-feedback/260908_1745-microphone-permission-asked-twice-on-iphone.md) removed
  a second prompt that was ours (a speech-recogniser probe). They concluded the remaining prompts are
  WebKit's. This plan re-checks that against current WebKit.
- Queue item `qi-cfrv4spd` (a transcript landing in the next box) touches the same hook. It is not
  touched here.

## Part 2: the button moves at Stop

### What is happening (measured)

A Sonnet browser check (Playwright, Chromium with a fake microphone, `/api/transcribe` stubbed at
2 s, unmodified code) measured the microphone button's position around a Stop:

| Chat, 390×844 | button top | composer height |
|---|---|---|
| idle | 705.6 | 96.4 |
| listening | 646.3 | 155.7 |
| 50, 200 and 500 ms after Stop | **675.0** | 127.0 |
| transcript landed | 705.6 | 96.4 |

- **At Stop the button drops 28.7 px**, on the phone and at 1440 px wide alike. The button is 36 px
  tall, so a second tap where the first one landed falls above it. The check's real double tap
  (two taps 250 ms apart) missed: no "then sending…", nothing sent.
- **The cause is the "Microphone: … Change" line** (`.prof-mic-line`, 21.8 px with its margin).
  `DictationStrip` shows it only while `armed`, and the hook clears `deviceLabel` at Stop anyway.
  The line is removed at the very moment the second press is due.
- **Why that moves the button in Chat:** the chat band is `position: fixed` with its bottom edge
  pinned (`mode-band.css`). The composer is its last item, and the strip sits under the button row.
  The composer grows and shrinks upwards, so a line removed *below* the button moves the button
  *down*.
- **The Feedback dialog does not move.** Its button is in the box's header above the strip, and the
  panel did not resize. The check's double tap there was taken and the dialog sent and closed.
- "Turning that into text…" does not wrap, and its row changes height by 0.6 px. Greg read the
  wording change as the cause because it is what he could see change.

### The design

**Keep the strip the same height from listening through transcribing.** In `DictationStrip`:

1. **The microphone line stays while the words are being made.** The strip remembers the last
   label it was shown while armed and keeps drawing the line while `transcribing`. It is still
   true: that microphone made the recording now being transcribed. **"Change" is drawn but
   disabled** while transcribing, because there is nothing to restart, and that keeps its width.
   Remembering uses React's adjust-state-during-render pattern rather than an effect. An effect
   would leave one painted frame without the line, which is the shift we are removing.
2. **The "Couldn't use the microphone you chose" warning stays too, for the same reason.**
   `deviceUnavailable` already survives Stop in the hook. Only the strip's `armed` condition hid it.
3. **The picker closes at Stop, as today.** It is open only when a reader is choosing a
   microphone, which is not when they double-tap.

The fix is in the shared strip, so every box gets it, including ones where the shift does not
matter today.

### The simpler option passed over

**Change the hook so `deviceLabel` lives until the transcript lands.** That is one line, but the
hook's `deviceLabel` is read by other places (the fleet dashboard's box, `useDictation` consumers
generally) as "the device that is open now". Making it mean "open or just closed" would change a
fact every reader of it relies on. Keeping the memory in the strip, which is the one place that
draws it, changes no contract.

**Pinning the composer's height with a `min-height`** was also passed over. It would leave a blank
line in the composer after the transcript lands, and it fixes Chat alone rather than the strip.

### Test

`tests/dictation-strip-holds-still.test.tsx`, written red first: render the strip armed with a
label, then transcribing with `deviceLabel: null` (what the hook really does), and expect the
microphone line still there with "Change" disabled; then idle, and expect it gone. The same for the
"Couldn't use" warning. jsdom has no layout, so the browser check measures the button itself again
afterwards: its top must not change at Stop, and a real double tap must send once.

## Part 1: can the iPhone remember the microphone?

**Short answer: not from the page, and nothing has changed since September that would let it.**
Two Sonnet research subagents ran, one on WebKit's source (`main`, 2026-10-08) and one on the web.

What decides whether `getUserMedia` prompts (WebKit `UserMediaPermissionRequestManagerProxy.cpp`):

- **A grant lives only in memory, for the page.** `m_grantedRequests` is the only no-prompt path
  apart from whatever the browser shell itself stores. It is wiped when a new main document loads,
  and when the page's web process is recreated.
- **It is wiped 10 minutes after the microphone was last capturing** (a watchdog timer,
  `InactiveMediaCaptureStreamRepromptIntervalInMinutes`, default 10, all platforms). While a capture
  is live the timer is 24 hours.
- **The 1-minute iPhone rule applies only to requests made without a user gesture.** Ours is made
  after two awaits (the page-wide microphone lock, `enumerateDevices`), but WebKit carries the
  gesture through promise microtasks and explicitly re-enters it after `enumerateDevices`
  (`MediaDevices::enumerateDevices`, `computeUserGesturePriviledge`). So the source says our request
  counts as gesture-initiated. That is read, not observed on a device.
- **Spideryarn is a single-page app**, so moving around in it does not load a new document and does
  not wipe the grant. A WebKit bug from 2020 where URL changes reset grants in home-screen apps
  (215884) was fixed in iOS 14.5. Our `?at=`/`&stop=` URL updates are `replaceState`/`pushState`.

What a home-screen app adds: iOS reloads it on every cold start and whenever it likes in the
background, and nothing in WebKit's source persists a grant across that. On 2026-02-03 a WebKit
engineer, Youenn Fablet, wrote on bug 215884 that persistent permission for home-screen apps would
need a new bug. That reads as: no such feature exists. Safari 26 made every Add-to-Home-Screen site
a web app by default. Its release notes say nothing about permissions. The Permissions API only
reads state, and is unreliable on Safari (bug 257710). No manifest field pre-grants anything.

So, on an iPhone home-screen app, **expect a prompt on the first press after the app (re)starts,
and on any press more than 10 minutes after the last dictation ended.** Presses within 10 minutes of
each other in one sitting should not prompt — **except on a path of ours, found during this work
and fixed in stage 2 below.**

### Stage 2: a remembered microphone that no longer resolves spent the gesture

A follow-up read of WebKit's source (`MediaDevices::computeUserGesturePriviledge`,
`UserMediaPermissionRequestManagerProxy::processUserMediaPermissionRequest`):

- **A click buys one gesture-privileged microphone request.** The first `getUserMedia` for audio
  under a gesture records it; a second one in the same click is not privileged.
- **An `exact` request for a device id that matches nothing is refused before any prompt**
  (`validateRequestConstraints` runs first), but it has already spent that privilege.
- So when the reader has a remembered microphone whose id no longer resolves, our fallback to the
  system default is the click's *second* request, has no gesture, and falls under the iPhone's
  1-minute rule: **a prompt on any press more than a minute after the last capture**, where a
  privileged request would have reused the grant for ten.
- **Greg's iPhone was on that path on every press**: [dictation.md](../project/dictation.md) § The
  ways it fails, item 8 — *"The microphone you chose isn't available. Using another one"* on every
  press with AirPods (spya-k3q9mc, 2026-09-29). Since 2026-10-01 the new id is adopted when the
  name matches, which should have reduced it, but each id change still costs a prompt. The persisted
  device-id salt (`DeviceIdHashSaltStorage`) does not rotate by itself, so why the AirPods' id
  changed is not known — an iOS audio-route change is the likeliest.

**The fix:** before asking for a remembered id, list the devices (`enumerateDevices` spends
nothing). If the browser shows real ids and the remembered one is not among them, ask for the system
default straight away, as the only request of the click. If the ids are hidden (no grant yet in
this page), ask for the remembered id as before; there is no grant to reuse then, so there is a
prompt either way. `chosenInputListed` in `mic-devices.ts`; `ask` in `useDictation.ts §
beginCapture`. The "Couldn't use" warning and the same-device adoption run exactly as after a
refused request, because `preferred` is still what the reader chose.

- **Tests, red first:** `tests/dictation-recording.test.ts` — "goes straight to the default when
  the browser lists ids and the remembered one is not among them" failed (the stale id was asked
  for), then passed. Two more pin what must not change: a listed id is asked for by id, and hidden
  ids still ask by id. Three tests in `tests/dictation-phases.test.ts` encoded the old order of
  calls (stale `exact`, then the default) and were updated to the new one, keeping their intent:
  the named system default, not Chrome's choice; a stop during the default check opens nothing; a
  stop during the same-device check stops the track inside the claim.
- **The simpler option passed over:** `{ ideal: storedId }` instead of `exact`, which is one request
  in every case. On Chromium `ideal` loses to Chrome's own default choice (measured, 261001q), which
  is the silent substitution `exact` exists to prevent.
- **Not observed on a device.** The mechanism is read from WebKit's source; the box has no iPhone.

**The only page-side lever, and why it is not built:** keep the microphone capturing between
dictations, so the 10-minute timer never starts (a disabled track probably still counts; WebKit's
`setEnabled` does not stop the source). That means a live microphone, and the iPhone's orange
microphone dot, while the reader is not dictating. It also does not survive a cold start or a
background reload, which is most of what Greg sees. Holding a reader's microphone open to save a
tap is the wrong trade for this product. It is written here rather than built.

**Two things Greg can try on the phone (unverified, cheap):**

- Settings → Apps → Safari → Settings for Websites → Microphone → **Allow** (or per site, under
  the "aA" menu in Safari). Nothing documents whether a home-screen web app honours it. Reports in
  bug 215884 suggest it does not, but none says so outright.
- Use Spideryarn in a Safari tab rather than from the home screen. A tab honours that per-site
  setting.

**The WebKit bug already exists** (GPT Sol's plan review, F3):
[280394, "Persist permissions for getUserMedia"](https://bugs.webkit.org/show_bug.cgi?id=280394),
status NEW, with an Apple Radar (rdar://137183695). One comment on it says camera grants in a
home-screen app persisted as expected up to iOS 26.2 (January 2026) and stopped around 26.3.1. If
that is right, part of what Greg sees is a recent regression on Apple's side. Adding his iPhone's
iOS version and what he sees there is the useful move, rather than filing a duplicate. That is
Greg's to do or not.

## GPT Sol's plan review, and what was done with it

[The review](261008d-dictation-button-holds-still-plan-review-sol.md): build with the fixes. It
confirmed the adjust-state-during-render shape is StrictMode-safe and paints no frame without the
line, and that Part 1's WebKit reading matches the source.

- **F1 (P2), taken.** Learn's and Quiz's labelled microphones change their word from "Listening…"
  to the wider "Writing it down…" at Stop. In a wrapping row that can push Live onto its own line
  and move the button. The two places had a copy of the same expression each; they now share one
  component, `TalkLabel` in `DictationStrip.tsx`. While a dictation runs it holds both words in one
  grid cell with the other invisible, so its width does not change at Stop. Idle "Talk" is
  unchanged.
- **F2 (P2), taken.** An open microphone picker was also removed at Stop, and `picking` stayed
  true, so it came back on the next dictation. It now stays drawn, switched off, until the words
  land, and then closes.
- **F3 (P3), taken.** Above: WebKit bug 280394.

## Complexity this adds, named

One piece of state in `DictationStrip` (the remembered label), a second condition on two lines of
it, and one small shared component (`TalkLabel`) with three CSS rules. Nothing in the hook.

## Stages

One stage.

1. The red test, then the strip change, then the test green.
2. Gates: `npm test`, `npm run typecheck`, lint on touched files.
3. GPT Sol code review (write-capable).
4. The Sonnet browser check again on the fixed code: button top across Stop, and a real double tap in
   Chat at 390 and 1440, Feedback at 390.
5. Docs: [dictation.md](../project/dictation.md) gets the iPhone answer and the steady strip, and a
   postmortem names the class.
6. The note in `docs/user-feedback/`, `feedback-endings.ts`, push to `dev`.
