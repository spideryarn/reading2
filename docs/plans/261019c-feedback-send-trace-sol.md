## 1. Press-to-POST paths on iPad Safari

The relevant files are unchanged from production commit `956a2380`.

| Gesture | What happens and what is visible |
|---|---|
| **Tap Send after dictation has finished** | Form submission calls `send()` ([FeedbackDialog.tsx:1242](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:1242)). It synchronously latches the action and sets `stage="sending"` ([FeedbackDialog.tsx:967](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:967), [FeedbackDialog.tsx:1001](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:1001)). The button becomes disabled and changes from **Send** to a 14px spinner plus **Sending** ([FeedbackDialog.tsx:1575](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:1575)). |
| **Tap Send while the microphone is opening/listening** | The button is enabled and still reads plain **Send**. `send()` sees `dictationBusy`, records a wish to send, stops the microphone, and returns without posting ([FeedbackDialog.tsx:987](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:987), [useDictationField.ts:452](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictationField.ts:452)). It promptly becomes **Writing that down** with a spinner; the strip says **Turning that into text, then sending…** ([FeedbackDialog.tsx:1593](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:1593), [DictationStrip.tsx:94](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/DictationStrip.tsx:94)). On Safari, Stop immediately enters `transcribing` because there is no live recogniser ([useDictation.ts:1255](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictation.ts:1255)). After the transcript lands, the latest `onDone` calls `send()` from an idle render containing the completed text ([useDictationField.ts:292](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictationField.ts:292)). |
| **Tap Send while already transcribing** | Before the tap it already says **Writing that down** with a spinner. The tap records “send afterwards”; the button itself looks unchanged, but the strip adds **then sending**. POST follows when the transcript lands. It never remains plain **Send**. |
| **Double-press Stop** | The first Stop is deliberately held for 300ms with no visual change, so the second press still lands on Stop ([useDictationField.ts:70](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictationField.ts:70), [useDictationField.ts:481](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictationField.ts:481)). The second press follows the same **Writing that down → Sending → POST** route. |
| **Single Stop** | After 300ms it stops and transcribes without requesting a send ([useDictationField.ts:500](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictationField.ts:500)). When the words land, the button returns to plain **Send**. Nothing posts until the reader taps it. This best matches the logs. |
| **Empty/failed transcript** | `delivered` remains false, so deferred `onDone` is not called and there is no POST ([useDictationField.ts:382](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictationField.ts:382)). Normally the strip shows an error. |

Before `fetch()` starts, every `apiFetch` awaits Supabase’s session lookup. That may consume the full 1.5-second deadline before falling back to the cached token ([api.ts:593](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/lib/api.ts:593), [api.ts:1256](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/lib/api.ts:1256), [api.ts:1336](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/lib/api.ts:1336)). This delay is invisible in Vercel’s request duration, but the button should display **Sending** during it.

There is no normal route where a recognized Send tap spends seconds still showing plain **Send**. The exceptions are a click that never fires, and the intentional 300ms first-Stop hold.

## 2. Can the Sending state fail to paint?

It can be easy to miss, but it is not absent:

- The disabled rule applies `opacity: 0.45` to the entire working button, including **Sending** and its spinner ([feedback.css:754](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/styles/feedback.css:754), [feedback.css:774](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/styles/feedback.css:774)).
- The spinner is only 14px.
- It is orange/highlight-coloured, not green-on-green; the button has a transparent background with green text/border ([annotations.css:1109](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/styles/annotations.css:1109)).
- Reduced motion changes rotation to a pulse. At the pulse’s minimum, the spinner’s `0.25` opacity compounds with the button’s `0.45`, making it roughly 11% opaque; the word **Sending** remains at 45% ([annotations.css:1115](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/styles/annotations.css:1115)).
- Sticky hover cannot conceal it: the hover rule excludes disabled buttons ([feedback.css:775](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/styles/feedback.css:775)).

Synchronous diagnostics and large screenshot serialization happen after `setStage` but before the first `await`, so they can block the paint ([FeedbackDialog.tsx:1031](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:1031)). This report had no consent and no screenshot, so that path is negligible here.

On success, the dialog closes and a five-second toast is rendered outside it ([FeedbackDialog.tsx:1088](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:1088), [FeedbackDialog.tsx:1609](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:1609), [Toast.tsx:35](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/Toast.tsx:35)). That toast does not follow `visualViewport`, so it may initially be beneath the disappearing iOS keyboard—possibly explaining “presumably got sent.”

## 3. Can dictation’s `onDone → send()` silently no-op?

There is no stale-closure bug in the ordinary path:

- `done.current` is refreshed every render.
- The action is deferred until the render containing the landed transcript and `busy=false` ([useDictationField.ts:298](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictationField.ts:298)).
- A real 206-character transcript therefore makes `somethingSaid` true ([FeedbackDialog.tsx:786](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:786)).

Intentional no-ops are:

- the dialog closed: `doneKey` changes and withdraws the wish; `onDone` also checks `open`;
- the reader switched to Earlier: `send()` refuses `view !== "write"`;
- the transcript was empty/failed;
- the transcript made the report over-length;
- a picture is still being prepared;
- another send is already latched.

See [useDictationField.ts:274](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useDictationField.ts:274), [FeedbackDialog.tsx:821](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:821), and [FeedbackDialog.tsx:972](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:972). None fits this successful transcript and eventual successful POST.

## 4. iOS-specific risks

There is no code that deliberately consumes the first tap to dismiss the keyboard. Send is a native submit button.

The dialog does resize and recenter on every `visualViewport` resize/scroll event, specifically to follow the iOS keyboard ([FeedbackDialog.tsx:1177](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/FeedbackDialog.tsx:1177), [useVisualViewport.ts:94](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/useVisualViewport.ts:94)). Therefore a WebKit tap cancellation caused by the footer moving during keyboard dismissal is plausible, but unproved. If that happened, there would be no eventual POST from that tap; a later tap must have activated it.

The button has a 40px coarse-pointer target but no `touch-action: manipulation` ([tap-target.css:34](/var/tmp/spideryarn-worktrees/fban90k0-feedback-send-no-spinner/src/web/styles/tap-target.css:34)). Any normal tap delay would be hundreds of milliseconds, not several seconds. Sticky `:hover` is cosmetic and cannot block the click.

## 5. Ranked explanation and fix

1. **Most likely:** Greg used single Stop, spent 17–19 seconds rereading, then tapped Send. The actual tap-to-request interval may include the 1.5-second session lookup plus mobile transit. During that interval the correct **Sending** UI was present but unnecessarily dim at 45% opacity.

2. **Possible:** the first iOS tap was lost while the keyboard and `visualViewport` moved; a later tap performed the send. The logs cannot prove or disprove this.

3. **Unlikely here:** synchronous preparation prevented a paint. Consent and screenshot evidence exclude the expensive branches.

4. **Not supported:** server slowness, stale `onDone`, or a 17–19-second automatic dictation delay. A queued dictation send would POST immediately after transcription, plus at most the session deadline.

The simplest robust fix is to distinguish “unavailable” from “working”: add an `aria-busy`/working state and keep **Sending**, **Writing that down**, and **Adding the picture** at full opacity while retaining the actual disabled behavior. Do not change authentication or send on `pointerdown` without evidence.

For proof of the remaining uncertainty, record client timestamps for `tap → sending render → session resolved → fetch started`; server logs alone cannot locate the delay inside that interval.